'use strict';
// node test/world-isolation.smoke.js — 🌐 롱폼 제작이 도는 중에 출판 탭을 자유롭게 쓴다(로이 2026-10-01).
//   실제 앱에서 「⚡ 만들기(무음)」를 돌리는 **도중**에 출판 모드로 전환 → 원고 열기 → 메타 수정 → 다시 롱폼으로 돌아와,
//   ① 제작이 끝까지 성공하고 ② 결과가 롱폼 폴더에만 생기고 ③ 출판 원고·롱폼 대본이 서로를 건드리지 않고
//   ④ 화면으로 오는 DTO 가 섞이지 않는지 본다(고치기 전 코드에서는 제작이 출판 원고를 읽거나 화면이 덮인다).
// 안전: 임시 채널·임시 폴더만 쓴다(사용자 작업물 무관). 로이 앱의 workspace.json 은 끝나면 되돌린다.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'world-iso-'));
const CH = '__테스트채널_삭제해도됨_w' + process.pid;
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WS = path.join(os.homedir(), '.priming-maker', 'workspace.json');
const WSL = path.join(os.homedir(), '.priming-maker', 'workspace.last.json');
const bak = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : null);
const wsBak = bak(WS), wslBak = bak(WSL);
const restoreWs = () => { try { if (wsBak) fs.writeFileSync(WS, wsBak); if (wslBak) fs.writeFileSync(WSL, wslBak); } catch (_) {} };   // 로이 앱의 큐 목록 복원

