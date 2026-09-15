'use strict';
// node scripts/make-whiteboard-sample.js [--long 640]
//
// ✏ **화이트보드 MP4 샘플을 한 번에 만든다** — docs/화이트보드-샘플대본.md 를 열어
//   ① TTS → ② 이미지(로컬 ComfyUI · 연필 스케치) → ③ 화이트보드 렌더 까지 실제 앱 IPC 로 돌린다.
//   결과: output/화이트보드샘플/<대본이름>/<대본이름>_whiteboard.mp4 (⚠ 5단계 전이라 **무음**)
//
// 안전장치(makeall-dry.smoke.js 와 같은 방식):
//   · **임시 채널**(이름에 pid)을 만들어 출력 폴더를 output/ 아래로 돌린다 → 사용자의 G: 작업물 무변경.
//     목소리·배속은 기존 채널에서 복사한다(샘플이라도 길이가 실제와 비슷해야 장면 분할이 의미 있다).
//   · 관문 A/B 는 dialog 를 스텁해 자동 승인한다(무인 실행).
//   · 화이트보드 긴변은 **640(시험)** 으로 낮춘다 — 끝나면 원래 설정으로 되돌린다.
const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'docs', '화이트보드-샘플대본.md');
const OUT = path.join(ROOT, 'output', '화이트보드샘플');     // output/ 은 .gitignore
const CH = '__샘플채널_삭제해도됨_' + process.pid;
const LONG = (() => { const i = process.argv.indexOf('--long'); return i > 0 ? parseInt(process.argv[i + 1], 10) || 640 : 640; })();
// 🔴 실측(2026-09-16): 앱 스타일 'sketch'(연필 스케치)는 **해칭·음영이 꽉 차** 화이트보드에 부적합했다
//   (게다가 빈 화면을 싫어해 요청하지 않은 인물 4명을 그려 넣었다). 화이트보드 화풍은 3단계 미구현이므로
//   **스타일을 끄고 대본 프롬프트에 직접 선화를 서술**한다 — 3단계가 할 일을 임시로 흉내 내는 것이다.
const STYLE = (() => { const i = process.argv.indexOf('--style'); const v = i > 0 ? process.argv[i + 1] : 'none'; return v === 'none' ? null : v; })();
const FRESH = process.argv.includes('--fresh');   // 출력 폴더를 비우고 처음부터 (프롬프트를 바꿨을 때)

