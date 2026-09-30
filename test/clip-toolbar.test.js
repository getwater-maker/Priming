'use strict';
/**
 * node test/clip-toolbar.test.js — 🧩 클립 도구 막대(v0.5.94 · 로이 2026-09-30): 🗑 삭제 · ⧉ 복사 · 📋 붙여넣기 · ⊟ 합치기
 *   main.js 원문(클립 도구 블록 + 음성 잇기)을 뽑아 **실제 .md · 실제 음성 파일**로 돌린다.
 *   기준: 고른 클립만 바뀐다 · 다른 클립의 글·음성·그림은 그대로 · 빈 음성·빈 그림 없음 · 대본은 검증 재파싱 뒤에만.
 */
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const P = require('../core/pipeline');
const CS = require('../core/caption-splitter');
const { parseWav } = require('../core/wav-slice');
const M = read('main.js');

function wavOf(segs, amp = 9000) {
  const sr = 24000; const n = segs.reduce((a, [d]) => a + Math.round(d * sr), 0);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8, 'ascii'); b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36, 'ascii'); b.writeUInt32LE(n * 2, 40);
  let k = 0; for (const [d, on] of segs) for (let i = 0; i < Math.round(d * sr); i++, k++) b.writeInt16LE(on ? Math.round(Math.sin(k / 6) * amp) : 0, 44 + k * 2);
  return b;
}
const dur = (f) => parseWav(fs.readFileSync(f)).durationSec;
const SCRIPT = '# 클립 도구\n## 장\n### ① 첫 장면\n소설 하나가 방 이야기로 시작합니다. 대문에서 세어서 일곱째 칸입니다.\n\n### ② 둘째 장면\n그 방은 가운데가 막혀 두 칸으로 나뉩니다. 다음 문장입니다.\n\n### ③ 셋째 장면\n마지막 문장입니다.\n';

function grabBlock() {
  const fn = (name) => { const i = M.indexOf((M.includes('async function ' + name + '(') ? 'async ' : '') + 'function ' + name + '('); if (i < 0) throw new Error('nf ' + name); return M.slice(i, M.indexOf('\n}\n', i) + 3); };
  const a = M.indexOf('// ── 🧩 클립 도구 막대(v0.5.94'), b = M.indexOf('// ⤒ 그룹 합치기 — 이 그룹을 **앞 그룹에** 합친다');
  if (a < 0 || b < a) throw new Error('block');
  return fn('_looseSig') + fn('_spliceSentenceAudio') + fn('_applyBreaks') + M.slice(a, b);
}
const BLOCK = grabBlock();

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliptb-'));
  const md = path.join(dir, '클립도구.md'); fs.writeFileSync(md, SCRIPT, 'utf8');
  const parsed = P.parseScriptText(SCRIPT, 'longform', {});
  const pr = parsed.projects[0];
  const tts = path.join(dir, 'tts-1'); fs.mkdirSync(tts); const media = path.join(dir, 'media-1'); fs.mkdirSync(media);
  // 문장 3(그 방은 가운데가 / 막혀 …)은 두 덩어리 소리 사이에 쉼
  const shapes = [[[0.2, 0], [1.0, 1], [0.3, 0]], [[0.2, 0], [1.1, 1], [0.3, 0]], [[0.2, 0], [0.8, 1], [0.35, 0], [1.0, 1], [0.3, 0]], [[0.2, 0], [0.6, 1], [0.3, 0]], [[0.2, 0], [0.7, 1], [0.3, 0]]];
  pr.sentences.forEach((s, i) => { const f = path.join(tts, (i + 1) + '.wav'); fs.writeFileSync(f, wavOf(shapes[i] || [[0.5, 1]])); s.ttsAudioPath = f; s.ttsDurationSec = dur(f); });
  pr.groups.forEach((g, i) => { const f = path.join(media, String(i + 1).padStart(2, '0') + '.png'); fs.writeFileSync(f, 'IMG' + (i + 1)); g.imagePath = f; });
  const trashed = [];
  const handlers = {};
  const ctx = { fs, path, console, S: { parsed, scriptPath: md, outRoot: dir, preset: null },
    require: (m) => require(m.startsWith('./') ? path.join(ROOT, m) : m), P: { ...P, toDTO: () => ({}) }, UNDO: { seq: 0 },
    ipcMain: { handle: (n, f) => { handlers[n] = f; } }, enqueueTtsJob: (l, f) => f, gpuBusyReason: () => null, currentDTO: () => ({}),
    currentMode: () => 'longform', presetThresholds: () => ({}), undoPush: () => ({}), undoDrop: () => {}, scriptHash: () => 'h',
    storeActive: () => {}, pushDtoUpdate: () => {}, syncSnapshotNow: () => {}, dtoByReply: () => {}, log: () => {}, prLabel: () => '[t]',
    shortsDirs: () => ({ media, tts }), _inDir: () => true, _toTrash: (f) => trashed.push(f), renumberMediaFiles: () => {},
    resolvePreset: () => null, voiceLabel: () => '', ttsFileOk: (p) => { try { return !!p && fs.statSync(p).size >= 1200; } catch { return false; } } };
  vm.createContext(ctx); vm.runInContext(BLOCK, ctx);
  const before = pr.sentences.map((s) => ({ id: s.id, text: s.text, audio: s.ttsAudioPath, buf: fs.readFileSync(s.ttsAudioPath) }));
  // 화면이 보내는 모양: 문장마다 그 문장의 모든 줄(7자 폭 자동 줄) + 고른 표시
  const linesOf = (s) => { const lt = CS.splitCaptionLines(s.text, 12, s.capBreaks); const out = []; let cur = 0; for (const t of lt) { const at = s.text.indexOf(t, cur); out.push({ from: at, to: at + t.length, t }); cur = at + t.length; } return out; };
  const sentsFor = (picks) => {   // picks = [{ si (편 문장 0부터), lines:[줄 번호…] }]
    return picks.map((p) => { const s = pr.sentences[p.si]; const g = pr.groups.find((x) => x.sentenceIds.includes(s.id)); return { groupNum: g.num, sentIdx: g.sentenceIds.indexOf(s.id), lines: linesOf(s).map((l, k) => ({ from: l.from, to: l.to, sel: p.lines.includes(k) })) }; });
  };
  return { dir, md, pr, handlers, trashed, before, linesOf, sentsFor, tts };
}
const mdText = (t) => fs.readFileSync(t.md, 'utf8');
const same = (t, i, j) => { const b = t.before[i]; const s = t.pr.sentences[j]; return s && s.text === b.text && s.ttsAudioPath === b.audio && fs.readFileSync(s.ttsAudioPath).equals(b.buf); };

