'use strict';
// node test/tts-gate.test.js — 「음성 없이 .vrew 가 나가는 것」 차단 검증.
//   2026-08-20 실사고: 로컬 이미지가 GPU 를 점유해 컷41 TTS 가 60초 타임아웃 3회 → 그 대본 TTS 단계가
//   통째로 죽었는데 4단계가 그대로 진행돼 **음성 40개 / 누락 898개**인 반쪽 .vrew 가 나갔다(clip 59).
//   지키려는 것: ① 음성 누락이 있으면 .vrew 를 만들지 않는다(이미지 게이트와 같은 정책)
//               ② 문장 하나가 실패해도 대본 전체를 버리지 않는다(건너뛰고 계속)
//               ③ 서버가 죽었으면 연속 실패로 멈춘다(900문장 × 3회 × 60초 헛돌기 방지)
//   🔑 로직을 복사하지 않는다 — **원문에서 함수를 뽑아 실행**한다.
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const PIPE = fs.readFileSync(path.join(__dirname, '..', 'core', 'pipeline.js'), 'utf8');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };

function extract(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' 를 찾을 수 없습니다');
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

// ── ① missingTtsNums — main.js 원문에서 뽑아 실행 ──
const missingTtsNums = new Function('fs', extract(MAIN, 'missingTtsNums') + '\nreturn missingTtsNums;')(fs);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsgate-'));
const mk = (name) => { const p = path.join(tmp, name); fs.writeFileSync(p, 'x'); return p; };
const prAll = { sentences: [{ num: 1, ttsAudioPath: mk('1.mp3') }, { num: 2, ttsAudioPath: mk('2.mp3') }] };
const prSome = {
  sentences: [
    { num: 1, ttsAudioPath: mk('a.mp3') },
    { num: 2, ttsAudioPath: null },                                   // 아예 없음(실패)
    { num: 3, ttsAudioPath: path.join(tmp, '없는파일.mp3') },          // 경로만 있고 파일은 없음
    { num: 4, ttsAudioPath: mk('d.mp3') },
  ],
};
ok(JSON.stringify(missingTtsNums(prAll)) === '[]', '전부 있으면 누락 0');
ok(JSON.stringify(missingTtsNums(prSome)) === '[2,3]', '없는 것 + 파일이 사라진 것 둘 다 잡는다 — 실제 ' + JSON.stringify(missingTtsNums(prSome)));
ok(JSON.stringify(missingTtsNums({ sentences: [] })) === '[]', '문장이 없으면 누락 0');
ok(JSON.stringify(missingTtsNums({})) === '[]', 'sentences 가 없어도 안 죽는다');
// 실사고 재현: 938문장 중 40개만 있는 경우
const big = { sentences: Array.from({ length: 938 }, (_, i) => ({ num: i + 1, ttsAudioPath: i < 40 ? mk('big' + i + '.mp3') : null })) };
ok(missingTtsNums(big).length === 898, '🔴 실사고 재현 — 938문장 중 898개 누락으로 잡힌다 (실제 ' + missingTtsNums(big).length + ')');
fs.rmSync(tmp, { recursive: true, force: true });

// ── ② 게이트가 두 경로(💾 export-vrew · ⚡만들기 4단계)에 모두 걸려 있는지 (원문 대조) ──
ok((MAIN.match(/missingTtsNums\(pr\)/g) || []).length >= 2, '두 경로 모두 missingTtsNums 로 검사한다');
ok((MAIN.match(/warnMissingTts\(noTts\)/g) || []).length >= 2, '두 경로 모두 팝업으로 알린다');
ok(/음성 없는 문장 \$\{mtts/.test(MAIN) || /음성 없는 문장/.test(MAIN), '건너뛴 이유를 로그에 남긴다');
const gateBlocks = MAIN.split('missingTtsNums(pr)');
ok(gateBlocks.slice(1).every((b) => b.slice(0, 700).includes('continue;')), '누락이면 그 편을 continue 로 건너뛴다(.vrew 생성 안 함)');

// ── ③ 문장 실패가 대본 전체를 죽이지 않는지 (pipeline 원문 대조) ──
ok(!/throw new Error\(`TTS 실패\(컷\$\{s\.num\}, 3회 시도\)/.test(PIPE), '옛 "3회 실패 → throw" 가 사라졌다(전체 포기 금지)');
ok(/failed\.push\(s\.num\)/.test(PIPE), '실패한 문장 번호를 모은다');
ok(/const MAX_CONSEC_FAIL = 5/.test(PIPE), '연속 실패 상한이 있다(서버 다운 시 헛돌기 방지)');
ok(/consecFail >= MAX_CONSEC_FAIL/.test(PIPE) && /break;/.test(PIPE), '연속 상한을 넘으면 그 대본 TTS 를 멈춘다');
ok(/consecFail = 0;/.test(PIPE), '성공하면 연속 카운터가 초기화된다(중간에 한 번씩 실패해도 계속)');
ok(/return \{ failed \}/.test(PIPE), '실패 목록을 호출자에게 돌려준다');
ok(/음성 실패 \$\{failed\.length\}개/.test(PIPE), '끝에 실패 요약을 남긴다');

// ── ④ 타임아웃 메시지가 사람 말인지 ──
const OV = fs.readFileSync(path.join(__dirname, '..', 'tts', 'providers', 'omnivoice-provider.js'), 'utf8');
ok(/AbortError/.test(OV) && /초 안에 응답하지 않았습니다/.test(OV), 'AbortError 를 사람 말로 바꾼다');
ok(/같은 GPU 에서 이미지 생성 중/.test(OV), '무엇을 의심해야 하는지 메시지에 적혀 있다');

console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 음성 누락 게이트 ' + n + '/' + n + ' 통과');
process.exit(bad ? 1 : 0);
