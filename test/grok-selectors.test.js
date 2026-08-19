/**
 * grok-selectors.test.js — Grok Imagine 엔진의 셀렉터 정책 + 본편 영상 판별 회귀 테스트
 *
 * 배경(2026-08-19): grok.com/imagine UI 개편으로 엔진이 통째로 깨졌다. 두 가지가 문제였다.
 *   ① 셀렉터가 클래스·위치(`div.flex.flex-wrap.items-center` + nth-child)에 매달려 있었다 → 매치 0개.
 *   ② 완성 판정이 "아무 <video> 나 ready 면 완성" 이라, 좌측 히스토리 썸네일(완성된 예전 영상)을
 *      집어 **엉뚱한 mp4** 를 내려받았다(실측 재현: 화면 '생성 중 13%' 인데 10.04초짜리 남의 영상).
 *
 * 🔑 이 테스트는 **grok-engine.js 원문에서 판정 로직을 뽑아 실행한다.**
 *    로직을 복사해 두면 엔진과 갈라져도 통과해 아무것도 못 지킨다(visual-defect.test.js 와 같은 원칙).
 *
 * 실행: node test/grok-selectors.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'grok-engine.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');
const { GROK_SELECTORS } = require(SRC_PATH);

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
}
function section(t) { console.log(`\n${t}`); }

// ────────────────────────────────────────────────────────────────────────────
section('1) 셀렉터 정책 — aria-label/role 만 쓰고 클래스·위치에 의존하지 않는다');

const ALL_SEL = Object.entries(GROK_SELECTORS);
// 옛 UI 에서 우리를 깨뜨린 앵커들. 다시 들어오면 즉시 실패시킨다.
const FORBIDDEN = [
  [/flex-wrap/, 'tailwind 클래스(flex-wrap)'],
  [/nth-child/, '위치 의존(nth-child)'],
  [/\.absolute\b/, 'tailwind 클래스(.absolute)'],
  [/data-radix-popper/, '라이브러리 내부 클래스(radix popper)'],
];
for (const [key, sel] of ALL_SEL) {
  for (const [re, why] of FORBIDDEN) {
    ok(!re.test(sel), `${key} 에 금지 앵커 없음 (${why})`, re.test(sel) ? sel : '');
  }
}

// 실측된 aria-label 이 실제로 셀렉터에 박혀 있는지
const MUST = [
  ['videoModeChip', /aria-label="비디오"/, '생성 모드 칩'],
  ['resGroup', /aria-label\*="해상도"/, '비디오 해상도 그룹'],
  ['durGroup', /aria-label\*="길이"/, '동영상 길이 그룹'],
  ['audioToggle', /Video audio/, '🔊 오디오 토글(신설)'],
  ['aspectChipTrigger', /aria-label="종횡비"/, '종횡비 트리거'],
  ['aspectMenuItem', /menuitemradio/, '비율 메뉴 항목 role'],
  ['submitButton', /button\[type="submit"\]/, '제출'],
  ['fileInput', /input\[type="file"\]/, '업로드 input'],
  ['promptInput', /role="textbox"/, '프롬프트(contenteditable)'],
  ['downloadButton', /다운로드/, '다운로드 버튼'],
];
for (const [key, re, label] of MUST) {
  ok(re.test(GROK_SELECTORS[key] || ''), `${key} = ${label}`, GROK_SELECTORS[key]);
}

section('2) 옛 셀렉터 키가 코드에 남아 있지 않다(참조하면 undefined → 조용한 실패)');
for (const dead of ['res480Chip', 'res720Chip', 'dur6sChip', 'dur10sChip',
                    'aspectMenu16x9', 'aspectMenu9x16', 'CHIPS_CONTAINER']) {
  ok(SRC.indexOf(dead) < 0, `${dead} 잔존 없음`);
}

section('3) 비율은 텍스트로 고른다(「Auto」가 생겨 메뉴가 6개가 됐다 → 위치로 고르면 한 칸 밀림)');
ok(/_aspText\s*=\s*_shorts\s*\?\s*'9:16'\s*:\s*'16:9'/.test(SRC), '쇼츠=9:16 / 롱폼=16:9 텍스트 매칭');
ok(/aspectMenuItem\}:has-text\(\$\{_aspText\}/.test(SRC.replace(/"/g, '')) ||
   SRC.indexOf('aspectMenuItem}:has-text("${_aspText}")') >= 0, '메뉴 항목을 has-text 로 선택');

section('4) 오디오를 끈다(기본 켜짐 → 안 끄면 TTS 와 소리가 겹친다)');
ok(/aria-pressed/.test(SRC) && /audioToggle/.test(SRC), '오디오 토글의 aria-pressed 를 보고 끈다');

// ────────────────────────────────────────────────────────────────────────────
section('5) _findMainVideo — 히스토리 썸네일을 본편으로 오인하지 않는다 (원문에서 추출 실행)');

// grok-engine.js 원문에서 page.evaluate 콜백을 그대로 뽑아 온다.
const mStart = SRC.indexOf('async _findMainVideo()');
if (mStart < 0) { console.log('  ✗ _findMainVideo 를 원문에서 못 찾음'); process.exit(1); }
const evalStart = SRC.indexOf('this.page.evaluate(() => {', mStart);
const bodyStart = SRC.indexOf('() => {', evalStart);
// 괄호 균형으로 콜백 끝을 찾는다
let depth = 0, end = -1;
for (let i = SRC.indexOf('{', bodyStart); i < SRC.length; i++) {
  if (SRC[i] === '{') depth++;
  else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const cbSrc = '() => ' + SRC.slice(SRC.indexOf('{', bodyStart), end);
ok(cbSrc.length > 300 && cbSrc.indexOf('closest') > 0, '콜백 추출 성공', `len=${cbSrc.length}`);

// 가짜 DOM — 실측 구조를 그대로 흉내낸다.
const POST = 'a2a5a262-877e-42ee-9eb6-9e168d8e557a';
const OTHER = 'b7f10c33-1111-4444-b33e-e45ed0a4f20c';
function vid({ post, inButton, ready = true, w = 720, h = 416, dur = 6.04, area = 324750, src = null }) {
  return {
    tagName: 'VIDEO',
    currentSrc: src !== null ? src : `https://assets.grok.com/users/u1/generated/${post}/generated_video.mp4?cache=1`,
    src: '',
    readyState: ready ? 4 : 0,
    duration: ready ? dur : NaN,
    videoWidth: w, videoHeight: h,
    closest: (sel) => (sel === 'button' && inButton ? { tag: 'BUTTON' } : null),
    getBoundingClientRect: () => ({ width: Math.sqrt(area), height: Math.sqrt(area) }),
  };
}
function run(pathname, videos, pctText) {
  const pctNodes = pctText
    ? [{ children: { length: 0 }, textContent: pctText }]
    : [];
  const document = {
    querySelectorAll: (sel) => (sel === 'video' ? videos : pctNodes),
  };
  const location = { pathname };
  // eslint-disable-next-line no-new-func
  const cb = new Function('document', 'location', `return (${cbSrc})();`);
  return cb(document, location);
}

// ① 사이드바만 있고 본편은 아직 없음(생성 중) → 완성으로 보지 않는다  ★이번 사고의 핵심
{
  const r = run(`/imagine/post/${POST}`, [
    vid({ post: OTHER, inButton: true, dur: 10.04, w: 736, h: 400, area: 2500 }),
    vid({ post: POST, inButton: true, area: 2500 }),          // 우리 post 이지만 썸네일
  ], '13%');
  ok(r.video === null, '생성 중(썸네일뿐)에는 완성으로 보지 않는다 — 엉뚱한 영상 다운로드 차단');
  ok(r.progress === '13%', '진행률 13% 를 읽는다');
}

// ② 본편이 등장 → 그걸 고른다
{
  const r = run(`/imagine/post/${POST}`, [
    vid({ post: OTHER, inButton: true, dur: 10.04, w: 736, h: 400, area: 2500 }),
    vid({ post: POST, inButton: true, area: 2500 }),
    vid({ post: POST, inButton: false }),                     // 본편(버튼 밖, 큼)
    vid({ post: POST, inButton: false, ready: false, src: '' }), // 빈 video 요소(실측에 존재)
  ], null);
  ok(r.video && r.video.ready === true, '본편을 완성으로 판정');
  ok(r.video && r.video.src.indexOf(POST) > 0, '고른 영상의 URL 에 post UUID 가 있다');
  ok(r.video && r.video.dur === 6.04 && r.video.w === 720, '치수·길이도 본편 것', JSON.stringify(r.video));
}

// ③ 다른 post 의 큰 영상이 버튼 밖에 있어도 채택하지 않는다(UUID 불일치)
{
  const r = run(`/imagine/post/${POST}`, [vid({ post: OTHER, inButton: false, dur: 10.04 })], null);
  ok(r.video === null, 'UUID 가 다르면 버튼 밖·ready 여도 거른다');
}

// ④ 결과 페이지가 아니면 fail-closed
{
  const r = run('/imagine', [vid({ post: OTHER, inButton: false })], null);
  ok(r.postId === '' && r.video === null, '결과 페이지가 아니면 아무것도 완성으로 보지 않는다');
}

// ⑤ ready 가 아닌 본편(로딩 중) → 대기
{
  const r = run(`/imagine/post/${POST}`, [vid({ post: POST, inButton: false, ready: false })], '88%');
  ok(r.video && r.video.ready === false, 'ready 아닌 본편은 완성이 아니다(계속 대기)');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} grok-selectors: ${pass} 통과 / ${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
