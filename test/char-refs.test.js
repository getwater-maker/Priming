// 👤 인물 일관성(core/char-refs) — 카드 읽기(형식 4가지) · 장면 배역 · 시트 찾기 · Gemini 요청에 참조가 실리는지
const fs = require('fs'), os = require('os'), path = require('path');
const CR = require('../core/char-refs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };

// ① 최신 형식(2026-10 · [고전_1021] 앵커 줄 그대로 축약)
const A = '> 🎨 〔일관성 앵커 · 낭독 제외〕 시대 · 지역: 1880년대 프랑스 노르망디(르아브르 근처 · 정원) · 지드 컷은 1900년대 파리. '
  + '알리사 카드: a slender French young woman with dark hair and very high arched eyebrows, a serious pale face (소녀기 열여섯 안팎 · 5장 스물여덟 안팎). '
  + '제롬 카드: a slender French young man with dark hair and a clean-shaven earnest face (소년기 열네 살 안팎). '
  + '지드 카드: a lean French man of about forty with a high forehead, dark moustache (실존 인물이라 상상의 얼굴 가드를 붙인다). 톤: 낮고 느긋한 존댓말.';
const ca = CR.parseCards(A);
ok(ca.map((c) => c.name).join() === '알리사,제롬,지드', '최신 형식 이름 3명: ' + ca.map((c) => c.name));
ok(ca[0].desc === 'a slender French young woman with dark hair and very high arched eyebrows, a serious pale face', '알리사 묘사(괄호 메모·다음 카드 제외): ' + ca[0].desc);
ok(ca[0].gender === 'f' && ca[1].gender === 'm' && ca[2].gender === 'm', '성별');
ok(!/톤|존댓말/.test(ca[2].desc), '마지막 카드 뒤 한국어 문장은 묘사에 안 들어간다');
ok(CR.parseCards('알리사 카드: a woman').length === 0, '> 메타 줄이 아니면 읽지 않는다');

// ② 2026-08 형식(〔이름〕 **male**)
const B = '> 🎨 **[일관성 앵커]** 시대 = 1860s. **인물카드** — 〔표도르 도스토옙스키〕 **male**, 41세→59세, 러시아의 문인(a Russian man of letters); 짙은 턱수염 〔폴리나〕 **female**, 22세 전후, 회색 실크 드레스 ⛔ 현대 금지';
const cb = CR.parseCards(B);
ok(cb.map((c) => c.name).join() === '표도르 도스토옙스키,폴리나', '8월 형식: ' + cb.map((c) => c.name));
ok(cb[0].gender === 'm' && cb[1].gender === 'f' && !/현대/.test(cb[1].desc), '8월 형식 성별·⛔ 꼬리 제거');
// ③ 8월 중순 형식(= 이름(`영어`))
const C = '> 🎨 **[일관성 앵커]** 인물 카드 2명 고정 = 소포클레스(`an elderly Greek man in his eighties, white beard`) / 젊은 여자(`a young Greek woman, plain wool`)';
const cc = CR.parseCards(C);
ok(cc.map((c) => c.name).join() === '소포클레스,젊은 여자' && cc[0].gender === 'm' && cc[1].gender === 'f', '= 형식: ' + cc.map((c) => c.name + c.gender));
// ④ 9월 초 형식(**이름**: 한국어 묘사)
const D = '> 🎨 **[일관성 앵커]** 인물 카드 — **히스클리프**: 사십대 후반의 키 크고 마른 남자, 검은 머리. **캐서린**: 스무 살 안팎의 여자, 갈색 곱슬머리.';
const cd = CR.parseCards(D);
ok(cd.map((c) => c.name).join() === '히스클리프,캐서린' && cd[0].gender === 'm' && cd[1].gender === 'f', '9월 형식(한국어 묘사·성별 단서): ' + cd.map((c) => c.name + c.gender));
ok(CR.parseCards(A + '\n' + A).length === 3, '같은 이름은 한 번만');

// 배역
const W = 'a slender French young woman of about twenty five with her dark hair pulled flat, darning stockings';
const WM = W + ', a French young man of about twenty three in a dark suit standing in the doorway';
ok(CR.castFor('알리사는 양말을 깁고 제롬은 문간에 섰습니다.', WM, ca).map((c) => c.name).sort().join() === '알리사,제롬', '두 사람 다 보이면 둘');
ok(CR.castFor('제롬은 알리사를 떠올립니다.', 'a slender French young man standing before a garden door', ca).map((c) => c.name).join() === '제롬', '그림에 여자가 없으면 이름만 나온 알리사는 안 붙인다');
ok(CR.castFor('그녀는 양말을 깁습니다.', W, ca).length === 0, '이름이 안 나오면 붙이지 않는다');
const two = CR.parseCards('> 앵커. 알리사 카드: a slender French young woman with dark hair and very high arched eyebrows. 쥘리에트 카드: a pretty French young woman with fair hair in a pale festive dress.');
const one = CR.castFor('알리사와 쥘리에트의 이야기입니다.', 'a slender French young woman with dark hair and very high arched eyebrows reading', two);
ok(one.length === 1 && one[0].name === '알리사', '그림 속 여자가 한 명이면 묘사가 맞는 한 명만: ' + one.map((c) => c.name));
const ages = CR.parseCards('> 앵커. 젊은 파스칼 카드: a pale young French man of about nineteen, long dark wavy hair. 만년 파스칼 카드: a gaunt French man of about thirty-nine, grey hair, sunken cheeks.');
const pick = CR.castFor('파스칼은 병상에서 펜을 듭니다.', 'a gaunt French man of about thirty-nine with grey hair and sunken cheeks in bed', ages);
ok(pick.length === 1 && pick[0].name === '만년 파스칼', '같은 사람 여러 카드 = 묘사가 맞는 한 장: ' + pick.map((c) => c.name));
ok(CR.castFor('만년에 그는 떠났다.', 'a gaunt French man of about thirty-nine', ages).length === 0, '꾸밈말(만년)만으로는 찾지 않는다');
const many = CR.parseCards('> 앵커. 가 카드: a tall man. 나 카드: a short man. 다 카드: a thin man. 라 카드: an old man.');
ok(CR.castFor('가 나 다 라', 'a man, a man, a man, a man', many).length === CR.MAX_REFS, '최대 3명');

// 지시문·참조 parts·시트
const dir = CR.directive([ca[0]]);
ok(/age stated in this scene/.test(dir) && /Alissa|알리사/.test(dir) && CR.directive([]) === '', '지시문(나이는 장면을 따른다)');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
ok(CR.findSheet(tmp, ca[0]) === null, '시트 없음');
fs.mkdirSync(CR.sheetDir(tmp), { recursive: true });
fs.writeFileSync(CR.sheetBase(tmp, ca[0]) + '.jpg', Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]));
const sp = CR.findSheet(tmp, ca[0]);
ok(sp && sp.endsWith('알리사.jpg'), '사람이 바꿔 넣은 jpg 를 찾는다');
const parts = CR.refParts([ca[0], ca[1]], (c) => CR.findSheet(tmp, c));
ok(parts.length === 2 && /Reference image of "알리사"/.test(parts[0].text) && parts[1].inlineData.mimeType === 'image/jpeg', '시트 있는 인물만 이름-그림 쌍');
ok(/no text/.test(CR.sheetPrompt('Warm painterly,', ca[0])) && CR.sheetPrompt('Warm painterly,', ca[0]).startsWith('Warm painterly, character reference sheet'), '시트 프롬프트 = 화풍 + 카드');

