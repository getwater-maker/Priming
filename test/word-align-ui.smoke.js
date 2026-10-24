'use strict';
/**
 * node test/word-align-ui.smoke.js — 🔤 단어 자리 맞추기 (Lab · 차이표 #10) 실제 앱 E2E
 *   무음 만들기로 음성을 만든 뒤 그 음성을 **합성 음성**(어절마다 말 덩어리 · 쉼표 뒤 0.40초 쉼 · 길게 남는 끝 여백 = 문장무음 흉내)으로 바꿔 두고
 *   채널 「단어 자리 맞추기」(wordAlign)를 껐다 켰다 하며 export-vrew 로 .vrew·SRT 를 굽는다.
 *   · 켬: 줄(클립) 경계가 정답(합성한 쉼 안)에 놓인다 · .vrew 클립 시작 = SRT = ② 화면 줄 시작 = DTO lt (서로 같다)
 *   · 끔: 예전 글자 비례 그대로(켬과 0.1초 넘게 다르다) · DTO lt 없음 · 다시 켜면 되돌아온다
 *   ⚠ 임시 채널·임시 폴더 · 생성 서버를 부르지 않는다(dry)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const AdmZip = require('adm-zip');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const WA = require('../core/word-align'), QT = require('../core/quiet-trim');
const CF = require('../core/caption-format');
const { splitCaptionLines } = require('../core/caption-splitter');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const R = 24000;
const TEXT = '집 명의나 이사 계획은 가족이 함께 알아야 하는 일이라, 자녀분과 한 번 이야기를 나눠 보세요.';
const CAP = 20;   // ② 화면의 줄 글자 수 기본값(설정 splitOpts.long) — .vrew 도 같은 값으로 굽는다(모드 프로필 18 과 다르다 — DTO 가 아니라 화면이 줄 경계를 계산해야 하는 이유)
const TAG = `단어정렬시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 단어 정렬 시험', '', '## 장', '### ① 장면', '> 🖼️ 이미지: a room', '', TEXT, ''].join('\n');

// 합성 음성(길이 = dur): 어절 소리 = 0.08×무게+0.06초 · 사이 0.04초 · 부호 어절 뒤 0.40초 · 앞 0.2초 · 나머지는 끝 여백
function synth(text, dur) {
  const toks = WA.tokenize(text);
  const bl = toks.map((t) => 0.08 * t.rw + 0.06), gp = toks.slice(0, -1).map((t) => (t.pause ? 0.40 : 0.04));
  const speech = bl.reduce((a, b) => a + b, 0) + gp.reduce((a, b) => a + b, 0);
  const k = Math.min(1, (dur - 0.2 - 0.2) / speech);
  const pcm = new Int16Array(Math.round(dur * R)); let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round((rnd() - 0.5) * 4);
  let t = 0.2; const truth = [];
  toks.forEach((_, i) => {
    const n0 = Math.round(t * R), n1 = Math.round((t + bl[i] * k) * R);
    for (let q = n0; q < n1 && q < pcm.length; q++) { const e = Math.min(1, (q - n0) / 120, (n1 - q) / 120); pcm[q] = Math.round(12000 * e * Math.sin(2 * Math.PI * 220 * q / R)); }
    t += bl[i] * k;
    if (i < toks.length - 1) { truth.push([t, t + gp[i] * k]); t += gp[i] * k; }
  });
  return { pcm, truth };
}

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__단어정렬채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walign-e2e-'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
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
    const sent = async () => win.evaluate(async () => { const s = (await window.api.listQueue()).dto.projects[0].cuts[0].sentences[0]; return { audio: s.audio, dur: s.dur, wb: s.wb }; });
    let s0 = await sent();
    const SY = synth(TEXT, s0.dur);
    fs.writeFileSync(s0.audio, QT.wavOf(SY.pcm, R));   // 같은 경로·같은 길이 — 내용만 합성 음성으로

    const exportOnce = async () => {
      for (const f of fs.readdirSync(outDir, { recursive: true })) if (/\.(vrew|srt)$/i.test(String(f))) { try { fs.rmSync(path.join(outDir, String(f)), { force: true }); } catch {} }
      const r = await win.evaluate(async (name) => { try { await window.api.exportVrew({ presetName: name, captionMaxChars: 20, outMode: 'audio', aiNotice: false }); return 'ok'; } catch (e) { return e.message; } }, chan);
      const files = fs.readdirSync(outDir, { recursive: true }).map((f) => path.join(outDir, String(f)));
      const vrew = files.find((f) => /\.vrew$/i.test(f)), srt = files.find((f) => /\.srt$/i.test(f));
      const pj = vrew ? JSON.parse(new AdmZip(vrew).readAsText('project.json')) : null;
      let t = 0; const starts = pj ? pj.transcript.clips.map((c) => { const q = t; t += c.words.filter((w) => w.type === 0).reduce((z, w) => z + w.duration, 0); return q; }) : [];
      const srtStarts = srt ? [...fs.readFileSync(srt, 'utf8').matchAll(/(\d\d):(\d\d):(\d\d),(\d{3}) -->/g)].map((m) => +m[2] * 60 + +m[3] + +m[4] / 1000) : [];
      await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }).catch(() => {}); await win.waitForTimeout(700);
      const ui = await win.evaluate(() => [...document.querySelectorAll('.sent[data-ln]')].map((el) => { const q = el.querySelector('.clip-time'); const v = q && q.getAttribute('data-start'); return v ? +v : null; }).filter((x) => x != null));
      return { r, starts, srtStarts, ui, wb: (await sent()).wb };
    };
    const lines = splitCaptionLines(TEXT, CAP);
    const cum = []; { let c = 0; for (const l of lines.slice(0, -1)) { c += WA.tokenize(l).length; cum.push(c); } }   // 줄 경계 = 이 번호의 어절 앞
    const gaps = cum.map((k) => SY.truth[k - 1]);
    const nL = lines.length;
    ok(nL >= 2, `시험 문장은 ${CAP}자 기준 ${nL}줄 (${lines.map((l) => '「' + l + '」').join(' ')})`);
    const f3 = (a) => a.map((x) => x.toFixed(2)).join(' · ');

    console.log('\n[1] 꺼짐 — 예전 글자 비례');
    const off = await exportOnce();
    ok(off.r === 'ok' && off.starts.length === nL && off.wb === null, `.vrew 클립 ${nL}개 · DTO wb 없음 (${off.r})`);
    ok(off.srtStarts.length === nL && off.ui.length === nL && off.starts.every((x, i) => Math.abs(off.srtStarts[i] - x) < 0.002 && Math.abs(off.ui[i] - x) < 0.002), `.vrew = SRT = ② 화면 줄 시작 (${f3(off.starts)} · 예전 글자 비례)`);

    console.log('\n[2] 켬 — 소리의 쉼에');
    await savePreset({ wordAlign: true });
    const on = await exportOnce();
    ok(on.r === 'ok' && on.starts.length === nL && Array.isArray(on.wb), `.vrew 클립 ${nL}개 · DTO wb 있음 (${on.r})`);
    ok(gaps.every((g, i) => on.starts[i + 1] >= g[0] - 0.03 && on.starts[i + 1] <= g[1] + 0.03), `모든 줄 경계가 합성한 쉼 안에 놓인다 (${f3(on.starts.slice(1))} ← 정답 ${gaps.map((g) => g[0].toFixed(2) + '~' + g[1].toFixed(2)).join(' · ')})`);
    ok(on.srtStarts.length === nL && on.starts.every((x, i) => Math.abs(on.srtStarts[i] - x) < 0.002), `SRT 줄 시작 = .vrew 클립 시작 (${f3(on.srtStarts)})`);
    ok(on.ui.length === nL && on.starts.every((x, i) => Math.abs(on.ui[i] - x) < 0.002), `② 화면 줄 시작 = .vrew 클립 시작 (${f3(on.ui)})`);
    ok(Math.max(...on.starts.slice(1).map((x, i) => Math.abs(x - off.starts[i + 1]))) > 0.1, `판정력: 끔과 최대 ${Math.max(...on.starts.slice(1).map((x, i) => Math.abs(x - off.starts[i + 1]))).toFixed(2)}초 다르다 (글자 비례 ${f3(off.starts.slice(1))} → 소리 ${f3(on.starts.slice(1))})`);

    console.log('\n[3] 다시 끔 / 켬');
    await savePreset({ wordAlign: false });
    const off2 = await exportOnce();
    ok(off2.wb === null && off2.starts.every((x, i) => Math.abs(x - off.starts[i]) < 1e-6), `끄면 예전 값으로 정확히 돌아간다 (${f3(off2.starts)}) · wb 없음`);
    await savePreset({ wordAlign: true });
    const on2 = await exportOnce();
    ok(on2.starts.every((x, i) => Math.abs(x - on.starts[i]) < 1e-6), '다시 켜면 같은 자리로(결정적)');

    console.log('\n[4] 글 부호만 고치면 — 옛 정렬은 안 쓰고 잠시 뒤 자동으로 다시 맞춘다');
    const ed = await win.evaluate(async (text) => { try { const r = await window.api.editSentences({ shortsNum: 1, groupNum: 1, sentIdx: 0, count: 1, text: text.replace(/\.$/, '!') }); return r && r.ok ? 'ok' : (r && r.error) || 'fail'; } catch (e) { return e.message; } }, TEXT);
    const right = await sent();
    ok(ed === 'ok' && right.audio && right.wb === null, `고친 직후: 음성은 물려받고 정렬은 쓰지 않는다 (${ed} · wb ${right.wb === null ? '없음' : '있음'})`);
    let again = null; for (let i = 0; i < 20 && !again; i++) { await win.waitForTimeout(400); const q = await sent(); if (Array.isArray(q.wb)) again = q; }
    ok(!!again, `잠시 뒤 자동으로 다시 맞춘다 (${again ? '어절 경계 ' + again.wb.length + '개' : '안 됨'})`);
    ok(again && again.wb.every((x, i) => i === 0 || i === again.wb.length - 1 || Math.abs(x - on.wb[i]) < 0.01), '같은 소리라 어절 경계도 같은 자리');
    ok(!errors.length, `화면 오류 0건 (${errors.slice(0, 2).join(' / ')})`);
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch {}
    await app.close();
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} word-align-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
