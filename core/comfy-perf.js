'use strict';
/**
 * core/comfy-perf.js — 로컬 ComfyUI 가 **느려질 조건**을 생성 전에 찾아내 사람 말로 알린다.
 *
 * 🔴 왜 만들었나(2026-08-24 실사고): 이미지 1장이 28초 → **498초(17.6배)** 로 느려지고 결국
 *   `✗ G1 실패: 타임아웃 (300초)` 가 났다. 원인은 앱도 GPU 도 아니었다 —
 *   **ComfyUI 서버가 두 벌 떠 있었다.** Comfy Desktop 창으로 인스턴스를 열자 8188 이 이미 점유돼
 *   그쪽이 **8189 로 밀리고**(portConflict:auto), 그 서버가 **RAM 12.4GB · VRAM 7.3GB 를 붙든 채
 *   큐는 비어 있었다**(= 놀면서 자원만 점유). 시스템 RAM 여유가 31.9GB 중 2.2GB 로 떨어지자
 *   Krea2(12.5GB staged)가 페이지파일로 스왑되며 스텝당 2.5초 → 27.6초가 됐다.
 *
 * 🔑 이 사고는 **로그를 한참 파봐야** 원인이 드러났다(앱 로그엔 "느리다"는 흔적조차 없다).
 *   그래서 다음엔 생성 직전에 앱이 먼저 말하게 한다 — 이 모듈이 하는 일 전부가 그것이다.
 * ⚠ 절대 막지 않는다. 경고만 한다(오판으로 작업을 멈추게 하는 것이 더 나쁘다).
 * ⚠ 로컬 주소일 때만 의미가 있다. 클라우드는 남의 GPU 라 이 진단이 무의미하다.
 */
const os = require('os');

// 우리 주소의 포트. 못 읽으면 8188(ComfyUI 기본).
function portOf(baseUrl) {
  const m = String(baseUrl || '').match(/:(\d{2,5})(?:\/|$)/);
  return m ? Number(m[1]) : 8188;
}

/**
 * 우리가 쓰는 포트 말고 **다른 포트에 떠 있는 ComfyUI** 를 찾는다.
 *   Comfy Desktop 은 포트가 겹치면 +1 씩 밀어가며 뜬다(실측: 8188 점유 → 8189).
 * @param opts.fetchFn 테스트에서 갈아끼운다(실제 네트워크를 타지 않기 위해).
 * @returns {Promise<Array<{port:number, vramFreeMB:number|null, ramFreeGB:number|null, version:string|null}>>}
 */
async function scanRivals(opts = {}) {
  const { baseUrl, span = 6, timeoutMs = 700, fetchFn = fetch } = opts;
  const ours = portOf(baseUrl);
  const ports = [];
  for (let p = ours + 1; p <= ours + span; p++) ports.push(p);
  const found = [];
  await Promise.all(ports.map(async (p) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchFn(`http://127.0.0.1:${p}/system_stats`, { signal: ctrl.signal });
      if (!r || !r.ok) return;
      const j = await r.json();
      if (!j || !j.system || !j.system.comfyui_version) return;   // ComfyUI 가 아니면 무시
      const d = (j.devices || [])[0] || {};
      found.push({
        port: p,
        version: j.system.comfyui_version || null,
        vramFreeMB: typeof d.vram_free === 'number' ? Math.round(d.vram_free / 1048576) : null,
        vramTotalMB: typeof d.vram_total === 'number' ? Math.round(d.vram_total / 1048576) : null,
        ramFreeGB: typeof j.system.ram_free === 'number' ? +(j.system.ram_free / 1073741824).toFixed(1) : null,
      });
    } catch (_) { /* 닫힌 포트 = 정상 */ } finally { clearTimeout(t); }
  }));
  found.sort((a, b) => a.port - b.port);
  return found;
}

// 시스템 RAM 여유(GB). 실측 기준선: 여유 2.2GB 에서 17.6배 느렸고, 16.8GB 에서 정상이었다.
const RAM_WARN_GB = 8;
function ramFreeGB(freeFn = os.freemem) { return +(freeFn() / 1073741824).toFixed(1); }

/**
 * 로컬 생성 직전 진단. 경고 문장 배열을 돌려주고, 호출자가 로그에 찍는다.
 * @returns {Promise<{warnings:string[], rivals:Array, ramFreeGB:number}>}
 */
async function diagnoseLocal(opts = {}) {
  const { baseUrl, fetchFn = fetch, freeFn = os.freemem, span = 6, timeoutMs = 700 } = opts;
  const warnings = [];
  const rivals = await scanRivals({ baseUrl, fetchFn, span, timeoutMs });
  const free = ramFreeGB(freeFn);
  if (rivals.length) {
    const list = rivals.map((r) => `:${r.port}` + (r.ramFreeGB != null ? '' : '')).join(' · ');
    warnings.push(
      `⚠ ComfyUI 가 두 벌 떠 있습니다 — 우리 서버(${portOf(baseUrl)}) 말고 ${list} 에도 있습니다.`
      + ` Comfy Desktop 창으로 인스턴스를 열면 포트가 밀려 이렇게 됩니다.`
      + ` 그 서버가 RAM·VRAM 을 붙들고 있으면 이미지가 **10배 이상 느려지고 타임아웃**으로 실패합니다`
      + ` — 로컬로 만들 거라면 그 창을 닫으세요.`
    );
  }
  if (free < RAM_WARN_GB) {
    warnings.push(
      `⚠ 시스템 RAM 여유가 ${free}GB 뿐입니다(${RAM_WARN_GB}GB 미만).`
      + ` 이미지 모델은 12GB 가까이를 RAM 에 올려두고 VRAM 으로 흘려보내므로,`
      + ` 여유가 없으면 디스크로 스왑되며 **장당 시간이 몇 배로** 늘어납니다.`
      + (rivals.length ? '' : ` 브라우저·다른 GPU 작업을 닫아 보세요.`)
    );
  }
  return { warnings, rivals, ramFreeGB: free };
}

module.exports = { scanRivals, diagnoseLocal, ramFreeGB, portOf, RAM_WARN_GB };
