'use strict';
/**
 * node lab-vrew-compare.js <Priming 이 만든.vrew> <Vrew 4.7.2 로 다시 저장한.vrew> — 🔁 .vrew 왕복 점검 (Lab · 차이표 #8)
 *   두 파일은 **읽기만** 한다. Vrew 가 다시 저장하면서 무엇을 바꿨는지(버전·클립·자막 글자·트랙·파일)를 한 화면에 보인다.
 *   그리고 Priming 의 읽는 쪽(core/vrew-audio.readVrewClips)이 다시 저장한 파일도 읽는지 본다.
 *   판정: ✅ 같음 · ⚠ 달라짐(정보) · ❌ 내용 손실(클립·자막 글자·음성 연결이 줄었다)
 */
const fs = require('fs'), path = require('path');
const AdmZip = require('adm-zip');
const VA = require('./core/vrew-audio');

const [A, B] = process.argv.slice(2);
if (!A || !B || !fs.existsSync(A) || !fs.existsSync(B)) {
  console.error('사용법: node lab-vrew-compare.js <원본.vrew> <다시저장.vrew>'); process.exit(2);
}
function load(f) {
  const z = new AdmZip(f);
  const pj = JSON.parse(z.getEntry('project.json').getData().toString('utf8'));
  const clips = ((pj.transcript || {}).clips) || [];   // vrew-audio.readVrewClips 와 같은 자리
  const words = clips.reduce((n, c) => n + ((c.words || []).length), 0);
  const text = clips.map((c) => { try { return VA.clipText ? VA.clipText(c) : ''; } catch { return ''; } }).join('\n');
  const tracks = {};
  for (const t of Object.values((pj.props && pj.props.tracks) || {})) tracks[t.type || '?'] = (tracks[t.type || '?'] || 0) + 1;
  const ftypes = {};
  for (const fi of pj.files || []) ftypes[fi.type || '?'] = (ftypes[fi.type || '?'] || 0) + 1;
  const media = z.getEntries().filter((e) => /^media\//.test(e.entryName)).length;
  const si = (pj.statistics && pj.statistics.saveInfo) || {};
  return { pj, clips, words, text, tracks, ftypes, media, si, propKeys: Object.keys(pj.props || {}).sort(), topKeys: Object.keys(pj).sort() };
}
const a = load(A), b = load(B);
let bad = 0, warn = 0;
const line = (st, m) => { if (st === '❌') bad++; if (st === '⚠') warn++; console.log(`${st} ${m}`); };
const cmp = (label, x, y, lossIfLess) => {
  const sx = JSON.stringify(x), sy = JSON.stringify(y);
  if (sx === sy) line('✅', `${label}: ${sx}`);
  else line(lossIfLess && typeof x === 'number' && y < x ? '❌' : '⚠', `${label}: ${sx} → ${sy}`);
};
console.log(`원본    : ${path.basename(A)}\n다시저장: ${path.basename(B)}\n`);
cmp('내부 버전(version)', a.pj.version, b.pj.version);
cmp('저장한 Vrew(updated)', a.si.updated && a.si.updated.version, b.si.updated && b.si.updated.version);
cmp('클립 수', a.clips.length, b.clips.length, true);
cmp('어절(words) 수', a.words, b.words, true);
if (a.text === b.text) line('✅', `자막 글자 전체 같음 (${a.text.length}자)`);
else {
  const la = a.text.split('\n'), lb = b.text.split('\n');
  const i = la.findIndex((t, k) => t !== lb[k]);
  line(b.text.length < a.text.length * 0.98 ? '❌' : '⚠', `자막 글자 달라짐 (${a.text.length}자 → ${b.text.length}자) · 처음 다른 클립 #${i + 1}: 「${(la[i] || '').slice(0, 40)}」 → 「${(lb[i] || '').slice(0, 40)}」`);
}
cmp('트랙 종류별 수', a.tracks, b.tracks);
cmp('파일 종류별 수', a.ftypes, b.ftypes);
cmp('zip media/ 파일 수', a.media, b.media, true);
const addTop = b.topKeys.filter((k) => !a.topKeys.includes(k)), delTop = a.topKeys.filter((k) => !b.topKeys.includes(k));
if (addTop.length || delTop.length) line('⚠', `project.json 맨 위 키: +[${addTop}] −[${delTop}]`); else line('✅', 'project.json 맨 위 키 같음');
const addP = b.propKeys.filter((k) => !a.propKeys.includes(k)), delP = a.propKeys.filter((k) => !b.propKeys.includes(k));
if (addP.length || delP.length) line('⚠', `props 키: +[${addP}] −[${delP}]`); else line('✅', 'props 키 같음');
// Priming 의 읽는 쪽이 다시 저장한 파일을 읽는가
try {
  const ra = VA.readVrewClips(A), rb = VA.readVrewClips(B);
  const na = ra.clips.length, nb = rb.clips.length;
  const voiced = (r) => r.clips.filter((c) => c.mediaId && c.entryName).length;
  cmp('Priming 이 읽은 클립(vrew-audio)', na, nb, true);
  cmp('그중 음성이 이어진 클립', voiced(ra), voiced(rb), true);
} catch (e) { line('❌', 'Priming 이 다시 저장한 파일을 못 읽음: ' + e.message); }
console.log(`\n${bad ? '❌ 내용 손실 ' + bad + '건' : '✅ 손실 없음'}${warn ? ` · ⚠ 달라진 점 ${warn}건(정보)` : ''}`);
process.exit(bad ? 1 : 0);
