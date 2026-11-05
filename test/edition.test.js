'use strict';
/**
 * node test/edition.test.js — 🏠 로이판 / 🛒 판매판 나누기(v1.0.26 · docs/판나누기-설계.md ⑤)
 *   [1] core/edition 판정 — 로이판은 예전과 같다(관리자 전용 4개만 isOwner · 나머지 열림) · 판매판은 로이 전용 0
 *   [2] main.js — 관리자 전용 기능 판정이 feat() 로 옮겨졌다(isOwner() 는 관리자 계정 판정 3곳만)
 *   [3] 판매판 매니페스트 — 로이 전용 파일·내부 문서 0 · 작성 기준만 예외 · ref·edition·remove
 *   [4] 금지 문자열 0(로이 PC 경로·로이은행·분석 프로젝트·kie 결제) — 판매판 파일 전부
 *   [5] 판별력 — 금지 파일·금지 문자열을 넣으면 실제로 실패한다
 *   [6] 정적 — 판매판 파일이 빠진 파일을 맨 위에서 require 하지 않는다
 *   [7] 판매판 파일만 임시 폴더에 복사 → 앱이 켜지고(출판·리모션 탭 없음 · 빠진 IPC = 「이 판에는 없는 기능」) · 2.0 무인 입구 거절 · 롱폼 무음 만들기(test:makeall 그대로)
 *   `--member-manifest <파일>` = 주어진 판매판 매니페스트만 검사([3]~[5] · release:member 가 부른다)
 *   `--no-e2e` = [7] 건너뜀
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const ED = require('../core/edition');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('  ✓ ' + m); else { bad++; console.log('  ✗ ' + m); } };
const argOf = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };

const FORBIDDEN = [/D:[\\/]+## 아도나이로이/i, /D:[\\/]+TTS_Model/i, /D:[\\/]+## 출판/i, /로이은행/, /adonairoy/i, /kie\.ai\/billing/i];
const BINARY = /\.(png|jpe?g|webp|gif|ico|ttf|otf|bin|vbin|mp3|wav)$/i;

/** 판매판 매니페스트 검사 — 문제 목록(빈 배열 = 통과) · readFile(rel) → 텍스트 */
function checkMember(m, readFile) {
  const probs = [];
  if (!m || m.edition !== 'member') probs.push('edition 이 member 가 아님');
  if (!/^[0-9a-f]{40}$/.test((m && m.ref) || '')) probs.push('ref(커밋 sha 40자) 없음');
  for (const rel of Object.keys((m && m.files) || {})) {
    const id = ED.fileFeature(rel);
    if (id && !ED.has(id, 'member')) probs.push('로이 전용 파일: ' + rel + ' (' + id + ')');
    if (!ED.inEditionFile(rel, 'member')) probs.push('내부 문서·도구: ' + rel);
    if (BINARY.test(rel)) continue;
    let t = '';
    try { t = readFile(rel); } catch (_) { continue; }
    for (const re of FORBIDDEN) if (re.test(t)) probs.push('금지 문자열 ' + re + ' — ' + rel);
  }
  return probs;
}
const readRoot = (rel) => fs.readFileSync(path.join(ROOT, rel.split('/').join(path.sep)), 'utf8');

