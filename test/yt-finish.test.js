/**
 * yt-finish.test.js — 🧷 업로드 마무리(v0.9.33): 썸네일 A · 재생목록을 API 로 넣고 다시 읽어 확인표를 낸다.
 *   실제 구글에 닿지 않는다 — 가짜 구글(썸네일 · 재생목록 · 재생목록 항목)로 원문 모듈을 돌린다. HOME 은 임시 폴더.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-finish-'));
process.env.USERPROFILE = TMP; process.env.HOME = TMP;
const ROOT = path.join(__dirname, '..');
const YF = require(path.join(ROOT, 'core', 'yt-finish.js'));
const PK = require(path.join(ROOT, 'core', 'yt-packaging.js'));
const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const A = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

// 가짜 구글 — 재생목록 G.pls(id·title·channelId) · 담긴 것 G.items(Set "pl|video") · 썸네일 요청 G.thumbs
const G = { pls: [], items: new Set(), thumbs: [], inserts: 0, thumbStatus: 200, insertStatus: 200, insertLies: false, auth: [] };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const J = (st, obj) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    G.auth.push(req.headers.authorization);
    const body = Buffer.concat(chunks);
    if (u.pathname === '/thumb') {
      G.thumbs.push({ videoId: u.searchParams.get('videoId'), type: req.headers['content-type'], len: body.length });
      if (G.thumbStatus !== 200) return J(G.thumbStatus, { error: { errors: [{ reason: 'forbidden' }], message: 'no' } });
      return J(200, { items: [{ default: { url: 'x' } }] });
    }
    if (u.pathname === '/api/playlists') {
      const id = u.searchParams.get('id');
      const items = (id ? G.pls.filter((p) => p.id === id) : G.pls.filter((p) => p.channelId === 'UC_T')).map((p) => ({ id: p.id, snippet: { title: p.title, channelId: p.channelId } }));
      return J(200, { items });
    }
    if (u.pathname === '/api/playlistItems' && req.method === 'GET') {
      const k = `${u.searchParams.get('playlistId')}|${u.searchParams.get('videoId')}`;
      return J(200, { items: G.items.has(k) ? [{ id: 'PI' }] : [] });
    }
    if (u.pathname === '/api/playlistItems' && req.method === 'POST') {
      G.inserts++;
      if (G.insertStatus !== 200) return J(G.insertStatus, { error: { errors: [{ reason: 'insufficientPermissions' }], message: 'Request had insufficient authentication scopes.' } });
      const j = JSON.parse(body.toString());
      if (!G.insertLies) G.items.add(`${j.snippet.playlistId}|${j.snippet.resourceId.videoId}`);
      return J(200, { id: 'PI_NEW' });
    }
    J(404, {});
  });
});

const PLID = 'PLabcdefghijklmnopqrstuvwxyz012345';
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  YF._setEndpoints({ api: base + '/api', thumb: base + '/thumb' });
  const thumbDir = path.join(TMP, '99_썸네일', '02_고전서재'); fs.mkdirSync(thumbDir, { recursive: true });
  const mk = (n, size = 3000) => { const p = path.join(thumbDir, n); fs.writeFileSync(p, Buffer.alloc(size, 7)); return { name: n, path: p }; };
  const tA = mk('[서재_1024] 썸네일_A.png'), tB = mk('[서재_1024] 썸네일_B.png'), tC = mk('[서재_1024] 썸네일_C.png');
  let tokCalls = 0;
  const token = async (force) => { tokCalls++; return force ? 'AT2' : 'AT1'; };

  console.log('\n[1] 패키징 — 고정댓글 · 재생목록 칸');
  const md = `# [서재_1024] 제목\n\n## 제목\n\n노생거 5부\n\n## 설명글\n\n\`\`\`\n설명 https://www.youtube.com/playlist?list=PLdescdescdescdesc01\n\`\`\`\n\n## 태그\n\n\`\`\`\n고전\n\`\`\`\n\n## 고정댓글\n\n\`\`\`\n물음 하나.\n\n처음부터: https://www.youtube.com/watch?v=qo5ZqcmkACE&list=${PLID}\n\`\`\`\n\n- 메모\n`;
  const pk = PK.parsePackaging(md);
  ok(/^물음 하나\.\n\n처음부터: https/.test(pk.pinned) && !/메모/.test(pk.pinned), '「## 고정댓글」 코드블록 원문 그대로(아래 메모 줄은 빼고)');
  ok(pk.playlist === '' && pk.title === '노생거 5부', '「## 재생목록」이 없으면 빈 값 · 기존 제목 그대로');
  ok(PK.parsePackaging('## 재생목록\n\n작가와 고전\n').playlist === '작가와 고전', '「## 재생목록」 첫 줄 = 이름');

  console.log('\n[2] 재생목록 정하는 순서');
  ok(JSON.stringify(YF.parsePlaylistRef(`https://youtube.com/playlist?list=${PLID}`)) === JSON.stringify({ id: PLID }), '주소 → id');
  ok(YF.parsePlaylistRef(PLID).id === PLID && YF.parsePlaylistRef('작가와 고전').name === '작가와 고전' && YF.parsePlaylistRef('  ') === null, 'ID → id · 그 밖 → 이름 · 빈 값 → 없음');
  let plan = YF.planFinish({ pack: pk, preset: { ytPlaylist: '채널목록' }, thumbs: [tC, tA, tB] });
  ok(plan.playlist.id === PLID && plan.playlist.source === '고정댓글 링크', '패키징 재생목록이 없으면 고정댓글 링크(설명글·채널 설정보다 먼저)');
  ok(plan.thumbA === tA && plan.thumbOthers.length === 2, '썸네일 A 는 이름으로 고른다(순서 무관) · B·C 는 Studio 몫');
  ok(YF.planFinish({ pack: { ...pk, playlist: '작가와 고전' }, preset: { ytPlaylist: '채널목록' } }).playlist.name === '작가와 고전', '패키징 「## 재생목록」이 가장 먼저');
  ok(YF.planFinish({ pack: { pinned: '링크 없음', description: '' }, preset: { ytPlaylist: '채널목록' } }).playlist.source === '채널 설정 「재생목록」', '링크가 없으면 채널 설정 이름');
  ok(YF.planFinish({ pack: {}, preset: {} }).playlist === null, '아무 데도 없으면 null(지어내지 않는다)');

  console.log('\n[3] 처음 마무리 — 썸네일 A 넣고 재생목록에 담고 다시 읽어 확인');
  G.pls = [{ id: PLID, title: '노생거 사원', channelId: 'UC_T' }, { id: 'PLzzzzzzzzzzzzzzzzzz', title: '작가와 고전', channelId: 'UC_T' }];
  let r = await YF.finishVideo({ channelId: 'UC_T', videoId: 'V1', plan, token });
  const it = (k) => r.items.find((x) => x.key === k);
  ok(it('thumb').status === 'ok' && G.thumbs.length === 1 && G.thumbs[0].videoId === 'V1' && G.thumbs[0].type === 'image/png' && G.thumbs[0].len === 3000, '썸네일 A 파일을 그 영상에 보냄(png · 크기 그대로)');
  ok(it('playlist').status === 'ok' && G.items.has(`${PLID}|V1`) && /노생거 사원/.test(it('playlist').detail), '재생목록 「노생거 사원」에 담음');
  ok(['pinned', 'abtest', 'endscreen', 'schedule'].every((k) => it(k).status === 'manual'), '고정댓글·A/B·종료화면·예약 = ✋ Studio 로 확인표에 남는다(빠뜨리지 않고 적는다)');
  ok(r.done === 2 && r.failed === 0 && r.manual === 4, `셈: 앱 2 · 빠짐 0 · Studio 4 (실제 ${r.done}/${r.failed}/${r.manual})`);
  const lines = YF.reportLines('노생거 5부', r);
  ok(/^🧷 업로드 마무리 — 「노생거 5부」 · 앱 처리 2 · ✋ Studio 4$/.test(lines[0]) && lines.length === 7, '확인표 첫 줄 + 항목 6줄');
  ok(!lines.join('\n').match(/[✗❌🐞]/), '⛔ 확인표에 ✗·❌·🐞 없음(오류 자동 전송이 콘텐츠 빈칸을 앱 오류로 잡지 않게)');

  console.log('\n[4] 다시 마무리 — 이미 된 것은 다시 보내지 않는다(할당량)');
  const ins0 = G.inserts;
  r = await YF.finishVideo({ channelId: 'UC_T', videoId: 'V1', plan, token });
  ok(G.thumbs.length === 1 && /이미 넣음/.test(r.items[0].detail), '같은 썸네일 파일이면 다시 보내지 않음');
  ok(G.inserts === ins0 && /이미 들어 있음/.test(r.items[1].detail), '이미 담긴 재생목록이면 다시 넣지 않음');
  fs.writeFileSync(tA.path, Buffer.alloc(3100, 8));
  r = await YF.finishVideo({ channelId: 'UC_T', videoId: 'V1', plan, token });
  ok(G.thumbs.length === 2, '판정력: 썸네일 파일이 바뀌면 다시 보낸다');

  console.log('\n[5] 빠진 것은 ⚠ 로 — 조용히 넘어가지 않는다');
  r = await YF.finishVideo({ channelId: 'UC_T', videoId: 'V2', plan: YF.planFinish({ pack: {}, thumbs: [] }), token });
  ok(r.items[0].status === 'fail' && /썸네일_A 파일이 없습니다/.test(r.items[0].detail), '썸네일 A 없음 → 빠짐');
  ok(r.items[1].status === 'fail' && /정해진 재생목록이 없습니다/.test(r.items[1].detail), '재생목록 없음 → 빠짐');
  ok(r.items.find((x) => x.key === 'pinned').status === 'fail', '고정댓글 문구 없음 → 빠짐');
  ok(/⚠ 빠짐 3/.test(YF.reportLines('t', r)[0]), '확인표 첫 줄에 빠진 개수');
  r = await YF.finishVideo({ channelId: 'UC_T', videoId: 'V3', plan: YF.planFinish({ pack: { playlist: '없는 목록' }, thumbs: [] }), token });
  ok(r.items[1].status === 'fail' && /「없는 목록」 재생목록이 없습니다/.test(r.items[1].detail) && /노생거 사원/.test(r.items[1].detail), '이름이 다르면 빠짐 + 있는 목록을 보여 준다(비슷한 이름 자동 매칭 안 함)');
  r = await YF.finishVideo({ channelId: 'UC_T', videoId: 'V3', plan: YF.planFinish({ pack: { playlist: 'https://youtube.com/playlist?list=PLQJ1l87jEIK4' }, thumbs: [] }), token });
  ok(r.items[1].status === 'fail' && /링크가 잘렸거나/.test(r.items[1].detail), '잘린 재생목록 링크 → 빠짐(찾지 못함)');
  G.pls.push({ id: 'PLotherotherotherother', title: '남의 목록', channelId: 'UC_OTHER' });
  r = await YF.finishVideo({ channelId: 'UC_T', videoId: 'V3', plan: YF.planFinish({ pack: { playlist: 'PLotherotherotherother' }, thumbs: [] }), token });
  ok(r.items[1].status === 'fail' && /다른 채널 것/.test(r.items[1].detail), '다른 채널 재생목록에는 담지 않는다');
  G.pls.push({ id: 'PLdupdupdupdupdup01', title: '작가와 고전', channelId: 'UC_T' });
  r = await YF.finishVideo({ channelId: 'UC_T', videoId: 'V3', plan: YF.planFinish({ pack: { playlist: '작가와 고전' }, thumbs: [] }), token });
  ok(r.items[1].status === 'fail' && /2개라 고를 수 없습니다/.test(r.items[1].detail), '같은 이름 목록이 둘이면 고르지 않는다');

  console.log('\n[6] 권한 없음(옛 연결) · 담았다는데 없음 · 썸네일 거부');
  G.insertStatus = 403;
  r = await YF.finishVideo({ channelId: 'UC_T', videoId: 'V4', plan, token });
  ok(r.items[1].status === 'fail' && /다시 연결/.test(r.items[1].detail), '재생목록 권한 없음(403 insufficient) → 「다시 연결」 안내');
  G.insertStatus = 200; G.insertLies = true;
  r = await YF.finishVideo({ channelId: 'UC_T', videoId: 'V5', plan, token });
  ok(r.items[1].status === 'fail' && /다시 읽으니 없습니다/.test(r.items[1].detail), '확인표는 답이 아니라 **다시 읽은 결과**로 판정');
  G.insertLies = false; G.thumbStatus = 403;
  r = await YF.finishVideo({ channelId: 'UC_T', videoId: 'V6', plan, token });
  ok(r.items[0].status === 'fail' && /휴대폰 인증/.test(r.items[0].detail), '맞춤 썸네일 거부(403) → 채널 인증 안내');
  G.thumbStatus = 200;

  console.log('\n[7] 2MB 넘는 썸네일은 줄여서 보낸다');
  const big = mk('[서재_1025] 썸네일_A.png', YF.THUMB_MAX + 10);
  const small = path.join(TMP, 'small.jpg'); fs.writeFileSync(small, Buffer.alloc(500, 1));
  let shrunk = 0;
  r = await YF.finishVideo({ channelId: 'UC_T', videoId: 'V7', plan: YF.planFinish({ pack: {}, thumbs: [big] }), token, shrink: async () => { shrunk++; const c = path.join(TMP, `s${shrunk}.jpg`); fs.copyFileSync(small, c); return c; } });
  const last = G.thumbs[G.thumbs.length - 1];
  ok(shrunk === 1 && last.type === 'image/jpeg' && last.len === 500 && r.items[0].status === 'ok', '2MB 초과 → 줄인 JPEG 를 보냄');
  ok(!fs.existsSync(path.join(TMP, 's1.jpg')), '줄인 임시 파일은 지운다');

  console.log('\n[8] main.js · 화면 배선');
  const run = M.slice(M.indexOf('async function runYtUpload'), M.indexOf('/** 렌더가 끝난 뒤'));
  ok(/if \(finish\) r\.finish = await runYtFinish\(\{ channelId, videoId: r\.videoId, title, finish \}\)/.test(run), '업로드 성공 뒤 마무리');
  ok(/if \(finish && dup\.videoId\) await runYtFinish\(\{ channelId, videoId: dup\.videoId, title, finish \}\)/.test(run), '이미 올린 영상(중복)이면 마무리만');
  const fin = M.slice(M.indexOf('async function runYtFinish'), M.indexOf('/** 렌더가 끝난 뒤'));
  ok(/thumbRoot\(\)/.test(fin) && /findThumbs\(/.test(fin) && /findPackagingFile\(finish\.scriptPath\)/.test(fin), '마무리는 업로드를 줄 세운 순간의 대본(finish.scriptPath)으로 패키징·썸네일을 찾는다');
  ok(/catch \(e\) \{\s*log\(`⚠ 업로드 마무리 못 함/.test(fin), '마무리는 던지지 않는다(업로드 성공을 뒤집지 않는다)');
  const enq = (M.match(/enqueueYtUpload\(\{ file[^\n]*\}\)/g) || []);
  ok(enq.length >= 3 && enq.every((l) => /finish: ytFinishJob\(/.test(l)), `업로드를 줄 세우는 곳 ${enq.length}곳 모두 finish 를 싣는다`);
  ok((M.match(/finishOnly: true/g) || []).length === 3, '이미 올린 영상의 마무리만 = 자동 업로드 · 이 대본만 · 큐 전체 세 곳');
  ok(/ytPlaylist: p\.ytPlaylist \|\| ''/.test(A) && /ytPlaylist: String\(ch\.ytPlaylist \|\| ''\)\.trim\(\)/.test(A) && /data-testid="ch-yt-playlist"/.test(A), '채널편집 재생목록 이름 — 읽기·저장·칸 셋 다');
  ok(/c\.needsReconnect \? ' · ⚠ 재생목록 권한 없음/.test(A), '⚙ 유튜브 — 옛 연결 채널에 「다시 연결」 안내');

  console.log(`\n${fail ? '❌' : '✅'} yt-finish — ${pass} 통과 / ${fail} 실패`);
  server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('❌', e); try { server.close(); } catch (_) {} process.exit(1); });
