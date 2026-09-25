// 🎨 자막 서식(Vrew 자막 서식 창과 같은 기능) — 모델 · 효과 · ASS · 글꼴 · .vrew · MP4 · 화이트보드 (2026-09-25)
//   node test/caption-format.test.js
//   🔑 끝의 왕복은 **진짜 빌더로 .vrew 를 만들고 진짜 렌더러로 MP4 를 구워 화소를 잰다**(헛단언 방지).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const CF = require('../core/caption-format');
const CA = require('../core/caption-anim');
const CAS = require('../core/caption-ass');
const FONTS = require('../core/font-store');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const head = (t) => console.log('\n' + t);

head('[1] 서식 모델 — 채널 기본값 · 정리 규칙');
{
  const d = CF.normFmt(null);
  ok(d.font === 'Pretendard-Vrew_700' && d.fontColor === '#ffffff' && d.outlineOn && d.outlineWidth === 6 && !d.boxOn && !d.hlOn && !d.shadowOn && d.anim === null,
    '🔑 기본 = 지금까지의 모양(Pretendard 700 · 흰 글자 · 검정 테두리 6 · 효과 없음) — 안 건드린 채널은 결과가 그대로');
  const legacy = CF.normFmt({ fontColor: '#00ff00', bold: true, outlineOn: false, boxOn: true, boxColor: '#102030', boxOpacity: 50 });
  ok(legacy.fontColor === '#00ff00' && legacy.bold && legacy.outlineOn === false && legacy.boxOn && legacy.boxOpacity === 50, '옛 capLong(v0.5.28 자막 모양) 키가 그대로 읽힌다');
  ok(CF.normFmt({ outlineWidth: 99, letterSpacing: 5, shadowBlur: -3 }).outlineWidth === 20 && CF.normFmt({ letterSpacing: 5 }).letterSpacing === 0.8 && CF.normFmt({ shadowBlur: -3 }).shadowBlur === 0, '범위를 벗어나면 잘라낸다(Vrew 슬라이더 범위)');
  ok(CF.normFmt({ fontColor: 'red' }).fontColor === '#ffffff', '색 형식이 아니면 기본색');
  ok(CF.normPatch({ bold: true, nope: 1, fontColor: 'x' }).bold === true && !('nope' in CF.normPatch({ nope: 1 })) && !('fontColor' in CF.normPatch({ fontColor: 'x' })), '조각은 들어 있는 올바른 키만 남긴다');
  ok(CF.normAnim({ type: 'popping-in', duration: 900 }).type === 'popping-in' && CF.normAnim({ type: 'bogus' }) === null, '효과는 아는 이름만(모르면 효과 없음)');
  ok('anim' in CF.normPatch({ anim: null }) && CF.normPatch({ anim: null }).anim === null, '「효과 없음」(null)도 덮어쓰기로 남는다 — 채널 기본 효과를 그 줄만 끌 수 있다');
  ok(CF.ANIM_TYPES.size >= 70, `효과 목록 — Vrew 설치본의 전체 목록(${CF.ANIM_TYPES.size}종: 등장/퇴장 + 강조)`);
  ok(['typing', 'fade-in', 'roll-in', 'focus-in', 'flip-in-x', 'rotate-in', 'slide-in-right', 'popping-in', 'moving-in-up'].every((t) => CF.ANIM_INFO[t]), 'Vrew 애니메이션 창의 9가지(타이핑·페이드·굴러오기·다가오기·뒤집기·돌아오기·날아오기·팝·이동하기) 전부');
  ok(CF.animTypeFor('fade', 'OUT', 'UP') === 'fade-out-up' && CF.animTypeFor('pop', 'IN', 'LEFT') === 'popping-in-left' && CF.animTypeFor('fade', 'INOUT', 'NONE') === 'fade-in-out', '타이밍·방향 → 효과 이름');
}

