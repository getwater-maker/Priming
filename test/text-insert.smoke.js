'use strict';
/**
 * node test/text-insert.smoke.js — 🅣 글 삽입(Lab · 기본 텍스트·디자인 텍스트) E2E
 *   [1] 순수 규칙(core/text-overlay) · [2] 실제 앱: 클립 고르기 → 글 적기 → 넣기 → 그림 위층(overlay)으로 들어감 · 그려진 PNG 에 글 화소 · Ctrl+Z
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const FF = require('../core/media-utils').getFfmpegPath();
const TX = require('../core/text-overlay');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

console.log('\n[1] 순수 규칙');
const meas = (s) => Array.from(s).length * 50;   // 글자 하나 50px
ok(TX.norm({ text: 'a', size: 9999, color: 'zz', pos: 'x' }).size === 200 && TX.norm({ color: 'zz' }).color === '#ffffff' && TX.norm({ pos: 'x' }).pos === 'bottom', '정규화(크기 자름 · 모르는 색·자리는 기본)');
ok(TX.norm({}, 'design').bold === true && TX.norm({}, 'design').box !== '' && TX.norm({}, 'basic').box === '', '기본·디자인 프리셋이 다르다');
ok(TX.wrapLines('가나다라마바', 150, meas).join('|') === '가나다|라마바', '폭으로 줄 나누기(3자 = 150px)');
ok(TX.wrapLines('가\n나', 9999, meas).join('|') === '가|나', '입력 줄바꿈은 지킨다');
ok(TX.layout(TX.norm({ text: '  ' }), meas) === null, '공백뿐이면 그릴 것이 없다(null)');
const lo = TX.layout(TX.norm({ text: '안녕하세요', pos: 'bottom', size: 72 }), meas);
const lt = TX.layout(TX.norm({ text: '안녕하세요', pos: 'top', size: 72 }), meas);
ok(lo.box.y > lt.box.y && lo.box.y + lo.box.h <= TX.H && lt.box.y >= 0 && lo.box.x >= 0 && lo.box.x + lo.box.w <= TX.W, '자리: 위 < 아래 · 캔버스 안에 든다');
ok(TX.fileNameOf('  안녕   하세요 / 반갑습니다 정말로  ').startsWith('텍스트_안녕 하세요') && !/[\\/:*?"<>|]/.test(TX.fileNameOf('a/b:c')), '파일 이름(금지 문자 없음)');
ok(!/require\(/.test(fs.readFileSync(path.join(ROOT, 'core', 'text-overlay.js'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), '🔑 렌더러 번들에 들어간다 — require 없음');

console.log('\n[2] 실제 앱');
(async () => {
  const TAG = `글삽입시험_${process.pid}`;
  const MD = path.join(os.tmpdir(), `${TAG}.md`);
  const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
  fs.writeFileSync(MD, ['# 글 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장입니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n'), 'utf8');
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow(); win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const ovs = () => win.evaluate(async () => { const r = await window.api.listQueue(); const p = r.dto.projects[0]; return (p.overlays || []).map((o) => ({ kind: o.kind, name: o.name, file: o.file })); });
    ok((await ovs()).length === 0, '처음엔 삽입 위층이 없다');
    await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(250);
    await win.locator('.sent[data-ln="1"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } });
    await win.waitForSelector('[data-testid="clip-ctx"]');
    ok(await win.locator('[data-testid="cx-text-ins"].soon').count() === 0, '우클릭 ▸ 텍스트 삽입은 준비 중이 아니다');
    await win.click('[data-testid="cx-text-ins"]');
    await win.waitForSelector('[data-testid="text-panel"]', { timeout: 3000 });
    ok(await win.locator('[data-testid="text-run"]').isDisabled(), '글이 비면 「넣기」는 못 누른다');
    await win.fill('[data-testid="text-input"]', '안녕하세요 글 삽입 시험입니다'); await win.waitForTimeout(300);
    const painted = await win.evaluate(() => { const c = document.querySelector('[data-testid="text-preview"]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++; return n; });
    ok(painted > 2000, `미리보기 캔버스에 글이 그려졌다(불투명 화소 ${painted})`);
    await win.click('[data-testid="text-run"]'); await win.waitForTimeout(2500);
    const o = await ovs();
    ok(o.length === 1 && o[0].kind === 'image' && /^텍스트_/.test(o[0].name), `그림 위층으로 들어갔다 ${JSON.stringify(o).slice(0, 120)}`);
    ok(await win.locator('[data-testid="text-panel"]').count() === 0, '넣은 뒤 패널이 닫힌다');
    // 저장된 PNG — 크기 1920x1080 · 글 화소(불투명) · 대부분 투명
    const f = o[0].file; const raw = execFileSync(FF, ['-loglevel', 'error', '-i', f, '-vf', 'scale=192:108,format=rgba', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
    let op = 0, tr = 0; for (let i = 3; i < raw.length; i += 4) { if (raw[i] > 40) op++; else if (raw[i] === 0) tr++; }
    ok(fs.existsSync(f) && op > 50 && tr > raw.length / 4 * 0.6, `PNG: 글 화소 ${op} · 투명 ${(tr / (raw.length / 4) * 100).toFixed(0)}%`);
    await win.keyboard.press('Control+z'); await win.waitForTimeout(600); await win.keyboard.press('Control+z'); await win.waitForTimeout(800);   // 넣기 = 「삽입」 + 「삽입 범위」 두 단계(➕ 삽입과 같다)
    ok((await ovs()).length === 0, 'Ctrl+Z 두 번 → 삽입 전으로(➕ 삽입과 같은 두 단계)');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} } }
  console.log(fail ? `\n❌ text-insert ${pass}/${pass + fail}` : `\n✅ text-insert ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
