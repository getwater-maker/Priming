'use strict';
/**
 * node test/update-button.test.js — 🔄 헤더 「업데이트」 단추 + 🌐 앱 이름 → tube.primingwave.com (2026-10-06 로이)
 *   · core/update-check.evaluate — 새 버전/같음/서버가 낮음/구성요소 변경/읽기 실패
 *   · 시작 때 자동 업데이트(bootstrap → applyUpdates)는 그대로 · 단추는 같은 applyUpdates 를 쓴다
 *   · 작업 중(절전 차단 카운트 > 0)에는 적용하지 않는다 · 개발 실행에서는 적용하지 않는다 · 적용 뒤에만 다시 시작한다
 *   · 앱 이름 클릭은 고정 주소 하나만 연다
 */
const fs = require('fs'), path = require('path');
const { evaluate, depsHash } = require('../core/update-check');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const deps = { a: '1.0.0' };
const local = { version: '0.7.8', dependencies: deps };
const man = (v, d) => ({ version: v, deps: depsHash(d || deps), files: { 'package.json': 'x' } });

ok(evaluate(man('0.7.9'), local).state === 'newer', '원격이 높으면 newer');
ok(evaluate(man('0.7.9'), local).latest === '0.7.9' && /0\.7\.9/.test(evaluate(man('0.7.9'), local).message), 'newer 메시지에 새 버전');
ok(evaluate(man('0.7.10'), local).state === 'newer', '0.7.10 > 0.7.9 (문자열이 아니라 숫자 비교)');
ok(evaluate(man('0.7.8'), local).state === 'same', '같으면 same');
ok(evaluate(man('0.7.2'), local).state === 'older', '원격이 낮으면 older(받지 않는다 — 역행 사고 방지)');
ok(evaluate(man('0.8.0', { a: '2.0.0' }), local).state === 'deps', '구성요소가 바뀐 새 버전 = deps(재설치 안내)');
ok(evaluate(null, local).state === 'none' && evaluate({}, local).state === 'none', '읽지 못하면 none');
ok(evaluate({ version: '0.7.9', files: {} }, local).state === 'newer', 'deps 해시가 없는 옛 매니페스트도 버전만으로 판정');

const root = path.join(__dirname, '..');
const M = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const LU = fs.readFileSync(path.join(root, 'light-updater.js'), 'utf8');
const BS = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
const APP = fs.readFileSync(path.join(root, 'renderer', 'src', 'App.jsx'), 'utf8');
const P = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
ok(/await require\('\.\/light-updater'\)\.applyUpdates\(\)/.test(BS), '시작 때 자동 업데이트(bootstrap)는 그대로');
const blk = M.slice(M.indexOf("ipcMain.handle('app-update-apply'"), M.indexOf("ipcMain.handle('open-tube-site'"));
ok(/LU\.applyUpdates\(\)/.test(blk), '단추도 같은 applyUpdates 를 쓴다(두 벌이 아니다)');
ok(blk.indexOf('!app.isPackaged') > 0 && blk.indexOf('!app.isPackaged') < blk.indexOf('LU.applyUpdates()'), '개발 실행은 적용 전에 막는다');
ok(blk.indexOf('_awake.n > 0') > 0 && blk.indexOf('_awake.n > 0') < blk.indexOf('LU.applyUpdates()'), '작업 중(_awake.n>0)이면 적용 전에 막는다');
ok(blk.indexOf("chk.state !== 'newer'") > 0 && blk.indexOf("chk.state !== 'newer'") < blk.indexOf('LU.applyUpdates()'), '새 버전이 아니면(older·deps 포함) 적용하지 않는다');
ok(blk.indexOf('r.updated > 0') > 0 && blk.indexOf('r.updated > 0') < blk.indexOf('app.relaunch()'), '파일을 실제로 바꾼 뒤에만 다시 시작한다');
ok(/writeWorkspace\(\)/.test(blk), '다시 시작 전에 큐를 저장한다(♻ 지난 큐)');
ok(/return \{ updated, failed, reason: 'applied'/.test(LU) && /module\.exports = \{ applyUpdates, fetchManifest, localPackage \}/.test(LU), 'applyUpdates 가 결과를 돌려준다(시작 호출은 값을 안 써서 영향 없음)');
const chk = M.slice(M.indexOf("ipcMain.handle('app-update-check'"), M.indexOf("ipcMain.handle('app-update-apply'"));
ok(!/applyUpdates/.test(chk), '확인은 매니페스트만 읽는다(파일을 바꾸지 않는다)');
ok(/shell\.openExternal\('https:\/\/tube\.primingwave\.com\/'\)/.test(M) && /ipcMain\.handle\('open-tube-site', \(\) =>/.test(M), '앱 이름 클릭 = 고정 주소만 연다(인자를 받지 않는다)');
ok(/data-testid="app-title"[^>]*onClick=\{\(\) => api\.openTubeSite\(\)\}/.test(APP), '헤더 앱 이름 클릭 → openTubeSite');
ok(/data-testid="app-update"/.test(APP) && /appUpdateApply/.test(APP) && /appUpdateCheck/.test(P) && /openTubeSite/.test(P), '헤더 업데이트 단추 · preload 연결');
console.log(`\n${fail ? '❌' : '✅'} update-button — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
