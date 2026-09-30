'use strict';
/**
 * node test/youtube-default.test.js — 🎬 Priming 기본 유튜브 연결(앱에 들어 있음) + PC 하루 상한 (2026-09-30 로이 · v0.5.91)
 *   로이: "파일 옮기기 없이 · 다른 사람과 서비스해도 · 각자 업로드 한도". 기본 연결 = 앱 신분증(모두 같음),
 *   채널 연결 = 각자(그 PC 에만 암호화). 구글 한도는 프로젝트 하나에 걸리므로 공용 연결은 PC 하루 상한, 자기 프로젝트는 상한 없음.
 *   HOME 은 임시 폴더 · 암호화는 가짜 — 실제 ~/.priming-maker 무변경.
 */
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdef-'));
process.env.USERPROFILE = TMP; process.env.HOME = TMP;
const realHome = os.homedir; os.homedir = () => TMP;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const YT = require('../core/youtube-upload');
YT._setCrypto({ enc: (s) => 'ENC:' + Buffer.from(String(s)).toString('base64').split('').reverse().join(''), dec: (b) => { const s = String(b); return s.startsWith('ENC:') ? Buffer.from(s.slice(4).split('').reverse().join(''), 'base64').toString() : ''; } });

const DEF = { clientId: 'default-id.apps.googleusercontent.com', clientSecret: 'default-secret', projectId: 'priming-upload' };
const writeClient = (id, proj) => { const f = path.join(TMP, id + '.json'); fs.writeFileSync(f, JSON.stringify({ installed: { client_id: id, client_secret: 'own-secret-' + id, project_id: proj } })); return f; };
const setChannels = (chs) => { const d = JSON.parse(fs.readFileSync(YT.authFile(), 'utf8')); d.channels = chs; fs.writeFileSync(YT.authFile(), JSON.stringify(d)); };
const resetAuth = () => { try { fs.rmSync(YT.authFile(), { force: true }); fs.rmSync(YT.uploadsFile(), { force: true }); } catch {} };

