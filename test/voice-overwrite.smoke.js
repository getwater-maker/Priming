'use strict';
/**
 * node test/voice-overwrite.smoke.js — 🎙 음성 덮어쓰기(Lab) 실제 화면 E2E
 *   클립 하나 고르기 → 녹음 파일(톤 WAV)로 덮어쓰기 → DTO ow · 배지 · 길이 · 둘 이상 고르면 거부 · Ctrl+Z · 해제 · 새로고침 뒤 유지
 *   ⚠ 생성 서버를 부르지 않는다(녹음 파일은 시험이 ffmpeg 로 만든다)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TAG = `덮어쓰기시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 덮어쓰기 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-'));
  const rec = path.join(outDir, '내녹음.mp3');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3:sample_rate=44100', '-ac', '2', '-codec:a', 'libmp3lame', rec]);
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
    const owOf = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts.flatMap((c) => c.sentences || []).map((s) => (s.ow ? 1 : 0)); });
    const sel = async (...lns) => { await win.keyboard.press('Escape'); for (const ln of lns) await win.locator(`.sent[data-ln="${ln}"] .clip-chk`).first().click(); await win.waitForTimeout(250); };

    console.log('\n[1] 우클릭 · 효과 탭에서 열린다');
    await sel(1);
    await win.locator('.sent[data-ln="1"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } });
    await win.waitForSelector('[data-testid="clip-ctx"]');
    ok(await win.locator('[data-testid="cx-overwrite-voice"].soon').count() === 0 && await win.locator('[data-testid="cx-overwrite-voice"]').count() === 1 && await win.locator('[data-testid="cx-overwrite-clear"]').count() === 1, '우클릭 ▸ 음성 덮어쓰기 · 해제는 준비 중이 아니다');
    await win.keyboard.press('Escape');

    console.log('\n[2] 녹음으로 덮어쓰기(파일 고르기 창을 시험 파일로 바꿔 끼움)');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, rec);
    await sel(1);
    await win.click('.menus button[data-menu="home"]').catch(() => {});
    await win.locator('.sent[data-ln="1"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } });
    await win.waitForSelector('[data-testid="clip-ctx"]');
    await win.click('[data-testid="cx-overwrite-voice"]'); await win.waitForTimeout(2500);
    let ow = await owOf();
    ok(ow[0] === 1 && ow[1] === 0 && ow[2] === 0, `고른 문장(1번)만 덮어씀 ${JSON.stringify(ow)}`);
    ok(await win.locator('[data-testid="clip-own"]').count() === 1, '클립에 🎙 배지');
    const dur = await win.evaluate(async () => { const r = await window.api.listQueue(); const s = r.dto.projects[0].cuts[0].sentences[0]; return s.dur != null ? s.dur : (s.ttsDurationSec != null ? s.ttsDurationSec : null); });
    ok(dur == null || Math.abs(dur - 3) < 0.3, `음성 길이 ≈ 3초(${dur})`);

    console.log('\n[3] 둘 이상 고르면 거부');
    const r2 = await win.evaluate(async () => window.api.clipVoiceOverwrite({ shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }, { groupNum: 1, sentIdx: 1 }], path: null }));
    ok(r2 && r2.ok === false && /하나씩/.test(r2.error || ''), `거부: ${r2 && r2.error}`);

    console.log('\n[4] Ctrl+Z · 해제 · 새로고침 유지');
    await win.evaluate(() => document.body.click()); await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);
    ok((await owOf())[0] === 0, 'Ctrl+Z → 덮어쓰기 전으로');
    await win.keyboard.press('Control+y').catch(() => {}); await win.waitForTimeout(800);
    if ((await owOf())[0] !== 1) { await sel(1); await win.evaluate(async (p) => window.api.clipVoiceOverwrite({ shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }], path: p }), rec); await win.waitForTimeout(1500); }
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(600);
    ok((await owOf())[0] === 1, '새로고침(작업본 이어받기) 뒤에도 유지');
    const r3 = await win.evaluate(async () => window.api.clipVoiceOverwrite({ shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }], clear: true }));
    ok(r3 && r3.ok && r3.cleared === 1 && (await owOf())[0] === 0, '해제 → 덮어쓴 표시가 사라진다');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} } try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {} }
  console.log(fail ? `\n❌ voice-overwrite ${pass}/${pass + fail}` : `\n✅ voice-overwrite ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
