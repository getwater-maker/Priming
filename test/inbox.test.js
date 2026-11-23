'use strict';
// node test/inbox.test.js — 📥 받은 편지함 = 1.0 자동 넘김(v1.0.57 · core/inbox) 단위 시험
//   [1] 쪽지 꼴 · [2] 읽기(쓰는 중 · BOM) · [3] 오래된 것부터 · [4] 채널 고르기 · [5] 거절 사유 전부 · [6] 옮기기 · [7] 멈춤 상태
//   [8] 채널 설정값(도구·스타일·완성) · [9] progress.json · [10] main·bootstrap 소스(자동 run 은 묻지 않음 · 단일 실행 · --inbox 는 무인 실행이 아님)
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-unit-'));
process.env.PM_UI_SMOKE = '1'; process.env.PM_INBOX_HOME = path.join(TMP, 'home');
const IB = require('../core/inbox');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('  ✓ ' + m); else { bad++; console.log('  ✗ ' + m); } };
const w = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t, 'utf8'); return p; };

const sp = w(path.join(TMP, 'ch', '대본', '2026_11', '[테_1123] 좋은 편.md'), '# t\n');
const good = { ver: 1, kind: 'render', script: sp, key: '테_1123', at: '2026-11-17 03:12' };

// [1] 꼴
ok(IB.validateNote(good) === '', '[1] 바른 쪽지 통과');
ok(/ver/.test(IB.validateNote({ ...good, ver: 2 })), 'ver 2 = 꼴 오류');
ok(/kind/.test(IB.validateNote({ ...good, kind: 'order' })), 'kind 가 render·upload 아님 = 꼴 오류');
ok(/절대/.test(IB.validateNote({ ...good, script: 'a\\b.md' })), '상대 경로 = 꼴 오류');
ok(/\.md/.test(IB.validateNote({ ...good, script: sp.replace(/\.md$/, '.txt') })), '.md 아님 = 꼴 오류');
ok(/thumbnails/.test(IB.validateNote({ ...good, thumbnails: 'x.png' })), 'thumbnails 가 목록 아님 = 꼴 오류');
ok(/객체/.test(IB.validateNote([1])), '배열 = 꼴 오류');

// [2] 읽기
const ibx = IB.inboxDir();
const f1 = w(path.join(ibx, 'a.json'), '\uFEFF' + JSON.stringify(good));
ok(IB.readNote(f1).ok, '[2] BOM 붙은 쪽지도 읽는다');
const fBad = w(path.join(ibx, 'b.json'), '{"ver":1,');
const rYoung = IB.readNote(fBad);
ok(!rYoung.ok && rYoung.young && rYoung.reason === '꼴 오류', '막 놓인 깨진 쪽지 = 다음에 다시(young)');
const old = (Date.now() - 60000) / 1000; fs.utimesSync(fBad, old, old);
const rOld = IB.readNote(fBad);
ok(!rOld.ok && !rOld.young && rOld.reason === '꼴 오류', '오래된 깨진 쪽지 = 꼴 오류로 거절');
fs.unlinkSync(fBad); fs.unlinkSync(f1);

// [3] 목록 — at 순서 · 임시 파일·하위 폴더 건너뜀
w(path.join(ibx, 'z_first.json'), JSON.stringify({ ...good, at: '2026-11-17 01:00' }));
w(path.join(ibx, 'a_second.json'), JSON.stringify({ ...good, at: '2026-11-17 02:00' }));
w(path.join(ibx, '~writing.json'), '{}'); w(path.join(ibx, '.hidden.json'), '{}'); w(path.join(ibx, 'x.json.tmp'), '{}');
w(path.join(ibx, '진행중', 'doing.json'), '{}');
const L = IB.listNotes();
ok(L.map((x) => x.name).join() === 'z_first.json,a_second.json', '[3] 오래된 것부터 · 임시·숨김·하위 폴더 제외 — ' + L.map((x) => x.name).join());
for (const x of fs.readdirSync(ibx)) fs.rmSync(path.join(ibx, x), { recursive: true, force: true });

