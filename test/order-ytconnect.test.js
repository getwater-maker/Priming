'use strict';
/**
 * test/order-ytconnect.test.js — 🔗 2.0 유튜브 연결 `yt-connect --url-out --expect` (v1.0.20 · 2.0 요청 11-04)
 *   진짜 무인 실행(창 없는 Electron)을 띄워 본다 — 가짜 클라이언트 파일 · 구글에 가지 않는다.
 *   [1] --url-out → stdout 첫 JSON 한 줄이 {authUrl}(구글 동의 주소 · 비밀값 없음 · PKCE)
 *   [2] 그 주소의 복귀 자리로 「거절」을 보내면 끝 JSON {ok:false} · 끝 코드 1
 *   [3] 동의 주소를 로그 파일에 싣지 않는다 · 기다림 15분 · --expect 가 connectChannel 의 expectId 로 간다(소스)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const APP = '__urlout_test';
const AUTH = path.join(os.homedir(), '.priming-maker', `youtube-auth.${APP}.json`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ytconn-'));
const clientFile = path.join(tmp, 'client.json');
const SECRET = 'FAKE-SECRET-NEVER-IN-URL';
fs.writeFileSync(clientFile, JSON.stringify({ installed: { client_id: 'fake-client-id.apps.googleusercontent.com', client_secret: SECRET, project_id: 'fake' } }));

function run() {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [path.join(ROOT, 'tools', 'order.js'), 'yt-connect', APP, '--client', clientFile, '--url-out', '--expect', 'UC_EXPECTED_ID'], { cwd: ROOT, windowsHide: true });
    const lines = []; let buf = ''; let sent = false;
    const killer = setTimeout(() => { try { cp.kill(); } catch (_) {} }, 90000);
    cp.stdout.on('data', async (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!ln) continue;
        let j = null; try { j = JSON.parse(ln); } catch (_) {}
        lines.push(j || ln);
        if (j && j.authUrl && !sent) {
          sent = true;
          const u = new URL(j.authUrl);
          const back = new URL(u.searchParams.get('redirect_uri'));
          back.searchParams.set('state', u.searchParams.get('state'));
          back.searchParams.set('error', 'access_denied');
          try { await fetch(back.toString()); } catch (_) {}
        }
      }
    });
    cp.on('close', (code) => { clearTimeout(killer); resolve({ code, lines }); });
  });
}

(async () => {
  console.log('🔗 yt-connect --url-out · --expect');
  const t0 = Date.now();
  const { code, lines } = await run();
  const first = lines.find((x) => x && typeof x === 'object');
  ok(first && typeof first.authUrl === 'string', `[1] 첫 JSON 줄이 {authUrl} (${Math.round((Date.now() - t0) / 1000)}초)`);
  if (first && first.authUrl) {
    const u = new URL(first.authUrl);
    ok(u.host === 'accounts.google.com', '[1] 구글 동의 주소');
    ok(u.searchParams.get('client_id') === 'fake-client-id.apps.googleusercontent.com', '[1] client_id 가 들었다');
    ok(u.searchParams.get('code_challenge_method') === 'S256' && !!u.searchParams.get('code_challenge') && !!u.searchParams.get('state'), '[1] PKCE · state');
    ok(!first.authUrl.includes(SECRET), '[1] 클라이언트 비밀값이 주소에 없다');
    ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(u.searchParams.get('redirect_uri') || ''), '[1] 루프백 복귀 주소');
  }
  const last = [...lines].reverse().find((x) => x && typeof x === 'object' && 'ok' in x);
  ok(last && last.ok === false && /허용하지/.test(last.error || ''), `[2] 거절 → 끝 JSON {ok:false} (${last && last.error})`);
  ok(code === 1, `[2] 끝 코드 1 (${code})`);
  ok(!lines.some((x) => typeof x === 'string' && x.includes('accounts.google.com')), '[1] 주소는 JSON 한 줄로만 나온다');

  // [3] 로그 파일에 동의 주소를 싣지 않는다
  const d = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const logf = path.join(os.homedir(), '.shots-maker', 'logs', `${d}.log`);
  let logText = ''; try { logText = fs.readFileSync(logf, 'utf8'); } catch (_) {}
  const tail = logText.slice(-20000);
  ok(/동의 주소를 2\.0 에 넘겼습니다/.test(tail), '[3] 로그에 「넘겼습니다」 한 줄');
  ok(!tail.includes('code_challenge='), '[3] 로그에 동의 주소가 없다');
  const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const fn = M.slice(M.indexOf('async function _headlessYtConnect'), M.indexOf('function _orderLockFile'));
  ok(/timeoutMs: 15 \* 60 \* 1000/.test(fn), '[3] 기다림 15분');
  ok(/expectId: expectId \|\| undefined/.test(fn) && /mismatch: true/.test(fn), '[3] --expect → expectId · mismatch 를 끝 JSON 에');
  ok(!/revoke/i.test(fn), '[3] mismatch 때 revoke 하지 않는다');
  ok(/urlOut \? handUrl/.test(fn) && /openLink\(u, \{ allowHeadless: true, hand: handUrl \}\)/.test(fn), '[3] --url-out 이면 브라우저를 열지 않는다(없으면 「링크를 열 브라우저」 설정대로 · v1.0.21)');

  try { fs.unlinkSync(AUTH); } catch (_) {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  ok(!fs.existsSync(AUTH), '시험 프로필 파일 지움');
  console.log(`\n결과: ${pass} 통과 · ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
