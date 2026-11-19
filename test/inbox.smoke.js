'use strict';
// node test/inbox.smoke.js — 📥 받은 편지함 = 1.0 자동 넘김(v1.0.57) 실제 앱 E2E
//   ① 꺼진 상태에서 쪽지를 놓고 `--inbox` 로 켠다 → 누가 누르지 않아도 받은 편을 큐에 넣고 바로 만든다(무음 · 음성만) → 처리됨
//   ② 거절 사유(꼴 오류 · 대본 파일 없음 · 패키징 미완 · 채널 없음 · 이미 큐에 있음 · 이미 만들었음) → 거절 폴더에 reason
//   ③ ⏸ 자동 제작 멈춤 → 쪽지를 쌓아 둔다 → 풀면 이어 간다 · 화면 단추
//   ④ 이어 받기 — 앱이 꺼지기 전에 받아 둔 편(진행중 쪽지)을 다시 켜면 이어 만든다 · 만드는 중에 온 편도 이어서
//   ⑤ 한 번만 켜진다 — 두 번째 실행(--inbox)은 곧바로 끝나고 켜진 앱이 받는다 · progress.json
// 안전: PM_UI_SMOKE(큐·저장 공간 = 임시) · PM_INBOX_HOME(받은 편지함·progress = 임시) · 임시 채널(__…)·임시 폴더 · 작업본은 끝나면 지운다.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-e2e-'));
const HOME = path.join(TMP, 'home'), INBOX = path.join(HOME, 'inbox'), THUMBS = path.join(TMP, 'thumbs');
const CH = '__테스트채널_삭제해도됨_ib' + process.pid;
const CHDIR = path.join(TMP, 'ch'), OUT = path.join(TMP, 'out');
const CH2 = CH + '_밖', CHDIR2 = path.join(TMP, 'ch2');   // 받을 채널 목록에 없는 채널(시범 채널 아님)
const ENV = { ...process.env, PM_UI_SMOKE: '1', PM_INBOX_HOME: HOME, PM_INBOX_THUMBS: THUMBS, PM_INBOX_DRY: '1' };
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const w = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t, 'utf8'); return p; };
const PACK_FULL = '# p\n\n## 제목\n좋은 제목\n\n## 썸네일 문구 A\n| 줄 | 색 |\n|---|---|\n| 첫 줄 | 흰색 |\n\n## 설명글\n```\n설명입니다\n```\n\n## 태그\n```\n가, 나\n```\n\n## 고정댓글\n```\n댓글\n```\n';
const tag = String(process.pid).slice(-3);
const NAMES = [];
// 편 하나 = 대본 + 패키징 + 썸네일 A (full=false 면 패키징 앞쪽만)
const NL = String.fromCharCode(10);
function episode(code, { pack = true, full = true, thumb = true, sections = 1 } = {}) {
  const name = `[테${tag}_${code}] 자동 넘김 시험 ${code}`;
  NAMES.push(name);
  const sec = (k) => ['### 절 ' + k, '> 🖼️ 이미지: a quiet room number ' + k + ', soft light', '', Array.from({ length: sections > 1 ? 8 : 2 }, (_, j) => `받은 편지함 ${code}번 ${k}절 ${j + 1}번째 문장이다.`).join(' '), ''].join(NL);
  const md = ['# 자동 넘김 ' + code, '', '## 첫째 마당', '', ...Array.from({ length: sections }, (_, k) => sec(k + 1))].join(NL);
  const sp = w(path.join(CHDIR, '대본', '2026_11', name + '.md'), md);
  const pk = path.join(CHDIR, '패키징', '2026_11', name + '.md');
  if (pack) w(pk, full ? PACK_FULL : '# p\n\n## 제목\n제목\n\n## 썸네일 문구 A\n첫 줄\n');
  const th = path.join(THUMBS, `[테${tag}_${code}] 썸네일_A.png`);
  if (thumb) w(th, 'png');
  return { name, sp, pk, th, key: `테${tag}_${code}` };
}
let seq = 0;
function note(ep, extra = {}, fileName = null) {
  const at = '2026-11-17 0' + Math.min(9, 1 + Math.floor(seq / 10)) + ':' + String(10 + (seq % 50)).padStart(2, '0');
  seq++;
  const f = path.join(INBOX, fileName || `${ep ? ep.key : 'x'}_${seq}.json`);
  const tmp = f + '.tmp';
  w(tmp, JSON.stringify({ ver: 1, kind: 'render', script: ep && ep.sp, packaging: ep && ep.pk, thumbnails: ep ? [ep.th] : [], key: ep && ep.key, publishAt: '2026-11-23 19:00', from: 'E2E', at, ...extra }));
  fs.renameSync(tmp, f);   // 채널사업부와 같은 원자적 쓰기
  return f;
}
const listDir = (d) => { try { return fs.readdirSync(d).filter((x) => /\.json$/.test(x)); } catch (_) { return []; } };
const readJ = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const rejects = () => listDir(path.join(INBOX, '거절')).map((f) => ({ f, ...readJ(path.join(INBOX, '거절', f)) }));
const dones = () => listDir(path.join(INBOX, '처리됨')).map((f) => ({ f, ...readJ(path.join(INBOX, '처리됨', f)) }));
async function until(fn, ms, step = 500) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (_) {} await sleep(step); } return null; }
const PROJ = path.join(os.homedir(), '.priming-maker', 'projects');
const cleanSnaps = () => { for (const nm of NAMES) { try { fs.rmSync(path.join(PROJ, nm.replace(/[\\/:*?"<>|]/g, '_') + '.smproj.json'), { force: true }); } catch (_) {} } };

async function launch(args = [], env = ENV) {
  const app = await electron.launch({ args: [ROOT, ...args], env });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1366, height: 768 }).catch(() => {});
  await win.waitForSelector('h1', { timeout: 30000 });
  await app.evaluate(({ dialog }) => { global.__boxes = []; dialog.showMessageBox = async (_w, o) => { global.__boxes.push(String((o && (o.title || o.message)) || '')); return { response: 0 }; }; });
  return { app, win };
}

(async () => {
  let A = null;
  try {
    // ⓪ 임시 채널(대본 폴더 = 시험 폴더) — 받은 편지함이 빈 채로 한 번 켜서 만든다
    fs.mkdirSync(INBOX, { recursive: true });
    A = await launch();
    const add = await A.win.evaluate(async ({ name, dir, out }) => {
      try { try { await window.api.addPreset({ name }); } catch (_) {} await window.api.savePreset({ name, patch: { outputFolder: out, outLong: out, scriptFolder: dir, ytAuto: false, ytChannelId: '' } }); return 'ok'; } catch (e) { return e.message; }
    }, { name: CH, dir: CHDIR, out: OUT });
    ok(add === 'ok', '⓪ 임시 채널: ' + add);
    await A.win.evaluate(async ({ name, dir, out }) => { try { await window.api.addPreset({ name }); } catch (_) {} await window.api.savePreset({ name, patch: { outputFolder: out, outLong: out, scriptFolder: dir, ytAuto: false, ytChannelId: '' } }); }, { name: CH2, dir: CHDIR2, out: OUT });
    // 🛡 자동 제작은 업로드채널이 있으면 올린다(v1.0.66) — 시험 채널이 복사 원본의 진짜 업로드채널을 물려받았으면 여기서 멈춘다
    { const chk = await A.win.evaluate(async (names) => { const out = {}; for (const nm of names) { try { const p = await window.api.getPresetDetail(nm); out[nm] = p ? (p.ytChannelId || '') : '?없음'; } catch (e) { out[nm] = '?' + e.message; } } return out; }, [CH, CH2]);
      const leak = Object.values(chk).some((v) => v);
      ok(!leak, '⓪ 시험 채널에 업로드채널 없음(진짜 유튜브에 올리지 않게) ' + JSON.stringify(chk));
      if (leak) throw new Error('시험 채널에 업로드채널이 남아 있어 멈춥니다'); }
    w(path.join(HOME, 'auto-make.json'), JSON.stringify({ paused: false, allowChannels: [CH] }));   // 시험 채널만 받는다(기본은 고전 하나)
    await A.app.close(); A = null;

    // ① 꺼진 상태에서 쪽지를 놓는다(오래된 것부터 · 섞어서)
    const e1 = episode('1123');
    const e2 = episode('1124');
    const eNoPack = episode('1125', { full: false });
    const eNoThumb = episode('1126', { thumb: false });
    const eMade = episode('1127');
    fs.mkdirSync(path.join(OUT, eMade.name), { recursive: true }); w(path.join(OUT, eMade.name, eMade.name + '.vrew'), 'x');   // 이미 만든 편
    const outside = w(path.join(TMP, 'elsewhere', '대본', '[테' + tag + '_1128] 채널밖.md'), '# x\n');
    const f1 = note(e1);
    const fDup = note(e1, {}, 'dup_' + e1.key + '.json');                 // 같은 대본 두 번 → 이미 큐에 있음
    const fBad = w(path.join(INBOX, 'broken.json'), '{"ver":1,'); { const t = (Date.now() - 60000) / 1000; fs.utimesSync(fBad, t, t); }
    const fKind = note(e2, { kind: 'order' }, 'kind.json');
    const fNoScript = note(e2, { script: e2.sp.replace('1124', '1199') }, 'noscript.json');
    note(eNoPack, {}, 'nopack.json');
    note(eNoThumb, {}, 'nothumb.json');
    note(eMade, {}, 'made.json');
    note(null, { script: outside, key: 'out' }, 'nochannel.json');
    const e2nd = w(path.join(CHDIR2, '2026_11', '[테' + tag + '_1129] 다른채널.md'), '# x' + NL);
    note(null, { script: e2nd, key: 'pilot' }, 'notpilot.json');
    const f2 = note(e2);
    // ⬆ kind "upload"(v1.0.66) — 시험 채널엔 업로드채널이 없다 → 만들지 않고 「업로드채널 없음」 으로 거절(⛔ 진짜 유튜브 업로드는 시험하지 않는다)
    const eUp = episode('1130');
    note(eUp, { kind: 'upload' }, 'upnoch.json');
    void f1; void fDup; void fKind; void fNoScript; void f2;

    const T0 = Date.now();
    A = await launch(['--inbox']);   // 🔴 창이 보이는 평소 실행 + --inbox(⛔ PM_HEADLESS 아님)
    ok(!(await A.app.evaluate(() => process.env.PM_HEADLESS === '1')), '① --inbox 는 무인 실행이 아니다(창이 있는 화면 앱)');
    const doneBoth = await until(() => { const d = dones(); return d.length >= 2 ? d : null; }, 120000);
    ok(!!doneBoth, `누르지 않아도 받은 편 2편을 만들어 처리됨으로 (${Math.round((Date.now() - T0) / 1000)}초) — ${doneBoth ? doneBoth.map((x) => x.f).join(', ') : listDir(path.join(INBOX, '처리됨')).join(',')}`);
    if (doneBoth) {
      ok(doneBoth.every((x) => x.result === '성공' && x.priming && x.priming.channel === CH), '처리됨 쪽지에 결과·채널');
      ok(fs.existsSync(path.join(OUT, e1.name, e1.name + '.vrew')) && fs.existsSync(path.join(OUT, e2.name, e2.name + '.vrew')), '두 편 모두 .vrew 가 나왔다(채널 출력 폴더)');
      const order = doneBoth.sort((a, b) => (a.doneAt < b.doneAt ? -1 : 1)).map((x) => x.key);
      ok(order[0] === e1.key, '오래된 쪽지부터 만들었다: ' + order.join(' → '));
    }
    const R = rejects();
    const why = (re) => (R.find((x) => re.test(x.f)) || {}).reason;
    ok(why(/^broken/) === '꼴 오류', '② 깨진 JSON = 꼴 오류');
    ok(why(/^kind/) === '꼴 오류', 'kind 틀림 = 꼴 오류');
    ok(why(/^noscript/) === '대본 파일 없음', '대본 파일 없음');
    ok(why(/^nopack/) === '패키징 미완', '패키징 앞쪽만 = 패키징 미완 — ' + ((R.find((x) => /^nopack/.test(x.f)) || {}).detail || ''));
    ok(why(/^nothumb/) === '패키징 미완' && /썸네일/.test((R.find((x) => /^nothumb/.test(x.f)) || {}).detail || ''), '썸네일 A 없음 = 패키징 미완 — ' + ((R.find((x) => /^nothumb/.test(x.f)) || {}).detail || ''));
    ok(why(/^made/) === '이미 만들었음', '이미 만들었음');
    ok(why(/^nochannel/) === '채널 없음', '채널 없음');
    ok(why(/^notpilot/) === '시범 채널 아님', '받을 채널 목록에 없는 채널 = 시범 채널 아님 — ' + ((R.find((x) => /^notpilot/.test(x.f)) || {}).detail || ''));
    ok(why(/^dup_/) === '이미 큐에 있음', '같은 대본 두 번째 쪽지 = 이미 큐에 있음');
    ok(why(/^upnoch/) === '업로드채널 없음', '⬆ 업로드 쪽지 — 채널에 업로드채널이 없으면 거절(만들지 않음)');
    ok(!fs.existsSync(path.join(OUT, eUp.name, eUp.name + '.vrew')), '⬆ 업로드 쪽지 편은 만들지 않았다');
    ok(listDir(INBOX).length === 0, '받은 편지함 바로 아래가 비었다(모두 처리됨·거절로)');
    const boxes = await A.app.evaluate(() => global.__boxes || []);
    ok(!boxes.length, '자동 제작 중 묻는 창이 하나도 없었다: [' + boxes.join(' | ') + ']');
    const q1 = await A.win.evaluate(async () => (await window.api.listQueue()).queue.longform.items.map((x) => ({ t: x.title, s: x.status })));
    ok(q1.length === 2 && q1.every((x) => x.s === 'done'), '큐(화면)에 받은 편 2편 · 둘 다 완료: ' + JSON.stringify(q1));
    const pg = readJ(path.join(HOME, 'progress.json'));
    ok(pg.auto && pg.auto.on && !pg.auto.paused && pg.finished.filter((x) => x.result === '성공').length === 2 && /^\d{4}-\d{2}-\d{2} /.test(pg.at), '⑤ progress.json — 끝난 편 2 · 자동 켬 · KST');
    const btn = await A.win.locator('[data-testid="auto-make-btn"]');
    ok(await btn.count() === 1 && /자동 멈춤/.test(await btn.textContent()), '머리에 「⏸ 자동 멈춤」 단추');
    { const b = await btn.boundingBox(); ok(!!b && await A.win.evaluate(({ x, y }) => !!(document.elementFromPoint(x, y) || {}).closest?.('[data-testid="auto-make-btn"]'), { x: b.x + b.width / 2, y: b.y + b.height / 2 }), '단추가 1366px 에서 보이고 눌리는 자리'); }

    // ③ 멈춤 — 화면 단추로
    await btn.click();
    await until(async () => /자동 풀기/.test(await btn.textContent()), 5000, 200);
    ok(/자동 풀기/.test(await btn.textContent()) && readJ(path.join(HOME, 'auto-make.json')).paused === true && readJ(path.join(HOME, 'auto-make.json')).allowChannels.join() === CH, '③ 누르면 멈춤(이 PC 에 저장) · 단추가 「▶ 자동 풀기」');
    const e3 = episode('1129');
    note(e3);
    await sleep(12000);
    ok(listDir(INBOX).length === 1 && !dones().some((x) => x.key === e3.key), '멈춤 동안 쪽지는 큐에 넣지 않고 쌓아 둔다');
    ok(readJ(path.join(HOME, 'progress.json')).waiting === 1, 'progress.json 에 쌓인 쪽지 1');
    await btn.click();
    const d3 = await until(() => dones().find((x) => x.key === e3.key), 90000);
    ok(!!d3, '풀면 쌓인 쪽지를 이어 만든다');

    // ④-a 만드는 중에 온 편도 이어서(한 번의 자동 제작 안에서)
    const e4 = episode('1130', { sections: 40 }), e5 = episode('1201');   // e4 는 길게(320문장) — 만드는 도중에 e5 가 온다
    const st0 = await A.win.evaluate(() => window.api.inboxState());
    note(e4);
    await until(() => A.win.evaluate(async () => (await window.api.inboxState()).running), 30000, 300);
    note(e5);
    const d45 = await until(() => { const d = dones(); return d.some((x) => x.key === e4.key) && d.some((x) => x.key === e5.key); }, 120000);
    ok(!!d45, '④ 만드는 중에 받은 편도 이어서 만든다');
    const st1 = await A.win.evaluate(() => window.api.inboxState());
    ok(st1.batches - st0.batches === 1 && st1.extended - st0.extended === 1, `같은 자동 제작 안에서 이어 붙였다(새로 시작 ${st1.batches - st0.batches}번 · 이어 붙임 ${st1.extended - st0.extended}편)`);

    // ④-d 🔁 render + redo(v1.0.67) — 대본이 옛 .vrew 보다 오래되면 거절 · 고치면 옛 것을 _구판 으로 옮기고 다시 만든다(큐에 완료로 남은 옛 항목은 빼고 새로)
    { const v1 = path.join(OUT, e1.name, e1.name + '.vrew');
      note(e1, { redo: true }, 'redo_old.json');
      const rj = await until(() => rejects().find((x) => /^redo_old/.test(x.f)), 20000);
      ok(rj && rj.reason === '대본이 MP4 보다 새롭지 않음' && fs.existsSync(v1), '🔁 redo — 대본을 안 고쳤으면 거절(옛 .vrew 그대로): ' + (rj && rj.reason));
      const vOld = fs.statSync(v1).mtimeMs;
      fs.appendFileSync(e1.sp, NL + '### 절 고침' + NL + '> 🖼️ 이미지: a quiet room, soft light' + NL + NL + '고친 대본에 새로 넣은 문장이다.' + NL);
      const before = dones().filter((x) => x.key === e1.key).length;
      note(e1, { redo: true }, 'redo_new.json');
      const dr = await until(() => dones().filter((x) => x.key === e1.key).length > before, 120000);
      const gu = path.join(OUT, e1.name, '_구판');
      const olds = fs.existsSync(gu) ? fs.readdirSync(gu).flatMap((d) => fs.readdirSync(path.join(gu, d))) : [];
      ok(!!dr && olds.includes(e1.name + '.vrew'), '🔁 고친 대본 redo → 처리됨 · 옛 .vrew 는 _구판\\<KST>\\ 에(지우지 않음): ' + JSON.stringify(olds));
      ok(fs.existsSync(v1) && fs.statSync(v1).mtimeMs > vOld, '🔁 새 .vrew 를 다시 만들었다');
      const q2 = await A.win.evaluate(async (t) => (await window.api.listQueue()).queue.longform.items.filter((x) => x.title === t || (x.scriptPath || '').includes(t)).length, e1.name);
      ok(q2 === 1, '🔁 큐에 같은 대본이 하나만(옛 항목을 빼고 새로 열었다): ' + q2); }

    // ④-c ■ 중단은 자동 제작보다 이긴다 — 멈춘 편은 다시 저절로 시작하지 않고(보류), 「▶ 자동 이어 가기」로 이어 간다
    const e7 = episode('1203', { sections: 40 });
    note(e7);
    await until(() => A.win.evaluate(async () => (await window.api.inboxState()).running), 30000, 300);
    await sleep(800);
    await A.win.evaluate(() => window.api.abort());
    const held = await until(() => A.win.evaluate(async () => { const s = await window.api.inboxState(); return !s.running && s.hold ? s : null; }), 120000, 500);   // 무음 제작은 중단을 문장 사이에서만 본다(실측 약 37초)
    ok(!!held && /중단/.test(held.hold), '④ ■ 중단 → 자동 제작 보류: ' + (held && held.hold));
    await sleep(12000);
    ok(!dones().some((x) => x.key === e7.key) && listDir(path.join(INBOX, '진행중')).length === 1 && !(await A.win.evaluate(async () => (await window.api.inboxState()).running)), '보류 동안 다시 저절로 시작하지 않는다(쪽지는 진행중에 그대로)');
    ok(/자동 이어 가기/.test(await btn.textContent()), '단추 = 「▶ 자동 이어 가기」');
    await btn.click();
    const d7 = await until(() => dones().find((x) => x.key === e7.key), 120000);
    ok(!!d7 && /자동 멈춤/.test(await btn.textContent()), '누르면 남은 편을 이어 만들고 단추가 돌아온다');

    const electronExe = require('electron');
    await A.app.close(); A = null;

    // ④-b 이어 받기 — 꺼지기 전에 받아 둔 편(진행중)을 켜면 이어 만든다 + 단일 실행 잠금(PM_SINGLE_TEST)
    const e6 = episode('1202');
    w(path.join(INBOX, '진행중', e6.key + '.json'), JSON.stringify({ ver: 1, kind: 'render', script: e6.sp, key: e6.key, at: '2026-11-17 05:00', priming: { acceptedAt: '2026-11-17 05:01', channel: CH } }));
    A = await launch([], { ...ENV, PM_SINGLE_TEST: '1' });
    const sec = await new Promise((res) => {
      const t0 = Date.now();
      const c = spawn(electronExe, [ROOT, '--inbox'], { env: { ...ENV, PM_SINGLE_TEST: '1' }, stdio: 'ignore' });
      const kill = setTimeout(() => { try { c.kill(); } catch (_) {} res({ code: 'timeout', ms: Date.now() - t0 }); }, 20000);
      c.on('exit', (code) => { clearTimeout(kill); res({ code, ms: Date.now() - t0 }); });
    });
    ok(sec.code === 0 && sec.ms < 15000, `⑤ 두 번째 실행은 곧바로 끝난다(코드 ${sec.code} · ${sec.ms}ms)`);
    const gotSecond = await until(() => A.app.evaluate(() => global.__pmSecondN || 0), 5000, 200);
    ok(gotSecond >= 1, '켜진 앱이 두 번째 실행의 --inbox 를 받았다');
    const d6 = await until(() => dones().find((x) => x.key === e6.key), 90000);
    ok(!!d6 && !listDir(path.join(INBOX, '진행중')).length, '④ 다시 켜면 진행중 쪽지(꺼지기 전에 받은 편)를 큐에 넣고 이어 만든다');
    const finalPg = readJ(path.join(HOME, 'progress.json'));
    ok(finalPg.current === null && finalPg.queued.length === 0, 'progress.json — 다 끝나면 지금 편 없음 · 남은 편 없음');
  } catch (e) { bad++; console.log('  ✗ 예외: ' + (e && e.stack || e)); }
  finally {
    if (A) { try { await A.app.close(); } catch (_) {} }
    // 임시 채널 지우기(다시 켜서 IPC 로)
    try {
      const C = await launch();
      for (const nm of [CH, CH2]) await C.win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, nm);
      await C.app.close();
    } catch (_) {}
    cleanSnaps();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(`\n${bad ? '❌' : '✅'} 받은 편지함 E2E ${n - bad}/${n}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
