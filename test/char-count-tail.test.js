'use strict';
/**
 * node test/char-count-tail.test.js — 📏 대본 H1 뒤 글자 수 표기(`# 제목 / 15,761 자`)가 새지 않는지.
 *
 * 2026-09-26 아도나이로이 로이 지정: 모든 채널 대본의 첫 줄을 `# 제목 / N 자` 로 쓴다.
 * 🔑 붙여도 **낭독·그룹·문장은 한 글자도 달라지면 안 되고**, 제목을 쓰는 곳(파일 제목 · 챕터 ·
 *    대본 읽기 · 업로드 폴백 제목)에는 꼬리가 없어야 한다.
 */
const path = require('path');
const { parseLongform } = require(path.join(__dirname, '..', 'core', 'parsers', 'longform-parser'));
const { stripCharCountTail } = require(path.join(__dirname, '..', 'core', 'sentence-splitter'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const body = [
  '> 🎯 메모 줄',
  '',
  '## 도입부',
  '',
  '### 샷 1',
  '> 🖼️ 이미지: a quiet street',
  '',
  '첫 문장입니다. 두 번째 문장이죠.',
  '',
  '## 1장 — 본론',
  '',
  '### 장면 1',
  '> 🖼️ 이미지: a room',
  '',
  '본론 문장입니다. 그리고 끝났습니다.',
  '',
].join('\n');
const plain = '# 수원 화성 쌓은 장인들\n' + body;
const tailed = '# 수원 화성 쌓은 장인들 / 15,761 자\n' + body;

const ra = parseLongform(plain, 'fallback');
const rb = parseLongform(tailed, 'fallback');
const a = ra.projects[0], b = rb.projects[0];

console.log('[1] 제목에서 꼬리를 뗀다');
ok(b.title === '수원 화성 쌓은 장인들', `proj.title = 「${b.title}」`);
ok(b.fileTitle === '수원 화성 쌓은 장인들' && rb.fileTitle === '수원 화성 쌓은 장인들', `fileTitle = 「${rb.fileTitle}」`);

console.log('[2] 낭독은 한 글자도 달라지지 않는다');
const txt = (p) => JSON.stringify((p.sentences || []).map((s) => s.text || s.orig || s));
ok(txt(a) === txt(b), `문장 ${b.sentences.length}개 동일`);
ok(!txt(b).includes('15,761'), '글자 수가 낭독 문장에 들어가지 않는다');
ok(a.groups.length === b.groups.length, `그룹 ${b.groups.length}개 동일`);

console.log('[3] 꼬리 식');
ok(stripCharCountTail('제목 / 13,000 자') === '제목', '「/ 13,000 자」');
ok(stripCharCountTail('제목 /13000자') === '제목', '「/13000자」 붙여 써도');
ok(stripCharCountTail('1/2 자리의 비밀') === '1/2 자리의 비밀', '제목 가운데의 「/」·「자」는 건드리지 않는다');
ok(stripCharCountTail('왕이 된 자') === '왕이 된 자', '「자」로 끝나는 제목은 그대로(숫자·슬래시가 없으면)');

console.log('[4] 업로드 폴백 제목');
const src = require('fs').readFileSync(path.join(__dirname, '..', 'core', 'yt-packaging.js'), 'utf8');
ok(/\\s\*\\\/\\s\*\[\\d,\]\+\\s\*자\\s\*\$/.test(src), 'yt-packaging strip 이 글자 수 꼬리를 뗀다(패키징 제목이 빠진 편 대비)');

console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
process.exit(fail ? 1 : 0);