head('[2] 조각(줄별·글자별 덮어쓰기)');
{
  const T = '저장한 샘플 파일을 보고';
  let sp = CF.applySpan([], T.length, 4, 6, { bold: true });
  ok(sp.length === 1 && sp[0].from === 4 && sp[0].to === 6 && sp[0].fmt.bold, '글자 범위에 서식');
  sp = CF.applySpan(sp, T.length, 0, T.length, { fontColor: '#ff0000' });
  ok(sp.length === 3 && sp[1].fmt.bold && sp[1].fmt.fontColor === '#ff0000' && !sp[0].fmt.bold, '겹치면 합쳐 겹치지 않는 구간으로 접는다');
  sp = CF.clearSpan(sp, T.length, 0, T.length, ['fontColor']);
  ok(sp.length === 1 && sp[0].fmt.bold && !sp[0].fmt.fontColor, '그 키만 지우기');
  ok(CF.clearSpan(sp, T.length, 0, T.length).length === 0, '전부 지우기 = 채널 기본으로');
  // 글이 바뀌어도 따라간다
  const moved = CF.remapSpans('저장한 샘플 파일을 보고', '저장했던 샘플 파일을 보고', [{ from: 4, to: 6, fmt: { bold: true } }]);
  ok(moved[0].from === 5 && moved[0].to === 7, `🔑 앞에 글자를 끼우면 서식이 뒤로 밀린다(샘플 그대로) (${moved[0].from}~${moved[0].to})`);
  const typo = CF.remapSpans('저장한 샘풀 파일을', '저장한 샘플 파일을', [{ from: 4, to: 6, fmt: { bold: true } }]);
  ok(typo.length === 1 && typo[0].from === 4 && typo[0].to === 6, '🔑 서식 안의 오타를 고쳐도 서식이 남는다');
  const multi = CF.remapSpansMulti(['첫 문장입니다.', '둘째 문장입니다.'], [[{ from: 0, to: 1, fmt: { bold: true } }], [{ from: 0, to: 2, fmt: { italic: true } }]], ['첫 문장입니다 둘째 문장입니다.']);
  ok(multi.length === 1 && multi[0].some((s) => s.fmt.bold && s.from === 0) && multi[0].some((s) => s.fmt.italic && s.from === 8), '두 문장을 합쳐도 각 서식이 제자리를 찾는다');
  const split = CF.remapSpansMulti(['앞 조각입니다 뒤 조각입니다'], [[{ from: 8, to: 9, fmt: { hlOn: true } }]], ['앞 조각입니다.', '뒤 조각입니다']);
  ok(split[0].length === 0 && split[1].length === 1 && split[1][0].from === 0, '나누면 서식이 뒤 문장으로 간다');
}

head('[3] 줄 범위 · 구간 · 줄 속성');
{
  const { splitCaptionLines } = require('../core/caption-splitter');
  const T = '그런데 그의 죄는, 임금의 사위를 잡아 문초한 것이었습니다.';
  const L = splitCaptionLines(T, 7);
  const R = CF.lineRanges(T, L);
  ok(R.length === L.length && R.every((r, i) => T.slice(r.from, r.to) === L[i]), '줄마다 문장 안의 글자 범위(글자 그대로)');
  ok(CF.lineRanges('가  나 다', ['가 나', '다']).every((r) => r.to > r.from), '공백이 달라도 줄 범위를 찾는다');
  const base = CF.normFmt({ size: 100 });
  const runs = CF.lineRuns(T, [{ from: 4, to: 6, fmt: { bold: true } }], R[0], base);
  ok(runs.length === 3 && runs[1].text === '그의' && runs[1].fmt.bold && runs[0].fmt.fontColor === '#ffffff', '줄 → 서식 구간(채널 기본 + 덮어쓰기)');
  const lp = CF.lineProps([{ from: 12, to: 14, fmt: { anim: { type: 'popping-in', duration: 900 }, boxOn: true } }], R[1], base, T.length);
  ok(lp.anim && lp.anim.type === 'popping-in' && lp.boxOn, '🔑 줄 일부만 골라 효과·배경을 줘도 그 줄 전체에 먹는다(줄 단위 속성)');
  ok(CF.lineProps([], R[0], { ...base, anim: { type: 'fade-in', duration: 500 } }, T.length).anim.type === 'fade-in', '덮어쓰기가 없으면 채널 기본 효과');
  ok(CF.lineProps([{ from: 0, to: 3, fmt: { anim: null } }], R[0], { ...base, anim: { type: 'fade-in', duration: 500 } }, T.length).anim === null, '「효과 없음」 덮어쓰기는 채널 기본 효과를 끈다');
}

