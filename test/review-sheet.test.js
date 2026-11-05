'use strict';
/**
 * node test/review-sheet.test.js — 🔍 ㊽ 검수 판 · 🔁 ㊾ 장면 다시 주문(2.0 덧붙임4 · v1.0.30)
 *   [1] 주문서 칸(review · redo) 읽기 · [2] 장면 시각표 · 칸 목록(대사 카드 칸 = 글자가 다 찬 프레임)
 *   [3] 실제 판 — 합성 .vrew → MP4 → 판_NN.jpg(4×4 · 칸 480×270 + 글 줄) · 정지구간.tsv
 *   [4] 정지 구간 판정력 — 멈춘 화면 MP4 는 잡고 움직이는 MP4 는 안 잡는다 · [5] main 배선(업로드한 주문의 redo 거절 · 옛 그림은 옮김)
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const P = require('../core/pipeline');
const SC = require('../core/screen-cards');
const R = require('../core/vrew-render');
const RS = require('../core/review-sheet');
const OC = require('../core/order-contract');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const imgSize = (f) => { try { execFileSync(FF, ['-hide_banner', '-i', f], { stdio: 'pipe' }); } catch (e) { const m = /, (\d{2,5})x(\d{2,5})/.exec(String(e.stderr)); return m ? [+m[1], +m[2]] : null; } return null; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-t-'));
  try {
    console.log('[1] 주문서 칸');
    const base = { script: 'x.md', channelId: 'UC1', primingChannel: 'c', voice: 'v', style: 's', upload: { enabled: false } };
    const md = path.join(tmp, 'x.md'); fs.writeFileSync(md, '# t\n');
    const rd = (extra) => { const p = path.join(tmp, 'o.json'); fs.writeFileSync(p, JSON.stringify({ ...base, ...extra })); return OC.readOrder(p); };
    let r = rd({});
    ok(r.ok && r.order.review === false && Array.isArray(r.order.redo) && r.order.redo.length === 0, '칸이 없으면 검수 판 끔 · 다시 주문 없음(지금과 같음)');
    r = rd({ review: true, redo: [5, { scene: 2 }, 5] });
    ok(r.ok && r.order.review === true && r.order.redo.join() === '2,5', 'review: true · redo [5, {scene:2}, 5] → [2, 5]');
    ok(!rd({ review: 'yes' }).ok && !rd({ redo: [0] }).ok && !rd({ redo: 'G3' }).ok, '틀린 값은 거절(review 글자 · 장면 0 · 목록 아님)');
    const rl = rd({ redo: [{ scene: 3, lines: { '판': '따로' } }] });
    ok(!rl.ok && /\.md 를 고쳐/.test(rl.errors.join()), '지시 줄을 주문서에 실으면 거절(조용히 무시하지 않음 · .md 를 고쳐 다시)');

    console.log('[2] 장면 시각표 · 칸');
    const raw = '# t\n## 장\n### 가\n첫 문장입니다.\n둘째 문장입니다.\n### 나\n\n> 💬 대사카드: 뱀 | 하나님이 참으로 // 그렇게 말씀하시더냐\n\n셋째 문장입니다.\n### 다\n넷째 문장입니다.\n';
    const pr = P.parseScriptText(raw, 'longform', {}).projects[0];
    pr.screenCards = SC.markersOf(raw);
    pr.groups.forEach((g, i) => { const img = path.join(tmp, `g${i}.png`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x${['306090', '904030', '309040'][i % 3]}:s=1344x768`, '-frames:v', '1', img]); g.imagePath = img; });
    pr.sentences.forEach((s, i) => { const mp3 = path.join(tmp, `s${i}.mp3`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=f=${300 + 50 * i}:d=2`, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', mp3]); s.ttsAudioPath = mp3; s.ttsDurationSec = 2; });
    const pmap = P.pausePlanOf(pr, {}).map;
    const spans = RS.sceneSpans(pr, pmap, 0);
    ok(JSON.stringify(spans.map((x) => [x.num, x.t0, x.t1])) === '[[1,0,4],[2,4,10],[3,10,12]]', '장면 시각 = 음성 + 대사 카드 무음(G2 = 2 + 4초) ' + JSON.stringify(spans.map((x) => [x.t0, x.t1])));
    const cards = SC.plan(pr, pr.screenCards, {}).cards;
    const cells = RS.cellsOf(pr, spans, cards, (g) => 'G' + g.num + '요약');
    ok(cells.length === 4 && cells[2].kind === 'quote' && cells[2].num === 2, '칸 = 장면 3 + 대사 카드 1(그 장면 바로 뒤)');
    ok(Math.abs(cells[1].t - 5) < 1e-6, 'G2 장면 칸 = 그림이 보이는 동안(4~6초)의 가운데 — 대사 카드 시간은 빼고');
    ok(cells[2].t > cards[0].t0 + SC.QUOTE.lead + 1.9 && cells[2].t < cards[0].t1, '대사 카드 칸 = 글자가 다 찬 뒤');
    ok(/^G2 · 00:04 · G2요약$/.test(cells[1].label) && /대사카드/.test(cells[2].label), '칸 글 = G번호 · 영상 안 시각 · 지시 줄 요약 ' + cells[1].label);

    console.log('[3] 실제 판');
    const vrew = path.join(tmp, 't.vrew'); await P.buildProjectVrew(pr, vrew, {}, () => {}, 20, 1);
    const mp4 = path.join(tmp, 't.mp4');
    const rr = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 2, cards, info: null });
    ok(rr && rr.ok, 'MP4 렌더');
    const out = path.join(tmp, '검수판');
    fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, '판_09.jpg'), 'old');   // 지난 실행의 판 — 지워져야 한다
    const rv = await RS.makeReviewSheets({ mp4, outDir: out, project: pr, pauseMap: pmap, cards, summaryOf: () => '줌인' });
    ok(rv.ok && rv.sheets.length === 1 && rv.cells === 4, `판 1장 · 칸 4 (${rv.error || ''})`);
    const sz = rv.sheets[0] && imgSize(rv.sheets[0]);
    ok(sz && sz[0] === 4 * RS.CELL.w + 5 * 4 && sz[1] === 4 * (RS.CELL.h + RS.CELL.label) + 5 * 4, '판 크기 = 4×4 칸(480×(270+40)) + 틈 ' + JSON.stringify(sz));
    ok(!fs.existsSync(path.join(out, '판_09.jpg')), '지난 실행의 판은 지운다(장 수가 줄 수 있다)');
    ok(fs.existsSync(rv.stillTsv) && /^﻿시작\t끝\t길이/.test(fs.readFileSync(rv.stillTsv, 'utf8')), '정지구간.tsv(머리 줄)');
    // 칸 색 — 첫 칸(G1 · 306090 파랑)과 셋째 칸(대사 카드 · 갈색)
    const px = (x, y) => { const b = execFileSync(FF, ['-v', 'error', '-i', rv.sheets[0], '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 }); return [b[0], b[1], b[2]]; };
    const c1 = px(4 + 60, 4 + 60), c3 = px(4 + 2 * (RS.CELL.w + 4) + 30, 4 + 30);
    ok(c1[2] > c1[0] + 40, 'G1 칸 = 그 장면 그림(파랑) ' + c1);
    ok(Math.abs(c3[0] - 0x21) < 14 && Math.abs(c3[1] - 0x1A) < 14 && Math.abs(c3[2] - 0x13) < 14, '대사 카드 칸 = 갈색 판 ' + c3);

    console.log('[4] 정지 구간 판정력');
    const still = path.join(tmp, 'still.mp4'), moving = path.join(tmp, 'moving.mp4');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x404040:s=640x360:d=5:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', still]);
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=5:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', moving]);
    const s1 = await RS.stillSpans(still), s2 = await RS.stillSpans(moving);
    ok(s1.length === 1 && s1[0].t0 < 0.1 && s1[0].sec > 4.5, '멈춘 5초 = 정지 1곳 ' + JSON.stringify(s1));
    ok(s2.length === 0, '움직이는 영상 = 정지 0');

    console.log('[5] main 배선');
    const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const body = M.slice(M.indexOf('async function runOrderHeadless'), M.indexOf('// 미리보기 오디오'));
    ok(body.indexOf('done && order.redo.length') > 0 && body.indexOf('done && order.redo.length') < body.indexOf('if (done) {'), '업로드한 주문의 다시 주문 = 거절(이미 올라감 안내보다 먼저)');
    ok(/fs\.renameSync\(g\.imagePath, path\.join\(bak/.test(body) && !/fs\.rmSync\(g\.imagePath/.test(body) && /g\.imageCleared = true/.test(body), '옛 그림은 _다시주문 으로 옮긴다(지우지 않음) · 캐시로 되살아나지 않게');
    ok(body.indexOf('🔁 ㊾ 장면 다시 주문') < body.indexOf('if (checkOnly) return finish(OC.STATUS.ok'), '확인만(checkOnly) 주문은 그림을 건드리지 않는다(장면 번호 검사만)');
    ok(/if \(order\.review\)/.test(body) && /res\.log\.reviewSheets = null; res\.log\.stillSpans = null;/.test(body), '검수 판은 review: true 일 때만 · 아니면 null');
  } catch (e) { ok(false, '실행 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
  console.log(`\n${fail ? '❌' : '✅'} review-sheet ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
