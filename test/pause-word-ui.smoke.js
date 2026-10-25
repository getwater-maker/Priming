'use strict';
/**
 * node test/pause-word-ui.smoke.js — ❄ 정지 워드 · ⋯ 빈 워드 삽입 실제 앱 E2E (Lab · 설계 ②③)
 *   합성 음성(어절마다 말 덩어리) + 채널 「단어 자리 맞추기」:
 *   ① 정렬이 없으면: 가운데는 이유를 말하고 거부 · 문장 맨 앞은 된다
 *   ② 어절 칩 → ⏸ 단추 → 패널 → 그 단어 앞에 무음: 새 음성(_p….wav) 길이 +N초 · 경계 시각이 뒤로 +N초 · 글(.md) 불변 · 원본 음성 그대로
 *   ③ 우클릭 ▸ 빈 워드 삽입(문장 맨 끝) · 배지 · Ctrl+Z · 새로고침 유지
 *   ⚠ 임시 채널·임시 폴더 · 생성 서버를 부르지 않는다(dry)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const WA = require('../core/word-align'), QT = require('../core/quiet-trim');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const R = 24000;
const TEXT = '집 명의나 이사 계획은 가족이 함께 알아야 하는 일이라, 자녀분과 한 번 이야기를 나눠 보세요.';
const TAG = `정지워드시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 정지 워드 시험', '', '## 장', '### ① 장면', '> 🖼️ 이미지: a room', '', TEXT, ''].join('\n');
function synth(text, dur) {
  const toks = WA.tokenize(text);
  const bl = toks.map((t) => 0.08 * t.rw + 0.06), gp = toks.slice(0, -1).map((t) => (t.pause ? 0.40 : 0.04));
  const speech = bl.reduce((a, b) => a + b, 0) + gp.reduce((a, b) => a + b, 0);
  const k = Math.min(1, (dur - 0.2 - 0.2) / speech);
  const pcm = new Int16Array(Math.round(dur * R)); let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round((rnd() - 0.5) * 4);
  let t = 0.2;
  toks.forEach((_, i) => {
    const n0 = Math.round(t * R), n1 = Math.round((t + bl[i] * k) * R);
    for (let q = n0; q < n1 && q < pcm.length; q++) { const e = Math.min(1, (q - n0) / 120, (n1 - q) / 120); pcm[q] = Math.round(12000 * e * Math.sin(2 * Math.PI * 220 * q / R)); }
    t += bl[i] * k + (i < toks.length - 1 ? gp[i] * k : 0);
  });
  return pcm;
}
(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__정지워드채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-e2e-'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('dialog', (d) => d.accept().catch(() => {}));
    await win.waitForSelector('h1', { timeout: 20000 });
    const savePreset = (patch) => win.evaluate(async ({ name, patch }) => { await window.api.savePreset({ name, patch }); return true; }, { name: chan, patch });
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, silenceSec: 0, wordAlign: false } }); }, { name: chan, dir: outDir });
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const made = await win.evaluate(async (name) => { try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 20, aiNotice: false, openVrew: false, outMode: 'audio' }); return 'ok'; } catch (e) { return String(e.message || e); } }, chan);
    ok(made === 'ok', '무음 만들기(음성 파일 만들기) ' + made);
    const sent = async () => win.evaluate(async () => { const s = (await window.api.listQueue()).dto.projects[0].cuts[0].sentences[0]; return { text: s.text, audio: s.audio, dur: s.dur, wb: s.wb, pi: s.pi }; });
    let s0 = await sent();
    fs.writeFileSync(s0.audio, QT.wavOf(synth(TEXT, s0.dur), R));
    const openClips = async () => { await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }).catch(() => {}); await win.waitForTimeout(700); };
    const call = (a) => win.evaluate(async (args) => window.api.clipPauseWord({ shortsNum: 1, groupNum: 1, sentIdx: 0, ...args }), a);

    console.log('\n[1] 정렬이 없을 때');
    await openClips();
    const mid = await call({ at: 10, sec: 0.5, kind: 'pause' });
    ok(mid && mid.ok === false && /단어 시각/.test(mid.error) && /맨 앞/.test(mid.error), `가운데 = 이유를 말하고 거부: ${mid && mid.error && mid.error.slice(0, 36)}…`);
    ok(fs.readFileSync(MD, 'utf8').includes(TEXT) && (await sent()).audio === s0.audio, '거부했으니 소리·글은 그대로');
    const st = await call({ at: 0, sec: 0.5, kind: 'pause' });
    ok(st && st.ok === true, '문장 맨 앞은 정렬 없이도 된다');
    let s1 = await sent();
    ok(/_p[0-9a-f]{8}\.wav$/.test(s1.audio) && Math.abs(s1.dur - (s0.dur + 0.5)) < 0.03, `새 음성 ${path.basename(s1.audio)} (+0.5초 · ${s0.dur.toFixed(2)} → ${s1.dur.toFixed(2)})`);
    await win.evaluate(async () => window.api.undo({})); await win.waitForTimeout(500);
    ok((await sent()).audio === s0.audio, 'Ctrl+Z → 옛 음성 경로');

    console.log('\n[2] 맞춘 뒤 — 칩 ⏸ → 패널 → 그 단어 앞');
    await savePreset({ wordAlign: true });
    await win.evaluate(async (name) => { try { await window.api.exportVrew({ presetName: name, captionMaxChars: 20, outMode: 'audio', aiNotice: false }); return 'ok'; } catch (e) { return e.message; } }, chan);
    await openClips();
    s0 = await sent();
    ok(Array.isArray(s0.wb), `정렬이 생겼다(경계 ${s0.wb && s0.wb.length}개)`);
    const bef = s0.wb.slice(); const wi = 3; const origBytes = fs.readFileSync(s0.audio);
    await win.locator('.sent[data-ln="1"] .clip-chips .chip').nth(wi).click(); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="word-pause"]').count() === 1 && await win.locator('[data-testid="word-pause"]').isEnabled(), '어절 칩을 고르면 ⏸ 단추가 열린다');
    await win.click('[data-testid="word-pause"]');
    await win.waitForSelector('[data-testid="wp-panel"]', { timeout: 3000 });
    ok(await win.locator('[data-testid="wp-pos"] option[value="word"]').count() === 1 && await win.locator('[data-testid="wp-pos"]').inputValue() === 'word', '패널: 「고른 단어 앞」이 기본');
    await win.locator('[data-testid="wp-sec"]').fill('0.8'); await win.waitForTimeout(150);
    await win.click('[data-testid="wp-run"]');
    let s2 = null; for (let i = 0; i < 20; i++) { await win.waitForTimeout(250); const q = await sent(); if (q.audio !== s0.audio) { s2 = q; break; } }
    ok(s2 && /_p[0-9a-f]{8}\.wav$/.test(s2.audio) && fs.existsSync(s2.audio), `새 음성 ${s2 && path.basename(s2.audio)}`);
    ok(s2 && Math.abs(s2.dur - (s0.dur + 0.8)) < 0.03, `🔑 길이 +0.8초(${s0.dur.toFixed(2)} → ${s2 && s2.dur.toFixed(2)})`);
    ok(fs.readFileSync(MD, 'utf8').includes(TEXT) && s2.text === TEXT, '글(.md)·화면 글은 그대로');
    ok(fs.existsSync(s0.audio) && Buffer.compare(fs.readFileSync(s0.audio), origBytes) === 0, '원본 음성 파일은 그대로');
    ok(s2.wb && s2.wb.length === bef.length && Math.abs(s2.wb[wi] - (bef[wi] + 0.8)) < 0.03 && Math.abs(s2.wb[wi - 1] - bef[wi - 1]) < 0.03 && Math.abs(s2.wb[bef.length - 1] - (bef[bef.length - 1] + 0.8)) < 0.03, `🔑 경계 시각이 뒤로 밀렸다(wb[${wi}] ${bef[wi].toFixed(2)} → ${s2.wb[wi].toFixed(2)} · 앞쪽은 그대로)`);
    ok(await win.locator('[data-testid="clip-pi"]').count() === 1 && /0\.8/.test(await win.locator('[data-testid="clip-pi"]').first().innerText()), '클립에 ❄0.8초 배지');
    // 소리 실측 — 정렬 경계 wb[wi] 부근에 0.8초 무음이 있다(원래 어절 사이는 0.04~0.4초)
    const WAV = require('../core/word-align-pass').readWavPcm(s2.audio);
    const a0 = Math.round(s2.wb[wi - 1 + 0] * R), nz = (a, b) => { let n = 0; for (let i = a; i < b; i++) if (Math.abs(WAV.pcm[i]) > 60) n++; return n; };
    const gapStart = Math.round(bef[wi] * R), gapEnd = Math.round((bef[wi] + 0.8) * R);
    ok(nz(gapStart + 200, gapEnd - 200) === 0, '🔑 소리 실측: 끼운 구간(원래 경계 ~ +0.8초)은 무음');
    void a0;

    console.log('\n[3] 우클릭 ▸ 빈 워드 삽입(문장 맨 끝) · Ctrl+Z · 유지');
    await win.keyboard.press('Escape');
    await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(250);
    await win.locator('.sent[data-ln="1"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } });
    await win.waitForSelector('[data-testid="clip-ctx"]');
    ok(await win.locator('[data-testid="cx-blank-word"].soon').count() === 0 && await win.locator('[data-testid="cx-pause-word"].soon').count() === 0, '우클릭의 두 줄은 준비 중이 아니다');
    await win.click('[data-testid="cx-blank-word"]');
    await win.waitForSelector('[data-testid="wp-panel"]', { timeout: 3000 });
    ok(await win.locator('[data-testid="wp-sec"]').inputValue() === '0.3', '빈 워드는 기본 0.3초');
    await win.selectOption('[data-testid="wp-pos"]', 'end');
    await win.click('[data-testid="wp-run"]');
    let s3 = null; for (let i = 0; i < 20; i++) { await win.waitForTimeout(250); const q = await sent(); if (q.audio !== s2.audio) { s3 = q; break; } }
    ok(s3 && Math.abs(s3.dur - (s2.dur + 0.3)) < 0.03 && Math.abs(s3.wb[s3.wb.length - 1] - (s2.wb[s2.wb.length - 1] + 0.3)) < 0.03 && Math.abs(s3.wb[wi] - s2.wb[wi]) < 0.03, `문장 맨 끝 +0.3초(끝 경계만 밀림 · ${s2.dur.toFixed(2)} → ${s3 && s3.dur.toFixed(2)})`);
    ok(s3 && Math.abs(s3.pi - 1.1) < 0.02, `배지 합 ${s3 && s3.pi}초(0.8 + 0.3)`);
    const un = await win.evaluate(async () => { const r = await window.api.undo({}); return r && r.label; });
    const s4 = await sent();
    ok(/빈 워드/.test(un || '') && s4.audio === s2.audio, `Ctrl+Z 「${un}」 → 한 단계 전 소리`);
    await openClips();
    const s5 = await sent();
    ok(s5.audio === s2.audio && Math.abs(s5.pi - 0.8) < 0.02, '새로고침(작업본 이어받기) 뒤에도 소리·정지 표시 유지');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    try { const w = await app.firstWindow(); await w.evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, chan); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} } try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(fail ? `\n❌ pause-word-ui ${pass}/${pass + fail}` : `\n✅ pause-word-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