head('[4] Vrew 형식 — 샘플.vrew(로이가 Vrew 에서 직접 만든 것)와 같은 필드');
{
  const f = CF.normFmt({ italic: true, underline: true, strike: true, bold: true, font: 'Kyobo Handwriting 2025-Vrew_400', hlOn: true, hlColor: '#fcc800', shadowOn: true, shadowColor: '#d9ec37', shadowBlur: 4, shadowOpacity: 50, letterSpacing: 0.34, outline2On: true, outline2Color: '#00a1d8', outline2Width: 5 });
  f.size = 150;
  const a = CF.fmtToVrewAttrs(f);
  ok(a.italic === 'true' && a.bold === 'true' && a.underline === 'true' && a.strike === 'true', '굵게·기울임·밑줄·취소선 = "true" 문자열(Vrew 저장 형식)');
  ok(a.font === 'Kyobo Handwriting 2025-Vrew_400' && a.size === '150', '글꼴 = 「가족-Vrew_굵기」 · 크기');
  ok(a['background-on'] === 'true' && a.background === '#fcc800', '형광펜 = background-on + background');
  ok(a['shadow-on'] === 'true' && a['shadow-color'] === '#d9ec37' && a['shadow-blur-radius'] === '4' && a['shadow-color-alpha'] === '0.5', '그림자 = shadow-on/-color/-blur-radius/-color-alpha');
  ok(a['letter-spacing'] === '0.34', '글자 간격 = letter-spacing');
  ok(a['secondary-outline-on'] === 'true' && a['secondary-outline-color'] === '#00a1d8' && a['secondary-outline-width'] === '5', '이중 테두리 = secondary-outline-*');
  const back = CF.vrewAttrsToFmt(a);
  ok(back.italic && back.hlOn && back.shadowOn && back.letterSpacing === 0.34 && back.outline2On && back.font === f.font, '되읽기(MP4 렌더러가 .vrew 를 읽을 때) 왕복');
  const delta = CF.lineToVrewDelta([{ text: '가나', fmt: f }], 1.54);
  ok(delta.length === 2 && delta[1].insert === '\n' && delta[1].attributes['line-height'] === '1.54', '줄 간격은 줄바꿈 op 에 붙는다(샘플과 같은 자리)');
  ok(CF.boxColorValue({ boxOn: true, boxColor: '#102030', boxOpacity: 50 }) === 'rgba(16, 32, 48, 0.5)' && CF.boxColorValue({ boxOn: false }) === 'rgba(0, 0, 0, 0)', '배경 상자 = --textbox-color');
  ok(JSON.stringify(CF.animToVrew({ type: 'fade-in', duration: 900, delay: 0 })) === '{"type":"fade-in","duration":900,"startDelay":0}', '효과 = assetEffectInfo {type, duration, startDelay}');

  const SAMPLE = path.join(ROOT, '샘플.vrew');
  if (fs.existsSync(SAMPLE)) {
    const AdmZip = require('adm-zip');
    const pj = JSON.parse(new AdmZip(SAMPLE).readAsText('project.json'));
    const clips = pj.transcript.clips.map((c) => c.captions[0]);
    const runsOf = (i) => CF.vrewDeltaToRuns(clips[i].text).runs;
    ok(runsOf(0)[0].fmt.italic, '샘플 1줄 기울임을 읽는다');
    ok(runsOf(1)[0].fmt.font === 'Kyobo Handwriting 2025-Vrew_400', '샘플 2줄 글꼴을 읽는다');
    ok(runsOf(2)[0].fmt.hlOn && runsOf(2)[0].fmt.hlColor === '#fcc800', '샘플 3줄 형광펜을 읽는다');
    ok(runsOf(3)[0].fmt.shadowOn && runsOf(3)[0].fmt.shadowBlur === 4, '샘플 4줄 그림자를 읽는다');
    ok(runsOf(4)[0].fmt.letterSpacing === 0.34 && CF.vrewDeltaToRuns(clips[4].text).lineHeight === 1.54, '샘플 5줄 간격(글자·줄)을 읽는다');
    ok(CF.animFromVrew(clips[6].style.assetEffectInfo).type === 'fade-in' && CF.animFromVrew(clips[7].style.assetEffectInfo).type === 'popping-in' && CF.animFromVrew(clips[8].style.assetEffectInfo).type === 'typing', '샘플 7~9줄 효과(페이드·팝·타이핑)를 읽는다');
    const r9 = runsOf(9);
    ok(r9.length === 4 && r9[1].text === '샘플' && r9[1].fmt.bold && r9[3].text === '보고' && r9[3].fmt.fontColor === '#0062fe', '🔑 샘플 10줄 — 단어 하나만 굵게·색(한 줄 안에 서식이 섞임)을 구간으로 읽는다');
    // 우리가 쓰는 형식이 샘플과 같은 키를 쓰는지(글자 속성 키 집합)
    const sampleKeys = new Set(clips.flatMap((c) => c.text.flatMap((o) => Object.keys(o.attributes || {}))));
    const ours = new Set(Object.keys(a));
    const unknown = [...ours].filter((k) => !sampleKeys.has(k) && !['underline', 'strike', 'secondary-outline-on', 'secondary-outline-color', 'secondary-outline-width', 'shadow-position-x', 'shadow-position-y', 'background-alpha'].includes(k));
    ok(unknown.length === 0, `우리가 쓰는 글자 속성 키가 샘플(또는 Vrew 설치본 목록)에 있는 것뿐 (${unknown.join(',') || '없음'})`);
  } else console.log('  (샘플.vrew 없음 — 이 절 건너뜀)');
}

