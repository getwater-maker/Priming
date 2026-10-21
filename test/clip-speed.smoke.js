'use strict';
/**
 * node test/clip-speed.smoke.js — ⏩ 클립 배속(Lab · 차이표 #13) 실제 화면 E2E
 *   무음 만들기로 음성을 채운 뒤 음성 파일을 「소리 있는 WAV」로 바꿔 두고(원본 자리 그대로) →
 *   클립 체크 → 막대 효과 → ⏩ 1.25 → 문장 길이가 (말 부분 ÷ 1.25) 로 줄고 배지 「⏩1.25×」 → 원본 파일 그대로
 *   → Ctrl+Z → 원래 길이·배지 없음 → 다시 1.25 → 문장을 Enter 로 나눠도 두 조각 길이 합이 유지되고 배속이 두 번 걸리지 않는다
 *   ⚠ 임시 채널·임시 출력 폴더 · 생성 서버를 부르지 않는다(dry)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const QT = require('../core/quiet-trim');

const TAG = `클립배속시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 클립 배속 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a field', '', '셋째 문장입니다.', ''].join('\n');
const R = 24000;
function tone(sec, padSec) {   // 220Hz 말소리 + 끝 정확한 0(문장무음 흉내)
  const n = Math.round(sec * R), p = Math.round(padSec * R), a = new Int16Array(n + p);
  for (let i = 0; i < n; i++) a[i] = Math.round(12000 * Math.sin(2 * Math.PI * 220 * i / R));
  return a;
}

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__클립배속채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipspeed-e2e-'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('dialog', (d) => d.accept().catch(() => {}));
    await win.waitForSelector('h1', { timeout: 20000 });
    ok(await win.evaluate(async ({ name, dir }) => { try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, silenceSec: 0 } }); return true; } catch (_) { return false; } }, { name: chan, dir: outDir }), '임시 채널');
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const made = await win.evaluate(async (name) => { try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 30, aiNotice: false, openVrew: false, outMode: 'audio' }); return 'ok'; } catch (e) { return e.message; } }, chan);
    ok(made === 'ok', '무음 만들기로 음성 채우기 ' + made);
    await win.waitForTimeout(500);
    // 첫 문장 음성 경로 — DTO 를 다시 받아 본다(선택 IPC 응답)
    const sent0 = async () => win.evaluate(async () => {
      const r = await window.api.listQueue();
      const s = r && r.dto && r.dto.projects[0].cuts[0].sentences[0];
      return s ? { audio: s.audio, dur: s.dur, cs: s.cs } : null;
    });
    let s0 = await sent0();
    ok(s0 && s0.audio && fs.existsSync(s0.audio), '첫 문장 음성 파일 있음');
    // 소리 있는 음성으로 바꿔 둔다(같은 경로 · 내용만) — 1.6초 말 + 0.5초 정확한 0
    fs.writeFileSync(s0.audio, QT.wavOf(tone(1.6, 0.5), R));
    const rawBytes = fs.readFileSync(s0.audio);
    const dur0 = s0.dur;   // 원래 기록된 길이(무음 채우기 값) — 되돌리기는 이 값으로 돌아와야 한다

    console.log('\n[1] 막대 → 효과 → ⏩ 1.25');
    await win.keyboard.press('Escape');
    await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(250);
    await win.waitForSelector('[data-testid="clip-tb"]', { timeout: 5000 });
    await win.click('[data-testid="ctb-fx"]');
    await win.waitForSelector('[data-testid="ctb-speed"]', { timeout: 3000 });
    await win.click('[data-testid="ctb-speed-1.25"]').catch(async () => { await win.click('[data-testid="ctb-speed-1.2"]'); });
    await win.waitForSelector('[data-testid="clip-speed-badge"]', { timeout: 8000 }).catch(() => {});
    const badge = await win.locator('[data-testid="clip-speed-badge"]').first().innerText().catch(() => '');
    s0 = await sent0();
    const sp = s0 && s0.cs;
    const want = 1.6 / (sp || 1) + 0.5;
    ok(!!sp && /⏩1\.2/.test(badge), `배지 「${badge}」 · 문장 배속 ${sp}`);
    ok(s0 && Math.abs(s0.dur - want) < 0.04, `문장 길이 ${s0 && s0.dur && s0.dur.toFixed(2)}초 (기대 ${want.toFixed(2)} — 말만 빨라지고 끝 무음 0.5초 그대로)`);
    ok(s0 && /_q[0-9a-f]{8}\.wav$/.test(s0.audio), `사본을 가리킨다 (${s0 && path.basename(s0.audio)})`);
    ok(fs.readdirSync(path.dirname(s0.audio)).some((f) => { try { return Buffer.compare(fs.readFileSync(path.join(path.dirname(s0.audio), f)), rawBytes) === 0; } catch { return false; } }), '원본 음성 파일 내용 그대로 남아 있다');

    console.log('\n[2] Ctrl+Z');
    await win.keyboard.press('Escape'); await win.keyboard.press('Escape');
    await win.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    const u = await win.evaluate(async () => { const r = await window.api.undo({}); return r && r.label; });
    s0 = await sent0();
    ok(u === '클립 배속' && s0 && !s0.cs && Math.abs(s0.dur - dur0) < 0.001 && Buffer.compare(fs.readFileSync(s0.audio), rawBytes) === 0, `되돌리기 「${u}」 → 배속 없음 · 원래 음성 파일·길이 ${s0 && s0.dur && s0.dur.toFixed(2)}초 (원래 ${dur0.toFixed(2)})`);

    console.log('\n[3] 다시 1.25 → Enter 로 나누기');
    const r2 = await win.evaluate(async () => window.api.clipSpeed({ shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }], speed: 1.25 }));
    s0 = await sent0();
    const before = s0.dur;
    ok(r2 && r2.ok && Math.abs(before - (1.6 / 1.25 + 0.5)) < 0.04, `다시 1.25× (${before.toFixed(2)}초)`);
    const sp1 = await win.evaluate(async () => {
      const r = await window.api.editSentences({ shortsNum: 1, groupNum: 1, sentIdx: 0, count: 1, text: '첫 문장은 조금. 길게 씁니다.' }).catch((e) => ({ error: e.message }));
      const d = (await window.api.listQueue()).dto;
      const ss = d.projects[0].cuts[0].sentences;
      return { err: r && r.error, n: ss.length, durs: ss.map((x) => x.dur), cs: ss.map((x) => x.cs) };
    });
    console.log('   나눈 결과', JSON.stringify(sp1));
    ok(!sp1.err && sp1.n === 3, `Enter 나누기 — 첫 그룹 문장 ${sp1.n}개 ${sp1.err || ''}`);
    {
      const sum = sp1.durs[0] + sp1.durs[1];
      ok(Math.abs(sum - before) < 0.1, `나눈 두 조각 길이 합 ${sum.toFixed(2)}초 ≈ 나누기 전 ${before.toFixed(2)}초(배속이 두 번 걸리지 않음)`);
    }
    ok(!errors.length, `화면 오류 0건 (${errors.slice(0, 2).join(' / ')})`);
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch {}
    await app.close();
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} clip-speed ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
