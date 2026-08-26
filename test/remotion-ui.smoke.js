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

(async () => {
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
  ok(!/baseNameOf/.test(MAIN), 'main.js 에 미정의 식별자 baseNameOf 가 없다');
  ok(MAIN.includes('preset.speedLong'), '배속은 speedLong(모드별 필드)을 본다');
  // 🔴 채널 저장 후 화면이 다시 읽지 않으면 「사전 물려 있지 않습니다」가 남는다(2026-08-26 사고).
  ok(/setPresetRev\(\(r\) => r \+ 1\)/.test(APP), 'saveChannel 이 presetRev 를 올린다');
  ok(/presetRev=\{presetRev\}/.test(APP), 'RemotionView 에 presetRev 를 내려준다');
  {
    const RV = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'RemotionView.jsx'), 'utf8');
    ok(/\[presetName, presetRev\]/.test(RV), 'RemotionView 가 presetRev 를 deps 에 넣는다');
    ok(/await refreshDict\(\)/.test(RV), 'TSV 를 열 때도 사전을 다시 읽는다(안전망)');
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
  }

  console.log('\n' + (bad ? '✗ ' : '✅ ') + '리모션 UI E2E ' + (n - bad) + '/' + n + (bad ? ' 실패 ' + bad : ' 통과'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
