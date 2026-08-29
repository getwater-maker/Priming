'use strict';
/**
 * core/comfy-video.js — ComfyUI(HTTP API) 이미지→비디오(i2v). LTX2.5/2.3 등 워크플로.
 *
 * 흐름: /upload/image 로 그룹 이미지 업로드 → 워크플로 LoadImage.image = 업로드명
 *   (LoadImage 노드가 없으면 하나를 자동 주입해 i2v latent 노드의 start_image 에 연결)
 *   → 프롬프트/길이(length)/해상도/seed 주입 → /prompt 큐 → 폴링 → 비디오(mp4) 다운로드.
 * 로컬(127.0.0.1:8188): /prompt·/history·/view.  클라우드(cloud.comfy.org): /api 접두 + X-API-Key +
 *   extra_data.api_key_comfy_org, 폴링 /api/job/{id}/status → /api/jobs/{id}. (comfy-image.js 와 동일 패턴)
 * 워크플로는 ComfyUI 에서 "저장(API 포맷)" 한 JSON. (구 comfy-engine.js 의 검증된 i2v 로직을 이식)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
function ffmpegPath() { try { return require('./media-utils').getFfmpegPath(); } catch {} try { return require('ffmpeg-static'); } catch { return ''; } }

const CFG_PATH = path.join(os.homedir(), '.priming-maker', 'comfy-video-config.json');
const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:8188',
  cloud: false,
  apiKey: '',
  workflowPath: '',        // 현재 활성 i2v 워크플로 "저장(API 포맷)" JSON 경로
  workflows: [],           // 저장된 워크플로 목록 [{name, path}] — 드롭다운 전환(Wan/LTX 등)
  promptNodeId: '',        // 빈값=Positive CLIPTextEncode 자동탐지
  imageNodeId: '',         // 빈값=LoadImage 자동탐지(없으면 자동 주입)
  fps: 24,                 // 초→프레임 변환용(워크플로 CreateVideo fps 와 맞추기)
  videoMaxSec: 8,          // i2v 최대 길이(초) — 클라우드 GPU 시간/비용 상한. 0=제한없음(TTS 길이 그대로)
  sendDims: true,          // 비율에 맞춰 해상도 주입
  timeoutSec: 600,
  // 헤더 드롭다운의 「ComfyUI 로컬 / ComfyUI 클라우드」 전환용 — 각 모드의 주소를 따로 기억(이미지와 동일 정책).
  localBaseUrl: 'http://127.0.0.1:8188',
  cloudBaseUrl: 'https://cloud.comfy.org',
  // 클라우드 동시 i2v 개수 — i2v 는 건당 수 분이라 왕복 오버헤드 비중은 작지만, 여러 개를 동시에 올리면
  //   **벽시계 시간**이 크게 줄어든다(5개×8분 순차 40분 → 동시 3이면 ~14분). 총 크레딧은 동일(생성당 과금).
  //   ⚠ 로컬(cloud=false)은 VRAM 때문에 항상 1개씩 강제. 1 = 기존 순차(완전 동일 동작).
  concurrency: 3,
  migratedLtx25: false,    // LTX2.3 → LTX2.5 1회성 이관 완료 표시(사용자가 되돌리면 그 선택 유지)
  servers: [],             // 저장된 서버 프로필 [{name, baseUrl, cloud, apiKey}] — 드롭다운으로 전환(comfy.org/RunPod 등)
  activeServer: '',        // 현재 선택된 서버 프로필 이름(표시용)
};

// ── 번들 워크플로 자동 등록 (설치폴더 기준, PC 무관 정합) ──
// 저장소 comfy/*.json 은 설치·라이트업데이트로 모든 PC 에 내려감. 그러나 워크플로 "등록"(workflows[])은
// 예전엔 홈 설정파일 수동 기록에만 있어(내 PC 절대경로) 다른 PC 엔 안 갔음. → 코드가 항상 설치폴더 기준으로
// 번들 워크플로를 보장(경로 재해석)하고 사용자 커스텀은 보존한다. __dirname='<install>/core' → COMFY_DIR='<install>/comfy'.
const COMFY_DIR = path.join(__dirname, '..', 'comfy');
const BUNDLED = [
  { name: 'LTX2.3',    file: 'video_ltx2_3_i2v.json' },
  { name: 'LTX2.5',    file: 'video_ltx2_5_i2v.json' },
  // 🖥 로컬 전용 — RTX 3060 실측 5초/9.4분(1312x736). 크레딧 0 · 오디오 동시 생성.
  //   ⚠ 이 파일은 Deno 커스텀 노드를 쓰므로 **클라우드에서는 실패한다**(이름에 (로컬) 명시).
  { name: 'MiniMax H3 turbo4 (로컬)', file: 'video_minimax_h3_turbo4_i2v.json' },
  // ☁ 클라우드 전용 — 같은 MiniMax H3 레퍼런스 방식을 comfy.org 에서. 2026-08-29 실측으로 모델이
  //   올라와 있음을 확인했다(unet minimax_h3_ref2va_pruned_int8_convrot · clip qwen3vl_32b_minimax_h3 ·
  //   vae video/audio · lora minimax_h3_turbo_v4_step600). 로컬 Deno 노드 대신 **ComfyUI 네이티브**
  //   MiniMaxH3ReferenceToVideo 를 쓴다(공식 템플릿 video_minimax_h3_r2v 를 API 포맷으로 변환).
  //   ⚠ 이 파일은 로컬 ComfyUI 에 그 모델들이 없으면 실패한다(이름에 (클라우드) 명시).
  { name: 'MiniMax H3 레퍼런스 (클라우드)', file: 'video_minimax_h3_ref2v_cloud.json' },
];
// MiniMax H3 레퍼런스 프롬프트 접두사 — 대본은 그대로 두고 엔진이 붙인다(아래 _buildGraph 주석 참조).
const MM_REF_PREFIX = '<Picture 1> is the exact scene: keep its composition, characters, clothing, colors and art style unchanged. ';
// 0.98MP 실측 563초 — 기본 600초로는 실제로 타임아웃 났다(E2E). 여유를 둔 하한.
const MM_MIN_TIMEOUT_SEC = 1500;
const DEFAULT_ACTIVE_FILE = 'video_ltx2_5_i2v.json'; // 활성값이 비었거나 실재하지 않을 때 기본
// 배포에서 뺀 옛 번들 워크플로 — 목록에서 지운다(로이 2026-08-14: Wan 2.2 제거).
//   ⚠ 그냥 BUNDLED 에서 빼기만 하면 기존 PC 의 설정파일에 남은 항목이 "사용자 커스텀"으로 취급돼
//     드롭다운에 계속 남는다. 파일도 저장소에서 지웠으므로 여기서 명시적으로 걸러야 한다.
const RETIRED = ['video_wan2_2_5B_ti2v.json'];
function _ensureBundled(cfg) {
  const wfs = Array.isArray(cfg.workflows) ? cfg.workflows : [];
  const bundledNames = new Set(BUNDLED.map((b) => b.file.toLowerCase()));
  // 1) 기존 목록에서 번들 파일명과 겹치는 항목 제거(경로 표류·이름 변형 정리) + 폐기된 번들 제거 — 커스텀만 남김
  const retired = new Set(RETIRED.map((f) => f.toLowerCase()));
  const customs = wfs.filter((w) => {
    const bn = w && w.path ? path.basename(String(w.path)).toLowerCase() : '';
    return bn && !bundledNames.has(bn) && !retired.has(bn);
  });
  // 폐기된 워크플로가 활성이었다면 활성값도 비운다 → 아래 3) 이 기본(LTX2.5)으로 복구
  if (retired.has(path.basename(String(cfg.workflowPath || '')).toLowerCase())) cfg.workflowPath = '';
  // 2) 번들 워크플로를 설치폴더 절대경로로 재구성(파일 존재하는 것만)
  const bundled = [];
  for (const b of BUNDLED) {
    const p = path.join(COMFY_DIR, b.file);
    if (fs.existsSync(p)) bundled.push({ name: b.name, path: p });
  }
  cfg.workflows = [...bundled, ...customs];
  // 2.5) LTX2.3 → LTX2.5 **1회성 이관** (2026-08-14 로이 지정: 비디오 도구를 LTX2.5 i2v 로 교체).
  //   comfy.org 에 ltx-2.5 오픈웨이트(UNETLoader 계열)가 올라와, 파트너 API 노드(초당 과금) 없이
  //   지금과 같은 **GPU 시간 과금**으로 2.5 를 쓸 수 있게 됐다. 플래그로 1회만 바꾸므로,
  //   이후 사용자가 드롭다운에서 2.3 으로 되돌리면 그 선택이 유지된다.
  if (!cfg.migratedLtx25) {
    if (path.basename(String(cfg.workflowPath || '')).toLowerCase() === 'video_ltx2_3_i2v.json') {
      const to = bundled.find((w) => path.basename(w.path).toLowerCase() === 'video_ltx2_5_i2v.json');
      if (to) cfg.workflowPath = to.path;
    }
    cfg.migratedLtx25 = true;
  }
  // 3) 활성 워크플로 경로 재해석/복구
  const curBn = path.basename(String(cfg.workflowPath || '')).toLowerCase();
  const curBundled = bundled.find((w) => path.basename(w.path).toLowerCase() === curBn);
  if (curBundled) cfg.workflowPath = curBundled.path;                          // 번들이면 설치폴더 경로로 교정(절대경로 표류 수정)
  else if (!cfg.workflowPath || !fs.existsSync(cfg.workflowPath)) {            // 비었거나 실재하지 않으면(타 PC 절대경로 등) 기본 번들로
    const def = bundled.find((w) => path.basename(w.path).toLowerCase() === DEFAULT_ACTIVE_FILE.toLowerCase()) || bundled[0];
    if (def) cfg.workflowPath = def.path;
  }
  // 실재하는 커스텀 활성값은 그대로 둠(사용자 선택 존중)
  return cfg;
}
function loadConfig() {
  let cfg = { ...DEFAULTS };
  try { if (fs.existsSync(CFG_PATH)) cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) }; } catch {}
  // ⚠ 예전(2026-08-20 오전)에는 여기서 `cloud:false → true` 로 **강제 교정**했다(비디오 클라우드 전용 시절).
  //   같은 날 오후 로이 요청으로 **로컬 i2v 가 다시 선택 가능**해졌으므로 그 교정을 없앴다 —
  //   남겨 두면 헤더에서 🖥 로컬을 골라도 다음 loadConfig 때 클라우드로 되돌아가 선택이 먹지 않는다.
  //   대신 **주소 정합만** 지킨다: cloud 값과 baseUrl 이 어긋나면(설정 파일 손질·구버전 잔재) 그쪽 주소로 맞춘다.
  if (!cfg.baseUrl) cfg.baseUrl = cfg.cloud ? (cfg.cloudBaseUrl || DEFAULTS.cloudBaseUrl) : (cfg.localBaseUrl || DEFAULTS.localBaseUrl);
  const _isLocalUrl = /127\.0\.0\.1|localhost/i.test(String(cfg.baseUrl));
  if (cfg.cloud && _isLocalUrl) cfg.baseUrl = cfg.cloudBaseUrl || DEFAULTS.cloudBaseUrl;
  return _ensureBundled(cfg);
}
function saveConfig(patch) {
  try {
    fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true });
    const next = { ...loadConfig(), ...(patch || {}) };
    fs.writeFileSync(CFG_PATH, JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch { return loadConfig(); }
}

class ComfyVideo {
  constructor(cfg = {}, logger = () => {}) {
    this.cloud = !!cfg.cloud;
    this.apiKey = cfg.apiKey || '';
    let base = String(cfg.baseUrl || 'http://127.0.0.1:8188').trim().replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) base = 'http://' + base;   // 스킴 없이 입력해도 동작
    base = base.replace(/(:\d+)(?::\d+)+$/, '$1');                      // "host:8188:8188" 같은 포트 중복 오타 보정
    // 클라우드 체크 시엔 주소칸(로컬/LAN IP 등)과 무관하게 항상 comfy.org 로. (LAN IP+클라우드 혼합 오설정 방지)
    if (this.cloud && !/cloud\.comfy\.org/i.test(base)) base = 'https://cloud.comfy.org';
    this.baseUrl = base;
    this.workflowPath = cfg.workflowPath || '';
    this.promptNodeId = cfg.promptNodeId || '';
    this.imageNodeId = cfg.imageNodeId || '';
    this.fps = Number(cfg.fps) > 0 ? Number(cfg.fps) : 24;
    this.videoMaxSec = Number(cfg.videoMaxSec) >= 0 ? Number(cfg.videoMaxSec) : 8;
    this.sendDims = cfg.sendDims !== false;
    this.timeoutSec = Number(cfg.timeoutSec) > 0 ? Number(cfg.timeoutSec) : 600;
    this.clientId = 'priming_' + Math.random().toString(36).slice(2, 10);
    this.log = logger;
  }
  _url(p) { return this.baseUrl + (this.cloud ? '/api' : '') + p; }
  _headers(extra = {}) { const h = { ...extra }; if (this.cloud && this.apiKey) h['X-API-Key'] = this.apiKey; return h; }
  async health() {
    if (this.cloud) { if (!this.apiKey) { this.log('[ComfyVid] ⚠ 클라우드 모드인데 API 키가 비었습니다.'); return false; } return true; }
    try { const r = await fetch(this._url('/system_stats'), { method: 'GET' }); return r.ok; } catch { return false; }
  }
  // 로컬 ComfyUI 의 상주 모델을 언로드하고 VRAM 을 비운다(12GB OOM 방지 — 예: 이미지 Krea2(FLUX)→비디오 Wan 전환).
  //   클라우드는 인스턴스가 분리돼 불필요. 실패해도 무시(구버전 ComfyUI 는 /free 없음).
  async freeMemory() {
    if (this.cloud) return;
    try { await fetch(this._url('/free'), { method: 'POST', headers: this._headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ unload_models: true, free_memory: true }) }); } catch {}
  }
  async _uploadImage(imagePath) {
    const data = fs.readFileSync(imagePath);
    const fd = new FormData();
    fd.append('image', new Blob([data]), path.basename(imagePath));
    fd.append('type', 'input');
    fd.append('overwrite', 'true');
    const r = await fetch(this._url('/upload/image'), { method: 'POST', headers: this._headers(), body: fd });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`이미지 업로드 실패 (${r.status}) ${t.slice(0, 200)}`); }
    const j = await r.json().catch(() => ({}));
    const name = j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
    this.log(`[ComfyVid] 이미지 업로드 → "${name}" (status ${r.status}, resp ${JSON.stringify(j).slice(0, 160)})`);
    if (!name) throw new Error('업로드 응답에 파일명이 없습니다 — /upload/image 응답 형식 확인 필요: ' + JSON.stringify(j).slice(0, 200));
    return name;
  }
  _scanVideo(outputs) {
    outputs = outputs || {};
    const match = (x) => x && (/\.(mp4|webm|mov|mkv)$/i.test(x.filename || '') || /video|mp4|webm/i.test(x.format || ''));
    for (const nodeId of Object.keys(outputs)) {
      const o = outputs[nodeId] || {};
      for (const key of Object.keys(o)) { const arr = o[key]; if (Array.isArray(arr)) { const m = arr.find(match); if (m) return m; } }
    }
    return null;
  }
  _extractOutputs(j) {
    if (!j || typeof j !== 'object') return {};
    if (j.outputs) return j.outputs;
    if (j.job && j.job.outputs) return j.job.outputs;
    if (j.result && j.result.outputs) return j.result.outputs;
    for (const k of Object.keys(j)) { if (j[k] && j[k].outputs) return j[k].outputs; }
    return j;
  }
  // i2v 생성 해상도 — **처음부터 1080p 급으로 뽑는다**(로이 2026-08-12).
  //   예전엔 1280x704 로 뽑고 로컬 Real-ESRGAN 으로 1920x1080 업스케일했는데, 실측 결과 그 방식이
  //   모든 면에서 불리했다: ① 느리다(704 생성 24.5s + 업스케일 43.1s = 67.6s vs 직접 1080p 41.3s)
  //   ② 업스케일은 **로컬 GPU** 라 OmniVoice TTS 와 경합해 **TTS 를 1.8배 느리게** 만든다
  //      (서버 로그 실측: 업스케일 중 RTF 1.26 / 끝난 뒤 0.70) ③ 화질도 업스케일본이 더 뭉갠다.
  //   → 직접 생성은 클라우드에서만 돌아 로컬 GPU 점유가 0 이고, 업스케일 단계 자체가 필요 없어진다.
  //   ⚠ LTX 는 변 길이가 32 의 배수여야 하므로 1080 이 아니라 **1088**. (16:9 는 실측 검증됨)
  //   되돌리려면 이 값만 옛 값(1280x704 / 960x960 / 704x1280)으로 바꾸면 된다 — 업스케일은
  //   maybeUpscale 이 해상도를 보고 자동으로 다시 동작한다.
  _videoDims(aspect) {
    if (aspect === '16:9') return { w: 1920, h: 1088 };
    if (aspect === '1:1') return { w: 1440, h: 1440 };
    return { w: 1088, h: 1920 }; // 9:16
  }
  // MiniMax H3 는 **공식 768p(0.98MP) 격자**를 넘기면 손해다 (2026-08-30 클라우드 실측, 5초·turbo4):
  //   1344x768(0.98MP) **57초** / 1920x1088(2.09MP) **208초** — 3.6배 느린데다 구도 이탈이 더 심했다
  //   (규격 밖 해상도라 모델이 장면을 다시 상상한다). 로컬도 같은 이유로 0.98MP 를 쓴다(v0.3.70).
  //   ⚠ 대신 1920x1080 미만이라 maybeUpscale 이 로컬 GPU 로 업스케일한다(영상당 30~40초).
  _mmDims(aspect) {
    if (aspect === '16:9') return { w: 1344, h: 768 };
    if (aspect === '1:1') return { w: 992, h: 992 };
    return { w: 768, h: 1344 }; // 9:16
  }
  _snap4(frames) { return Math.max(5, 4 * Math.round((frames - 1) / 4) + 1); } // Wan length = 4n+1
  _buildGraph(uploadName, prompt, aspect, durSec) {
    if (!this.workflowPath || !fs.existsSync(this.workflowPath)) throw new Error('워크플로(API 포맷 JSON)가 지정되지 않았습니다 — ⚙ ComfyUI 비디오에서 지정하세요.');
    let wf = JSON.parse(fs.readFileSync(this.workflowPath, 'utf8'));
    if (wf.nodes && !wf['1'] && typeof wf.nodes === 'object') throw new Error('UI 포맷 워크플로입니다. ComfyUI 에서 "저장(API 포맷)"으로 저장하세요.');
    const graph = JSON.parse(JSON.stringify(wf));
    const ids = Object.keys(graph);
    // ── MiniMax H3 레퍼런스 계열 감지 ──
    //   i2v(start_image 고정)가 아니라 "레퍼런스 참조 생성"이라 배선·프롬프트 규약이 다르다.
    //   · 이미지는 LoadImage 가 아니라 ReferenceImageLoader.image_paths(줄바꿈 구분 목록)로 들어간다.
    //   · 프롬프트는 <Picture 1> 태그로 레퍼런스의 역할을 지정해야 원본 구도·화풍이 유지된다(실측).
    //   🔑 레퍼런스 계열은 **두 종류**다 — 로컬은 Deno 커스텀 노드(DenoMiniMaxH3Reference*),
    //     클라우드(comfy.org)는 ComfyUI **네이티브** MiniMaxH3ReferenceToVideo 다. 이미지가 들어가는
    //     자리는 다르지만(image_paths ↔ LoadImage) **<Picture 1> 접두사는 둘 다 필요**하다.
    //     ⚠ 예전엔 이 판정이 Deno 이름 하나뿐이라 클라우드 판에는 접두사가 조용히 안 붙었다 →
    //       구도·인물·화풍이 통째로 바뀐다(실측: 12회 중 여러 건이 엉뚱한 클로즈업으로 붕괴).
    const mmLoaderId = ids.find((id) => /MiniMaxH3ReferenceImageLoader/i.test(graph[id].class_type || ''));
    const mmRef = !!mmLoaderId || ids.some((id) => /MiniMaxH3ReferenceToVideo/i.test(graph[id].class_type || ''));
    // ── 이미지 주입 (LoadImage) ──
    if (mmLoaderId) {
      graph[mmLoaderId].inputs = graph[mmLoaderId].inputs || {};
      graph[mmLoaderId].inputs.image_paths = uploadName;   // 업로드된 이름 = input 폴더 상대경로
      this.log('[ComfyVid] MiniMax H3 레퍼런스 이미지 주입 → image_paths=' + uploadName);
    } else if (this.imageNodeId && graph[this.imageNodeId]) {
      graph[this.imageNodeId].inputs = graph[this.imageNodeId].inputs || {}; graph[this.imageNodeId].inputs.image = uploadName;
    } else {
      const imgIds = ids.filter((id) => graph[id].class_type === 'LoadImage');
      if (imgIds.length) { for (const id of imgIds) graph[id].inputs.image = uploadName; }
      else {
        // LoadImage 가 없으면 자동 주입 → i2v latent 노드(start_image)에 연결.
        const i2vId = ids.find((id) => /ImageToVideo|I2V|ImageToVideoLatent/i.test(graph[id].class_type || ''));
        if (!i2vId) throw new Error('LoadImage 도 i2v 노드도 못 찾음 — 워크플로에 "Load Image → start_image" 연결 후 API 포맷으로 다시 저장하세요.');
        const newId = String(Math.max(0, ...ids.map(Number).filter((n) => !isNaN(n))) + 1);
        graph[newId] = { inputs: { image: uploadName, upload: 'image' }, class_type: 'LoadImage', _meta: { title: 'LoadImage(auto)' } };
        graph[i2vId].inputs = graph[i2vId].inputs || {}; graph[i2vId].inputs.start_image = [newId, 0];
        this.log('[ComfyVid] LoadImage 노드 자동 주입 → ' + (graph[i2vId].class_type) + '.start_image');
      }
    }
    // ── 프롬프트 주입 ──
    //   Wan 등: Positive CLIPTextEncode 의 리터럴 text.
    //   LTX 등(서브그래프): 프롬프트가 "Prompt" 문자열 Primitive → TextGenerate → CLIPTextEncode(text=링크)로 흐름
    //     → CLIPTextEncode 에 넣으면 링크라 무시(또는 네거티브 리터럴을 덮어쓸 위험) → 문자열 Primitive 의 value 에 주입.
    if (prompt) {
      //   MiniMax H3: 대본은 그대로 두고 엔진이 <Picture 1> 접두사만 붙인다.
      //   ⚠ 이게 없으면 레퍼런스가 "참고"에 그쳐 구도·인물·화풍이 통째로 바뀐다(실측: 왕+신하 5명 → 얼굴 클로즈업).
      //   ⛔ 대본에 이 태그를 쓰게 하지 말 것 — 엔진을 LTX 로 되돌리면 대본 468편이 그 문법에 묶인다.
      if (mmRef) prompt = MM_REF_PREFIX + String(prompt);
      const titleOf = (id) => ((graph[id]._meta && graph[id]._meta.title) || '').toLowerCase();
      const isNeg = (id) => /negative|부정|worst|nsfw|bad ?quality/.test(titleOf(id)) || /negative/.test((graph[id].class_type || '').toLowerCase());
      const setLit = (n, keys) => { if (!n || !n.inputs) return false; for (const k of keys) { if (k in n.inputs && typeof n.inputs[k] !== 'object') { n.inputs[k] = String(prompt); return true; } } return false; };
      let done = false;
      if (this.promptNodeId && graph[this.promptNodeId]) done = setLit(graph[this.promptNodeId], ['value', 'text', 'prompt', 'positive', 'positive_prompt', 'string']);
      if (!done) {
        // ① 문자열 Primitive("Prompt") — LTX 등 모던 서브그래프
        const strIds = ids.filter((id) => /PrimitiveString|StringMultiline|String \(|DenoPromptText/i.test(graph[id].class_type || '') && !isNeg(id));
        const pStr = strIds.find((id) => /prompt|positive|긍정|프롬프트/.test(titleOf(id))) || strIds[0];
        if (pStr) done = setLit(graph[pStr], ['value', 'string', 'text']);
      }
      if (!done) {
        // ② Positive CLIPTextEncode 의 리터럴 text(네거티브·링크 제외) — Wan 등 전통 그래프
        const clipIds = ids.filter((id) => graph[id].class_type === 'CLIPTextEncode' && typeof (graph[id].inputs || {}).text !== 'object' && 'text' in (graph[id].inputs || {}) && !isNeg(id));
        const pId = clipIds.find((id) => /positive|긍정/.test(titleOf(id))) || clipIds[0];
        if (pId) done = setLit(graph[pId], ['text']);
      }
      if (!done) this.log('[ComfyVid] ⚠ 프롬프트 주입 대상 노드를 못 찾음 — 워크플로 기본 프롬프트로 진행합니다.');
    }
    // ── 프롬프트 증강(Prompt Enhance) 끄기 ──
    //   LTX2.3 등은 "Enable Prompt Enhance" 불리언이 켜져 있으면 Gemma(LLM)가 우리 프롬프트를 영화적으로 재작성해
    //   realism(실사) 어휘를 얹음 → 수채화 등 화풍이 i2v 에서 사진처럼 변질됨. 우리 프롬프트를 그대로 쓰도록 강제 OFF.
    {
      const enhIds = ids.filter((id) => {
        const t = ((graph[id]._meta && graph[id]._meta.title) || '').toLowerCase();
        const isBool = /PrimitiveBoolean|Boolean/i.test(graph[id].class_type || '') || typeof (graph[id].inputs || {}).value === 'boolean';
        return isBool && (/prompt.?enhanc|enhanc.?prompt|프롬프트.?(증강|향상|보강)/.test(t));
      });
      for (const id of enhIds) {
        if (graph[id].inputs && graph[id].inputs.value === true) {
          graph[id].inputs.value = false;
          this.log(`[ComfyVid] 프롬프트 증강(Prompt Enhance) OFF — 화풍 보존(입력 프롬프트 그대로)`);
        }
      }
    }
    // ── seed 랜덤(0~2^31-1) ──
    for (const id of ids) {
      const inp = graph[id].inputs || {}; const rnd = Math.floor(Math.random() * 2147483647);
      if (typeof inp.seed === 'number') inp.seed = rnd;
      if (typeof inp.noise_seed === 'number') inp.noise_seed = rnd;
    }
    // ── 해상도(비율) ──
    const _titleOf = (id) => ((graph[id]._meta && graph[id]._meta.title) || '').toLowerCase();
    const _isPrimNum = (id) => /Primitive(Int|Float)?/i.test(graph[id].class_type || '') && typeof (graph[id].inputs || {}).value === 'number';
    if (this.sendDims && aspect) {
      const d = mmRef ? this._mmDims(aspect) : this._videoDims(aspect);
      let set = false;
      // ① 같은 노드에 width+height 리터럴 (Wan 등)
      for (const id of ids) { const inp = graph[id].inputs || {}; if (typeof inp.width === 'number' && typeof inp.height === 'number') { inp.width = d.w; inp.height = d.h; set = true; break; } }
      // ② 별도 Primitive("Width"/"Height") — LTX 등
      if (!set) {
        const wId = ids.find((id) => _isPrimNum(id) && /width|가로|너비/.test(_titleOf(id)));
        const hId = ids.find((id) => _isPrimNum(id) && /height|세로|높이/.test(_titleOf(id)));
        if (wId) { graph[wId].inputs.value = d.w; set = true; }
        if (hId) { graph[hId].inputs.value = d.h; set = true; }
      }
    }
    // ── 길이(초→프레임 length) ──
    if (durSec) {
      let sec = Math.max(1, Math.ceil(Number(durSec) || 0));
      if (this.videoMaxSec > 0) sec = Math.min(this.videoMaxSec, sec);
      const frames = this._snap4(Math.round(sec * this.fps));
      let set = false;
      // ① latent 노드의 리터럴 length/num_frames (프레임) — Wan 등
      for (const id of ids) { const inp = graph[id].inputs || {}; if (typeof inp.length === 'number') { inp.length = frames; set = true; break; } if (typeof inp.num_frames === 'number') { inp.num_frames = frames; set = true; break; } }
      // ② 별도 Primitive — "Duration"(초 단위) 우선, 없으면 "Length/Frames"(프레임) — LTX 등
      if (!set) {
        const durId = ids.find((id) => _isPrimNum(id) && /duration|길이|초\b|sec/.test(_titleOf(id)));
        if (durId) { graph[durId].inputs.value = sec; set = true; }        // Duration = 초(내부 math 가 프레임 계산)
        else { const frId = ids.find((id) => _isPrimNum(id) && /length|frames?|프레임/.test(_titleOf(id))); if (frId) { graph[frId].inputs.value = frames; set = true; } }
      }
      if (!set) this.log('[ComfyVid] ⚠ 길이 주입 대상을 못 찾음 — 워크플로 기본 길이로 진행합니다.');
    }
    return graph;
  }
  // 모델 파일이 그 서버에 없을 때(로컬↔클라우드 판이 달라서) **한 번만** 고쳐 재제출한다.
  //   🔑 미리 /object_info 를 받지 않는다 — 정상일 때 추가 요청 0회. 실패 응답이 목록을 담아 준다.
  //   고친 내용은 기억해서(_modelFixes) 두 번째 장부터는 헛왕복도 없다.
  async _queueFixing(graph) {
    const CM = require('./comfy-models');
    this._modelFixes = this._modelFixes || {};
    CM.applyRemembered(graph, this._modelFixes);
    try { return await this._queue(graph); }
    catch (e) {
      if (!e.nodeErrors) throw e;
      const r = CM.applyModelFixes(graph, e.nodeErrors);
      if (!r.changes.length) throw e;                       // 같은 모델의 다른 판이 없으면 조용히 바꾸지 않는다
      for (const c of r.changes) {
        this._modelFixes[c.nodeId + '|' + c.input] = c.to;
        this.log(`[ComfyVid] 🔁 모델 자동 대체: ${c.from} → ${c.to} (${this.cloud ? '클라우드' : '로컬'} 에 앞의 판이 없음)`);
      }
      return await this._queue(graph);
    }
  }
  async _queue(graph) {
    const payload = { prompt: graph, client_id: this.clientId };
    if (this.cloud && this.apiKey) payload.extra_data = { api_key_comfy_org: this.apiKey };
    const r = await fetch(this._url('/prompt'), { method: 'POST', headers: this._headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) });
    if (r.status === 401 || r.status === 403) throw new Error('API 키 인증 실패 (401/403) — 키를 확인하세요.');
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`/prompt 큐 실패 (${r.status}): ${t.slice(0, 300)}`); }
    const j = await r.json();
    if (j.node_errors && Object.keys(j.node_errors).length) {
      // 원문 JSON 은 잘려서 읽을 수 없다 → 사람 말 안내를 만들고, **목록을 오류에 실어** 위에서 자동 보정하게 한다.
      const CM = require('./comfy-models');
      const why = CM.explain(j.node_errors, this.cloud, 'video');
      const err = new Error(why || ('워크플로 노드 오류: ' + JSON.stringify(j.node_errors).slice(0, 300)));
      err.nodeErrors = j.node_errors;
      throw err;
    }
    this.log(`[ComfyVid] 큐 접수 → prompt_id=${j.prompt_id || '(없음)'} (resp keys: ${Object.keys(j).join(',')})`);
    return j.prompt_id;
  }
  async _waitCloud(promptId, abortSignal) {
    const deadline = Date.now() + this.timeoutSec * 1000;
    while (Date.now() < deadline) {
      if (abortSignal && abortSignal()) throw new Error('중단됨');
      await new Promise((res) => setTimeout(res, 2500));
      let st;
      try {
        const r = await fetch(this._url(`/job/${promptId}/status`), { headers: this._headers() });
        if (r.status === 401 || r.status === 403) throw new Error('API 키 인증 실패 (401/403)');
        if (!r.ok) continue; st = await r.json();
      } catch (e) { if (/인증/.test(e.message)) throw e; continue; }
      const status = (st && (st.status || st.state) || '').toLowerCase();
      if (status === 'failed' || status === 'cancelled' || status === 'error') { const d = (st && st.error_message) ? String(st.error_message) : JSON.stringify(st); throw new Error(`클라우드 작업 ${status}: ${d.slice(0, 1000)}`); }
      if (status === 'completed' || status === 'success') {
        const r2 = await fetch(this._url(`/jobs/${promptId}`), { headers: this._headers() });
        if (!r2.ok) throw new Error(`작업 상세 조회 실패 (${r2.status})`);
        const vid = this._scanVideo(this._extractOutputs(await r2.json()));
        if (vid) return vid;
        throw new Error('출력에서 비디오를 찾지 못했습니다 — SaveVideo/VHS_VideoCombine 출력을 확인하세요.');
      }
    }
    throw new Error(`타임아웃 (${this.timeoutSec}초)`);
  }
  async _waitLocal(promptId, abortSignal) {
    const deadline = Date.now() + this.timeoutSec * 1000;
    while (Date.now() < deadline) {
      if (abortSignal && abortSignal()) { try { await fetch(this._url('/interrupt'), { method: 'POST', headers: this._headers() }); } catch {} throw new Error('중단됨'); }
      await new Promise((res) => setTimeout(res, 1500));
      let hist;
      try { const r = await fetch(this._url(`/history/${promptId}`)); if (!r.ok) continue; hist = await r.json(); } catch { continue; }
      const entry = hist && hist[promptId];
      if (!entry) continue;
      if (entry.status && entry.status.status_str === 'error') throw new Error('ComfyUI 실행 오류 (history status=error)');
      const outputs = entry.outputs || {};
      const vid = this._scanVideo(outputs);
      if (vid) return vid;
      if (Object.keys(outputs).length) throw new Error('출력에 비디오가 없습니다 — SaveVideo 노드를 확인하세요.');
    }
    throw new Error(`타임아웃 (${this.timeoutSec}초)`);
  }
  async _download(vid, outputPath) {
    const q = new URLSearchParams({ filename: vid.filename, subfolder: vid.subfolder || '', type: vid.type || 'output' });
    const r = await fetch(this._url('/view') + '?' + q.toString(), { headers: this._headers() });
    if (!r.ok) throw new Error(`/view 다운로드 실패 (${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (/\.mp4$/i.test(vid.filename)) { fs.writeFileSync(outputPath, buf); return outputPath; }
    // webm/mov → mp4 재인코딩
    const tmp = outputPath.replace(/\.mp4$/i, '') + (path.extname(vid.filename) || '.webm');
    fs.writeFileSync(tmp, buf);
    const ff = ffmpegPath();
    if (ff && fs.existsSync(ff)) {
      const rr = spawnSync(ff, ['-y', '-i', tmp, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', outputPath], { stdio: 'ignore' });
      try { fs.unlinkSync(tmp); } catch {}
      if (rr.status === 0 && fs.existsSync(outputPath)) return outputPath;
      throw new Error('ffmpeg mp4 변환 실패');
    }
    return tmp;
  }
  // 이미지 → 비디오 1개. { success, videoPath } | { success:false, error }
  async imageToVideo({ imagePath, prompt, aspect, durationSec, outputPath, abortSignal }) {
    try {
      if (!(await this.health())) return { success: false, error: `ComfyUI 연결 실패 (${this.baseUrl})${this.cloud ? ' — API 키/구독 확인' : ''}` };
      const uploadName = await this._uploadImage(imagePath);
      const graph = this._buildGraph(uploadName, prompt, aspect, durationSec);
      // ⏱ MiniMax H3(로컬)는 3060 실측 0.98MP **563초** — 기본 600초와 너무 가까워 실제로 타임아웃 났다(E2E).
      //   그 워크플로일 때만 하한을 올린다. 타임아웃은 상한일 뿐이라 LTX(1~2분)에는 영향이 없다.
      const _mmSlow = Object.values(graph).some((x) => /MiniMaxH3Reference/i.test(x.class_type || ''));
      const _savedTimeout = this.timeoutSec;
      if (_mmSlow && this.timeoutSec < MM_MIN_TIMEOUT_SEC) {
        this.timeoutSec = MM_MIN_TIMEOUT_SEC;
        this.log(`[ComfyVid] MiniMax H3 — 타임아웃 ${_savedTimeout}초 → ${MM_MIN_TIMEOUT_SEC}초 (실측 0.98MP 563초)`);
      }
      try {
      // 진단: 큐로 실제 전송되는 그래프에 우리 이미지·프롬프트가 들어갔는지 확인(클라우드가 이를 무시하는지 판별용)
      try {
        const liIds = Object.keys(graph).filter((id) => graph[id].class_type === 'LoadImage');
        const imgVal = liIds.map((id) => graph[id].inputs && graph[id].inputs.image).join(', ');
        this.log(`[ComfyVid] 큐 전송 그래프 확인 → LoadImage=[${imgVal}] · 프롬프트="${String(prompt || '').slice(0, 45)}…" · 노드수 ${Object.keys(graph).length}`);
      } catch {}
      const promptId = await this._queueFixing(graph);
      const vid = this.cloud ? await this._waitCloud(promptId, abortSignal) : await this._waitLocal(promptId, abortSignal);
      const out = await this._download(vid, outputPath);
      return { success: true, videoPath: out };
      } finally { this.timeoutSec = _savedTimeout; }   // 인스턴스 재사용 시 다른 워크플로에 새지 않게
    } catch (e) { return { success: false, error: e.message }; }
  }
}

module.exports = { ComfyVideo, loadConfig, saveConfig, CFG_PATH, DEFAULTS };
