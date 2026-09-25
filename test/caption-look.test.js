// 🎨 자막 모양(글자색·굵게·테두리·배경 상자) — 채널 설정 → .vrew → 유튜브 MP4 (2026-09-24)
//   node test/caption-look.test.js
//   🔑 끝의 왕복은 **진짜 빌더로 .vrew 를 만들고 진짜 렌더러로 MP4 를 구워 화소를 잰다**(헛단언 방지).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// App.jsx 원문에서 헬퍼를 뽑아 실행(복사해 두면 앱과 갈라져도 통과한다)
const APP = read('renderer/src/App.jsx');
const cut = (start, end) => { const i = APP.indexOf(start); const j = APP.indexOf(end, i); return APP.slice(i, j); };
const helpers = cut('const CAP_LOOK_DEFAULT', 'function decomposeYOffset(');
// 2026-09-25 — 모양이 자막 서식(core/caption-format)으로 넓어졌다: 앱이 가져오는 CF 를 그대로 넣어 준다
const { CAP_LOOK_DEFAULT, capLookOf, capLookToStyle } = new Function('CF', helpers + '; return { CAP_LOOK_DEFAULT, capLookOf, capLookToStyle };')(require('../core/caption-format'));

console.log('\n[1] 저장값 정리');
ok(JSON.stringify(capLookOf(null)) === JSON.stringify(CAP_LOOK_DEFAULT), '없으면 기본 모양');
const d = capLookToStyle({});
ok(d.fontColor === '#ffffff' && d.outlineOn === true && d.outlineColor === '#000000' && d.outlineWidth === 6 && d.boxColor === null && d.bold === false,
  '🔑 기본값 = 지금까지의 모양(흰 글자 · 검정 테두리 6 · 배경 없음) — 안 건드린 채널은 결과가 그대로');
ok(capLookToStyle({ boxOn: true, boxColor: '#102030', boxOpacity: 50 }).boxColor === 'rgba(16, 32, 48, 0.5)', '배경 상자 → rgba');
ok(capLookOf({ outlineWidth: 99, boxOpacity: -5, fontColor: 'red' }).outlineWidth === 20 && capLookOf({ boxOpacity: -5 }).boxOpacity === 0, '범위를 벗어나면 잘라낸다');
ok(capLookOf({ fontColor: 'red' }).fontColor === '#ffffff', '색 형식이 아니면 기본색');
ok(capLookOf({ outlineOn: false }).outlineOn === false && capLookOf({}).outlineOn === true, '테두리는 명시적으로 끌 때만 꺼진다');

