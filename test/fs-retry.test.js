'use strict';
// node test/fs-retry.test.js — 「출력 폴더(G:)가 잠깐 사라져도 대본이 죽지 않는다」 검증.
//   2026-08-21 실사고(이벤트로그 실측): 유선랜이 13초 끊긴 사이 구글 드라이브가 G: 를 16초간 언마운트
//   (07:54:51 → 07:55:07). 그 사이에
//     ① `writeFileSync(…tts-1\70.wav)` ENOENT → [서재_0820] 대본이 통째로 죽고
//     ② 큐에 남은 9개 대본이 `mkdirSync(…tts-1)` ENOENT 로 같은 초에 전부 죽었다(성공 0 · 실패 10).
//   지키려는 것: ① 일시 장애는 기다렸다 다시 쓴다 ② 끝내 실패해도 **그 문장만** 건너뛴다
//               ③ 폴더를 못 만들면 사람이 읽을 수 있는 이유가 나온다
//   🔑 로직을 복사하지 않는다 — **원문에서 뽑아 실행**하고, 실제 fillTtsList 도 돌린다.
const fs = require('fs');
const path = require('path');
const os = require('os');

// TtsCache 가 사용자의 진짜 캐시(~/.shots-maker/tts-cache)를 건드리지 않게 홈을 임시로 돌린다.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fsretry-home-'));
process.env.USERPROFILE = tmpHome;
process.env.HOME = tmpHome;

const SRC = fs.readFileSync(path.join(__dirname, '..', 'core', 'pipeline.js'), 'utf8');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  x ' + m); } };

function extract(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) throw new Error(sig + ' 를 찾을 수 없습니다');
  // ⚠ 인자 기본값의 중괄호에 속지 않게 `) {` 뒤부터 센다(v0.3.22 교훈).
  let d = 0, started = false, j = src.indexOf(') {', i) + 2;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

// ── ① 원문에서 뽑아 실행 — 대기시간만 짧게 갈아끼운다(로직은 원문 그대로) ──
const mod = new Function(
  'const FS_RETRY_DELAYS = [10, 10, 10];\n'
  + extract(SRC, 'function isTransientFsError(') + '\n'
  + extract(SRC, 'async function retryFs(') + '\n'
  + 'return { isTransientFsError, retryFs };'
)();
const { isTransientFsError, retryFs } = mod;

const err = (code) => Object.assign(new Error('boom ' + code), { code });
ok(isTransientFsError(err('ENOENT')) === true, 'ENOENT(마운트 사라짐)는 일시 장애로 본다');
ok(isTransientFsError(err('EBUSY')) === true, 'EBUSY 는 일시 장애');
ok(isTransientFsError(err('UNKNOWN')) === true, 'UNKNOWN(윈도우 dokan)은 일시 장애');
ok(isTransientFsError(err('ENOSPC')) === false, '디스크 꽉 참(ENOSPC)은 재시도해도 소용없다 → 즉시 실패');
ok(isTransientFsError(err('EROFS')) === false, '읽기전용(EROFS)도 즉시 실패');
ok(isTransientFsError(err('EISDIR')) === false, 'EISDIR 는 즉시 실패');
ok(isTransientFsError(null) === false, 'null 이어도 안 죽는다');
ok(isTransientFsError(new Error('code 없음')) === false, 'code 가 없으면 재시도하지 않는다');

// 실제 대기표는 사고 공백(16초)을 덮어야 한다 — 여기가 이 방어선의 핵심 수치다.
const delaysLine = /const FS_RETRY_DELAYS = \[([^\]]+)\]/.exec(SRC);
ok(!!delaysLine, '원문에 FS_RETRY_DELAYS 가 있다');
const sumMs = delaysLine ? delaysLine[1].split(',').reduce((a, x) => a + Number(x.trim()), 0) : 0;
ok(sumMs >= 16000, '재시도 총 대기 ' + (sumMs / 1000) + '초 >= 실사고 공백 16초');

