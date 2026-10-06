// 🟥 경험 · 🟨 해석 표시 + 로이은행 (2026-10-06, v0.7.3 · 채널사업부 요청 「화자는 실제 로이」)
//   원문 모듈(core/roy-marks · core/roy-bank)을 그대로 실행한다. 은행·기억 파일은 임시 폴더(로이의 진짜 은행을 건드리지 않는다).
const fs = require('fs'), path = require('path'), os = require('os');
const RM = require('../core/roy-marks');
const RB = require('../core/roy-bank');
const P = require('../core/pipeline');
const LP = require('../core/parsers/longform-parser');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const parse = (md) => P.parseScriptText(md, 'longform', {}).projects[0];

const MD = [
  '# 제목', '', '## 1장 시작', '', '> 🖼️ 이미지: a cat.', '',
  '첫 문장입니다. 둘째 문장입니다.', '',
  '> 📝 🟥 경험·가안',
  '손주 돌잔치 날, 사진을 찍던 기억이 납니다. 그날은 비가 왔습니다.', '',
  '그 뒤 이야기입니다.', '',
  '> 📝 🟨 해석',
  '> 🖼️ 이미지: a desk.',
  '[로이] 저는 이 대목에서 멈춥니다. 왜냐하면 그렇습니다.', '',
  '## 2장', '> 📝 **강의안 근거**', '> 📝 - 구성: 공감 질문',
  '> 📝 - 🟥 경험·은행: 「병원 대기실에서」로 시작하는 문장',
  '앞 문장이다. 병원 대기실에서 기다렸습니다. 끝 문장.', '',
  '> 📝 🟥 경험',
  '손주 돌잔치 날, 사진을 찍던 기억이 납니다.', '',
].join('\n');

console.log('[1] 표시는 낭독·그룹·자막에 새지 않는다');
{
  const pr = parse(MD), pr0 = parse(MD.split('\n').filter((l) => !RM.isMarkLine(l)).join('\n'));
  ok(JSON.stringify(pr.sentences.map((s) => s.text)) === JSON.stringify(pr0.sentences.map((s) => s.text)), '표시 줄이 있어도 문장이 한 글자도 같다');
  ok(pr.groups.length === pr0.groups.length, '그룹 수도 같다');
  ok(!pr.sentences.some((s) => /🟥|🟨|경험·|해석$/.test(s.text)), '문장에 표시 글자가 없다');
  const notes = LP.readerNotesOf(MD).map((n) => n.text);
  ok(notes.includes('강의안 근거') && notes.includes('- 구성: 공감 질문'), '보통 📝 메모는 그대로 메모 칸에');
  ok(!notes.some((t) => /🟥|🟨/.test(t)), '🟥·🟨 표시 줄은 메모 칸에서 빠진다');
  const html = require('../core/book/html-builder');
  ok(typeof html === 'object', '(책 HTML 은 📝 줄을 원래 거른다 — SCRIPT_NOTE_RE)');
  ok(/SCRIPT_NOTE_RE = \/\^\\s\*\(\?:🎯\|📝/.test(fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'html-builder.js'), 'utf8')), '책 출력이 📝 줄을 거르는 규칙이 그대로 있다');
}

console.log('[2] 문장에 붙이기 — 자리로 가리키는 새 형식 · 옛 「첫 낱말」 형식');
{
  const pr = parse(MD);
  const r = RM.attachMarks(MD, pr.sentences);
  const by = Object.fromEntries(r.marks.map((m) => [m.mid, m]));
  ok(r.marks.length === 4 && r.marks.every((m) => m.found), `표시 4개 모두 찾음 (${r.marks.map((m) => m.mid + ':' + m.found).join(' ')})`);
  ok(by.exp1.text === '손주 돌잔치 날, 사진을 찍던 기억이 납니다. 그날은 비가 왔습니다.' && by.exp1.st === '가안' && by.exp1.sids.length === 2, '🟥 가안 = 바로 아래 문단 두 문장');
  ok(by.int1.text === '저는 이 대목에서 멈춥니다. 왜냐하면 그렇습니다.' && by.int1.st === null, '🟨 = 빈 줄·🖼️ 줄을 건너뛴 다음 문단(화자 [로이] 접두는 뺀다)');
  ok(by.exp2.text === '병원 대기실에서 기다렸습니다.' && by.exp2.st === '은행', '옛 형식 「…로 시작하는 문장」 = 그 문장만');
  ok(by.exp3.st === '가안' && by.exp3.found && by.exp3.sids[0] !== by.exp1.sids[0], '상태가 빠지면 가안 · 같은 글이 두 번 나와도 뒤쪽 것(앞으로만 찾는다)');
  const c = RM.countMarks(r.marks);
  ok(c.exp === 3 && c.expOpen === 3 && c.int === 1 && c.lost === 0, `개수 ${JSON.stringify(c)}`);
  ok(r.bySid[by.exp1.sids[0]].first === true && r.bySid[by.exp1.sids[1]].first === false, '첫 문장만 first(칩 자리)');
  // 판정력: 문단 글이 다르면 못 찾는다
  const bad = MD.replace('손주 돌잔치 날, 사진을 찍던 기억이 납니다. 그날은', '손주 돌잔치 날, 사진을 찍던 기억이 납니다. 그날은');
  ok(RM.attachMarks(bad, parse(MD).sentences.slice(0, 2)).marks[0].found === false, '판정력: 문장이 없으면 found=false');
  // 첫머리를 고쳐도 새 형식은 붙어 있다
  const edited = MD.replace('손주 돌잔치 날, 사진을 찍던 기억이 납니다. 그날은 비가 왔습니다.', '큰딸 결혼식 날, 사진을 찍던 기억이 납니다. 그날은 비가 왔습니다.');
  const r2 = RM.attachMarks(edited, parse(edited).sentences);
  ok(r2.marks[0].found && r2.marks[0].text.startsWith('큰딸 결혼식'), '🔑 첫머리를 고쳐도 표시가 떨어지지 않는다(자리로 가리킨다)');
  const edited2 = MD.replace('병원 대기실에서 기다렸습니다.', '응급실 앞에서 기다렸습니다.');
  ok(RM.attachMarks(edited2, parse(edited2).sentences).marks.find((m) => m.mid === 'exp2').found === false, '옛 형식은 첫머리를 고치면 떨어진다(그래서 새 형식을 권한다)');
  const wrong = '# t\n\n## a\n\n> 📝 🟥 해석\n본문입니다.\n';
  ok(RM.scanMarks(wrong).length === 0, '틀린 짝(🟥 해석)은 표시가 아니다');
  const head = '# t\n\n## a\n\n> 📝 🟨 해석\n## b\n\n본문입니다.\n';
  ok(RM.attachMarks(head, parse(head).sentences).marks[0].found === false, '표시 바로 아래가 제목이면 못 찾음(lost)');
}

