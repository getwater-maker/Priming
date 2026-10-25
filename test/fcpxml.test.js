'use strict';
/**
 * node test/fcpxml.test.js — 🎬 FCPXML 내보내기(Lab · 남은 기능 ⑧)
 *   [1] 순수 규칙(core/fcpxml) · [2] 실제 앱: 음성 + 그림 + 삽입 → export-fcpxml → 파일(읽기만 · 앱 상태 불변)
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const FX = require('../core/fcpxml');
const P = require('../core/pipeline');
const FF = require('../core/media-utils').getFfmpegPath();

// 아주 작은 XML 구조 검사 — 태그 짝 · 속성 따옴표 · 이스케이프 안 된 & < 없음
function wellFormed(xml) {
  const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/, '');
  if (/&(?!amp;|lt;|gt;|quot;|apos;)/.test(body.replace(/<[^>]*>/g, (t) => t.replace(/&(amp|lt|gt|quot|apos);/g, '')))) { /* 아래 태그별 검사 */ }
  const stack = []; const re = /<(\/?)([A-Za-z][\w-]*)([^<>]*?)(\/?)>/g; let m;
  while ((m = re.exec(body))) {
    const [, close, name, attrs, self] = m;
    if (!close) { const aa = attrs.match(/\s[\w:-]+="[^"]*"/g) || []; if (attrs.replace(/\s[\w:-]+="[^"]*"/g, '').trim()) return `속성 꼴 이상: <${name}${attrs}>`; if (aa.some((x) => /[<>]|&(?!amp;|lt;|gt;|quot;)/.test(x))) return `이스케이프 안 됨: ${name}`; }
    if (self) continue;
    if (!close) stack.push(name); else if (stack.pop() !== name) return `태그 짝 어긋남: </${name}>`;
  }
  return stack.length ? `안 닫힌 태그: ${stack.join(',')}` : '';
}

