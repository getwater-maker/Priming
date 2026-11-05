'use strict';
// node test/char-sheets.test.js — 👤 캐릭터셋 보기(2.0 덧붙임4 ㊺ · v1.0.25) core/char-sheets 는 읽기만 하고,
//   인물마다 그림 종류(인물 시트 · 얼굴 · 앞으로의 표정/전신)·엔진 표시·장면 배역을 맞게 모으는가.
const fs = require('fs'), os = require('os'), path = require('path');
const CS = require('../core/char-sheets');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'char-sheets-'));
const MD = ['# 시험', '> 🎨 〔일관성 앵커〕 알리사 카드: a young woman of about 25 with short black hair (알리사). 제롬 카드: an old bearded man of about 60 (제롬).', '', '본문'].join('\n');
const proj = {
  shortsNum: 1,
  sentences: [{ id: 's1', text: '알리사가 문을 열었다.' }, { id: 's2', text: '제롬은 말이 없었다.' }, { id: 's3', text: '바람이 불었다.' }, { id: 's4', text: '알리사와 제롬이 마주 앉았다.' }],
  groups: [
    { num: 1, sentenceIds: ['s1'], imagePrompt: 'close-up of a young woman with short black hair opening a door' },
    { num: 2, sentenceIds: ['s2'], imagePrompt: 'medium shot of an old bearded man by the window' },
    { num: 3, sentenceIds: ['s3'], imagePrompt: 'empty courtyard, wind in the trees' },
    { num: 4, sentenceIds: ['s4'], imagePrompt: 'a young woman and an old man sitting at a table' },
  ],
};

// [1] 그림이 없을 때 — 인물·장면은 나오고 안내 글
let r = CS.listCharSheets({ outRoot: TMP, mdText: MD, projects: [proj] });
ok(r.ok && r.cards.length === 2, '[1] 카드 2명: ' + r.cards.map((c) => c.name).join(','));
ok(r.cards.every((c) => c.files.length === 0) && /아직/.test(r.msg), '[1] 시트 없으면 빈 목록 + 안내: ' + r.msg);
ok(JSON.stringify(r.cards.find((c) => c.name === '알리사').scenes) === '[1,4]', '[1] 알리사 장면 = G1·G4: ' + JSON.stringify(r.cards[0].scenes));
ok(JSON.stringify(r.byGroup['1:2']) === '["제롬"]' && !r.byGroup['1:3'], '[1] G2 = 제롬 · 사람 없는 G3 = 없음: ' + JSON.stringify(r.byGroup));
ok((r.byGroup['1:4'] || []).length === 2, '[1] G4 = 둘 다: ' + JSON.stringify(r.byGroup['1:4']));
ok(!fs.existsSync(path.join(TMP, 'characters')), '[1] 읽기만 — characters 폴더를 만들지 않는다');

// [2] 그림 종류·엔진 표시
const D = path.join(TMP, 'characters'); fs.mkdirSync(D);
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
fs.writeFileSync(path.join(D, '알리사.png'), PNG);                       // 인물 시트(앱 · png)
fs.writeFileSync(path.join(D, '알리사.face.png'), PNG);                  // 얼굴 시트 + 지문 = 앱이 그림
fs.writeFileSync(path.join(D, '알리사.face.json'), JSON.stringify({ key: 'x', name: '알리사' }));
fs.writeFileSync(path.join(D, '알리사.expr.png'), PNG);                  // 앞으로의 캐릭터 셋(표정 9칸) + 엔진 옆 파일
fs.writeFileSync(path.join(D, '알리사.expr.json'), JSON.stringify({ engine: '코덱스' }));
fs.writeFileSync(path.join(D, '제롬.face.jpg'), PNG);                    // 지문 없는 얼굴 = 사람이 바꿔 넣음
fs.writeFileSync(path.join(D, '알리사2.png'), PNG);                      // 다른 이름 — 알리사에 섞이면 안 된다
fs.writeFileSync(path.join(D, '알리사.face.json.bak'), 'x');             // 그림 아님
r = CS.listCharSheets({ outRoot: TMP, mdText: MD, projects: [proj] });
const al = r.cards.find((c) => c.name === '알리사'), je = r.cards.find((c) => c.name === '제롬');
ok(al.files.map((f) => f.kind).join(',') === 'sheet,face,expr', '[2] 알리사 = 인물 시트 → 얼굴 → 표정 순: ' + al.files.map((f) => f.kind));
ok(al.files[1].engine === '로컬 Qwen (앱이 그림)' && al.files[2].engine === '코덱스' && al.files[2].label === '표정 9칸', '[2] 엔진 표시(지문 → Qwen · 옆 파일 engine): ' + al.files.map((f) => f.engine).join(' | '));
ok(je.files.length === 1 && je.files[0].engine === '바꿔 넣은 그림', '[2] 지문 없는 얼굴 jpg = 바꿔 넣은 그림');
ok(!al.files.some((f) => /알리사2/.test(f.name)), '[2] 이름이 앞부분만 같은 다른 인물 그림은 섞지 않는다');
ok(r.msg === '', '[2] 그림이 있으면 안내 글 없음');

// [3] 판정력 — 카드 없는 대본
r = CS.listCharSheets({ outRoot: TMP, mdText: '# 카드 없음\n\n본문', projects: [proj] });
ok(r.cards.length === 0 && /카드가 없습니다/.test(r.msg), '[3] 카드 없는 대본 = 빈 목록 + 안내');

// [4] 쓰기 없음 — 소스에 쓰기·지우기 호출이 없다
const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'char-sheets.js'), 'utf8');
ok(!/\b(writeFile|mkdir|rmSync|unlink|rename|copyFile)\w*\(/.test(src), '[4] core/char-sheets 에 쓰기·지우기 호출 0곳');
// [5] main IPC 는 관리자만
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const blk = main.slice(main.indexOf("ipcMain.handle('list-char-sheets'"), main.indexOf("ipcMain.handle('list-char-sheets'") + 400);
ok(/if \(!isOwner\(\)\) return/.test(blk), '[5] list-char-sheets 는 isOwner() 뒤에만');

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${bad ? '❌' : '✅'} char-sheets ${n - bad}/${n}`);
process.exit(bad ? 1 : 0);