ok(IB.noteKey(good) === '테_1123' && IB.noteKey({ script: sp }) === '테_1123', 'noteKey = key 칸 또는 [약칭_MMDD]');

// [4] 채널
const chA = { name: '가', scriptFolder: path.join(TMP, 'ch') };
const chDeep = { name: '나', scriptFolder: path.join(TMP, 'ch', '대본') };
const chSame = { name: '다', scriptFolder: path.join(TMP, 'CH', '대본') + path.sep };
const chOther = { name: '라', scriptFolder: path.join(TMP, 'other') };
ok(!IB.pickChannel(sp, [chOther]).ok && IB.pickChannel(sp, [chOther]).reason === '채널 없음', '[4] 품는 채널 없음 = 채널 없음');
ok(IB.pickChannel(sp, [chA, chOther]).preset.name === '가', '하나 = 그 채널');
ok(IB.pickChannel(sp, [chA, chDeep]).preset.name === '나', '겹치면 가장 깊은 대본 폴더');
const tie = IB.pickChannel(sp, [chA, chDeep, chSame]);
ok(!tie.ok && tie.reason === '채널 둘 이상' && /나/.test(tie.detail) && /다/.test(tie.detail), '같은 폴더(대소문자·끝 \\ 무시)를 둘이 쓰면 채널 둘 이상');
ok(!IB.pickChannel(path.join(TMP, 'chX', 'a.md'), [chA]).ok, '이름만 비슷한 폴더(chX)는 품지 않는다');

ok(IB.thumbAOf({ thumbnails: ['x_B.png', 'y_썸네일_A.png'] }) === 'y_썸네일_A.png' && IB.thumbAOf({ thumbnails: ['p.A.png'] }) === 'p.A.png' && IB.thumbAOf({ thumbnails: ['first.png', 'b.B.png'] }) === 'first.png' && IB.thumbAOf({}) === null, '썸네일 A 고르기(_A · .A · 없으면 첫째)');

