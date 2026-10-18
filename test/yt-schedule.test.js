/**
 * yt-schedule.test.js — ⏰ 예약 업로드(v0.9.68): 시각 계산(KST) · publishAt 전송 · 적용 여부 확인표 · 채널 칸 읽기/저장.
 *   실제 구글에 닿지 않는다 — 가짜 구글로 원문 모듈을 돌린다. HOME 은 임시 폴더.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-sched-'));
process.env.USERPROFILE = TMP; process.env.HOME = TMP;
const ROOT = path.join(__dirname, '..');
const YS = require(path.join(ROOT, 'core', 'yt-schedule.js'));
const YF = require(path.join(ROOT, 'core', 'yt-finish.js'));
const YT = require(path.join(ROOT, 'core', 'youtube-upload.js'));
const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const A = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const T = (s) => Date.parse(s);   // 'YYYY-MM-DDTHH:MM:SS+09:00' → 순간

(async () => {
  console.log('[1] 시각 계산 — KST 기준 · 하루 한 편');
  const now = T('2026-10-18T10:00:00+09:00');
  ok(YS.nextSlot({ time: '18:00', now }) === T('2026-10-18T18:00:00+09:00'), '오늘 18:00 이 아직 남았으면 오늘');
  ok(YS.nextSlot({ time: '09:00', now }) === T('2026-10-19T09:00:00+09:00'), '오늘 09:00 은 지났으니 내일');
  ok(YS.nextSlot({ time: '10:20', now }) === T('2026-10-19T10:20:00+09:00'), '30분 안쪽(10:20)은 미래로 치지 않아 내일(구글 「미래」 조건 안전 여유)');
  ok(YS.nextSlot({ time: '10:30', now }) === T('2026-10-18T10:30:00+09:00'), '정확히 30분 뒤는 오늘');
  const a1 = YS.nextSlot({ time: '18:00', now });
  ok(YS.nextSlot({ time: '18:00', now, last: a1 }) === T('2026-10-19T18:00:00+09:00'), '이미 오늘 배정했으면 내일 같은 시각');
  ok(YS.nextSlot({ time: '18:00', now, last: T('2026-10-25T18:00:00+09:00') }) === T('2026-10-26T18:00:00+09:00'), '마지막 배정이 일주일 뒤면 그 다음 날');
  ok(YS.nextSlot({ time: '07:00', now, last: T('2026-10-25T18:00:00+09:00') }) === T('2026-10-26T07:00:00+09:00'), '시각을 바꿔도 마지막 배정보다 앞서지 않는다');
  ok(YS.nextSlot({ time: '18:00', now, last: T('2026-10-01T18:00:00+09:00') }) === a1, '과거의 마지막 배정은 무시');
  // UTC 날짜가 하루 어긋나는 시각(전역 규칙 함정) — KST 새벽 01:00 은 UTC 로는 전날 16:00
  const late = T('2026-10-18T23:50:00+09:00');
  const s = YS.nextSlot({ time: '06:30', now: late });
  ok(s === T('2026-10-19T06:30:00+09:00') && new Date(s).toISOString() === '2026-10-18T21:30:00.000Z', 'KST 23:50 → 다음 날 06:30 KST (= UTC 전날 21:30)');
  ok(YS.kst(s) === '2026-10-19 06:30', '화면·로그 표기는 KST');
  ok(YS.nextSlot({ time: '25:00', now }) === null && YS.nextSlot({ time: '', now }) === null, '틀린 시각은 null');

  console.log('\n[2] 채널 설정 정규화 · 계획');
  ok(YS.normSchedule({ on: true, time: '9:05' }).time === '09:05' && YS.normSchedule({ on: true, time: '9:05' }).on, '9:05 → 09:05');
  ok(!YS.normSchedule({ on: true, time: 'abc' }).on && !YS.normSchedule(null).on && !YS.normSchedule(undefined).on, '시각이 틀리거나 없으면 꺼짐(조용히 예약이 켜지지 않는다)');
  ok(YS.planFor('UC_A', { on: false, time: '18:00' }, now) === null && YS.planFor('UC_A', null, now) === null, '꺼져 있으면 예약 없음(예전과 같다)');
  let p1 = YS.planFor('UC_A', { on: true, time: '18:00' }, now);
  ok(p1 && p1.publishAt === '2026-10-18T09:00:00.000Z' && p1.kst === '2026-10-18 18:00', '켜면 publishAt 은 UTC ISO · 표시는 KST');
  YS.recordAssigned('UC_A', p1.ms);
  const p2 = YS.planFor('UC_A', { on: true, time: '18:00' }, now);
  ok(p2.kst === '2026-10-19 18:00', '성공을 기록하면 다음 편은 다음 날');
  ok(YS.planFor('UC_B', { on: true, time: '18:00' }, now).kst === '2026-10-18 18:00', '다른 채널은 따로 센다');
  YS.recordAssigned('UC_A', p1.ms - 86400000);
  ok(YS.planFor('UC_A', { on: true, time: '18:00' }, now).kst === '2026-10-19 18:00', '더 이른 값으로 되돌려 쓰지 않는다');

  console.log('\n[3] 가짜 구글 — publishAt 을 싣고, 다시 읽어 확인표');
  const G = { insertBody: null, videoStatus: null, listStatus: 200 };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const J = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/videos') return G.listStatus !== 200 ? J(G.listStatus, { error: { message: 'x' } }) : J(200, { items: G.videoStatus ? [{ id: 'V1', status: G.videoStatus }] : [] });
      return J(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  YF._setEndpoints({ api: `http://127.0.0.1:${server.address().port}`, thumb: `http://127.0.0.1:${server.address().port}/thumb` });
  const token = async () => 'AT';
  const sc = { publishAt: '2026-10-18T09:00:00.000Z', kst: '2026-10-18 18:00' };
  const plan = YF.planFinish({ pack: {}, thumbs: [], schedule: sc });
  ok(plan.schedule && plan.schedule.publishAt === sc.publishAt, 'planFinish 가 예약을 싣는다');
  ok(YF.planFinish({ pack: {}, thumbs: [] }).schedule === null, '예약을 안 실으면 null');
  const row = (r) => r.items.find((x) => x.key === 'schedule');
  G.videoStatus = { privacyStatus: 'private', publishAt: '2026-10-18T09:00:00Z' };
  let r = await YF.finishVideo({ channelId: 'UC_A', videoId: 'V1', plan, token });
  ok(row(r).status === 'ok' && /18:00/.test(row(r).detail), '유튜브가 같은 시각을 돌려주면 ✅');
  G.videoStatus = { privacyStatus: 'private' };
  r = await YF.finishVideo({ channelId: 'UC_A', videoId: 'V1', plan, token });
  ok(row(r).status === 'fail' && /구글이 예약을 받지 않았습니다/.test(row(r).detail) && !/심사/.test(row(r).detail), '판정력: 예약이 없으면 ⚠ (조용히 성공 처리하지 않는다 · 「심사 전이라 막힌다」는 옛 안내는 쓰지 않는다)');
  G.videoStatus = { privacyStatus: 'private', publishAt: '2026-10-19T09:00:00Z' };
  r = await YF.finishVideo({ channelId: 'UC_A', videoId: 'V1', plan, token });
  ok(row(r).status === 'fail', '다른 시각이면 ⚠');
  G.listStatus = 500;
  r = await YF.finishVideo({ channelId: 'UC_A', videoId: 'V1', plan, token });
  ok(row(r).status === 'fail' && /다시 읽지 못했습니다/.test(row(r).detail), '다시 읽기가 실패해도 던지지 않고 ⚠');
  G.listStatus = 200;
  r = await YF.finishVideo({ channelId: 'UC_A', videoId: 'V1', plan: YF.planFinish({ pack: {}, thumbs: [] }), token });
  ok(row(r).status === 'manual' && /켜지 않았습니다/.test(row(r).detail), '예약을 안 썼으면 예전처럼 Studio 몫(✋)');
  ok(!YF.reportLines('t', r).join('\n').match(/[✗❌]/), '결과 줄에 ✗·❌ 없음(자기 오류 되잡기 방지)');
  server.close();

  console.log('\n[4] uploadVideo — publishAt 전송 규칙(원문 소스)');
  const U = fs.readFileSync(path.join(ROOT, 'core', 'youtube-upload.js'), 'utf8');
  ok(/if \(o\.publishAt\)/.test(U) && /meta\.status\.publishAt = new Date\(t\)\.toISOString\(\)/.test(U) && /t > Date\.now\(\)/.test(U), '미래 시각만 ISO 로 싣는다');
  ok(/privacyStatus: 'private'/.test(U) && !/privacyStatus: 'public'/.test(U), '공개 즉시 업로드는 만들지 않았다(예약은 private + publishAt)');
  ok(/publishAt: \(j\.status && j\.status\.publishAt\)/.test(U), '결과에 publishAt 이 실린다');

  console.log('\n[5] main · 화면 배선');
  const run = M.slice(M.indexOf('async function runYtUpload'), M.indexOf('// 🧷 업로드 마무리(v0.9.33'));
  ok(/YS\.planFor\(channelId, finish && finish\.preset && finish\.preset\.ytSchedule\)/.test(run), 'runYtUpload 한 곳에서 계산(모든 입구가 여기를 지난다)');
  ok(/publishAt: sched \? sched\.publishAt : undefined/.test(run), 'uploadVideo 에 publishAt 전달');
  ok(run.indexOf('YS.recordAssigned') > run.indexOf('if (r.ok)') && run.indexOf('YS.recordAssigned') < run.indexOf('runYtFinish({ channelId, videoId: r.videoId'), '성공한 뒤에만 배정 기록');
  ok(/schedule: finish\.schedule/.test(M), 'runYtFinish 가 예약을 plan 에 싣는다');
  ok(/ytSchedule: \{ on: !!\(p\.ytSchedule/.test(A) && /ytSchedule: \{ on: !!\(ch\.ytSchedule/.test(A) && /data-testid="ch-yt-sched-on"/.test(A) && /data-testid="ch-yt-sched-time"/.test(A), '채널편집 예약 칸 — 읽기·저장·칸 셋 다');
  ok(!/\bytSchedule\b/.test(fs.readFileSync(path.join(ROOT, 'core', 'youtube-upload.js'), 'utf8')), '채널 값 해석은 yt-schedule 한 곳(업로드 모듈은 publishAt 만 받는다)');

  console.log(`\n결과: ${pass} 통과 · ${fail} 실패`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
