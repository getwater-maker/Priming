'use strict';
/**
 * node test/ai-subtitle-ui.smoke.js — 🌐 AI 자막 교정·번역 실제 화면 E2E(가짜 Claude 응답 — 진짜 API·충전금을 쓰지 않는다)
 *   교정: 제안 목록 → 체크한 것만 적용 → 문장 글이 바뀐다 · 키가 없으면 안내 · 번역: 언어 고르기 → 자막 폴더에 .srt(시각은 한국어와 같다)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TAG = `AI자막시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# AI자막 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장 입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');
// 가짜 Claude — main 프로세스에 심는다(PM_UI_SMOKE 일 때만 global.__claudeApiTest 를 읽는다)
const FAKE = () => {
  global.__claudeApiTest = {
    cfg: { key: 'sk-test-fake' },
    fetch: async (_url, opts) => {
      const body = JSON.parse(opts.body); const sys = String(body.system || ''); const txt = String(body.messages[0].content);
      const lines = txt.split('\n').filter((l) => /^\d+\t/.test(l)).map((l) => { const [n, ...r] = l.split('\t'); return { n: Number(n), t: r.join('\t') }; });
      let out;
      if (/교정자/.test(sys)) out = lines.filter((x) => x.t.includes('둘째 문장 입니다')).map((x) => ({ n: x.n, after: x.t.replace('둘째 문장 입니다', '둘째 문장입니다'), why: '띄어쓰기' }));
      else out = lines.map((x) => ({ n: x.n, t: 'EN-' + x.n }));
      const payload = { content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 10, output_tokens: 10 }, model: 'claude-sonnet-5-5', stop_reason: 'end_turn' };
      return { status: 200, text: async () => JSON.stringify(payload), headers: { get: () => null } };
    },
  };
};
(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const texts = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts.flatMap((c) => c.sentences || []).map((s) => s.text); });
    await win.click('.menus button[data-menu="caption"]'); await win.waitForTimeout(250);

    console.log('\n[1] 키가 없으면 알려 준다(가짜를 심기 전)');
    await win.click('[data-testid="rb-ai-proof"]');
    await win.waitForSelector('[data-testid="ai-proof-err"]', { timeout: 8000 });
    ok(/키/.test(await win.locator('[data-testid="ai-proof-err"]').innerText()), '키 없음 안내: ' + (await win.locator('[data-testid="ai-proof-err"]').innerText()).slice(0, 40));
    await win.click('[data-testid="ai-proof-close"]');

    console.log('\n[2] 교정 — 제안 → 적용');
    await app.evaluate(FAKE);
    await win.click('[data-testid="rb-ai-proof"]');
    await win.waitForSelector('[data-testid="ai-proof-item"]', { timeout: 8000 });
    ok(await win.locator('[data-testid="ai-proof-item"]').count() === 1 && /둘째 문장입니다/.test(await win.locator('[data-testid="ai-proof-item"]').innerText()), '제안 1개(둘째 문장 띄어쓰기)');
    ok((await texts()).some((t) => t.includes('둘째 문장 입니다')), '제안만 한 단계 — 아직 대본은 그대로');
    await win.click('[data-testid="ai-proof-apply"]'); await win.waitForTimeout(2000);
    const after = await texts();
    ok(after.some((t) => t.includes('둘째 문장입니다')) && !after.some((t) => t.includes('둘째 문장 입니다')), '적용하면 문장 글이 바뀐다');
    ok(/둘째 문장입니다/.test(fs.readFileSync(MD, 'utf8')), '대본(.md)에도 반영');
    await win.click('[data-testid="ai-proof-close"]');

    console.log('\n[3] 번역 — SRT');
    await win.click('[data-testid="rb-ai-translate"]');
    await win.waitForSelector('[data-testid="ai-tr-panel"]');
    await win.selectOption('[data-testid="ai-tr-lang"]', 'en');
    await win.click('[data-testid="ai-tr-run"]');
    await win.waitForSelector('[data-testid="ai-tr-done"]', { timeout: 15000 });
    const msg = await win.locator('[data-testid="ai-tr-done"]').innerText();
    const m = /([A-Za-z]:\\[^\n]*?\.srt)/.exec(msg);
    ok(!!m && fs.existsSync(m[1]) && /_en\.srt$/.test(m[1]), 'SRT 파일이 생겼다: ' + (m ? m[1].slice(-40) : msg.slice(0, 60)));
    const srt = m ? fs.readFileSync(m[1], 'utf8') : '';
    ok(/EN-1/.test(srt) && /EN-2/.test(srt) && /EN-3/.test(srt) && /\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}/.test(srt), '번역 글 3줄 + 시각');
    ok(!/첫 문장은/.test(srt), '번역 SRT 에 한국어 원문이 섞이지 않는다');
    ok(/첫 문장은 조금 길게 씁니다/.test(fs.readFileSync(MD, 'utf8')), '번역해도 대본(.md)은 그대로');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} } }
  console.log(fail ? `\n❌ ai-subtitle-ui ${pass}/${pass + fail}` : `\n✅ ai-subtitle-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
