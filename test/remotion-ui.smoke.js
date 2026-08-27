'use strict';
// node test/remotion-ui.smoke.js — 🎬 리모션 모드 E2E.
//   로이 요구(2026-08-26)를 실제 앱에서 확인한다:
//     ① 채널 편집 「시작 화면」에 리모션 항목이 있다
//     ② 리모션을 고르면 「자막·분할」·「제작 도구」 탭이 사라진다
//     ③ 폴더 탭의 '롱폼 출력' 이 'MP3 출력' 으로 바뀐다
//     ④ 모드 토글의 🎬 리모션 을 누르면 그 화면이 뜨고 TSV 열기 버튼이 있다
//   🔑 **정규화가 선택을 되돌리지 않는지**도 원문으로 단언한다(v0.3.50 계열 사고).
//   ⚠ 채널 설정을 저장하지 않는다 — 모달을 취소로 닫아 사용자 채널을 건드리지 않는다.

const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');

let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };

const APP = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const MP = fs.readFileSync(path.join(ROOT, 'core', 'mode-profiles.js'), 'utf8');

// 🎧 미리듣기 E2E 용 임시 TSV — 사용자 파일을 열지 않는다. 상한(12) 시험을 위해 넉넉히.
const os = require('os');
const TSV_ROWS = 15;
const TSV_PATH = path.join(os.tmpdir(), 'priming-smoke-' + process.pid + '.tsv');
// 🖼 그림목록 — **헤더 한 줄 + 5칸**(음성 TSV 와 형식이 다르다).
const IMG_ROWS = 4;
const IMG_TSV_PATH = path.join(os.tmpdir(), 'priming-smoke-img-' + process.pid + '.tsv');
fs.writeFileSync(IMG_TSV_PATH,
  ['파일 경로\t장면\t화면 글\tpositive\tnegative'].concat(
    Array.from({ length: IMG_ROWS }, (_, i) =>
      ['999_smoke/S-' + (i + 1) + '.png', 'S-' + (i + 1), '시험 장면 ' + (i + 1),
       'a simple test scene ' + (i + 1) + ', minimal line drawing', 'text, watermark'].join('\t'))
  ).join('\n') + '\n', 'utf8');
fs.writeFileSync(TSV_PATH,
  Array.from({ length: TSV_ROWS }, (_, i) =>
    String(i + 1).padStart(3, '0') + '.mp3\t미리듣기 시험 문장 ' + (i + 1) + '번입니다.').join('\n') + '\n',
  'utf8');

// 🔑 실제 합성은 **GPU 를 쓴다** — 로이가 작업 중이면(서버 busy) 그걸 느리게 만든다(실측 1.7배).
//   그래서 서버 상태를 먼저 보고, 바쁘거나 확인이 안 되면 합성 부분만 건너뛴다.
let SYNTH_OK = false, SYNTH_SKIP = '';
async function checkServerIdle() {
  let key = '', base = 'http://127.0.0.1:9881';
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.flow-app', 'tts-config.json'), 'utf8'));
    base = (c.omnivoice && c.omnivoice.baseUrl) || base;
  } catch { return (SYNTH_SKIP = 'TTS 설정을 읽지 못함'), false; }
  try {
    // provider._authHeaders 와 같은 출처 — 여기가 갈리면 401 로 「확인 불가」가 되어 늘 건너뛴다.
    const sec = require(path.join(ROOT, 'tts', 'secret-store')).get('omnivoice');
    key = (sec && sec.apiKey) || '';
  } catch {}
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/busy', {
      headers: key ? { 'X-API-Key': key } : {}, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return (SYNTH_SKIP = '/busy 응답 ' + r.status + ' (구버전 서버면 확인 불가)'), false;
    const j = await r.json();
    if (j.busy) return (SYNTH_SKIP = '서버가 작업 중(busy)'), false;
    return true;
  } catch (e) { return (SYNTH_SKIP = '서버에 닿지 못함 — ' + e.message), false; }
}

