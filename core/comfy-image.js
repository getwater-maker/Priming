'use strict';
/**
 * core/comfy-image.js — ComfyUI(HTTP API)로 텍스트→이미지 1장. z-image 등 워크플로 사용.
 *
 * 브라우저 없이 REST API 만 사용 → 로컬(127.0.0.1:8188)이든 comfy.org 클라우드든 설정만 바꾸면 동작.
 *   로컬:    baseUrl=http://127.0.0.1:8188, 키 없음. /prompt·/history·/view.
 *   클라우드: cloud=true → baseUrl=https://cloud.comfy.org, 경로에 /api 접두 + X-API-Key 헤더,
 *            폴링 /api/job/{id}/status → /api/jobs/{id}. (Standard+ 구독 필요)
 *
 * 워크플로는 ComfyUI 에서 "저장(API 포맷)" 한 JSON 을 workflowPath 로 지정.
 *   앱이 그 그래프에 프롬프트(첫 CLIPTextEncode.text 또는 promptNodeId)·해상도(latent width/height)·seed 를 주입.
 * (proven 코드 — 구 comfy-engine.js 의 이미지 경로를 이식·집중화)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const CFG_PATH = path.join(os.homedir(), '.priming-maker', 'comfy-image-config.json');
const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:8188',
  cloud: false,
  apiKey: '',
  workflowPath: '',        // 현재 활성 워크플로 "저장(API 포맷)" JSON 경로 (필수)
  workflows: [],           // 저장된 워크플로 목록 [{name, path}] — 드롭다운으로 전환(z-image/Krea2 등)
  promptNodeId: '',        // 빈값=CLIPTextEncode(계열) 또는 text 입력 노드 자동탐지
  widthNodeId: '',         // 빈값=width·height 가진 latent 노드 자동탐지
  heightNodeId: '',
  sendDims: true,          // 프로젝트 비율에 맞춰 해상도 주입(끄면 워크플로 기본 해상도 사용)
  timeoutSec: 300,
  // 헤더 드롭다운의 「ComfyUI 로컬 / ComfyUI 클라우드」 전환용 — 각 모드의 주소를 따로 기억한다.
  //   전환 시 baseUrl 을 여기서 꺼내 쓰므로, 로컬 주소를 고쳐도 클라우드로 갔다 오면 그대로 유지됨.
  localBaseUrl: 'http://127.0.0.1:8188',
  cloudBaseUrl: 'https://cloud.comfy.org',
  // 클라우드 동시 생성 장수 — 한 장씩 순차 처리하면 업로드·폴링·다운로드 동안 GPU 가 놀아 장당 12~18초가 걸림
  //   (서버 실제 생성은 5~6초). 동시에 여러 장을 큐에 넣어 GPU 를 쉬지 않게 한다. 1 = 기존 순차(완전 동일 동작).
  //   ⚠ 로컬(cloud=false)은 VRAM 때문에 항상 1 로 강제 — 이 값은 클라우드에만 적용된다.
  //   ⚠ 4 로 두면 검정(빈) 이미지가 실측 12% 발생(순차 74장 0개 / 동시4 24장 3개) → 기본 2 로 낮춤.
  //      검정이 나와도 main 의 복구 패스가 순차로 재생성하지만, 애초에 덜 나오는 게 낫다.
  concurrency: 2,
  servers: [],             // 저장된 서버 프로필 [{name, baseUrl, cloud, apiKey}] — 드롭다운으로 전환(comfy.org/RunPod 등)
  activeServer: '',        // 현재 선택된 서버 프로필 이름(표시용)
};

// ── 번들 워크플로 자동 등록 (설치폴더 기준, PC 무관 정합) — 비디오(comfy-video.js)와 동일 정책 ──
const COMFY_DIR = path.join(__dirname, '..', 'comfy');
const BUNDLED = [
  { name: 'Z-Image Turbo', file: 'image_z_image_turbo.json' },
  { name: 'Krea2 Turbo',   file: 'image_krea2_turbo_t2i (2).json' },
  // Krea2 Turbo 의 int4(convrot) 판 — 본체 모델만 다르고 CLIP·VAE·LoRA 는 동일.
  //   RTX 3060 실측(2026-08-26, 같은 프롬프트·seed): warm 13.5s vs int8 20.3s = 1.50배 빠름.
  //   ⚠ 그 서버에 krea2Int4Convrot_v10Turbo.safetensors 가 있어야 한다(없으면 사람 말 오류로 알려준다).
  { name: 'Krea2 int4 Turbo', file: 'image_krea2_int4_turbo.json' },
];
const DEFAULT_ACTIVE_FILE = 'image_z_image_turbo.json'; // 활성값이 비었거나 실재하지 않을 때 기본
function _ensureBundled(cfg) {
  const wfs = Array.isArray(cfg.workflows) ? cfg.workflows : [];
  const bundledNames = new Set(BUNDLED.map((b) => b.file.toLowerCase()));
  const customs = wfs.filter((w) => w && w.path && !bundledNames.has(path.basename(String(w.path)).toLowerCase()));
  const bundled = [];
  for (const b of BUNDLED) {
    const p = path.join(COMFY_DIR, b.file);
    if (fs.existsSync(p)) bundled.push({ name: b.name, path: p });
  }
  cfg.workflows = [...bundled, ...customs];
  const curBn = path.basename(String(cfg.workflowPath || '')).toLowerCase();
  const curBundled = bundled.find((w) => path.basename(w.path).toLowerCase() === curBn);
  if (curBundled) cfg.workflowPath = curBundled.path;
  else if (!cfg.workflowPath || !fs.existsSync(cfg.workflowPath)) {
    const def = bundled.find((w) => path.basename(w.path).toLowerCase() === DEFAULT_ACTIVE_FILE.toLowerCase()) || bundled[0];
    if (def) cfg.workflowPath = def.path;
  }
  // ── 동시 생성 장수 안전 상한 ──────────────────────────────────────────────
  // 🔴 이 값이 3 이상이면 클라우드가 **completed 로 보고하면서도 못 쓸 이미지**를 내보낸다(실측):
  //     · 검정  — 동시 4, 24장 중 3장 (2026-07-30)
  //     · 노이즈 — 동시 4, 203장 중 7장 (2026-08-19, [고전_0821]·[고전_0823])
  //   순차(74장)·동시 2 에서는 한 건도 없었다. 사용자가 설정을 만질 필요 없이 늘 안전한 값으로
  //   돌도록 **읽을 때마다 여기서 깎는다**(옛 설정파일에 4 가 저장돼 있어도 자동 교정된다).
  //   ⚠ 되돌리려면 이 상한만 올리면 된다 — 속도보다 안정이 우선이라는 판단(로이 2026-08-19).
  const MAX_CONC = 2;
  const c = parseInt(cfg.concurrency, 10);
  cfg.concurrency = Math.max(1, Math.min(MAX_CONC, Number.isFinite(c) ? c : MAX_CONC));
  return cfg;
}
function loadConfig() {
  let cfg = { ...DEFAULTS };
  try { if (fs.existsSync(CFG_PATH)) cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) }; } catch {}
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

// ── 네트워크 오류 판별·설명 ───────────────────────────────────────────────────
//  🔑 undici(node fetch)는 진짜 이유를 `e.cause` 에 숨기고 겉으론 **"fetch failed"** 만 준다.
//    그 한 줄로는 아무것도 알 수 없다(2026-08-19 로그에 그대로 남았다). 원인 코드까지 함께 남긴다.
//    같은 계열 사고가 v0.2.51·v0.2.84·v0.3.7 에 이어 반복되고 있다.
const _NET_CODES = {
  UND_ERR_CONNECT_TIMEOUT: '그 주소에 아무도 응답하지 않습니다(연결 시간초과)',
  ECONNREFUSED: '연결이 거부됐습니다(서버가 꺼져 있음)',
  ENOTFOUND: '주소를 찾을 수 없습니다(DNS)',
  ECONNRESET: '연결이 끊겼습니다',
  ETIMEDOUT: '시간초과',
  EAI_AGAIN: '이름 조회 실패(일시적 DNS 오류)',
  UND_ERR_SOCKET: '소켓이 끊겼습니다',
};
function _isNetErr(e) {
  const code = (e && e.cause && e.cause.code) || (e && e.code) || '';
  return !!_NET_CODES[code] || /fetch failed|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(String((e && e.message) || ''));
}
function _netMsg(e) {
  const msg = String((e && e.message) || e || '');
  const code = (e && e.cause && e.cause.code) || (e && e.code) || '';
  if (!code) return msg;
  const ko = _NET_CODES[code] || '';
  return `${msg} [${code}]${ko ? ' — ' + ko : ''}`;
}

// 이미지 출력에 기여하지 않는 가지를 그래프에서 걷어낸다.
//   🔑 왜 필요한가(2026-08-24 실측): Krea2 워크플로는 프롬프트를 `TextGenerate`(LLM 프롬프트 확장, Qwen3VL 4B)
//   로 부풀린 뒤 CLIP 에 넣는 체인을 갖고 있다. 그런데 우리는 `CLIPTextEncode.text` 를 **리터럴로 덮어쓰므로**
//   그 확장 결과는 **아무도 쓰지 않는다**. 그런데도 `PreviewAny`(출력 노드)가 그 가지를 붙들고 있어
//   ComfyUI 가 매 장 512토큰 자기회귀 생성을 돌린다 → **장당 약 14초(33%)가 순수 낭비**였다.
//   ⚠ 판정은 **이미지 출력 노드에서 역방향 도달 가능성**으로만 한다 — 노드 제목·클래스 이름 추측에 기대지 않는다
//     (실측: 이 워크플로의 스위치 제목은 `Boolean (Refine Prompt?)` 라 비디오 쪽 'prompt enhance' 정규식에 안 걸린다).
//   ⚠ 이미지 출력 노드를 하나도 못 찾으면 **아무것도 건드리지 않는다**(fail-open — 낯선 워크플로를 망치지 않는다).
function pruneToImageOutputs(graph) {
  const ids = Object.keys(graph);
  const isImageOut = (id) => /^(SaveImage|PreviewImage|SaveImageWebsocket|SaveAnimatedWEBP|SaveAnimatedPNG)/i
    .test(String(graph[id].class_type || ''));
  const roots = ids.filter(isImageOut);
  if (!roots.length) return { removed: [], summary: '', skipped: 'no-image-output' };
  // 역방향 BFS — inputs 의 [nodeId, slot] 링크만 따라간다.
  const keep = new Set(roots);
  const queue = roots.slice();
  while (queue.length) {
    const cur = queue.shift();
    const inp = (graph[cur] && graph[cur].inputs) || {};
    for (const k of Object.keys(inp)) {
      const v = inp[k];
      if (Array.isArray(v) && typeof v[0] === 'string' && graph[v[0]] && !keep.has(v[0])) {
        keep.add(v[0]); queue.push(v[0]);
      }
    }
  }
  const removed = ids.filter((id) => !keep.has(id));
  const labels = removed.map((id) => String((graph[id] && graph[id].class_type) || id));
  for (const id of removed) delete graph[id];
  const head = labels.slice(0, 4).join(', ');
  const summary = labels.length > 4 ? head + ' 외 ' + (labels.length - 4) + '개' : head;
  return { removed, summary, kept: keep.size };
}

class ComfyImage {
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
    this.widthNodeId = cfg.widthNodeId || '';
    this.heightNodeId = cfg.heightNodeId || '';
    this.sendDims = cfg.sendDims !== false;
    this.preferFastQuant = cfg.preferFastQuant !== false;   // 이 GPU 에서 느린 fp8 판을 같은 모델의 빠른 판으로 (로컬 전용)
    this.timeoutSec = Number(cfg.timeoutSec) > 0 ? Number(cfg.timeoutSec) : 300;
    this.clientId = 'priming_' + Math.random().toString(36).slice(2, 10);
    this.log = logger;
  }
  _url(p) { return this.baseUrl + (this.cloud ? '/api' : '') + p; }
  _headers(extra = {}) { const h = { ...extra }; if (this.cloud && this.apiKey) h['X-API-Key'] = this.apiKey; return h; }
  async health() {
    if (this.cloud) { if (!this.apiKey) { this.log('[Comfy] ⚠ 클라우드 모드인데 API 키가 비었습니다.'); return false; } return true; }
    try { const r = await fetch(this._url('/system_stats'), { method: 'GET' }); return r.ok; } catch { return false; }
  }
  // 로컬 ComfyUI 상주 모델 언로드 + VRAM 해제(12GB OOM 방지 — 예: 비디오 Wan→이미지 전환). 클라우드는 불필요.
  async freeMemory() {
    if (this.cloud) return;
    try { await fetch(this._url('/free'), { method: 'POST', headers: this._headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ unload_models: true, free_memory: true }) }); } catch {}
  }
  _scanImage(outputs) {
    outputs = outputs || {};
    for (const nodeId of Object.keys(outputs)) {
      const o = outputs[nodeId] || {};
      for (const key of Object.keys(o)) {
        const arr = o[key];
        if (Array.isArray(arr)) { const m = arr.find((x) => x && /\.(png|jpe?g|webp)$/i.test(x.filename || '')); if (m) return m; }
      }
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
  _dims(aspect) {
    if (aspect === '16:9') return { w: 1344, h: 768 };
    if (aspect === '1:1') return { w: 1024, h: 1024 };
    return { w: 768, h: 1344 }; // 9:16
  }
  _buildWorkflow(positive, aspect) {
    let wf = JSON.parse(fs.readFileSync(this.workflowPath, 'utf8'));
    if (wf.nodes && !wf['1'] && typeof wf.nodes === 'object') throw new Error('UI 포맷 워크플로입니다. ComfyUI 에서 "저장(API 포맷)"으로 저장하세요.');
    const graph = JSON.parse(JSON.stringify(wf));
    let promptFixed = false;
    if (positive) {
      // CLIPTextEncode 계열(FLUX/Krea 포함) 우선 → 없으면 text 문자열 입력 가진 첫 노드(범용 폴백)
      const pId = this.promptNodeId
        || Object.keys(graph).find((id) => /CLIPTextEncode/i.test(graph[id].class_type || '') && 'text' in (graph[id].inputs || {}))
        || Object.keys(graph).find((id) => typeof (graph[id].inputs || {}).text === 'string');
      if (pId && graph[pId] && graph[pId].inputs) { graph[pId].inputs.text = String(positive); promptFixed = true; }
    }
    if (this.sendDims) {
      const dim = this._dims(aspect);
      const setNum = (id, keys, val) => { const inp = id && graph[id] && graph[id].inputs; if (!inp) return false; for (const k of keys) { if (k in inp) { inp[k] = val; return true; } } return false; };
      let wSet = setNum(this.widthNodeId, ['value', 'width'], dim.w);
      let hSet = setNum(this.heightNodeId, ['value', 'height'], dim.h);
      if (!wSet || !hSet) {
        for (const id of Object.keys(graph)) {
          const inp = graph[id].inputs || {};
          if (('width' in inp) && ('height' in inp)) { if (!wSet) inp.width = dim.w; if (!hSet) inp.height = dim.h; wSet = hSet = true; break; }
        }
      }
    }
    for (const id of Object.keys(graph)) {
      const inp = graph[id].inputs || {};
      const rnd = Math.floor(Math.random() * 1e15);
      if (typeof inp.seed === 'number') inp.seed = rnd;
      if (typeof inp.noise_seed === 'number') inp.noise_seed = rnd;
    }
    // 프롬프트를 우리가 직접 넣었을 때만 걷어낸다 — 안 넣었다면 확장 체인이 실제로 프롬프트를 만든다.
    if (promptFixed) {
      const pr = pruneToImageOutputs(graph);
      if (pr.removed.length) this.log('[Comfy] ✂ 이미지에 안 쓰이는 노드 ' + pr.removed.length + '개 건너뜀 (' + pr.summary + ') — 프롬프트는 앱이 직접 넣습니다');
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
        this.log(`[Comfy] 🔁 모델 자동 대체: ${c.from} → ${c.to} (${this.cloud ? '클라우드' : '로컬'} 에 앞의 판이 없음)`);
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
      const why = CM.explain(j.node_errors, this.cloud, 'image');
      const err = new Error(why || ('워크플로 노드 오류: ' + JSON.stringify(j.node_errors).slice(0, 300)));
      err.nodeErrors = j.node_errors;
      throw err;
    }
    return j.prompt_id;
  }
  async _waitCloud(promptId, abortSignal) {
    const deadline = Date.now() + this.timeoutSec * 1000;
    while (Date.now() < deadline) {
      if (abortSignal && abortSignal()) throw new Error('중단됨');
      await new Promise((res) => setTimeout(res, 800)); // 폴링 0.8초 — 2초였을 때 5초 작업을 6초에야 감지(장당 1~2초 낭비)
      let st;
      try {
        const r = await fetch(this._url(`/job/${promptId}/status`), { headers: this._headers() });
        if (r.status === 401 || r.status === 403) throw new Error('API 키 인증 실패 (401/403)');
        if (!r.ok) continue; st = await r.json();
      } catch (e) { if (/인증/.test(e.message)) throw e; continue; }
      const status = (st && (st.status || st.state) || '').toLowerCase();
      if (status === 'failed' || status === 'cancelled' || status === 'error') { const d = (st && st.error_message) ? String(st.error_message) : JSON.stringify(st); throw new Error(`클라우드 작업 ${status}: ${d.slice(0, 800)}`); }
      if (status === 'completed' || status === 'success') {
        const r2 = await fetch(this._url(`/jobs/${promptId}`), { headers: this._headers() });
        if (!r2.ok) throw new Error(`작업 상세 조회 실패 (${r2.status})`);
        const j = await r2.json();
        const img = this._scanImage(this._extractOutputs(j));
        if (img) return img;
        throw new Error('출력에서 이미지를 찾지 못했습니다: ' + JSON.stringify(j).slice(0, 300));
      }
    }
    throw new Error(`타임아웃 (${this.timeoutSec}초)`);
  }
  async _waitLocal(promptId, abortSignal) {
    const deadline = Date.now() + this.timeoutSec * 1000;
    while (Date.now() < deadline) {
      if (abortSignal && abortSignal()) { try { await fetch(this._url('/interrupt'), { method: 'POST', headers: this._headers() }); } catch {} throw new Error('중단됨'); }
      await new Promise((res) => setTimeout(res, 1000));
      let hist;
      try { const r = await fetch(this._url(`/history/${promptId}`)); if (!r.ok) continue; hist = await r.json(); } catch { continue; }
      const entry = hist && hist[promptId];
      if (!entry) continue;
      if (entry.status && entry.status.status_str === 'error') throw new Error('ComfyUI 실행 오류');
      const outputs = entry.outputs || {};
      const img = this._scanImage(outputs);
      if (img) return img;
      if (Object.keys(outputs).length) throw new Error('출력에 이미지가 없습니다 — SaveImage 노드를 확인하세요.');
    }
    throw new Error(`타임아웃 (${this.timeoutSec}초)`);
  }
  async _download(img, outputPath) {
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
    const r = await fetch(this._url('/view') + '?' + q.toString(), { headers: this._headers() });
    if (!r.ok) throw new Error(`/view 다운로드 실패 (${r.status})`);
    const ext = (/\.(jpe?g)$/i.test(img.filename) ? 'jpg' : /\.webp$/i.test(img.filename) ? 'webp' : 'png');
    const out = outputPath.replace(/\.(png|jpe?g|webp)$/i, '') + '.' + ext;
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    return out;
  }
  // 이 서버가 가진 모델 파일 목록을 **필요한 노드 종류만** 조회한다(세션당 1회 기억).
  //   🔑 클라우드 `/object_info` 전체는 수 MB 라 받지 않는다 — 노드 종류별 조회는 수 KB 다.
  async _modelLists(graph) {
    if (this._availMemo) return this._availMemo;
    const classes = new Set();
    for (const id of Object.keys(graph)) {
      const inp = graph[id].inputs || {};
      if (Object.values(inp).some((v) => typeof v === 'string' && /[.](safetensors|sft|ckpt|pt|pth|bin|gguf)$/i.test(v))) {
        if (graph[id].class_type) classes.add(graph[id].class_type);
      }
    }
    const avail = {};
    for (const c of classes) {
      try {
        const r = await fetch(this._url('/object_info/' + encodeURIComponent(c)), { headers: this._headers() });
        if (!r.ok) continue;
        const j = await r.json();
        const req = (((j || {})[c] || {}).input || {}).required || {};
        for (const k of Object.keys(req)) {
          const spec = req[k];
          if (Array.isArray(spec) && Array.isArray(spec[0]) && spec[0].length) avail[k] = spec[0];
        }
      } catch (_) { /* 조회 실패는 무시 — 아무것도 바꾸지 않는다 */ }
    }
    this._availMemo = avail;
    return avail;
  }
  // 이 GPU 이름(로컬 서버가 알려준다)을 한 번만 알아둔다.
  async _gpuName() {
    if (this._gpuNameMemo !== undefined) return this._gpuNameMemo;
    this._gpuNameMemo = null;
    try {
      const r = await fetch(this._url('/system_stats'), { headers: this._headers() });
      if (r.ok) { const j = await r.json(); const raw = ((j.devices || [])[0] || {}).name || '';
        // ComfyUI 는 'cuda:0 NVIDIA GeForce RTX 3060 : cudaMallocAsync' 처럼 준다 — 사람이 읽을 이름만 남긴다.
        this._gpuNameMemo = raw.replace(/^cuda:d+s*/i, '').replace(/s*:s*cudaw*s*$/i, '').trim() || null; }
    } catch (_) {}
    return this._gpuNameMemo;
  }
  /**
   * fp8 판을 이 GPU 에서 빠른 int8/convrot 판으로 바꾼다(로컬 전용).
   *   🔴 왜: fp8 파일이 로컬에 **있으면** 기존 자동 대체가 멈춘다 — 그런데 Ampere(3060)에서 fp8 은
   *   에뮬레이션이라 int8 보다 느리다. 실측 44.0초 → 25.4초(1.73배). 자세한 근거는 comfy-models.js 참조.
   *   ⚠ 판단은 세션당 1회. 정상 경로에 왕복을 더하지 않기 위해 **첫 장에서만** 조회한다.
   */
  async _preferFastQuant(graph) {
    if (this.cloud || this.preferFastQuant === false) return;
    const CM = require('./comfy-models');
    if (this._fastQuantMemo) {                      // 두 번째 장부터는 기억한 값만 적용(왕복 0)
      for (const nodeId of Object.keys(graph)) {
        const inp = (graph[nodeId] || {}).inputs || {};
        for (const input of Object.keys(inp)) {
          const to = this._fastQuantMemo[nodeId + '|' + input];
          if (to && typeof inp[input] === 'string') inp[input] = to;
        }
      }
      return;
    }
    const gpu = await this._gpuName();
    if (CM.isFp8NativeGpu(gpu) !== false) { this._fastQuantMemo = {}; return; }   // 네이티브·불명 → 손대지 않음
    const avail = await this._modelLists(graph);
    const r = CM.applyFasterQuant(graph, avail, gpu);
    this._fastQuantMemo = {};
    for (const c of r.changes) {
      this._fastQuantMemo[c.nodeId + '|' + c.input] = c.to;
      this.log(`[Comfy] ⚡ ${gpu} 는 fp8 을 하드웨어로 못 돌립니다 — 같은 모델의 빠른 판으로: ${c.from} → ${c.to}`);
    }
  }
  // 텍스트 → 이미지 1장. { success:true, imagePath } | { success:false, error }
  async textToImage({ prompt, aspect, outputPath, abortSignal }) {
    if (!this.workflowPath || !fs.existsSync(this.workflowPath)) return { success: false, error: '워크플로(API 포맷 JSON)가 지정되지 않았습니다 — ⚙ ComfyUI 에서 지정하세요.' };
    // ⚠ 일시적 네트워크 장애로 한 장이 통째로 실패하던 것을 막는다(2026-08-19 로그: `✗ G10 실패: fetch failed`
    //   — 같은 시각 서버는 정상이었다). 제출 전에 끊긴 경우가 대부분이라 재시도해도 크레딧이 이중으로 나가지 않는다.
    //   ⚠ 네트워크 오류에만 재시도한다. 워크플로·키·모더레이션 오류를 반복하면 시간만 버린다.
    let lastErr = '';
    for (let att = 1; att <= 2; att++) {
      if (abortSignal && abortSignal()) return { success: false, error: '중단됨' };
      try {
        if (!(await this.health())) throw new Error(`ComfyUI 연결 실패 (${this.baseUrl})${this.cloud ? ' — API 키/구독 확인' : ''}`);
        const graph = this._buildWorkflow(prompt, aspect);
        await this._preferFastQuant(graph);
        const promptId = await this._queueFixing(graph);
        const img = this.cloud ? await this._waitCloud(promptId, abortSignal) : await this._waitLocal(promptId, abortSignal);
        const out = await this._download(img, outputPath);
        return { success: true, imagePath: out };
      } catch (e) {
        lastErr = _netMsg(e);
        if (att >= 2 || !_isNetErr(e)) break;
        this.log(`  ↻ 네트워크 오류 — 5초 뒤 1회 재시도: ${lastErr}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    return { success: false, error: lastErr };
  }
}

module.exports = { ComfyImage, loadConfig, saveConfig, CFG_PATH, DEFAULTS, netMsg: _netMsg, pruneToImageOutputs };
