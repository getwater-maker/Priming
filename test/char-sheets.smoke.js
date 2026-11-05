'use strict';
// node test/char-sheets.smoke.js — 👤 캐릭터셋 보기(2.0 덧붙임4 ㊺ · v1.0.25) 실제 앱.
//   인물 카드 둘(알리사·제롬) · 장면 셋인 임시 대본을 열고 <출력>/characters/ 에 시트를 둔 뒤 —
//   ① 로그 상자에 👤 캐릭터셋 탭이 생긴다 ② 탭 = 인물마다 카드 · 그림이 실제로 디코딩 · 장면 수
//   ③ ① 칸 아래 얼굴 띠 = 지금 장면(G1 = 알리사) · 띠 그림 클릭 = 크게 보기
//   ④ 인물 카드 없는 대본 = 탭이 없다(지금 화면 그대로). 안전: 임시 채널·폴더만 · PM_UI_SMOKE.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'char-sheets-ui-'));
const CH = '__테스트채널_삭제해도됨_cs' + process.pid;
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = fs.readFileSync(path.join(ROOT, 'assets', 'icon-source.png'));

const P1 = path.join(TMP, '[테스트_1105] 인물 대본.md');
fs.writeFileSync(P1, ['# 인물 대본', '', '> 🎨 〔일관성 앵커〕 알리사 카드: a young woman of about 25 with short black hair (알리사). 제롬 카드: an old bearded man of about 60 (제롬).', '',
  '## 마당', '', '### 절 1', '> 🖼️ 이미지: close-up of a young woman with short black hair', '', '알리사가 문을 열었다.', '',
  '### 절 2', '> 🖼️ 이미지: medium shot of an old bearded man by the window', '', '제롬은 말이 없었다.', '',
  '### 절 3', '> 🖼️ 이미지: empty courtyard with trees', '', '바람이 불었다.', ''].join('\n'), 'utf8');