(async () => {
  console.log('\n[1] 실제 기본 연결 파일(앱에 들어 있는 것)');
  {
    const c = require('../core/youtube-default-client');
    ok(/\.apps\.googleusercontent\.com$/.test(c.clientId) && String(c.clientSecret).length > 10 && c.projectId === 'priming-upload', '업로드 전용 프로젝트 priming-upload 의 데스크톱 앱 클라이언트');
    YT._setDefaultClient(undefined);
    resetAuth();
    const st = YT.status();
    ok(st.hasClient && st.clientSource === 'default' && st.projectId === 'priming-upload', '🔑 아무 파일도 안 가져와도 hasClient · 출처 default (아내 PC 가 처음 열어도 「채널 연결」이 바로 눌린다)');
    ok(st.dailyCap === YT.DEFAULT_DAILY_CAP && YT.DEFAULT_DAILY_CAP > 0, `공용 연결은 PC 하루 상한 ${YT.DEFAULT_DAILY_CAP}편`);
    const src = read('core/youtube-default-client.js');
    ok(/adonairoy/.test(src) && !/client_secret_\d+/.test(src), '분석용 adonairoy 프로젝트와 다르다는 경고 주석 · 원본 파일명 흔적 없음');
    // 비밀은 그 한 파일에만(로그·문서·테스트에 새지 않았다)
    const leaks = [];
    (function walk(d, depth) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', 'dist', 'output', 'assets'].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) { if (depth < 4) walk(p, depth + 1); } else if (/\.(js|jsx|md|json|html|txt)$/i.test(e.name) && fs.statSync(p).size < 3e6) { try { if (fs.readFileSync(p, 'utf8').includes(c.clientSecret)) leaks.push(path.relative(ROOT, p)); } catch {} } } })(ROOT, 0);
    ok(leaks.length === 1 && /youtube-default-client\.js$/.test(leaks[0]), `🔴 연결 비밀은 core/youtube-default-client.js 한 곳에만 (${leaks.join(', ')})`);
  }

  console.log('\n[2] 자기 프로젝트 > 앱 기본 · 되돌리기');
  {
    YT._setDefaultClient(DEF); resetAuth();
    ok(YT.status().clientSource === 'default' && YT.status().dailyCap === YT.DEFAULT_DAILY_CAP, '(가짜 기본) 기본 사용 중');
    const own = writeClient('own-id.apps.googleusercontent.com', 'my-proj');
    const r = YT.importClient(own);
    ok(r.ok && r.cleared === 0, '내 프로젝트 파일 가져오기 성공(기존 채널 없음)');
    let st = YT.status();
    ok(st.clientSource === 'own' && st.projectId === 'my-proj' && st.dailyCap === null, '🔑 자기 프로젝트가 기본보다 먼저 · 앱 상한 없음(자기 한도)');
    setChannels({ UC1: { title: '내채널', refresh: 'ENC:x', connectedAt: 'now' } });
    const same = writeClient(DEF.clientId, 'priming-upload');
    YT.importClient(same); YT.useDefaultClient();
    setChannels({ UC1: { title: '내채널', refresh: 'ENC:x', connectedAt: 'now' } });
    const r2 = YT.importClient(same);
    ok(r2.ok && r2.cleared === 0 && YT.status().channels.length === 1, '기본과 같은 프로젝트 파일을 가져오면 채널 연결을 지우지 않는다(메인 PC 가 이미 연결해 둔 것 유지)');
    YT.importClient(own);
    ok(YT.status().channels.length === 0, '다른 프로젝트로 바꾸면 채널 연결을 비운다(그 프로젝트의 토큰이라 못 쓴다)');
    setChannels({ UC2: { title: 'B', refresh: 'ENC:y', connectedAt: 'now' } });
    const back = YT.useDefaultClient();
    st = YT.status();
    ok(back.ok && back.cleared === 1 && st.clientSource === 'default' && st.channels.length === 0, '↩ 기본으로: 다른 프로젝트였으니 채널 연결을 비우고 앱 기본으로');
    ok(YT.useDefaultClient().ok && YT.useDefaultClient().cleared === 0, '이미 기본이면 아무것도 지우지 않는다');
    resetAuth(); YT.importClient(same);
    setChannels({ UC3: { title: 'C', refresh: 'ENC:z', connectedAt: 'now' } });
    ok(YT.useDefaultClient().cleared === 0 && YT.status().channels.length === 1, '기본과 같은 프로젝트에서 ↩ 하면 채널 연결 유지');
  }

  console.log('\n[3] PC 하루 상한 — 공용 연결에서만');
  {
    YT._setDefaultClient(DEF); resetAuth();
    const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const rec = {}; for (let i = 0; i < YT.DEFAULT_DAILY_CAP; i++) rec['UC|f' + i + '.mp4|1|' + i] = { videoId: 'v' + i, at: day + ' 10:00', title: 't' };
    rec['UC|old.mp4|1|1'] = { videoId: 'old', at: '2020-01-01 10:00', title: 'old' };
    fs.mkdirSync(path.dirname(YT.uploadsFile()), { recursive: true }); fs.writeFileSync(YT.uploadsFile(), JSON.stringify(rec));
    ok(YT.uploadsToday() === YT.DEFAULT_DAILY_CAP && YT.status().uploadsToday === YT.DEFAULT_DAILY_CAP, `오늘(KST) 올린 것만 센다 — 옛 기록은 안 센다 (${YT.uploadsToday()}편)`);
    const vid = path.join(TMP, 'v.mp4'); fs.writeFileSync(vid, Buffer.alloc(2048, 1));
    const r = await YT.uploadVideo({ file: vid, title: '제목', channelId: 'UCX' });
    ok(!r.ok && r.capReached === true && /상한\(30편\)/.test(r.error) && /내 구글 프로젝트/.test(r.error), `🔑 상한이면 네트워크에 가기 전에 막고 이유·해결(내 프로젝트)을 사람 말로 (${r.error.slice(0, 40)}…)`);
    // 판정력: 자기 프로젝트를 쓰면 같은 기록이어도 상한에 안 걸린다
    const own = writeClient('own2-id.apps.googleusercontent.com', 'my-proj2');
    YT.importClient(own);
    const r2 = await YT.uploadVideo({ file: vid, title: '제목', channelId: 'UCX' });
    ok(!r2.capReached && YT.status().dailyCap === null, '(판정력) 자기 프로젝트 = 앱 상한 없음 — 같은 기록으로도 막히지 않는다(연결 안 된 채널이라 다른 이유로 실패)');
    ok(/_capState\(\); if \(cs\.full\) return \{ ok: false, capReached: true/.test(read('core/youtube-upload.js')), '상한 검사는 uploadVideo 입구 한 곳');
  }

  console.log('\n[4] 화면 · IPC · 문서');
  {
    const APP = read('renderer/src/App.jsx'), M = read('main.js'), PRE = read('preload.js');
    ok(/data-testid="yt-source"/.test(APP) && /Priming 기본 연결/.test(APP) && /고급: 내 프로젝트 파일/.test(APP) && /data-testid="yt-use-default"/.test(APP), '화면: ① 앱 연결(기본 · 오늘 N/상한) · 고급: 내 프로젝트 파일… / ↩ 기본으로');
    ok(/ipcMain\.handle\('yt-use-default-client'/.test(M) && /ytUseDefaultClient/.test(PRE), 'IPC yt-use-default-client · preload');
    ok(/DEFAULT_DAILY_CAP/.test(read('core/youtube-upload.js')) && !/hasClient \? '가져옴'/.test(APP), '옛 「파일 가져오기」 필수 문구가 없다');
    ok(!/require\(/.test(read('core/youtube-default-client.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), '기본 연결 모듈은 순수 값(의존성·부작용 없음)');
  }

  os.homedir = realHome;
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log(`\n${fail ? '❌' : '✅'} youtube-default ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
