'use strict';
/**
 * node test/word-delete-ui.smoke.js — 🗑▶ 단어 클릭 이동·삭제 (Lab · 차이표 #11) 실제 앱 E2E
 *   합성 음성(어절마다 말 덩어리 · 쉼표 뒤 0.40초 쉼)을 넣고 채널 「단어 자리 맞추기」를 켠 뒤:
 *   ① 어절 칩을 고르면 ▶🗑 가 나타난다(정렬이 없으면 막혀 있다)
 *   ② ▶ = 오디오가 그 단어의 **소리 기준 위치**에서 시작한다(글자 비례 위치가 아니다)
 *   ③ 🗑 = 글(.md)·화면·음성이 함께 바뀐다: 지운 만큼 짧아진 새 음성 · 원본 음성 파일은 그대로 · 잠시 뒤 자동 재정렬
 *   ④ Ctrl+Z(되돌리기) 한 번 = 글(.md)과 음성이 옛 것으로
 *   ⑤ 문장 전체·음성 없음·정렬 없음은 이유를 말하고 아무것도 안 바꾼다
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
const TAG = `단어삭제시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 단어 삭제 시험', '', '## 장', '### ① 장면', '> 🖼️ 이미지: a room', '', TEXT, ''].join('\n');

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
  const chan = `__단어삭제채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdel-e2e-'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('dialog', (d) => d.accept().catch(() => {}));
    await win.waitForSelector('h1', { timeout: 20000 });
    const savePreset = (patch) => win.evaluate(async ({ name, patch }) => { await window.api.savePreset({ name, patch }); return true; }, { name: chan, patch });
    ok(await win.evaluate(async ({ name, dir }) => { try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, silenceSec: 0, wordAlign: false } }); return true; } catch (_) { return false; } }, { name: chan, dir: outDir }), '임시 채널(단어 자리 맞추기 꺼짐)');
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const made = await win.evaluate(async (name) => { try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 20, aiNotice: false, openVrew: false, outMode: 'audio' }); return 'ok'; } catch (e) { return e.message; } }, chan);
    ok(made === 'ok', '무음 만들기(음성 파일 만들기) ' + made);
    const sent = async () => win.evaluate(async () => { const s = (await window.api.listQueue()).dto.projects[0].cuts[0].sentences[0]; return { text: s.text, audio: s.audio, dur: s.dur, wb: s.wb }; });
    let s0 = await sent();
    fs.writeFileSync(s0.audio, QT.wavOf(synth(TEXT, s0.dur), R));   // 같은 경로·같은 길이 — 내용만 합성 음성으로
    const openClips = async () => { await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }).catch(() => {}); await win.waitForTimeout(700); };

    console.log('\n[1] 정렬이 없으면 막혀 있다');
    await openClips();
    await win.locator('.sent[data-ln="1"] .clip-chips .chip').nth(1).click(); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="word-act"]').count() === 1, '어절 칩을 고르면 ▶🗑 가 나타난다');
    ok(await win.locator('[data-testid="word-del"]').isDisabled() && await win.locator('[data-testid="word-play"]').isDisabled(), '정렬이 없으면 두 단추 모두 막혀 있다');
    ok(/단어 자리 맞추기/.test((await win.locator('[data-testid="word-del"]').getAttribute('title')) || ''), '막힌 이유(단어 자리 맞추기를 켜세요)를 title 로 알려 준다');
    const noWb = await win.evaluate(async () => window.api.deleteWords({ shortsNum: 1, groupNum: 1, sentIdx: 0, from: 2, to: 5 }));
    ok(noWb && noWb.ok === false && /단어 시각/.test(noWb.error), `main 도 거부한다: ${noWb && noWb.error && noWb.error.slice(0, 40)}…`);
    ok(fs.readFileSync(MD, 'utf8').includes(TEXT), '거부했으니 대본(.md)은 그대로');

    console.log('\n[2] 켜고 맞춘 뒤');
    await savePreset({ wordAlign: true });
    await win.evaluate(async (name) => { try { await window.api.exportVrew({ presetName: name, captionMaxChars: 20, outMode: 'audio', aiNotice: false }); return 'ok'; } catch (e) { return e.message; } }, chan);
    await openClips();
    s0 = await sent();
    ok(Array.isArray(s0.wb), `정렬이 생겼다 (어절 경계 ${s0.wb && s0.wb.length}개)`);
    const toks = WA.tokenize(TEXT);
    const wi = 1;                                   // 「명의나」
    const bef = s0.wb.slice();
    await win.locator('.sent[data-ln="1"] .clip-chips .chip').nth(wi).click(); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="word-play"]').isEnabled() && await win.locator('[data-testid="word-del"]').isEnabled(), '정렬이 있으면 두 단추가 열린다');

    console.log('\n[3] ▶ 단어부터 재생');
    await win.evaluate(() => { window.__plays = []; const o = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__plays.push({ t: this.currentTime, src: String(this.src).slice(0, 30) }); return o.apply(this, arguments); }; });
    await win.click('[data-testid="word-play"]');
    let plays = []; for (let i = 0; i < 20 && !plays.length; i++) { await win.waitForTimeout(250); plays = await win.evaluate(() => window.__plays || []); }
    const want = bef[wi];   // 어절 시작 경계(소리 기준)
    const charRatio = (toks.slice(0, wi).reduce((a, t) => a + (t.to - t.from), 0) / toks.reduce((a, t) => a + (t.to - t.from), 0)) * s0.dur;
    ok(plays.length >= 1 && Math.abs(plays[0].t - want) < 0.05, `오디오가 단어의 소리 기준 위치에서 시작 (${plays[0] && plays[0].t.toFixed(3)}초 ≈ 정렬 ${want.toFixed(3)}초)`);
    ok(Math.abs(want - charRatio) > 0.05, `판정력: 글자 비례 위치(${charRatio.toFixed(3)}초)와 다르다 — 정렬이 없으면 그쪽에서 시작했을 것`);
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
    // 🔤 줄 중간(2번째 줄 클립)부터 재생도 정렬 기준 — 예전엔 글자 비례 위치에서 시작해 자막·.vrew 와 어긋난 자리에서 들렸다
    const line2 = await win.evaluate(() => { const q = document.querySelector('.sent[data-ln="2"] .clip-time'); return q ? +q.getAttribute('data-start') : null; });
    await win.evaluate(() => { window.__plays = []; });
    await win.locator('.sent[data-ln="2"] .clip-no .clip-no-n').first().click(); await win.waitForTimeout(250);
    await win.keyboard.press('Space');
    let p2 = []; for (let i = 0; i < 20 && !p2.length; i++) { await win.waitForTimeout(250); p2 = await win.evaluate(() => window.__plays || []); }
    ok(line2 != null && p2.length >= 1 && Math.abs(p2[0].t - line2) < 0.05, `2번째 줄부터 재생: 오디오 시작 ${p2[0] && p2[0].t.toFixed(3)}초 = 화면 줄 시작 ${line2 && line2.toFixed(3)}초(정렬 기준)`);
    await win.keyboard.press('Space'); await win.waitForTimeout(300);

    console.log('\n[4] 🗑 단어 지우기');
    await win.locator('.sent[data-ln="1"] .clip-chips .chip').nth(wi).click(); await win.waitForTimeout(300);
    const origBytes = fs.readFileSync(s0.audio);
    await win.click('[data-testid="word-del"]');
    let s1 = null; for (let i = 0; i < 20; i++) { await win.waitForTimeout(250); const q = await sent(); if (q.text !== TEXT) { s1 = q; break; } }
    const newText = WA.textWithout(TEXT, wi, wi + 1);
    ok(s1 && s1.text === newText && !s1.text.includes('명의나'), `화면 글에서 빠졌다 (「${s1 && s1.text.slice(0, 22)}…」)`);
    ok(fs.readFileSync(MD, 'utf8').includes(newText) && !fs.readFileSync(MD, 'utf8').includes('명의나'), '대본(.md)에서도 빠졌다');
    const removedSec = bef[wi + 1] - bef[wi];
    ok(s1 && /_d[0-9a-f]{8}\.wav$/.test(s1.audio) && fs.existsSync(s1.audio) && Math.abs(s1.dur - (s0.dur - removedSec)) < 0.03, `새 음성 ${s1 && path.basename(s1.audio)} 은 지운 만큼 짧다 (${s0.dur.toFixed(2)} → ${s1 && s1.dur.toFixed(2)}초 · 지운 ${removedSec.toFixed(2)}초)`);
    ok(fs.existsSync(s0.audio) && Buffer.compare(fs.readFileSync(s0.audio), origBytes) === 0, '원본 음성 파일은 그대로(되돌리기용)');
    let again = null; for (let i = 0; i < 20 && !again; i++) { await win.waitForTimeout(400); const q = await sent(); if (Array.isArray(q.wb)) again = q; }
    ok(!!again && again.wb.length === toks.length, `잠시 뒤 자동으로 다시 맞춘다 (어절 경계 ${again && again.wb.length}개 = 어절 ${toks.length - 1}개 + 1)`);
    ok(again && Math.abs(again.wb[2] - (bef[3] - removedSec)) < 0.06, `남은 어절 경계가 지운 길이만큼 당겨졌다 (${again && again.wb[2].toFixed(2)} ≈ ${(bef[3] - removedSec).toFixed(2)})`);
    await openClips();
    ok(await win.locator('.sent[data-ln="1"] .clip-chips .chip', { hasText: '명의나' }).count() === 0, '화면 칩에서도 사라졌다');

    console.log('\n[5] Ctrl+Z');
    const un = await win.evaluate(async () => { const r = await window.api.undo({}); return r && r.label; });
    const s2 = await sent();
    ok(un === '단어 지우기' && s2.text === TEXT && s2.audio === s0.audio, `되돌리기 「${un}」 → 글과 음성이 옛 것으로 (${s2.audio === s0.audio ? '원본 음성 경로' : s2.audio})`);
    ok(fs.readFileSync(MD, 'utf8').includes(TEXT), '대본(.md)도 옛 것으로');

    console.log('\n[6] 지울 수 없는 경우');
    const whole = await win.evaluate(async (len) => window.api.deleteWords({ shortsNum: 1, groupNum: 1, sentIdx: 0, from: 0, to: len }), TEXT.length);
    ok(whole && whole.ok === false && /전체/.test(whole.error), `문장 전체: ${whole && whole.error && whole.error.slice(0, 36)}…`);
    const none = await win.evaluate(async () => window.api.deleteWords({ shortsNum: 1, groupNum: 1, sentIdx: 0, from: 500, to: 510 }));
    ok(none && none.ok === false, '글 밖을 고르면 거부');
    ok(fs.readFileSync(MD, 'utf8').includes(TEXT) && (await sent()).text === TEXT, '거부한 뒤에도 글·음성은 그대로');
    ok(!errors.length, `화면 오류 0건 (${errors.slice(0, 2).join(' / ')})`);
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch {}
    await app.close();
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} word-delete-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