console.log('[3] 상태 바꾸기 — 그 줄만');
{
  const r = RM.attachMarks(MD, parse(MD).sentences);
  const L = MD.split('\n');
  const a = RM.setMarkState(MD, r.marks[0].line, '확인').split('\n');
  ok(a[r.marks[0].line] === '> 📝 🟥 경험·확인' && a.filter((l, i) => l !== L[i]).length === 1, '새 형식: 「🟥 경험·확인」 · 다른 줄은 그대로');
  const b = RM.setMarkState(MD, r.marks[2].line, '확인').split('\n');
  ok(b[r.marks[2].line] === '> 📝 - 🟥 경험·확인: 「병원 대기실에서」로 시작하는 문장', '옛 형식: 상태만 바꾼다');
  const c = RM.setMarkState(MD, r.marks[3].line, '확인').split('\n');
  ok(c[r.marks[3].line] === '> 📝 🟥 경험·확인', '상태 없던 표시에도 붙인다');
  ok(RM.setMarkState(MD, r.marks[1].line, '확인') === null && RM.setMarkState(MD, 0, '확인') === null, '🟨·보통 줄은 바꾸지 않는다(null)');
  ok(RM.setMarkState(MD.replace(/\n/g, '\r\n'), r.marks[0].line, '확인').includes('\r\n'), 'CRLF 대본은 CRLF 그대로');
  const pr = parse(RM.setMarkState(MD, r.marks[0].line, '확인'));
  ok(JSON.stringify(pr.sentences.map((s) => s.text)) === JSON.stringify(parse(MD).sentences.map((s) => s.text)), '상태를 바꿔도 문장은 그대로');
}

