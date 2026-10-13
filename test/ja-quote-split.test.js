'use strict';
/**
 * node test/ja-quote-split.test.js — 🇯🇵 일본어 인용 뒤 이어지는 글(「…。」と言った)을 한 문장으로 (v0.9.7)
 *   · 2026-10-14 銀河鉄道の夜 실측: 「ではカムパネルラさん。」と名指しました。 가 「と名指しました。」(1.3초 · 역대조 71%)로 떨어졌다
 *   · 화자 줄([朗読])·루비 표식과 겹치지 않는가 · 인용만 있는 줄·연속 인용·긴 인용 · 한국어는 그대로
 */
const fs = require('fs'), path = require('path'), os = require('os');
const S = require('../core/sentence-splitter');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const sp = (t) => S.splitIntoSentences(t);
const J = (a) => JSON.stringify(a);

console.log('[1] 인용 뒤 이어지는 글');
ok(J(sp('「ではカムパネルラさん。」と名指しました。')) === J(['ではカムパネルラさん。と名指しました。']), '「…。」と名指しました。 = 한 문장');
ok(J(sp('急いで「では。よし。」と云いながら、自分で星図を指しました。')) === J(['急いでは。よし。と云いながら、自分で星図を指しました。'.replace('急いでは', '急いででは')]), '짧은 인용 안 부호 모두 보호(では。よし。)');
ok(J(sp('「いいえ。」って言ったの。')) === J(['いいえ。って言ったの。']), '」って');
ok(J(sp('「そうか。」、と彼は言った。')) === J(['そうか。、と彼は言った。']), '」、と');
ok(J(sp('『ほんとうか？』と聞いた。')) === J(['ほんとうか？と聞いた。']), '『…？』と');

console.log('\n[2] 문장이 끝나는 인용은 그대로');
ok(J(sp('「ジョバンニさん。あなたはわかっているのでしょう。」')) === J(['ジョバンニさん。', 'あなたはわかっているのでしょう。']), '인용만 있는 줄은 안의 。 에서 나눈다');
ok(J(sp('「行こう。」「うん。」')) === J(['行こう。', 'うん。']), '연속 인용은 둘');
ok(J(sp('「それは。」。次の文。')) === J(['それは。。', '次の文。']), '」 뒤가 。 이면 끝');
ok(J(sp('「待って。」\n\n次の段落です。')) === J(['待って。', '次の段落です。']), '」 뒤가 줄 끝이면 끝');

console.log('\n[3] 긴 인용 — 마지막 부호만');
{
  const a = 'あ'.repeat(30), b = 'い'.repeat(40);
  ok(J(sp(`「${a}。${b}。」と言った。`)) === J([a + '。', b + '。と言った。']), '60자 넘는 인용은 마지막 문장만 이어 붙인다');
}

console.log('\n[4] 루비·화자 줄과 함께');
{
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'jaq-'));
  const md = path.join(T, 'ja.md');
  fs.writeFileSync(md, '# t\n\n## 本編\n\n### 1\n\n[朗読] 先生は眼《め》を向けて、「ではカムパネルラさん。」と名指しました。\n[室主] 「では。よし。」と云《い》いながら、星図を指《さ》しました。\n', 'utf8');
  const P = require('../core/pipeline');
  const parsed = P.parseScript(md);
  const ss = (parsed.projects ? parsed.projects[0] : parsed).sentences;
  ok(ss.length === 2, '두 줄 = 두 문장 (' + ss.length + ')');
  ok(ss[0].speaker === '朗読' && ss[0].text === '先生は眼を向けて、ではカムパネルラさん。と名指しました。' && ss[0].ttsText === '先生はめを向けて、ではカムパネルラさん。と名指しました。', '[朗読] 줄 — 자막은 한자 · 읽기는 루비 (' + ss[0].text + ' / ' + ss[0].ttsText + ')');
  ok(ss[1].speaker === '室主' && ss[1].text === 'では。よし。と云いながら、星図を指しました。' && ss[1].ttsText === 'では。よし。といいながら、星図をさしました。', '[室主] 줄 — 인용 보호와 루비가 겹치지 않는다 (' + ss[1].ttsText + ')');
  ok(!ss.some((s) => /[\uE000-\uF8FF]/.test(s.text + (s.ttsText || ''))), '표식 글자가 남지 않는다');
  try { fs.rmSync(T, { recursive: true, force: true }); } catch (_) {}
}

console.log('\n[5] 한국어는 그대로');
ok(J(sp('그는 "좋다."라고 말했다. 다음 문장.')) === J(['그는 좋다.', '라고 말했다.', '다음 문장.']), '한국어 따옴표 규칙 불변(옛 동작)');
ok(J(sp('오늘은 「안녕。」라고 했다. 다음.')) === J(['오늘은 안녕。', '라고 했다.', '다음.']), '한글이 든 줄은 보호하지 않는다');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'sentence-splitter.js'), 'utf8');
  ok(/const _PROT = \{ '。': '\\uE010'/.test(src) && !/[\uE010-\uE012]/.test(src), '보호 표식은 \\uE010~2(루비 \\uE000~2 와 겹치지 않음) · 소스에 날글자 없음');
}
console.log(`\n${fail ? '❌' : '✅'} ja-quote-split ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