// 제작이 몇 초 걸리도록 문장을 넉넉히(무음 TTS = 문장마다 wav 한 개)
const sec = (i) => ['### 절 ' + i, '> 🖼️ 이미지: a quiet room number ' + i + ', soft light', '', Array.from({ length: 8 }, (_, k) => `이것은 ${i}번째 절의 ${k + 1}번째 문장이다.`).join(' '), '', ''].join('\n');
const LF = ['# 세계분리 점검 대본', '', '## 첫째 마당', '', ...Array.from({ length: 60 }, (_, i) => sec(i + 1))].join('\n');
const LF_PATH = path.join(TMP, '[테스트_0001] 세계 분리 롱폼.md');
fs.writeFileSync(LF_PATH, LF, 'utf8');
const BK = ['# 세계분리 책', '> 저자: 시험자', '> 출판사: 시험출판', '', '## 1장. 시작', '', '본문 첫 문단입니다.', '', '## 2장. 끝', '', '본문 둘째 문단입니다.', ''].join('\n');
const BK_PATH = path.join(TMP, '세계분리_책.md');
fs.writeFileSync(BK_PATH, BK, 'utf8');
const LF_OUT = path.join(TMP, path.basename(LF_PATH).replace(/\.md$/, ''));

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

    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, LF_PATH);
    const opened = await win.evaluate(async (name) => { const r = await window.api.openScript({ presetName: name }); return r && r.dto ? { groups: (r.dto.projects[0].cuts || []).length, title: r.dto.fileTitle } : null; }, CH);
    ok(!!opened && opened.groups >= 60, '롱폼 대본 열기 — 그룹 ' + (opened && opened.groups));

    // dto-update 기록기 — 출판 화면을 보는 동안 롱폼 DTO 가 화면으로 밀려오는지
    await win.evaluate(() => { window.__pushes = []; window.api.onDtoUpdate((d) => window.__pushes.push({ t: Date.now(), kind: d && d.kind ? d.kind : 'lf' })); });

    // 출판 원고를 미리 열어 둔다 — 롱폼으로 돌아온 뒤 출판 탭 버튼을 누르면 출판 DTO 를 받아야 한다
    const bk0 = await win.evaluate(async (p) => { const r = await window.api.openBookPath({ scriptPath: p }); return r && r.dto ? r.dto.kind : null; }, BK_PATH);
    ok(bk0 === 'book', '출판 원고 미리 열기: ' + bk0);
    await win.evaluate(() => window.api.setMode({ mode: 'longform' }));
    // ① 롱폼 제작 시작(기다리지 않는다)
    await win.evaluate((name) => {
      window.__job = window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 7, aiNotice: false, outMode: 'audio', openVrew: false })
        .then(() => { window.__jobDoneAt = Date.now(); return 'ok'; }, (e) => { window.__jobDoneAt = Date.now(); return 'ERR: ' + e.message; });
    }, CH);
    await sleep(1500);   // 제작이 문장 합성에 들어간 뒤
    const t0 = Date.now();

    // ② 그 도중 화면을 출판으로(실제 버튼) → 원고 열기 → 메타 수정 → 출판 IPC
    // 🖱 탭 버튼 클릭 — 제작 중엔 화면이 바빠 Playwright 의 click 대기가 굶는다(실측) → 버튼의 onClick 을 직접 일으킨다
    const clickTab = (label) => win.evaluate((t) => { const b = [...document.querySelectorAll('.modetoggle button')].find((x) => x.textContent.includes(t)); if (!b) throw new Error('탭 없음 ' + t); b.click(); }, label);
    await clickTab('📖 출판');
    await win.waitForSelector('.bktab', { timeout: 10000 });
    const tPush0 = Date.now();   // 화면이 출판으로 바뀐 뒤부터 센다(그 전의 롱폼 DTO 는 정상)
    ok(true, '제작 도중 출판 탭 버튼 → 출판 화면(원고 열려 있음)');
    const meta = await win.evaluate(async () => { const d = await window.api.bookSetMeta({ key: 'author', value: '수정된저자' }); window.__metaDoneAt = Date.now(); return d && d.meta && d.meta.author; });
    ok(meta === '수정된저자', '제작 도중 출판 메타 수정 반영: ' + meta);
    const outs = await win.evaluate(async () => Array.isArray(await window.api.bookOutputs()));
    ok(outs === true, '제작 도중 출판 IPC 응답(bookOutputs)');
    // 겹침 증거 — 출판 조작이 **롱폼 제작이 끝나기 전에** 끝났다(제작이 끝난 뒤에 처리된 게 아니다)
    const ov = await win.evaluate(() => ({ metaDoneAt: window.__metaDoneAt, jobDoneAt: window.__jobDoneAt || null }));
    ok(ov.metaDoneAt && (!ov.jobDoneAt || ov.metaDoneAt < ov.jobDoneAt), '출판 조작이 제작이 끝나기 전에 처리됨(진짜 겹침): ' + JSON.stringify(ov));
    // 출판 화면이 그대로 출판인지(롱폼 DTO 에 덮이지 않았는지)
    const bkUi = await win.evaluate(() => ({ wrap: !!document.querySelector('.bkwrap'), empty: !!document.querySelector('.bkempty'), tabs: document.querySelectorAll('.bktab').length }));
    ok(bkUi.wrap && bkUi.tabs === 6 && !bkUi.empty, '제작이 도는 동안에도 출판 화면이 정상(메뉴 6탭 · 빈 화면 아님): ' + JSON.stringify(bkUi));
    // 화면을 덮으려는 다른 세계의 DTO 가 와도(시뮬레이션) 버린다
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('dto-update', { fileTitle: '가짜 롱폼 DTO', projects: [], timings: {} }); });
    await sleep(400);
    const bkUi2 = await win.evaluate(() => ({ tabs: document.querySelectorAll('.bktab').length, empty: !!document.querySelector('.bkempty') }));
    ok(bkUi2.tabs === 6 && !bkUi2.empty, '출판을 보는 중 롱폼 DTO 가 밀려와도 화면이 덮이지 않는다(렌더러 가드)');
    const t1 = Date.now();
    const pushes = await win.evaluate(({ a, b }) => window.__pushes.filter((p) => p.t >= a && p.t <= b).map((p) => p.kind), { a: tPush0, b: t1 });
    ok(pushes.filter((k) => k !== 'book').length <= 1, '출판을 보는 동안 main 이 롱폼 DTO 를 밀어 보내지 않는다(예외: 위 시뮬레이션 1건): [' + pushes.join(',') + ']');

    // ③ 롱폼으로 돌아온다(실제 버튼) — 제작은 계속
    await clickTab('롱폼');
    const res = await win.evaluate(() => window.__job);
    ok(res === 'ok', '🔴 롱폼 제작이 출판 조작과 겹쳐도 끝까지 성공: ' + res + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + 's 동안 겹침)');

    // ④ 결과 — 롱폼 폴더에만
    const ttsDir = path.join(LF_OUT, 'tts-1');
    const wavs = fs.existsSync(ttsDir) ? fs.readdirSync(ttsDir).filter((f) => /\.(wav|mp3)$/i.test(f)) : [];
    ok(wavs.length >= 450, '무음 음성이 롱폼 폴더에 생성: ' + wavs.length + '개');
    const stray = fs.readdirSync(TMP).filter((f) => f !== path.basename(LF_PATH) && f !== path.basename(BK_PATH) && f !== path.basename(LF_OUT));
    ok(!stray.some((f) => /^(tts|media)-/.test(f)), '출판 쪽에 롱폼 산출물이 새지 않았다: [' + stray.join(', ') + ']');
    const bkText = fs.readFileSync(BK_PATH, 'utf8');
    ok(/저자: 수정된저자/.test(bkText) && /본문 둘째 문단/.test(bkText), '출판 원고(.md)는 출판 수정만 반영되고 온전하다');
    ok(fs.readFileSync(LF_PATH, 'utf8') === LF, '롱폼 대본(.md)은 그대로다');

    // ⑤ 두 큐가 각자 온전한지
    const back = await win.evaluate(async () => { const r = await window.api.setMode({ mode: 'longform' }); return { title: r.dto && r.dto.fileTitle, groups: r.dto && r.dto.projects ? r.dto.projects[0].cuts.length : 0, lf: r.queue.longform.items.length, bk: r.queue.book.items.length }; });
    ok(back.groups >= 60 && /세계 분리 롱폼/.test(back.title || ''), '롱폼으로 돌아오면 롱폼 대본이 그대로: ' + back.title + ' · 그룹 ' + back.groups);
    ok(back.lf === 1 && back.bk === 1, '큐: 롱폼 1 · 출판 1 (서로 섞이지 않음)');
    const again = await win.evaluate(async () => { const r = await window.api.setMode({ mode: 'book' }); return { kind: r.dto && r.dto.kind, author: r.dto && r.dto.meta && r.dto.meta.author }; });
    ok(again.kind === 'book' && again.author === '수정된저자', '출판으로 다시 가면 출판 원고가 그대로: ' + JSON.stringify(again));

    // ⑥ 로그에 세계 혼선 흔적이 없다
    const logText = await win.evaluate(() => (document.querySelector('#log') || {}).textContent || '');
    ok(!/열린 출판 원고가 없습니다/.test(logText) && !/is not defined/.test(logText), '로그에 세계 혼선 흔적 없음');
    ok(errs.length === 0, '화면 오류 0건' + (errs.length ? ': ' + errs[0] : ''));
  } finally {
    try {
      if (chMade) { const w2 = await app.firstWindow(); await w2.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, CH); }
    } catch (_) {}
    await app.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    restoreWs();
  }
  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 세계 분리 E2E ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌ 실패:', e.message); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} restoreWs(); process.exit(1); });
