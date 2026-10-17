#!/usr/bin/env node
/**
 * ja-ruby-todo.js — 일본어 대본(.md)에서 「상용한자표 밖인데 루비가 없는 한자」를 뽑는다 (2026-10-17 · v0.9.63)
 *
 *   node "D:\Priming\tools\ja-ruby-todo.js" "<대본.md>" [저장할.tsv]
 *
 * 앱이 TTS 시작 때 내는 경고(core/ja-ruby-check · `루비확인_목록.tsv`)와 **같은 함수**를 쓴다 — 대본을 쓰는 쪽(아도나이로이)이
 * 합성 전에 루비를 보충하려고 만든 입구. 파서도 앱 것(core/pipeline.parseScript)을 그대로 쓴다(루비 표식 해석이 같아야 한다).
 * 저장 경로를 주면 TSV(엑셀용 BOM), 안 주면 화면에 요약 + 낱말 목록.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'core', 'pipeline'));
const R = require(path.join(ROOT, 'core', 'ja-ruby-check'));

const [, , md, out] = process.argv;
if (!md) { console.error('사용: node tools/ja-ruby-todo.js <대본.md> [저장할.tsv]'); process.exit(2); }
const parsed = P.parseScript(md);
const sentences = [];
for (const pr of parsed.projects || []) for (const g of pr.groups || []) for (const s of pr.getSentencesOfGroup(g)) sentences.push(s);
const res = R.rareKanjiWithoutRuby(sentences);
if (out) {
  R.writeRubyTodo(out, res, { title: path.basename(md), when: new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + ' KST' });
  console.log(`루비 없는 표 밖 한자 ${res.total}곳 · 낱말 ${res.words.length}개 → ${out}`);
} else {
  console.log(`문장 ${sentences.length} · 루비 없는 표 밖 한자 ${res.total}곳 · 낱말 ${res.words.length}개`);
  for (const w of res.words) console.log(`${w.word}\t${w.rare}\t${w.count}\t${w.nums.join(' ')}`);
}
