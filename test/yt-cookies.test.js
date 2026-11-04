'use strict';
/**
 * test/yt-cookies.test.js — 🔑 유튜브 로그인 쿠키(v1.0.23)
 * 원문 모듈을 그대로 require. 네트워크·Electron 을 쓰지 않는다(암호화는 주입한 가짜 enc/dec).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytck-test-'));
process.env.PRIMING_YTCOOKIE_DIR = dir;          // ⛔ 로이의 진짜 저장소를 건드리지 않는다
const YC = require('../core/yt-cookies');
const MD = require('../core/media-download');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const enc = (t) => Buffer.from('ENC:' + t, 'utf8').toString('base64');
const dec = (b) => { const s = Buffer.from(b, 'base64').toString('utf8'); if (!s.startsWith('ENC:')) throw new Error('bad'); return s.slice(4); };
const future = Date.now() / 1000 + 86400 * 30;

const COOKIES = [
  { name: 'SAPISID', value: 'abc/def', domain: '.youtube.com', path: '/', secure: true, httpOnly: false, expirationDate: future },
  { name: 'LOGIN_INFO', value: 'x', domain: '.youtube.com', path: '/', secure: true, httpOnly: true, expirationDate: future },
  { name: 'SID', value: 's', domain: '.google.com', path: '/', secure: false, httpOnly: false },
  { name: 'other', value: 'z', domain: '.example.com', path: '/', secure: false, httpOnly: false },
];

console.log('\n[1] 걸러내기·로그인 판정');
{
  ok(YC.filterCookies(COOKIES).length === 3, '유튜브·구글 도메인만 남긴다(example.com 제외)');
  ok(YC.isLoggedIn(COOKIES), 'SAPISID 가 있으면 로그인');
  ok(!YC.isLoggedIn([{ name: 'VISITOR_INFO1_LIVE', value: 'v', domain: '.youtube.com' }]), '로그인 쿠키가 없으면 로그인 아님(판정력)');
  ok(!YC.isLoggedIn([{ name: 'SAPISID', value: 'a', domain: '.youtube.com', expirationDate: 1000 }]), '만료된 로그인 쿠키는 로그인 아님');
}

console.log('\n[2] Netscape 변환 왕복');
{
  const txt = YC.toNetscape(COOKIES);
  ok(txt.startsWith('# Netscape HTTP Cookie File'), '머리말');
  ok(!/example\.com/.test(txt), '다른 사이트 쿠키는 파일에 없다');
  ok(/#HttpOnly_\.youtube\.com\tTRUE\t\/\tTRUE\t\d+\tLOGIN_INFO\tx/.test(txt), 'HttpOnly 접두 · 탭 7칸');
  const back = YC.fromNetscape(txt);
  ok(back.length === 3 && back.find((c) => c.name === 'LOGIN_INFO').httpOnly === true, '되읽기 — 3개 · httpOnly 유지');
  ok(YC.isLoggedIn(back), '되읽은 뒤에도 로그인으로 판정');
}

console.log('\n[3] 저장·상태 — 값은 상태에 없다');
{
  ok(!YC.save([{ name: 'VISITOR_INFO1_LIVE', value: 'v', domain: '.youtube.com' }], enc).ok, '로그인 쿠키 없이는 저장 거부');
  ok(!YC.save(COOKIES, null).ok, '암호화를 못 쓰면 저장 거부(평문 금지)');
  const r = YC.save(COOKIES, enc);
  ok(r.ok && r.count === 3, '저장 3개');
  const raw = fs.readFileSync(YC.FILE(), 'utf8');
  ok(!/abc\/def|SAPISID/.test(raw), '디스크 파일에 쿠키 값·이름이 평문으로 없다');
  const st = YC.status(dec);
  ok(st.connected === true && !JSON.stringify(st).includes('abc/def'), '상태는 연결됨만 — 값 없음');
  ok(YC.status(null).connected === false, '복호화 수단이 없으면 연결 안 됨');
}

console.log('\n[4] yt-dlp 용 임시 파일 — 쓰고 지운다 · 갱신분 되저장');
{
  const a = YC.acquire(enc, dec);
  ok(a && fs.existsSync(a.file), '임시 cookies.txt 생성');
  fs.appendFileSync(a.file, '.youtube.com\tTRUE\t/\tTRUE\t' + Math.floor(future) + '\tYSC\tnew\n');   // yt-dlp 가 갱신한 쿠키
  a.release();
  ok(!fs.existsSync(a.file), 'release 뒤 임시 파일 삭제');
  ok(YC.load(dec).cookies.some((c) => c.name === 'YSC' && c.value === 'new'), '갱신된 쿠키를 다시 암호화해 저장');
  YC.clear();
  ok(YC.acquire(enc, dec) === null, '해제하면 acquire 는 null');
}

console.log('\n[5] media-download 연결 — 유일한 문(_spawnYt)에서만');
{
  const src = read('core/media-download.js');
  ok(/setCookieProvider/.test(src) && /'--cookies', ck\.file/.test(src), '_spawnYt 가 --cookies 를 붙인다');
  ok((src.match(/'--cookies'/g) || []).length === 1, '--cookies 를 붙이는 곳은 한 곳');
  ok(/finally \{ if \(ck && ck\.release\)/.test(src), '실패해도 release(임시 파일 삭제)');
  ok(typeof MD.setCookieProvider === 'function', '내보냄');
  const m = read('main.js');
  ok(/setCookieProvider\(\(\) => \(isOwner\(\)/.test(m), 'main: 관리자일 때만 쿠키를 준다');
  ok(/ipcMain\.handle\('yt-login-open', async \(\) => \{\s*if \(!isOwner\(\)\)/.test(m), 'main: 로그인 창은 관리자 전용');
  ok(!/yt-cookies[\s\S]{0,200}webContents\.send\([^)]*cookie/i.test(m), '쿠키 값을 렌더러로 보내지 않는다');
}

console.log('\n[6] 실패 사유 — 「실패」 한 단어로 끝내지 않는다');
{
  ok(/로그인/.test(MD._explain('ERROR: [youtube] x: Sign in to confirm you’re not a bot')), '로봇 확인 → 로그인 안내');
  ok(/만료/.test(MD._explain('ERROR: The provided YouTube account cookies are no longer valid. They have likely been rotated')), '쿠키 만료 사유');
  ok(MD._explain('some odd output line') === 'some odd output line', 'ERROR 줄이 없어도 마지막 출력 줄을 사유로');
  ok(MD._explain('') === '', '빈 stderr 는 빈 문자열(호출부 기본 문구)');
  const ui = read('renderer/src/UrlProgress.jsx');
  ok(/<details open data-testid="urldl-fails"/.test(ui), '실패 사유 목록은 펼쳐서 보인다');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
