/**
 * youtube-upload.test.js — ⬆ 유튜브 비공개 업로드 검증 (2026-09-24, v0.5.31)
 *
 * 실제 구글에 닿지 않는다 — 가짜 구글 서버(토큰·채널·재개 업로드)를 띄워 원문 모듈을 그대로 돌린다.
 * HOME 은 임시 폴더로 갈아끼운다(실제 ~/.priming-maker 무변경). 암호화는 가짜(_setCrypto)로 — safeStorage 는 Electron 밖에서 못 쓴다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-up-'));
process.env.USERPROFILE = TMP; process.env.HOME = TMP;
const ROOT = path.join(__dirname, '..');
const YT = require(path.join(ROOT, 'core', 'youtube-upload.js'));
const PK = require(path.join(ROOT, 'core', 'yt-packaging.js'));
const CH = require(path.join(ROOT, 'core', 'yt-chapters.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 가짜 암호화 — 저장 파일에 평문이 안 남는지 볼 수 있게 뒤집고 표식을 붙인다
YT._setCrypto({ enc: (s) => 'ENC:' + Buffer.from(String(s)).toString('base64').split('').reverse().join(''), dec: (b) => { const s = String(b); return s.startsWith('ENC:') ? Buffer.from(s.slice(4).split('').reverse().join(''), 'base64').toString() : ''; } });

// ── 가짜 구글 ──────────────────────────────────────────────────────────────
const G = {
  scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
  refreshCalls: 0, revoked: [], meta: null, received: [], fail503At: -1, failed503: false,
  put401Once: false, beginStatus: 200, beginBody: null, chunkPuts: 0, statusQueries: 0,
  channel: { id: 'UC_TEST_1', snippet: { title: '로이의 고전이야기', customUrl: '@roy' } },
};
function body(req) { return new Promise((r) => { const a = []; req.on('data', (c) => a.push(c)); req.on('end', () => r(Buffer.concat(a))); }); }
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const b = await body(req);
  const J = (st, obj, h = {}) => { res.writeHead(st, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(obj)); };
  if (u.pathname === '/token') {
    const q = new URLSearchParams(b.toString());
    if (q.get('grant_type') === 'authorization_code') {
      if (q.get('code') !== 'CODE123' || !q.get('code_verifier')) return J(400, { error: 'invalid_grant' });
      return J(200, { access_token: 'AT1', expires_in: 3600, refresh_token: 'RT-SECRET-XYZ', scope: G.scope });
    }
    if (q.get('grant_type') === 'refresh_token') { G.refreshCalls++; if (q.get('refresh_token') !== 'RT-SECRET-XYZ') return J(400, { error: 'invalid_grant' }); return J(200, { access_token: 'AT' + (1 + G.refreshCalls), expires_in: 3600 }); }
  }
  if (u.pathname === '/revoke') { G.revoked.push(new URLSearchParams(b.toString()).get('token')); return J(200, {}); }
  if (u.pathname === '/api/channels') return J(200, { items: G.channel ? [G.channel] : [] });
  if (u.pathname === '/upload' && req.method === 'POST') {
    G.meta = JSON.parse(b.toString() || '{}'); G.total = Number(req.headers['x-upload-content-length']);
    if (G.beginStatus !== 200) return J(G.beginStatus, G.beginBody || {});
    res.writeHead(200, { Location: `http://127.0.0.1:${server.address().port}/session/1` }); return res.end();
  }
  if (u.pathname === '/session/1' && req.method === 'PUT') {
    const cr = String(req.headers['content-range'] || '');
    const have = G.received.reduce((a, x) => a + x.length, 0);
    if (/\*\//.test(cr)) { G.statusQueries++; res.writeHead(308, have ? { Range: `bytes=0-${have - 1}` } : {}); return res.end(); }
    if (G.put401Once && req.headers.authorization === 'Bearer AT1') { G.put401Once = false; return J(401, { error: { message: 'expired' } }); }
    G.chunkPuts++;
    if (G.chunkPuts === G.fail503At && !G.failed503) { G.failed503 = true; return J(503, { error: { message: 'busy' } }); }
    const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(cr);
    const start = Number(m[1]);
    if (start === have) G.received.push(b);                // 이미 받은 조각을 다시 보내면 무시
    const now = G.received.reduce((a, x) => a + x.length, 0);
    if (now >= G.total) return J(200, { id: 'VID_OK_1', snippet: { channelId: G.channel.id }, status: { privacyStatus: 'private' } });
    res.writeHead(308, { Range: `bytes=0-${now - 1}` }); return res.end();
  }
  J(404, {});
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  YT._setEndpoints({ auth: base + '/auth', token: base + '/token', revoke: base + '/revoke', api: base + '/api', upload: base + '/upload' });

  console.log('\n[1] 연결 파일 판정');
  ok(!YT.parseClientJson('not json').ok, 'JSON 아님 → 거부');
  ok(/웹 애플리케이션/.test(YT.parseClientJson(JSON.stringify({ web: { client_id: 'a', client_secret: 'b' } })).error), '웹 유형 → 데스크톱 유형을 고르라고 안내');
  ok(!YT.parseClientJson(JSON.stringify({ installed: { client_id: 'a' } })).ok, 'secret 없음 → 거부');
  const good = YT.parseClientJson(JSON.stringify({ installed: { client_id: 'CID.apps', client_secret: 'CSEC', project_id: 'priming-upload' } }));
  ok(good.ok && good.projectId === 'priming-upload', '데스크톱 유형 → 통과');

  console.log('\n[2] 가져오기 · 상태 — 비밀값이 새지 않는다');
  const cf = path.join(TMP, 'client_secret_x.json');
  fs.writeFileSync(cf, JSON.stringify({ installed: { client_id: 'CID.apps', client_secret: 'CSEC-PLAIN', project_id: 'priming-upload' } }));
  const im = YT.importClient(cf);
  ok(im.ok && im.projectId === 'priming-upload', '가져오기 성공');
  const raw = fs.readFileSync(YT.authFile(), 'utf8');
  ok(!raw.includes('CSEC-PLAIN') && !raw.includes('CID.apps'), '저장 파일에 클라이언트 비밀번호·ID 평문 없음');
  let st = YT.status();
  ok(st.hasClient && st.projectId === 'priming-upload' && st.channels.length === 0, 'status: hasClient · 채널 0');
  ok(!JSON.stringify(st).includes('CSEC'), 'status 에 비밀값 없음');

  console.log('\n[3] 채널 연결(루프백 + PKCE)');
  const browse = async (u, code = 'CODE123', extra = {}) => {
    const q = new URL(u).searchParams;
    ok(q.get('code_challenge_method') === 'S256' && q.get('code_challenge'), 'PKCE S256');
    ok(q.get('access_type') === 'offline' && /consent/.test(q.get('prompt')) && /select_account/.test(q.get('prompt')), 'offline + 채널 선택 + consent');
    ok(q.get('scope').includes('youtube.upload') && q.get('scope').includes('youtube.readonly') && q.get('scope').split(' ').length === 2, '권한은 두 가지뿐');
    const back = new URL(q.get('redirect_uri'));
    ok(back.hostname === '127.0.0.1', '루프백 127.0.0.1');
    const p = new URLSearchParams({ state: extra.state || q.get('state'), ...(extra.error ? { error: extra.error } : { code }) });
    setTimeout(() => { http.get(`${q.get('redirect_uri')}/?${p}`, (r) => r.resume()); }, 20);
  };
  let c = await YT.connectChannel({ openUrl: (u) => browse(u) });
  ok(c.ok && c.channel.id === 'UC_TEST_1' && c.channel.title === '로이의 고전이야기', '연결 성공 · 채널 이름');
  const raw2 = fs.readFileSync(YT.authFile(), 'utf8');
  ok(!raw2.includes('RT-SECRET-XYZ'), '갱신 토큰이 평문으로 저장되지 않음');
  st = YT.status();
  ok(st.channels.length === 1 && st.channels[0].handle === '@roy' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(st.channels[0].connectedAt), '채널 목록 · 연결 시각(KST 표기)');
  G.scope = 'https://www.googleapis.com/auth/youtube.readonly';
  c = await YT.connectChannel({ openUrl: (u) => browse(u) });
  ok(!c.ok && /동영상 관리/.test(c.error), '업로드 권한 체크를 풀고 허용 → 연결 거부 + 이유');
  G.scope = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
  c = await YT.connectChannel({ openUrl: (u) => browse(u, null, { error: 'access_denied' }) });
  ok(!c.ok && /허용하지 않았/.test(c.error), '거부 → 사람 말');
  c = await YT.connectChannel({ openUrl: (u) => browse(u, 'CODE123', { state: 'WRONG' }) });
  ok(!c.ok, 'state 불일치 → 거부');
  G.channel = null;
  c = await YT.connectChannel({ openUrl: (u) => browse(u) });
  ok(!c.ok && /채널이 없습니다/.test(c.error), '채널 없는 계정 → 채널을 고르라고 안내');
  G.channel = { id: 'UC_TEST_1', snippet: { title: '로이의 고전이야기', customUrl: '@roy' } };
  c = await YT.connectChannel({ openUrl: () => {}, timeoutMs: 150 });
  ok(!c.ok && /5분/.test(c.error), '응답 없으면 시간 초과로 끝난다(서버를 닫는다)');

  console.log('\n[4] 재개 가능 업로드 — 조각 · 503 뒤 이어받기 · 401 갱신');
  const mp4 = path.join(TMP, '[고전_0930] 단테.mp4');
  const data = Buffer.alloc(256 * 1024 * 3 + 12345); for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 255;
  fs.writeFileSync(mp4, data);
  G.fail503At = 2; G.put401Once = true;
  const prog = []; const logs = [];
  let r = await YT.uploadVideo({
    channelId: 'UC_TEST_1', file: mp4, title: '추방당한 <단테>는\n왜', description: '설명 <b>',
    tags: ['단테', '신곡', '단테', 'a,b', '#고전'], chunkSize: 256 * 1024, backoff: [0.01, 0.01],
    onProgress: (p) => prog.push(p), log: (l) => logs.push(l),
  });
  ok(r.ok && r.videoId === 'VID_OK_1' && r.url === 'https://youtu.be/VID_OK_1' && /studio\.youtube\.com\/video\/VID_OK_1/.test(r.studioUrl), '업로드 성공 · 영상/Studio 주소');
  ok(Buffer.concat(G.received).equals(data), '🔑 받은 바이트가 원본과 정확히 같다(끊긴 뒤 이어받아도)');
  ok(G.failed503 && G.statusQueries >= 1, '503 뒤 「어디까지 받았나」 조회 후 이어 올림');
  ok(G.refreshCalls >= 1, '401 → 토큰 갱신 후 계속');
  ok(G.meta.status.privacyStatus === 'private', '🔒 비공개로 보낸다');
  ok(G.meta.status.containsSyntheticMedia === true, '🤖 AI 합성 콘텐츠 = 예');
  ok(G.meta.status.selfDeclaredMadeForKids === false, '아동용 아님');
  ok(G.meta.snippet.title === '추방당한 단테는 왜', '제목: 꺾쇠·줄바꿈 제거');
  ok(!/[<>]/.test(G.meta.snippet.description), '설명: 꺾쇠 제거');
  ok(JSON.stringify(G.meta.snippet.tags) === JSON.stringify(['단테', '신곡', 'ab', '고전']), '태그: 중복·쉼표·# 정리');
  ok(G.meta.snippet.defaultAudioLanguage === 'ko', '음성 언어 ko');
  ok(prog.some((p) => p.phase === 'upload' && p.sent > 0 && p.sent < p.total) && prog[prog.length - 1].phase === 'done', '진행 이벤트(upload → done)');
  ok(YT.findUploaded('UC_TEST_1', mp4) && YT.findUploaded('UC_TEST_1', mp4).videoId === 'VID_OK_1', '올린 기록 → 같은 파일 재업로드 판정');
  ok(!YT.findUploaded('UC_OTHER', mp4), '다른 채널이면 기록 없음');

  console.log('\n[5] 실패는 사람 말 · 던지지 않는다');
  G.beginStatus = 403; G.beginBody = { error: { errors: [{ reason: 'quotaExceeded' }], message: 'quota' } };
  r = await YT.uploadVideo({ channelId: 'UC_TEST_1', file: mp4, title: 't', backoff: [0.01] });
  ok(!r.ok && /할당량/.test(r.error) && /오후 4~5시/.test(r.error), 'quotaExceeded → 언제 풀리는지까지');
  G.beginStatus = 200;
  r = await YT.uploadVideo({ channelId: 'UC_NOPE', file: mp4, title: 't' });
  ok(!r.ok && /연결되지 않았습니다/.test(r.error), '연결 안 된 채널 → 안내');
  r = await YT.uploadVideo({ channelId: 'UC_TEST_1', file: path.join(TMP, 'none.mp4'), title: 't' });
  ok(!r.ok && /없습니다/.test(r.error), '파일 없음');
  r = await YT.uploadVideo({ channelId: 'UC_TEST_1', file: mp4, title: '   ' });
  ok(!r.ok && /제목/.test(r.error), '빈 제목 거부');
  G.received = [];
  r = await YT.uploadVideo({ channelId: 'UC_TEST_1', file: mp4, title: 't', chunkSize: 256 * 1024, isAborted: (() => { let n = 0; return () => ++n > 2; })() });
  ok(!r.ok && r.cancelled, '⏹ 중단 → cancelled');

  console.log('\n[6] 규칙 한도');
  ok(Array.from(YT.cleanTitle('가'.repeat(150))).length === 100, '제목 100자');
  ok(Buffer.byteLength(YT.cleanDescription('가'.repeat(3000)), 'utf8') <= 5000, '설명 5000바이트');
  const many = YT.cleanTags(Array.from({ length: 200 }, (_, i) => '태그' + i));
  ok(many.join(',').length <= 500, '태그 합계 500자');

  console.log('\n[7] 연결 해제 — 구글 쪽 철회 시도 + 로컬 삭제');
  const d = await YT.disconnect('UC_TEST_1');
  ok(d.ok && G.revoked.includes('RT-SECRET-XYZ') && YT.status().channels.length === 0, '철회 호출 · 목록에서 빠짐');
  ok(!(await YT.uploadVideo({ channelId: 'UC_TEST_1', file: mp4, title: 't' })).ok, '해제 뒤 업로드 불가');
  fs.writeFileSync(cf, JSON.stringify({ installed: { client_id: 'OTHER.apps', client_secret: 'S2', project_id: 'p2' } }));
  await YT.connectChannel({ openUrl: (u) => browse(u) });
  const im2 = YT.importClient(cf);
  ok(im2.ok && im2.cleared === 1 && YT.status().channels.length === 0, '다른 프로젝트 파일로 바꾸면 기존 채널 연결을 비운다(그 토큰은 못 쓴다)');

  console.log('\n[8] 패키징 파일 → 제목·설명·태그');
  const pkText = [
    '# [고전_0930] 추방당한 단테', '', '## 제목', '추방당한 단테는 왜 지옥을 통과하는 신곡을 썼나?', '',
    '## 제목 근거', '- 「왜」로 감춘다', '', '## 설명글', '', '```', '첫 문단.', '', '둘째 문단.', '', '#단테 #신곡', '```', '', '- 검수 메모',
    '', '## 태그', '', '```', '단테, 신곡, 단테 신곡', '```', '', '## 고정댓글', '```', '댓글', '```',
  ].join('\n');
  const pk = PK.parsePackaging(pkText);
  ok(pk.title === '추방당한 단테는 왜 지옥을 통과하는 신곡을 썼나?', '## 제목(「제목 근거」와 헷갈리지 않는다)');
  ok(pk.description === '첫 문단.\n\n둘째 문단.\n\n#단테 #신곡', '## 설명글 = ``` 블록 안만(검수 메모 제외)');
  ok(JSON.stringify(pk.tags) === JSON.stringify(['단테', '신곡', '단테 신곡']), '## 태그');
  const withCh = PK.insertChapters(pk.description, '0:00 도입\n1:00 본론');
  ok(withCh === '첫 문단.\n\n둘째 문단.\n\n0:00 도입\n1:00 본론\n\n#단테 #신곡', '챕터는 해시태그 줄 앞에(해시태그는 맨 끝)');
  ok(PK.insertChapters('해시 없음', '0:00 a') === '해시 없음\n\n0:00 a', '해시태그 없으면 끝에');
  ok(PK.insertChapters('', '0:00 a') === '0:00 a', '설명이 없으면 챕터만');

  const chan = path.join(TMP, '채널');
  const sp = path.join(chan, '대본', '2026_09', '[고전_0930] 추방당한 단테.md');
  fs.mkdirSync(path.dirname(sp), { recursive: true }); fs.writeFileSync(sp, '# x');
  const pp = path.join(chan, '패키징', '2026_09', '[고전_0930] 추방당한 단테.md');
  fs.mkdirSync(path.dirname(pp), { recursive: true }); fs.writeFileSync(pp, pkText);
  ok(PK.findPackagingFile(sp) === pp, '대본/월 ↔ 패키징/월 같은 이름');
  const sp2 = path.join(chan, '대본', '[고전_0930] 이름이 바뀐 대본.md'); fs.writeFileSync(sp2, '# x');
  ok(PK.findPackagingFile(sp2) === pp, '이름이 달라도 같은 [코드] 로 찾는다');
  ok(PK.findPackagingFile(path.join(TMP, '없음', 'x.md')) === null, '없으면 null');

  // 챕터 — 앱 ⏱ 타임스탬프와 같은 함수(core/yt-chapters.js)
  const dto = { title: '[고전_0930] H1 제목', cuts: [
    { h2: '도입', groupDurationSec: 30, sentences: [{ dur: 30 }] },
    { h2: '본론', groupDurationSec: 60, sentences: [{ dur: 60 }] },
    { h2: '마무리', groupDurationSec: 20, sentences: [{ dur: 20 }] },
  ] };
  let m = PK.buildUploadMeta({ scriptPath: sp, dtoProject: dto });
  ok(m.source === 'packaging' && m.title === pk.title && m.chapters === 3, '패키징 제목 · 챕터 3개');
  ok(m.description.includes('0:00 도입\n0:30 본론\n1:30 마무리') && m.description.trim().endsWith('#단테 #신곡'), '설명 = 패키징 설명 + 챕터 + 해시태그');
  m = PK.buildUploadMeta({ scriptPath: path.join(TMP, '없음', '[역사_0101] 파일.md'), dtoProject: dto });
  ok(m.source === 'script' && m.title === 'H1 제목' && m.notes.some((n) => /패키징 파일/.test(n)), '패키징 없음 → H1(코드 뗌) + 이유를 남긴다');
  const shortDto = { title: 't', cuts: [{ h2: 'a', groupDurationSec: 5, sentences: [{ dur: 5 }] }, { h2: 'b', groupDurationSec: 30, sentences: [{ dur: 30 }] }] };
  m = PK.buildUploadMeta({ scriptPath: sp, dtoProject: shortDto });
  ok(m.chapters === 0 && !/0:00 a/.test(m.description) && m.notes.some((n) => /규칙/.test(n)), '챕터가 유튜브 규칙에 안 맞으면 넣지 않는다');
  ok(CH.tsChaptersOf(dto).length === 3, 'core/yt-chapters 원본 실행');

  console.log('\n[9] 실제 패키징 파일(있으면)');
  const real = 'D:/## 아도나이로이/01_고전/01_로이의 고전이야기/대본/2026_09/[고전_0930] 추방당한 단테는 왜 지옥을 통과하는 신곡을 썼나.md';
  const rp = PK.findPackagingFile(real);
  if (rp) {
    const rm = PK.parsePackaging(fs.readFileSync(rp, 'utf8'));
    ok(rm.title.startsWith('추방당한 단테는') && rm.description.length > 200 && rm.tags.length >= 5, '실제 패키징에서 제목·설명·태그');
    ok(!/검수|Codex|🔴/.test(rm.description), '설명에 검수 메모가 섞이지 않는다');
  } else console.log('  - (이 PC 에 아도나이로이 폴더가 없어 건너뜀)');

  console.log('\n[10] 배선');
  const M = read('main.js');
  ok((M.match(/renderUploadMp4\(vrewPath, baseName, preset, pr\)/g) || []).length === 2, '두 경로(💾 · ⚡) 모두 편(pr)을 넘긴다 → 자동 업로드');
  ok(/if \(r\.ok && pr\) \{ try \{ maybeAutoUpload\(/.test(M), 'MP4 성공 뒤 자동 업로드(기다리지 않음)');
  ok(!/await maybeAutoUpload/.test(M), '🔑 자동 업로드를 await 하지 않는다(큐의 다음 대본이 멈추지 않게)');
  ok(/findUploaded\(preset\.ytChannelId, file\)/.test(M), '자동 업로드는 이미 올린 파일을 건너뛴다');
  for (const h of ['yt-status', 'yt-import-client', 'yt-connect', 'yt-disconnect', 'yt-abort', 'yt-open-url', 'yt-upload-current']) ok(M.includes(`ipcMain.handle('${h}'`), `IPC ${h}`);
  ok(/studio\\\.youtube\\\.com\|youtu\\\.be/.test(M), 'yt-open-url 은 유튜브 주소만 연다');
  const PL = read('preload.js');
  for (const k of ['ytStatus', 'ytImportClient', 'ytConnect', 'ytDisconnect', 'ytUploadCurrent', 'ytAbort', 'ytOpenUrl', 'onYtProgress']) ok(PL.includes(k + ':'), `preload ${k}`);
  const A = read('renderer/src/App.jsx');
  ok(/ytAuto: !!p\.ytAuto, ytChannelId: p\.ytChannelId/.test(A), '채널편집이 ytAuto·ytChannelId 를 싣는다');
  ok(/ytAuto: !!ch\.ytAuto && !!ch\.ytChannelId, ytChannelId: ch\.ytChannelId/.test(A), '저장 patch 에 ytAuto·ytChannelId(안 실으면 덮인다)');
  ok(A.includes("['yt', '▶ 유튜브']") && A.includes("if (id === 'yt') ytLoad();"), '⚙ 설정 ▶ 유튜브 탭');
  ok(A.includes("import ytChapters from '../../core/yt-chapters.js'") && !/\nfunction tsChaptersOf\(/.test(A), '🔑 챕터 계산은 core 하나(App.jsx 에 복사본 없음)');
  ok(/\(outTarget === 'mp4' \|\| outTarget === 'whiteboard'\) && <button[^>]*onClick=\{runYtUpload\}/.test(A), '헤더 ⬆ 업로드(유튜브 MP4 · 화이트보드 MP4 일 때)');
  ok(A.includes("api.ytUploadCurrent({ presetName, kind: outTarget === 'whiteboard' ? 'whiteboard' : 'mp4' })"), '⬆ 업로드가 완성 종류(kind)를 넘긴다');
  ok(/isWb[\s\S]{0,160}wbFinalDir\(preset\)[\s\S]{0,60}_whiteboard\.mp4/.test(M), '수동 업로드: 화이트보드는 「화이트보드」 폴더의 _whiteboard.mp4');
  ok(M.includes('const finalDir = wbFinalDir(preset);'), '렌더와 업로드가 같은 화이트보드 폴더 함수');
  ok(M.includes('if (wr.hasAudio) { try { maybeAutoUpload(pr, wr.output, preset)'), '✏ 화이트보드 성공 뒤 자동 업로드 — 🔴 음성 있을 때만');
  ok(M.includes("ipcMain.handle('yt-reorder'") && PL.includes('ytReorder:'), 'IPC·preload yt-reorder');
  ok(A.includes('data-testid="yt-ch-row" draggable') && A.includes('onDrop={(e) => { e.preventDefault(); ytDrop(i); }}'), '▶ 유튜브 채널 줄을 끌어서 놓기');

  console.log('\n[11] ↕ 채널 순서(reorderChannels)');
  {
    const d0 = JSON.parse(fs.readFileSync(YT.authFile(), 'utf8'));
    const extra = { UCaaa: { title: 'A', refresh: 'x' }, UCbbb: { title: 'B', refresh: 'x' }, UCccc: { title: 'C', refresh: 'x' } };
    fs.writeFileSync(YT.authFile(), JSON.stringify({ ...d0, channels: { ...extra } }), 'utf8');
    let r = YT.reorderChannels(['UCccc', 'UCaaa', 'UCbbb']);
    ok(r.ok && YT.status().channels.map((c) => c.id).join() === 'UCccc,UCaaa,UCbbb', '끌어 놓은 순서 = status() 순서(설정·업로드채널 목록 공통)');
    r = YT.reorderChannels(['UCbbb', 'UCzzz']);
    ok(YT.status().channels.map((c) => c.id).join() === 'UCbbb,UCccc,UCaaa', '모르는 ID 는 무시 · 빠진 채널은 원래 순서로 뒤에(잃지 않는다)');
    ok(YT.status().channels.length === 3 && JSON.parse(fs.readFileSync(YT.authFile(), 'utf8')).channels.UCaaa.refresh === 'x', '연결 정보(토큰)는 그대로');
    fs.writeFileSync(YT.authFile(), JSON.stringify(d0), 'utf8');
  }
  const CS = read('core/yt-chapters.js');
  ok(!/require\(/.test(CS.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'core/yt-chapters.js 에 CJS 런타임 참조 없음(렌더러 번들 백지 사고 방지)');
  const pj = JSON.parse(read('package.json'));
  ok(!Object.keys(pj.dependencies || {}).some((k) => /googleapis|google-auth/.test(k)), 'npm 의존성 추가 없음(라이트 업데이트 유지)');
  const leak = [];
  (function walk(d, depth) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', 'dist', 'output'].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory() && depth < 4) walk(p, depth + 1); else if (/^client_secret.*\.json$/i.test(e.name)) leak.push(p); } })(ROOT, 0);
  ok(leak.length === 0, '🔴 저장소 안에 client_secret 파일 없음(공개 GitHub)');

  server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? '❌' : '✅'} youtube-upload ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
