'use strict';
/**
 * core/comfy-models.js — 워크플로가 요구하는 **모델 파일이 그 서버에 없을 때** 자동 보정.
 *
 * 왜 필요한가(2026-08-20 실사고): 번들 워크플로 `image_krea2_turbo_t2i` 는
 *   `krea2_turbo_fp8_scaled.safetensors` 를 요구하는데 **클라우드엔 있고 로컬엔 없다**
 *   (로컬은 같은 Krea2 Turbo 의 `krea2_turbo_int8_convrot.safetensors` 판). CLIP·VAE·LoRA 는 양쪽 다 있어
 *   **UNET 파일명 하나 때문에** 로컬 생성이 통째로 실패했다. 한 워크플로로 로컬·클라우드를 왕복하려면
 *   이 차이를 앱이 흡수해야 한다.
 *
 * 🔑 핵심 — **미리 물어보지 않는다.** ComfyUI 는 `/prompt` 400 응답의 `node_errors` 에
 *   `value_not_in_list` 와 함께 **그 서버가 가진 목록을 그대로 담아 준다.** 그래서
 *   정상일 때 추가 요청 0회, **실패했을 때만** 그 목록을 읽어 고치고 1회 재제출한다.
 *   (매 장 `/object_info` 를 받는 방식은 클라우드 응답이 수 MB 라 낭비다)
 *
 * 🔑 대체 규칙 — **정밀도·양자화 토큰만 떼고 나머지가 같을 때만** 바꾼다.
 *   `krea2_turbo_fp8_scaled` ↔ `krea2_turbo_int8_convrot` → 둘 다 `krea2 turbo` = 대체 OK.
 *   `z_image_turbo_bf16` ↔ `z_image_bf16` → `z image turbo` ≠ `z image` = **대체 안 함**(다른 모델).
 *   turbo·distilled·dev 같은 **모델 정체성 토큰은 절대 떼지 않는다.**
 */

// 파일명으로 보이는 값만 다룬다(위젯에 든 일반 문자열을 건드리면 안 된다)
const MODEL_EXT = /[.](safetensors|sft|ckpt|pt|pth|bin|gguf)$/i;
// 정밀도·양자화·형식 토큰 — 이것만 떼서 '같은 모델인가'를 본다
const PREC = /^(fp8|fp16|fp32|bf16|int8|int4|nvfp4|mxfp8|fp4|e4m3fn|e5m2|scaled|convrot|comfy|mixed|gguf|q[0-9]+([_ -]?[a-z0-9]+)?)$/i;
// 파일명 토큰 구분자(밑줄·공백·점·하이픈). 대시는 맨 뒤여야 범위로 해석되지 않는다.
const SEP = /[_ .-]+/;

function baseKey(name) {
  const noExt = String(name || '').replace(MODEL_EXT, '');
  const toks = noExt.split(SEP).filter(Boolean).filter((t) => !PREC.test(t));
  return toks.join(' ').toLowerCase();
}
function precToks(name) {
  return String(name || '').replace(MODEL_EXT, '').split(SEP).filter((t) => PREC.test(t)).map((t) => t.toLowerCase());
}

// 요구한 파일이 목록에 없을 때 대체본 고르기. 같은 모델이 없으면 null(=조용히 바꾸지 않는다).
function pickSubstitute(current, allowed) {
  if (!current || !Array.isArray(allowed) || !allowed.length) return null;
  if (allowed.includes(current)) return null;                 // 이미 맞음
  const key = baseKey(current);
  if (!key) return null;
  const cands = allowed.filter((a) => typeof a === 'string' && MODEL_EXT.test(a) && baseKey(a) === key);
  if (!cands.length) return null;
  const want = precToks(current);
  // 원래 정밀도와 겹치는 토큰이 많은 것 → 그다음 이름이 짧은 것(보통 표준판)
  cands.sort((a, b) => {
    const ov = (x) => precToks(x).filter((t) => want.includes(t)).length;
    return (ov(b) - ov(a)) || (a.length - b.length) || a.localeCompare(b);
  });
  return cands[0];
}

