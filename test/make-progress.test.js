'use strict';
// node test/make-progress.test.js — 📊 롱폼 만들기 진행 팝업의 셈(core/make-progress) 단위 테스트(v0.6.44).
const MP = require('../core/make-progress');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };

const S = (num, done) => ({ num, text: `문장 ${num} 입니다`, ttsAudioPath: done ? `/t/${num}.wav` : null, ttsDurationSec: done ? 1.2 : null });
const G = (num, o = {}) => ({ num, imagePrompt: 'p', ...o });
const pr = {
  sentences: [S(1, true), S(2, true), S(3, false), S(4, false)],
  groups: [
    G(1, { imagePath: '/m/01.png', videoPath: '/m/01.mp4' }),
    G(2, { imagePath: '/m/02.png', imageStale: true, imageStatus: 'generating' }),   // 낡은 그림 = 아직 안 끝남
    G(3, { imageStatus: 'generating', videoStatus: 'generating' }),
    G(4, { imagePrompt: '' }),                                                       // 프롬프트 없음 = 그림 대상 아님
    G(5, { videoPath: '/m/05.mp4' }),                                                // 영상만 있어도 그림 완료
  ],
};

// [1] 문장 — 경로 + 길이가 둘 다 있어야 완료 · 첫 빈 문장이 「지금」
{
  const c = MP.count([pr]);
  ok(c.sent.done === 2 && c.sent.total === 4, `문장 2/4 (${c.sent.done}/${c.sent.total})`);
  ok(c.sent.cur && c.sent.cur.num === 3, '지금 #3');
  const half = MP.count([{ sentences: [{ num: 1, ttsAudioPath: '/x.wav', ttsDurationSec: null }], groups: [] }]);
  ok(half.sent.done === 0, '경로만 있고 길이가 없으면 아직(판정력)');
}
// [2] 그림 — 프롬프트 있는 그룹만 · imageStale 은 미완 · 영상만 있어도 완료
{
  const c = MP.count([pr]);
  ok(c.image.total === 4, `그림 대상 4 (${c.image.total})`);
  ok(c.image.done === 2, `그림 완료 2 = G1·G5 (${c.image.done})`);
  ok(JSON.stringify(c.image.active) === '[2,3]', `만드는 중 G2,G3 (${c.image.active})`);
}
// [3] 영상 — 범위 안 그룹만
{
  const all = MP.count([pr]);
  ok(all.video.total === 5 && all.video.done === 2, `범위 미지정 = 5개 중 2 (${all.video.done}/${all.video.total})`);
  const r = MP.count([pr], { fromNum: 3, toNum: 1 });
  ok(r.video.total === 3 && r.video.done === 1 && JSON.stringify(r.video.active) === '[3]', `G1~G3(뒤집힌 범위도) = 3개 중 1 · 만드는 중 G3 (${r.video.done}/${r.video.total})`);
}
// [4] 단계 상태 — 건너뜀은 begin 해도 그대로 · 남은 시간은 이번에 2개 이상 만든 뒤에만
{
  const st = MP.create({ title: 't', skip: { video: '비디오 없음' } });
  MP.begin(st, 'video', 0);
  ok(st.stages.video.state === 'skip' && st.stages.video.note === '비디오 없음', '건너뛴 단계는 begin 해도 skip');
  MP.begin(st, 'tts', 2);
  st.stages.tts.startedAt = Date.now() - 10000;
  const c3 = { done: 3, total: 10 };
  ok(MP.eta(st.stages.tts, c3, Date.now()) === 0, '이번에 1개만 만들었으면 남은 시간 없음(이어받은 2개는 빼고 센다)');
  const c4 = { done: 4, total: 10 };
  const e = MP.eta(st.stages.tts, c4, Date.now());
  ok(Math.abs(e - 30000) < 200, `2개에 10초 → 남은 6개 약 30초 (${Math.round(e)}ms)`);
  MP.end(st, 'tts');
  ok(st.stages.tts.state === 'done' && MP.eta(st.stages.tts, c4, Date.now()) === 0, '끝난 단계는 남은 시간 없음');
  const snap = MP.snapshot(st, [pr], {});
  ok(snap.sent.total === 4 && snap.stages.video.state === 'skip' && snap.title === 't', '스냅샷에 셈·단계·제목');
  snap.stages.tts.state = 'x';
  ok(st.stages.tts.state === 'done', '스냅샷은 사본(보낸 뒤 바뀌어도 원본 불변)');
}
// [5] main 이 이 모듈 하나로 센다 — 같은 셈을 main 에 다시 만들지 않는다(두 벌 방지)
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
  ok((src.match(/send\('make-progress'/g) || []).length === 1, "main 의 'make-progress' 전송은 한 곳");
  ok(/finally \{ if \(_mk\) \{ _mk\.stop\(/.test(src), '끝 처리는 runMakeAllCore finally 한 곳');
}

console.log(bad ? `\n❌ ${bad}/${n} 실패` : `\n✅ make-progress ${n}/${n} 통과`);
process.exit(bad ? 1 : 0);