head('[5] 효과 움직임 — Vrew CSS @keyframes 그대로');
{
  const s0 = CA.sampleState('popping-in', 0), s1 = CA.sampleState('popping-in', 1);
  ok(s0.op === 0 && Math.abs(s0.sx - 0.3) < 1e-9 && s1.op === 1 && s1.sx === 1, '팝: 0% 투명·0.3배 → 100% 원래 모양');
  const fu = CA.sampleState('fade-in-up', 0.5);
  // CSS 기본 타이밍 ease — 가운데(50%)에서 이미 약 80% 진행한다(cubic-bezier(.25,.1,.25,1))
  ok(fu.ty.u === '%' && Math.abs(fu.op - CA.EASE(0.5)) < 1e-9 && Math.abs(fu.ty.v - 100 * (1 - CA.EASE(0.5))) < 1e-6 && fu.op > 0.78 && fu.op < 0.82,
    `페이드 위로: 가운데에서 ease 곡선대로 올라오는 중 (${fu.ty.v.toFixed(1)}% · 불투명 ${fu.op.toFixed(2)})`);
  const mv = CA.sampleState('moving-in-left', 0.3);
  ok(mv.tx.u === 'vw' && mv.tx.v > 5 && mv.tx.v < 95, `🔑 100vw → 0 이동도 끊기지 않고 보간된다(단위가 다른 0) (${mv.tx.v.toFixed(1)}vw)`);
  const fx = CA.sampleState('flip-in-x', 1);
  ok(fx.rx === 0, '🔑 transform 은 한 속성 — 끝 키프레임이 perspective 만 적어도 회전은 0(CSS 규칙)');
  const td = CA.sampleState('tada-once', 0.35);
  ok(Math.abs(td.sx - 1.1) < 0.02, '「한 번」 강조는 반복 강조와 같은 움직임');
  const wIn = CA.animWindows({ type: 'popping-in', duration: 900, delay: 300 }, 10, 12);
  ok(wIn.windows.length === 1 && Math.abs(wIn.windows[0].t0 - 10.3) < 1e-9 && Math.abs(wIn.windows[0].t1 - 11.2) < 1e-9 && Math.abs(wIn.hiddenUntil - 10.3) < 1e-9, '등장: 지연만큼 기다렸다 재생 시간 동안');
  const wOut = CA.animWindows({ type: 'fade-out', duration: 900 }, 10, 12);
  ok(Math.abs(wOut.windows[0].t0 - 11.1) < 1e-9 && wOut.windows[0].t1 === 12, '퇴장: 줄 끝에 맞춰');
  const wLoop = CA.animWindows({ type: 'tada', duration: 900 }, 10, 12.5);
  ok(wLoop.windows.length === 3, '반복 강조: 줄이 떠 있는 동안 되풀이');
  const wShort = CA.animWindows({ type: 'popping-in', duration: 900 }, 0, 0.5);
  ok(wShort.windows[0].to < 1 && wShort.windows[0].t1 === 0.5, '줄이 효과보다 짧으면 도중에 끝난다(줄을 넘기지 않는다)');
}