(async () => {
  // 첫 시도에 성공 → 로그 없음
  let logs = [];
  ok(await retryFs(() => 42, '무언가', (m) => logs.push(m), null) === 42, '성공하면 그 값을 그대로 돌려준다');
  ok(logs.length === 0, '성공했는데 재시도 로그를 남기지 않는다');

  // 두 번 실패하고 세 번째 성공 → 사고 상황(잠깐 사라졌다 돌아옴)
  logs = [];
  let tries = 0;
  const v = await retryFs(() => { if (++tries < 3) throw err('ENOENT'); return 'ok'; }, '컷70 WAV 쓰기', (m) => logs.push(m), null);
  ok(v === 'ok' && tries === 3, '실사고 재현 — 잠깐 사라졌다 돌아오면 결국 성공한다');
  ok(logs.length === 2 && /컷70 WAV 쓰기/.test(logs[0]) && /ENOENT/.test(logs[0]), '재시도 이유를 로그로 남긴다 — ' + (logs[0] || '없음'));

  // 재시도해도 소용없는 오류는 기다리지 않고 즉시 던진다
  logs = [];
  tries = 0;
  let threw = null;
  try { await retryFs(() => { tries++; throw err('ENOSPC'); }, 'x', (m) => logs.push(m), null); } catch (e) { threw = e; }
  ok(threw && threw.code === 'ENOSPC' && tries === 1 && logs.length === 0, '재시도 불가 오류는 1회만 시도하고 즉시 던진다');

  // 끝내 실패하면 마지막 오류를 던진다(조용히 성공한 척하지 않는다)
  tries = 0; threw = null;
  try { await retryFs(() => { tries++; throw err('ENOENT'); }, 'x', null, null); } catch (e) { threw = e; }
  ok(threw && threw.code === 'ENOENT' && tries === 4, '대기표를 다 쓰면 마지막 오류를 던진다(시도 ' + tries + '회)');

  // 중단을 누르면 재시도를 멈춘다
  tries = 0; threw = null;
  try { await retryFs(() => { tries++; throw err('ENOENT'); }, 'x', null, () => true); } catch (e) { threw = e; }
  ok(tries === 1 && threw, '중단 중이면 재시도하지 않는다');

  // ── ② 실제 fillTtsList 를 돌려 사고를 재현한다 ──
  const P = require(path.join(__dirname, '..', 'core', 'pipeline.js'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsretry-'));
  const workDir = path.join(root, 'tts-1');
  const buf = Buffer.alloc(1200, 7);
  const mkSents = (cnt) => Array.from({ length: cnt }, (_, i) => ({ num: i + 1, text: '문장' + (i + 1) + '-' + Math.random(), charCount: 8 }));

  // 시나리오 A: 컷3 을 만들 때 출력 폴더가 통째로 사라졌다가(=G: 언마운트) 곧 돌아온다.
  {
    const sents = mkSents(5);
    const lines = [];
    const ttsMgr = {
      async synthesize(text) {
        const num = Number(/문장(\d+)-/.exec(text)[1]);
        if (num === 3) {
          const gone = workDir + '_unmounted';
          fs.renameSync(workDir, gone);                                                // 마운트 사라짐
          setTimeout(() => { try { fs.renameSync(gone, workDir); } catch {} }, 30);    // 곧 재마운트
        }
        return { mp3Buffer: buf, durationSec: 1.5 };
      },
    };
    const r = await P.fillTtsList(sents, {}, ttsMgr, workDir, (m) => lines.push(m), null, 1, '테스트', null, true);
    const made = sents.filter((s) => s.ttsAudioPath && fs.existsSync(s.ttsAudioPath)).length;
    ok(made === 5, '실사고 재현 — 폴더가 사라졌다 돌아와도 5문장 전부 만들어진다 (실제 ' + made + '개)');
    ok(r.failed.length === 0, '건너뛴 문장 0개');
    ok(lines.some((m) => /다시 시도/.test(m)), '무슨 일이 있었는지 로그에 남는다 — ' + (lines.find((m) => /다시 시도/.test(m)) || '없음'));
  }

  // 시나리오 B: 한 문장만 영구히 못 쓴다(그 자리에 같은 이름의 폴더가 있음) → 그 문장만 건너뛰고 계속
  {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(path.join(workDir, '3.wav'));            // 3번은 절대 쓸 수 없다
    const sents = mkSents(5);
    const lines = [];
    const ttsMgr = { async synthesize() { return { mp3Buffer: buf, durationSec: 1.5 }; } };
    const r = await P.fillTtsList(sents, {}, ttsMgr, workDir, (m) => lines.push(m), null, 1, '테스트', null, true);
    const made = sents.filter((s) => s.ttsAudioPath && fs.statSync(s.ttsAudioPath).isFile()).length;
    ok(made === 4, '못 쓰는 문장 하나가 나머지를 죽이지 않는다 — 4개 성공 (실제 ' + made + '개)');
    ok(r.failed.length === 1 && r.failed[0] === 3, '실패한 컷 번호를 돌려준다 → .vrew 게이트가 막는다 (실제 ' + JSON.stringify(r.failed) + ')');
    ok(lines.some((m) => /컷3 저장 실패/.test(m)), '어느 컷이 왜 실패했는지 알린다');
  }

  // 시나리오 C: 출력 폴더를 아예 만들 수 없다 → 사람이 읽을 수 있는 이유로 던진다
  {
    const filePath = path.join(root, '폴더가아니라파일');
    fs.writeFileSync(filePath, 'x');
    let e2 = null;
    try {
      await P.fillTtsList(mkSents(2), {}, { async synthesize() { return { mp3Buffer: buf, durationSec: 1 }; } },
        path.join(filePath, 'tts-1'), null, null, 1, '테스트', null, true);
    } catch (e) { e2 = e; }
    ok(!!e2 && /출력 폴더를 만들 수 없습니다/.test(e2.message), '폴더 생성 실패는 사람 말로 알린다 — ' + (e2 ? e2.message.slice(0, 60) : '안 던짐'));
    ok(!!e2 && /구글 드라이브/.test(e2.message), '무엇을 확인해야 하는지 알려준다');
  }

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });

  // ── ③ 원문 대조 — 맨손 쓰기가 다시 기어들어오지 않게 ──
  const body = extract(SRC, 'async function fillTtsList(');
  ok(/await retryFs\(\(\) => fs\.mkdirSync\(workDir/.test(body), 'fillTtsList 머리의 mkdir 이 retryFs 를 거친다');
  ok(!/\n  fs\.mkdirSync\(workDir, \{ recursive: true \}\);/.test(body), '옛 맨손 mkdirSync 가 사라졌다');
  const rawWrites = (body.match(/(?:retryFs\(\(\) => )?fs\.writeFileSync\(/g) || []).filter((m) => !m.startsWith('retryFs'));
  ok(rawWrites.length === 0, '맨손 writeFileSync 가 남아 있지 않다 (실제 ' + rawWrites.length + '곳)');
  ok((body.match(/await retryFs\(\(\) => fs\.writeFileSync/g) || []).length === 3, '음성 쓰기 3곳(배속 임시·폴백 WAV·정속 WAV) 전부 retryFs 를 거친다');
  ok(/failed\.push\(s\.num\);[\s\S]{0,120}저장 실패/.test(body), '쓰기 실패는 failed 에 모아 그 문장만 건너뛴다');
  ok(/연속 \$\{consecFail\}문장 저장 실패/.test(body), '쓰기가 계속 실패하면 그 대본을 멈춘다(무한 헛돌기 방지)');

  console.log('\nfs-retry: ' + (n - bad) + '/' + n + ' 통과' + (bad ? ' · ' + bad + ' 실패' : ''));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('테스트 자체 오류:', e); process.exit(1); });
