// 🇯🇵 루비 방식 보강 (v0.9.62) — ① 루비 읽기만 바뀐 문장은 옛 음성을 이어받지 않는다 ② 루비 없는 드문 한자(상용한자표 밖) 경고
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../core/ja-ruby-check');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

console.log('[1] 루비 읽기만 바뀐 대본 — 옛 음성 이어받기 금지');
{
  // 원문 함수를 뽑아 실행(복사본 금지)
  const at = MAIN.indexOf('function snapshotMatchesScript(parsed, snap) {');
  const end = MAIN.indexOf('\n}\n', at);
  const fn = new Function(MAIN.slice(at, end + 2) + '\nreturn snapshotMatchesScript;')();
  const parsedOf = (sents) => ({ projects: [{ shortsNum: 1, groups: [{ num: 1, imagePrompt: '' }], getSentencesOfGroup: () => sents }] });
  const snapOf = (sents) => ({ projects: [{ shortsNum: 1, groups: [{ num: 1, imagePrompt: '', sentences: sents }] }] });
  const now = parsedOf([{ text: '大夫は笑った。', ttsText: 'だゆうは笑った。' }]);
  ok(fn(now, snapOf([{ text: '大夫は笑った。', tt: 'だゆうは笑った。' }])) === true, '글자·루비 읽기가 같으면 작업본 그대로(예전과 같음)');
  ok(fn(now, snapOf([{ text: '大夫は笑った。', tt: 'たいふは笑った。' }])) === false, '화면 글자는 같고 루비 읽기만 다르면 「같은 대본」이 아니다');
  ok(fn(parsedOf([{ text: '안녕하세요.' }]), snapOf([{ text: '안녕하세요.', tt: null }])) === true, '한국어(루비 없음)는 예전 그대로 같다고 본다');
  ok(/if \(\(ss\.tt \|\| null\) !== \(s\.ttsText \|\| null\)\) return;/.test(MAIN), 'overlaySnapshot — 루비 읽기가 바뀐 문장은 음성을 이어받지 않는다');
  const ov = MAIN.slice(MAIN.indexOf('function overlaySnapshot('), MAIN.indexOf('function overlaySnapshot(') + 9000);
  ok(ov.indexOf('ss.tt || null') > ov.indexOf('TTS 복원 skip') && ov.indexOf('ss.tt || null') < ov.indexOf('ttsAudioPath', ov.indexOf('TTS 복원 skip')), '그 검사는 음성 경로를 잇기 전에 있다');
}

console.log('[2] 상용한자표');
ok(R.JOYO.size === 2136, `상용한자 ${R.JOYO.size}자 (2010 개정 · 2,136자)`);
ok(R.JOYO.has('安') && R.JOYO.has('餅') && R.JOYO.has('栃') && R.JOYO.has('亜'), '표 안 글자(安·餅·栃·亜)');
ok(!R.JOYO.has('蓆') && !R.JOYO.has('鷗') && !R.JOYO.has('勺') && !R.JOYO.has('厨'), '표 밖 글자(蓆·鷗·厨) · 2010년에 빠진 勺');

console.log('[3] 루비 없는 드문 한자 찾기');
{
  const S = [
    { num: 1, text: '蓆には刈り取った粟の穂が干してある。', ttsText: '蓆には刈り取ったあわの穂が干してある。' },   // 粟 루비 · 蓆 루비 없음
    { num: 2, text: '蓆を敷いた。', ttsText: 'むしろを敷いた。' },   // 루비 있음 → 안 센다
    { num: 3, text: '弟の厨子王は泣いた。' },                        // 루비 없음 → 厨子王(문맥 덩어리)
    { num: 4, text: '한국어 문장 鷗 은 보지 않는다.' },               // 한국어 → 안 본다
    { num: 5, text: '逃げた厨子王を追った。' },
  ];
  const r = R.rareKanjiWithoutRuby(S);
  const w = Object.fromEntries(r.words.map((x) => [x.word, x]));
  ok(w['蓆'] && w['蓆'].count === 1 && JSON.stringify(w['蓆'].nums) === '[1]', '루비 없는 蓆 은 센다 · 루비 단 문장 2 는 안 센다');
  ok(!w['粟'] && !Object.keys(w).some((k) => k.includes('粟')), '루비가 덮은 粟 은 안 센다');
  ok(w['厨子王'] && w['厨子王'].count === 2 && w['厨子王'].rare === '厨' && JSON.stringify(w['厨子王'].nums) === '[3,5]', '한자 덩어리(厨子王)를 문맥으로 · 표 밖 글자만 rare');
  ok(!Object.keys(w).some((k) => k.includes('鷗')), '한국어 문장은 보지 않는다');
  ok(r.total === 3 && r.words[0].word === '厨子王', `많은 순서 (총 ${r.total}곳)`);
  ok(R.rareKanjiWithoutRuby([{ num: 1, text: '今日は安い。' }]).total === 0, '상용한자뿐이면 0');
  const big = Array.from({ length: 3000 }, (_, i) => ({ num: i + 1, text: '弟の厨子王は蓆の上で泣いた、そして山椒大夫の家を出た。', ttsText: '弟のずしおうは蓆の上で泣いた、そしてさんしょうだゆうの家を出た。' }));
  const t0 = Date.now(); R.rareKanjiWithoutRuby(big); const ms = Date.now() - t0;
  ok(ms < 500, `3,000문장 ${ms}ms (메인 프로세스를 멈추지 않는다)`);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-')), 'r.tsv');
  R.writeRubyTodo(f, r, { title: 't', when: 'w' });
  const L = fs.readFileSync(f, 'utf8').split('\r\n');
  ok(L[0].startsWith('﻿# 루비 확인 목록') && L[1] === '낱말\t표 밖 한자\t횟수\t문장번호\t예문' && L[2].startsWith('厨子王\t厨\t2\t3 5\t'), '목록 TSV(엑셀용 BOM · 칸 순서)');
}

console.log('[4] 연결');
{
  const PL = fs.readFileSync(path.join(__dirname, '..', 'core', 'pipeline.js'), 'utf8');
  const i = PL.indexOf("require('./ja-ruby-check')");
  ok(i > 0 && i < PL.indexOf('for (const s of sentences) {', i) && /루비확인_목록/.test(PL), 'fillTtsList — 합성 루프 전에 검사하고 목록을 쓴다');
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'ja-ruby-check.js'), 'utf8');
  ok(!/require\.main/.test(src) && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(src), 'ja-ruby-check — 렌더러 번들 안전 · 제어문자 없음');
}

console.log(`\n🇯🇵 ja-ruby ${pass}/${pass + fail} ${fail ? '실패' : '통과'}`);
process.exit(fail ? 1 : 0);