// /prompt 400 의 node_errors → [{ nodeId, input, current, allowed }]
function collectFixes(nodeErrors) {
  const out = [];
  if (!nodeErrors || typeof nodeErrors !== 'object') return out;
  for (const nodeId of Object.keys(nodeErrors)) {
    const errs = (nodeErrors[nodeId] && nodeErrors[nodeId].errors) || [];
    for (const e of errs) {
      if (String(e.type || '') !== 'value_not_in_list') continue;
      const info = e.extra_info || {};
      const input = info.input_name || '';
      let allowed = null;
      // 정석: extra_info.input_config[0] 이 허용 목록
      if (Array.isArray(info.input_config) && Array.isArray(info.input_config[0])) allowed = info.input_config[0];
      let current = info.received_value || '';
      // 폴백: details 문자열 — "unet_name: 'X' not in ['A', 'B']"
      const d = String(e.details || '');
      if (!current) { const m = /: *'([^']+)'/.exec(d); if (m) current = m[1]; }
      if (!allowed) {
        // 정규식 대신 문자열 자르기 — "… not in ['A', 'B']"
        const i0 = d.indexOf('not in [');
        if (i0 >= 0) allowed = d.slice(i0 + 8, d.lastIndexOf(']')).split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
      }
      if (!input || !current || !Array.isArray(allowed) || !allowed.length) continue;
      out.push({ nodeId, input, current, allowed });
    }
  }
  return out;
}

// 그래프의 해당 위젯을 대체본으로 바꾼다. 반환 { changes:[{nodeId,input,from,to}], unresolved:[fix…] }
function applyModelFixes(graph, nodeErrors) {
  const changes = [], unresolved = [];
  for (const f of collectFixes(nodeErrors)) {
    const node = graph && graph[f.nodeId];
    const sub = pickSubstitute(f.current, f.allowed);
    if (!sub || !node || !node.inputs || node.inputs[f.input] === undefined) { unresolved.push(f); continue; }
    node.inputs[f.input] = sub;
    changes.push({ nodeId: f.nodeId, input: f.input, from: f.current, to: sub });
  }
  return { changes, unresolved };
}

// 기억해 둔 대체를 **제출 전에** 미리 적용 — 두 번째 장부터는 헛왕복이 없다.
function applyRemembered(graph, memo) {
  let n = 0;
  if (!graph || !memo) return 0;
  for (const k of Object.keys(memo)) {
    const [nodeId, input] = k.split('|');
    const node = graph[nodeId];
    if (node && node.inputs && node.inputs[input] !== undefined && node.inputs[input] !== memo[k]) { node.inputs[input] = memo[k]; n++; }
  }
  return n;
}

