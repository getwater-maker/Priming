// 🔎 맞춤법 검사 — 로이가 고친 🟥·🟨 문단 (2026-10-06, v0.7.13 · core/spell-check · 화자 규약 §4-1)
//   가짜 claude(test/fixtures/fake-claude.js)로 호출·읽기·실패를 실행한다. 진짜 호출은 PM_SPELL_LIVE=1 일 때만(구독 사용량).
const fs = require('fs'), path = require('path'), os = require('os');
const SC = require('../core/spell-check');
const RM = require('../core/roy-marks');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const FAKE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const TEXT = '저는 그날 마음이 따듯함을 느겼습니다. 부인 할수록 더 또렷해졌습니다.';

(async () => {
  console.log('[1] 답 읽기');
  ok(JSON.stringify(SC.parseItems('```json\n[{"틀림":"느겼습니다","바름":"느꼈습니다"}]\n```', TEXT)) === '[{"틀림":"느겼습니다","바름":"느꼈습니다"}]', '```json 펜스를 벗긴다');
  ok(SC.parseItems('[]', TEXT).length === 0, '빈 목록 = 고칠 곳 없음');
  ok(SC.parseItems('답: [{"틀림":"지어낸지적","바름":"x"}] 끝', TEXT).length === 0, '🔑 원문에 없는 「틀림」은 버린다(지어낸 지적)');
  ok(SC.parseItems('[{"틀림":"느겼습니다","바름":"느겼습니다"}]', TEXT).length === 0, '같은 짝은 버린다');
  ok(SC.parseItems('고칠 곳 없음', TEXT) === null, '목록이 아니면 null(실패로 알린다)');
  ok(SC.readOutput(JSON.stringify({ subtype: 'success', is_error: true, result: 'Please run /login' }), TEXT).error.includes('로그인'), '로그인 만료 → 사람 말');
  ok(SC.readOutput('not json', TEXT).ok === false, 'JSON 이 아니면 실패');

  console.log('[2] 반영 · 은행 교정 칸');
  const ap = SC.applyItems(TEXT, [{ 틀림: '느겼습니다', 바름: '느꼈습니다' }, { 틀림: '없는것', 바름: 'x' }]);
  ok(ap.text === '저는 그날 마음이 따듯함을 느꼈습니다. 부인 할수록 더 또렷해졌습니다.' && ap.applied.length === 1 && ap.skipped.length === 1, '고른 짝만 첫 자리 하나 · 없는 짝은 skipped');
  ok(SC.correctionNote([{ 틀림: '느겼습니다', 바름: '느꼈습니다' }, { 틀림: '부인 할수록', 바름: '부인할수록' }]) === '맞춤법만 — 느겼습니다→느꼈습니다 · 부인 할수록→부인할수록 (claude -p sonnet 검사 · 로이 「반영」)', '「교정」 칸 = 손으로 넣은 1007 줄과 같은 꼴');

  console.log('[3] 호출 — 옵션 · 빈 폴더 · stdin');
  ok(SC.MODEL === 'sonnet' && !SC.argsFor().includes('--bare') && !SC.argsFor().includes('haiku'), '⛔ haiku · --bare 안 씀');
  const A = SC.argsFor();
  for (const f of ['-p', '--tools', '--strict-mcp-config', '--no-session-persistence', '--output-format']) ok(A.includes(f), `옵션 ${f}`);
  ok(A[A.indexOf('--setting-sources') + 1] === 'local' && A[A.indexOf('--tools') + 1] === '' && A[A.indexOf('--output-format') + 1] === 'json', '--setting-sources local · --tools "" · json');
  const argf = path.join(os.tmpdir(), `fake-claude-args-${process.pid}.json`);
  process.env.FAKE_CLAUDE_ARGS = argf;
  let r = await SC.check(TEXT, { exe: FAKE });
  const seen = JSON.parse(fs.readFileSync(argf, 'utf8'));
  ok(r.ok && r.items.length === 2 && r.items[0]['바름'] === '느꼈습니다' && r.items[1]['바름'] === '부인할수록', `가짜 claude → 두 곳 (${JSON.stringify(r.items)})`);
  ok(!r.items.some((x) => x['틀림'] === '지어낸지적'), '원문에 없는 지적은 걸렀다');
  ok(seen.input.trim() === TEXT && JSON.stringify(seen.args) === JSON.stringify(SC.argsFor()), '문단은 stdin · 인자는 실측 호출 그대로(지시문 한글·따옴표 그대로 전달)');
  ok(/priming-spell-/.test(seen.cwd) && !fs.existsSync(seen.cwd), '빈 임시 폴더에서 돌고 끝나면 지운다(프로젝트 CLAUDE.md 가 안 실리게)');
  delete process.env.FAKE_CLAUDE_ARGS; try { fs.rmSync(argf); } catch (_) {}
  process.env.FAKE_CLAUDE_MODE = 'login'; r = await SC.check(TEXT, { exe: FAKE });
  ok(!r.ok && /로그인/.test(r.error), `로그인 만료 → 「${r.error}」`);
  process.env.FAKE_CLAUDE_MODE = 'junk'; r = await SC.check(TEXT, { exe: FAKE });
  ok(!r.ok && /목록 형식/.test(r.error), '목록이 아닌 답 → 실패 알림');
  process.env.FAKE_CLAUDE_MODE = 'hang'; r = await SC.check(TEXT, { exe: FAKE, timeoutMs: 1500 });
  ok(!r.ok && /초 안에 답이 없습니다/.test(r.error) && r.ms < 4000, `시간 초과 → 끊고 알림 (${r.ms}ms)`);
  delete process.env.FAKE_CLAUDE_MODE;
  r = await SC.check(TEXT, { exe: path.join(os.tmpdir(), 'no-such-claude.exe') });
  ok(!r.ok && /없습니다|실행하지 못했습니다/.test(r.error), `claude 가 없는 PC → 「${r.error}」`);
  ok((await SC.check('   ')).items.length === 0, '빈 글은 부르지 않는다');
  const cmd = path.join(os.tmpdir(), `claude-${process.pid}.cmd`), exeDir = path.join(os.tmpdir(), `nm-${process.pid}`, 'bin');
  fs.mkdirSync(exeDir, { recursive: true }); fs.writeFileSync(path.join(exeDir, 'claude.exe'), '');
  fs.writeFileSync(cmd, `@ECHO off\r\n"%dp0%\\nm-${process.pid}\\bin\\claude.exe"   %*\r\n`);
  ok(SC.exeFromCmd(cmd) === path.join(exeDir, 'claude.exe'), 'npm 껍데기(claude.cmd)에서 claude.exe 를 찾는다(cmd 를 거치지 않는다)');
  fs.rmSync(cmd); fs.rmSync(path.dirname(exeDir), { recursive: true, force: true });

  console.log('[4] 떨어진 🟥 도 미확인으로 센다(렌더 관문 구멍)');
  const c = RM.countMarks([{ k: 'exp', st: '가안', found: false }, { k: 'exp', st: '확인', found: false }, { k: 'int', st: null, found: false }, { k: 'exp', st: '가안', found: true }]);
  ok(c.expOpen === 2 && c.lostOpen === 1 && c.lost === 3 && c.exp === 1, `떨어진 가안 = 미확인 · 떨어진 확인·🟨 은 아님 ${JSON.stringify(c)}`);
  const P = require('../core/pipeline');
  const md = '# t\n\n## 1장\n\n앞 문장입니다.\n\n> 📝 🟥 경험·가안\n\n### 〔새 장면〕\n> 🖼️ 이미지: a room.\n저는 그날 병원에 갔습니다.\n';
  const cc = RM.countMarks(RM.attachMarks(md, P.parseScriptText(md, 'longform', {}).projects[0].sentences).marks);
  ok(cc.expOpen === 1 && cc.lostOpen === 1, '표시 줄과 문단 사이에 ### 가 끼면(야담 1007) 떨어진 미확인 1');

  console.log('[5] main 연결');
  const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(/royNoBank: true/.test(MAIN) && /_royAfterEdit\(pr, _royTouched, \{ noBank: !!args\.royNoBank \}\)/.test(MAIN), '반영은 문장 고치기 길 그대로 · 「수정」 줄은 빼고');
  ok(/_royAppend\(S\.parsed, sp, m2, '교정', \{ source: '교정', extra: \{ 교정: SpellCheck\.correctionNote\(applied\) \} \}\)/.test(MAIN), '은행 같은 id 에 출처·확인 「교정」 + 교정 칸');
  ok(/const \{ open: n, lostOpen \} = royOpenInfo\(parsed\);/.test(MAIN), '관문이 떨어진 표시를 알린다');
  ok(!/roy-spell[\s\S]{0,400}royGate/.test(MAIN.slice(MAIN.indexOf("ipcMain.handle('roy-spell'"), MAIN.indexOf("ipcMain.handle('roy-spell-list'"))), '맞춤법 실패가 렌더를 막지 않는다(관문과 무관)');
  const SR = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'ScriptReader.jsx'), 'utf8');
  ok(!/schedule\(\)[^\n]*roySpell|SAVE_IDLE_MS[^\n]*roySpell/.test(SR) && /function maybeSpell\(\)/.test(SR) && /if \(!spellPendRef\.current\.size \|\| busyNow\(\)\) return;/.test(SR), '자동 저장마다 부르지 않는다(고친 표시를 벗어날 때만)');

  if (process.env.PM_SPELL_LIVE === '1') {
    console.log('[6] 진짜 claude (PM_SPELL_LIVE=1)');
    const L = await SC.check(TEXT);
    ok(L.ok && L.items.some((x) => x['바름'] === '느꼈습니다') && L.items.some((x) => x['바름'] === '부인할수록') && !L.items.some((x) => /따듯/.test(x['틀림'])), `실측 ${JSON.stringify(L.items)} (${L.ms}ms)`);
  }
  console.log(`\n${fail ? '✗' : '✓'} spell-check: ${pass} 통과 · ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
