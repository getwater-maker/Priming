'use strict';
/**
 * node test/link-opener.test.js — 🌐 링크를 열 브라우저(v1.0.21 · core/link-opener · 로이 2026-11-04)
 *   [1] 찾기 — 가짜 파일로 Chrome·Edge·ego 설치·프로필(Local State) · 없는 브라우저는 목록에서 빠진다
 *   [2] 계획 — 시스템 기본 · 프로필 지정 · 없는 프로필/브라우저 → 내려가기 · 주소만 넘기기 · 이상한 주소 거부
 *   [3] 열기 — 가짜 실행(인자 배열 · 셸 없음) · 실행 실패 → 시스템 기본 · 넘기기
 *   [4] 소스 — main 이 shell.openExternal 을 직접 부르지 않는다(openLink 한 곳) · 메일·무인 연결도 openLink
 *   [5] 화면(E2E · PM_UI_SMOKE · PM_LINK_SETTING 임시 파일) — 👤 계정·📺 탭 칸 · 「주소만 넘기기」 → 클립보드 · 시스템 기본 → shell 스텁
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const EventEmitter = require('events');
const ROOT = path.join(__dirname, '..');
const LO = require(path.join(ROOT, 'core', 'link-opener'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const ENV = { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\LA' };
const state = (cache) => JSON.stringify({ profile: { info_cache: cache } });
function fakeFs(files) { return { exists: (p) => Object.prototype.hasOwnProperty.call(files, p) && files[p] === 'EXE', readFile: (p) => { if (!(p in files) || files[p] === 'EXE') throw new Error('ENOENT'); return files[p]; } }; }

(async () => {
  console.log('[1] 찾기');
  const files = {
    'C:\\PF\\Google\\Chrome\\Application\\chrome.exe': 'EXE',
    'C:\\LA\\Google\\Chrome\\User Data\\Local State': state({ Default: { name: '사람 1' }, 'Profile 3': { name: '역사' }, 'Profile 10': { name: '고전' }, 'System Profile': { name: 'x' } }),
    'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe': 'EXE',
    'C:\\PF\\Citro Labs\\ego lite\\Application\\ego.exe': 'EXE',
    'C:\\LA\\Citro Labs\\ego lite\\User Data\\Local State': state({ 'Profile 17': { name: '다산의뜰' }, 'Profile 2': { name: '혜윤' } }),
  };
  const det = LO.detect({ env: ENV, platform: 'win32', ...fakeFs(files) });
  ok(det.map((d) => d.id).join(',') === 'chrome,edge,ego', '깔린 셋 — ' + det.map((d) => d.id).join(','));
  const chrome = det.find((d) => d.id === 'chrome');
  ok(chrome.profiles.map((p) => p.dir).join('|') === 'Default|Profile 3|Profile 10', '프로필 순서 Default → 숫자순 · System Profile 제외 — ' + chrome.profiles.map((p) => p.dir).join('|'));
  ok(det.find((d) => d.id === 'edge').profiles.length === 0, 'Local State 없는 Edge = 프로필 없음(그래도 목록에)');
  ok(det.find((d) => d.id === 'ego').profiles[1].name === '다산의뜰', 'ego 프로필 이름(채널 이름)');
  const noEgo = LO.detect({ env: ENV, platform: 'win32', ...fakeFs({ 'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe': 'EXE' }) });
  const ch = LO.listChoices(noEgo).map((c) => c.id);
  ok(ch.join(',') === 'system,edge,none', 'ego 없는 PC(회원) = 목록에서 숨김 — ' + ch.join(','));
  ok(LO.detect({ env: ENV, platform: 'darwin', ...fakeFs(files) }).length === 0, '윈도가 아니면 시스템 기본만');
  ok(LO.normSetting(null).browser === 'system' && LO.normSetting({ browser: 'firefox' }).browser === 'system', '기본값·모르는 값 = 시스템 기본(예전 그대로)');
  ok(LO.normSetting({ browser: 'ego', profile: '--evil' }).profile === '' && LO.normSetting({ browser: 'system', profile: 'Profile 1' }).profile === '', '프로필 이름은 Default·Profile N 만 · 시스템 기본엔 프로필 없음');

  console.log('[2] 계획');
  const U = 'https://accounts.google.com/o/oauth2/v2/auth?x=1';
  ok(LO.plan(U, { browser: 'system' }, det).kind === 'shell', '시스템 기본 = shell');
  const pe = LO.plan(U, { browser: 'ego', profile: 'Profile 17' }, det);
  ok(pe.kind === 'spawn' && pe.exe.endsWith('ego.exe') && pe.args[0] === '--profile-directory=Profile 17' && pe.args[1] === U && pe.args.length === 2, 'ego + 프로필 = --profile-directory 와 주소 두 인자');
  const pn = LO.plan(U, { browser: 'chrome', profile: 'Profile 99' }, det);
  ok(pn.kind === 'spawn' && pn.args.length === 1 && /없어 프로필 없이/.test(pn.note), '없는 프로필 → 프로필 없이 + 알림');
  const pm = LO.plan(U, { browser: 'ego' }, noEgo);
  ok(pm.kind === 'shell' && /없어 시스템 기본/.test(pm.note), '없는 브라우저 → 시스템 기본 + 알림');
  ok(LO.plan(U, { browser: 'none' }, det).kind === 'hand', '주소만 넘기기 = hand');
  ok(LO.safeUrl('javascript:alert(1)') === null && LO.safeUrl('file:///C:/x.exe') === null && LO.safeUrl('--disable-web-security') === null && LO.safeUrl('') === null, '열면 안 되는 주소(javascript·file·플래그꼴·빈 값) 거부');
  ok(LO.safeUrl('mailto:a@b.c') === 'mailto:a@b.c' && LO.safeUrl('https://x.y/') === 'https://x.y/', 'https·mailto 는 연다');

  console.log('[3] 열기');
  const calls = [];
  const okSpawn = (exe, args, o) => { calls.push({ exe, args, o }); const e = new EventEmitter(); e.unref = () => {}; return e; };
  const badSpawn = () => { const e = new EventEmitter(); e.unref = () => {}; setTimeout(() => e.emit('error', new Error('ENOENT')), 10); return e; };
  const shelled = [], handed = [], logs = [];
  const base = { detected: det, shellOpen: async (u) => shelled.push(u), onHand: async (u) => handed.push(u), log: (l) => logs.push(l) };
  let r = await LO.open(U, { ...base, setting: { browser: 'ego', profile: 'Profile 17' }, spawnFn: okSpawn });
  ok(r.ok && r.kind === 'spawn' && calls.length === 1 && calls[0].o.detached === true && !('shell' in calls[0].o), '실행 = 셸 없이 인자 배열 · 떼어 띄움');
  r = await LO.open(U, { ...base, setting: { browser: 'chrome' }, spawnFn: badSpawn });
  ok(r.kind === 'shell' && shelled[0] === U && logs.some((l) => /열지 못해 시스템 기본/.test(l)), '실행 실패 → 시스템 기본으로 한 번 더');
  r = await LO.open(U, { ...base, setting: { browser: 'none' }, spawnFn: okSpawn });
  ok(r.kind === 'hand' && handed[0] === U && calls.length === 1, '넘기기 = 실행·shell 없음');
  r = await LO.open('javascript:1', { ...base, setting: { browser: 'system' }, spawnFn: okSpawn });
  ok(!r.ok && shelled.length === 1, '이상한 주소는 열지 않는다');
  const tf = path.join(os.tmpdir(), `pm-link-${process.pid}.json`);
  LO.saveSetting({ browser: 'ego', profile: 'Profile 17' }, { file: tf });
  ok(JSON.stringify(LO.loadSetting({ file: tf })) === JSON.stringify({ browser: 'ego', profile: 'Profile 17' }), '저장 → 읽기');
  fs.unlinkSync(tf);

  console.log('[4] 소스');
  const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const direct = M.split('\n').filter((l) => /shell\.openExternal\(/.test(l) && !/HEADLESS \? _realOpenExternal\(u\) : shell\.openExternal\(u\)/.test(l));
  ok(direct.length === 0, 'main 의 shell.openExternal( 직접 호출 0곳 — ' + direct.length);
  ok((M.match(/\bopenLink\(/g) || []).length >= 17, 'openLink 를 거치는 자리 ' + (M.match(/\bopenLink\(/g) || []).length + '곳');
  ok(/shell: \{ openExternal: \(u\) => openLink\(u\)/.test(M) && /createClient\(\{ openExternal: u => openLink\(u\) \}\)/.test(M), '출판 메일(회신·Gmail 연결)도 openLink');
  ok(/openLink\(u, \{ allowHeadless: true, hand: handUrl \}\)/.test(M), '무인 yt-connect(--url-out 없음)도 설정을 따른다(주소만 넘기기 = 같은 JSON)');
  ok(/if \(HEADLESS && !allowHeadless\) return/.test(M), '무인 실행은 그 밖의 링크를 열지 않는다');
  ok(/PM_UI_SMOKE === '1' \? path\.join\(os\.tmpdir\(\), 'priming-smoke-link-browser\.json'\)/.test(M), 'E2E 는 로이 설정 파일을 읽지 않는다');

  console.log('[5] 화면');
  const { _electron: electron } = require('playwright');
  const SET = path.join(os.tmpdir(), `pm-link-ui-${process.pid}.json`);
  try { fs.unlinkSync(SET); } catch (_) {}
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1', PM_LINK_SETTING: SET } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = async (u) => { globalThis.__opened.push(String(u)); }; });
    await win.click('button[title^="통합 설정"]');
    await win.click('.settings-card button:has-text("👤 계정")');
    await win.waitForSelector('[data-testid=account-tab] [data-testid=link-browser-pick]', { timeout: 10000 });
    const opts = await win.locator('[data-testid=account-tab] [data-testid=link-browser-pick] option').evaluateAll((os_) => os_.map((o) => o.value));
    ok(opts[0] === 'system' && opts[opts.length - 1] === 'none', '👤 계정 탭 목록 — ' + opts.join(','));
    const real = LO.detect().map((d) => d.id);
    ok(real.every((id) => opts.includes(id)) && opts.length === real.length + 2, '이 PC 에 깔린 브라우저만 — ' + real.join(','));
    ok(await win.locator('[data-testid=account-tab] [data-testid=link-browser-pick]').inputValue() === 'system', '처음 = 시스템 기본');
    await win.selectOption('[data-testid=account-tab] [data-testid=link-browser-pick]', 'none');
    await win.waitForTimeout(300);
    ok(JSON.parse(fs.readFileSync(SET, 'utf8')).browser === 'none', '고르면 바로 저장');
    ok(await win.locator('[data-testid=account-tab] [data-testid=link-browser-test]').count() === 0, '주소만 넘기기 = 시험 열기 단추 없음');
    const clip0 = await app.evaluate(({ clipboard }) => clipboard.readText());   // 로이 클립보드는 끝에 되돌린다
    await win.evaluate(() => window.api.linkBrowserTest());
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    ok(clip === 'https://www.youtube.com/', '주소만 넘기기 → 클립보드 — ' + clip);
    await app.evaluate(({ clipboard }, c) => clipboard.writeText(c), clip0);
    ok((await app.evaluate(() => globalThis.__opened)).length === 0, '주소만 넘기기 = 브라우저 안 염');
    if (real.includes('ego')) {
      await win.selectOption('[data-testid=account-tab] [data-testid=link-browser-pick]', 'ego');
      await win.waitForSelector('[data-testid=account-tab] [data-testid=link-browser-profile]', { timeout: 5000 });
      const pn = await win.locator('[data-testid=account-tab] [data-testid=link-browser-profile] option').count();
      ok(pn > 2, 'ego 프로필 고르기 칸 — 항목 ' + pn);
    }
    await win.selectOption('[data-testid=account-tab] [data-testid=link-browser-pick]', 'system');
    await win.waitForTimeout(300);
    await win.click('[data-testid=account-tab] [data-testid=link-browser-test]');
    await win.waitForTimeout(400);
    const op = await app.evaluate(() => globalThis.__opened);
    ok(op.length === 1 && op[0] === 'https://www.youtube.com/', '시스템 기본 → shell.openExternal(스텁) — ' + JSON.stringify(op));
    await win.click('.settings-card button:has-text("📺 채널 연결")');
    ok(await win.locator('[data-testid=link-browser-pick]').count() === 1, '📺 채널 연결 탭에도 같은 칸');
    const vis = await win.locator('[data-testid=link-browser-pick]').evaluate((el) => { const q = el.getBoundingClientRect(); return q.width > 40 && document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2) === el; });
    ok(vis, '칸이 실제로 눌린다(elementFromPoint)');
  } finally { await app.close(); try { fs.unlinkSync(SET); } catch (_) {} }

  console.log(`\n${fail ? '❌' : '✅'} link-opener — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