(async () => {
  console.log('\n[0] 준비 — 문장 3 「그 방은 가운데가 막혀 두 칸으로 나뉩니다.」 는 줄 두 개');
  { const t = setup(); const L = t.linesOf(t.pr.sentences[2]); ok(L.length === 2 && L[0].t === '그 방은 가운데가' , `줄: ${L.map((l) => '「' + l.t + '」').join(' / ')}`); fs.rmSync(t.dir, { recursive: true, force: true }); }

  console.log('\n[1] 🗑 한 줄(클립) 삭제 — 「그 방은 가운데가」만');
  {
    const t = setup();
    const r = await t.handlers['delete-clips'](null, { shortsNum: 1, sents: t.sentsFor([{ si: 2, lines: [0] }]) });
    ok(r.ok, '삭제 성공 ' + (r.error || ''));
    ok(/### ② 둘째 장면\n막혀 두 칸으로 나뉩니다\. 다음 문장입니다\./.test(mdText(t)), '대본(.md): 그 줄만 빠졌다');
    const s = t.pr.sentences[2];
    ok(s.text === '막혀 두 칸으로 나뉩니다.' && s.ttsAudioPath && fs.existsSync(s.ttsAudioPath), '남은 클립 글·음성 있음');
    ok(s.ttsDurationSec > 1.0 && s.ttsDurationSec < dur(t.before[2].audio) - 0.9, `🔑 음성도 지운 클립만큼 짧아졌다 (${dur(t.before[2].audio).toFixed(2)} → ${s.ttsDurationSec.toFixed(2)}초)`);
    ok(same(t, 0, 0) && same(t, 1, 1) && same(t, 3, 3) && same(t, 4, 4), '🔑 다른 문장 4개의 글·음성 파일은 그대로');
    ok(t.pr.groups.length === 3 && t.trashed.length === 0, '그룹·그림 그대로');
    ok(CS.splitCaptionLines(s.text, 7, s.capBreaks).length === 1, '남은 클립 모양 굳힘(한 줄)');
    fs.rmSync(t.dir, { recursive: true, force: true });
  }

  console.log('\n[2] 🗑 문장 전체 · 그룹 전체 · 모두 삭제 막기');
  {
    const t = setup();
    const r = await t.handlers['delete-clips'](null, { shortsNum: 1, sents: t.sentsFor([{ si: 1, lines: [0, 1, 2] }]) });
    ok(r.ok && t.pr.sentences.length === 4 && !mdText(t).includes('대문에서'), '문장의 줄을 다 지우면 문장째 빠진다');
    ok(t.pr.groups.length === 3 && t.pr.groups[0].sentenceIds.length === 1, 'G1 에는 첫 문장이 남는다(그룹 유지)');
    const r2 = await t.handlers['delete-clips'](null, { shortsNum: 1, sents: t.sentsFor([{ si: 3, lines: [0] }]) });
    ok(r2.ok && t.pr.groups.length === 2 && r2.goneGroups === 1 && t.trashed.length === 1 && /03\.png$/.test(t.trashed[0]), '🔑 그룹의 클립을 모두 지우면 그룹째 사라지고 그 그림은 휴지통(↶ 로 되살림)');
    const all = t.pr.sentences.map((s, i) => ({ si: i, lines: [0, 1, 2, 3] }));
    const r3 = await t.handlers['delete-clips'](null, { shortsNum: 1, sents: t.sentsFor(all) });
    ok(!r3.ok && /모든 클립을 지울 수는 없습니다/.test(r3.error), '모든 클립 삭제는 막는다');
    fs.rmSync(t.dir, { recursive: true, force: true });
  }

  console.log('\n[3] ⧉ 복사 → 📋 붙여넣기');
  {
    const t = setup();
    const c = await t.handlers['copy-clips'](null, { shortsNum: 1, sents: t.sentsFor([{ si: 2, lines: [0] }]) });
    ok(c.ok && c.chunks.length === 1 && c.chunks[0].text === '그 방은 가운데가.' && c.chunks[0].audio && fs.existsSync(c.chunks[0].audio), `복사: 글 「${c.chunks && c.chunks[0].text}」 + 그 구간 음성`);
    ok(c.chunks[0].dur > 0.7 && c.chunks[0].dur < 1.4, `복사한 음성 = 그 클립 부분만 (${c.chunks[0].dur.toFixed(2)}초)`);
    ok(same(t, 2, 2), '복사는 원본을 바꾸지 않는다');
    // G1 마지막 클립 뒤에 붙인다
    const s1 = t.pr.sentences[1]; const L1 = t.linesOf(s1);
    const at = { groupNum: 1, sentIdx: 1, lines: L1.map((l) => ({ from: l.from, to: l.to })), after: L1.length - 1 };
    const p = await t.handlers['paste-clips'](null, { shortsNum: 1, at, chunks: c.chunks });
    ok(p.ok, '붙여넣기 성공 ' + (p.error || ''));
    ok(/대문에서 세어서 일곱째 칸입니다\. 그 방은 가운데가\.\n/.test(mdText(t)), '대본(.md): 고른 클립 뒤에 들어갔다');
    const ns = t.pr.sentences[2];
    ok(ns.text === '그 방은 가운데가.' && t.pr.groups[0].sentenceIds.includes(ns.id), 'G1 에 새 문장으로');
    ok(ns.ttsAudioPath && fs.existsSync(ns.ttsAudioPath) && Math.abs(ns.ttsDurationSec - c.chunks[0].dur) < 0.01, '🔑 붙인 클립에 복사한 음성이 함께');
    ok(same(t, 0, 0) && same(t, 1, 1) && same(t, 2, 3) && same(t, 3, 4) && same(t, 4, 5), '🔑 나머지 문장은 글·음성 그대로(번호만 밀림)');
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
  {
    const t = setup();
    const c = await t.handlers['copy-clips'](null, { shortsNum: 1, sents: t.sentsFor([{ si: 4, lines: [0] }]) });
    const s2 = t.pr.sentences[2]; const L2 = t.linesOf(s2);
    const p = await t.handlers['paste-clips'](null, { shortsNum: 1, at: { groupNum: 2, sentIdx: 0, lines: L2.map((l) => ({ from: l.from, to: l.to })), after: 0 }, chunks: c.chunks });
    ok(p.ok && /그 방은 가운데가\. 마지막 문장입니다\. 막혀 두 칸으로 나뉩니다\./.test(mdText(t)), '줄 가운데에 붙이면 그 문장을 줄 경계에서 나눠 사이에 넣는다');
    const [a, b, cc] = [t.pr.sentences[2], t.pr.sentences[3], t.pr.sentences[4]];
    ok([a, b, cc].every((x) => x.ttsAudioPath && fs.existsSync(x.ttsAudioPath)), '🔑 나뉜 앞·뒤와 붙인 클립 모두 음성 있음');
    ok(Math.abs(a.ttsDurationSec + cc.ttsDurationSec - dur(t.before[2].audio)) < 0.01, '나뉜 앞·뒤 음성 합 = 원래 음성(쉼에서 잘랐다)');
    fs.rmSync(t.dir, { recursive: true, force: true });
  }

  console.log('\n[4] ⊟ 클립 합치기');
  {
    const t = setup();
    // 한 문장 안 두 줄
    const r = await t.handlers['merge-clips'](null, { shortsNum: 1, sents: t.sentsFor([{ si: 2, lines: [0, 1] }]) });
    ok(r.ok && CS.splitCaptionLines(t.pr.sentences[2].text, 7, t.pr.sentences[2].capBreaks).length === 1 && same(t, 2, 2), '한 문장 안 두 클립 → 한 줄로(글·음성 그대로)');
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
  {
    const t = setup();
    // 그룹 경계: G1 마지막 줄 + G2 첫 줄 (로이 화면 그대로)
    const L1 = t.linesOf(t.pr.sentences[1]);
    const r = await t.handlers['merge-clips'](null, { shortsNum: 1, sents: t.sentsFor([{ si: 1, lines: [L1.length - 1] }, { si: 2, lines: [0] }]) });
    ok(r.ok, '그룹 경계 합치기 성공 ' + (r.error || ''));
    const txt = mdText(t);
    ok(/대문에서 세어서 일곱째 칸입니다 그 방은 가운데가\.\n\n### ② 둘째 장면\n막혀 두 칸으로 나뉩니다\./.test(txt), '대본: 3번 클립만 G1 끝으로 · 남은 줄은 G2 에');
    const ns = t.pr.sentences[1], nr = t.pr.sentences[2];
    ok(t.pr.groups[0].sentenceIds.includes(ns.id) && t.pr.groups[1].sentenceIds.includes(nr.id), '합친 클립은 G1(앞 그림) · 남은 클립은 G2(제 그림)');
    const Lm = CS.splitCaptionLines(ns.text, 12, ns.capBreaks);
    ok(Lm[Lm.length - 1].includes('그 방은 가운데가'), `🔑 합친 부분은 한 클립(${Lm.map((x) => '「' + x + '」').join(' / ')})`);
    ok(ns.ttsAudioPath && nr.ttsAudioPath && Math.abs(ns.ttsDurationSec + nr.ttsDurationSec - dur(t.before[1].audio) - dur(t.before[2].audio)) < 0.01, '🔑 음성: 잇고 잘라 합 보존 · 빈 음성 없음');
    ok(same(t, 0, 0) && same(t, 3, 3) && same(t, 4, 4), '다른 문장 그대로');
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
  {
    const t = setup();
    const r = await t.handlers['merge-clips'](null, { shortsNum: 1, sents: t.sentsFor([{ si: 1, lines: [0] }, { si: 3, lines: [0] }]) });
    ok(!r.ok && /이어진 클립만|이웃한 문장/.test(r.error), '떨어진 클립은 합치지 않는다');
    const r2 = await t.handlers['merge-clips'](null, { shortsNum: 1, sents: t.sentsFor([{ si: 1, lines: [0] }]) });
    ok(!r2.ok && /2개 이상/.test(r2.error), '하나만 고르면 합치지 않는다');
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
  {
    const t = setup();   // G2 의 두 문장 전부 + G3 → G3 는 사라지고 G2 그림이 이긴다
    const r = await t.handlers['merge-clips'](null, { shortsNum: 1, sents: t.sentsFor([{ si: 3, lines: [0] }, { si: 4, lines: [0] }]) });
    ok(r.ok && t.pr.groups.length === 2 && t.trashed.some((f) => /03\.png$/.test(f)), '뒤 그룹이 모두 합쳐지면 그 그룹은 사라지고 앞 그룹 그림을 쓴다(합치기 기준)');
    fs.rmSync(t.dir, { recursive: true, force: true });
  }

  console.log(`\n${fail ? '❌' : '✅'} clip-toolbar ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
