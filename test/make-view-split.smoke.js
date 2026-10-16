'use strict';
// node test/make-view-split.smoke.js — 🎬 만드는 대본과 보는 대본을 가른다(v0.9.23 · 로이 2026-10-15 「렌더링 중에 다른 대본을 보고 고치고 싶다」).
//   실제 앱에서 대본 A 의 「⚡ 만들기(무음)」를 돌리는 **도중**에 큐에서 대본 B 를 골라 문장을 고친다. 확인:
//   ① 제작이 끝까지 성공하고 결과가 A 폴더에만 생긴다 ② 화면(활성 대본)은 B 그대로 — 제작이 화면을 빼앗지 않는다
//   ③ B 를 보는 동안 A 의 DTO 가 화면으로 밀려오지 않는다 ④ B 의 고친 문장이 B .md 에만 들어간다(A .md 불변)
//   ⑤ B 를 보는 동안 끝난 A 의 진행(음성 연결)이 A 작업본(.smproj)에 저장된다(예전엔 A 를 다시 골라야 저장됐다)
// 안전: 임시 채널·임시 폴더·고유 대본 이름만 쓴다. 작업본(.smproj) 두 개는 끝나면 지운다(이 시험이 만든 것만).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'make-view-'));
const CH = '__테스트채널_삭제해도됨_mv' + process.pid;
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sec = (i, tag) => ['### 절 ' + i, '> 🖼️ 이미지: a quiet room number ' + i + ', soft light', '', Array.from({ length: 8 }, (_, k) => `${tag} ${i}번째 절의 ${k + 1}번째 문장이다.`).join(' '), '', ''].join('\n');
const A_NAME = `[테스트_mv${process.pid}A] 만드는 대본`;
const B_NAME = `[테스트_mv${process.pid}B] 보는 대본`;
const A_MD = ['# 만드는 대본', '', '## 첫째 마당', '', ...Array.from({ length: 60 }, (_, i) => sec(i + 1, '에이'))].join('\n');
const B_MD = ['# 보는 대본', '', '## 첫째 마당', '', ...Array.from({ length: 4 }, (_, i) => sec(i + 1, '비이'))].join('\n');
const C_NAME = `[테스트_mv${process.pid}C] 앞에 선 대본`;   // 작업 줄을 먼저 차지하는 대본(⚡ 가 줄을 서게)
const C_MD = ['# 앞에 선 대본', '', '## 첫째 마당', '', ...Array.from({ length: 30 }, (_, i) => sec(i + 1, '시이'))].join('\n');
const A_PATH = path.join(TMP, A_NAME + '.md'), B_PATH = path.join(TMP, B_NAME + '.md'), C_PATH = path.join(TMP, C_NAME + '.md');
fs.writeFileSync(C_PATH, C_MD, 'utf8');
fs.writeFileSync(A_PATH, A_MD, 'utf8'); fs.writeFileSync(B_PATH, B_MD, 'utf8');
const A_OUT = path.join(TMP, A_NAME), B_OUT = path.join(TMP, B_NAME);
const PROJ = path.join(os.homedir(), '.priming-maker', 'projects');
const snapOf = (name) => path.join(PROJ, name.replace(/[\\/:*?"<>|]/g, '_') + '.smproj.json');
const cleanSnaps = () => { for (const nm of [A_NAME, B_NAME, C_NAME]) { try { fs.rmSync(snapOf(nm), { force: true }); } catch (_) {} } };

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false;
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await win.waitForSelector('h1', { timeout: 20000 });
    const add = await win.evaluate(async ({ name, dir }) => {
      try { try { await window.api.addPreset({ name }); } catch (_) {} await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); return 'ok'; } catch (e) { return e.message; }
    }, { name: CH, dir: TMP });
    chMade = add === 'ok';
    ok(chMade, '임시 채널 생성: ' + add);

    const openOne = async (p) => {
      await app.evaluate(({ dialog }, fp) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] }); }, p);
      return win.evaluate(async (name) => { const r = await window.api.openScript({ presetName: name }); return r && r.dto ? { title: r.dto.fileTitle, queue: r.queue } : null; }, CH);
    };
    const oa = await openOne(A_PATH);
    const ob = await openOne(B_PATH);
    await openOne(C_PATH);
    const q = await win.evaluate(async () => (await window.api.selectQueueItem('__없음__', 'longform')).queue.longform);
    const idA = q.items.find((x) => /만드는 대본/.test(x.title || x.name || x.label || JSON.stringify(x)));
    const idB = q.items.find((x) => /보는 대본/.test(x.title || x.name || x.label || JSON.stringify(x)));
    ok(!!oa && !!ob && q.items.length === 3 && idA && idB, '세 대본을 큐에 열었다: ' + q.items.length + '개');

    // 🔴 작업 줄을 C 의 TTS 로 먼저 채운다 → A 의 ⚡ 는 줄을 선다. 줄을 서는 사이 B 를 골라도 A 가 만들어져야 한다(누른 순간의 대본)
    await win.evaluate((name) => { window.__blk = window.api.ttsBuild({ shortsNum: null, dry: true, presetName: name }).then(() => 'ok', (e) => 'ERR ' + e.message); }, CH);
    // A 를 골라 ⚡ 만들기(무음 · 음성만) 시작 — 기다리지 않는다
    await win.evaluate((id) => window.api.selectQueueItem(id, 'longform'), idA.id);
    await win.evaluate(() => { window.__pushes = []; window.api.onDtoUpdate((d) => window.__pushes.push({ t: Date.now(), title: (d && d.fileTitle) || '' })); });
    await win.evaluate((name) => {
      window.__job = window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 7, aiNotice: false, outMode: 'audio', openVrew: false })
        .then(() => { window.__jobDoneAt = Date.now(); return 'ok'; }, (e) => { window.__jobDoneAt = Date.now(); return 'ERR: ' + e.message; });
    }, CH);

    // 제작 도중 B 를 고른다(큐 클릭과 같은 IPC) → B 의 문장을 고친다
    const sel = await win.evaluate(async (id) => { const r = await window.api.selectQueueItem(id, 'longform'); return r && r.dto ? r.dto.fileTitle : null; }, idB.id);
    ok(/보는 대본/.test(sel || ''), '⚡ 를 누르자마자(줄 서는 중) B 로 전환: ' + sel);
    ok((await win.evaluate(() => window.__blk)) === 'ok', '앞선 C 작업 완료');
    await sleep(1500);   // A 제작이 문장 합성에 들어간 뒤
    const tView = Date.now();
    const ed = await win.evaluate(async () => { try { const r = await window.api.editSentences({ shortsNum: 1, groupNum: 1, sentIdx: 0, count: 1, text: '제작 중에 고친 비이 문장이다.' }); window.__editAt = Date.now(); return r && !r.error ? 'ok' : JSON.stringify(r && r.error); } catch (e) { return 'ERR ' + e.message; } });
    ok(ed === 'ok', '제작 도중 B 문장 고치기: ' + ed);
    const ov = await win.evaluate(() => ({ editAt: window.__editAt, jobDoneAt: window.__jobDoneAt || null }));
    ok(ov.editAt && (!ov.jobDoneAt || ov.editAt < ov.jobDoneAt), 'B 편집이 A 제작이 끝나기 전에 처리됨(진짜 겹침): ' + JSON.stringify(ov));

    const res = await win.evaluate(() => window.__job);
    ok(res === 'ok', '🔴 A 제작이 B 편집과 겹쳐도 끝까지 성공: ' + res);
    const tEnd = Date.now();

    // ② 화면은 B 그대로
    const after = await win.evaluate(async () => { const r = await window.api.selectQueueItem('__없음__', 'longform'); const it = r.queue.longform.items.find((x) => x.active); return { title: r.dto && r.dto.fileTitle, active: it && JSON.stringify(it) }; });
    ok(/보는 대본/.test(after.title || '') && /보는 대본/.test(after.active || ''), '제작이 끝나도 화면(활성)은 B: ' + after.title);
    // ③ B 를 보는 동안 A 의 DTO 가 밀려오지 않았다
    const pushes = await win.evaluate(({ a, b }) => window.__pushes.filter((p) => p.t >= a && p.t <= b).map((p) => p.title), { a: tView, b: tEnd });
    ok(!pushes.some((t) => /만드는 대본/.test(t)), 'B 를 보는 동안 A 의 DTO 가 화면으로 오지 않았다: [' + [...new Set(pushes)].join(', ') + ']');

    // ① 결과는 A 폴더에만
    const wavsA = fs.existsSync(path.join(A_OUT, 'tts-1')) ? fs.readdirSync(path.join(A_OUT, 'tts-1')).filter((f) => /\.(wav|mp3)$/i.test(f)) : [];
    const wavsB = fs.existsSync(path.join(B_OUT, 'tts-1')) ? fs.readdirSync(path.join(B_OUT, 'tts-1')).filter((f) => /\.(wav|mp3)$/i.test(f)) : [];
    ok(wavsA.length >= 450, 'A 음성이 A 폴더에 생성: ' + wavsA.length + '개');
    ok(wavsB.length === 0, 'B 폴더엔 음성이 생기지 않았다: ' + wavsB.length);
    // ④ .md
    ok(fs.readFileSync(A_PATH, 'utf8') === A_MD, 'A 대본(.md)은 그대로');
    const bNow = fs.readFileSync(B_PATH, 'utf8');
    ok(/제작 중에 고친 비이 문장이다/.test(bNow), 'B 대본(.md)에 고친 문장이 들어갔다');
    // ⑤ A 작업본에 진행이 저장됨(화면이 B 인 채로)
    await sleep(2500);   // 자동저장 디바운스
    let snapTts = 0;
    try { const sj = JSON.parse(fs.readFileSync(snapOf(A_NAME), 'utf8')); snapTts = JSON.stringify(sj).split('tts-1').length - 1; } catch (_) {}
    ok(snapTts >= 450, 'B 를 보는 동안 A 작업본(.smproj)에 음성 연결이 저장됨: tts 참조 ' + snapTts + '개');
    let snapB = '';
    try { snapB = fs.readFileSync(snapOf(B_NAME), 'utf8'); } catch (_) {}
    ok(!/에이 1번째 절/.test(snapB), 'B 작업본에 A 문장이 섞이지 않았다');

    // ⑥ 큐 순차 제작(run-batch) — main 은 activeId 를 바꾸지 않는다(v0.9.23). 📍 화면은 **렌더러가 따라간다**(v0.9.43 · 로이 「지금 작업 중인 대본을 보여 줘라」)
    try { fs.rmSync(path.join(A_OUT, 'tts-1'), { recursive: true, force: true }); } catch (_) {}
    await win.evaluate(() => { window.__pushes = []; });
    const tB0 = Date.now();
    const rb = await win.evaluate(async ({ id, name }) => {
      try {
        const r = await window.api.runBatch({ plan: [{ mode: 'longform', id, settings: { presetName: name } }], common: { dry: true, imgEngine: 'comfy::dummy.json', videoEngine: 'none', outMode: 'audio', presetName: name, captionMaxChars: 7 }, openEach: false });
        const act = r.queue.longform.items.find((x) => x.active);
        return { title: r.dto && r.dto.fileTitle, active: act && act.title, st: r.queue.longform.items.map((x) => x.status).join(',') };
      } catch (e) { return { err: e.message }; }
    }, { id: idA.id, name: CH });
    const tB1 = Date.now();
    { const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'); const rbSrc = M.slice(M.indexOf("ipcMain.handle('run-batch'"), M.indexOf('// 미리보기 오디오 — 파일을 base64'));
      ok(!rb.err && !/activeId\s*=/.test(rbSrc) && !/selectQueueItem/.test(rbSrc), 'main(run-batch) 은 화면(활성)을 스스로 옮기지 않는다(옮기는 것은 렌더러 따라가기 하나): ' + (rb.err || 'ok')); }
    await sleep(800);
    const fol = await win.evaluate(async () => { const r = await window.api.listQueue(); const it = r.queue.longform.items.find((x) => x.active); return it && it.title; });
    ok(/만드는 대본/.test(fol || ''), '📍 화면은 만드는 대본(A)을 따라갔다(렌더러 selectQueueItem): ' + fol);
    const wavsA2 = fs.existsSync(path.join(A_OUT, 'tts-1')) ? fs.readdirSync(path.join(A_OUT, 'tts-1')).filter((f) => /\.(wav|mp3)$/i.test(f)).length : 0;
    ok(wavsA2 >= 450, '큐 제작 결과는 A 폴더에: ' + wavsA2 + '개');
    const pushes2 = await win.evaluate(({ a, b }) => window.__pushes.filter((p) => p.t >= a && p.t <= b).map((p) => p.title), { a: tB0, b: tB1 });
    ok(pushes2.some((t) => /만드는 대본/.test(t)), '📍 따라간 뒤에는 A 의 DTO 가 화면으로 온다: [' + [...new Set(pushes2)].join(', ') + ']');

    // ⑦ 사람이 제작 중 다른 대본(B)을 누르면 따라가기를 멈춘다(v0.9.23 「사람은 제작 중 다른 대본을 보고 고친다」 유지)
    try { fs.rmSync(path.join(A_OUT, 'tts-1'), { recursive: true, force: true }); } catch (_) {}
    await win.evaluate(({ id, name }) => {
      window.__rb2 = 'running';
      window.api.runBatch({ plan: [{ mode: 'longform', id, settings: { presetName: name } }], common: { dry: true, imgEngine: 'comfy::dummy.json', videoEngine: 'none', outMode: 'audio', presetName: name, captionMaxChars: 7 }, openEach: false })
        .then(() => { window.__rb2 = 'ok'; }, (e) => { window.__rb2 = 'err ' + e.message; });
    }, { id: idA.id, name: CH });
    await win.waitForFunction(async () => { const r = await window.api.listQueue(); const it = r.queue.longform.items.find((x) => x.active); return it && /만드는 대본/.test(it.title); }, null, { timeout: 15000 }).catch(() => {});
    await win.locator('[data-testid="q-row"]', { hasText: '보는 대본' }).first().click();
    await sleep(600);
    await win.waitForFunction(() => window.__rb2 !== 'running', null, { timeout: 60000 }).catch(() => {});
    const act3 = await win.evaluate(async () => { const r = await window.api.listQueue(); const it = r.queue.longform.items.find((x) => x.active); return it && it.title; });
    ok(/보는 대본/.test(act3 || ''), '사람이 B 를 누르면 제작이 끝날 때까지 B 에 머문다(다시 A 로 끌려가지 않는다): ' + act3);


    const logText = await win.evaluate(() => (document.querySelector('#log') || {}).textContent || '');
    ok(!/is not defined/.test(logText), '로그에 미정의 오류 없음');
    ok(errs.length === 0, '화면 오류 0건' + (errs.length ? ': ' + errs[0] : ''));
  } finally {
    try {
      if (chMade) { const w2 = await app.firstWindow(); await w2.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, CH); }
    } catch (_) {}
    await app.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    cleanSnaps();
  }
  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 제작·보기 분리 E2E ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌ 실패:', e.message); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} cleanSnaps(); process.exit(1); });
