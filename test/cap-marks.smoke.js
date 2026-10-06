'use strict';
/**
 * node test/cap-marks.smoke.js — ✂🤖 대본을 열면 자막 끊어 읽기가 저절로(v0.7.23) · 실제 앱 E2E
 *   가짜 claude(test/fixtures/fake-claude.js · 쉼표 뒤·네 어절마다 끊는다) · 기억 파일은 임시 폴더.
 *   열자마자 규칙대로 보이다가 → 몇 초 뒤 Claude 자리로 줄이 바뀌는지, 다시 열면 claude 를 부르지 않는지 본다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const CS = require('../core/caption-splitter');

const ROOT = path.join(__dirname, '..');
const TAG = `__끊어읽기테스트_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'capmarks-e2e-'));
const MD = path.join(TMP, `[역사_9998] ${TAG}.md`);
const CACHE = path.join(TMP, 'cap-marks.json');
const CALLS = path.join(TMP, 'calls.log');
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `[역사_9998] ${TAG}.smproj.json`);
const S1 = '방앗간 마당으로 뛰어든 젊은 짐꾼은 등에 진 빈 지게가 기둥에 부딪혀 덜컹 소리를 내는데도 지게를 벗을 새도 없었습니다.';
const S2 = '늙은 소가 걸음을 멈추자 커다란 돌도 따라 멈췄고, 할멈은 그 모습을 한참 동안 말없이 바라보았어요.';
const SCRIPT = ['# 끊어 읽기 테스트', '', '## 1장', '', '> 🖼️ 이미지: a quiet mill.', S1 + ' ' + S2, ''].join('\n');

// 가짜 claude 와 같은 규칙(쉼표 뒤 · 네 어절마다)
const fakeMarks = (t) => { const ws = t.split(' '); const w = []; let cur = 0; ws.forEach((x, i) => { cur++; if ((/,$/.test(x) || cur === 4) && i < ws.length - 1) { w.push(i + 1); cur = 0; } }); return { t, w }; };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

async function launch() {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1', PM_CLAUDE_EXE: path.join(__dirname, 'fixtures', 'fake-claude.js'), PM_CAPMARKS_FILE: CACHE, FAKE_CLAUDE_CAPMARKS_LOG: CALLS } });
  const win = await app.firstWindow();
  await win.waitForSelector('h1', { timeout: 20000 });
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
  await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
  await win.waitForSelector('.sblk', { timeout: 20000 });
  return { app, win };
}
const rows = (win) => win.evaluate(() => [...document.querySelectorAll('.sent[data-ln]')].filter((e) => e.offsetParent !== null).map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const hasAll = (rs, lines) => lines.every((l) => rs.some((r) => r.includes(l)));

(async () => {
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const errs = [];
  const want = [S1, S2].flatMap((t) => CS.splitCaptionLines(t, 20, null, fakeMarks(t)));
  const rule = [S1, S2].flatMap((t) => CS.splitCaptionLines(t, 20));
  ok(want.join('|') !== rule.join('|'), `(판정력) 끊어 읽기 줄 ≠ 규칙 줄 (${want.join(' / ')})`);
  let A = await launch();
  try {
    A.win.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    console.log('[1] 처음 열기 — 규칙대로 보이다가 Claude 자리로');
    const r0 = await rows(A.win);
    ok(hasAll(r0, rule), '열자마자는 규칙 줄(기다리지 않는다)');
    let r1 = r0;
    for (let i = 0; i < 40 && !hasAll(r1, want); i++) { await A.win.waitForTimeout(500); r1 = await rows(A.win); }
    ok(hasAll(r1, want), `몇 초 뒤 Claude 자리로 줄이 바뀐다 (${r1.length}줄)`);
    ok(fs.existsSync(CACHE) && Object.keys(JSON.parse(fs.readFileSync(CACHE, 'utf8')).items).length === 2, '기억 파일에 2문장');
    ok(fs.readFileSync(CALLS, 'utf8').trim().split('\n').length === 1, 'claude 한 번');
    ok(errs.length === 0, `화면 오류 0건 (${errs.join(' | ')})`);
  } finally { await A.app.close().catch(() => {}); }

  console.log('[2] 다시 열기 — 기억에서 바로(0 토큰)');
  A = await launch();
  try {
    let r = await rows(A.win);
    for (let i = 0; i < 10 && !hasAll(r, want); i++) { await A.win.waitForTimeout(300); r = await rows(A.win); }
    ok(hasAll(r, want), '다시 열면 Claude 자리 그대로');
    await A.win.waitForTimeout(3500);
    ok(fs.readFileSync(CALLS, 'utf8').trim().split('\n').length === 1, 'claude 를 다시 부르지 않았다(여전히 한 번)');
  } finally { await A.app.close().catch(() => {}); }

  try { fs.rmSync(SNAP, { force: true }); } catch (_) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log(fail ? `\n❌ 끊어 읽기 E2E ${pass}/${pass + fail}` : `\n✅ 끊어 읽기 E2E ${pass}/${pass}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
