/**
 * 🎨 채널 화풍 내보내기 검증 — `core/channel-styles.js` 원문을 그대로 실행한다.
 *   목적: 아도나이로이 대시보드(8765)가 읽는 `~/.flow-app/channel-styles.json` 이
 *   **앱이 실제로 이미지 생성에 쓰는 화풍 문자열과 글자까지 같은지**(드리프트 가드).
 *   ⚠ 실제 홈 파일은 건드리지 않는다 — USERPROFILE 을 갈아끼우고 require 캐시를 지운다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let ok = 0, fail = 0;
const chk = (c, label, extra) => {
  if (c) { ok++; console.log('  OK   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const eq = (a, b, label) => chk(JSON.stringify(a) === JSON.stringify(b), label, { got: a, want: b });

const REAL_HOME = os.homedir();
const REAL_EXPORT = path.join(REAL_HOME, '.flow-app', 'channel-styles.json');
const realBefore = fs.existsSync(REAL_EXPORT) ? fs.readFileSync(REAL_EXPORT, 'utf8') : null;

// 가짜 홈으로 모듈을 다시 로드 → EXPORT_PATH 가 임시 폴더를 가리킨다.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chstyle-'));
process.env.USERPROFILE = TMP;
process.env.HOME = TMP;
['../core/channel-styles', '../core/style-store', '../tts/preset-store'].forEach((m) => {
  try { delete require.cache[require.resolve(m)]; } catch (_) {}
});
const CS = require('../core/channel-styles');
const SS = require('../core/style-store');                 // 기본 28개 + (가짜 홈이라) 사용자 0개
if (!CS.EXPORT_PATH.startsWith(TMP)) { console.error('격리 실패: ' + CS.EXPORT_PATH); process.exit(1); }

// 가짜 채널 목록 — preset-store 대신 주입한다(실제 채널 구성에 테스트가 흔들리지 않게).
const presets = [
  { name: '05_성경', group: '성경', styleLong: 'webtoon-illust', styleShort: 'cinematic', styleId: 'chibi' },
  { name: '06_서재', styleLong: 'watercolor', styleShort: 'watercolor', styleThumb: 'photorealistic' },
  { name: '옛채널', styleId: 'ink' },                       // 모드별 값이 없는 오래된 채널
  { name: '깨진채널', styleLong: 'user_없는id_1234' },        // 스타일이 지워진 채널
];
const presetStore = { loadAll: () => presets };
const deps = { presetStore, styleStore: SS, now: new Date('2026-08-21T06:52:42Z') };

console.log('\n[1] 화풍 문자열이 앱이 쓰는 것과 같은가(드리프트 가드)');
{
  const d = CS.build(deps);
  const bible = d.channels.find((c) => c.channel === '05_성경');
  chk(bible.long.prompt === SS.getPrompt('webtoon-illust'), 'long.prompt === style-store.getPrompt (글자까지 같다)');
  chk(bible.long.prompt.includes('attractive good-looking characters'), '기본 스타일의 공통보정 문구가 포함된다(앱이 실제로 보내는 형태)');
  chk(bible.long.styleName === '웹툰 일러스트' && bible.long.isBuiltIn === true, '이름·기본스타일 표시', bible.long);
  chk(d.styles.length === SS.loadAll().length && d.styles.every((s) => s.id && s.prompt), '전체 스타일 목록도 함께 내보낸다(썸네일용 지목에 쓰인다)');
  chk(d.combineRule.includes('plain unmarked surfaces') && d.combineRule.includes('no text'), '조합 규칙을 문서로 함께 내보낸다', d.combineRule);
  const pipe = fs.readFileSync(path.join(__dirname, '..', 'core', 'pipeline.js'), 'utf8');
  chk(pipe.includes("const POS_CLEAN = 'plain unmarked surfaces, clean blank walls'"), '그 규칙의 문구가 pipeline.js 원문과 일치');
}

console.log('\n[2] 모드별 화풍 · 폴백 · 썸네일');
{
  const d = CS.build(deps);
  const by = (n) => d.channels.find((c) => c.channel === n);
  eq([by('05_성경').long.styleId, by('05_성경').short.styleId], ['webtoon-illust', 'cinematic'], '롱폼·쇼츠 화풍이 각각 나온다');
  eq([by('05_성경').long.from, by('05_성경').short.from], ['styleLong', 'styleShort'], '어느 칸에서 온 값인지 표시');
  chk(by('옛채널').long.styleId === 'ink' && by('옛채널').long.from === 'styleId', '모드별 값이 없으면 옛 styleId 로 폴백', by('옛채널').long);
  chk(by('06_서재').thumb.styleId === 'photorealistic' && by('06_서재').thumb.from === 'styleThumb', '썸네일 화풍을 따로 지정할 수 있다');
  chk(by('05_성경').thumb.styleId === 'webtoon-illust' && /폴백/.test(by('05_성경').thumb.from), '지정이 없으면 롱폼 것을 쓰고, 폴백임을 표시한다', by('05_성경').thumb);
  chk(by('05_성경').group === '성경' && by('06_서재').group === '', '그룹도 함께(없으면 빈 문자열)');
}

console.log('\n[3] 스타일이 사라진 채널 — 조용히 빈 값을 내보내지 않는다');
{
  const d = CS.build(deps);
  const b = d.channels.find((c) => c.channel === '깨진채널');
  chk(b.long.missing === true && b.long.prompt === '', 'missing 표시 + 빈 프롬프트(대시보드가 경고할 수 있게)', b.long);
  chk(b.thumb.missing === true, '썸네일 폴백도 같은 상태를 물려받는다');
}

console.log('\n[4] 시각은 KST — UTC 로 적으면 하루 밀린다');
{
  chk(CS.kstNow(new Date('2026-08-21T06:52:42Z')) === '2026-08-21T15:52:42+09:00', '06:52Z → 15:52+09:00');
  chk(CS.kstNow(new Date('2026-08-21T15:00:00Z')) === '2026-08-22T00:00:00+09:00', '밤 15:00Z → 다음 날 00:00 KST (날짜가 넘어간다)');
  chk(/\+09:00$/.test(CS.build(deps).updatedAt), 'updatedAt 에 +09:00 표기');
}

console.log('\n[5] 파일 쓰기 — 원자적 · 안 바뀌면 다시 쓰지 않는다');
{
  const r1 = CS.write(deps);
  chk(r1.ok && r1.changed && r1.rev === 1, '첫 쓰기 rev 1', r1);
  chk(fs.existsSync(CS.EXPORT_PATH), '파일 생성됨');
  chk(!fs.existsSync(CS.EXPORT_PATH + '.tmp'), 'tmp 파일이 남지 않는다(rename 완료)');
  const doc = JSON.parse(fs.readFileSync(CS.EXPORT_PATH, 'utf8'));
  chk(doc.channels.length === presets.length && doc.note.includes('자동'), '읽어도 같은 내용 + 손대지 말라는 안내', { n: doc.channels.length });

  const r2 = CS.write(deps);
  chk(r2.ok && r2.changed === false && r2.rev === 1, '내용이 그대로면 rev 를 올리지 않는다', r2);
  const t1 = fs.statSync(CS.EXPORT_PATH).mtimeMs;

  presets.push({ name: '새채널', styleLong: 'anime' });
  const r3 = CS.write(deps);
  chk(r3.ok && r3.changed && r3.rev === 2, '내용이 바뀌면 rev+1', r3);
  chk(fs.statSync(CS.EXPORT_PATH).mtimeMs >= t1, '파일이 실제로 갱신됨');
  presets.pop();

  const bad = CS.write({ presetStore: { loadAll: () => { throw new Error('스토어 고장'); } }, styleStore: SS });
  chk(bad.ok === false && /고장/.test(bad.error || ''), '스토어가 터져도 예외를 던지지 않는다(채널 저장이 막히면 안 된다)', bad);
}

console.log('\n[6] 앱 배선 — 원문 대조');
{
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  chk(/function exportChannelStyles\(\)/.test(main), 'main.js 에 exportChannelStyles 정의');
  chk(/ipcMain\.handle\('export-channel-styles'/.test(main), '수동 내보내기 IPC');
  // 채널을 고치는 다섯 경로 + 스타일 편집 뒤 + 앱 시작
  for (const [label, needle] of [
    ['채널 설정 저장', '설정 저장`);\n  exportChannelStyles();'],
    ['채널 추가', "기본값'})`);\n  exportChannelStyles();"],
    ['채널 순서 변경', '개)`);\n  exportChannelStyles();'],
    ['채널 이름 변경', '"${newName}"`);\n  exportChannelStyles();'],
    ['채널 삭제', '삭제`);\n  exportChannelStyles();'],
  ]) chk(main.includes(needle), label + ' 직후 내보낸다');
  chk((main.match(/await pushStylesToServer\(\); exportChannelStyles\(\);/g) || []).length === 4, '스타일 추가·수정·삭제·순서 4곳에서 내보낸다');
  chk(/syncStylesFromServer\(true\); \} catch \{\}\n[^\n]*\n\s*try \{ exportChannelStyles\(\); \}/.test(main), '앱 시작 때 **동기화 뒤에** 내보낸다(서버에서 받은 스타일이 반영되게)');

  const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  chk(/exportChannelStyles: \(\) => ipcRenderer\.invoke\('export-channel-styles'\)/.test(pre), 'preload 노출');
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');
  chk(/styleThumb: p\.styleThumb \|\| ''/.test(app), '채널편집이 저장된 썸네일 화풍을 읽는다');
  chk(/styleThumb: ch\.styleThumb \|\| ''/.test(app), '채널편집이 썸네일 화풍을 저장한다');
  chk(/setCh\(\{ \.\.\.ch, styleThumb: e\.target\.value \}\)/.test(app), '썸네일 화풍 select 배선');
  chk(app.includes('channel-styles.json'), '화면에 내보내는 파일 경로를 알려 준다');
}

console.log('\n[7] 실제 홈 파일 무영향');
{
  const after = fs.existsSync(REAL_EXPORT) ? fs.readFileSync(REAL_EXPORT, 'utf8') : null;
  chk(after === realBefore, '실제 ~/.flow-app/channel-styles.json 은 이 테스트로 바뀌지 않았다');
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
process.env.USERPROFILE = REAL_HOME;
process.env.HOME = REAL_HOME;
console.log('\n결과: ' + ok + ' OK / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
