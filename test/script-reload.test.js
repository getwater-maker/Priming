/**
 * v0.4.6 — 대본을 고쳤는데 옛 작업본이 그대로 나오던 것
 *
 * 🔴 실사고(2026-09-14, 로이 PC 실측):
 *   `[서재_0928] 알프스 소녀 하이디 1부` — .md 18:14:02 수정 → 스냅샷 18:18:47 저장
 *   판정이 `snap.savedAt >= mdMtime` 이라 **savedAt 이 이겨** 옛 작업본이 이어졌다.
 *   savedAt 은 「앱이 마지막으로 자동저장한 시각」일 뿐이라, 대본을 고친 뒤 앱에서 아무거나
 *   건드리면(자동저장 8곳·1.5초 디바운스) 그 대본은 **몇 번을 다시 열어도 옛 내용**이 나온다.
 *   실측: 최근 스냅샷 10개 중 9개가 이 상태였다.
 *
 * 🔑 이 테스트는 **원문을 그대로 실행한다**(로직을 복사해 두면 앱과 갈라져도 통과한다).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}
const eq = (a, b, label) => ok(a === b, `${label} (기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)})`);

// ── 원문에서 뽑아 실행 ────────────────────────────────────────────────
function extractScriptHash(src) {
  const m = src.match(/function scriptHash\(scriptPath\) \{[\s\S]*?\n\}/);
  if (!m) throw new Error('main.js 에서 scriptHash 를 못 찾음');
  // eslint-disable-next-line no-new-func
  return new Function('fs', 'require', `${m[0]}; return scriptHash;`)(fs, require);
}
function extractFreshExpr(src) {
  const m = src.match(/const fresh = snap && \(snap\.srcHash[\s\S]*?\);/);
  if (!m) throw new Error('main.js 에서 fresh 판정식을 못 찾음');
  const expr = m[0].replace(/^const fresh = /, '').replace(/;$/, '');
  // eslint-disable-next-line no-new-func
  return new Function('snap', 'mdHash', 'mdMtime', `return (${expr});`);
}
// 최종 분기 `if (!opts.force && sameMode && fresh)` 도 원문에서 확인해 함께 실행한다.
function makeDecide(src) {
  const fresh = extractFreshExpr(src);
  const branch = src.match(/if \(!opts\.force && sameMode && fresh\) \{/);
  if (!branch) throw new Error('main.js 에서 작업본 분기를 못 찾음');
  return (snap, mdHash, mdMtime, sameMode, force) =>
    (!force && sameMode && fresh(snap, mdHash, mdMtime)) ? '작업본' : '새파싱';
}

const MAIN = read('main.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'script-reload-'));
const mdPath = path.join(tmp, '대본.md');

console.log('\n[1] scriptHash — 원문 실행 (내용만 본다)');
{
  const scriptHash = extractScriptHash(MAIN);

  fs.writeFileSync(mdPath, '# 하이디\n\n알름 아저씨에게 올라가다.\n', 'utf8');
  const h1 = scriptHash(mdPath);
  ok(/^[0-9a-f]{16}$/.test(h1), '16자리 hex 해시를 낸다');

  // 🔑 구글드라이브 동기화 시나리오 — 내용은 그대로, mtime 만 바뀐다
  const future = new Date(Date.now() + 3600e3);
  fs.utimesSync(mdPath, future, future);
  eq(scriptHash(mdPath), h1, '내용이 같으면 mtime 이 바뀌어도 같은 해시(작업본 보존)');

  fs.writeFileSync(mdPath, '# 하이디\n\n알름 아저씨에게 올라가다. 고쳤다.\n', 'utf8');
  const h2 = scriptHash(mdPath);
  ok(h2 !== h1, '내용이 바뀌면 해시가 바뀐다');

  eq(scriptHash(path.join(tmp, '없는파일.md')), '', '없는 파일은 빈 문자열(던지지 않는다)');
}

console.log('\n[2] 판정 — 원문 표현식 실행');
{
  const decide = makeDecide(MAIN);
  const H = 'aaaaaaaaaaaaaaaa', H2 = 'bbbbbbbbbbbbbbbb';
  const now = Date.now();

  eq(decide({ srcHash: H, savedAt: now }, H, now - 1000, true, false), '작업본',
    '해시가 같으면 작업본을 이어받는다(그룹 분할·제목 편집 보존)');

  // 🔴 실사고의 핵심 조건: 대본을 고쳤고 그 뒤 자동저장이 돌아 savedAt 이 mtime 을 넘어섰다
  eq(decide({ srcHash: H, savedAt: now + 5 * 60e3 }, H2, now, true, false), '새파싱',
    '🔴 해시가 다르면 savedAt 이 아무리 최신이어도 새로 파싱한다(실사고 해결)');

  eq(decide({ srcHash: H, savedAt: now }, '', now, true, false), '새파싱',
    '대본을 못 읽어 해시가 비면 새로 파싱(fail-safe)');

  eq(decide({ srcHash: H, savedAt: now }, H, now - 1000, true, true), '새파싱',
    'force(🔄 다시 읽기)면 해시가 같아도 새로 파싱');

  eq(decide({ srcHash: H, savedAt: now }, H, now - 1000, false, false), '새파싱',
    '모드가 다르면(옛 쇼츠 스냅샷) 이어받지 않는다(회귀)');

  // 하위호환 — srcHash 가 없는 옛 스냅샷은 예전 방식 그대로
  eq(decide({ savedAt: now }, H, now - 1000, true, false), '작업본',
    '옛 스냅샷(srcHash 없음)은 savedAt 폴백 — 기존 동작 보존');
  eq(decide({ savedAt: now - 1000 }, H, now, true, false), '새파싱',
    '옛 스냅샷이 대본보다 오래됐으면 새로 파싱(회귀)');
  eq(decide(null, H, now, true, false), '새파싱', '스냅샷이 없으면 새로 파싱');
}

console.log('\n[3] 🔑 저장할 때 해시를 다시 계산하지 않는가 (재발 방지의 핵심)');
{
  const snapFn = MAIN.match(/function buildSnapshot\(\) \{[\s\S]*?\n\}/);
  ok(!!snapFn, 'buildSnapshot 을 찾았다');
  const body = snapFn[0];
  ok(/srcHash: \(S\.parsed && S\.parsed\._srcHash\) \|\| ''/.test(body),
    'buildSnapshot 은 파싱 시점에 심어 둔 _srcHash 를 그대로 기록한다');
  ok(!/scriptHash\(/.test(body),
    '⛔ buildSnapshot 안에서 scriptHash() 를 다시 부르지 않는다 — 부르면 「바뀐 대본의 해시 + 옛 파싱」이 저장돼 같은 사고가 재발한다');

  // 파싱 시점에 심는 배선
  ok(/_srcHash', \{ value: mdHash/.test(MAIN), 'buildParsedForScript 가 파싱 직후 _srcHash 를 심는다');
  ok(!/snap\.savedAt >= mdMtime\) \{/.test(MAIN), '옛 판정(`snap.savedAt >= mdMtime`)이 분기 조건으로 남아 있지 않다');
}

console.log('\n[4] 🔄 대본 다시 읽기 배선');
{
  ok(/ipcMain\.handle\('reload-script'/.test(MAIN), 'main: reload-script IPC');
  const h = MAIN.match(/ipcMain\.handle\('reload-script'[\s\S]*?\n\}\);/)[0];
  ok(/\{ force: true \}/.test(h), '핸들러가 force 로 새로 파싱한다');
  ok(/applyIntroFromScript/.test(h), '도입부(isIntro)를 .md 기준으로 다시 계산한다');
  ok(/storeActive\(\)/.test(h), '큐 항목에 반영한다');
  ok(/scheduleAutoSave\(\)/.test(h), '새 해시로 스냅샷을 갱신한다(다음에 열 때도 유지)');
  ok(/pushDtoUpdate\(\)/.test(h), '화면을 갱신한다');

  ok(/reloadScript: \(\) => ipcRenderer\.invoke\('reload-script'\)/.test(read('preload.js')), 'preload: reloadScript');

  const app = read('renderer/src/App.jsx');
  ok(/async function runReloadScript\(\)/.test(app), 'App: runReloadScript 핸들러 정의');
  ok(/api\.reloadScript\(\)/.test(app), 'App: api.reloadScript 호출');
  ok(/onClick=\{runReloadScript\}>🔄 대본 다시 읽기<\/button>/.test(app), 'App: 🔄 버튼이 핸들러에 연결됐다');
  // ⚠ 라벨 문자열로 세지 말 것 — setStatus('🔄 대본 다시 읽기…') 에도 같은 글자가 있다(처음에 이걸로 헛실패했다).
  //   진입점은 **onClick 배선 개수**로 센다.
  eq((app.match(/onClick=\{runReloadScript\}/g) || []).length, 1, '버튼은 한 곳에만(진입점 이중화 금지)');

  // 소스만 고치고 빌드를 잊으면 화면은 옛것이다 — 번들 반영 확인
  const dist = fs.readdirSync(path.join(ROOT, 'renderer', 'dist', 'assets')).filter((f) => f.endsWith('.js'));
  const bundled = dist.some((f) => read(path.join('renderer', 'dist', 'assets', f)).includes('대본 다시 읽기'));
  ok(bundled, '번들(renderer/dist)에 반영됐다');
}

console.log('\n[5] 실사고 재현 — 실제 파일로 (A/B 역검증 포함)');
{
  const scriptHash = extractScriptHash(MAIN);
  const decide = makeDecide(MAIN);

  // ① 대본을 쓰고 앱이 연다(파싱) → 그 순간의 해시가 스냅샷에 들어간다
  fs.writeFileSync(mdPath, '# 하이디 1부\n\n첫 문장입니다.\n', 'utf8');
  const parsedHash = scriptHash(mdPath);
  const snap = { mode: 'longform', srcHash: parsedHash, savedAt: Date.parse('2026-09-14T09:10:00Z') };

  // ② 로이가 18:14 에 .md 를 고친다
  fs.writeFileSync(mdPath, '# 하이디 1부\n\n첫 문장입니다. 고친 내용.\n', 'utf8');
  const mdMtime = Date.parse('2026-09-14T09:14:02Z');

  // ③ 앱에서 뭔가를 건드려 18:18 에 자동저장이 돈다 → savedAt 만 갱신(srcHash 는 파싱 시점 값 유지)
  snap.savedAt = Date.parse('2026-09-14T09:18:47Z');

  const nowHash = scriptHash(mdPath);
  eq(decide(snap, nowHash, mdMtime, true, false), '새파싱',
    '🔴 수정본: 고친 대본이 반영된다(실사고 해결)');

  // A/B — 옛 판정으로 같은 상황을 돌리면 실사고가 그대로 재현된다
  const oldDecide = (s, mm) => (s && s.savedAt >= mm) ? '작업본' : '새파싱';
  eq(oldDecide(snap, mdMtime), '작업본', 'A/B: 옛 코드는 옛 작업본을 이어받는다(실사고 재현)');
  ok(decide(snap, nowHash, mdMtime, true, false) !== oldDecide(snap, mdMtime),
    'A/B: 수정 전후가 실제로 다르다(헛단언 아님)');

  // ④ 되돌려 저장해도(내용 동일) 작업본이 유지된다 — 편집 손실 방지
  fs.writeFileSync(mdPath, '# 하이디 1부\n\n첫 문장입니다.\n', 'utf8');
  eq(decide(snap, scriptHash(mdPath), Date.now(), true, false), '작업본',
    '내용을 원래대로 되돌리면 작업본이 그대로 유지된다');
}

console.log('\n[6] 로이 PC 실제 스냅샷 회귀 (있을 때만)');
{
  const d = path.join(os.homedir(), '.priming-maker', 'projects');
  if (!fs.existsSync(d)) {
    console.log('  ⏭ 스냅샷 폴더 없음 — 건너뜀');
  } else {
    const decide = makeDecide(MAIN);
    const files = fs.readdirSync(d).filter((f) => f.endsWith('.smproj.json'));
    let oldSnaps = 0, withHash = 0;
    for (const f of files.slice(0, 40)) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        if (s.srcHash) withHash++; else oldSnaps++;
      } catch {}
    }
    ok(files.length > 0, `스냅샷 ${files.length}개를 읽었다`);
    ok(oldSnaps + withHash > 0, `옛 스냅샷 ${oldSnaps}개 · 해시 있는 스냅샷 ${withHash}개`);
    // 옛 스냅샷이 폴백으로 여전히 동작하는지(하위호환)
    const now = Date.now();
    eq(decide({ savedAt: now }, 'x'.repeat(16), now - 1, true, false), '작업본',
      '옛 스냅샷(해시 없음)도 그대로 이어받는다 — 기존 작업 무손실');
  }
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${fail === 0 ? '✅' : '❌'} script-reload: ${pass}/${pass + fail}\n`);
process.exit(fail === 0 ? 0 : 1);