// [5] 거절 사유 — 순서: 대본 → 채널 → 패키징·썸네일 → 큐 → 만들었음
const pack = w(path.join(TMP, 'ch', '패키징', '2026_11', '[테_1123] 좋은 편.md'), '# p\n');
const thA = w(path.join(TMP, 'thumbs', '[테_1123] 썸네일_A.png'), 'x');
const D = (o = {}) => ({ channels: [chA], inQueue: () => false, isMade: () => false, packStatus: () => ({ ok: true, missing: [] }), ...o });
const N = (o = {}) => ({ ...good, packaging: pack, thumbnails: [thA], ...o });
ok(IB.checkNote(N(), D()).ok && IB.checkNote(N(), D()).preset.name === '가' && IB.checkNote(N(), D()).key === '테_1123', '[5] 다 있으면 받는다(채널·열쇠)');
ok(IB.checkNote(N({ script: sp.replace('좋은', '없는') }), D()).reason === '대본 파일 없음', '대본 파일 없음');
ok(IB.checkNote(N(), D({ channels: [chOther] })).reason === '채널 없음', '채널 없음');
ok(IB.checkNote(N(), D({ channels: [chDeep, chSame] })).reason === '채널 둘 이상', '채널 둘 이상');
const rp = IB.checkNote(N({ packaging: pack + 'x' }), D());
ok(rp.reason === '패키징 미완' && /패키징 파일 없음/.test(rp.detail), '쪽지의 패키징 파일 없음 = 패키징 미완');
const rt = IB.checkNote(N({ thumbnails: [thA.replace('_A', '_Q')] }), D());
ok(rt.reason === '패키징 미완' && /썸네일 A 없음/.test(rt.detail), '쪽지의 썸네일 A 없음 = 패키징 미완');
const rs = IB.checkNote(N(), D({ packStatus: () => ({ ok: false, missing: ['고정댓글', '썸네일 그림 A'] }) }));
ok(rs.reason === '패키징 미완' && /고정댓글·썸네일 그림 A/.test(rs.detail), '패키징 판정(today-scripts) 미완 = 패키징 미완 + 빠진 것');
ok(IB.checkNote(N({ packaging: undefined, thumbnails: undefined }), D()).ok, '쪽지에 경로가 없어도 판정 한 곳(packStatus)이 통과면 받는다');
ok(IB.checkNote(N(), D({ inQueue: () => true })).reason === '이미 큐에 있음', '이미 큐에 있음');
ok(IB.checkNote(N(), D({ isMade: () => true })).reason === '이미 만들었음', '이미 만들었음');
// [5b] ⬆ kind "upload" — 이미 만든 MP4 만 올린다(v1.0.66) · 「이미 만들었음」·패키징은 보지 않는다
{ const mp4 = w(path.join(TMP, 'up', '[테_1123] 좋은 편.mp4'), 'x');
  const chU = { ...chA, ytChannelId: 'UCxyz' };
  const UD = (o = {}) => ({ channels: [chU], busy: () => false, mp4Of: () => mp4, ...o });
  const UN = (o = {}) => ({ ver: 1, kind: 'upload', script: sp, ...o });
  ok(IB.validateNote(UN()) === '', '[5b] kind "upload" 쪽지 꼴 통과');
  const u1 = IB.checkUploadNote(UN(), UD());
  ok(u1.ok && u1.preset.name === '가' && u1.key === '테_1123' && u1.mp4 === mp4, '업로드 쪽지 받음(채널·열쇠·MP4)');
  ok(IB.checkUploadNote(UN({ script: sp.replace('좋은', '없는') }), UD()).reason === '대본 파일 없음', '업로드 — 대본 파일 없음');
  ok(IB.checkUploadNote(UN(), UD({ channels: [chA] })).reason === '업로드채널 없음', '업로드 — 채널에 업로드채널 없으면 거절');
  ok(IB.checkUploadNote(UN(), UD({ channels: [{ ...chA, ytChannelId: ' ' }] })).reason === '업로드채널 없음', '업로드 — 빈칸 업로드채널 = 없음');
  ok(IB.checkUploadNote(UN(), UD({ mp4Of: () => mp4 + 'x' })).reason === 'MP4 없음', '업로드 — MP4 없으면 거절(다시 만들지 않는다)');
  ok(IB.checkUploadNote(UN(), UD({ busy: () => true })).reason === '이미 큐에 있음', '업로드 — 만들거나 올리는 중이면 거절');
  ok(IB.checkUploadNote(UN(), UD({ allow: ['01_로이의고전이야기'] })).reason === '시범 채널 아님', '업로드 — 받을 채널 밖이면 거절'); }
const np = IB.checkNote(N(), D({ allow: ['01_로이의고전이야기'] }));
ok(np.reason === '시범 채널 아님' && /가/.test(np.detail), '받을 채널 목록에 없으면 = 시범 채널 아님 — ' + np.detail);
ok(IB.checkNote(N(), D({ allow: ['가'] })).ok && IB.checkNote(N({ packaging: pack + 'x' }), D({ allow: ['라'] })).reason === '시범 채널 아님', '목록에 있으면 받는다 · 시범 판정이 패키징보다 먼저');
ok(IB.checkNote(N(), D({ inQueue: () => true, packStatus: () => ({ ok: false, missing: ['x'] }) })).reason === '패키징 미완', '패키징 미완이 큐보다 먼저');

