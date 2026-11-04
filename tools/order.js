#!/usr/bin/env node
'use strict';
/**
 * tools/order.js — 🤖 2.0 무인 제작 명령(v1.0.18 · ⑭ register v1.0.19 · docs/요청서_2.0무인제작_2026-11-04.md)
 *   2.0 문지기가 부르는 명령은 이것 하나다. 창 · 소리 · 알림 없음 · 업데이트 없음(bootstrap 의 무인 실행).
 *
 *   node tools/order.js run   <주문서.json>   주문 하나를 끝까지(받음 → 진행 신호 → 결과서). 끝날 때까지 기다린다.
 *   node tools/order.js start <주문서.json>   위와 같지만 기다리지 않는다(떼어 띄움 · 진행은 결과 폴더의 .진행 · 결과서로 본다)
 *   node tools/order.js stop  [<주문 이름>]   도는 주문을 멈춘다(이름이 없으면 도는 주문 전부) — 1분 안에 GPU 를 비운다
 *   node tools/order.js check <주문서.json>   만들지 않고 주문서만 확인(거절 사유를 화면에 JSON 한 줄로)
 *   node tools/order.js names                 Priming 채널 · 음성 서버 목소리 · 그림체 이름 목록(JSON)
 *   node tools/order.js register <등록.json>  ⑭ 새 채널 등록(목소리 · 그림체 · 배속 → 2.0 용 새 채널 · 기존 채널은 그대로) → 결과\등록\<이름>.json
 *   node tools/order.js yt-connect <앱 이름> [--client <client_secret.json>] [--url-out] [--expect <채널 ID>]   그 앱으로 유튜브 채널 연결(로이가 앞에 있을 때 · 15분)
 *        --url-out = 브라우저를 열지 않고 동의 주소를 JSON 한 줄 {"authUrl":…} 로 낸다 · --expect = 다른 채널을 고르면 저장하지 않음(mismatch · 끝 코드 1)
 *
 *   끝 코드: 0 성공(등록 = 됨) · 1 실패 · 2 거절 · 3 중단됨 · 64 쓰는 법 틀림
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OC = require(path.join(ROOT, 'core', 'order-contract'));

function electronExe() {
  try { return require(path.join(ROOT, 'node_modules', 'electron')); } catch (_) { return null; }
}
function runElectron(args, { detach = false, quiet = false } = {}) {
  const exe = electronExe();
  if (!exe) { process.stderr.write('electron 을 찾지 못했습니다 — D:\\Priming 에서 npm install 이 되어 있어야 합니다\n'); return Promise.resolve(64); }
  const env = { ...process.env, PM_HEADLESS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  if (detach) {
    const cp = spawn(exe, [ROOT, ...args], { env, cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
    cp.unref();
    process.stdout.write(JSON.stringify({ started: true, pid: cp.pid }) + '\n');
    return Promise.resolve(0);
  }
  return new Promise((resolve) => {
    const cp = spawn(exe, [ROOT, ...args], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    cp.stdout.on('data', (d) => process.stdout.write(d));
    cp.stderr.on('data', (d) => { if (!quiet) process.stderr.write(d); });
    cp.on('close', (code) => resolve(code == null ? 1 : code));
    cp.on('error', (e) => { process.stderr.write(e.message + '\n'); resolve(1); });
  });
}

function stop(name) {
  const cfg = OC.loadConfig();
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.priming-maker', 'order-running.json'), 'utf8')); } catch (_) {}
  const alive = lock && lock.pid && (() => { try { process.kill(lock.pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } })();
  if (!alive) { process.stdout.write(JSON.stringify({ stopped: false, why: '도는 주문이 없습니다' }) + '\n'); return 0; }
  if (name && lock.order && lock.order !== name) { process.stdout.write(JSON.stringify({ stopped: false, why: `도는 주문은 「${lock.order}」 입니다` }) + '\n'); return 0; }
  fs.mkdirSync(cfg.resultsDir, { recursive: true });
  const p = name ? OC.stopPaths(cfg.resultsDir, name)[0] : OC.stopPaths(cfg.resultsDir, '')[1];
  fs.writeFileSync(p, OC.kst() + '\n');
  process.stdout.write(JSON.stringify({ stopped: true, order: lock.order, pid: lock.pid, file: p }) + '\n');
  return 0;
}

async function main(argv) {
  const [cmd, a1] = argv;
  const abs = (p) => path.resolve(process.cwd(), String(p || ''));
  switch (cmd) {
    case 'run': if (!a1) break; return runElectron(['--order', abs(a1)], { quiet: true });
    case 'start': if (!a1) break; return runElectron(['--order', abs(a1)], { detach: true });
    case 'check': if (!a1) break; return runElectron(['--order-check', abs(a1)], { quiet: true });
    case 'names': return runElectron(['--list-names'], { quiet: true });
    case 'register': if (!a1) break; return runElectron(['--register', abs(a1)], { quiet: true });
    case 'stop': return stop(a1 && !a1.startsWith('--') ? a1 : '');
    case 'yt-connect': {
      if (!a1) break;
      const ci = argv.indexOf('--client'), ei = argv.indexOf('--expect');
      return runElectron(['--yt-connect', a1,
        ...(ci > 0 && argv[ci + 1] ? ['--client', abs(argv[ci + 1])] : []),
        ...(argv.includes('--url-out') ? ['--url-out'] : []),
        ...(ei > 0 && argv[ei + 1] && !argv[ei + 1].startsWith('--') ? ['--expect', argv[ei + 1]] : [])], { quiet: true });
    }
    default: break;
  }
  process.stderr.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 16).join('\n') + '\n');
  return 64;
}

if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c));
module.exports = { main, stop };