console.log('\n[1] 순수 규칙');
ok(FX.rt(0) === '0s' && FX.rt(1) === '30/30s' && FX.rt(2.5) === '75/30s' && FX.rt(0.01) === '0s', '시간 표기(30fps 분수 · 0은 0s)');
ok(FX.esc('a&b<c>"d"') === 'a&amp;b&lt;c&gt;&quot;d&quot;', '특수문자 이스케이프');
ok(FX.fileUrl('D:\\내 폴더\\a b&c.png') === 'file:///D:/%EB%82%B4%20%ED%8F%B4%EB%8D%94/a%20b%26c.png', '윈도우 경로 → file:/// (한글·공백·& 인코딩)');
const mkProj = () => {
  const r = P.parseScriptText('# t\n## 장\n### ① 가\n첫째 문장입니다. 둘째 문장입니다.\n### ② 나\n셋째 문장입니다.\n', 'longform', {});
  const pr = r.projects[0];
  pr.sentences.forEach((s, i) => { s.ttsAudioPath = `D:\\음성\\${i + 1}.wav`; s.ttsDurationSec = 2 + i; });   // 2 · 3 · 4 초
  pr.groups[0].imagePath = 'D:\\그림\\A & B.png'; pr.groups[1].videoPath = 'D:\\그림\\영상.mp4';
  return pr;
};
{
  const pr = mkProj();
  const r = FX.build(pr, { name: 'T & <test>', pauses: new Map(), exists: () => true });
  ok(wellFormed(r.xml) === '', 'XML 구조가 온전하다: ' + wellFormed(r.xml));
  ok(/<fcpxml version="1\.9">/.test(r.xml) && r.xml.startsWith('<?xml'), 'FCPXML 1.9 머리');
  ok(r.totalSec === 9 && /<sequence [^>]*duration="270\/30s"/.test(r.xml), `전체 길이 = 음성 합 9초(270/30s)`);
  ok(/name="T &amp; &lt;test&gt;"/.test(r.xml), '이름의 특수문자 이스케이프');
  const aclips = [...r.xml.matchAll(/<asset-clip ref="(a\d+)" lane="(-?\d+)" offset="([^"]+)" name="([^"]*)" start="[^"]*" duration="([^"]+)"/g)].map((m) => ({ ref: m[1], lane: +m[2], offset: m[3], name: m[4], dur: m[5] }));
  const aud = aclips.filter((c) => c.lane === -1);
  ok(aud.length === 3 && aud.map((c) => c.offset).join() === '0s,60/30s,150/30s' && aud.map((c) => c.dur).join() === '60/30s,90/30s,120/30s', '문장 음성 3개가 빈틈 없이 이어진다(레인 -1 · 0·2·5초)');
  const vis = aclips.filter((c) => c.lane === 1);
  ok(vis.length === 2 && vis[0].offset === '0s' && vis[0].dur === '150/30s' && vis[1].offset === '150/30s' && vis[1].dur === '120/30s', '그룹 그림·영상은 자기 문장 구간(G1 0~5초 · G2 5~9초 · 레인 1)');
  ok(/<asset id="a\d+" name="A &amp; B\.png" src="file:\/\/\/D:\/%EA%B7%B8%EB%A6%BC\/A%20%26%20B\.png"/.test(r.xml), '소재 이름·file URL 이 인코딩된다');
  ok(/hasVideo="1" hasAudio="0"/.test(r.xml) && /hasVideo="0" hasAudio="1"/.test(r.xml) && /hasVideo="1" hasAudio="1"/.test(r.xml), '소재 종류(그림=영상만 · 음성=오디오만 · 영상=둘 다)');
  // 쉼이 시간을 민다
  const pz = new Map([[pr.sentences[0].id, 1.5]]);
  const r2 = FX.build(pr, { name: 'x', pauses: pz, exists: () => true });
  const off2 = [...r2.xml.matchAll(/lane="-1" offset="([^"]+)"/g)].map((m) => m[1]);
  ok(r2.totalSec === 10.5 && off2.join() === '0s,105/30s,195/30s', `빈 클립·막간 쉼(1.5초)이 뒤 클립을 민다 → ${off2.join(' ')}`);
  // 없는 파일은 뺀다 · 삽입
  pr.overlays = [{ id: 'o1', file: 'D:\\효과\\팡.wav', name: '팡', kind: 'audio', startId: pr.sentences[0].id, endId: pr.sentences[1].id }, { id: 'o2', file: 'D:\\효과\\로고.png', name: '로고', kind: 'image', startId: pr.sentences[2].id, endId: pr.sentences[2].id }];
  const r3 = FX.build(pr, { name: 'x', pauses: new Map(), exists: (f) => !/영상\.mp4/.test(f) });
  ok(!/영상\.mp4|%EC%98%81%EC%83%81\.mp4/.test(r3.xml) && /lane="-2"/.test(r3.xml) && /lane="2"/.test(r3.xml) && wellFormed(r3.xml) === '', '없는 파일(영상)은 빠지고 삽입 오디오 레인 −2 · 삽입 그림 레인 2');
  const noSound = mkProj(); noSound.sentences.forEach((s) => { s.ttsAudioPath = null; s.ttsDurationSec = 0; });
  ok(FX.build(noSound, { exists: () => true }).clips === 0, '음성이 없으면 시간표가 없어 소재 0개');
  ok(!/require\('(fs|electron)'\)/.test(read('core/fcpxml.js')), '순수 — 파일을 쓰지 않는다');
}

console.log('\n[2] 실제 앱');
(async () => {
  const M = read('main.js'), PL = read('preload.js'), APP = read('renderer/src/App.jsx');
  ok(/ipcMain\.handle\('export-fcpxml'/.test(M) && /exportFcpxml: \(args\)/.test(PL) && /data-testid="rb-fcpxml"/.test(APP), '소스 배선: IPC · preload · 파일 탭 단추');
  const TAG = `fcp시험_${process.pid}`;
  const MD = path.join(os.tmpdir(), `${TAG}.md`);
  const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
  fs.writeFileSync(MD, ['# fcp 시험', '', '## 장', '### ① 첫', '> 🖼️ 이미지: a', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘', '> 🖼️ 이미지: b', '', '셋째 문장입니다.', ''].join('\n'), 'utf8');
  const chan = `__fcp채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcp-out-'));
  const png = path.join(os.tmpdir(), TAG + '.png');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:d=1', '-frames:v', '1', png]);
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow(); win.on('pageerror', (e) => errors.push(String(e))); win.on('dialog', (d) => d.accept().catch(() => {}));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, silenceSec: 0 } }); }, { name: chan, dir: outDir });
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const before = await win.evaluate(async () => window.api.exportFcpxml({ shortsNum: 1 }));
    ok(before && before.ok === false && /음성/.test(before.error), '음성이 없으면 이유를 말한다: ' + (before && before.error));
    const made = await win.evaluate(async (name) => { try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 30, aiNotice: false, outMode: 'audio' }); return 'ok'; } catch (e) { return String(e.message || e); } }, chan);
    ok(made === 'ok', '무음 만들기로 음성 채움 ' + made);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, png);
    await win.evaluate(async () => window.api.attachAsset({ shortsNum: 1, groupNum: 1 }));
    const snap0 = await win.evaluate(async () => JSON.stringify((await window.api.listQueue()).dto.projects[0].cuts.map((c) => [c.num, c.imagePath, (c.sentences || []).map((s) => [s.audio, s.dur])])));
    const r = await win.evaluate(async () => window.api.exportFcpxml({ shortsNum: 1 }));
    ok(r && r.ok && fs.existsSync(r.path) && /\.fcpxml$/.test(r.path), `파일이 만들어졌다: ${r && r.path && path.basename(r.path)}`);
    const xml = fs.readFileSync(r.path, 'utf8');
    ok(wellFormed(xml) === '', '실제 파일 XML 구조 온전: ' + wellFormed(xml));
    const durs = await win.evaluate(async () => (await window.api.listQueue()).dto.projects[0].cuts.flatMap((c) => (c.sentences || []).map((s) => s.dur + (s.pz || 0))));
    const total = durs.reduce((a, b) => a + b, 0);
    ok(Math.abs(r.totalSec - total) < 0.05 && /<sequence [^>]*duration="(\d+)\/30s"/.test(xml), `전체 길이 = 문장 음성 합(${r.totalSec.toFixed(2)} ≈ ${total.toFixed(2)}초)`);
    ok((xml.match(/lane="-1"/g) || []).length === 3 && /lane="1"/.test(xml), '음성 클립 3개 + 그림 클립');
    const snap1 = await win.evaluate(async () => JSON.stringify((await window.api.listQueue()).dto.projects[0].cuts.map((c) => [c.num, c.imagePath, (c.sentences || []).map((s) => [s.audio, s.dur])])));
    ok(snap0 === snap1, '🔑 내보내도 앱 상태(그림·음성·길이)는 그대로(읽기만)');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    try { const w = await app.firstWindow(); await w.evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, chan); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP, png]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} fcpxml ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