// [6] 옮기기
const fA = w(path.join(ibx, '[테_1123]_1.json'), JSON.stringify(good));
const doing = IB.moveNote(fA, IB.SUB.doing, { priming: { channel: '가' } });
ok(!fs.existsSync(fA) && path.basename(path.dirname(doing)) === '진행중' && JSON.parse(fs.readFileSync(doing, 'utf8')).priming.channel === '가', '[6] 진행중으로 옮기며 내용을 더한다');
const fA2 = w(path.join(ibx, '[테_1123]_1.json'), JSON.stringify(good));
const rej = IB.moveNote(fA2, IB.SUB.reject, { reason: '이미 큐에 있음' });
ok(path.basename(path.dirname(rej)) === '거절' && JSON.parse(fs.readFileSync(rej, 'utf8')).reason === '이미 큐에 있음' && JSON.parse(fs.readFileSync(rej, 'utf8')).script === sp, '거절 = 원래 칸 + reason');
const fA3 = w(path.join(ibx, '[테_1123]_1.json'), 'not json');
const rej2 = IB.moveNote(fA3, IB.SUB.reject, { reason: '꼴 오류' });
ok(/_2\.json$/.test(rej2) && JSON.parse(fs.readFileSync(rej2, 'utf8')).원문 === 'not json', '같은 이름이면 _2 · 깨진 쪽지는 원문을 담는다');
const done = IB.finishNote(doing, IB.SUB.done, { result: '성공' });
ok(path.dirname(done) === path.join(ibx, '처리됨') && !fs.existsSync(doing) && JSON.parse(fs.readFileSync(done, 'utf8')).result === '성공', '진행중 → 처리됨(inbox 바로 아래)');

// [7] 멈춤 상태
ok(IB.loadState().paused === false, '[7] 기본 = 멈춤 아님');
ok(JSON.stringify(IB.loadState().allowChannels) === JSON.stringify(['01_로이의고전이야기']), '받을 채널 기본 = 고전 하나(시범)');
IB.saveState({ paused: true }); ok(IB.loadState().paused === true, '멈춤 저장·읽기');
IB.saveState({ paused: false }); ok(IB.loadState().paused === false, '풀기');
IB.saveState({ allowChannels: ['가', '나'] }); IB.saveState({ paused: true });
ok(IB.loadState().paused === true && IB.loadState().allowChannels.join() === '가,나', '멈춤을 저장해도 받을 채널 목록은 그대로');
IB.saveState({ paused: false, allowChannels: ['01_로이의고전이야기'] });
ok(IB.channelAllowed('01_로이의고전이야기') && !IB.channelAllowed('04_역사이야기') && IB.channelAllowed('04_역사이야기', ['*']) && !IB.channelAllowed('x', []), '받을 채널 판정(기본 · "*" = 전 채널 · 빈 목록 = 없음)');
ok(IB.stateFile().startsWith(process.env.PM_INBOX_HOME), '시험은 임시 폴더(로이 설정 불변)');
{ const save = process.env.PM_UI_SMOKE; delete process.env.PM_UI_SMOKE; ok(IB.inboxDir() === path.join(os.homedir(), '.priming-maker', 'inbox'), 'PM_UI_SMOKE 가 없으면 PM_INBOX_HOME 을 무시(홈\\.priming-maker\\inbox)'); process.env.PM_UI_SMOKE = save; }

