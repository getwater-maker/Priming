'use strict';
/**
 * node test/record.smoke.js — 🎤 내 목소리 녹음(v1.0.51 · 로이 2026-11-17 되살림)
 *   [0] 앞뒤 무음 자르기(quiet-trim.trimEdges) — 합성 소리로 판정력까지
 *   [1] 소스 배선
 *   [2] 실제 앱: 가짜 마이크(PM_UI_SMOKE 가 Chromium 스위치로 켠다) → 녹음 → 미리듣기 → 덮어쓰고 다음 클립 → 건너뛰기 → 마지막에서 닫힘 · 되돌리기
 *   [3] 녹음 파일(앞뒤 무음 있는 휴대폰 녹음 흉내)도 앞뒤가 잘린다
 *   ⚠ 진짜 마이크·허용 창을 쓰지 않는다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const QT = require('../core/quiet-trim');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const TAG = `녹음시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 녹음 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');

const R = 24000;
// [초, 사인 크기, 잡음 크기] 조각을 이어 PCM16 을 만든다(잡음은 고정 씨앗 — 결과가 매번 같다)
function mk(parts) {
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const a = [];
  for (const [sec, amp, noise] of parts) for (let i = 0; i < Math.round(sec * R); i++) a.push(Math.round(amp * Math.sin(i * 2 * Math.PI * 220 / R) + (rnd() - 0.5) * 2 * noise));
  return Int16Array.from(a);
}

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');

  console.log('\n[0] 앞뒤 무음 자르기');
  let t = QT.trimEdges(mk([[1, 0, 30], [1.5, 8000, 30], [0.6, 0, 30], [1, 8000, 30], [1.2, 0, 30]]), R);
  ok(t && Math.abs(t.pcm.length / R - 3.5) < 0.03, `조용한 방: 말 3.1초 + 앞 0.15 + 뒤 0.25 = 3.5초 (${t && (t.pcm.length / R).toFixed(2)}) · 사이 쉼 0.6초는 그대로`);
  t = QT.trimEdges(mk([[1, 0, 600], [1.5, 8000, 600], [0.6, 0, 600], [1, 8000, 600], [1.2, 0, 600]]), R);
  ok(t && Math.abs(t.pcm.length / R - 3.5) < 0.03, `잡음 있는 방도 같은 결과 (${t && (t.pcm.length / R).toFixed(2)})`);
  ok(QT.trimEdges(mk([[3, 8000, 30]]), R) === null, '빈 소리가 없으면 자르지 않는다');
  ok(QT.trimEdges(mk([[3, 0, 30]]), R) === null, '전부 빈 소리면 판단하지 않는다(자르지 않음)');
  t = QT.trimEdges(mk([[2, 0, 30], [0.02, 20000, 0], [1, 0, 30], [1, 8000, 30], [0.5, 0, 30]]), R);
  ok(t && Math.abs(t.pcm.length / R - 1.4) < 0.03, `딸깍(20ms)은 말로 치지 않는다 (${t && (t.pcm.length / R).toFixed(2)}초)`);
  t = QT.trimEdges(mk([[8, 0, 30], [0.5, 8000, 30], [1, 0, 30]]), R);
  ok(t && Math.abs(t.pcm.length / R - 0.9) < 0.03, `거의 빈 녹음 속 짧은 말도 찾는다 (${t && (t.pcm.length / R).toFixed(2)}초)`);
  ok(QT.trimEdges(mk([[1, 0, 3000], [1, 6000, 3000], [1, 0, 3000]]), R) === null, '잡음이 말과 15dB 안쪽이면 자르지 않는다(fail-safe)');

  console.log('\n[1] 소스 배선');
  const M = read('main.js'), PL = read('preload.js'), APP = read('renderer/src/App.jsx'), BS = read('bootstrap.js');
  ok(/ipcMain\.handle\('rec-save'/.test(M) && /recSave: \(args\)/.test(PL), 'IPC rec-save · preload');
  ok(/data-testid="rec-panel"/.test(APP) && /tid="cx-rec"/.test(APP) && /data-testid="rb-record"/.test(APP) && /data-testid="rb-v-record"/.test(APP) && /data-testid="rb-v-file"/.test(APP), '녹음 창 · 우클릭 · 편집 탭 · AI 목소리 탭 단추');
  ok(/use-fake-device-for-media-stream/.test(BS) && /if \(process\.env\.PM_UI_SMOKE\)/.test(BS.slice(BS.indexOf('use-fake-device') - 200, BS.indexOf('use-fake-device'))), '가짜 마이크 스위치는 E2E(PM_UI_SMOKE)일 때만');
  const OW = M.slice(M.indexOf("ipcMain.handle('clip-voice-overwrite'"), M.indexOf("ipcMain.handle('clip-denoise'"));
  ok(/QT\.trimEdges\(/.test(OW) && /args\.trim !== false/.test(OW), '덮어쓰기(파일·마이크 둘 다)는 앞뒤 무음을 자른다');

  console.log('\n[2] 실제 앱 — 마이크 녹음');
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  try {
    const win = await app.firstWindow(); win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const sents = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts.flatMap((c) => c.sentences || []).map((s) => ({ ow: s.ow ? 1 : 0, dur: s.dur != null ? s.dur : null })); });
    const sel = async (...lns) => { await win.keyboard.press('Escape'); for (const ln of lns) await win.locator(`.sent[data-ln="${ln}"] .clip-chk`).first().click(); await win.waitForTimeout(250); };
    const pick = async (ln) => { await win.keyboard.press('Escape'); await win.locator(`.sent[data-ln="${ln}"] .clip-r1`).first().click({ position: { x: 4, y: 4 } }); await win.waitForTimeout(250); };   // 한 번 클릭 = 그 클립만 고르기
    const REC_DIR = path.join(os.tmpdir(), 'priming-rec'); const recFiles = () => { try { return fs.readdirSync(REC_DIR).length; } catch { return 0; } };
    const ctx = async (ln) => { await win.locator(`.sent[data-ln="${ln}"] .clip-r1`).first().click({ button: 'right', position: { x: 4, y: 4 } }); await win.waitForSelector('[data-testid="clip-ctx"]'); };

    await sel(1, 2); await ctx(1); await win.click('[data-testid="cx-rec"]'); await win.waitForTimeout(400);
    ok(await win.locator('[data-testid="rec-panel"]').count() === 0, '클립을 둘 이상 고르면 창이 열리지 않는다(녹음 하나 = 문장 하나)');

    // AI 목소리 탭 「내 목소리 ▸ 녹음」으로 연다
    await pick(1); const recBefore = recFiles();
    await win.click('.menus button[data-menu="voice"]'); await win.waitForSelector('.ribbon[data-menu-on="voice"]');
    ok(await win.locator('[data-testid="rib-myvoice"]').count() === 1, 'AI 목소리 탭에 「내 목소리」 묶음');
    const over = await win.evaluate(() => { const r = document.querySelector('.ribbon'); return r ? r.scrollWidth - r.clientWidth : -1; });
    ok(over <= 1, `1366px 에서 AI 목소리 리본이 넘치지 않는다 (넘침 ${over}px)`);
    await win.click('[data-testid="rb-v-record"]'); await win.waitForSelector('[data-testid="rec-panel"]', { timeout: 3000 });
    const t1 = await win.locator('[data-testid="rec-text"]').innerText();
    ok(t1.includes('첫 문장은 조금 길게 씁니다'), '창에 읽을 문장 글이 보인다: ' + t1.slice(0, 40));
    ok(await win.locator('[data-testid="rec-apply-next"]').isDisabled() && await win.locator('[data-testid="rec-apply"]').isDisabled(), '녹음 전에는 덮어쓰기가 막혀 있다');

    // Space = 녹음 시작
    await win.keyboard.press('Space'); await win.waitForSelector('[data-testid="rec-live"]', { timeout: 8000 });
    ok(await win.locator('[data-testid="rec-stop"]').count() === 1, 'Space → 녹음 중 표시 · 정지 단추');
    const linesBefore = await win.evaluate(() => document.querySelectorAll('.sent.sel, .sent.on').length);
    await win.waitForTimeout(2600);
    await win.keyboard.press('Space'); await win.waitForSelector('[data-testid="rec-audio"]', { timeout: 8000 });
    ok(await win.locator('[data-testid="rec-apply-next"]').isEnabled(), 'Space → 정지 · 미리듣기 · 덮어쓰기 열림');
    ok(await win.evaluate(() => document.querySelectorAll('.sent.sel, .sent.on').length) === linesBefore, '창이 열린 동안 Space 가 작업창 재생·선택을 건드리지 않는다');

    // Enter = 덮어쓰고 다음 클립
    await win.keyboard.press('Enter'); await win.waitForTimeout(3000);
    let s = await sents();
    ok(s[0].ow === 1 && s[1].ow === 0 && s[2].ow === 0, `Enter → 1번만 내 녹음 ${JSON.stringify(s.map((x) => x.ow))}`);
    ok(s[0].dur > 0.3 && s[0].dur < 3.5, `음성 길이(${s[0].dur && s[0].dur.toFixed(2)}초 · 약 2.6초 녹음 · 앞뒤 무음은 잘릴 수 있음)`);
    ok(await win.locator('[data-testid="rec-panel"]').count() === 1 && (await win.locator('[data-testid="rec-text"]').innerText()).includes('둘째 문장입니다'), '창이 그대로 다음 클립(둘째 문장)으로 넘어갔다');
    ok(await win.locator('[data-testid="clip-own"]').count() === 1, '덮어쓴 클립에 🎙 배지');
    ok(await win.locator('[data-testid="rec-audio"]').count() === 0 && await win.locator('[data-testid="rec-apply-next"]').isDisabled(), '다음 클립은 새로 녹음할 차례(옛 녹음이 남지 않는다)');
    ok(recFiles() === recBefore, '임시 녹음 파일은 옮긴 뒤 지운다');

    // 건너뛰기 → 셋째 → 마지막에서 건너뛰면 닫힘
    await win.click('[data-testid="rec-skip"]'); await win.waitForTimeout(400);
    ok((await win.locator('[data-testid="rec-text"]').innerText()).includes('셋째 문장입니다'), '건너뛰기 → 셋째 문장');
    await win.click('[data-testid="rec-skip"]'); await win.waitForTimeout(400);
    ok(await win.locator('[data-testid="rec-panel"]').count() === 0, '마지막 클립에서 건너뛰면 창이 닫힌다');
    s = await sents();
    ok(s[1].ow === 0 && s[2].ow === 0, '건너뛴 클립은 그대로');

    await win.evaluate(async () => window.api.undo({})); await win.waitForTimeout(700);
    ok((await sents())[0].ow === 0, '되돌리기 → 덮어쓰기 전');

    // Esc 로 닫기 · 마이크가 꺼진다
    await pick(2); await ctx(2); await win.click('[data-testid="cx-rec"]'); await win.waitForSelector('[data-testid="rec-panel"]');
    await win.click('[data-testid="rec-start"]'); await win.waitForSelector('[data-testid="rec-live"]', { timeout: 8000 });
    await win.click('[data-testid="rec-stop"]'); await win.waitForSelector('[data-testid="rec-audio"]', { timeout: 8000 });
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="rec-panel"]').count() === 0 && (await sents())[1].ow === 0, 'Esc → 덮어쓰지 않고 닫힌다');

    // 저장 IPC 방어
    const bad1 = await win.evaluate(async () => window.api.recSave({ bytes: new Uint8Array(10) }));
    const bad2 = await win.evaluate(async () => window.api.recSave({ bytes: new Uint8Array(500).fill(7) }));
    ok(bad1.ok === false && bad2.ok === false && /소리/.test(bad2.error), '너무 짧거나 소리가 아닌 데이터는 거부: ' + bad2.error);

    console.log('\n[3] 녹음 파일(앞 1초·뒤 1.5초 빈 소리)도 앞뒤가 잘린다');
    const rec = path.join(outDir, 'phone.m4a');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2:sample_rate=44100', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.5', '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1', '-c:a', 'aac', rec]);
    const r3 = await win.evaluate(async (p) => window.api.clipVoiceOverwrite({ shortsNum: 1, items: [{ groupNum: 1, sentIdx: 1 }], path: p }), rec);
    ok(r3 && r3.ok && Math.abs(r3.dur - 2.4) < 0.15, `m4a → 말 2초 + 앞 0.15 + 뒤 0.25 ≈ 2.4초 (${r3 && r3.dur && r3.dur.toFixed(2)} · 잘라낸 ${r3 && r3.trimmed && r3.trimmed.toFixed(2)})`);
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} } try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {} }
  console.log(fail ? `\n❌ record ${pass}/${pass + fail}` : `\n✅ record ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
