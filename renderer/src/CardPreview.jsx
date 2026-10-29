// 📜 화면 카드 ① 미리보기 — main(screen-card-preview)이 MP4 와 같은 좌표(core/screen-cards.layoutOf)로 준 판·글을 그대로 그린다.
//   🔑 배치를 여기서 다시 계산하지 않는다(MP4 와 어긋난다) — 좌표는 1920x1080 기준 그대로, 화면에선 cqw 로 줄인다(InfoPreview 와 같은 방식).
//   글꼴 = MP4 와 같은 글꼴(한자 · 한글 명조 · 일본어 명조)을 처음 필요할 때 하나씩 받아 쓴다. 받기 전·실패하면 명조 계열 기본 글꼴.
//   미리보기일 뿐이라 서서히 나타남은 없다(문장 단위로 켜고 끈다) · 글자 줄 높이는 브라우저와 ASS 가 조금 달라 미세한 차이가 있다.
import React, { useEffect, useState } from 'react';

const W = 1920, H = 1080;
const FAMILY = { han: 'PrimingCardHan', ko: 'PrimingCardKo', ja: 'PrimingCardJa' };
const FALLBACK = { han: '"Noto Serif CJK KR", "Batang", serif', ko: '"Noto Serif KR", "Batang", serif', ja: '"Noto Serif JP", "Yu Mincho", serif' };
const _fonts = {};   // key → Promise<boolean>
const _ok = {};
function loadCardFont(key) {
  if (_fonts[key]) return _fonts[key];
  _fonts[key] = (async () => {
    try {
      const r = window.api && window.api.cardFont ? await window.api.cardFont(key) : null;
      if (!r || !r.ok) return false;
      const bin = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
      const ff = new FontFace(FAMILY[key], bin.buffer);
      await ff.load(); document.fonts.add(ff); _ok[key] = true; return true;
    } catch (_) { return false; }
  })();
  return _fonts[key];
}
const familyOf = (key) => (_ok[key] ? `"${FAMILY[key]}", ${FALLBACK[key]}` : FALLBACK[key]);
const rgba = (c, op) => { const s = String(c); return `rgba(${parseInt(s.slice(0, 2), 16)},${parseInt(s.slice(2, 4), 16)},${parseInt(s.slice(4, 6), 16)},${Math.max(0, Math.min(1, op))})`; };
const px = (v) => (v / (W / 100)).toFixed(4) + 'cqw';
const RGB = { text: 'EAE0D0', plate: '0B0B0E', rule: '8C8C8C' };   // core/screen-cards.CARD_RGB 와 같다(번들 안에서 직접 import 하지 않는다 — 값만 같게)

export default function CardPreview({ cards }) {
  const [, tick] = useState(0);
  useEffect(() => {
    let dead = false;
    const need = new Set(); for (const c of cards || []) for (const r of (c.layout && c.layout.rows) || []) need.add(r.font);
    need.forEach((k) => { if (!_ok[k]) loadCardFont(k).then((ok) => { if (ok && !dead) tick((v) => v + 1); }); });
    return () => { dead = true; };
  }, [cards]);
  if (!cards || !cards.length) return null;
  return (
    <div className="stage-card" data-testid="stage-card" style={{ position: 'absolute', inset: 0, containerType: 'inline-size', overflow: 'hidden', pointerEvents: 'none', zIndex: 30 }}>
      {cards.map((c, ci) => {
        const L = c.layout; if (!L) return null;
        const P = L.plate;
        return (
          <div key={ci} data-testid={L.side ? 'card-side' : 'card-full'} data-label={c.label} data-place={c.place || ''} style={{ position: 'absolute', inset: 0 }}>
            <div data-testid="card-plate" style={{ position: 'absolute', left: (P.x / (W / 100)) + '%', top: (P.y / (H / 100)) + '%', width: (P.w / (W / 100)) + '%', height: (P.h / (H / 100)) + '%', background: rgba(RGB.plate, P.max) }} />
            {(L.rules || []).map((r, i) => (
              <div key={'r' + i} style={{ position: 'absolute', left: (r.x / (W / 100)) + '%', top: (r.y / (H / 100)) + '%', width: (r.w / (W / 100)) + '%', height: (2 / (H / 100)) + '%', background: rgba(RGB.rule, r.max) }} />
            ))}
            {(L.rows || []).map((o, i) => (
              <div key={'t' + i} data-testid="card-text" style={{ position: 'absolute', left: (o.cx / (W / 100)) + '%', top: (o.cy / (H / 100)) + '%', transform: 'translate(-50%,-50%)', textAlign: 'center', whiteSpace: o.nowrap ? 'pre' : 'pre-wrap', ...(o.nowrap ? {} : { width: (((W - 2 * (o.ml || 0)) / (W / 100))) + '%' }),   // 전체 화면 카드는 ASS 처럼 양쪽 여백 안에서 자동 줄바꿈
               
                fontFamily: familyOf(o.font), fontWeight: o.b ? 700 : 400, fontSize: px(o.fs), lineHeight: 1.3, letterSpacing: o.sp ? px(o.sp) : undefined, color: rgba(RGB.text, 1) }}>
                {o.lines.join('\n')}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
