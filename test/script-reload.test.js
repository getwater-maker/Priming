/**
 * v0.4.6~v0.4.7 — 대본을 고쳤는데 옛 작업본이 그대로 나오던 것
 *
 * 🔴 실사고 ①(2026-09-14, 로이 PC 실측): 판정이 `snap.savedAt >= mdMtime` 이었다.
 *   savedAt 은 「앱이 마지막으로 자동저장한 시각」일 뿐이라, 대본을 고친 뒤 앱에서 아무거나
 *   건드리면(자동저장 8곳·1.5초 디바운스) savedAt 이 mtime 을 넘어서고 **그 대본은 몇 번을
 *   다시 열어도 옛 내용**이 나온다. 하이디 1부: .md 18:14:02 수정 → 스냅샷 18:18:47 저장.
 *
 * 🔴 실사고 ②(v0.4.6 이 만든 것): 해시 판정을 넣으면서 **작업본을 이어받은 경로에서도**
 *   「현재 대본 해시」를 심어, 「바뀐 대본의 해시 + 옛 파싱 결과」를 기록해 **더 나쁘게 고착**시켰다.
 *   (로그: v0.4.6 으로 다시 열어도 `♻ 작업본 이어받기` · 스냅샷 srcHash == 현재 .md 해시)
 *   ⇒ v0.4.7: **hashVer 가 찍힌 해시만 신뢰**하고, 그 밖에는 **문장 시퀀스**로 정확히 판정한다.
 *
 * 🔑 이 테스트는 **원문을 그대로 실행한다**(로직을 복사해 두면 앱과 갈라져도 통과한다).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MAIN = read('main.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}
const eq = (a, b, label) => ok(a === b, `${label} (기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)})`);

// ── 원문 추출 ────────────────────────────────────────────────────────
function cut(re, what) {
  const m = MAIN.match(re);
  if (!m) throw new Error(`main.js 에서 ${what} 를 못 찾음`);
  return m[0];
}
const scriptHash = new Function('fs', 'require',
  `${cut(/function scriptHash\(scriptPath\) \{[\s\S]*?\n\}/, 'scriptHash')}; return scriptHash;`)(fs, require);
const snapshotMatchesScript = new Function(
  `${cut(/function snapshotMatchesScript\(parsed, snap\) \{[\s\S]*?\n\}/, 'snapshotMatchesScript')}; return snapshotMatchesScript;`)();

// 판정 블록(`let preParsed = null, fresh = false;` ~ 닫는 `}`)을 통째로 실행한다.
const DECIDE_SRC = cut(/let preParsed = null, fresh = false;[\s\S]*?\n  \}\n/, '판정 블록');
const HAS_BRANCH = /if \(!opts\.force && sameMode && fresh\) \{/.test(MAIN);
function decide({ snap, mdHash, sameMode = true, force = false, parseResult, parseThrows = false }) {
  const P = { parseScript: () => { if (parseThrows) throw new Error('parse fail'); return parseResult; } };
  const fn = new Function('snap', 'mdHash', 'sameMode', 'SNAP_HASH_VER', 'P', 'scriptPath', 'mode',
    'presetThresholds', 'preset', 'snapshotMatchesScript',
    `${DECIDE_SRC}; return { fresh, preParsed, parses: P.__n || 0 };`);
  let parses = 0;
  const P2 = { parseScript: (...a) => { parses++; return P.parseScript(...a); } };
  const r = fn(snap, mdHash, sameMode, 3, P2, '/x.md', 'longform', () => ({}), null, snapshotMatchesScript);
  const use = (!force && sameMode && r.fresh) ? '작업본' : '새파싱';
  return { use, parses, preParsed: r.preParsed };
}
// 문장 시퀀스 픽스처
const mkParsed = (texts) => ({
  projects: [{
    groups: texts.map((_, i) => ({ num: i + 1 })),
    getSentencesOfGroup(g) { return [{ text: texts[g.num - 1] }]; },
  }],
});
const mkSnap = (texts, extra = {}) => ({
  mode: 'longform', savedAt: Date.now(),
  projects: [{ groups: texts.map((t, i) => ({ num: i + 1, sentences: [{ text: t }] })) }],
  ...extra,
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'script-reload-'));
const mdPath = path.join(tmp, '대본.md');

console.log('\n[1] scriptHash — 원문 실행 (내용만 본다)');
{
  fs.writeFileSync(mdPath, '# 하이디\n\n알름 아저씨에게 올라가다.\n', 'utf8');
  const h1 = scriptHash(mdPath);
  ok(/^[0-9a-f]{16}$/.test(h1), '16자리 hex 해시를 낸다');
  const future = new Date(Date.now() + 3600e3);
  fs.utimesSync(mdPath, future, future);
  eq(scriptHash(mdPath), h1, '내용이 같으면 mtime 이 바뀌어도 같은 해시(구글드라이브 동기화 대비)');
  fs.writeFileSync(mdPath, '# 하이디\n\n고쳤다.\n', 'utf8');
  ok(scriptHash(mdPath) !== h1, '내용이 바뀌면 해시가 바뀐다');
  eq(scriptHash(path.join(tmp, '없음.md')), '', '없는 파일은 빈 문자열(던지지 않는다)');
}

console.log('\n[2] snapshotMatchesScript — 원문 실행 (해시를 못 믿을 때의 정확한 판정)');
{
  const A = ['첫 문장입니다.', '둘째 문장입니다.'];
  ok(snapshotMatchesScript(mkParsed(A), mkSnap(A)), '문장이 모두 같으면 true');
  ok(!snapshotMatchesScript(mkParsed(['첫 문장입니다.', '둘째 문장을 고쳤다.']), mkSnap(A)),
    '🔴 문장 수는 같고 내용만 달라도 false (하이디 1부가 정확히 이 경우였다 — 885문장 동일)');
  ok(!snapshotMatchesScript(mkParsed([...A, '셋째']), mkSnap(A)), '문장이 늘면 false');
  ok(!snapshotMatchesScript(mkParsed(['첫 문장입니다.']), mkSnap(A)), '문장이 줄면 false');
  ok(snapshotMatchesScript(mkParsed(['첫  문장입니다. ']), mkSnap(['첫 문장입니다.'])),
    '공백 차이는 무시한다(줄바꿈·중복 공백)');
  ok(!snapshotMatchesScript(mkParsed(A), { projects: [] }), '스냅샷이 비면 false');
  ok(!snapshotMatchesScript(mkParsed([]), mkSnap(A)), '대본이 비면 false(0개끼리 같다고 보지 않는다)');
  ok(!snapshotMatchesScript(null, mkSnap(A)), 'null 에도 던지지 않고 false');
  const withPrompt = mkParsed(A); withPrompt.projects[0].groups[0].imagePrompt = 'South Korean actors';
  const oldPrompt = mkSnap(A); oldPrompt.projects[0].groups[0].imagePrompt = 'a younger woman';
  ok(!snapshotMatchesScript(withPrompt, oldPrompt), '🔴 문장이 같아도 대본 명시 프롬프트가 달라지면 false');
  oldPrompt.projects[0].groups[0].imagePrompt = 'South  Korean actors ';
  ok(snapshotMatchesScript(withPrompt, oldPrompt), '프롬프트 공백 차이는 무시');
}

console.log('\n[3] 판정 — 원문 블록 실행');
{
  ok(HAS_BRANCH, '작업본 분기 `if (!opts.force && sameMode && fresh)` 가 원문에 있다');
  const H = 'a'.repeat(16), H2 = 'b'.repeat(16);
  const A = ['문장 하나.', '문장 둘.'];

  eq(decide({ snap: mkSnap(A, { srcHash: H, hashVer: 3 }), mdHash: H }).use, '작업본',
    'hashVer 3 + 해시 같음 → 작업본(빠른 경로)');
  eq(decide({ snap: mkSnap(A, { srcHash: H, hashVer: 3 }), mdHash: H }).parses, 0,
    '빠른 경로에서는 파싱하지 않는다(비용 0)');
  eq(decide({ snap: mkSnap(A, { srcHash: H, hashVer: 3 }), mdHash: H2 }).use, '새파싱',
    'hashVer 3 + 해시 다름 → 새 파싱');
  eq(decide({ snap: mkSnap(A, { srcHash: H, hashVer: 3 }), mdHash: '' }).use, '새파싱',
    '대본을 못 읽어 해시가 비면 새 파싱(fail-safe)');

  // 🔴 v0.4.6 오염 — 해시는 「현재 대본」 것이라 같지만, 작업본은 옛 것이다
  eq(decide({ snap: mkSnap(A, { srcHash: H }), mdHash: H, parseResult: mkParsed(['고친 문장.', '문장 둘.']) }).use,
    '새파싱', '🔴 hashVer 없는 해시(v0.4.6 오염)는 믿지 않고 문장으로 재판정 → 새 파싱');
  eq(decide({ snap: mkSnap(A, { srcHash: H }), mdHash: H, parseResult: mkParsed(A) }).use,
    '작업본', 'hashVer 없어도 문장이 같으면 작업본 유지(편집 보존)');

  // 옛 스냅샷(srcHash 자체가 없음)
  eq(decide({ snap: mkSnap(A), mdHash: H, parseResult: mkParsed(A) }).use, '작업본',
    '옛 스냅샷 + 대본 그대로 → 작업본 유지');
  eq(decide({ snap: mkSnap(A), mdHash: H, parseResult: mkParsed(['고침.', '문장 둘.']) }).use, '새파싱',
    '🔴 옛 스냅샷 + 대본 수정 → 새 파싱 (실사고 ① 해결)');
  eq(decide({ snap: mkSnap(A), mdHash: H, parseThrows: true }).use, '새파싱',
    '파싱이 실패하면 작업본을 쓰지 않는다(fail-safe)');

  eq(decide({ snap: mkSnap(A, { srcHash: H, hashVer: 3 }), mdHash: H, force: true }).use, '새파싱',
    'force(🔄 다시 읽기)면 해시가 같아도 새 파싱');
  eq(decide({ snap: mkSnap(A, { srcHash: H, hashVer: 3 }), mdHash: H, sameMode: false }).use, '새파싱',
    '모드가 다르면(옛 쇼츠 스냅샷) 이어받지 않는다(회귀)');
  eq(decide({ snap: mkSnap(A), mdHash: H, sameMode: false }).parses, 0,
    '모드가 다르면 판정용 파싱도 하지 않는다');
}

console.log('\n[4] 저장 규약 — 고착을 만들지 않는가');
{
  const body = cut(/function buildSnapshot\(\) \{[\s\S]*?\n\}/, 'buildSnapshot');
  ok(/srcHash: \(S\.parsed && S\.parsed\._srcHash\) \|\| ''/.test(body),
    'buildSnapshot 은 파싱 시점에 심어 둔 _srcHash 를 그대로 기록한다');
  ok(/hashVer: SNAP_HASH_VER/.test(body), 'buildSnapshot 이 hashVer 를 찍는다(오염분 자동 재판정)');
  ok(!/scriptHash\(/.test(body),
    '⛔ buildSnapshot 안에서 scriptHash() 를 다시 부르지 않는다 — 부르면 「바뀐 대본의 해시 + 옛 파싱」이 저장된다');
  ok(/const SNAP_HASH_VER = 3;/.test(MAIN), 'SNAP_HASH_VER 상수 정의');
  ok(/_srcHash', \{ value: mdHash/.test(MAIN), 'buildParsedForScript 가 파싱 직후 _srcHash 를 심는다');
  // ⚠ 주석에는 그 문구가 「무엇이 틀렸었나」의 기록으로 남아 있다 → **코드 줄만** 본다.
  const codeOnly = MAIN.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  ok(!/snap\.savedAt >= mdMtime/.test(codeOnly), '옛 판정(savedAt >= mdMtime)이 코드에 남아 있지 않다');
  ok(/parsed = preParsed \|\| P\.parseScript\(/.test(MAIN),
    '판정에 쓴 파싱을 새 파싱에서 재사용한다(같은 대본을 두 번 파싱하지 않는다)');
}

console.log('\n[5] 🔄 대본 다시 읽기 배선');
{
  ok(/ipcMain\.handle\('reload-script'/.test(MAIN), 'main: reload-script IPC');
  const h = cut(/ipcMain\.handle\('reload-script'[\s\S]*?\n\}\);/, 'reload-script 핸들러');
  ok(/\{ force: true \}/.test(h), '핸들러가 force 로 새로 파싱한다');
  ok(/applyIntroFromScript/.test(h), '도입부(isIntro)를 .md 기준으로 다시 계산한다');
  ok(/storeActive\(\)/.test(h), '큐 항목에 반영한다');
  ok(/scheduleAutoSave\(\)/.test(h), '새 해시로 스냅샷을 갱신한다');
  ok(/pushDtoUpdate\(\)/.test(h), '화면을 갱신한다');

  ok(/reloadScript: \(\) => ipcRenderer\.invoke\('reload-script'\)/.test(read('preload.js')), 'preload: reloadScript');
  const app = read('renderer/src/App.jsx');
  ok(/async function runReloadScript\(\)/.test(app), 'App: runReloadScript 핸들러 정의');
  ok(/api\.reloadScript\(\)/.test(app), 'App: api.reloadScript 호출');
  // ⚠ 라벨 문자열로 세지 말 것 — setStatus('🔄 대본 다시 읽기…') 에도 같은 글자가 있다(처음에 이걸로 헛실패했다).
  eq((app.match(/onClick=\{runReloadScript\}/g) || []).length, 1, '버튼은 한 곳에만(진입점 이중화 금지)');
  const dist = fs.readdirSync(path.join(ROOT, 'renderer', 'dist', 'assets')).filter((f) => f.endsWith('.js'));
  ok(dist.some((f) => read(path.join('renderer', 'dist', 'assets', f)).includes('대본 다시 읽기')),
    '번들(renderer/dist)에 반영됐다');
}

console.log('\n[6] 실사고 재현 + A/B 역검증');
{
  const A = ['첫 문장입니다.', '둘째 문장입니다.'];
  const snapOld = mkSnap(A, { savedAt: Date.parse('2026-09-14T09:18:47Z') }); // 옛 스냅샷
  const mdMtime = Date.parse('2026-09-14T09:14:02Z');                          // 18:14 수정
  const nowParsed = mkParsed(['첫 문장입니다.', '둘째 문장을 고쳤습니다.']);

  eq(decide({ snap: snapOld, mdHash: 'x'.repeat(16), parseResult: nowParsed }).use, '새파싱',
    '🔴 실사고 ①: 자동저장이 savedAt 을 밀어 올려도 고친 대본이 반영된다');
  const oldJudge = (s, mm) => (s && s.savedAt >= mm) ? '작업본' : '새파싱';
  eq(oldJudge(snapOld, mdMtime), '작업본', 'A/B: 옛 코드는 옛 작업본을 이어받는다(실사고 재현)');

  // 실사고 ② — v0.4.6 이 심은 해시가 현재 대본과 같아도 고착되지 않는다
  const snapPoisoned = mkSnap(A, { srcHash: 'p'.repeat(16) }); // hashVer 없음
  eq(decide({ snap: snapPoisoned, mdHash: 'p'.repeat(16), parseResult: nowParsed }).use, '새파싱',
    '🔴 실사고 ②: v0.4.6 오염 스냅샷(해시 일치)도 문장 재판정으로 풀린다');
  const v46Judge = (s, mh) => (s.srcHash ? s.srcHash === mh : false) ? '작업본' : '새파싱';
  eq(v46Judge(snapPoisoned, 'p'.repeat(16)), '작업본', 'A/B: v0.4.6 은 그 상태로 영구 고착됐다');
}

console.log('\n[7] 로이 PC 실제 스냅샷·대본 실증 (있을 때만)');
{
  const d = path.join(os.homedir(), '.priming-maker', 'projects');
  let P = null; try { P = require(path.join(ROOT, 'core', 'pipeline')); } catch {}
  if (!fs.existsSync(d) || !P) {
    console.log('  ⏭ 스냅샷 폴더/파이프라인 없음 — 건너뜀');
  } else {
    const files = fs.readdirSync(d).filter((f) => f.endsWith('.smproj.json'));
    let checked = 0, slow = 0;
    for (const f of files) {
      let s; try { s = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch { continue; }
      if (!s.scriptPath || !fs.existsSync(s.scriptPath) || s.mode !== 'longform') continue;
      const t0 = Date.now();
      let parsed; try { parsed = P.parseScript(s.scriptPath, 'longform', {}); } catch { continue; }
      const ms = Date.now() - t0;
      if (ms > 400) slow++;
      snapshotMatchesScript(parsed, s); // 던지지 않는지
      if (++checked >= 12) break;
    }
    ok(checked > 0, `실제 대본 ${checked}개로 판정을 돌렸다(예외 0)`);
    eq(slow, 0, '판정용 파싱이 400ms 를 넘는 대본이 없다(실측 885문장 22ms · 3958문장 49ms)');
  }
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${fail === 0 ? '✅' : '❌'} script-reload: ${pass}/${pass + fail}\n`);
process.exit(fail === 0 ? 0 : 1);