// [8] 채널 설정값
const o1 = IB.autoItemOpts({ name: '가', imgEngine: 'comfy', styleLong: 'ink', outTarget: 'mp4', split: { longLen: 18 } });
ok(o1.imgEngine === 'kie:qwen-2-1' && o1.videoEngine === 'none' && o1.ov.styleId === 'ink' && o1.ov.outTarget === 'mp4' && o1.ov.captionMaxChars === 18, '[8] 옛 이미지 도구 → AI 이미지 · 비디오 없으면 「없음」 · 스타일·완성·자막 글자 = 채널 — ' + JSON.stringify(o1));
ok(IB.autoItemOpts({ name: '가', videoEngine: 'grok' }).videoEngine === 'none' && IB.autoItemOpts({ name: '가', videoEngine: 'kie:minimax-h3' }).videoEngine === 'kie:minimax-h3' && IB.autoItemOpts({ name: '가', videoEngine: 'none' }).ov.videoEngine === 'none', '비디오: 지운 도구 = 없음 · AI 영상 = 그대로 · 「없음」 = 끔');
ok(IB.autoItemOpts({ name: '가', imgEngine: 'local:qwen-2-1' }).imgEngine === 'local:qwen-2-1', '관리자 로컬 Qwen 은 그대로');
// ⬆ 업로드 = 채널 편집의 업로드채널(ytChannelId)이 있으면 'on'(v1.0.66 · 2026-11-19 네 편이 MP4 에서 멈춘 사고) — 옛 값 ytAuto 는 보지 않는다(화면에 칸이 없다)
ok(IB.autoItemOpts({ name: '고전', ytAuto: true, ytChannelId: 'UCaaa', ytPrivacy: 'unlisted' }).uploadAfter === 'on', '[8b] 업로드채널 있음 → uploadAfter on');
ok(IB.autoItemOpts({ name: '일본', ytAuto: false, ytChannelId: 'UCbbb', ytPrivacy: 'unlisted' }).uploadAfter === 'on', '옛 ytAuto false(일본) 여도 업로드채널이 골라져 있으면 on');
ok(IB.autoItemOpts({ name: '가', ytAuto: true }).uploadAfter === 'off' && IB.autoItemOpts({ name: '가', ytChannelId: '  ' }).uploadAfter === 'off' && IB.autoItemOpts({ name: '가' }).uploadAfter === 'off' && IB.autoItemOpts(null).uploadAfter === 'off', '업로드채널 없음·빈칸 → off(ytAuto 만 켜져도 올리지 않는다)');
{ const YS = require(path.join(ROOT, 'core', 'yt-schedule'));
  ok(['unlisted', 'private', 'public', undefined, ''].every((v) => ['unlisted', 'private'].includes(YS.privacyFor({ ytAuto: true, ytPrivacy: v }, null))), '자동 업로드 공개 상태 = 일부공개·비공개뿐(⛔ public)'); }

// [9] progress
const snap = { stages: { tts: { state: 'done' }, image: { state: 'run' }, video: { state: 'wait' }, out: { state: 'wait' } }, sent: { done: 9, total: 9 }, image: { done: 3, total: 12 }, video: { done: 0, total: 0 } };
ok(JSON.stringify(IB.stageOf(snap)) === JSON.stringify({ stage: '그림', done: 3, total: 12 }), '[9] 단계 = 그림 3/12');
ok(IB.stageOf({ stages: { tts: { state: 'done' }, image: { state: 'done' }, video: { state: 'skip' }, out: { state: 'run' } } }).stage === '조립', '조립(진척 없음)');
ok(IB.writeProgress({ current: null, finished: [{ key: '테_1123', result: '성공' }] }) && JSON.parse(fs.readFileSync(IB.progressFile(), 'utf8')).finished[0].key === '테_1123' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(JSON.parse(fs.readFileSync(IB.progressFile(), 'utf8')).at), 'progress.json 쓰기(KST 시각)');
ok(!fs.readdirSync(path.dirname(IB.progressFile())).some((x) => /\.tmp$/.test(x)), '임시 파일이 남지 않는다');

