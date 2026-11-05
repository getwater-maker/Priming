'use strict';
// 🎓 강의 HTML 굽기(2.0 덧붙임4 ㊿ · v1.0.34) — npm run test:lecture
//   [1] 화면표 읽기·오류 [2] 시간표 [3] HTML(CSS 애니메이션만 · 절대 시각 · escape · clip 안 씀) [4] GSAP·package.json·판 표
//   [5] 낭독 소리를 표본 단위로 제자리에(진짜 mp3) [6] HyperFrames 가 깔려 있으면 실제 굽기 두 번 = 같은 영상 · 화면마다 그림이 있다
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const LH = require('../core/lecture-html');
const R = require('../core/lecture-render');
const ED = require('../core/edition');
const FF = require('ffmpeg-static');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const T = '\t';

(async () => {
  // [1] 읽기
  const txt = ['파일명' + T + '틀' + T + '내용', '# 주석', '', 'a01' + T + '제목' + T + '첫 강 | 부제',
    'a02+a03' + T + 'bullets' + T + '머리 | 하나 | 둘', 'a04' + T + '코드' + T + '예 | x = a || b;\\n  y();',
    'a05' + T + '도식' + T + '흐름 | 가 → 나', 'a06' + T + '인용' + T + '<b>말</b> | 로이'].join('\n');
  const p = LH.parseScreenTsv(txt);
  ok(p.errors.length === 0, '[1] 정상 화면표 오류 0 — ' + JSON.stringify(p.errors));
  ok(p.slides.length === 5, '[1] 머리·주석·빈 줄 건너뜀 → 화면 5장');
  ok(p.slides[1].tpl === '글머리' && p.slides[1].files.join() === 'a02,a03', '[1] 영어 별칭 · + 여러 파일');
  const bad = LH.parseScreenTsv(['a' + T + '표' + T + 'x', 'b' + T + '제목', 'c/d' + T + '제목' + T + 'x', 'e' + T + '도식' + T + '흐름 | 하나', 'f' + T + '인용' + T + ' '].join('\n'));
  ok(bad.errors.length === 5 && bad.slides.length === 0, '[1] 모르는 틀·칸 모자람·나쁜 파일명·상자 하나 도식·빈 내용 = 오류 5 — ' + JSON.stringify(bad.errors));

  // [2] 시간표
  const dur = { a01: 2, a02: 1.5, a03: 1, a04: 1.2, a05: 1, a06: 0.8 };
  const plan = LH.planTimeline(p.slides, (f) => dur[f]);
  ok(plan.slides[0].start === 0 && plan.slides[0].dur === 2.6, '[2] 첫 화면 = 낭독 2 + 틈 0.6');
  ok(plan.slides[1].start === 2.6 && plan.slides[1].steps.join() === '2.6,4.1', '[2] 둘째 화면 낭독 시작 2.6 · 4.1');
  ok(plan.total === LH.planTimeline(p.slides, (f) => dur[f]).total && Math.abs(plan.total - (7.5 + 5 * 0.6)) < 1e-9, '[2] 전체 = 낭독 합 + 틈×화면 수');
  ok(LH.revealAt(plan.slides[1], 1, 2) === 4.1, '[2] 글머리 항목 수 = 낭독 수 → 둘째 항목은 둘째 낭독 시작에');

  // [3] HTML
  const html = LH.buildHtml(plan);
  ok(!/gsap/i.test(html), '[3] HTML 에 GSAP 없음');
  ok(!/class="[^"]*\bclip\b/.test(html), '[3] HyperFrames clip 을 쓰지 않는다(지연을 다시 세어 뒤 화면이 비던 것)');
  ok(/data-no-timeline/.test(html), '[3] data-no-timeline(45초 기다림 없앰)');
  ok(html.includes('animation:slidein 0.5s ease-out 4.1s both'), '[3] 항목 지연 = 절대 시각 4.1초');
  ok(html.includes('hide 0.001s step-end 2.6s forwards'), '[3] 첫 화면은 2.6초에 숨는다');
  ok(!html.includes('<b>말</b>') && html.includes('&lt;'), '[3] 사람 글은 escape');
  ok(html.includes('x = a || b;') && html.includes('&nbsp;&nbsp;y();') === false && html.includes('  y();'), '[3] 코드의 || 는 칸 나누기가 아니다 · 들여쓰기 유지');

  // [4] 금지선
  for (const f of ['core/lecture-html.js', 'core/lecture-render.js', 'renderer/src/LectureCard.jsx']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    ok(!/gsap/i.test(src), '[4] 코드에 GSAP 없음 — ' + f);
  }
  const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ok(!JSON.stringify(pj.dependencies || {}).includes('hyperframes') && !JSON.stringify(pj.devDependencies || {}).includes('hyperframes'), '[4] package.json 에 hyperframes 없음(저장소 밖 설치)');
  ok(ED.FEATURES.lecture && ED.FEATURES.lecture.owner === true && !ED.has('lecture', 'member'), '[4] 판 표: 관리자 · 로이판만');
  ok(ED.fileFeature('core/lecture-render.js') === 'lecture' && ED.fileFeature('core/lecture-html.js') === 'lecture' && !ED.inEditionFile('core/lecture-render.js', 'member'), '[4] 판매판 매니페스트에서 파일째 빠짐');
  ok(ED.channelFeature('lecture-render') === 'lecture', '[4] IPC lecture-* 는 판매판에서 막힘');
  ok(!ED.feat('lecture', false, 'studio') && ED.feat('lecture', true, 'studio'), '[4] 로이판에서도 관리자 계정만');
  const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  ok(!/^const [A-Za-z_]+ = require\('\.\/core\/lecture-/m.test(mainSrc), '[4] main 맨 위에서 lecture 모듈을 읽지 않는다(판매판엔 파일이 없다)');
  ok((mainSrc.match(/ipcMain\.handle\('lecture-[a-z-]+', async[^\n]*\n  if \(!feat\('lecture'\)\)/g) || []).length === 4, '[4] lecture IPC 넷 모두 feat 검사');

  // [5] 진짜 mp3 → 소리 자리
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-lecture-'));
  const mp3 = path.join(tmp, 'mp3'); fs.mkdirSync(mp3);
  const lens = { a01: 1.0, a02: 0.7, a03: 0.5, a04: 0.6, a05: 0.5, a06: 0.4 };
  for (const [n, d] of Object.entries(lens)) {
    const r = spawnSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${d}`, '-ar', '24000', '-ac', '1', '-b:a', '192k', path.join(mp3, n + '.mp3')]);
    assert.strictEqual(r.status, 0);
  }
  const prep = await R.prepare({ screenText: txt, audioDir: mp3 });
  const pcm = new Int16Array(prep.wav.buffer.slice(prep.wav.byteOffset + 44, prep.wav.byteOffset + prep.wav.length));
  const rms = (a, b) => { let s = 0, n = 0; for (let i = Math.round(a * R.RATE); i < Math.round(b * R.RATE); i++) { s += pcm[i] * pcm[i]; n++; } return Math.sqrt(s / Math.max(1, n)); };
  const s1 = prep.plan.slides[1];
  ok(Math.abs(pcm.length / R.RATE - prep.plan.total) < 0.001, '[5] 소리 길이 = 시간표 전체');
  ok(rms(0.2, 0.8) > 1000, '[5] 첫 낭독 자리에 소리');
  ok(rms(prep.plan.slides[0].speech + 0.15, s1.start - 0.05) < 50, '[5] 틈(0.6초)은 무음');
  ok(rms(s1.steps[1] + 0.1, s1.steps[1] + 0.35) > 1000 && rms(s1.start + 0.1, s1.start + 0.5) > 1000, '[5] 한 화면 여러 낭독 = 이어서 제자리');
  const tooFew = await R.prepare({ screenText: 'zz' + T + '제목' + T + '없는 소리', audioDir: mp3 }).then(() => null, (e) => e);
  ok(tooFew && /낭독 파일이 없습니다/.test(tooFew.message), '[5] 없는 mp3 = 굽지 않는다(fail-closed)');
  const badRun = await R.prepare({ screenText: 'a01' + T + '모름' + T + 'x', audioDir: mp3 }).then(() => null, (e) => e);
  ok(badRun && badRun.errors && badRun.errors.length === 1, '[5] 화면표 오류 = 굽지 않는다');

  // [6] 실제 굽기(HyperFrames 가 깔린 개발 PC 만)
  const st = await R.status();
  if (!st.installed || !st.nodeOk) {
    console.log(`  [6] 건너뜀 — HyperFrames ${st.installed ? '있음' : '없음'} · Node22 ${st.nodeOk ? '있음' : '없음'} (node tools/lecture.js setup)`);
  } else {
    const out1 = path.join(tmp, 'o1', '강의.mp4'), out2 = path.join(tmp, 'o2', '강의.mp4');
    const r1 = await R.render({ screenText: txt, audioDir: mp3, outFile: out1 });
    await R.render({ screenText: txt, audioDir: mp3, outFile: out2 });
    const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    const v1 = path.join(tmp, 'o1', '_강의html', '강의', 'video.mp4'), v2 = path.join(tmp, 'o2', '_강의html', '강의', 'video.mp4');
    ok(sha(v1) === sha(v2), '[6] 같은 입력 두 번 = 같은 영상(SHA)');
    const probe = spawnSync(FF, ['-i', out1], { encoding: 'utf8' }).stderr;
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe);
    const durSec = m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : -1;
    ok(Math.abs(durSec - r1.total) < 0.08 && /Audio: aac/.test(probe) && /1920x1080/.test(probe), '[6] MP4 길이 = 시간표 · 1920×1080 · 소리 있음 — ' + durSec);
    // 화면마다 가운데 시각에 글자가 보인다(밝은 화소가 있다) — clip 사고(뒤 화면이 빈 것)를 잡는다
    for (const sl of r1 && prep.plan.slides) {
      const t = sl.start + sl.dur - 0.15;
      const fr = spawnSync(FF, ['-v', 'error', '-ss', String(t), '-i', out1, '-frames:v', '1', '-vf', 'scale=192:108', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 });
      const bright = [...fr.stdout].filter((v) => v > 120).length;   // 빈 화면 = 0
      ok(bright > 8, `[6] ${sl.idx + 1}번째 화면(${sl.tpl}) 끝 무렵에 글자가 보인다 — 밝은 화소 ${bright}`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`✅ lecture-html ${pass}개 통과`);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
