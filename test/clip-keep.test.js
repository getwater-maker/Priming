'use strict';
/**
 * node test/clip-keep.test.js — 🔗 클립 합치기·나누기 기준(2026-09-29 로이 · v0.5.87)
 *   ① 합치기(5+6) — 5번 그림·영상 유지 · 음성은 **둘 다** 순서대로 이어 재생(한 파일로 잇기)
 *   ② 나누기(7 → 여럿) — 7번 그림·영상은 나뉜 모두에 · 음성도 나뉜 글자에 맞춰 쉼에서 잘라 각자에게
 *   ③ 그룹 분할 — 두 그룹 모두 그림·영상 유지(앞 그림을 뒤 그룹 끝까지 이어 깐다) · 빈 그림 없음(게이트 통과)
 *   ④ 🏷 AI 고지 — 채널별 문구 · 나타나는/사라지는 때(시간 또는 클립)
 *   🔑 원문 함수를 뽑아 실제 파일로 돌린다(복사본 금지) · 판정력(A/B) 함께.
 */
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const AS = require('../core/audio-splice');
const { parseWav } = require('../core/wav-slice');
const FF = require('../core/media-utils').getFfmpegPath();

/** 24kHz mono 16bit — segs = [[초, 소리있음?], …] */
function wavOf(segs, amp = 9000) {
  const sr = 24000; const n = segs.reduce((a, [d]) => a + Math.round(d * sr), 0);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(n * 2, 40);
  let k = 0;
  for (const [d, on] of segs) for (let i = 0; i < Math.round(d * sr); i++, k++) b.writeInt16LE(on ? Math.round(Math.sin(k / 6) * amp) : 0, 44 + k * 2);
  return b;
}
const durOf = (f) => parseWav(fs.readFileSync(f)).durationSec;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipkeep-'));
  try {
    console.log('\n[1] 음성 잇기 · 나누기(core/audio-splice)');
    {
      const A = path.join(tmp, 'a.wav'), B = path.join(tmp, 'b.wav');
      fs.writeFileSync(A, wavOf([[0.2, 0], [1.0, 1], [0.3, 0]]));
      fs.writeFileSync(B, wavOf([[0.2, 0], [0.7, 1], [0.3, 0]], 4000));
      const out = path.join(tmp, 'ab.wav');
      const r = await AS.concatAudio([A, B], out);
      ok(Math.abs(r.durationSec - 2.7) < 0.002 && Math.abs(durOf(out) - 2.7) < 0.002, `이어 붙이면 길이 = 두 음성의 합(1.5 + 1.2 = ${r.durationSec.toFixed(3)}초)`);
      const ab = fs.readFileSync(out), a = fs.readFileSync(A), b = fs.readFileSync(B);
      ok(ab.subarray(44, 44 + (a.length - 44)).equals(a.subarray(44)) && ab.subarray(44 + (a.length - 44)).equals(b.subarray(44)), '🔑 앞 문장 소리 → 뒤 문장 소리 순서 그대로(무손실 · 쉼도 그대로)');
      // mp3 도 읽는다(배속이 걸리면 음성이 mp3 다)
      const M = path.join(tmp, 'b.mp3');
      execFileSync(FF, ['-y', '-loglevel', 'error', '-i', B, '-codec:a', 'libmp3lame', '-q:a', '4', M]);
      const r2 = await AS.concatAudio([A, M], path.join(tmp, 'am.wav'));
      ok(Math.abs(r2.durationSec - 2.7) < 0.08, `mp3 와 wav 를 섞어도 잇는다(${r2.durationSec.toFixed(3)}초)`);

      // 나누기 — 소리 1.0초 · 쉼 0.3초 · 소리 0.6초 → 글자 10:6 이면 쉼(1.2~1.5초)에서 자른다
      const S = path.join(tmp, 's.wav');
      fs.writeFileSync(S, wavOf([[0.2, 0], [1.0, 1], [0.3, 0], [0.6, 1], [0.3, 0]]));
      const outs = [path.join(tmp, 's1.wav'), path.join(tmp, 's2.wav')];
      const sp = await AS.splitAudio(S, ['가나다라마바사아자차.', '카타파하아이.'], outs);
      const cut = sp[0].durationSec;
      ok(cut > 1.2 && cut < 1.5, `🔑 쉼 한가운데에서 자른다(자른 곳 ${cut.toFixed(3)}초 · 쉼 1.2~1.5초) — 낱말을 베지 않는다`);
      ok(Math.abs(sp[0].durationSec + sp[1].durationSec - 2.4) < 0.002, '나눈 조각 길이의 합 = 원래 길이(빠지는 소리 없음)');
      // 판정력: 글자 비율이 반대면 다른 쉼을 고른다
      const S3 = path.join(tmp, 's3.wav');
      fs.writeFileSync(S3, wavOf([[0.2, 0], [0.5, 1], [0.3, 0], [0.5, 1], [0.3, 0], [1.0, 1], [0.2, 0]]));
      const c1 = AS.pickCuts(require('../core/wav-slice').envelope(fs.readFileSync(S3), 0.01), 3.0, [2, 6])[0];
      const c2 = AS.pickCuts(require('../core/wav-slice').envelope(fs.readFileSync(S3), 0.01), 3.0, [6, 2])[0];
      ok(c1 > 0.7 && c1 < 1.0 && c2 > 1.5 && c2 < 1.8, `글자 비율에 맞는 쉼을 고른다(2:6 → ${c1.toFixed(2)}초 첫 쉼 · 6:2 → ${c2.toFixed(2)}초 둘째 쉼)`);
      // 쉼이 없으면 가장 조용한 순간(그래도 음성은 나눈다)
      const C = path.join(tmp, 'c.wav'); fs.writeFileSync(C, wavOf([[2.0, 1]]));
      const sc = await AS.splitAudio(C, ['가나다', '라마바'], [path.join(tmp, 'c1.wav'), path.join(tmp, 'c2.wav')]);
      ok(sc.every((x) => x.durationSec > 0.5), '쉼이 없어도 두 조각 모두 음성이 있다(빈 음성 없음)');
    }

    console.log('\n[2] 문장 합치기·나누기 → 음성 이어 붙이기·나누기(main.js _spliceSentenceAudio 원문)');
    {
      const M = read('main.js');
      const i0 = M.indexOf('function _looseSig('), i1 = M.indexOf('\n}\n', M.indexOf('async function _spliceSentenceAudio(')) + 3;
      ok(i0 > 0, '_spliceSentenceAudio 를 찾았다');
      const ctx = { fs, path, require: (m) => require(m.startsWith('./') ? path.join(ROOT, m) : m), P: require('../core/pipeline'), console, UNDO: { seq: 0 } };
      vm.createContext(ctx);
      vm.runInContext(M.slice(i0, i1) + '\nthis.fn = _spliceSentenceAudio;', ctx);
      const td = path.join(tmp, 'tts-1'); fs.mkdirSync(td);
      const w = (n, segs) => { const f = path.join(td, n); fs.writeFileSync(f, wavOf(segs)); return f; };
      // 합치기: 5 + 6 → 5
      const s5 = { num: 5, text: '다섯째 문장입니다.', ttsAudioPath: w('5.wav', [[0.2, 0], [0.8, 1], [0.3, 0]]), ttsDurationSec: 1.3 };
      const s6 = { num: 6, text: '여섯째 문장입니다.', ttsAudioPath: w('6.wav', [[0.2, 0], [0.6, 1], [0.3, 0]]), ttsDurationSec: 1.1 };
      const m = [{ num: 5, text: '다섯째 문장입니다. 여섯째 문장입니다.' }];
      const k1 = await ctx.fn([s5, s6], m, () => {});
      ok(k1 === 'merge' && m[0].ttsAudioPath && fs.existsSync(m[0].ttsAudioPath) && Math.abs(m[0].ttsDurationSec - 2.4) < 0.002, `🔑 합친 문장에 음성이 있다 = 5번 + 6번 이어 붙임(${m[0].ttsDurationSec && m[0].ttsDurationSec.toFixed(2)}초)`);
      ok(fs.existsSync(s5.ttsAudioPath) && fs.existsSync(s6.ttsAudioPath) && m[0].ttsAudioPath !== s5.ttsAudioPath, '옛 음성 파일은 지우지 않는다(↶ 되돌리기) · 새 파일에 쓴다');
      // 나누기: 7 → 7, 8
      const s7 = { num: 7, text: '일곱째 앞부분이고, 일곱째 뒷부분입니다.', ttsAudioPath: w('7.wav', [[0.2, 0], [0.9, 1], [0.3, 0], [0.9, 1], [0.3, 0]]), ttsDurationSec: 2.6 };
      const sp = [{ num: 7, text: '일곱째 앞부분이고,' }, { num: 8, text: '일곱째 뒷부분입니다.' }];
      const k2 = await ctx.fn([s7], sp, () => {});
      ok(k2 === 'split' && sp.every((x) => x.ttsAudioPath && fs.existsSync(x.ttsAudioPath) && x.ttsDurationSec > 0.5), `🔑 나뉜 두 문장 모두 음성이 있다(${sp.map((x) => x.ttsDurationSec.toFixed(2)).join(' + ')}초)`);
      ok(Math.abs(sp[0].ttsDurationSec + sp[1].ttsDurationSec - 2.6) < 0.002 && sp[0].ttsDurationSec > 1.1 && sp[0].ttsDurationSec < 1.4, '쉼(1.1~1.4초)에서 나눴다 · 합 = 원래 길이');
      ok(new Set([s7.ttsAudioPath, ...sp.map((x) => x.ttsAudioPath)]).size === 3, '나뉜 음성은 각자 새 파일(원본 7.wav 그대로)');
      // 판정력: 글자를 고친 경우엔 잇지 않는다(소리가 달라져야 한다)
      const m3 = [{ num: 5, text: '다섯째 문장을 고쳤습니다.' }];
      ok((await ctx.fn([s5], m3, () => {})) === null && !m3[0].ttsAudioPath, '(판정력) 글자를 고친 문장은 옛 음성을 붙이지 않는다 → 🎤 로 다시');
      const m4 = [{ num: 5, text: '다섯째 문장입니다. 여섯째 문장입니다.' }];
      const noAudio = { ...s6, ttsAudioPath: path.join(td, 'none.wav') };
      ok((await ctx.fn([s5, noAudio], m4, () => {})) === null && !m4[0].ttsAudioPath, '한쪽 음성이 없으면 반쪽만 붙이지 않는다(엉뚱한 길이 방지)');
      // 연결: 편집 두 경로 모두 부른다
      ok(/const _spl = await _spliceSentenceAudio\(old, made, log\)/.test(M) && /const _spl = await _spliceSentenceAudio\(\[sa, sb\], nr \? \[ns, nr\] : \[ns\], log\)/.test(M), '문장 편집(Backspace/Del/Ctrl+Enter)·그룹 경계 클립 합치기 두 경로 모두 음성을 잇고 나눈다');
      ok(/async function _editSentences/.test(M) && /const r = await _editSentences\(/.test(M), '편집은 비동기(ffmpeg 를 기다린다 · main 이 멈추지 않게)');
    }

    console.log('\n[3] 그룹 분할 — 두 그룹 모두 그림·영상 유지(split-group 원문)');
    {
      const M = read('main.js');
      const h0 = M.indexOf("ipcMain.handle('split-group'"), h1 = M.indexOf('\n});\n', h0) + 5;
      const P = require('../core/pipeline');
      const parsed = P.parseScriptText('# t\n## 장\n### 장면\n첫째 문장입니다. 둘째 문장입니다. 셋째 문장입니다. 넷째 문장입니다.\n### 다음\n다섯째 문장입니다.\n', 'longform', { splitMode: 'h3' });
      const pr = parsed.projects[0];
      pr.sentences.forEach((s) => { s.ttsDurationSec = 3; s.ttsAudioPath = path.join(tmp, 'x.wav'); });
      fs.writeFileSync(path.join(tmp, 'x.wav'), wavOf([[0.1, 1]]));
      const media = path.join(tmp, 'media-1'); fs.mkdirSync(media, { recursive: true });
      const img = path.join(media, '01.png'); fs.writeFileSync(img, 'PNG1');
      const vid = path.join(media, '01.mp4'); fs.writeFileSync(vid, 'MP41');
      const g0 = pr.groups[0]; g0.imagePath = img; g0.videoPath = vid; g0.imagePrompt = '산 위의 성'; g0.videoPrompt = 'slow pan';
      const handlers = {};
      const ctx = { fs, path, console, S: { parsed, outRoot: tmp }, ipcMain: { handle: (n, f) => { handlers[n] = f; } },
        require: (m) => require(m.startsWith('./') ? path.join(ROOT, m) : m), undoPush: () => {}, renumberMediaFiles: () => {},
        shortsDirs: () => ({ media }), storeActive: () => {}, pushDtoUpdate: () => {}, syncSnapshotNow: () => {}, dtoByReply: () => {}, log: () => {}, prLabel: () => '[t]', P: { toDTO: () => null } };
      vm.createContext(ctx); vm.runInContext(M.slice(h0, h1), ctx);
      await handlers['split-group'](null, { shortsNum: pr.shortsNum, groupNum: 1 });
      const [A, B] = pr.groups;
      ok(pr.groups.length === 3 && A.sentenceIds.length === 2 && B.sentenceIds.length === 2, '4문장 그룹이 2+2 로 나뉘었다(다음 그룹은 그대로)');
      ok(A.imagePath === img && A.videoPath === vid && A.imagePrompt === '산 위의 성', '🔑 앞 그룹 = 원래 그림·영상·프롬프트 그대로');
      ok(A.visSpan && A.visSpan.endId === B.sentenceIds[B.sentenceIds.length - 1], '🔑 앞 그림을 뒤 그룹 끝까지 이어 깐다(영상도 끊기지 않고 이어 재생)');
      const VS = require('../core/visual-span');
      const hasV = (g) => !!((g.imagePath && fs.existsSync(g.imagePath)) || (g.videoPath && fs.existsSync(g.videoPath)));
      VS.markCovered(pr, hasV);
      const L = VS.layersBySentence(pr, hasV);
      ok(B._covered === A.num && [...A.sentenceIds, ...B.sentenceIds].every((id) => (L.get(id) || []).includes(0)), '뒤 그룹의 모든 문장에서 7번(원래) 그림이 보인다 = 빈 그림 없음');
      ok(B.imagePrompt === '산 위의 성' && !B.imagePath, '뒤 그룹은 프롬프트를 물려받는다(새 그림이 필요하면 🔄) · 자동으로 따로 만들지 않는다');
      ok(fs.readFileSync(img, 'utf8') === 'PNG1' && fs.readFileSync(vid, 'utf8') === 'MP41', '그림·영상 파일은 그대로');
      // 게이트: 뒤 그룹 때문에 내보내기가 막히지 않는다(missingVisualGroups 원문)
      const q0 = M.indexOf('function missingVisualGroups('), q1 = M.indexOf('\n}\n', q0) + 3;
      const gx = { fs, require: ctx.require, hasVisual: hasV }; vm.createContext(gx);
      vm.runInContext(M.slice(q0, q1) + '\nthis.f = missingVisualGroups;', gx);
      pr.groups[2].imagePath = img;   // 다음 그룹은 그림이 있다고 치고
      ok(gx.f(pr).length === 0, '🔑 .vrew 게이트 통과(나눈 뒤 그림이 빈 그룹 0개)');
      // 판정력: 옛 방식(두 그룹 모두 초기화)이면 게이트가 막는다
      const old = { groups: pr.groups.map((g) => ({ ...g, sentenceIds: [...g.sentenceIds], visSpan: undefined })), sentences: pr.sentences };
      old.groups[0].imagePath = null; old.groups[0].videoPath = null; old.groups[1].imagePath = null;
      ok(gx.f(old).length === 2, '(A/B) 옛 방식(두 그룹 그림 초기화)이면 게이트가 G1·G2 를 막는다 — 위 검사는 헛단언이 아니다');
    }

    console.log('\n[4] 🏷 AI 고지 — 채널 문구 · 시간/클립 단위');
    {
      const M = read('main.js');
      const a0 = M.indexOf("const AI_NOTICE_TEXT"), a1 = M.indexOf('\n}\n', M.indexOf('function resolveAiNotice(')) + 3;
      const ctx = {}; vm.createContext(ctx); vm.runInContext(M.slice(a0, a1) + '\nthis.r = resolveAiNotice;', ctx);
      const t = ctx.r({ aiNotice: { text: '  이 영상은 AI 로 만들었습니다  ', unit: 'time', fromSec: 3, toSec: 12 } }, true).aiNotice;
      ok(t.enabled && t.text === '이 영상은 AI 로 만들었습니다' && t.startMode === 'seconds' && t.startSeconds === 3 && t.durationSeconds === 9, '시간 단위: 3초에 나타나 12초에 사라짐(문구는 채널 것)');
      const e = ctx.r({ aiNotice: {} }, true).aiNotice;
      ok(/AI 도구를 활용/.test(e.text) && e.startSeconds === 5 && e.durationSeconds === 5, '설정이 없으면 예전 기본(기본 문구 · 5초 뒤 5초)');
      ok(ctx.r({ aiNotice: { unit: 'time', fromSec: 4, toSec: 0 } }, true).aiNotice.durationSeconds === 0, '끝 0 = 영상 끝까지');
      const c = ctx.r({ aiNotice: { unit: 'clip', fromClip: 2, toClip: 3 } }, true).aiNotice;
      ok(c.startMode === 'clip' && c.startClip === 2 && c.endMode === 'clip' && c.endClip === 3, '클립 단위: 2번 클립에 나타나 3번 클립이 끝나면 사라짐');
      ok(!ctx.r({ aiNotice: { text: 'x' } }, false).aiNotice.enabled, '작업바에서 끄면 안 나온다');

      // 실제 .vrew — 클립 단위가 그 클립 시각에 맞는가
      const P = require('../core/pipeline');
      const r = P.parseScriptText('# t\n## 장\n### 장면\n첫째 문장입니다. 둘째 문장입니다. 셋째 문장입니다. 넷째 문장입니다.\n', 'longform', {});
      const pr = r.projects[0];
      const img = path.join(tmp, 'g.png');
      execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180', '-frames:v', '1', img]);
      pr.groups[0].imagePath = img;
      P.fillSilent(pr, path.join(tmp, 'tts-ai'));
      const d = pr.sentences.map((s) => s.ttsDurationSec);
      const webOf = (v) => Object.values(JSON.parse(new AdmZip(v).readAsText('project.json')).props.tracks).find((x) => x.type === 'web');
      const v1 = path.join(tmp, 'clip.vrew');
      await P.buildProjectVrew(pr, v1, { aiNotice: ctx.r({ aiNotice: { text: '클립 고지', unit: 'clip', fromClip: 2, toClip: 3 } }, true).aiNotice }, () => {}, 40, 1);
      const w1 = webOf(v1);
      ok(w1 && Math.abs(w1.assetEffectInfo.startDelay - Math.round(d[0] * 1000)) <= 2, `🔑 .vrew: 2번 클립 시작(${d[0].toFixed(2)}초)에 나타난다(startDelay ${w1 && w1.assetEffectInfo.startDelay}ms)`);
      ok(w1 && Math.abs(w1.durationSeconds - (d[1] + d[2])) < 0.01, `🔑 .vrew: 3번 클립 끝에 사라진다(길이 ${w1 && w1.durationSeconds.toFixed(2)}초 = 2·3번 클립 ${(d[1] + d[2]).toFixed(2)}초)`);
      const zipTxt = new AdmZip(v1).getEntries().map((x) => x.entryName).join(',');
      ok(/uc-0010-simple-textbox\.bin/.test(zipTxt) && JSON.stringify(JSON.parse(new AdmZip(v1).readAsText('project.json'))).includes('클립 고지'), '채널 문구가 .vrew 에 들어간다');
      const v2 = path.join(tmp, 'time.vrew');
      await P.buildProjectVrew(pr, v2, { aiNotice: ctx.r({ aiNotice: { unit: 'time', fromSec: 1.5, toSec: 4 } }, true).aiNotice }, () => {}, 40, 1);
      const w2 = webOf(v2);
      ok(w2 && w2.assetEffectInfo.startDelay === 1500 && Math.abs(w2.durationSeconds - 2.5) < 0.001, '.vrew: 시간 단위 1.5초~4초');
      // 대본의 🏷 문장 범위가 있으면 그것이 이긴다(채널의 클립 끝이 끼어들지 않는다)
      pr.aiNoticeRange = { from: 3, to: 3 };
      const v3 = path.join(tmp, 'range.vrew');
      await P.buildProjectVrew(pr, v3, { aiNotice: ctx.r({ aiNotice: { unit: 'clip', fromClip: 1, toClip: 4 } }, true).aiNotice }, () => {}, 40, 1);
      const w3 = webOf(v3);
      ok(w3 && Math.abs(w3.durationSeconds - d[2]) < 0.01 && Math.abs(w3.assetEffectInfo.startDelay - Math.round((d[0] + d[1]) * 1000)) <= 2, '대본에서 🏷 로 정한 문장 범위가 채널 설정보다 이긴다');
      pr.aiNoticeRange = undefined;

      // 채널 편집 창 — 읽기·저장 두 곳 다(안 실으면 저장 때 지워진다 — 이 저장소 단골 사고)
      const APP = read('renderer/src/App.jsx');
      ok(/aiText: \(p\.aiNotice && p\.aiNotice\.text\) \|\| ''/.test(APP) && /aiUnit: \(p\.aiNotice && p\.aiNotice\.unit\) === 'clip'/.test(APP), '편집 창: 문구·단위·시작·끝을 **읽는다**');
      ok(/text: String\(ch\.aiText \|\| ''\)\.trim\(\), unit: ch\.aiUnit === 'clip' \? 'clip' : 'time'/.test(APP) && /fromClip: Math\.max\(1/.test(APP), '편집 창: 문구·단위·시작·끝을 **저장한다**');
      ok(/data-testid="ai-text"/.test(APP) && /data-testid="ai-unit"/.test(APP) && /<option value="clip">클립/.test(APP), '편집 창: 문구 칸 · 단위(시간/클립) 고르기 · 시작·끝 칸');
    }
    console.log('\n[5] 🧩 클립 하나만 끌어올리기 — 로이 화면(2026-09-29) 그대로: 2번 클립 끝에서 Del');
    {
      const CJ = require('../core/clip-join');
      const CS = require('../core/caption-splitter');
      const up = '대문에서 세어서 일곱째 칸입니다.', low = '그 방은 가운데가 막혀 두 칸으로 나뉩니다.';
      const k = low.indexOf('막혀');
      const p = CJ.joinClips(up, [], low, [k]);
      ok(p.merged === '대문에서 세어서 일곱째 칸입니다 그 방은 가운데가.' && p.rest === '막혀 두 칸으로 나뉩니다.', `🔑 3번 클립 「그 방은 가운데가」 전체가 올라오고 4번 「막혀 두 칸으로 나뉩니다.」는 남는다 — 「${p.merged}」 / 「${p.rest}」`);
      ok(CS.splitCaptionLines(p.merged, 7, [...p.breaksMerged, p.merged.length]).length === 1, '🔑 합친 클립은 길어도 **한 줄 그대로**(끝 표식 — 자동 줄바꿈이 다시 쪼개지 않는다)');
      ok(CS.splitCaptionLines(p.merged, 7, null).length > 1, '(판정력) 끝 표식이 없으면 자동 줄바꿈이 둘 이상으로 쪼갠다 — 예전 증상');
      const p2 = CJ.joinClips('첫 줄 가나다 둘째 줄 라마바.', [7], '하나.', []);
      ok(p2.merged === '첫 줄 가나다 둘째 줄 라마바 하나.' && p2.rest === '' && p2.breaksMerged.join() === '7', '아래 문장이 한 줄이면 통째로 올라오고 위 문장의 줄 나눔은 그대로');
      const p3 = CJ.joinClips('위.', [], '가 나 다 라 마 바 사 아.', [4, 10]);
      ok(p3.rest === '다 라 마 바 사 아.' && p3.breaksRest.join() === '6', '남은 줄들의 줄 나눔도 그대로 옮긴다(4번 뒤 클립들 무변경)');
      ok(CS.normBreaks('가나다', [3]).join() === '3' && CS.normBreaks('가나다', [1, 9]).join() === '1' && CS.remapBreaks('가나다', '가나다라', [1, 3]).join() === '1,4', 'normBreaks 끝 표식 보존 · 글이 바뀌어도 끝으로 따라간다');

      // 실제 handler(merge-sentence-across) — .md · 그룹 · 음성 · 줄 나눔
      const M = read('main.js');
      const grab = (name) => { const i = M.indexOf('function ' + name + '('); return M.slice(i - (M.slice(i - 6, i) === 'async ' ? 6 : 0), M.indexOf('\n}\n', i) + 3); };
      const h0 = M.indexOf("ipcMain.handle('merge-sentence-across'"), h1 = M.indexOf('\n});\n', h0) + 5;
      const md = path.join(tmp, '대본.md');
      fs.writeFileSync(md, '# t\n## 장\n### ① 소설 하나가 방 이야기로 시작합니다\n소설 하나가 방 이야기로 시작합니다. 대문에서 세어서 일곱째 칸입니다.\n\n### ② 그 방은 가운데가 막혀 있습니다\n그 방은 가운데가 막혀 두 칸으로 나뉩니다. 다음 문장입니다.\n');
      const P = require('../core/pipeline');
      const parsed = P.parseScriptText(fs.readFileSync(md, 'utf8'), 'longform', {});
      const pr = parsed.projects[0];
      const td = path.join(tmp, 'tts-x'); fs.mkdirSync(td, { recursive: true });
      const segs = [[[0.2, 0], [1.0, 1], [0.3, 0]], [[0.2, 0], [1.2, 1], [0.3, 0]], [[0.2, 0], [0.8, 1], [0.35, 0], [0.9, 1], [0.3, 0]], [[0.2, 0], [0.7, 1], [0.3, 0]]];
      pr.sentences.forEach((x, i) => { const fp = path.join(td, (i + 1) + '.wav'); fs.writeFileSync(fp, wavOf(segs[i])); x.ttsAudioPath = fp; x.ttsDurationSec = durOf(fp); });
      const before = pr.sentences.map((x) => ({ p: x.ttsAudioPath, d: x.ttsDurationSec, b: fs.readFileSync(x.ttsAudioPath) }));
      const media = path.join(tmp, 'media-x'); fs.mkdirSync(media, { recursive: true });
      const i1p = path.join(media, '01.png'), i2p = path.join(media, '02.png'); fs.writeFileSync(i1p, 'G1'); fs.writeFileSync(i2p, 'G2');
      pr.groups[0].imagePath = i1p; pr.groups[1].imagePath = i2p;
      const handlers = {};
      const ctx = { fs, path, console, S: { parsed, scriptPath: md, outRoot: tmp, preset: null }, ipcMain: { handle: (n, fn) => { handlers[n] = fn; } },
        require: (m) => require(m.startsWith('./') ? path.join(ROOT, m) : m), P: { ...P, toDTO: () => null }, UNDO: { seq: 0 },
        currentMode: () => 'longform', presetThresholds: () => ({}), undoPush: () => ({}), undoDrop: () => {}, scriptHash: () => 'h',
        storeActive: () => {}, pushDtoUpdate: () => {}, syncSnapshotNow: () => {}, dtoByReply: () => {}, log: () => {}, prLabel: () => '[t]', shortsDirs: () => ({ media }),
        _inDir: () => true, _toTrash: () => {}, renumberMediaFiles: () => {} };
      vm.createContext(ctx);
      vm.runInContext(grab('_looseSig') + grab('_spliceSentenceAudio') + grab('_applyBreaks') + M.slice(h0, h1), ctx);
      const r = await handlers['merge-sentence-across'](null, { shortsNum: pr.shortsNum, groupNum: 1, dir: 'next', text: p.merged, rest: p.rest, breaks: [p.breaksMerged, p.breaksRest] });
      ok(r && r.ok, '합치기 성공 ' + (r && r.error ? r.error : ''));
      const txt = fs.readFileSync(md, 'utf8');
      ok(/대문에서 세어서 일곱째 칸입니다 그 방은 가운데가\.\n\n### ② 그 방은 가운데가 막혀 있습니다\n막혀 두 칸으로 나뉩니다\. 다음 문장입니다\./.test(txt), '대본(.md): 3번 클립만 ① 끝으로 · 4번 클립은 ② 제목 아래 그대로');
      const [G1, G2] = pr.groups; const sOf = (g) => g.sentenceIds.map((id) => pr.sentences.find((x) => x.id === id));
      ok(sOf(G1).map((x) => x.text).join('|') === '소설 하나가 방 이야기로 시작합니다.|대문에서 세어서 일곱째 칸입니다 그 방은 가운데가.' && sOf(G2)[0].text === '막혀 두 칸으로 나뉩니다.', '🔑 4번 클립은 G2 에 남는다(G2 그림 그대로 — 다른 클립의 그림이 바뀌지 않는다)');
      ok(G1.imagePath === i1p && G2.imagePath === i2p, '그림은 두 그룹 모두 그대로');
      const ns = sOf(G1)[1], nr = sOf(G2)[0];
      const lines = CS.splitCaptionLines(ns.text, 7, ns.capBreaks), lines2 = CS.splitCaptionLines(nr.text, 7, nr.capBreaks);
      ok(lines.length === 1 && lines2.length === 1, `🔑 줄(클립) 모양: 「${lines.join('/')}」 · 「${lines2.join('/')}」 — 합친 클립 한 줄 · 남은 클립 한 줄(쪼개지지 않음)`);
      ok(ns.ttsAudioPath && nr.ttsAudioPath && fs.existsSync(ns.ttsAudioPath) && fs.existsSync(nr.ttsAudioPath), '🔑 두 문장 모두 음성 있음(빈 음성 없음)');
      ok(Math.abs(ns.ttsDurationSec + nr.ttsDurationSec - (before[1].d + before[2].d)) < 0.003 && ns.ttsDurationSec > before[1].d + 1.0 && ns.ttsDurationSec < before[1].d + 1.5, `음성: 2번 소리 + 3번 클립 소리(쉼에서 자름) · 합 보존 (${ns.ttsDurationSec.toFixed(2)} + ${nr.ttsDurationSec.toFixed(2)}초)`);
      const s1 = sOf(G1)[0], s4 = sOf(G2)[1];
      ok(s1.ttsAudioPath === before[0].p && fs.readFileSync(s1.ttsAudioPath).equals(before[0].b) && s4.ttsAudioPath === before[3].p && fs.readFileSync(s4.ttsAudioPath).equals(before[3].b), '건드리지 않은 문장(1번·다음 문장) 음성은 파일·내용 그대로');
      ok(fs.readdirSync(td).every((n) => !/^_piece_/.test(n)), '자르는 중 임시 조각은 남기지 않는다');
      // 렌더러가 이 계획을 쓰는가
      const APP = read('renderer/src/App.jsx');
      ok(/import ClipJoin from '..\/..\/core\/clip-join\.js'/.test(APP) && (APP.match(/clipJoinPlan\(e,/g) || []).length >= 4 && !/mergeAcross\('next', sentEditValue/.test(APP), '화면: Del·Backspace 다섯 곳(그룹 경계 앞뒤 · 같은 그룹 위아래 · 문장 편집칸)이 모두 클립 단위 계획을 쓴다');
      ok(/breaks, fixed: true/.test(APP) && /args\.fixed \?/.test(M), '한 문장 안 줄 합치기·나누기도 결과를 굳힌다(합쳐진 줄이 다시 쪼개지지 않게)');
    }
    console.log('\n[6] 🪶 나눈 뒤 그룹에 그림을 교체하면 그 그림이 보인다(로이 2026-09-30 · v0.5.90)');
    {
      const VS = require('../core/visual-span');
      const P = require('../core/pipeline');
      const R = require('../core/vrew-render');
      const M = read('main.js');
      ok(/g\.visSpan = \{ \.\.\.\(g\.visSpan \|\| \{\}\), endId: lastId, soft: true \}/.test(M), '✂ 분할이 만든 범위는 soft(빈 곳 메우기)');
      // 모델: A(빨강) 가 soft 로 B 를 덮는다 → B 에 파랑이 생기면 B 문장들은 B
      const mk = () => {
        const r = P.parseScriptText('# t\n## 장\n### 가\n첫째 문장입니다. 둘째 문장입니다.\n### 나\n셋째 문장입니다. 넷째 문장입니다.\n', 'longform', { splitMode: 'h3' });
        return r.projects[0];
      };
      const red = path.join(tmp, 'red.png'), blue = path.join(tmp, 'blue.png');
      execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180', '-frames:v', '1', red]);
      execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180', '-frames:v', '1', blue]);
      const hasV = (g) => !!(g.imagePath && fs.existsSync(g.imagePath));
      const pr = mk(); const [A, B] = pr.groups;
      A.imagePath = red; A.visSpan = { endId: B.sentenceIds[1], soft: true };
      let L = VS.layersBySentence(pr, hasV);
      ok(B.sentenceIds.every((id) => L.get(id).join() === '0'), 'B 에 그림이 없을 땐 A 가 B 자리까지 보인다(빈 곳 없음)');
      B.imagePath = blue;
      L = VS.layersBySentence(pr, hasV);
      ok(B.sentenceIds.every((id) => { const l = L.get(id); return l[l.length - 1] === 1 && !l.includes(0); }), '🔑 B 에 자기 그림이 생기면 A 는 B 앞에서 멈춘다 → B 문장에선 B(파랑)');
      const hard = mk(); hard.groups[0].imagePath = red; hard.groups[1].imagePath = blue; hard.groups[0].visSpan = { endId: hard.groups[1].sentenceIds[0] };
      const LH = VS.layersBySentence(hard, hasV); const top = LH.get(hard.groups[1].sentenceIds[0]);
      ok(top[top.length - 1] === 0, '(판정력) 손으로 늘린 범위(soft 없음)는 예전대로 위에 깐다(v0.5.62 규칙 그대로)');
      const o = VS.spanToOrd(pr, A); const A2 = { sentenceIds: A.sentenceIds }; VS.spanFromOrd(pr, A2, o);
      ok(o.soft === true && A2.visSpan && A2.visSpan.soft === true, '작업본 저장·복원에도 soft 가 산다');
      // 실제 .vrew → MP4 화소: B 구간은 파랑
      P.fillSilent(pr, path.join(tmp, 'tts-soft'));
      const vrew = path.join(tmp, 'soft.vrew'), mp4 = path.join(tmp, 'soft.mp4');
      await P.buildProjectVrew(pr, vrew, {}, () => {}, 40, 1);
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
      const d = pr.sentences.map((x) => x.ttsDurationSec);
      const px = (t) => { const raw = execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=16:9', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); const i = (4 * 16 + 8) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
      const pA = px(d[0] * 0.5), pB = px(d[0] + d[1] + d[2] * 0.5);
      ok(res && res.ok && pA[0] > 150 && pA[2] < 90, `MP4: A 구간은 빨강 (${pA})`);
      ok(pB[2] > 150 && pB[0] < 90, `🔑 MP4: 나눈 뒤 그룹(B)에 넣은 그림(파랑)이 실제로 보인다 (${pB}) — 예전엔 A 빨강이 위에 깔렸다`);
      // 옛 작업본(v0.5.87~89 — soft 없이 늘린 범위) → 그림을 넣는 순간 soft 로
      const i0 = M.indexOf('function _softenCoverOf('), i1 = M.indexOf('\n}\n', i0) + 3;
      const ctx = { require: (m) => require(m.startsWith('./') ? path.join(ROOT, m) : m), log: () => {}, console };
      vm.createContext(ctx); vm.runInContext(M.slice(i0, i1) + '\nthis.f = _softenCoverOf;', ctx);
      const old = mk(); old.groups[0].visSpan = { endId: old.groups[1].sentenceIds[1] };
      ok(ctx.f(old, old.groups[1]) === 1 && old.groups[0].visSpan.soft === true, '옛 작업본: B 를 통째로 덮던 A 범위가 B 에 그림을 넣는 순간 soft 로');
      const part = mk(); part.groups[0].visSpan = { endId: part.groups[1].sentenceIds[0] };
      ok(ctx.f(part, part.groups[1]) === 0 && !part.groups[0].visSpan.soft, '(판정력) 일부만 걸친 범위(손으로 늘린 겹침)는 그대로');
      ok((M.match(/_softenCoverOf\(pr, g\);/g) || []).length === 3, '파일 교체 · 🔄 이미지 재생성 · 🎬 그룹 영상 세 곳에서 부른다');
      // ✂ 은 늘 보인다
      const APP = read('renderer/src/App.jsx');
      ok(!/groupDurationSec > 10 && \(c\.sentences && c\.sentences\.length >= 2\) &&/.test(APP) && (APP.match(/disabled=\{!\(c\.sentences && c\.sentences\.length >= 2\)\}/g) || []).length === 3, '🔑 ✂ 분할은 세 곳(그룹 줄 두 모양 · 그룹 메뉴) 모두 늘 보인다(문장 1개면 흐리게 + 이유)');
    }
  } catch (e) { ok(false, '실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${fail ? '❌' : '✅'} clip-keep ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