// [10] 소스
const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const B = fs.readFileSync(path.join(ROOT, 'bootstrap.js'), 'utf8');
const rb = M.slice(M.indexOf('function _runBatch('), M.indexOf('// ── 🤖 2.0 무인 제작'));
const iAuto = rb.indexOf('if (common.auto) {'), iDlg = rb.indexOf("title: '🛫 만들기 전 점검'");
ok(iAuto > 0 && iDlg > iAuto && /else if \(!\(process\.env\.PM_UI_SMOKE && common\.dry\)\)/.test(rb.slice(iAuto, iDlg)), '[10] 자동 run 은 「만들기 전 점검」 창 앞에서 갈라진다(묻지 않는다)');
ok(/ipcMain\.handle\('run-batch', \(_e, args = \{\}\) => _runBatch\(/.test(M), '⚡ 만들기(IPC)와 자동 제작이 같은 _runBatch');
ok(/if \(i >= plan\.length\) \{[\s\S]{0,200}args\.extend/.test(rb), '계획이 끝나면 extend 로 이어 받는다');
ok(/uploadAfter: _auto \? _auto\.uploadAfter : \(\(common\.uploadAfter === 'on' \|\| common\.uploadAfter === 'off'\) \? common\.uploadAfter : null\)/.test(rb), '⬆ 자동 제작 = 채널 업로드채널 · 화면 큐 = 헤더 체크박스만(10-14 규칙 그대로)');
{ const tk = M.slice(M.indexOf('async function _inboxTake('), M.indexOf('function _inboxMp4Of('));
  ok(tk.indexOf("r.note.kind === 'upload'") > 0 && tk.indexOf("r.note.kind === 'upload'") < tk.indexOf('IB.checkNote(r.note,'), '⬆ 업로드 쪽지는 만들기 판정(checkNote) 전에 갈라진다');
  // 🔁 redo(v1.0.67) — 「이미 만들었음」만 빼고 checkNote 를 그대로 지난 뒤 prepareRedo · 거절이면 큐에 넣지 않는다 · 「지워짐」 뒤 업로드 기록을 다시 읽는다
  ok(/IB\.checkNote\(r\.note, redo \? \{ \.\.\.deps, isMade: \(\) => false \} : deps\)/.test(tk), '🔁 redo 쪽지 = 「이미 만들었음」만 빼고 같은 checkNote(패키징·큐·시범 채널은 그대로)');
  const iPrep = tk.indexOf('await _inboxRedoPrep('), iMove = tk.indexOf('IB.moveNote(n.file, IB.SUB.doing', tk.indexOf('IB.checkNote(r.note,'));
  ok(iPrep > 0 && iPrep < iMove && /if \(!rp\.ok\) \{ _inboxReject\(n\.file, rp\.reason, rp\.detail\); continue; \}/.test(tk) && /uploaded = _uploadedNames\(\)/.test(tk), '🔁 옛 완성물 정리(prepareRedo)가 진행중으로 옮기기 전 · 실패면 거절');
  const rpf = M.slice(M.indexOf('async function _inboxRedoPrep('), M.indexOf('// 지금 만들거나 올리는 중인 대본인가'));
  ok(/prepareRedo\(\{ scriptPath: sp, files, records, exists: \(ch, v\) => YT\.videoExists\(ch, v\), markGone: \(v\) => YT\.markGone\(v\) \}\)/.test(rpf) && /uploadMp4Path\(base, preset, vrew\)/.test(rpf) && /recordsByName\(base \+ '\.mp4'\)/.test(rpf), '🔁 _inboxRedoPrep = .vrew·업로드 MP4·화이트보드 MP4 + 이 이름 업로드 기록 → prepareRedo 한 곳');
  ok(/for \(const \[k, rec\] of Object\.entries\(all\)\) \{ if \(rec && rec\.gone\) continue;/.test(M.slice(M.indexOf('function _uploadedNames('), M.indexOf('function _scriptMade('))), '🗑 「만들었음」 판정의 업로드 기록에서 지워진 영상(gone)은 뺀다');
  ok(/r\.note\.kind !== 'upload' && uploaded\.has\(/.test(M), '🗑 다시 켤 때 업로드 쪽지는 기록만 보고 끝내지 않는다(관문이 판정)');
  const uo = M.slice(M.indexOf('async function _inboxUploadOnly('), M.indexOf('// 자동으로 만들 계획'));
  ok(uo.length > 200 && !/runMakeAllCore|_runBatch\(|makeRun\(/.test(uo), '업로드만 = 제작 길을 부르지 않는다');
  ok(/made: IB\.kst\(\)[\s\S]{0,200}enqueueYtUpload\(\{[^}]*itemId: it\.id/.test(uo), '업로드만 = rec.made 를 먼저 찍고 그 항목 id 로 업로드 줄(끝나면 쪽지를 처리됨으로)');
  ok(/it\.inbox && !it\.inboxUpload && AUTO\.items\.has/.test(M), '_inboxPlan 은 업로드만 받은 편을 만들지 않는다');
  ok(/r\.note\.kind === 'upload' \? upList : list/.test(M), '앱을 다시 켜면 진행중 업로드 쪽지도 다시 업로드 줄에'); }
{ const rm = M.slice(M.indexOf('async function runMakeAllCore('), M.indexOf('async function runMakeAllCore(') + 4000);
  ok(/preset = \{ \.\.\.preset, ytAuto: uploadAfter === 'on'( && !opts\.noUpload)? \}/.test(rm), 'runMakeAllCore 는 넘겨받은 uploadAfter 만 본다(채널 ytAuto 를 직접 읽지 않는다)'); }
ok(/if \(!opts\.keepView\) WORLD\.setView\('longform'\)/.test(M), '받은 편 열기는 화면 세계를 바꾸지 않는다(keepView)');
ok(!/require\('\.\/core\/inbox'\)/.test(M.slice(0, M.indexOf('function _openScriptEntries'))), 'core/inbox 를 맨 위에서 읽지 않는다(판매판엔 파일이 없다)');
const iLock = B.indexOf('requestSingleInstanceLock'), iUpd = B.indexOf("require('./light-updater').applyUpdates()"), iUD = B.indexOf("app.setPath('userData'");
ok(iLock > iUD && iLock < iUpd, '단일 실행 잠금 = 저장 공간을 정한 뒤 · 업데이트 전(두 번째 실행이 파일을 바꾸지 않게)');
const hf = (B.match(/HEADLESS_FLAGS = \[([^\]]*)\]/) || [])[1] || '';
ok(hf && !/inbox/.test(hf), '--inbox 는 무인 실행(PM_HEADLESS) 표시가 아니다');
ok(/global\.__pmOnSecond/.test(B) && /global\.__pmOnSecond = /.test(M), '두 번째 실행의 명령줄을 켜진 앱에 넘긴다');
ok(/ipcMain\.handle\('abort'[\s\S]{0,500}AUTO\.hold = '■ 중단'/.test(M), '■ 중단은 받은 편 자동 제작도 보류한다(사람이 만들던 큐를 멈춘 뒤 받은 편이 저절로 시작하지 않게)');
ok(/WORLD\.run\('longform', \(\) => _runBatch\(/.test(M), '자동 제작은 롱폼 세계에서 돈다(로이가 출판 화면을 보고 있어도)');
const ED = require('../core/edition');
ok(ED.fileFeature('core/inbox.js') === 'inbox' && !ED.has('inbox', 'member') && ED.channelFeature('inbox-state') === 'inbox', '판매판엔 받은 편지함이 없다(파일·IPC)');

// [11] 🔁 render + redo — 고친 대본 다시 만들기(v1.0.67) · core/inbox.prepareRedo
(async () => {
  ok(IB.validateNote({ ...good, redo: true }) === '' && /redo/.test(IB.validateNote({ ...good, redo: 'yes' })) && /render/.test(IB.validateNote({ ver: 1, kind: 'upload', script: sp, redo: true })), '[11] redo 꼴 — true/false · render 에만');
  const R = path.join(TMP, 'redo');
  const rs = w(path.join(R, '대본', '[역_1124] 최영.md'), '# 고친 대본\n');
  const out = path.join(R, '출력', '[역_1124] 최영'), up = path.join(R, '올림');
  const mk = (p, t) => { w(p, 'old'); fs.utimesSync(p, t / 1000, t / 1000); return p; };
  const T0 = Date.now() - 3 * 86400e3;
  const vrew = mk(path.join(out, '[역_1124] 최영.vrew'), T0), mp4 = mk(path.join(up, '[역_1124] 최영.mp4'), T0 + 60e3);
  const wbNone = path.join(up, '[역_1124] 최영_whiteboard.mp4');
  const marked = [];
  const RD = (o = {}) => ({ scriptPath: rs, files: [vrew, mp4, wbNone], records: [], exists: async () => ({ ok: true, exists: false }), markGone: (v) => marked.push(v), now: Date.parse('2026-11-19T12:30:00Z'), ...o });
  // 대본이 옛 완성물보다 오래됐으면 거절(옮기지 않는다)
  fs.utimesSync(rs, (T0 + 30e3) / 1000, (T0 + 30e3) / 1000);
  let r = await IB.prepareRedo(RD());
  ok(!r.ok && r.reason === '대본이 MP4 보다 새롭지 않음' && fs.existsSync(vrew) && fs.existsSync(mp4), '대본이 MP4 보다 오래됐으면 거절 · 아무것도 옮기지 않는다');
  fs.utimesSync(rs, Date.now() / 1000, Date.now() / 1000);
  // 유튜브에 아직 있으면 · 확인이 안 되면 거절(fail-closed) — 기록에 표시하지 않는다
  r = await IB.prepareRedo(RD({ records: [{ channelId: 'UC', videoId: 'V_LIVE' }], exists: async () => ({ ok: true, exists: true }) }));
  ok(!r.ok && r.reason === '유튜브에 아직 있음' && /V_LIVE/.test(r.detail) && !marked.length && fs.existsSync(mp4), '유튜브에 아직 있으면 거절(두 편이 된다)');
  r = await IB.prepareRedo(RD({ records: [{ channelId: 'UC', videoId: 'V_X' }], exists: async () => ({ ok: false, error: 'boom' }) }));
  ok(!r.ok && r.reason === '유튜브 확인 실패' && !marked.length && fs.existsSync(mp4), '확인이 안 되면 거절(fail-closed)');
  // 통과 — 지워진 영상에 「지워짐」 · 옛 .vrew·MP4 를 그 폴더 _구판\<KST> 로 옮긴다(지우지 않는다)
  r = await IB.prepareRedo(RD({ records: [{ channelId: 'UC', videoId: 'clnAyPeV3as' }] }));
  const vTo = path.join(out, '_구판', '20261119-2130', '[역_1124] 최영.vrew'), mTo = path.join(up, '_구판', '20261119-2130', '[역_1124] 최영.mp4');
  ok(r.ok && r.moved.length === 2 && r.gone[0] === 'clnAyPeV3as' && marked[0] === 'clnAyPeV3as', '통과 — 옛 완성물 2개 옮김 · 지워진 영상 기록에 표시');
  ok(!fs.existsSync(vrew) && !fs.existsSync(mp4) && fs.readFileSync(vTo, 'utf8') === 'old' && fs.readFileSync(mTo, 'utf8') === 'old', '옛 파일은 _구판\\<KST 시각>\\ 에 그대로(⛔ 지우지 않는다)');
  // 옛 완성물이 없으면(이미 치웠음) 업로드 기록만 정리하고 통과
  r = await IB.prepareRedo(RD({ records: [] }));
  ok(r.ok && r.moved.length === 0, '옛 완성물이 없으면 옮길 것 없이 통과');
  // 같은 시각에 또 옮기면 _2
  mk(vrew, T0);
  r = await IB.prepareRedo(RD());
  ok(r.ok && fs.existsSync(path.join(out, '_구판', '20261119-2130', '[역_1124] 최영_2.vrew')), '같은 자리에 구판이 있으면 _2 로(덮지 않는다)');
  // 하나라도 못 옮기면 옮긴 것을 되돌리고 거절
  mk(vrew, T0); mk(mp4, T0);
  const blocker = path.join(up, '_구판'); fs.rmSync(blocker, { recursive: true, force: true }); w(blocker, 'file');   // _구판 자리에 파일 → 폴더를 못 만든다
  r = await IB.prepareRedo(RD());
  ok(!r.ok && r.reason === '구판 옮기기 실패' && fs.existsSync(vrew) && fs.existsSync(mp4), '하나라도 못 옮기면 옮긴 것을 되돌리고 거절');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${bad ? '❌' : '✅'} 받은 편지함 단위 ${n - bad}/${n}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌', e); process.exit(1); });