// 대체본이 없을 때 사람이 읽을 수 있는 안내로 바꾼다(원문 JSON 은 잘려서 읽을 수 없었다).
function explain(nodeErrors, cloud, kind) {
  const fixes = collectFixes(nodeErrors);
  if (!fixes.length) return '';
  const where = cloud ? '클라우드(comfy.org)' : '로컬 ComfyUI';
  const hdr = kind === 'video' ? '③ 비디오' : '② 이미지';
  // 여러 건이면 첫 건만 보이고 나머지는 개수로 — 로그 한 줄이 화면을 넘기지 않게(LTX 를 로컬로 보내면 4건 난다).
  const f = fixes[0];
  const list = f.allowed.filter((a) => MODEL_EXT.test(String(a))).slice(0, 4).join(', ');
  const more = fixes.length > 1 ? ` (그 밖에 ${fixes.length - 1}개 모델도 없음: ${fixes.slice(1).map((x) => x.input).join(', ')})` : '';
  return `${where} 에 모델 '${f.current}' 가 없습니다 (${f.input}).${more} 그 서버에 있는 것: ${list || '(없음)'}`
    + ` → 헤더 「${hdr}」 드롭다운에서 ${cloud ? '🖥 로컬' : '☁ 클라우드'} 로 바꾸거나, 그 파일을 ${where} 에 설치하세요.`;
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 이 GPU 에서 **느린 양자화 판**을 같은 모델의 빠른 판으로 바꾼다 (2026-08-24).
 *
 * 🔴 실사고: 사용자가 `krea2_turbo_fp8_scaled.safetensors` 를 로컬에 내려받은 순간
 *   위의 자동 대체(`pickSubstitute`)가 **"파일이 있으니 대체 불필요"** 로 판단해 멈췄고,
 *   RTX 3060 에서 **에뮬레이션되는 fp8** 경로로 떨어져 이미지가 느려졌다.
 *   실측 A/B(같은 프롬프트·같은 워크플로, 3060): **fp8_scaled 44.0초 vs int8_convrot 25.4초 = 1.73배**.
 *   (ComfyUI 서버 로그가 근거를 그대로 찍는다 — `Native ops: … int8_tensorwise, convrot_w4a4`,
 *    `emulated ops: mxfp8, float8_e5m2, float8_e4m3fn, nvfp4`)
 *
 * 🔑 "파일이 있다 ≠ 이 GPU 에서 빠르다." fp8 텐서코어는 **Ada(RTX 40)/Blackwell(50)·H100 이상**만 있다.
 *   Ampere(30xx·A100) 이하에서는 fp8 이 소프트웨어 에뮬레이션이라 int8 보다 느리다.
 * ⚠ 판단은 **GPU 이름**으로 한다(ComfyUI 가 native/emulated 목록을 API 로 주지 않는다). 모르는 이름은
 *   **건드리지 않는다**(fail-open) — 잘못 바꾸면 "조용히 다른 모델로 그린다" 가 된다.
 * ⚠ 로컬에서만 쓴다. 클라우드 GPU 는 최신이라 fp8 이 오히려 빠르다.
 * ⚠ 되돌리려면: 워크플로에서 원하는 판을 직접 고르고 `preferFastQuant:false` 를 설정에 넣으면 된다.
 * ───────────────────────────────────────────────────────────────────────────── */

// fp8 을 하드웨어로 처리하는 GPU 인가. 모르면 null(= 손대지 않는다).
function isFp8NativeGpu(gpuName) {
  const s = String(gpuName || '').toLowerCase();
  if (!s) return null;
  // Ada / Blackwell / Hopper 계열 = fp8 네이티브
  if (/\brtx\s*(40|50)\d{2}\b/.test(s) || /\b(40|50)\d{2}\s*(ti|super)?\b/.test(s) && /rtx/.test(s)) return true;
  if (/\b(h100|h200|l40|l4|gh200|b100|b200|rtx\s*(pro\s*)?(4500|5000|6000)\s*(ada|blackwell))\b/.test(s)) return true;
  if (/\b(ada|blackwell|hopper)\b/.test(s)) return true;
  // Ampere 이하 = 에뮬레이션
  if (/\brtx\s*(20|30)\d{2}\b/.test(s) || /\b(a100|a10|a40|a6000|v100|t4|gtx)\b/.test(s)) return false;
  return null;   // 낯선 이름 — 판단 보류
}

const FP8_TOK = /^(fp8|mxfp8|e4m3fn|e5m2|nvfp4|fp4)$/i;      // 에뮬레이션되는 판
const FAST_TOK = /^(int8|int4|convrot)$/i;                   // Ampere 에서 네이티브

// 같은 모델의 더 빠른 판을 고른다. 바꿀 이유가 없으면 null.
function pickFasterQuant(current, allowed, gpuName) {
  if (!current || !Array.isArray(allowed) || !allowed.length) return null;
  if (isFp8NativeGpu(gpuName) !== false) return null;         // 네이티브거나 모르면 그대로
  const toks = precToks(current);
  if (!toks.some((t) => FP8_TOK.test(t))) return null;         // fp8 판이 아니면 볼 일 없다
  if (toks.some((t) => FAST_TOK.test(t))) return null;         // 이미 int8 계열이 섞여 있으면 손대지 않는다
  const key = baseKey(current);
  if (!key) return null;
  const cands = allowed.filter((a) => typeof a === 'string' && MODEL_EXT.test(a)
    && a !== current && baseKey(a) === key && precToks(a).some((t) => FAST_TOK.test(t)));
  if (!cands.length) return null;
  // convrot(가장 빠른 실측 판) 우선 → 그다음 이름 짧은 것
  cands.sort((a, b) => (/convrot/i.test(b) - /convrot/i.test(a)) || (a.length - b.length));
  return cands[0];
}

/**
 * 그래프의 모델 입력들을 이 GPU 에서 빠른 판으로 바꾼다.
 * @param available { [inputName]: string[] }  그 서버가 가진 파일 목록(예: { unet_name: [...] })
 * @returns {{changes: Array<{nodeId,input,from,to}>}}
 */
function applyFasterQuant(graph, available, gpuName) {
  const changes = [];
  if (!graph || !available || isFp8NativeGpu(gpuName) !== false) return { changes };
  for (const nodeId of Object.keys(graph)) {
    const inp = (graph[nodeId] || {}).inputs || {};
    for (const input of Object.keys(inp)) {
      const cur = inp[input];
      if (typeof cur !== 'string' || !MODEL_EXT.test(cur)) continue;
      const list = available[input];
      if (!Array.isArray(list) || !list.length) continue;
      const to = pickFasterQuant(cur, list, gpuName);
      if (to) { inp[input] = to; changes.push({ nodeId, input, from: cur, to }); }
    }
  }
  return { changes };
}

module.exports = { baseKey, precToks, pickSubstitute, collectFixes, applyModelFixes, applyRemembered, explain, MODEL_EXT, isFp8NativeGpu, pickFasterQuant, applyFasterQuant };
