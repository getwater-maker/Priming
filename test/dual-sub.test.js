'use strict';
/**
 * node test/dual-sub.test.js — 🌐 이중 자막(번역을 MP4 둘째 줄로 굽기 · Lab 남은 기능 ⑤)
 *   [1] 소스 배선 · [2] 🔑 실제 왕복: 번역 SRT → 빌더(옆 파일 dualSub) → 렌더러(MP4) → 화면 아래 둘째 줄 화소 · [3] 실제 앱: 번역 → 체크 → DTO · Ctrl+Z · 새로고침
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const FF = require('../core/media-utils').getFfmpegPath();

console.log('\n[1] 소스 배선');
const M = read('main.js'), PL = read('preload.js'), APP = read('renderer/src/App.jsx'), RV = read('core/vrew-render.js'), PP = read('core/pipeline.js');
ok(/ipcMain\.handle\('set-dual-sub'/.test(M) && /setDualSub: \(args\)/.test(PL), 'IPC set-dual-sub + preload');
ok(/dualSub: pr\.dualSub \|\| null/.test(M) && (M.match(/pr\.dualSub = \{ \.\.\.ps\.dualSub \}/g) || []).length === 1 && /proj\.dualSub = \{ \.\.\.ps\.dualSub \}/.test(M) && /if \(sp\.dualSub\) pr\.dualSub/.test(M) && /dualSub: pr\.dualSub \? \{ \.\.\.pr\.dualSub \} : null \}\)/.test(M), '대본 단위 필드: 작업본 저장 · 이어받기 2곳 · 되돌리기 캡처·복원');
ok(/function _dualOf\(project\)/.test(PP) && /_syncFxPauseWins\(vrewPath, userPauseWins\(project, preset\), _dualOf\(project\)\)/.test(PP) && !/dualSub/.test(read('vrew/vrew-builder.js')), '🔑 .vrew 빌더는 이중 자막을 모른다 — 옆 파일(.vrew.fx.json)로만 렌더러에');
ok(/function dualEvents/.test(RV) && /dualLines: ctx\.dualCues/.test(RV) && /cuesFromSrt/.test(RV), '렌더러: 번역 SRT → 둘째 줄 ASS 이벤트');
ok(/data-testid="ai-dual"/.test(APP) && /setDualSub\(\{ shortsNum: sn, lang, path: srt \}\)/.test(APP), '화면: AI 자막 번역 패널의 「둘째 자막 줄로 굽기」');

console.log('\n[2] 실제 왕복 — 첫 자막은 그대로 · 둘째 줄은 화면 아래');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-'));
  try {
    const img = path.join(tmp, 'b.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x103060:s=1920x1080', '-frames:v', '1', img]);
    const r = P.parseScriptText('# t\n## 장\n### ① 가\n첫째 문장입니다. 둘째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0]; pr.groups[0].imagePath = img;
    pr.sentences.forEach((s, i) => { const mp3 = path.join(tmp, `s${i}.mp3`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '5', '-c:a', 'libmp3lame', mp3]); s.ttsAudioPath = mp3; s.ttsDurationSec = 5; });
    const srt = path.join(tmp, 'sub_en.srt');
    const map = new Map(pr.sentences.map((s, i) => [s.id, 'Translated line number ' + (i + 1)]));
    P.writeSrt(pr, srt, 42, null, (s) => map.get(s.id));
    ok(/Translated line number 1/.test(fs.readFileSync(srt, 'utf8')), '번역 SRT 준비');
    const band = (f, t) => { const raw = execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'crop=iw:ih*0.1:0:ih*0.87,scale=480:27,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 }); let n = 0; for (let i = 0; i < raw.length; i += 3) if (Math.abs(raw[i] - 0x10) + Math.abs(raw[i + 1] - 0x30) + Math.abs(raw[i + 2] - 0x60) > 90) n++; return n; };
    const main = (f, t) => { const raw = execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'crop=iw:ih*0.45:0:ih*0.4,scale=480:121,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 }); let n = 0; for (let i = 0; i < raw.length; i += 3) if (Math.abs(raw[i] - 0x10) + Math.abs(raw[i + 1] - 0x30) + Math.abs(raw[i + 2] - 0x60) > 90) n++; return n; };
    async function bake(name, dual) {
      if (dual) pr.dualSub = dual; else delete pr.dualSub;
      const vrew = path.join(tmp, name + '.vrew'); await P.buildProjectVrew(pr, vrew, {}, () => {}, 20, 1);
      const mp4 = path.join(tmp, name + '.mp4'); const logs = [];
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: (m) => logs.push(String(m)), par: 2 });
      if (!res || !res.ok) throw new Error('렌더 실패 ' + (res && res.error));
      return { vrew, mp4, logs };
    }
    const base = await bake('base', null);
    ok(!fs.existsSync(base.vrew + '.fx.json'), '이중 자막이 없으면 옆 파일이 없다');
    const b0 = band(base.mp4, 2), m0 = main(base.mp4, 2);
    ok(b0 === 0 && m0 > 100, `기준: 첫 자막은 있고(${m0}) 화면 아래 띠에는 아무것도 없다(${b0})`);
    const dual = await bake('dual', { lang: 'en', srt });
    const fx = JSON.parse(fs.readFileSync(dual.vrew + '.fx.json', 'utf8'));
    ok(fx.dualSub && fx.dualSub.lang === 'en' && fx.dualSub.srt === srt, '옆 파일에 dualSub(언어·SRT 경로)');
    ok(dual.logs.some((l) => /이중 자막 en — 둘째 줄 \d+개/.test(l)), '렌더 로그: ' + (dual.logs.find((l) => /이중 자막/.test(l)) || '').trim().slice(0, 50));
    const b1 = band(dual.mp4, 2), m1 = main(dual.mp4, 2);
    ok(b1 > 150, `🔑 MP4: 화면 아래 띠에 둘째 자막 줄이 생겼다(흰 화소 ${b1})`);
    ok(Math.abs(m1 - m0) < m0 * 0.05 + 5, `첫 자막은 그대로(${m0} → ${m1})`);
    ok(band(dual.mp4, 7.5) > 150, '둘째 문장 구간에도 둘째 줄(번역 2번)');
    const miss = await bake('miss', { lang: 'en', srt: path.join(tmp, '없는파일.srt') });
    ok(!fs.existsSync(miss.vrew + '.fx.json') && band(miss.mp4, 2) === 0, '번역 파일이 없으면 조용히 첫 자막만(옆 파일도 안 만든다)');
    const off = await bake('off', null);
    ok(!fs.existsSync(off.vrew + '.fx.json') && band(off.mp4, 2) === 0, '끄면 처음과 같다(옆 파일이 사라진다)');
    // 빈 클립 쉼과 함께 — 옆 파일에 두 키가 공존
    pr.sentences[0].padAfter = 1;
    const both = await bake('both', { lang: 'en', srt });
    const fb = JSON.parse(fs.readFileSync(both.vrew + '.fx.json', 'utf8'));
    ok(fb.dualSub && fb.pauseWins && fb.pauseWins.length === 1, '빈 클립 쉼(pauseWins)과 이중 자막(dualSub)이 한 옆 파일에 공존');
    delete pr.sentences[0].padAfter;
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }

  console.log('\n[3] 실제 앱 — 번역 → 켜기 → 끄기');
  const TAG = `이중자막시험_${process.pid}`;
  const MD = path.join(os.tmpdir(), `${TAG}.md`);
  const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
  fs.writeFileSync(MD, ['# 시험', '', '## 장', '### ① 첫', '> 🖼️ 이미지: a', '', '첫 문장입니다. 둘째 문장입니다.', '', '### ② 둘', '> 🖼️ 이미지: b', '', '셋째 문장입니다.', ''].join('\n'), 'utf8');
  const FAKE = () => {
    global.__claudeApiTest = { cfg: { key: 'sk-test-fake' }, fetch: async (_u, opts) => {
      const body = JSON.parse(opts.body); const lines = String(body.messages[0].content).split('\n').filter((l) => /^\d+\t/.test(l)).map((l) => Number(l.split('\t')[0]));
      const payload = { content: [{ type: 'text', text: JSON.stringify(lines.map((n) => ({ n, t: 'EN-' + n }))) }], usage: { input_tokens: 1, output_tokens: 1 }, model: 'claude-sonnet-5-5', stop_reason: 'end_turn' };
      return { status: 200, text: async () => JSON.stringify(payload), headers: { get: () => null } };
    } };
  };
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow(); win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(FAKE);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const dsub = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].dualSub || null; });
    await win.click('.menus button[data-menu="caption"]'); await win.waitForTimeout(250);
    await win.click('[data-testid="rb-ai-translate"]'); await win.waitForSelector('[data-testid="ai-tr-panel"]');
    ok(await win.locator('[data-testid="ai-dual"]').count() === 0, '번역하기 전에는 체크칸이 없다');
    await win.click('[data-testid="ai-tr-run"]'); await win.waitForSelector('[data-testid="ai-dual"]', { timeout: 15000 });
    ok(!(await win.locator('[data-testid="ai-dual"]').isChecked()) && (await dsub()) === null, '번역 뒤 체크칸(처음엔 꺼짐)');
    await win.check('[data-testid="ai-dual"]'); await win.waitForTimeout(800);
    ok((await dsub()) === 'en' && await win.locator('[data-testid="ai-dual"]').isChecked(), '켜면 대본 필드 dualSub = en');
    await win.evaluate(async () => window.api.undo({})); await win.waitForTimeout(600);
    ok((await dsub()) === null, '되돌리기 → 꺼짐');
    await win.locator('[data-testid="ai-dual"]').setChecked(false); await win.waitForTimeout(500);   // (되돌리기를 IPC 로 직접 불러 화면 체크칸이 낡았을 수 있다 — 껐다 켠다)
    await win.locator('[data-testid="ai-dual"]').setChecked(true); await win.waitForTimeout(800);
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(700);
    ok((await dsub()) === 'en', '새로고침(작업본 이어받기) 뒤에도 유지');
    const bad = await win.evaluate(async () => window.api.setDualSub({ shortsNum: 1, lang: 'en', path: 'C:\\없는\\파일.srt' }));
    ok(bad && bad.ok === false && /번역 자막/.test(bad.error), '없는 파일은 거부: ' + (bad && bad.error));
    const off = await win.evaluate(async () => window.api.setDualSub({ shortsNum: 1, lang: '' }));
    ok(off && off.ok && (await dsub()) === null, '끄기');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} } }
  console.log(`\n${fail ? '❌' : '✅'} dual-sub ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
