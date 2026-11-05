// 🎓 강의 HTML 굽기 카드(2.0 덧붙임4 ㊿ · v1.0.34) — 🎬 리모션 화면 안 · 관리자만(App 이 feat('lecture') 일 때만 그린다)
//   화면표(TSV) + 지금 강의 mp3 → HyperFrames(CSS 애니메이션 · GSAP 없음) → `<mp3 폴더>/<화면표 이름>_강의.mp4`
import React, { useEffect, useState } from 'react';

const api = window.api;

export default function LectureCard({ presetName, logline, hasTts }) {
  const [st, setSt] = useState(null);
  const [screen, setScreen] = useState(null);
  const [busy, setBusy] = useState('');
  const [prog, setProg] = useState(null);
  const refresh = async () => { try { const s = await api.lectureStatus(); setSt(s); if (s && s.screen) setScreen(s.screen); } catch (_) {} };
  useEffect(() => { refresh(); const off = api.onLectureProgress ? api.onLectureProgress((p) => setProg(p)) : null; return () => { if (typeof off === 'function') off(); }; }, []);

  const doSetup = async () => {
    if (!window.confirm('HyperFrames(강의 화면 굽는 도구)를 이 PC 의 저장소 밖 폴더에 설치합니다. 인터넷에서 받습니다(약 1~2분). 진행할까요?')) return;
    setBusy('setup');
    try { await api.lectureSetup(); } catch (e) { logline('✗ HyperFrames 설치 실패 — ' + (e.message || e)); }
    setBusy(''); refresh();
  };
  const doOpen = async () => {
    try { const r = await api.lectureOpenScreen(); if (r && r.ok) setScreen({ name: r.name, slides: r.slides, errors: r.errors }); } catch (e) { logline('✗ 화면표 열기 실패 — ' + (e.message || e)); }
  };
  const doRender = async () => {
    setBusy('render'); setProg(null);
    try { const r = await api.lectureRender({ presetName }); if (r && r.ok) logline('✅ 강의 MP4 — ' + r.out); } catch (e) { logline('✗ 강의 MP4 실패 — ' + (e.message || e)); }
    setBusy('');
  };

  const errs = (screen && screen.errors) || [];
  return (
    <div data-testid="lecture-card" style={{ marginTop: 8, padding: '6px 10px', border: '1px solid var(--border,var(--bd-dddddd,#ddd))', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <b title="관리자·개발 PC 전용 — 화면표(파일명·틀·내용)와 이 강의 mp3 로 강의 MP4 를 굽습니다. 틀: 제목 · 글머리 · 도식 · 코드 · 인용. 화면 길이는 그 줄 mp3 길이를 따릅니다.">🎓 강의 화면</b>
      {st && !st.installed && <button onClick={doSetup} disabled={!!busy}>{busy === 'setup' ? '설치 중…' : '⬇ HyperFrames 설치'}</button>}
      {st && st.installed && !st.nodeOk && <span className="meta" style={{ color: 'var(--fg-c0392b,#c0392b)' }}>Node 22 이상이 필요합니다</span>}
      <button className="ghost" onClick={doOpen} disabled={!!busy}>📄 화면표 열기</button>
      <button data-testid="lecture-render" onClick={doRender} disabled={!!busy || !screen || errs.length > 0 || !hasTts || !(st && st.installed && st.nodeOk)}
        title={hasTts ? '이 강의 mp3 폴더에 「<화면표 이름>_강의.mp4」 를 굽습니다' : '먼저 📄 대본 TSV 를 열고 🎤 mp3 를 만드세요'}>
        {busy === 'render' ? '굽는 중…' : '🎞 강의 MP4 굽기'}
      </button>
      {busy === 'render' && <button className="ghost" onClick={() => api.lectureAbort()}>⏹ 중단</button>}
      {screen && <span className="meta">{screen.name} · 화면 {screen.slides}장{errs.length ? ' · ⚠ 오류 ' + errs.length + '건' : ''}</span>}
      {busy === 'render' && prog && <span className="meta">{prog.pct != null ? prog.pct + '%' : ''}</span>}
      {st && st.installed && <span className="meta" title={st.dir}>HyperFrames {st.version}</span>}
      {errs.length > 0 && <div className="meta" style={{ flexBasis: '100%', color: 'var(--fg-c0392b,#c0392b)' }}>{errs.slice(0, 4).map((e) => e.line + '행: ' + e.message).join(' · ')}</div>}
    </div>
  );
}