head('[6] ASS — 층 · 효과 프레임 · 조각 자르기');
{
  const L = CAS.makeLayout({ W: 1920, H: 1080, hAlign: 'start', yAlign: 'bottom', marginL: 63, marginR: 63, marginV: 173, fontMap: { 'Pretendard-Vrew_700': 'PRM P' }, fallbackFamily: 'PRM P' });
  const base = CF.normFmt({ size: 100 }); base.size = 100;
  const st = CAS.cueEvents({ start: 1, end: 3, runs: [{ text: '가나다', fmt: base }], line: {} }, L);
  ok(st.length === 1 && st[0].layer === 4 && /\\an1\\pos\(63,907\)/.test(st[0].text) && !/\\fscx/.test(st[0].text), '🔑 멈춘 줄은 한 이벤트 · 기준점 = 여백 그대로(\\pos 63,907 = 옛 MarginL/MarginV 자리)');
  const hl = CAS.cueEvents({ start: 0, end: 1, runs: [{ text: '가', fmt: base }, { text: '나', fmt: { ...base, hlOn: true } }], line: { boxOn: true, boxColor: '#000000', boxOpacity: 60 } }, L);
  ok(hl.some((e) => e.layer === 0 && e.style === 'X') && hl.some((e) => e.layer === 1 && e.style === 'B') && hl.some((e) => e.layer === 4), '배경 상자(0·X) · 형광펜(1·B) · 글자(4) 층을 나눈다');
  ok(CAS.assStyles(L).some((s) => /^Style: X,.*,4,0,0,1,/.test(s)), '배경 상자 스타일은 BorderStyle 4(줄 전체에 하나 — 3 은 구간마다 쪼개져 이음매가 생긴다)');
  const sh = CAS.cueEvents({ start: 0, end: 1, runs: [{ text: '가', fmt: { ...base, shadowOn: true, shadowX: 4, shadowY: 4 } }], line: {} }, L);
  ok(sh.some((e) => e.layer === 2 && /\\pos\(67,911\)/.test(e.text)), '그림자 층은 그림자 방향만큼 옮겨 그린다');
  const an = CAS.cueEvents({ start: 0, end: 3, runs: [{ text: '가나다', fmt: base }], line: { anim: { type: 'popping-in', duration: 900 } } }, L);
  const frames = an.filter((e) => e.end <= 0.9 + 1e-9);
  ok(frames.length === 27 && an.filter((e) => e.start >= 0.9 - 1e-9).length === 1, `🔑 효과 구간은 프레임마다(0.9초 × 30 = ${frames.length}) · 끝나면 멈춘 이벤트 하나`);
  ok(/\\fscx3\d/.test(frames[0].text) && /\\org\(/.test(frames[0].text), '첫 프레임은 작게(0.3배) · 가운데 기준 회전점');
  const ty = CAS.cueEvents({ start: 0, end: 2, runs: [{ text: '가나다라', fmt: base }], line: { anim: { type: 'typing', duration: 1000 } } }, L);
  ok(ty.some((e) => e.end <= 0.1 && /\\1a&HFF&\\3a&HFF&\\4a&HFF&\}나다라/.test(e.text)), '타이핑: 처음엔 뒤 글자가 투명');
  const lines = CAS.formatEvents([{ layer: 4, start: 19.5, end: 21, style: 'C', text: 'x' }, { layer: 4, start: 25, end: 26, style: 'C', text: 'y' }], 20, 5);
  ok(lines.length === 1 && lines[0].startsWith('Dialogue: 4,0:00:00.00,0:00:01.00'), '🔑 조각 자르기 — 전체 시각 이벤트를 조각 기준으로 당기고 밖은 버린다(효과가 조각 경계에서 다시 시작하지 않게)');
}

