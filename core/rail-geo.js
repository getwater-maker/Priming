'use strict';
/**
 * rail-geo.js — ① ② 칸 옆 「그림 범위 선」(RailLayer) 재기 보조(v0.9.114 · 로이 2026-10-23 「화면 오류 React #185」)
 *   RailLayer 는 그린 뒤마다(useLayoutEffect) 그룹 위치를 재서 setGeo 한다. 음성을 만드는 중처럼 화면이 계속 바뀔 때
 *   잰 값이 1px 씩 흔들리거나 화면 근처 판정(near)이 번갈아 바뀌면 「재기 → 다시 그리기 → 재기」가 끝없이 돌아
 *   React 가 「최대 갱신 깊이 초과(#185)」로 이 영역을 통째로 지운다(TTS 컷 166 에서 실제로 났다).
 *   그래서 ① 1~2px 흔들림은 같은 값으로 본다(sameGeo) ② 한 프레임에 연달아 재는 횟수를 막는다(frameGuard).
 * 순수 함수 — 렌더러 번들에 들어간다(CJS 런타임 참조 금지).
 */

/** 두 측정 결과가 같은가 — 그룹 수·번호·범위가 같고 위치 숫자(top·bot·ownTop·ownBot·x)가 tol 화소 이내면 같다 */
function sameGeo(a, b, tol = 2) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = b[i];
    if (!p || !q) return false;
    for (const k of ['num', 'from', 'to', 'gs', 'ge']) if (p[k] !== q[k]) return false;
    if (p.has !== q.has || p.live !== q.live) return false;
    for (const k of ['top', 'bot', 'ownTop', 'ownBot', 'x']) if (Math.abs((p[k] || 0) - (q[k] || 0)) > tol) return false;
  }
  return true;
}

/**
 * 한 프레임(raf 한 번) 안에서 measure 를 max 번까지만 허용한다. 넘으면 allow() 가 false — 부르는 쪽은 다음 프레임에 한 번만 잰다.
 * raf/cancel 은 주입(시험·브라우저). → { allow(), reset() }
 */
function frameGuard(raf, max = 6) {
  let n = 0, pending = false;
  return {
    allow() {
      if (n >= max) return false;
      n++;
      if (!pending) { pending = true; raf(() => { pending = false; n = 0; }); }
      return true;
    },
    reset() { n = 0; },
  };
}

module.exports = { sameGeo, frameGuard };
