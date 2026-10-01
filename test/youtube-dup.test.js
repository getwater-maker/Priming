/**
 * youtube-dup.test.js — 🛡 중복 업로드 방지(v0.5.105 · 로이 2026-10-01 「중복으로 올라갈 수 있는 경우를 없앨 수 있어?」)
 *   실제 구글에 닿지 않는다 — 가짜 구글(토큰 · 채널 · 업로드 목록)로 원문 모듈을 돌린다. HOME 은 임시 폴더.
 *   다루는 중복 경로: ① 같은 파일 ② MP4 를 다시 구움/이름 변경(같은 제목) ③ 다른 PC·스튜디오에서 올린 것(유튜브 목록) ④ 방금 올린 것(같은 큐)
 *   + 삭제한 영상은 목록에 없으니 다시 올릴 수 있다 · 유튜브 확인이 실패하면 막지 않고 알린다 · 비공개도 목록에 잡힌다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-dup-'));
process.env.USERPROFILE = TMP; process.env.HOME = TMP;
const ROOT = path.join(__dirname, '..');
const YT = require(path.join(ROOT, 'core', 'youtube-upload.js'));
const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

YT._setCrypto({ enc: (s) => 'ENC:' + Buffer.from(String(s)).toString('base64'), dec: (b) => { const s = String(b); return s.startsWith('ENC:') ? Buffer.from(s.slice(4), 'base64').toString() : ''; } });
YT._setDefaultClient({ clientId: 'CID', clientSecret: 'CSEC' });

// 가짜 구글 — 업로드 목록은 G.videos(최신순), 50개씩 쪽
const G = { videos: [], listCalls: 0, chanCalls: 0, fail: 0 };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const J = (st, obj) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  req.resume();
  if (u.pathname === '/token') return J(200, { access_token: 'AT1', expires_in: 3600 });
  if (u.pathname === '/api/channels') { G.chanCalls++; if (G.fail) return J(G.fail, { error: { message: 'boom' } }); return J(200, { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU_TEST' } } }] }); }
  if (u.pathname === '/api/playlistItems') {
    G.listCalls++;
    const start = Number(u.searchParams.get('pageToken') || 0);
    const slice = G.videos.slice(start, start + 50);
    const items = slice.map((v) => ({ snippet: { title: v.title, resourceId: { videoId: v.id } }, status: { privacyStatus: v.privacy || 'private' } }));
    return J(200, { items, ...(start + 50 < G.videos.length ? { nextPageToken: String(start + 50) } : {}) });
  }
  J(404, {});
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  YT._setEndpoints({ token: base + '/token', api: base + '/api' });
  // 연결된 채널 하나를 만들어 둔다(refresh 토큰은 가짜 암호화)
  fs.mkdirSync(path.join(TMP, '.priming-maker'), { recursive: true });
  fs.writeFileSync(YT.authFile(), JSON.stringify({ v: 1, client: '', channels: { UC_T: { title: '테스트채널', refresh: 'ENC:' + Buffer.from('RT').toString('base64'), connectedAt: '2026-10-01 00:00' } } }));
  const mp4 = path.join(TMP, 'A.mp4'); fs.writeFileSync(mp4, Buffer.alloc(2048, 1));

  console.log('\n[1] 제목 정규화');
  ok(YT.normTitle('  가나다   라마 ') === '가나다 라마' && YT.normTitle('가<나>다') === '가나다', '공백 접기 · 꺾쇠 제거(업로드 때와 같은 정리)');
  ok(YT.normTitle('Ａ'.normalize('NFD')) === YT.normTitle('Ａ'.normalize('NFC')), '유니코드 정규화(NFC)');

  console.log('\n[2] 유튜브 채널 목록으로 판정 — 다른 PC·스튜디오·다시 구운 파일');
  G.videos = [{ id: 'V_STUDIO', title: '스튜디오에서 올린 영상', privacy: 'private' }, { id: 'V_OTHERPC', title: '다른 PC 에서 올린 영상', privacy: 'public' }];
  let d = await YT.checkDuplicate({ channelId: 'UC_T', file: mp4, title: '스튜디오에서 올린 영상' });
  ok(d.dup && d.where === 'channel' && d.videoId === 'V_STUDIO' && /비공개/.test(d.reason), '스튜디오에서 직접 올린(이 PC 기록 없음) 비공개 영상 → 중복');
  d = await YT.checkDuplicate({ channelId: 'UC_T', file: mp4, title: '다른 PC 에서 올린 영상' });
  ok(d.dup && d.where === 'channel' && d.url === 'https://youtu.be/V_OTHERPC', '다른 PC 에서 올린 영상 → 중복 · 주소를 알려 준다');
  d = await YT.checkDuplicate({ channelId: 'UC_T', file: mp4, title: '   스튜디오에서   올린 영상  ' });
  ok(d.dup, '공백만 다른 제목도 같은 영상');
  d = await YT.checkDuplicate({ channelId: 'UC_T', file: mp4, title: '아직 안 올린 새 영상' });
  ok(!d.dup && !d.warn, '판정력: 목록에 없는 제목은 중복이 아니다');
  ok(G.listCalls === 1 && G.chanCalls === 1, `목록은 한 번만 받는다(90초 캐시 · 채널 ${G.chanCalls} · 목록 ${G.listCalls})`);

  console.log('\n[3] 삭제한 영상은 다시 올릴 수 있다');
  G.videos = G.videos.filter((v) => v.id !== 'V_STUDIO'); YT._clearRemoteTitles();
  d = await YT.checkDuplicate({ channelId: 'UC_T', file: mp4, title: '스튜디오에서 올린 영상' });
  ok(!d.dup, '유튜브에서 지운 영상(목록에 없음) → 중복 아님');

  console.log('\n[4] 목록이 길어도(50편 넘음) 끝까지 본다');
  G.videos = Array.from({ length: 130 }, (_, i) => ({ id: 'V' + i, title: '영상 ' + i })); YT._clearRemoteTitles(); G.listCalls = 0;
  d = await YT.checkDuplicate({ channelId: 'UC_T', file: mp4, title: '영상 129' });
  ok(d.dup && d.videoId === 'V129' && G.listCalls === 3, `130편(3쪽) 마지막 영상까지 찾는다 (목록 호출 ${G.listCalls}회)`);

  console.log('\n[5] 이 PC 기록 — 같은 제목은 파일을 다시 굽거나 이름을 바꿔도 중복');
  G.videos = []; YT._clearRemoteTitles();
  fs.writeFileSync(YT.uploadsFile(), JSON.stringify({ [`UC_T|A.mp4|2048|1`]: { videoId: 'V_LOCAL', at: '2026-10-01 01:00', title: '로컬 기록 영상' } }));
  const reMp4 = path.join(TMP, 'B_다시구움.mp4'); fs.writeFileSync(reMp4, Buffer.alloc(4096, 2));
  d = await YT.checkDuplicate({ channelId: 'UC_T', file: reMp4, title: '로컬 기록 영상', remote: false });
  ok(d.dup && d.where === 'local' && d.videoId === 'V_LOCAL', '다시 구운(크기·이름이 다른) 파일이어도 같은 제목 기록이 있으면 중복');
  ok(!(await YT.checkDuplicate({ channelId: 'UC_OTHER', file: reMp4, title: '로컬 기록 영상', remote: false })).dup, '다른 채널이면 중복 아님(기록은 채널별)');

  console.log('\n[6] 유튜브 확인이 실패하면 막지 않고 알린다(fail-open)');
  G.fail = 500; YT._clearRemoteTitles();
  d = await YT.checkDuplicate({ channelId: 'UC_T', file: reMp4, title: '확인 실패 영상' });
  ok(!d.dup && /확인하지 못했습니다/.test(d.warn || ''), '목록 조회 실패 → dup:false + 경고(업로드는 진행)');
  G.fail = 0;
  const bad = await YT.checkDuplicate({ channelId: 'UC_NOPE', file: reMp4, title: '연결 안 된 채널' });
  ok(!bad.dup && /연결/.test(bad.warn || ''), '연결 안 된 채널 → 경고(로컬 판정만)');

  console.log('\n[7] main.js 배선 — 모든 업로드 경로가 하나의 관문을 지난다');
  ok(/async function runYtUpload\(\{ file, channelId, meta, force = false \}\)/.test(M), 'runYtUpload 에 force');
  const run = M.slice(M.indexOf('async function runYtUpload'), M.indexOf('/** 렌더가 끝난 뒤'));
  ok(/if \(!force\) \{\s*const dup = await YT\.checkDuplicate\(\{ channelId, file, title \}\)/.test(run) && /skipped: true/.test(run), '관문: force 가 아니면 checkDuplicate → 중복이면 건너뜀(자동 업로드·큐 전체·이 대본 모두 여기를 지난다)');
  ok(run.indexOf('checkDuplicate') < run.indexOf('YT.uploadVideo('), '관문은 실제 업로드 호출보다 앞');
  const cur = M.slice(M.indexOf("ipcMain.handle('yt-upload-current'"), M.indexOf('const { jobs, skipped } = planQueueUploads'));
  ok(/checkDuplicate\(\{ channelId: chId, file, title: meta1\.title \}\)/.test(cur) && /force = true/.test(cur) && /enqueueYtUpload\(\{ file, channelId: chId, meta: meta1, force \}\)/.test(cur), '이 대본만: 같은 파일·같은 제목·유튜브 목록 중 하나라도 있으면 묻고, 「한 번 더」를 골라야 force 로 올린다');
  ok(/function enqueueYtUpload\(job\)/.test(M) && /runYtUpload\(job\)/.test(M), 'enqueue → run(job) 로 force 가 그대로 전달된다');

  console.log(`\n${fail ? '❌' : '✅'} youtube-dup — ${pass} 통과 / ${fail} 실패`);
  server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  process.exitCode = fail ? 1 : 0;   // process.exit 를 부르지 않는다(윈도우 libuv 종료 단언)
})().catch((e) => { console.error('❌', e); try { server.close(); } catch (_) {} process.exit(1); });