console.log('\n[2] 배선');
ok(/\.\.\.capLookOf\(saved\)/.test(APP), '채널편집 열 때 모양을 싣는다(안 실으면 저장 때 기본값으로 덮인다)');
ok(/yOffset: yOffsetOf\(c\), \.\.\.capLookOf\(c\)/.test(APP), '채널 저장 patch 에 모양');
ok(/\.\.\.capLookToStyle\(capLook\)/.test(APP) && /setCapLook\(capLookOf\(cap\)\)/.test(APP), '헤더 captionStyle(⚡ 만들기) 에 채널 모양');
ok(/글자색/.test(APP) && /테두리/.test(APP) && /불투명/.test(APP), '📝 자막 탭에 글자색·테두리·배경 줄');
const VB = read('vrew/vrew-builder.js');
ok(/'outline-on': 'false'/.test(VB) && /'outline-width': String/.test(VB) && /--textbox-color' && _userCap\.boxColor/.test(VB), 'vrew-builder 가 테두리 끄기·두께·배경 상자를 넣는다');

console.log('\n[3] 렌더러 자막 스타일');
const R = require('../core/vrew-render');
const capBox = { style: { yAlign: 'bottom', yOffset: -0.125, width: 0.96, customAttributes: [{ attributeName: '--textbox-align', value: 'center' }, { attributeName: '--textbox-color', value: 'rgba(255, 0, 0, 1)' }] }, attrs: { size: '100', color: '#00ff00', 'outline-on': 'false' } };
const cs = R.captionAssStyle(capBox, 'Pretendard');
ok(cs.box === '&H000000FF' && cs.outline === 0 && cs.color === '&H0000FF00', `상자 색·테두리 끔·글자색 (${cs.box} · ${cs.outline} · ${cs.color})`);
const csNone = R.captionAssStyle({ style: { customAttributes: [{ attributeName: '--textbox-color', value: 'rgba(0, 0, 0, 0)' }] }, attrs: {} }, 'P');
ok(csNone.box === null, '투명(기본)이면 상자 없음');
const ass = R.buildAss([{ start: 0, end: 1, text: '가나다' }], [], cs);
ok(/Style: X,.*,4,\d+,0,/.test(ass) && /Dialogue: 0,.*,X,/.test(ass) && /Dialogue: 4,.*,C,/.test(ass), '🔑 상자 층(0 · BorderStyle 4 = 줄 전체에 하나)과 글자 층(4)을 나눈다(같은 층이면 libass 가 위아래로 밀어낸다)');
ok(!/,X,/.test(R.buildAss([{ start: 0, end: 1, text: '가' }], [], csNone)), '상자가 없으면 상자 층도 없다');

console.log('\n[4] 실제 왕복 — 빌더로 .vrew → 렌더러로 MP4 → 화소 측정');
const P = require('../core/pipeline');
const FF = require('../core/media-utils').getFfmpegPath();
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caplook-'));
  try {
    const r = P.parseScriptText('# t\n## 장\n### 장면\n가나다라마바사입니다.\n', 'longform', {});
    const pr = r.projects[0];
    const img = path.join(tmp, 'g.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=1920x1080', '-frames:v', '1', img]);
    pr.groups[0].imagePath = img;
    P.fillSilent(pr, path.join(tmp, 'tts'));
    async function roundTrip(name, look) {
      const vrew = path.join(tmp, name + '.vrew');
      const cap = { size: '100', align: 'center', yAlign: 'bottom', yOffset: -0.125, ...capLookToStyle(look) };
      await P.buildProjectVrew(pr, vrew, { captionStyle: cap }, () => {}, 20, 1);
      const mp4 = path.join(tmp, name + '.mp4');
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
      if (!res || !res.ok) throw new Error('렌더 실패: ' + (res && res.error));
      const raw = execFileSync(FF, ['-loglevel', 'error', '-ss', '1.0', '-i', mp4, '-frames:v', '1', '-vf', 'crop=1920:220:0:780', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
      let red = 0, green = 0, black = 0;
      for (let i = 0; i < raw.length; i += 3) {
        const R_ = raw[i], G_ = raw[i + 1], B_ = raw[i + 2];
        if (R_ > 180 && G_ < 80 && B_ < 80) red++;
        if (G_ > 180 && R_ < 90 && B_ < 90) green++;
        if (R_ < 40 && G_ < 40 && B_ < 40) black++;
      }
      return { red, green, black };
    }
    const base = await roundTrip('base', {});
    const look = await roundTrip('look', { fontColor: '#00ff00', outlineOn: false, boxOn: true, boxColor: '#ff0000', boxOpacity: 100 });
    console.log('   화소(자막 띠 1920x220)', JSON.stringify({ base, look }));
    ok(base.black > 300 && base.red < 50 && base.green < 50, '기본: 검정 테두리 · 빨강/초록 없음(지금까지와 같다)');
    ok(look.red > 5000, `🔑 배경 상자가 실제로 구워졌다 (빨강 ${look.red}px)`);
    ok(look.green > 300, `글자색이 바뀌었다 (초록 ${look.green}px)`);
    ok(look.black < base.black / 4, `테두리를 끄면 검정 테두리가 사라진다 (${base.black} → ${look.black})`);
    ok(look.red < 1920 * 220 * 0.5, '상자는 화면 전폭 띠가 아니라 글자 폭(fit-content)');
  } catch (e) { ok(false, '왕복 실패: ' + e.message); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} caption-look ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
