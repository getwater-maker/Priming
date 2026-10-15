import { useEffect, useState } from 'react';

// 📊 진행 패널 자리(v0.9.31 · 로이 「다운로드 창 작업할 때 진행상황을 볼 수 있는 장치가 전혀 없다」)
//   만들기·MP4·업로드 팝업(61~63)은 오른쪽 아래 한 자리에 겹친다. 받기·STT·mp3 패널이 같은 자리(60·61)에 있으면
//   **제작 중엔 통째로 그 밑에 가려졌다**(2026-10-15 20:38 실사고 — MP4 굽는 중 받기 2편).
//   → 받기 쪽 패널은 제작 팝업이 떠 있으면 **그 위로** 올라간다(1초마다 높이를 다시 잰다 · 제작 팝업이 닫히면 내려온다).
const PROD_SEL = '[data-testid="make-progress"], [data-testid="mp4-progress"], [data-testid="yt-progress"]';
export const DL_Z = 64;   // 제작 팝업(61~63)보다 위 — 겹치더라도 받기 패널이 보인다

export function prodStackHeight() {
  let h = 0;
  for (const el of document.querySelectorAll(PROD_SEL)) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.width > 0) h = Math.max(h, Math.round(window.innerHeight - r.top - 16));
  }
  return h;
}

/** 받기 쪽 패널의 bottom(px) — 제작 팝업이 있으면 그 위로 · order = 받기 쪽 패널끼리의 순번(0 = 맨 아래) */
export function useDlDock(order = 0) {
  const [bottom, setBottom] = useState(16);
  useEffect(() => {
    let alive = true;
    const calc = () => {
      if (!alive) return;
      const prod = prodStackHeight();
      // 받기 쪽 패널끼리도 겹치지 않게 — 나보다 아래 순번 패널들의 높이를 더한다
      let below = 0;
      const mine = [...document.querySelectorAll('[data-dl-dock]')].filter((el) => Number(el.getAttribute('data-dl-dock')) < order);
      for (const el of mine) below += el.getBoundingClientRect().height + 10;
      setBottom(16 + (prod ? prod + 10 : 0) + below);
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [order]);
  return bottom;
}
