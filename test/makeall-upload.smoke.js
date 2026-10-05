'use strict';
/**
 * node test/makeall-upload.smoke.js — ⬆ 다시 굽지 않고 넘어가도 업로드 관문까지 간다(v0.6.97 · 로이 2026-10-05)
 *   「만들기만 누르면 MP4 확인 → 채널에 안 올라갔으면 업로드 · 올라가 있으면 넘어감」.
 *   ① 무음 ⚡ 만들기(🎬 유튜브 MP4) → MP4 를 굽고 업로드 관문에 한 번
 *   ② 같은 대본 ⚡ 만들기 한 번 더 → 「같은 이름의 MP4 가 이미 있어 건너뜁니다」(MP4 그대로) **이면서** 업로드 관문에 또 간다
 *      (무음 모드는 음성을 매번 새로 써서 「입력이 그대로」 쪽이 아니라 이 쪽으로 간다 — 두 출구 모두 같은 uploadExisting() 을 부른다 · 소스 단언)
 * 🛡 유튜브에 닿지 않는다 — 업로드 채널을 **이 PC 에 연결되지 않은 가짜 id** 로 둔다(관문이 「연결되지 않았습니다」로 멈춘다).
 *   TTS·ComfyUI·브라우저도 안 쓴다(무음 · 그림은 첨부). 임시 채널·임시 폴더 · 끝나면 지운다 · 채널 목록 파일 전후 비교.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mkup-'));
const TAG = `__만들기업로드테스트_${process.pid}`;
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const CH = '__테스트채널_삭제해도됨_만들기업로드_' + process.pid;
const FAKE_YT = 'UC__priming_test_not_connected__';
const PRESETS = path.join(os.homedir(), '.flow-app', 'tts-presets.json');
const SCRIPT = ['# 만들기 업로드', '', '## 도입부', '### 〔첫 장면〕', '> 🖼️ 이미지: a red room', '첫째 문장입니다. 둘째 문장입니다.', '', '### 〔둘째〕', '> 🖼️ 이미지: a blue room', '셋째 문장입니다.', ''].join('\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

(async () => {
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const FF = require('../core/media-utils').getFfmpegPath();
  const img = path.join(TMP, 'red.png');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xaa2020:s=1920x1080', '-frames:v', '1', img]);
  const presetsBefore = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false;
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await app.evaluate(({ shell }) => { shell.openPath = async () => ''; });   // 완성물을 열지 않는다
    await win.evaluate(async ({ name, dir, yt }) => {
      await window.api.addPreset({ name });
      await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, outUpload: dir, scriptFolder: dir, ytAuto: true, ytChannelId: yt } });
    }, { name: CH, dir: TMP, yt: FAKE_YT });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent.clip', { timeout: 20000 });
    // 그룹 그림 첨부(이미지 게이트 통과)
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, img);
    for (const g of [1, 2]) await win.evaluate(async (gn) => window.api.attachAsset({ shortsNum: 1, groupNum: gn }), g);
    const logText = () => win.evaluate(() => (document.querySelector('#log') || {}).textContent || '');
    const gateHits = async () => ((await logText()).match(/✗ 유튜브 업로드 — 이 채널이 이 PC 에서 연결되지 않았습니다/g) || []).length;
    const make = () => win.evaluate(async (name) => {
      try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 20, aiNotice: false, outTarget: 'mp4', outMode: 'full', openVrew: false }); return 'ok'; }
      catch (e) { return 'ERR: ' + e.message; }
    }, CH);
    const findMp4 = () => { const all = []; const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.mp4$/i.test(f)) all.push(p); } }; walk(TMP); return all; };

    console.log('\n[1] 첫 만들기 — MP4 를 굽고 업로드 관문으로');
    const r1 = await make();
    await win.waitForTimeout(2500);   // 업로드는 기다리지 않고 줄 세운다(뒤에서 돈다)
    const mp4s = findMp4();
    ok(r1 === 'ok' && mp4s.length === 1, `무음 ⚡ 만들기 → 🎬 MP4 (${r1} · ${mp4s.map((f) => path.basename(f)).join(', ')})`);
    const h1 = await gateHits();
    ok(h1 === 1, `MP4 를 구운 뒤 업로드 관문에 한 번 (${h1})`);
    const mt0 = mp4s[0] ? fs.statSync(mp4s[0]).mtimeMs : 0;

    console.log('\n[2] 같은 대본 다시 만들기 — 다시 굽지 않고, 그래도 업로드 관문으로');
    await app.evaluate(({ dialog }) => { global.__asked = 0; dialog.showMessageBox = async () => { global.__asked++; return { response: 0, checkboxChecked: false }; }; });   // 「이미 만든 MP4」 = 건너뛰기(60초 기다리지 않게)
    const r2 = await make();
    await win.waitForTimeout(2500);
    const lt = await logText();
    ok(r2 === 'ok' && /같은 이름의 MP4 가 이미 있어 건너뜁니다/.test(lt) && await app.evaluate(() => global.__asked) === 1, '「같은 이름의 MP4 가 이미 있어 건너뜁니다」(묻고 · 건너뛰기)');
    ok(mp4s[0] && fs.statSync(mp4s[0]).mtimeMs === mt0, 'MP4 는 다시 굽지 않았다(파일 그대로)');
    const h2 = await gateHits();
    ok(h2 === 2, `🔑 다시 굽지 않아도 업로드 관문에 또 간다 — 채널에 없으면 올라간다 (관문 ${h1} → ${h2})`);
    { const M = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
      const a = M.indexOf('이미 있어 다시 만들지 않습니다'), b = M.indexOf('같은 이름의 MP4 가 이미 있어 건너뜁니다');
      ok(a > 0 && /uploadExisting\(\);\s*continue;/.test(M.slice(a, a + 300)) && b > 0 && /uploadExisting\(\); continue;/.test(M.slice(b, b + 200)), '두 출구(「입력이 그대로」 · 「같은 이름 MP4 건너뛰기」) 모두 uploadExisting() — 업로드 관문(중복 검사)으로'); }
    ok(errors.length === 0, `화면 오류 0건 (${errors.join(' | ')})`);
  } catch (e) { fail++; console.log('  ✗ 예외: ' + String((e && e.message) || e).split('\n')[0]); } finally {
    if (chMade) { try { await (await app.firstWindow()).evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    try { await app.close(); } catch (_) {}
    try { fs.rmSync(SNAP, { force: true }); } catch (_) {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    const after = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
    ok(after === presetsBefore, '로이 채널 설정(tts-presets.json) 전후 동일');
    console.log(`\n${fail ? '❌' : '✅'} 만들기 → 업로드 관문 E2E ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