const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
(async () => {
  if (!fs.existsSync(SCRIPT_PATH)) throw new Error('샘플 대본이 없습니다: ' + SCRIPT_PATH);
  if (FRESH && fs.existsSync(OUT)) { fs.rmSync(OUT, { recursive: true, force: true }); console.log(`· 출력 폴더를 비웠다: ${OUT}`); }
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false, wbSaved = null;
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') console.log('[renderer:error]', m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });
    console.log('· 앱 부팅 ' + el());

    // ① 임시 채널 — 목소리는 기존 채널에서 복사, 출력 폴더만 샘플 폴더로
    const src = await win.evaluate(async () => {
      const ps = (await window.api.listPresets()) || [];
      for (const nm of ps.map((p) => p.name).filter((x) => x.indexOf('__샘플채널_삭제해도됨') === 0)) {
        try { await window.api.removePreset({ name: nm }); } catch (_) {}
      }
      const first = ps.find((p) => !/출판|리모션/.test(p.name)) || ps[0];
      return first ? await window.api.getPresetDetail(first.name) : null;
    });
    if (!src) throw new Error('복사할 채널이 없습니다');
    await win.evaluate(async ({ name }) => { await window.api.addPreset({ name }); }, { name: CH });
    chMade = true;
    await win.evaluate(async ({ name, dir, s }) => {
      await window.api.savePreset({ name, patch: {
        outputFolder: dir, outLong: dir, scriptFolder: dir,
        engine: s.engine, voiceCloneRefAudio: s.voiceCloneRefAudio, voiceCloneRefText: s.voiceCloneRefText,
        seed: s.seed, speedLong: s.speedLong, silenceSec: s.silenceSec, normalizeDb: s.normalizeDb,
      } });
    }, { name: CH, dir: OUT, s: src });
    console.log('· 임시 채널 「' + CH + '」 — 목소리 ' + (src.voiceCloneRefAudio || '(기본)') + ' ' + el());

    // ② 대본 열기
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, SCRIPT_PATH);
    const opened = await win.evaluate(async (name) => {
      const r = await window.api.openScript({ presetName: name });
      return r && r.dto ? { groups: (r.dto.projects[0].cuts || []).length, outRoot: r.outRoot } : null;
    }, CH);
    console.log('· 대본 열기 — 장면(그룹) ' + opened.groups + '개 · 출력 ' + opened.outRoot + ' ' + el());

    // ③ TTS — 화이트보드는 **무음 MP4** 지만 장면 길이가 TTS 로 정해지므로 반드시 필요하다
    const tts = await win.evaluate(async (name) => {
      try { await window.api.ttsBuild({ presetName: name, speed: 1.15 }); return 'ok'; } catch (e) { return 'ERR ' + e.message; }
    }, CH);
    console.log('· TTS ' + tts + ' ' + el());

    // ④ 이미지 — 로컬 ComfyUI(앱 활성 워크플로) + 연필 스케치 스타일
    const img = await win.evaluate(async (styleId) => {
      try { await window.api.imageBuild({ engine: 'comfy', styleId }); return 'ok'; } catch (e) { return 'ERR ' + e.message; }
    }, STYLE);
    console.log('· 이미지 ' + img + ' ' + el());

    // ⑤ 화이트보드 렌더 — 긴변을 낮추고(시험) 관문 A/B 를 자동 승인
    wbSaved = await win.evaluate(async () => await window.api.getWhiteboardConfig());
    await win.evaluate(async (cap) => { await window.api.setWhiteboardConfig({ capLongEdge: cap }); }, LONG);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_w, o) => {
        const t = (o && o.title) || '';
        if (/관문 A/.test(t)) return { response: 0 };   // 다음 (확인 그림 만들기)
        if (/관문 B/.test(t)) return { response: 1 };   // ✏ 렌더 시작
        return { response: 0 };
      };
    });
    console.log('· 화이트보드 렌더 시작 (긴변 ' + LONG + ') — 몇 분 걸립니다 ' + el());
    const wb = await win.evaluate(async () => {
      try { await window.api.whiteboardBuild({}); return 'ok'; } catch (e) { return 'ERR ' + e.message; }
    });
    console.log('· 화이트보드 ' + wb + ' ' + el());

    // ⑥ 결과 확인
    const log = await win.evaluate(() => (document.querySelector('#log') || {}).textContent || '');
    const base = path.basename(SCRIPT_PATH).replace(/\.md$/, '');
    const dir = path.join(OUT, base);
    const found = [];
    const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else if (/\.mp4$/i.test(f)) found.push([p, st.size]); } };
    if (fs.existsSync(dir)) walk(dir);
    console.log('\n── 결과 ──');
    for (const [p, s] of found) console.log('  ' + p + '  (' + (s / 1048576).toFixed(1) + ' MB)');
    if (!found.length) {
      console.log('  (mp4 없음) 로그 끝부분:');
      console.log(log.split('\n').slice(-25).map((l) => '   ' + l).join('\n'));
    }
  } finally {
    try {
      const win2 = await app.firstWindow();
      if (wbSaved) await win2.evaluate(async (c) => { await window.api.setWhiteboardConfig({ capLongEdge: c }); }, wbSaved.capLongEdge);
      if (chMade) await win2.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, CH);
    } catch (_) {}
    await app.close();
    console.log('· 정리 완료 ' + el());
  }
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
