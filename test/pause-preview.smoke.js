'use strict';
/**
 * node test/pause-preview.smoke.js — ⏸ 미리보기 = 출력 (Lab · 차이표 #12)
 *   막간 카드(쉼=2초)가 있는 대본 → 무음 만들기(음성만)로 음성과 .vrew 를 만든 뒤
 *   ② 클립 칸의 줄 시작 시각(data-start) 을 .vrew 타임라인(vrew-render.buildTimeline 과 같은 규칙: 클립 words 길이 누적)과 줄마다 대조한다.
 *   · 막간 뒤 줄부터 2초 밀린다(판정력: DTO 의 pz 를 빼고 계산하면 어긋난다)
 *   · DTO 문장 pz = pausePlanOf 값 · ① 시계 전체 길이 = .vrew 전체 길이
 *   ⚠ 임시 채널·임시 폴더 · 생성 서버 안 씀(dry)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const AdmZip = require('adm-zip');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const TAG = `막간시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 막간 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '',
  '첫 장의 마지막 문장입니다.', '',
  '> 📜 화면카드: 막간 | 때=첫 장의 마지막 | 제목=둘째 장 | 쉼=2', '',
  '### ② 둘째 장면', '> 🖼️ 이미지: a field', '', '둘째 장이 시작됩니다. 이어지는 문장입니다.', ''].join('\n');

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__막간채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pausepv-e2e-'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    ok(await win.evaluate(async ({ name, dir }) => { try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, silenceSec: 0 } }); return true; } catch (_) { return false; } }, { name: chan, dir: outDir }), '임시 채널');
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const made = await win.evaluate(async (name) => { try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 30, aiNotice: false, openVrew: false, outMode: 'audio' }); return 'ok'; } catch (e) { return e.message; } }, chan);
    ok(made === 'ok', '무음 만들기(음성만) ' + made);
    await win.waitForTimeout(800);
    const dto = await win.evaluate(async () => (await window.api.listQueue()).dto);
    const sents = dto.projects[0].cuts.flatMap((c) => c.sentences);
    ok(sents[0].pz === 2 && sents.slice(1).every((s) => !s.pz), `DTO pz — 막간 끝 문장만 2초 (${sents.map((s) => s.pz).join(',')})`);

    // .vrew 타임라인(클립 = 자막 줄 · 시작 = words 길이 누적)
    const vrew = fs.readdirSync(outDir, { recursive: true }).map((f) => path.join(outDir, String(f))).find((f) => /\.vrew$/i.test(f));
    ok(!!vrew, '.vrew 가 만들어졌다');
    const pj = JSON.parse(new AdmZip(vrew).readAsText('project.json'));
    const starts = []; let t = 0;
    for (const c of pj.transcript.clips) { const d = (c.words || []).reduce((a, w) => a + (+w.duration || 0), 0); if (!(d > 0)) continue; starts.push(t); t += d; }
    // ② 줄 시작 시각
    const ui = await win.evaluate(() => [...document.querySelectorAll('.sent[data-ln]')].map((el) => { const t = el.querySelector('.clip-time'); const v = t && t.getAttribute('data-start'); return { n: +el.getAttribute('data-ln'), st: v ? +v : null }; }).filter((x) => x.st != null).sort((a, b) => a.n - b.n));
    console.log('   .vrew 클립 시작', starts.map((x) => x.toFixed(2)).join(' · '));
    console.log('   ② 줄 시작     ', ui.map((x) => x.st.toFixed(2)).join(' · '));
    ok(ui.length === starts.length, `줄 수 = .vrew 클립 수 (${ui.length} / ${starts.length})`);
    const worst = ui.reduce((m, x, i) => Math.max(m, Math.abs(x.st - (starts[i] ?? 1e9))), 0);
    ok(worst < 0.02, `② 줄 시작 = .vrew 클립 시작 (최대 차이 ${worst.toFixed(3)}초)`);
    ok(ui.length >= 2 && starts.length >= 2 && Math.abs((ui[1].st - ui[0].st) - (starts[1] - starts[0])) < 0.02 && (starts[1] - starts[0]) > sents[0].dur + 1.9, `막간 뒤 줄은 음성 + 2초 뒤에 시작 (.vrew ${(starts[1] - starts[0]).toFixed(2)}초 · 음성 ${sents[0].dur.toFixed(2)}초)`);
    // 판정력 — pz 를 빼고 누적하면 어긋난다
    const noPz = []; { let a = 0; for (const s of sents) { noPz.push(a); a += s.dur; } }
    ok(Math.abs(noPz[1] - starts[1]) > 1.9, `판정력: 쉼을 빼고 계산하면 둘째 줄이 ${(starts[1] - noPz[1]).toFixed(2)}초 어긋난다`);
    // ① 시계 전체 길이
    await win.locator('.sent[data-ln="1"] .clip-no .clip-no-n').first().click().catch(() => {});
    await win.waitForTimeout(300);
    const tot = await win.evaluate(() => { const e = document.querySelector('[data-testid="stage-time"], .stage-time'); return e ? e.textContent : null; });
    console.log('   ① 시계', tot, '· .vrew 전체', t.toFixed(2));
    { const m = /\/\s*(\d+):(\d{2})/.exec(tot || ''); const sec = m ? +m[1] * 60 + +m[2] : null;
      ok(sec === Math.floor(t), `① 시계 전체 ${sec}초 = .vrew ${Math.floor(t)}초 (쉼을 빼면 ${Math.floor(t - 2)}초)`); }
    ok(!errors.length, `화면 오류 0건 (${errors.slice(0, 2).join(' / ')})`);
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch {}
    await app.close();
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} pause-preview ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
