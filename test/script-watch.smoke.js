'use strict';
/**
 * node test/script-watch.smoke.js — 🔁 밖에서 대본(.md)을 고치면 앱이 자동으로 다시 읽는다 (2026-09-25, v0.5.39)
 *   ① 밖에서 고침 → 몇 초 안에 메인 화면에 반영 + 로그 ② 앱 안에서 고친 것은 다시 읽기를 부르지 않는다
 *   ③ 안 바뀐 그룹의 그림은 그대로 ④ 📄 대본 보기가 열려 있으면 새로 그리고 알린다 ⑤ 옛 기준으로 보낸 수정은 거부(stale)
 * ⚠ 사용자 대본은 건드리지 않는다 — 임시 .md, 끝나면 지운다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const menu = require('./_menu');

const ROOT = path.join(__dirname, '..');
const TAG = `__대본감시테스트_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = [
  '# 대본 감시 테스트',
  '',
  '## 1장. 첫 장',
  '### 〔첫 장면〕',
  '> 🖼️ 이미지: a room',
  '처음 문장입니다.',
  '두 번째 문장입니다.',
  '',
  '### 〔둘째 장면〕',
  '> 🖼️ 이미지: a street',
  '둘째 그룹 문장입니다.',
  '',
].join('\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const cleanup = () => { for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch (_) {} } };
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };

(async () => {
  cleanup();
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const errs = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    const pickFile = (fp) => app.evaluate(({ dialog }, fp) => { dialog.showOpenDialog = async () => (fp ? { canceled: false, filePaths: [fp] } : { canceled: true, filePaths: [] }); }, fp);
    await pickFile(MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sblk', { timeout: 20000 });
    const logText = () => win.locator('#log').innerText();
    const reloads = async () => ((await logText()).match(/자동으로 다시 읽었습니다/g) || []).length;
    ok(!(await win.locator('button:has-text("대본 다시 읽기")').count()), '「🔄 대본 다시 읽기」 버튼은 없다(자동이라)');

    // 준비 — 둘째 그룹에 그림
    const dtoNow = async () => { await pickFile(null); return win.evaluate(() => window.api.attachAsset({ shortsNum: 1, groupNum: 1 })); };
    const d0 = await dtoNow();
    const g2 = d0.projects[0].cuts[1].num;
    await pickFile(path.join(ROOT, 'whiteboard', 'assets', 'drawing-hand.png'));
    await win.evaluate((g) => window.api.attachAsset({ shortsNum: 1, groupNum: g }), g2);
    await win.waitForTimeout(2500);   // 자동저장(스냅샷)까지

    // ① 밖에서 첫 그룹 문장을 고친다
    const r0 = await reloads();
    fs.writeFileSync(MD, SCRIPT.replace('두 번째 문장입니다.', '밖에서 고친 문장입니다.'), 'utf8');
    ok(await until(async () => /밖에서 고친 문장입니다/.test(await win.locator('body').innerText())), '① 밖에서 고치면 몇 초 안에 메인 화면에 반영');
    ok((await reloads()) === r0 + 1, '로그에 「자동으로 다시 읽었습니다」 한 번');
    // ③ 안 바뀐 둘째 그룹 그림은 그대로
    const d1 = await dtoNow();
    const c2 = d1.projects[0].cuts.find((c) => c.num === g2);
    ok(/drawing-hand\.png$/.test(String(c2 && c2.imagePath || '')), '③ 내용이 같은 다른 그룹의 그림은 그대로 복원');

    // ② 앱 안에서 고친 것은 다시 읽기를 부르지 않는다
    const r1 = await reloads();
    const e = await win.evaluate(() => window.api.editSentences({ shortsNum: 1, groupNum: 1, sentIdx: 0, count: 1, text: '앱에서 고친 문장입니다.', expect: ['처음 문장입니다.'] }));
    ok(e && e.ok, '(앱 안 수정 성공 · expect 일치)');
    await win.waitForTimeout(4500);
    ok((await reloads()) === r1, '② 앱 안 수정은 자동 다시 읽기를 부르지 않는다(해시를 바로 심음)');

    // ⑤ 옛 기준(expect 불일치)으로 보낸 수정은 거부
    const bad = await win.evaluate(() => window.api.editSentences({ shortsNum: 1, groupNum: 1, sentIdx: 0, count: 1, text: '덮으면 안 됨.', expect: ['이미 없는 옛 문장입니다.'] }));
    ok(bad && !bad.ok && bad.stale, '⑤ 바꾸려던 문장이 지금 대본과 다르면 거부(stale)');
    ok(!fs.readFileSync(MD, 'utf8').includes('덮으면 안 됨'), '⑤ 대본(.md)은 그대로');

    // ④ 📄 대본 보기가 열려 있을 때 밖에서 고치면 새로 그리고 알린다
    await menu(win, 'finish');
    await win.locator('.hgroup:has(.glabel:has-text("완성")) button:has-text("📄 대본 보기")').click();
    const R = win.locator('[data-testid="script-reader"]');
    await R.waitFor({ timeout: 5000 });
    const cur = fs.readFileSync(MD, 'utf8');
    fs.writeFileSync(MD, cur.replace('둘째 그룹 문장입니다.', '대본 보기 중에 밖에서 고침.'), 'utf8');
    ok(await until(async () => /대본 보기 중에 밖에서 고침/.test(await R.innerText())), '④ 열려 있는 대본 보기에도 바로 반영');
    ok(/밖에서 바뀌어 새로 읽었습니다/.test(await R.innerText()), '④ 대본 보기에 알림');
    ok(errs.length === 0, `화면 오류 0건 (${errs.slice(0, 2).join(' / ')})`);
  } finally {
    await app.close();
    cleanup();
  }
  console.log(`\n${fail ? '❌' : '✅'} 대본 자동 다시 읽기 E2E ${pass}/${pass + fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 실패:', e); cleanup(); process.exit(1); });