// Gemini 요청 본문에 참조가 프롬프트 앞에 실리는가(fetch 가로채기)
(async () => {
  const GI = require('../core/gemini-image');
  const realFetch = global.fetch; let sent = null;
  global.fetch = async (_u, o) => { sent = JSON.parse(o.body); return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] }) }; };
  const r = await GI.generateImage({ prompt: 'scene.', key: 'k', model: 'm', refParts: parts });
  const p = sent.contents[0].parts;
  ok(r.ok && p.length === 3 && p[0].text && p[1].inlineData && p[2].text === 'scene.', 'Gemini parts = 참조 쌍 + 프롬프트(맨 뒤)');
  await GI.generateImage({ prompt: 'plain.', key: 'k', model: 'm' });
  ok(sent.contents[0].parts.length === 1, '참조 없으면 예전과 같다');
  global.fetch = realFetch;
  ok(GI.loadConfig().charRefs !== undefined, '설정 기본값 charRefs 있음');
  // main.js 연결(소스 검사) — 즉시 생성 경로가 참조를 넘기고, 배치는 알리기만
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  ok(/_charRefsFor\(imagesDir, logger\)/.test(main) && /refParts \}\);/.test(main), 'runGeminiImages 가 참조를 넘긴다');
  ok(/배치는 인물 참조를 쓰지 않습니다/.test(main), '배치는 안내만');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`char-refs: ${pass} 통과 · ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