head('[7] 글꼴 — Vrew 글꼴 찾기 · woff2 → ttf(파이썬 없이)');
{
  const list = FONTS.listFonts();
  ok(list.length >= 1 && list[0].vrewName === 'Pretendard-Vrew_700', `목록 맨 앞은 기본 글꼴 Pretendard 700 (전체 ${list.length}종)`);
  ok(list.every((f) => /-Vrew_\d{3}$/.test(f.vrewName)), 'Vrew 이름 = 「가족-Vrew_굵기」');
  const fr = FONTS.prepareFontsDir(['없는글꼴-Vrew_400'], fs.mkdtempSync(path.join(os.tmpdir(), 'cff-')));
  ok(fr.missing.includes('없는글꼴-Vrew_400') && fr.map['없는글꼴-Vrew_400'] === fr.fallback, '없는 글꼴은 기본 글꼴로 넘기고 알린다(렌더를 멈추지 않는다)');
  const vrewAssets = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'vrew', 'resources', 'static', 'assets');
  const w2 = fs.existsSync(vrewAssets) ? fs.readdirSync(vrewAssets).find((n) => /^Pretendard-Bold.*\.woff2$/.test(n)) : null;
  if (w2) {
    const FF = require('../core/media-utils').getFfmpegPath();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cff-font-'));
    fs.mkdirSync(path.join(tmp, 'a')); fs.mkdirSync(path.join(tmp, 'b'));
    fs.copyFileSync(path.join(ROOT, 'assets', 'fonts', 'Pretendard-Bold.ttf'), path.join(tmp, 'a', 'o.ttf'));
    fs.writeFileSync(path.join(tmp, 'b', 'w.ttf'), FONTS.convertFont(fs.readFileSync(path.join(vrewAssets, w2)), 'PRM WoffTest'));
    const ass = (fam) => `[Script Info]\nScriptType: v4.00+\nPlayResX: 800\nPlayResY: 160\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: A,${fam},64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,5,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:02.00,A,,0,0,0,,가나다 한글 ABC 123 삼국지!\n`;
    fs.writeFileSync(path.join(tmp, 'a.ass'), ass('Pretendard'));
    fs.writeFileSync(path.join(tmp, 'b.ass'), ass('PRM WoffTest'));
    for (const k of ['a', 'b']) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=800x160:d=1', '-vf', `subtitles=${k}.ass:fontsdir=${k}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', `${k}.raw`], { cwd: tmp });
    const A = fs.readFileSync(path.join(tmp, 'a.raw')), B = fs.readFileSync(path.join(tmp, 'b.raw'));
    let diff = 0, ink = 0;
    for (let i = 0; i < A.length; i++) { if (A[i] !== B[i]) diff++; if (A[i] > 200) ink++; }
    ok(ink > 2000 && diff === 0, `🔑 Vrew 의 woff2 에서 되살린 Pretendard 가 원본 ttf 와 화소 하나 다르지 않게 그려진다(글자 화소 ${ink} · 다른 화소 ${diff}) — WOFF2 glyf 복원이 맞다`);
    fs.rmSync(tmp, { recursive: true, force: true });
  } else console.log('  (Vrew 설치본 없음 — woff2 변환 비교 건너뜀)');
  ok(!/python|fonttools|spawn|execFile/.test(read('core/font-store.js').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')), '파이썬·외부 프로그램을 쓰지 않는다(아내 PC 에 없다 — Node brotli 만)');
}

head('[8] 화이트보드 — 서식 없는 줄은 예전과 똑같이, 덮어쓴 줄만 공용 생성기로');
{
  const WS = require('../core/whiteboard-subtitle');
  const scenes = [{ sentences: [{ text: '첫 문장입니다.', dur: 2 }, { text: '둘째 문장입니다.', dur: 2, spans: [{ from: 0, to: 2, fmt: { fontColor: '#ff0000', anim: { type: 'fade-in', duration: 500 } } }] }] }];
  const cues = WS.buildCues(scenes, { maxChars: 20 });
  ok(!cues[0].spans && cues[1].spans && cues[1].range, '덮어쓴 문장의 줄만 서식을 싣는다');
  const a = WS.buildAss(cues, { width: 1920, height: 1080 });
  ok(a.indexOf('Dialogue: 0,0:00:00.00,0:00:02.00,P,,0,0,0,,첫 문장입니다.') > -1, '🔑 서식 없는 줄은 옛 이벤트 그대로(한 글자도 다르지 않게)');
  ok(/Style: X,/.test(a) && /\\1c&H0000FF&/.test(a) && (a.match(/^Dialogue: 4,/gm) || []).length > 5, '덮어쓴 줄은 공용 생성기(빨간 글자 · 페이드 프레임)');
  const plain = WS.buildAss([{ start: 0, end: 1, text: '가' }], { width: 1920, height: 1080 });
  ok(!/Style: X,/.test(plain), '덮어쓴 줄이 없으면 스타일도 예전 그대로');
  ok(WS.scenesForSubtitle({ groups: [{ num: 1 }], getSentencesOfGroup: () => [{ num: 1, text: '가', ttsDurationSec: 1, capSpans: [{ from: 0, to: 1, fmt: { bold: true } }] }] }, [{ sentenceNums: [1] }])[0].sentences[0].spans.length === 1, '장면 문장에 서식이 실린다');
}

head('[9] 배선 — 저장·복원·편집·IPC·화면');
{
  const M = read('main.js');
  ok(/capSpans: \(s\.capSpans && s\.capSpans\.length\) \? s\.capSpans : null/.test(M), '작업본 저장에 문장 서식');
  ok(/if \(Array\.isArray\(ss\.capSpans\) && ss\.capSpans\.length\) s\.capSpans = ss\.capSpans;/.test(M), '작업본 이어받기에 문장 서식');
  ok(/ss\.text === s\.text\) s\.capSpans = ss\.capSpans/.test(M), '대본이 바뀌어도 글이 같은 문장은 서식을 되살린다');
  ok(/remapSpansMulti\(old\.map\(\(o\) => o\.text\)/.test(M) && /s\.capSpans = _spansMoved\[ti\]/.test(M), '🔑 문장 편집(수정·합치기·나누기) 때 서식을 새 글로 옮긴다');
  ok(/ipcMain\.handle\('set-caption-format'/.test(M) && /applySpan\(sen\.capSpans/.test(M) && /clearSpan\(sen\.capSpans/.test(M), 'IPC set-caption-format(얹기·지우기)');
  ok(/ipcMain\.handle\('list-caption-fonts'/.test(M) && /ipcMain\.handle\('caption-font-data'/.test(M) && /ipcMain\.handle\('add-caption-font'/.test(M) && /ipcMain\.handle\('set-saved-cap-formats'/.test(M), '글꼴·저장된 서식 IPC');
  const PL = read('preload.js');
  ok(['setCaptionFormat', 'listCaptionFonts', 'captionFontData', 'addCaptionFont', 'getSavedCapFormats', 'setSavedCapFormats'].every((k) => PL.includes(k + ':')), 'preload 에 전부 있다');
  ok(/spans: \(s\.capSpans && s\.capSpans\.length\)/.test(read('core/pipeline.js')), '화면 DTO 에 문장 서식');
  const VB = read('vrew/vrew-builder.js');
  ok(/CF\.lineRuns\(s\.text, s\.capSpans, rg, baseFmt\)/.test(VB) && /CF\.lineToVrewDelta\(runs, lp\.lineHeight\)/.test(VB) && /st\.assetEffectInfo = eff/.test(VB), '.vrew 빌더가 줄마다 구간·효과·배경을 쓴다');
  const VR = read('core/vrew-render.js');
  ok(/CF\.vrewDeltaToRuns\(cap\.text\)/.test(VR) && /FONTS\.prepareFontsDir\(CAS\.fontsUsed/.test(VR) && /ctx\.capEvents/.test(VR), 'MP4 렌더러가 구간·효과·글꼴을 읽는다');
  const APP = read('renderer/src/App.jsx');
  ok(/function capLookOf\(c\) \{\n  const o = CF\.normFmt\(c\);/.test(APP), '🔑 채널 편집의 읽기·저장 통로(capLookOf)가 서식 전체를 싣는다(안 실으면 저장할 때 사라진다)');
  ok(/fmt: l \};/.test(APP), '⚡ 만들기·💾 .vrew 가 채널 서식 전체(fmt)를 보낸다');
  ok(/<CaptionToolbar/.test(APP) && /<CaptionFormatPanel/.test(APP) && /<CaptionAnimPanel/.test(APP) && /onPickCapLine=\{pickCapLine\}/.test(APP), '목록 툴바·고급·효과 패널');
  ok(/renderStageLine\(el, runs, lp, d/.test(APP), '미리보기 재생이 서식·효과로 그린다');
  const CFJ = read('core/caption-format.js') + read('core/caption-anim.js') + read('core/caption-anim-data.js');
  ok(!/typeof require|require\.main/.test(CFJ), '렌더러 번들에 들어가는 core 모듈에 CJS 런타임 검사가 없다(v0.3.40 백지 사고)');
  const dist = fs.readdirSync(path.join(ROOT, 'renderer', 'dist', 'assets')).filter((n) => n.endsWith('.js')).map((n) => fs.readFileSync(path.join(ROOT, 'renderer', 'dist', 'assets', n), 'utf8')).join('');
  ok(/popping-in/.test(dist) && /cf-bar/.test(dist), '빌드된 화면에 반영돼 있다(소스만 고치고 빌드를 잊지 않았다)');
  const pkg = JSON.parse(read('package.json'));
  ok(!Object.keys(pkg.dependencies || {}).some((k) => /font|woff|brotli/i.test(k)), '의존성 추가 없음(라이트 업데이트 유지)');
  for (const f of ['core/caption-format.js', 'core/caption-anim.js', 'core/caption-ass.js', 'core/font-store.js', 'renderer/src/CaptionFormat.jsx']) {
    ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} 에 제어 문자 없음(셸 역슬래시 사고 방지)`);
  }
}

head('[10] 실제 왕복 — 빌더로 .vrew → Vrew 형식 확인 → 렌더러로 MP4 → 화소 측정');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const FF = require('../core/media-utils').getFfmpegPath();
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capfmt-'));
  try {
    const r = P.parseScriptText('# t\n## 장\n### 장면\n형광펜 칠한 단어가 보입니다.\n\n### 둘\n팝 효과로 나타나는 줄입니다.\n', 'longform', {});
    const pr = r.projects[0];
    const img = path.join(tmp, 'g.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x404040:s=1920x1080', '-frames:v', '1', img]);
    for (const g of pr.groups) g.imagePath = img;
    P.fillSilent(pr, path.join(tmp, 'tts'));
    const s1 = pr.sentences[0], s2 = pr.sentences[1];
    s1.capSpans = [{ from: 0, to: 3, fmt: { hlOn: true, hlColor: '#ffdd00', fontColor: '#000000', outlineOn: false } }];
    s2.capSpans = [{ from: 0, to: s2.text.length, fmt: { anim: { type: 'popping-in', duration: 900 } } }];
    const vrew = path.join(tmp, 'f.vrew');
    const cap = { size: '100', align: 'center', yAlign: 'bottom', yOffset: -0.125, fmt: CF.normFmt({ font: 'Pretendard-Vrew_700' }) };
    await P.buildProjectVrew(pr, vrew, { captionStyle: cap }, () => {}, 30, 1);
    const pj = JSON.parse(new (require('adm-zip'))(vrew).readAsText('project.json'));
    const caps = pj.transcript.clips.map((c) => c.captions[0]);
    ok(caps[0].text.length >= 3 && caps[0].text[0].attributes['background-on'] === 'true' && caps[0].text[0].insert === '형광펜', '.vrew: 첫 줄 앞 단어만 형광펜(한 줄 안에 구간 여럿 — 샘플 10줄과 같은 형식)');
    ok(caps[0].text[caps[0].text.length - 1].insert === '\n', '.vrew: 줄 끝 줄바꿈 op');
    ok(caps[1].style.assetEffectInfo && caps[1].style.assetEffectInfo.type === 'popping-in' && caps[1].style.assetEffectInfo.duration === 900, '.vrew: 둘째 줄 캡션 style 에 효과(assetEffectInfo)');
    ok(!caps[0].style.assetEffectInfo, '.vrew: 효과 없는 줄에는 효과 필드 없음');
    ok(pj.transcript.clips.every((c) => c.captions.length === 2), '.vrew: 캡션 두 칸(Vrew 형식) 유지');
    const tl = R.buildTimeline(pj, null);
    ok(tl.cues[0].runs.length >= 2 && tl.cues[0].runs[0].fmt.hlOn && tl.cues[1].line.anim.type === 'popping-in', 'MP4 렌더러가 .vrew 의 구간·효과를 읽는다');

    const mp4 = path.join(tmp, 'f.mp4');
    const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
    ok(res && res.ok, 'MP4 렌더 성공' + (res && !res.ok ? ': ' + res.error : ''));
    const t2 = tl.cues[1].start;
    const grab = (t) => execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'crop=1920:260:0:720', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
    const count = (raw, fn) => { let n = 0; for (let i = 0; i < raw.length; i += 3) if (fn(raw[i], raw[i + 1], raw[i + 2])) n++; return n; };
    const f1 = grab(Math.max(0.05, tl.cues[0].start + 0.3));
    const yellow = count(f1, (r_, g_, b_) => r_ > 200 && g_ > 180 && b_ < 90);
    ok(yellow > 2000 && yellow < 1920 * 260 * 0.4, `🔑 형광펜이 앞 단어에만 구워졌다 (노랑 ${yellow}px)`);
    const white = (raw) => count(raw, (r_, g_, b_) => r_ > 230 && g_ > 230 && b_ > 230);
    const early = white(grab(t2 + 0.06)), late = white(grab(t2 + 1.2));
    ok(late > 1500 && early < late * 0.6, `🔑 팝 효과: 줄 시작 직후엔 작게(흰 글자 ${early}px) → 끝난 뒤 원래 크기(${late}px)`);
    console.log(`   화소 — 형광펜 노랑 ${yellow} · 팝 시작 ${early} → 끝 ${late}`);
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} caption-format ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