(async () => {
  const given = argOf('--member-manifest');
  if (!given) {
    console.log('[1] core/edition 판정');
    const OWN = ['charSheets', 'ytCookie', 'localQwen', 'gpuTemp'];   // 예전에 isOwner() 로 막던 것
    for (const own of [true, false]) {
      const f = ED.features(() => own, 'studio');
      ok(Object.keys(ED.FEATURES).every((id) => f[id] === (OWN.includes(id) ? own : true)), `로이판(${own ? '관리자' : '회원 계정'}) = 예전과 같다(관리자 전용 ${OWN.length}개만 계정 따라)`);
      const g = ED.features(() => own, 'member');
      ok(Object.values(g).every((v) => v === false), `판매판(${own ? '관리자' : '회원'}) = 로이 전용 기능 0`);
    }
    ok(ED.channelFeature('book-mail-auto') === 'book' && ED.channelFeature('open-book-script') === 'book' && ED.channelFeature('remotion-run-tts') === 'remotion'
      && ED.channelFeature('yt-login-status') === 'ytCookie' && ED.channelFeature('list-thumbs') === 'thumbEdit' && ED.channelFeature('qwen-design-start') === 'qwenDesign', '채널 → 기능');
    ok(ED.channelFeature('make-all') === null && ED.channelFeature('open-script') === null && ED.channelFeature('license-state') === null, '롱폼·회원 채널은 막지 않는다');
    const mr = ED.missingReply('ytCookie');
    ok(mr.ok === false && mr.missing && mr.allowed === false && /이 판에는 없는/.test(mr.error), '빠진 기능 답 = 「이 판에는 없는 기능」 + 화면이 기대하는 꼴');
    const T0 = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-'));
    ok(ED.readEdition(T0) === 'studio', 'edition.json 없음 = studio');
    fs.writeFileSync(path.join(T0, 'edition.json'), '{"edition":"member"}'); ok(ED.readEdition(T0) === 'member', 'edition.json = member');
    fs.writeFileSync(path.join(T0, 'edition.json'), '{"edition":"gold"}'); ok(ED.readEdition(T0) === 'studio', '모르는 값 = studio');
    // 🏠🛒 한 PC 에 두 판(v1.0.27) — dataHome 은 이름 하나만(경로·.. 거부) · 없으면 null(진짜 회원·로이판 = 예전 그대로)
    ok(ED.readDataHome(T0) === null, 'dataHome 없음 = null');
    fs.writeFileSync(path.join(T0, 'edition.json'), '{"edition":"member","dataHome":"PrimingMember"}'); ok(ED.readDataHome(T0) === 'PrimingMember', 'dataHome = 이름');
    ok(['..', '../x', 'C:\\\\x', 'a/b', ''].every((d) => { fs.writeFileSync(path.join(T0, 'edition.json'), JSON.stringify({ edition: 'member', dataHome: d })); return ED.readDataHome(T0) === null; }), 'dataHome 경로·.. 는 거부');
    fs.rmSync(T0, { recursive: true, force: true });
    const dm = fs.readFileSync(path.join(ROOT, 'scripts', 'dist-member.js'), 'utf8');
    ok(/--preview/.test(dm) && /com\.user\.priming\.memberpreview/.test(dm) && /dataHome: 'PrimingMember'/.test(dm) && !/writeFileSync\(path\.join\(ROOT, 'edition\.json'\)/.test(dm), 'dist:member:preview = 다른 appId·데이터 폴더 · 저장소에 edition.json 을 쓰지 않는다');
    ok(ED.EDITION === 'studio' && !fs.existsSync(path.join(ROOT, 'edition.json')), '이 저장소는 로이판(edition.json 없음)');
    const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    ok(/^\/edition\.json$/m.test(gi), 'edition.json 은 저장소에 넣지 않는다(.gitignore)');
    const px = ED.optional('book', () => ({ a: 1 }));
    ok(px.a === 1, 'optional — 판에 있으면 그대로 require');
    ED._setEdition('member');
    const pm = ED.optional('book', () => { throw new Error('부르면 안 됨'); });
    let thrown = null; try { pm.foo(); } catch (e) { thrown = e; }
    ok(thrown && thrown.code === 'EDITION_MISSING', 'optional — 판에 없으면 읽지 않고, 쓰는 순간 「이 판에는 없는 기능」');
    ED._setEdition('studio');

    console.log('[2] main.js 판정 자리');
    const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const calls = (main.match(/\bisOwner\(\)/g) || []).length;
    ok(calls === 4, 'isOwner() = 정의 1 + 관리자 계정 판정 3곳(licPublic·충전·관리자 페이지) — ' + calls);
    for (const id of ['gpuTemp', 'localQwen', 'charSheets', 'ytCookie']) ok(main.includes(`feat('${id}')`), `feat('${id}') 로 판정`);
    ok(/features: ED\.features\(isOwner\)/.test(main), 'licPublic 이 features 를 싣는다');
    const app = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');
    for (const id of ['book', 'remotion', 'whiteboard', 'thumbEdit', 'todayScripts', 'charSheets', 'localQwen', 'monitorOff']) ok(app.includes(`feat('${id}')`), `화면이 feat('${id}') 로 가른다`);
    const boot = fs.readFileSync(path.join(ROOT, 'bootstrap.js'), 'utf8');
    ok(/EDITION/.test(boot) && /app\.exit\(3\)/.test(boot), 'bootstrap — 판매판이면 무인 입구 거절');
  }

  console.log('[3] 판매판 매니페스트');
  let m, tmpOut = null;
  if (given) m = JSON.parse(fs.readFileSync(path.resolve(given), 'utf8'));
  else {
    tmpOut = path.join(os.tmpdir(), 'priming-member-manifest-' + process.pid + '.json');
    const ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-manifest.js'), '--edition', 'member', '--ref', ref, '--out', tmpOut], { cwd: ROOT, stdio: 'pipe' });
    m = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    fs.unlinkSync(tmpOut);
  }
  const files = Object.keys(m.files || {});
  ok(files.length > 100, '판매판 파일 ' + files.length + '개');
  ok(['main.js', 'bootstrap.js', 'preload.js', 'light-updater.js', 'package.json', 'core/pipeline.js', 'core/edition.js', 'vrew/vrew-builder.js', 'renderer/dist/index.html'].every((f) => files.includes(f)), '롱폼 필수 파일은 들어 있다');
  ok(files.includes('docs/대본-작성-가이드.md') && files.filter((f) => f.startsWith('docs/')).length === 1, 'docs 는 「📘 대본 작성 기준」 하나만');
  ok(!files.some((f) => /^(CLAUDE\.md|AGENTS\.md)$|^tools\/|^test\/|^scripts\//.test(f)), 'CLAUDE.md·AGENTS.md·tools·test·scripts 없음');
  ok(Array.isArray(m.remove) && m.remove.includes('tools/order.js') && m.remove.includes('core/roy-bank.js') && !m.remove.some((r) => files.includes(r)), 'remove = 판매판에서 지울 로이 전용 기능 파일(판매판 파일과 겹치지 않음)');
  const probs = checkMember(m, readRoot);
  ok(probs.length === 0, '[3][4] 로이 전용 파일·내부 문서·금지 문자열 0' + (probs.length ? ' — ' + probs.slice(0, 5).join(' | ') : ''));

  console.log('[5] 판별력');
  const m2 = JSON.parse(JSON.stringify(m)); m2.files['core/roy-bank.js'] = 'x'; m2.files['docs/회원제-설계.md'] = 'x';
  const p2 = checkMember(m2, (rel) => (rel === 'core/roy-bank.js' ? '' : rel === 'docs/회원제-설계.md' ? '' : readRoot(rel)));
  ok(p2.some((p) => /roy-bank/.test(p)) && p2.some((p) => /회원제-설계/.test(p)), '금지 파일을 넣으면 실패한다');
  const p3 = checkMember(m, (rel) => (rel === 'core/pipeline.js' ? "const X = 'D:\\\\TTS_Model\\\\ref-audio'; // 로이은행" : readRoot(rel)));
  ok(p3.filter((p) => /pipeline/.test(p)).length === 2, '금지 문자열을 넣으면 실패한다 — ' + p3.length);
  ok(checkMember({ ...m, ref: 'HEAD' }, readRoot).some((p) => /ref/.test(p)), 'ref 가 sha 가 아니면 실패한다');

  if (given) return;

  console.log('[6] 정적 — 맨 위 require');
  const removed = new Set(m.remove || []);
  const top = [];
  for (const rel of files.filter((f) => /\.js$/.test(f) && !f.startsWith('renderer/'))) {
    const lines = readRoot(rel).split(/\r?\n/);
    lines.forEach((ln, i) => {
      if (!/^(const|let|var|require)\b/.test(ln) || /ED\.optional|ED\.has\(|try \{/.test(ln)) return;   // try 로 감싼 읽기는 파일이 없어도 넘어간다
      const re = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g; let mm;
      while ((mm = re.exec(ln))) {
        let r = path.posix.normalize(path.posix.join(path.posix.dirname(rel), mm[1]));
        if (!/\.(js|json)$/.test(r)) r += '.js';
        if (removed.has(r)) top.push(rel + ':' + (i + 1) + ' → ' + r);
      }
    });
  }
  ok(top.length === 0, '판매판 파일이 빠진 파일을 맨 위에서 읽지 않는다' + (top.length ? ' — ' + top.slice(0, 5).join(' | ') : ''));

  if (process.argv.includes('--no-e2e')) { console.log('  (--no-e2e: [7] 건너뜀)'); return; }
  console.log('[7] 판매판 파일만으로 켜기');
  const M = fs.mkdtempSync(path.join(os.tmpdir(), 'priming-member-'));
  const NM = path.join(M, 'node_modules');
  const DH = 'PrimingEdTest' + process.pid, DHP = path.join(os.homedir(), DH);
  const REAL_PRESETS = path.join(os.homedir(), '.flow-app', 'tts-presets.json');
  const stampOf = (p) => { try { const s = fs.statSync(p); return s.size + ':' + s.mtimeMs; } catch (_) { return 'none'; } };
  let realStamp = null;
  try {
    for (const rel of files) { const src = path.join(ROOT, rel.split('/').join(path.sep)), dst = path.join(M, rel.split('/').join(path.sep)); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    fs.symlinkSync(path.join(ROOT, 'node_modules'), NM, 'junction');   // ⚠ 정리 때 링크만 먼저 끊는다(rmdir) — 원본을 지우지 않게
    // 🏠🛒 로이 PC 의 판매판 미리보기처럼 dataHome 을 준다(v1.0.27) — 앱 데이터가 「홈<DH>」 로 가고 로이판 채널·설정 파일은 그대로여야 한다
    fs.writeFileSync(path.join(M, 'edition.json'), JSON.stringify({ edition: 'member', dataHome: DH }));
    realStamp = stampOf(REAL_PRESETS);
    ok(!fs.existsSync(path.join(M, 'core', 'book')) && !fs.existsSync(path.join(M, 'core', 'roy-bank.js')) && !fs.existsSync(path.join(M, 'tools')), '임시 폴더엔 로이 전용 파일이 없다');

    // 2.0 무인 입구 거절
    const electronExe = require(path.join(ROOT, 'node_modules', 'electron'));
    const o = spawnSync(electronExe, [M, '--order=' + path.join(M, 'x.json')], { encoding: 'utf8', timeout: 30000, env: { ...process.env, PM_UI_SMOKE: '1' } });
    ok(o.status === 3 && /이 판에는 없는 기능/.test(o.stderr || ''), '--order = 「이 판에는 없는 기능」으로 끝(종료 코드 ' + o.status + ')');
    const r2 = spawnSync(electronExe, [M, '--list-names'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, PM_UI_SMOKE: '1' } });
    ok(r2.status === 3, '--list-names 도 거절(' + r2.status + ')');

    // 창을 켜서 화면·IPC 확인
    const { _electron: electron } = require('playwright');
    const app = await electron.launch({ args: [M], env: { ...process.env, PM_UI_SMOKE: '1' } });
    try {
      const home = await app.evaluate(() => process.env.PM_DATA_HOME);   // bootstrap 이 os.homedir() 를 돌린 자리(같은 값)
      ok(home === DHP && fs.existsSync(DHP), '판매판 미리보기 = 앱 데이터 홈이 따로(' + home + ')');
      const win = await app.firstWindow();
      const errs = [];
      win.on('pageerror', (e) => errs.push(e.message));
      await win.waitForSelector('h1', { timeout: 30000 });
      const r = await win.evaluate(async () => {
        const s = await window.api.licenseState();
        const btns = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
        let yt = null; try { yt = await window.api.ytLoginStatus(); } catch (e) { yt = { err: e.message }; }
        let ts = null; try { ts = await window.api.todayScriptsScan(); } catch (e) { ts = { err: e.message }; }
        return { edition: s.edition, features: s.features, owner: s.owner, hasBook: btns.some((t) => t === '📖 출판'), hasRx: btns.some((t) => t === '🎬 리모션'), hasLong: btns.some((t) => t === '롱폼'), yt, ts,
          thumbTab: !!document.querySelector('[data-testid="logtab-thumb"]'), monitor: !!document.querySelector('[data-testid="monitor-off"]') };
      });
      ok(r.edition === 'member' && r.features && Object.values(r.features).every((v) => v === false), '판매판 표시 · features 전부 꺼짐');
      ok(r.hasLong && !r.hasBook && !r.hasRx, '모드 탭 = 롱폼만(출판·리모션 없음)');
      ok(!r.thumbTab, '로그 상자에 🖼 썸네일 탭 없음');
      ok(r.yt && r.yt.allowed === false && r.yt.missing, '유튜브 로그인 IPC = 「이 판에는 없는 기능」');
      ok(r.ts && r.ts.missing && /이 판에는 없는/.test(r.ts.error || ''), '오늘 대본 IPC = 「이 판에는 없는 기능」');
      ok(errs.length === 0, '화면 오류 0' + (errs.length ? ' — ' + errs[0] : ''));
    } finally { await app.close(); }

    // 롱폼 무음 만들기 — test:makeall 을 판매판 폴더에서 그대로
    fs.mkdirSync(path.join(M, 'test'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'test', 'makeall-dry.smoke.js'), path.join(M, 'test', 'makeall-dry.smoke.js'));
    const mk = spawnSync(process.execPath, [path.join(M, 'test', 'makeall-dry.smoke.js')], { encoding: 'utf8', timeout: 240000, cwd: M });
    const tail = String(mk.stdout || '').trim().split('\n').slice(-1)[0];
    ok(mk.status === 0, '판매판에서 롱폼 무음 만들기 E2E 통과 — ' + tail);
    ok(stampOf(REAL_PRESETS) === realStamp, '판매판에서 채널을 만들고 지워도 로이판 채널 파일(~/.flow-app/tts-presets.json)은 그대로');
    ok(fs.existsSync(path.join(DHP, '.flow-app')) || fs.existsSync(path.join(DHP, '.priming-maker')), '판매판 설정은 따로 폴더에 쓰였다');
    if (mk.status !== 0) console.log(String(mk.stdout || '').split('\n').filter((l) => /✗|❌/.test(l)).slice(0, 8).join('\n') + '\n' + String(mk.stderr || '').slice(0, 800));
  } finally {
    if (/PrimingEdTest\d+$/.test(DHP) && path.dirname(DHP) === os.homedir()) { try { fs.rmSync(DHP, { recursive: true, force: true }); } catch (_) {} }   // 이 시험이 만든 홈만
    try { fs.rmdirSync(NM); } catch (_) { try { fs.unlinkSync(NM); } catch (_) {} }
    if (!fs.existsSync(NM)) { try { fs.rmSync(M, { recursive: true, force: true }); } catch (_) {} }
    else console.log('  ⚠ node_modules 링크를 끊지 못해 임시 폴더를 남김: ' + M);
  }
})().then(() => {
  console.log(bad ? `\n❌ edition ${bad}/${n} 실패` : `\n✅ edition ${n}/${n} 통과`);
  process.exit(bad ? 1 : 0);
}).catch((e) => { console.error('❌ 실패:', e && e.stack || e); process.exit(1); });