console.log('[4] 은행 — 원문(처음 초안) 기억 · 덧붙이기 · id');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roybank-'));
  const bank = path.join(tmp, 'bank'); fs.mkdirSync(bank);
  RB._setHome(path.join(tmp, 'home'));
  process.env.PM_ROY_BANK_DIR = bank;
  const base = '[역사_1099] 테스트 대본';
  const mk = (text, st = '가안') => ({ mid: 'exp1', k: 'exp', st, found: true, text });
  RB.rememberOriginals(base, [mk('초안 A.'), { mid: 'int1', k: 'int', st: null, found: true, text: '해석 초안.' }]);
  ok(RB.loadStore(base).marks.exp1.orig === '초안 A.', '처음 본 글 = 원문');
  RB.rememberOriginals(base, [mk('초안 B.')]);
  ok(RB.loadStore(base).marks.exp1.orig === '초안 B.', '앱에서 안 고친 채 밖에서 바뀌면(Claude 가 다시 씀) 원문도 새 초안');
  RB.markEdited(base, 'exp1');
  RB.rememberOriginals(base, [mk('로이가 고친 글.')]);
  ok(RB.loadStore(base).marks.exp1.orig === '초안 B.', '🔑 앱에서 고친 뒤엔 원문이 로이 글로 바뀌지 않는다');
  const now = Date.parse('2026-10-06T23:30:00Z');   // KST 10-07 08:30
  const b1 = RB.append({ scriptBase: base, channel: '04_역사이야기', mark: mk('로이가 고친 글.', '확인'), how: '수정', now });
  const b2 = RB.append({ scriptBase: base, channel: '04_역사이야기', mark: mk('로이가 또 고친 글.', '확인'), how: '수정', now });
  const b3 = RB.append({ scriptBase: base, mark: { mid: 'int1', k: 'int', text: '로이 해석.' }, how: '수정', now });
  const lines = fs.readFileSync(path.join(bank, '경험은행.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  ok(lines.length === 2 && b1.id === 'E-20261007-01' && b2.id === b1.id, `같은 표시는 같은 id · KST 날짜 (${b1.id})`);
  const L0 = lines[0];
  ok(L0.원문 === '초안 B.' && L0.수정 === '로이가 고친 글.' && L0.확인 === '수정' && L0.구분 === '경험' && L0.편 === '[역사_1099]' && L0.출처 === '프라이밍' && L0.채널 === '04_역사이야기' && L0.사실 === '' && L0.날짜 === '2026-10-07', 'README 형식 그대로(원문=처음 초안 · 수정=로이 글)');
  ok(Object.keys(L0).join(',') === 'id,날짜,출처,채널,편,구분,원문,수정,확인,사실', '필드 순서 = README');
  const il = fs.readFileSync(path.join(bank, '해석해설은행.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  ok(il.length === 1 && b3.id === 'I-20261007-01' && il[0].원문 === '해석 초안.', '🟨 은 해석해설은행 · I- id');
  // 다른 대본의 표시는 다음 순번
  const b4 = RB.append({ scriptBase: '[다산_1099] 다른 대본', mark: mk('다른 경험.', '확인'), how: '그대로', now });
  ok(b4.id === 'E-20261007-02', `다른 대본은 다음 순번 (${b4.id})`);
  // 덧붙이기만 — 기존 줄 보존
  const before = fs.readFileSync(path.join(bank, '경험은행.jsonl'), 'utf8');
  RB.append({ scriptBase: base, mark: mk('세 번째.', '확인'), how: '수정', now });
  ok(fs.readFileSync(path.join(bank, '경험은행.jsonl'), 'utf8').startsWith(before), '⛔ 줄을 지우거나 고치지 않는다(앞부분 그대로)');
  // 은행 폴더가 없는 PC → 대기 파일
  process.env.PM_ROY_BANK_DIR = path.join(tmp, 'no-such-dir');
  const bp = RB.append({ scriptBase: '[고전_1099] 대기', mark: mk('대기 경험.', '확인'), how: '그대로', now });
  ok(bp.pending && fs.existsSync(RB.pendingFile()) && !fs.existsSync(path.join(tmp, 'no-such-dir')), '은행 폴더가 없으면 대기 파일에 모으고 폴더를 만들지 않는다');
  delete process.env.PM_ROY_BANK_DIR; RB._setHome(null);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('[5] main 연결 — 원문 순서 · 관문 · 은행 경로');
{
  const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  const a = MAIN.indexOf('function _royAfterEdit('), b = MAIN.indexOf('\n}\n', a), F = MAIN.slice(a, b);
  ok(a > 0 && F.indexOf('RoyBank.markEdited') >= 0 && F.indexOf('RoyBank.markEdited') < F.indexOf('ensureRoyMarks(S.parsed, true)'), '🔑 「고침」 표시를 다시 읽기보다 먼저(순서가 바뀌면 로이 글이 원문이 된다)');
  ok(/setMarkState\(.*, m\.line, '확인'\)/.test(F), '고쳐 저장한 🟥 는 자동 확인');
  const E = MAIN.slice(MAIN.indexOf('async function _editSentences('), MAIN.indexOf("ipcMain.handle('edit-sentences'"));
  ok(E.indexOf('_royTouched') > 0 && E.indexOf('_royAfterEdit(') < E.indexOf('_setSrcHash()'), '문장 고치기 → 은행 → 그다음 대본 해시(두 번 쓴 .md 를 해시가 따라간다)');
  ok(/return \{ ok: true, dto: P\.toDTO\(S\.parsed\), royBank \};/.test(E), '화면에 은행 결과를 돌려준다');
  const MB = MAIN.slice(MAIN.indexOf('async function runMakeAllBody('), MAIN.indexOf('async function runMakeAllBody(') + 4000);
  ok(/if \(!opts\.dry && !\(await royGate\(parsed, \{ queue: !!opts\._fromQueue/.test(MB), '⚡ 만들기 관문(큐면 던져서 그 편만 건너뜀)');
  ok(/_fromQueue: true,/.test(MAIN.slice(MAIN.indexOf("ipcMain.handle('run-batch'"))), '큐 순차 제작이 큐임을 알린다');
  ok(/royGate\(S\.parsed, \{ what: '전체 TTS' \}\)/.test(MAIN), '전체 TTS 관문');
  ok(/P\.setRoyHook\(\(parsed\) => ensureRoyMarks\(parsed\)\)/.test(MAIN), 'DTO 를 만들 때 표시를 붙인다');
  ok(/enumerable: false/.test(MAIN.slice(MAIN.indexOf('function ensureRoyMarks('), MAIN.indexOf('function ensureRoyMarks(') + 1600)), '표시는 작업본에 실리지 않는다(열거 안 됨 — .md 가 정본)');
}

console.log(`\n${fail ? '✗' : '✓'} roy-marks: ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
