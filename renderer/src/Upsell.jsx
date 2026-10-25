import React, { useEffect, useState } from 'react';

// 🛍 앱 안 교차 노출(v0.9.100 · 로이 2026-10-23) — 같은 계정으로 판매 중인 강의를 아직 안 들은 회원에게만 보여 준다.
//   서버 RPC priming_products 가 없거나 실패하면 아무것도 그리지 않는다(앱 사용을 방해하지 않는 안내) · 주소는 main 이 우리 도메인만 연다.
export default function Upsell({ title = '📚 이런 강의도 있어요', max = 3 }) {
  const [list, setList] = useState(null);
  useEffect(() => { let on = true; (async () => { try { const p = await window.api.licenseProducts(); if (on) setList(p ? p.courses.filter((c) => !c.owned).slice(0, max) : []); } catch (_) { if (on) setList([]); } })(); return () => { on = false; }; }, []);
  if (!list || !list.length) return null;
  return (
    <div className="upsell" data-testid="upsell">
      <b>{title}</b>
      {list.map((c) => (
        <button key={c.slug || c.url} className="upitem" data-testid="upsell-item" onClick={() => window.api.licenseOpenUrl(c.url)}>
          <span className="upt">{c.title}</span>
          {c.summary ? <span className="ups">{c.summary}</span> : null}
          <span className="upgo">자세히 보기 ›</span>
        </button>
      ))}
    </div>
  );
}