(async () => {
  SYNTH_OK = await checkServerIdle();
  console.log('── 원문 대조 (정규화가 선택을 되돌리지 않는가)');
  ok(/normalizeMode[\s\S]{0,200}remotion/.test(MP), 'normalizeMode 가 remotion 을 통과시킨다');
  ok(MP.includes('remotion: {'), 'MODE_PROFILES 에 remotion 이 있다');
  // 🔴 아래 셋 중 하나라도 빠지면 "골라 저장해도 롱폼으로 되돌아간다".
  ok(/startMode === 'book' \|\| p\.startMode === 'remotion'/.test(APP) || /p\.startMode === 'remotion'/.test(APP),
    'openChannelEditor 정규화가 remotion 을 보존한다');
  ok(/_sm0 === 'remotion'/.test(APP), 'switchModeForChannel 이 remotion 을 보존한다');
  ok(/m === 'book' \|\| m === 'remotion'/.test(APP), 'switchMode 가 remotion 을 보존한다');
  ok(MAIN.includes("remotion: { items: [], activeId: null }"), 'main.js 에 remotion 큐 자리가 있다');
  ok(MAIN.includes("ipcMain.handle('remotion-open-tsv'"), 'remotion-open-tsv IPC 존재');
  ok(MAIN.includes("ipcMain.handle('remotion-run-tts'"), 'remotion-run-tts IPC 존재');
  // 🎧 미리듣기 — 몇 문장만 먼저 만들어 듣는다(2026-08-27).
  ok(MAIN.includes("ipcMain.handle('remotion-preview-tts'"), 'remotion-preview-tts IPC 존재');
  ok(MAIN.includes("enqueueTtsJob('리모션 미리듣기'"), '미리듣기도 같은 TTS 큐를 탄다(같은 GPU — 동시 실행 금지)');
  ok(MAIN.includes("os.tmpdir(), 'priming-tsv-preview'"),
    '🔑 미리듣기는 임시 폴더에 만든다 — MP3 출력 폴더의 _manifest.json 을 오염시키지 않는다');
  ok(MAIN.includes('REMOTION_PREVIEW_MAX'), '한 번에 만들 개수 상한이 있다(실수로 355개를 고르는 것 방지)');
  {
    // 🔑 미리듣기 경로에 force 를 켜면 캐시를 무시해 「빠르게」가 아니게 되고, 전체 만들기에서
    //   재활용도 안 된다. preview 핸들러 본문에 force 가 없어야 한다.
    const i0 = MAIN.indexOf("ipcMain.handle('remotion-preview-tts'");
    const i1 = MAIN.indexOf('// ── 🎬 리모션 내보내기', i0);
    const body = MAIN.slice(i0, i1 > 0 ? i1 : i0 + 4000);
    ok(!/force:/.test(body), '미리듣기는 force 를 켜지 않는다(캐시 재활용 = 빠름 + 결과물과 동일)');
    ok(/trim: args\.trim !== false/.test(body), '무음 트림 설정을 전체 만들기와 똑같이 넘긴다');
  }
  // 🔴 목소리·배속·사전을 읽는 곳이 둘로 갈리면 미리듣기와 결과물이 달라진다 → 한 함수로 모았다.
  ok(MAIN.includes('function _remotionVoiceCfg('), '채널 설정을 읽는 헬퍼가 하나 있다');
  ok(MAIN.includes("ipcMain.handle('remotion-open-out'"), 'remotion-open-out IPC 존재');
  // 🖼 그림 — 강의 76강(D:\비즈니스PT)용. 음성 TSV 와 짝을 이룬다(2026-08-27).
  ok(MAIN.includes("ipcMain.handle('remotion-open-image-tsv'"), 'remotion-open-image-tsv IPC 존재');
  ok(MAIN.includes("ipcMain.handle('remotion-run-images'"), 'remotion-run-images IPC 존재');
  ok(MAIN.includes("enqueueImageJob('리모션 그림 생성'"), '그림도 이미지 큐를 탄다(로컬이면 TTS 와 같은 GPU 레인)');
  ok(/}, 'comfy'\)\);/.test(MAIN), "엔진 'comfy' 를 넘긴다 — 안 넘기면 레인을 안 잡아 TTS 와 겹친다");
  ok(MAIN.includes('REMOTION_IMAGE_SEED = 20260826'), '시드를 고정한다(같은 그림을 다시 뽑을 수 있게)');
  ok(MAIN.includes('REMOTION_IMAGE_DIMS = { w: 1024, h: 1024 }'), '1024x1024 정사각형');
  {
    // 🔑 프롬프트를 앱이 가공하지 않는다 — 화풍이 두 곳에서 관리되면 76강을 가는 동안 어긋난다.
    const i0 = MAIN.indexOf("ipcMain.handle('remotion-run-images'");
    const i1 = MAIN.indexOf('// 📁 출력 폴더 열기', i0);
    const body = MAIN.slice(i0, i1 > 0 ? i1 : i0 + 4000);
    ok(!/stylePrompt|buildImagePrompt/.test(body), '그림 경로는 스타일을 덧붙이지 않는다');
    ok(!/shell\.openPath/.test(body), '끝나도 탐색기를 자동으로 열지 않는다(음성과 같은 정책)');
  }
  {
    const PRE2 = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
    ok(PRE2.includes('remotionOpenImageTsv') && PRE2.includes('remotionRunImages'), 'preload 에 그림 IPC 배선');
  }
  // 🔴 채널에 저장하는 값은 **열 때도 실어야** 한다 — 안 실으면 저장 시 빈 값으로 덮인다(단골 사고).
  ok(APP.includes('outImages: p.outImages'), '채널을 열 때 outImages 를 읽는다');
  ok(APP.includes("outImages: (ch.outImages || '').trim()"), '채널 저장 patch 에 outImages 가 실린다');
  {
    // ⛔ 끝났다고 탐색기를 자동으로 열지 않는다 — 여러 번 돌리면 창이 쌓인다(v0.2.99 롱폼과 같은 정책).
    const i0 = MAIN.indexOf("ipcMain.handle('remotion-run-tts'");
    const i1 = MAIN.indexOf("// 📁 출력 폴더 열기", i0);
    const body = MAIN.slice(i0, i1 > 0 ? i1 : i0 + 6000);
    ok(!/shell\.openPath/.test(body), '리모션 만들기가 끝나도 탐색기를 자동으로 열지 않는다');
  }
  ok((MAIN.match(/_remotionVoiceCfg\(args\.presetName/g) || []).length === 2,
    '전체 만들기와 미리듣기가 **같은 헬퍼**로 목소리·배속·사전을 읽는다');
  {
    const PRE = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
    ok(PRE.includes('remotionPreviewTts'), 'preload 에 remotionPreviewTts 배선');
  }
  ok(!/baseNameOf/.test(MAIN), 'main.js 에 미정의 식별자 baseNameOf 가 없다');
  ok(MAIN.includes('preset.speedLong'), '배속은 speedLong(모드별 필드)을 본다');
  // 🔴 채널 저장 후 화면이 다시 읽지 않으면 「사전 물려 있지 않습니다」가 남는다(2026-08-26 사고).
  ok(/setPresetRev\(\(r\) => r \+ 1\)/.test(APP), 'saveChannel 이 presetRev 를 올린다');
  ok(/presetRev=\{presetRev\}/.test(APP), 'RemotionView 에 presetRev 를 내려준다');
  {
    const RV = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'RemotionView.jsx'), 'utf8');
    ok(/\[presetName, presetRev\]/.test(RV), 'RemotionView 가 presetRev 를 deps 에 넣는다');
    ok(/await refreshDict\(\)/.test(RV), 'TSV 를 열 때도 사전을 다시 읽는다(안전망)');
    ok(/api\.remotionPreviewTts/.test(RV), '화면이 미리듣기 IPC 를 부른다');
    ok(/api\.readAudio/.test(RV), '재생은 read-audio(base64) — 렌더러에서 media:// 가 막히는 문제 우회');
    ok(/function togglePick/.test(RV) && /shiftKey/.test(RV), 'Shift 클릭 범위 선택');
    // 🔑 TSV 를 새로 열면 고른 것·미리듣기 결과를 비운다 — 안 그러면 옛 TSV 의 음성을 듣게 된다.
    ok(/setPicked\(\[\]\); setPreviews\(\{\}\)/.test(RV), 'TSV 를 다시 열면 미리듣기 상태를 비운다');
    // 🔴 제어 checkbox 의 click 기본동작을 막으면 React 가 다음 렌더에서 DOM 에 새 값을 쓰지 않아
    //   **한 박자 늦게** 체크가 나타난다(로이 2026-08-27 실사고). shift 는 click 에서 받아 두고 change 에서 쓴다.
    ok(!/preventDefault\(\); togglePick/.test(RV), '체크박스 click 에서 preventDefault 를 하지 않는다');
    ok(/onChange=\{\(\) => togglePick\(i, shiftRef\.current\)\}/.test(RV), '토글은 onChange 에서 한다');
    ok(/shiftRef\.current = e\.shiftKey/.test(RV), 'Shift 여부는 click 에서 받아 둔다');
    ok(/api\.remotionOpenOut/.test(RV), '「📁 출력 폴더」 버튼이 IPC 를 부른다');
    // 🔴 만든 직후 재생을 `previews`(state)에서 찾으면 **이번 렌더의 옛 값**이라 첫 클릭에 안 들리고
    //   두 번째 클릭에서야 들린다(로이 2026-08-27). 응답의 files 를 그대로 재생해야 한다.
    ok(/playFiles\(r\.files\)/.test(RV), '만든 직후엔 응답(r.files)을 그대로 재생한다');
    ok(!/playOne\(/.test(RV), '이름으로 state 를 되찾아 재생하는 경로가 남아 있지 않다');
    ok(/q\.length\) playFile\(q\.shift\(\)\)/.test(RV),
      '이어 듣기 대기열도 파일 객체 — onended 클로저가 state 를 읽지 않는다(첫 렌더 값에 묶이는 함정)');
  }

  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    const errs = [];
    win.on('console', (m) => { if (m.type() === 'error') { errs.push(m.text()); console.log('[renderer:error]', m.text()); } });
    win.on('pageerror', (e) => { errs.push(String(e.message || e)); console.log('[pageerror]', e.message); });
    await win.waitForSelector('h1', { timeout: 25000 });

    console.log('\n── ④ 모드 토글 · 리모션 화면');
    ok(await win.isVisible('.modetoggle button:has-text("🎬 리모션")'), '모드 토글에 🎬 리모션 버튼');
    await win.click('.modetoggle button:has-text("🎬 리모션")');
    await win.waitForSelector('button:has-text("📄 TSV 열기")', { timeout: 10000 });
    ok(true, '리모션 화면이 뜬다 (📄 TSV 열기)');
    ok(await win.isVisible('button:has-text("🎤 mp3 만들기")'), '🎤 mp3 만들기 버튼');

    // 🔴 채널에 사전이 저장돼 있으면 화면에 그 파일명이 보여야 한다.
    //   2026-08-26 사고: 저장은 정상인데 화면이 「물려 있지 않습니다」를 계속 띄웠다
    //   (presetName 이 안 바뀌어 useEffect 가 재실행되지 않았다).
    //   ⚠ **지금 선택된 채널**의 사전을 봐야 한다 — 아무 채널이나 고르면 엉뚱한 걸 기대하게 된다.
    //     사전이 있는 채널이 따로 있으면 그리로 전환해 로이 시나리오를 재현한다.
    let chDict = '';
    try {
      const all = require(path.join(ROOT, 'tts', 'preset-store')).loadAll();
      const withDict = all.find((p) => p.startMode === 'remotion' && p.dictPath);
      if (withDict) {
        await win.$$eval('select', (els, name) => {
          const s = els.find((e) => Array.from(e.options).some((o) => o.value === name));
          if (s) { s.value = name; s.dispatchEvent(new Event('change', { bubbles: true })); }
        }, withDict.name);
        await win.waitForTimeout(900);
        chDict = withDict.dictPath;
      } else {
        const curName = await win.$eval('select', (s) => s.value).catch(() => '');
        const cur = all.find((p) => p.name === curName);
        chDict = (cur && cur.dictPath) || '';
      }
    } catch {}
    if (chDict) {
      const base = chDict.split(/[\\/]/).pop();
      // 사전 조회는 IPC 왕복이라 잠깐 걸린다 — 나타날 때까지 기다린다(안 뜨면 진짜 버그).
      let shown = false;
      for (let i = 0; i < 20 && !shown; i++) {
        shown = (await win.textContent('body')).includes(base);
        if (!shown) await win.waitForTimeout(250);
      }
      ok(shown, '채널에 저장된 사전(' + base + ')이 화면에 보인다');
    } else {
      ok((await win.textContent('body')).includes('발음사전'), '발음사전 줄이 화면에 있다 (이 PC 채널엔 사전 미지정)');
    }
    const disabled = await win.isDisabled('button:has-text("🎤 mp3 만들기")');
    ok(disabled, 'TSV 를 열기 전에는 만들기가 비활성');
    // 리모션 화면엔 자막·이미지·비디오 UI 가 없어야 한다.
    for (const t of ['🖼 이미지', '🎬 비디오', '💾 .vrew']) {
      ok(!(await win.isVisible('button:has-text("' + t + '")').catch(() => false)),
        '리모션 화면에 「' + t + '」 없음');
    }

    console.log('\n── 🎧 미리듣기 (TSV 열기 · 고르기 · 상한)');
    // dialog 를 스텁해 임시 TSV 를 연다 — 사용자 파일을 건드리지 않는다.
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, TSV_PATH);
    await win.click('button:has-text("📄 TSV 열기")');
    await win.waitForSelector('table tbody tr', { timeout: 10000 });
    const trN = await win.$$eval('table tbody tr', (r) => r.length);
    ok(trN === TSV_ROWS, '표에 ' + TSV_ROWS + '행이 뜬다 (실제 ' + trN + ')');
    ok(await win.isVisible('table thead th:has-text("🎧")'), '표에 고르기(🎧) 열이 있다');
    ok(await win.isDisabled('button:has-text("🎧 미리듣기")'), '아무것도 안 골랐으면 미리듣기 비활성');

    ok(await win.isVisible('button:has-text("📁 mp3 폴더")'), '「📁 mp3 폴더」 버튼이 위에 있다');

    // 1행 체크 → 버튼에 개수가 뜬다
    await win.click('table tbody tr:nth-child(1) input[type="checkbox"]');
    await win.waitForTimeout(200);
    // 🔴 클릭한 **그 순간** 체크 표시가 보여야 한다. 예전엔 다른 곳을 눌러야 그제야 나타났다.
    ok(await win.isChecked('table tbody tr:nth-child(1) input[type="checkbox"]'),
      '클릭 즉시 체크 표시가 보인다 (한 박자 늦던 사고 회귀)');
    ok(await win.isVisible('button:has-text("🎧 미리듣기 (1)")'), '한 개 고르면 「🎧 미리듣기 (1)」');
    ok(!(await win.isDisabled('button:has-text("🎧 미리듣기")')), '고른 뒤엔 활성');

    // Shift 클릭으로 1~5행 범위 선택
    await win.click('table tbody tr:nth-child(5) input[type="checkbox"]', { modifiers: ['Shift'] });
    await win.waitForTimeout(200);
    ok(await win.isVisible('button:has-text("🎧 미리듣기 (5)")'), 'Shift 클릭 = 범위 선택 (1~5행)');
    {
      // 범위 안의 중간 행도 **즉시** 체크돼 보여야 한다(state 와 DOM 이 어긋나지 않는다).
      const mid = await win.isChecked('table tbody tr:nth-child(3) input[type="checkbox"]');
      ok(mid, '범위 선택된 중간 행도 즉시 체크돼 보인다');
    }

    // 🔴 상한 — 13개를 고르고 누르면 **합성하지 않고** 이유를 알려준다.
    for (let i = 6; i <= 13; i++) await win.click('table tbody tr:nth-child(' + i + ') input[type="checkbox"]');
    await win.waitForTimeout(200);
    ok(await win.isVisible('button:has-text("🎧 미리듣기 (13)")'), '13개 고름');
    await win.click('button:has-text("🎧 미리듣기")');
    let capMsg = '';
    for (let i = 0; i < 24 && !capMsg.includes('12개까지'); i++) {
      capMsg = (await win.textContent('#status').catch(() => '')) || '';
      if (!capMsg.includes('12개까지')) await win.waitForTimeout(250);
    }
    ok(capMsg.includes('12개까지'), '상한을 넘기면 만들지 않고 알려준다 (' + capMsg.trim() + ')');

    await win.click('button:has-text("선택 해제")');
    await win.waitForTimeout(200);
    ok(await win.isDisabled('button:has-text("🎧 미리듣기")'), '선택 해제하면 다시 비활성');
    ok(!(await win.isChecked('table tbody tr:nth-child(1) input[type="checkbox"]')),
      '선택 해제하면 체크 표시도 즉시 사라진다');
    // 아직 안 들어본 행은 듣기 칸이 비어 있다(실제 합성은 이 테스트에서 하지 않는다 — GPU·시간).
    ok(!(await win.isVisible('table tbody tr:nth-child(1) button:has-text("▶")').catch(() => false)),
      '미리듣기 전에는 ▶ 버튼이 없다');

    console.log('\n── 🎧 실제 합성 + 재생 (한 번 눌러 들리는가)');
    if (!SYNTH_OK) {
      console.log('  ⏭ 건너뜀 — ' + SYNTH_SKIP + ' (남의 GPU 작업을 방해하지 않는다)');
    } else {
      await win.click('table tbody tr:nth-child(1) input[type="checkbox"]');
      await win.waitForTimeout(150);
      ok(await win.isVisible('button:has-text("🎧 미리듣기 (1)")'), '한 개 고름');
      // 🔑 **한 번만** 누른다 — 예전엔 두 번 눌러야 들렸다.
      await win.click('button:has-text("🎧 미리듣기")');
      let body = '';
      for (let i = 0; i < 120; i++) {   // 문장당 2.4~2.7초 + 서버 warm 여유
        body = await win.textContent('body');
        if (body.includes('재생 중 —')) break;
        await win.waitForTimeout(500);
      }
      ok(body.includes('🎧 미리듣기 1개'), '미리듣기 결과 줄이 뜬다');
      ok(body.includes('재생 중 —'), '🔑 **한 번 눌러** 재생이 시작된다 (두 번 눌러야 하던 사고 회귀)');
      ok(await win.isVisible('table tbody tr:nth-child(1) button:has-text("⏹")'),
        '재생 중인 행의 버튼이 ⏹ 로 바뀐다');
      // 만들어진 파일이 **임시 폴더**에 있어야 한다(MP3 출력 폴더를 오염시키지 않는다).
      const pvDir = path.join(os.tmpdir(), 'priming-tsv-preview');
      ok(fs.existsSync(pvDir), '미리듣기 파일이 임시 폴더에 만들어졌다');
      await win.click('button:has-text("⏹ 정지")').catch(() => {});
      await win.waitForTimeout(200);
      ok(!(await win.textContent('body')).includes('재생 중 —'), '⏹ 정지가 먹는다');
      ok(await win.isVisible('table tbody tr:nth-child(1) button:has-text("▶")'),
        '들은 뒤에는 그 행에 ▶ 가 남는다(다시 듣기)');
    }

    console.log('\n── 🖼 그림목록 (열기 · 표 · 탭)');
    ok(await win.isVisible('button:has-text("🖼 그림목록")'), '「🖼 그림목록」 버튼');
    ok(await win.isVisible('button:has-text("📁 그림 폴더")'), '「📁 그림 폴더」 버튼');
    ok(await win.isDisabled('button:has-text("🖼 그림 만들기")'), '목록을 열기 전에는 만들기 비활성');
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, IMG_TSV_PATH);
    await win.click('button:has-text("🖼 그림목록")');
    await win.waitForSelector('button:has-text("🖼 그림 만들기 (' + IMG_ROWS + ')")', { timeout: 10000 });
    ok(true, '그림 ' + IMG_ROWS + '장을 읽었다(헤더 한 줄은 건너뛴다)');
    ok(!(await win.isDisabled('button:has-text("🖼 그림 만들기")')), '읽은 뒤엔 만들기 활성');
    {
      const body = await win.textContent('body');
      ok(body.includes('999_smoke/S-1.png'), '표에 저장 경로가 보인다');
      ok(body.includes('시험 장면 1'), '표에 화면 글이 보인다');
      ok(body.includes('1024x1024'), '해상도를 화면에 알린다');
      ok(body.includes('이미 있는 파일은 건너뜁니다'), '이어받기 규칙을 화면에 알린다');
    }
    // 음성·그림 둘 다 열려 있으므로 탭이 나와야 한다.
    ok(await win.isVisible('button:has-text("🎤 음성 ' + TSV_ROWS + '행")'), '음성 탭');
    ok(await win.isVisible('button:has-text("🖼 그림 ' + IMG_ROWS + '장")'), '그림 탭');
    await win.click('button:has-text("🎤 음성 ' + TSV_ROWS + '행")');
    await win.waitForTimeout(250);
    ok((await win.textContent('body')).includes('미리듣기 시험 문장 1번입니다.'), '음성 탭으로 돌아간다');
    ok(!(await win.textContent('body')).includes('999_smoke/S-1.png'), '그림 표는 숨는다');
    // ⚠ 실제 그림 생성은 여기서 하지 않는다 — GPU 를 쓴다(장당 20초 실측).

    console.log('\n── ①②③ 채널 편집');
    await win.click('.modetoggle button:has-text("롱폼")');
    await win.waitForTimeout(400);
    await win.click('button[title*="채널"], button:has-text("⚙")');
    await win.waitForSelector('.modal-card.tabbed', { timeout: 10000 });
    const sel = '.modal-card.tabbed select';
    const opts = await win.$$eval(sel, (els) => {
      const s = els.find((e) => Array.from(e.options).some((o) => o.value === 'longform'));
      return s ? Array.from(s.options).map((o) => o.value) : [];
    });
    ok(opts.includes('remotion'), '① 시작 화면에 remotion 항목 (' + opts.join(',') + ')');

    // 리모션으로 바꿔 탭·라벨을 본다. ⚠ 저장하지 않고 취소로 닫는다.
    await win.$$eval(sel, (els) => {
      const s = els.find((e) => Array.from(e.options).some((o) => o.value === 'remotion'));
      if (s) { s.value = 'remotion'; s.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await win.waitForTimeout(400);
    const tabs = await win.$$eval('.modal-card.tabbed .tabbar button', (b) => b.map((x) => x.textContent.trim()));
    ok(!tabs.some((t) => t.includes('자막')), '② 「자막·분할」 탭 사라짐 (' + tabs.join(' / ') + ')');
    ok(!tabs.some((t) => t.includes('제작 도구')), '② 「제작 도구」 탭 사라짐');
    ok(tabs.some((t) => t.includes('음성')), '  「음성」 탭은 남아 있다(목소리·배속을 여기서 정한다)');
    ok(tabs.some((t) => t.includes('폴더')), '  「폴더」 탭은 남아 있다');

    await win.click('.modal-card.tabbed .tabbar button:has-text("📁 폴더")');
    await win.waitForTimeout(300);
    const labels = await win.$$eval('.modal-card.tabbed .tabbody label', (l) => l.map((x) => x.textContent.trim()));
    ok(labels.some((t) => t.includes('MP3 출력')), '③ 「MP3 출력」 라벨 (' + labels.join(' / ') + ')');
    ok(!labels.some((t) => t.includes('롱폼 출력')), '③ 「롱폼 출력」 라벨 사라짐');
    // 🔴 발음사전 — 물리는 칸이 없으면 사전이 **조용히 무시**된다(처음 만들 때 실제로 빠뜨렸다).
    ok(labels.some((t) => t.includes('발음사전')), '발음사전 칸이 폴더 탭에 있다');
    ok(labels.some((t) => t.includes('이미지 출력')), '🖼 이미지 출력 칸이 폴더 탭에 있다');
    ok(APP.includes('dictPath: (ch.dictPath'), '저장 patch 에 dictPath 가 실린다');
    ok(APP.includes('dictPath: p.dictPath'), '열 때 dictPath 를 읽는다 (안 실으면 저장 시 빈 값으로 덮인다)');
    ok(MAIN.includes('args.dictPath || preset.dictPath'), 'main 이 채널 사전을 기본값으로 쓴다');
    const RVX = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'RemotionView.jsx'), 'utf8');
    ok(!/setDictPath/.test(RVX), '쓰지 않는 dictPath 상태가 남아 있지 않다');
    ok(/window\.confirm/.test(RVX), '사전 없이 만들려 하면 한 번 물어본다');

    await win.click('.modal-card.tabbed .mbtns button:has-text("취소")');
    await win.waitForTimeout(300);

    console.log('\n── 화면 오류');
    ok(errs.length === 0, '렌더러 오류 0건' + (errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''));
  } finally {
    await app.close().catch(() => {});
    try { fs.rmSync(TSV_PATH, { force: true }); } catch {}
    try { fs.rmSync(IMG_TSV_PATH, { force: true }); } catch {}
  }

  console.log('\n' + (bad ? '✗ ' : '✅ ') + '리모션 UI E2E ' + (n - bad) + '/' + n + (bad ? ' 실패 ' + bad : ' 통과'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
