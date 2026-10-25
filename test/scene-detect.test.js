'use strict';
/**
 * node test/scene-detect.test.js — 🎞 영상 장면 전환 찾기(Lab · 남은 기능 ⑥)
 *   [1] 순수 규칙 · [2] 🔑 실제 영상(검정 2초 → 흰색 2초 → 어두운 회색 2초)에서 전환 시각 · [3] 실제 앱: 그룹 영상 → 찾기 → 마커 → 되돌리기
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const SD = require('../core/scene-detect');
const FF = require('../core/media-utils').getFfmpegPath();

console.log('\n[1] 순수 규칙');
ok(SD.normTh(0.01) === 0.1 && SD.normTh(5) === 0.9 && SD.normTh('x') === 0.35 && SD.normTh(0.333) === 0.33, '민감도 정규화(0.1~0.9 · 못 읽으면 0.35)');
const txt = ['frame:0    pts:0       pts_time:0', 'lavfi.scene_score=0.000000', 'frame:1    pts:60000   pts_time:2.5', 'lavfi.scene_score=0.512', 'frame:2    pts:120000  pts_time:4.04', 'lavfi.scene_score=0.800'].join('\n');
const ps = SD.parseScenes(txt);
ok(ps.length === 2 && ps[0].t === 2.5 && ps[0].score === 0.512 && ps[1].t === 4.04, '출력 파싱(0초 줄은 전환이 아니라 뺀다)');
ok(SD.thin([{ t: 1, score: 0.4 }, { t: 1.2, score: 0.9 }, { t: 3, score: 0.5 }], 0.5).map((x) => x.t).join() === '1.2,3', '가까운 전환(0.5초 안)은 점수 높은 하나만');
ok(SD.sentenceAt([3, 0, 4, 2], 0) === 0 && SD.sentenceAt([3, 0, 4, 2], 2.99) === 0 && SD.sentenceAt([3, 0, 4, 2], 3) === 2 && SD.sentenceAt([3, 0, 4, 2], 8.5) === 3 && SD.sentenceAt([3, 0, 4, 2], 9) === -1, '시각 → 문장(음성이 없는 문장은 건너뛴다 · 밖은 −1)');
ok(!/require\('electron'\)/.test(read('core/scene-detect.js')), '순수·ffmpeg 만(Electron 모름)');

console.log('\n[2] 실제 영상 — 검정 2초 → 흰색 2초 → 어두운 회색 2초');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scn-'));
  const vid = path.join(tmp, 'three.mp4');
  try {
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=25:d=2', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=25:d=2', '-f', 'lavfi', '-i', 'color=c=0x404040:s=320x180:r=25:d=2', '-filter_complex', 'concat=n=3:v=1:a=0,format=yuv420p', '-c:v', 'libx264', vid]);
    const r = await SD.detect({ src: vid, threshold: 0.35, ffmpegPath: FF });
    ok(r.ok && r.scenes.length === 2 && Math.abs(r.scenes[0].t - 2) < 0.1 && Math.abs(r.scenes[1].t - 4) < 0.1, `🔑 전환 시각 ${r.ok ? r.scenes.map((x) => x.t).join(' · ') : r.error} (기대 2.0 · 4.0)`);
    const flat = path.join(tmp, 'flat.mp4');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=25:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', flat]);
    const f = await SD.detect({ src: flat, ffmpegPath: FF });
    ok(f.ok && f.scenes.length === 0, '한 색뿐인 영상은 전환 0곳(판정력)');
    const bad = await SD.detect({ src: path.join(tmp, '없다.mp4'), ffmpegPath: FF });
    ok(bad.ok === false && bad.error, '없는 영상은 이유를 말한다: ' + (bad.error || '').slice(0, 40));
  } catch (e) { ok(false, '실패: ' + (e && e.stack || e)); }

  console.log('\n[3] 실제 앱');
  const M = read('main.js'), PL = read('preload.js'), APP = read('renderer/src/App.jsx');
  ok(/ipcMain\.handle\('video-scenes'/.test(M) && /videoScenes: \(args\)/.test(PL) && /data-testid="scene-panel"/.test(APP) && /tid="cx-scene-find"/.test(APP), '소스 배선: IPC · preload · 패널 · 우클릭');
  const vs = M.slice(M.indexOf("ipcMain.handle('video-scenes'"), M.indexOf("ipcMain.handle('clip-pad'"));
  ok(!/g\.videoPath = |writeFileSync|rmSync/.test(vs), '찾기는 영상·파일을 바꾸지 않는다(마커만 · 되돌릴 수 있게 undoPush)');
  const TAG = `장면시험_${process.pid}`;
  const MD = path.join(os.tmpdir(), `${TAG}.md`);
  const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
  fs.writeFileSync(MD, ['# 장면 시험', '', '## 장', '### ① 영상 장면', '> 🖼️ 이미지: a room', '', '첫째 문장은 조금 길게 씁니다. 둘째 문장도 조금 길게 씁니다. 셋째 문장입니다.', ''].join('\n'), 'utf8');
  const chan = `__장면채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scn-out-'));
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
    const sel1 = async () => { await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(250); };
    const ctxOpen = async () => { await win.locator('.sent[data-ln="1"] .clip-r1').first().click({ button: 'right', position: { x: 4, y: 4 } }); await win.waitForSelector('[data-testid="clip-ctx"]'); };
    const made = await win.evaluate(async (name) => { try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 30, aiNotice: false, outMode: 'audio' }); return 'ok'; } catch (e) { return String(e.message || e); } }, chan);
    ok(made === 'ok', '무음 만들기로 음성 채움 ' + made);
    const sents = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts[0].sentences.map((s) => ({ dur: s.dur, pz: s.pz || 0, mk: s.mk ? 1 : 0, num: s.num })); });
    // 영상이 없을 때
    await sel1(); await ctxOpen(); await win.click('[data-testid="cx-scene-find"]'); await win.waitForTimeout(500);
    ok(await win.locator('[data-testid="scene-panel"]').count() === 0, '영상이 없는 그룹이면 패널을 열지 않고 알려 준다');
    await win.keyboard.press('Escape');
    // 영상 첨부(PC 불러오기 — 실제 첨부 IPC)
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, vid);
    await win.evaluate(async () => window.api.attachAsset({ shortsNum: 1, groupNum: 1 }));
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(700);
    const ss = await sents();
    ok(ss.length === 3 && ss.every((s) => s.dur > 0 && s.mk === 0), `문장 3개 · 음성 길이 ${ss.map((s) => s.dur.toFixed(1)).join('/')} · 마커 없음`);
    await sel1(); await ctxOpen(); await win.click('[data-testid="cx-scene-find"]'); await win.waitForSelector('[data-testid="scene-panel"]', { timeout: 3000 });
    await win.click('[data-testid="scene-run"]'); await win.waitForSelector('[data-testid="scene-row"]', { timeout: 30000 });
    ok(await win.locator('[data-testid="scene-row"]').count() === 2, '전환 2곳이 목록에 뜬다');
    // 기대 매핑 — 영상 2.0초·4.0초가 문장 시간표에서 어느 문장인가
    const idxAt = (t) => { let acc = 0; for (let i = 0; i < ss.length; i++) { const d = ss[i].dur + ss[i].pz; if (t >= acc && t < acc + d) return i; acc += d; } return -1; };
    const want = new Set([idxAt(2), idxAt(4)].filter((i) => i >= 0));
    await win.click('[data-testid="scene-mark"]'); await win.waitForTimeout(1200);
    const after = await sents();
    ok(after.every((s, i) => (s.mk === 1) === want.has(i)), `전환이 든 문장에만 ⚑ 마커(기대 ${[...want].map((i) => i + 1).join('·')}번) ${JSON.stringify(after.map((s) => s.mk))}`);
    await win.evaluate(async () => window.api.undo({})); await win.waitForTimeout(700);
    ok((await sents()).every((s) => s.mk === 0), '되돌리기 → 마커가 사라진다');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    try { const w = await app.firstWindow(); await w.evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, chan); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} scene-detect ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
