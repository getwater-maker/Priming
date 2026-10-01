// 같은 이름 MP4 가 있으면 묻는다 — 기본 건너뛰기 · 시간 초과 = 건너뛰기 · 「큐 나머지도」 기억
const fs = require('fs'), os = require('os'), path = require('path');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };

const start = main.indexOf('let _mp4DupAll = null;');
const end = main.indexOf('async function renderUploadMp4');
const code = main.slice(start, end);
const mp4 = path.join(os.tmpdir(), 'mp4exists-test.mp4'); fs.writeFileSync(mp4, 'x');

function make(dialogImpl) {
  const calls = [];
  const dialog = { showMessageBox: async (w, o) => { calls.push(o); return dialogImpl(o); } };
  const f = new Function('fs', 'dialog', 'win', 'AbortController', 'setTimeout', 'clearTimeout',
    code + '; return { ask: askMp4Exists, reset: () => { _mp4DupAll = null; }, getAll: () => _mp4DupAll };');
  return { ...f(fs, dialog, {}, AbortController, setTimeout, clearTimeout), calls };
}
(async () => {
  let t = make(() => ({ response: 0, checkboxChecked: false }));
  ok(await t.ask('A', mp4) === 'skip', '건너뛰기 선택');
  ok(t.calls[0].buttons[0] === '건너뛰기' && t.calls[0].defaultId === 0 && t.calls[0].cancelId === 0, '기본 = 건너뛰기');
  ok(/60초/.test(t.calls[0].detail) && t.calls[0].signal, '60초 시간 제한 + signal');
  ok(await t.ask('B', mp4) === 'skip' && t.calls.length === 2, '체크 안 하면 매번 묻는다');

  t = make(() => ({ response: 1, checkboxChecked: false }));
  ok(await t.ask('A', mp4) === 'redo', '다시 만들기 선택');

  t = make(() => ({ response: 1, checkboxChecked: true }));
  ok(await t.ask('A', mp4) === 'redo' && t.getAll() === 'redo', '나머지도 같게(다시 만들기)');
  ok(await t.ask('B', mp4) === 'redo' && t.calls.length === 1, '다시 묻지 않는다');
  t.reset();
  ok(await t.ask('C', mp4) === 'redo' && t.calls.length === 2, '초기화하면 다시 묻는다');

  t = make(() => ({ response: 0, checkboxChecked: true }));
  await t.ask('A', mp4);
  ok(await t.ask('B', mp4) === 'skip' && t.calls.length === 1, '나머지도 같게(건너뛰기)');

  t = make(() => { throw new Error('창 없음'); });
  ok(await t.ask('A', mp4) === 'skip', '대화상자 실패 = 건너뛰기(fail-safe)');

  // 시간 초과: 대기를 50ms 로 줄인 판으로 signal abort → 건너뛰기
  const f2 = new Function('fs', 'dialog', 'win', 'AbortController', 'setTimeout', 'clearTimeout',
    code.replace('const MP4_DUP_WAIT_MS = 60000;', 'const MP4_DUP_WAIT_MS = 50;') + '; return askMp4Exists;');
  const ask2 = f2(fs, { showMessageBox: async (w, o) => new Promise((res) => o.signal.addEventListener('abort', () => res({ response: 0, checkboxChecked: false }))) }, {}, AbortController, setTimeout, clearTimeout);
  ok(await ask2('A', mp4) === 'skip', '시간 초과 = 건너뛰기');

  // 소스 배선
  ok(/if \(mp4Go && fs\.existsSync\(mp4Path\)\) \{[\s\S]{0,200}askMp4Exists\(pr\.title, mp4Path\) === 'skip'[\s\S]{0,200}continue;/.test(main), '4단계: MP4 있으면 묻고 skip 이면 다음 대본');
  ok(main.indexOf("BF.checkUpToDate({ outRoot") < main.indexOf('askMp4Exists(pr.title'), '지문 판정이 먼저(같은 입력이면 묻지 않는다)');
  ok((main.match(/_mp4DupAll = null;/g) || []).length >= 4, '큐 시작·끝·단건에서 초기화');
  fs.unlinkSync(mp4);
  console.log(`mp4-exists: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