const P2 = path.join(TMP, '[테스트_1106] 카드 없는 대본.md');
fs.writeFileSync(P2, ['# 카드 없는 대본', '', '## 마당', '', '### 절 1', '> 🖼️ 이미지: a room', '', '첫 문장이다.', ''].join('\n'), 'utf8');

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false;
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await win.waitForSelector('h1', { timeout: 20000 });
    const add = await win.evaluate(async ({ name, dir }) => {
      try { try { await window.api.addPreset({ name }); } catch (_) {} await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); return 'ok'; } catch (e) { return e.message; }
    }, { name: CH, dir: TMP });
    chMade = add === 'ok';
    ok(chMade, '임시 채널 생성: ' + add);
    const open = async (p) => {
      await app.evaluate(({ dialog }, fp) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] }); }, p);
      const r = await win.evaluate(async (name) => { const x = await window.api.openScript({ presetName: name }); return x && { dto: x.dto, outRoot: x.outRoot }; }, CH);
      await app.evaluate(({ BrowserWindow }, d) => { BrowserWindow.getAllWindows()[0].webContents.send('dto-update', d); }, r.dto);
      return r;
    };
    const r1 = await open(P1);
    ok(!!r1.outRoot, '대본 열기 · 출력 폴더: ' + r1.outRoot);
    const D = path.join(r1.outRoot, 'characters'); fs.mkdirSync(D, { recursive: true });
    fs.writeFileSync(path.join(D, '알리사.face.png'), PNG);
    fs.writeFileSync(path.join(D, '알리사.face.json'), JSON.stringify({ key: 'x', name: '알리사' }));
    fs.writeFileSync(path.join(D, '제롬.png'), PNG);

    // ① 탭이 생긴다 → ② 누르면 다시 읽어 인물 카드
    await win.waitForSelector('[data-testid="logtab-chars"]', { timeout: 15000 });
    ok(true, '① 👤 캐릭터셋 탭이 생겼다');
    await win.click('[data-testid="logtab-chars"]');
    await win.waitForFunction(() => document.querySelectorAll('[data-testid="charcard"] .charimg img').length === 2, null, { timeout: 10000 });
    const tab = await win.evaluate(async () => {
      const imgs = [...document.querySelectorAll('[data-testid="charcard"] .charimg img')];
      await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
      return { cards: [...document.querySelectorAll('[data-testid="charcard"] .charhead b')].map((b) => b.textContent), decoded: imgs.filter((i) => i.naturalWidth > 0).length,
        cur: [...document.querySelectorAll('[data-testid="charcard"].cur .charhead b')].map((b) => b.textContent), meta: [...document.querySelectorAll('[data-testid="charcard"] .charhead .meta')].map((m) => m.textContent),
        log: getComputedStyle(document.querySelector('#log')).display, h: Math.round(document.querySelector('[data-testid="charset"]').getBoundingClientRect().height) };
    });
    ok(tab.cards.length === 2 && tab.decoded === 2, '② 인물 카드 2 · 그림 디코딩 2/2: ' + JSON.stringify(tab.cards));
    ok(tab.cur.join() === '👤 알리사' && tab.cards[0] === '👤 알리사', '② 지금 장면(G1)의 인물이 맨 앞 · 강조: ' + JSON.stringify(tab.cur));
    ok(tab.meta.every((m) => /장면 1개/.test(m)), '② 장면 수: ' + JSON.stringify(tab.meta));
    ok(tab.log === 'none' && tab.h > 40, '② 로그 글은 숨김 · 탭 칸 높이 ' + tab.h + 'px');

    // ③ 얼굴 띠(① 칸 아래 클립 정보 줄)
    await win.waitForSelector('[data-testid="char-strip"] img', { timeout: 10000 });
    const strip = await win.evaluate(() => { const s = document.querySelector('[data-testid="char-strip"]'); const im = s.querySelector('img'); const r = im.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { n: s.querySelectorAll('img').length, title: im.title, inInfo: !!s.closest('[data-testid="clipinfo"]'), hit: el === im, w: Math.round(r.width) }; });
    ok(strip.n === 1 && /알리사/.test(strip.title) && strip.inInfo, '③ 얼굴 띠 = G1 알리사 한 명(클립 정보 줄 안): ' + JSON.stringify(strip));
    ok(strip.hit && strip.w <= 32, '③ 띠 그림이 실제로 눌리는 자리 · 작게(' + strip.w + 'px)');
    await win.click('[data-testid="char-strip"] img');
    await win.waitForSelector('[data-testid="preview"] img', { timeout: 5000 });
    const pv = await win.evaluate(() => decodeURIComponent(document.querySelector('[data-testid="preview"] img').getAttribute('src') || ''));
    ok(/알리사\.face\.png/.test(pv), '③ 띠 클릭 = 크게 보기: ' + pv.split(/[\\/]/).pop());
    await win.keyboard.press('Escape');
    await sleep(300);

    // ④ 카드 없는 대본 → 탭 없음 · 띠 없음 · 썸네일 탭으로 돌아감
    await open(P2);
    await win.waitForFunction(() => !document.querySelector('[data-testid="logtab-chars"]'), null, { timeout: 10000 });
    const t2 = await win.evaluate(() => ({ strip: !!document.querySelector('[data-testid="char-strip"]'), thumbOn: /\bon\b/.test(document.querySelector('[data-testid="logtab-thumb"]').className) }));
    ok(!t2.strip && t2.thumbOn, '④ 카드 없는 대본 = 👤 탭 · 얼굴 띠 없음 · 🖼 탭: ' + JSON.stringify(t2));
    ok(errs.length === 0, '화면 오류 0건' + (errs.length ? ': ' + errs[0] : ''));
  } finally {
    try {
      if (chMade) { const w2 = await app.firstWindow(); await w2.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, CH); }
    } catch (_) {}
    await app.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 캐릭터셋 보기 E2E ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌ 실패:', e.message); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
