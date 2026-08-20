'use strict';
// node test/comfy-panes.smoke.js — ⚙ 설정의 ComfyUI 「🖥 로컬 / ☁ 클라우드」 2분할 패널 E2E.
//   실제 앱을 띄워: 두 칸 렌더 · '지금 사용' 배지가 설정과 일치 · 램프 실측 · 옛 이중 진입점(서버 프로필·
//   클라우드 체크박스·하단 연결테스트)이 사라졌는지 · **설정파일이 변조되지 않았는지** 확인한다.
//   ⚠ 헤더 드롭다운 왕복 검사는 워크플로 **절대경로**를 실행 위치 기준으로 바꿔 놓는다(개발 실행이면 D:Primingcomfy).
//     설치본은 `comfy-image._ensureBundled` 가 설치폴더 경로로 자동 교정하므로 무해하다(그래서 파일명으로 비교한다).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);
// 경로는 실행 위치(개발/설치본)마다 달라 **파일명**으로 비교한다. 정규식 대신 split 2번(역슬래시·슬래시).
const CFG = (f) => path.join(os.homedir(), '.priming-maker', f);
const read = (f) => { try { return JSON.parse(fs.readFileSync(CFG(f), 'utf8')); } catch { return {}; } };

let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };

const APP = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');

(async () => {
  const before = { img: read('comfy-image-config.json'), vid: read('comfy-video-config.json') };
  console.log('── 헤더 드롭다운 처리 함수(App.jsx 원문)');
  for (const fn of ['onPickImgEngine', 'pickComfy', 'onPickVideoEngine', 'parseComfyVal']) {
    ok(APP.includes('function ' + fn + '('), fn + ' 정의됨');
  }
  for (const c of ['comfySelectValue', 'mkComfyVal']) ok(APP.includes('const ' + c + ' ='), c + ' 정의됨');
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    const errs = [];
    win.on('console', (m) => { if (m.type() === 'error') { errs.push(m.text()); console.log('[renderer:error]', m.text()); } });
    win.on('pageerror', (e) => { errs.push(String(e.message || e)); console.log('[pageerror]', e.message); });
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.click('button:has-text("⚙ 설정")');
    await win.waitForSelector('.modal-card .split2', { timeout: 10000 });

    for (const [tab, kind, cfg] of [['🖼 ComfyUI 이미지', 'img', before.img], ['🎬 ComfyUI 비디오', 'vid', before.vid]]) {
      console.log(NL + '── ' + tab);
      await win.click(`.modal-card button:has-text("${tab}")`);
      await win.waitForTimeout(300);
      const r = await win.evaluate(() => {
        const card = document.querySelector('.modal-card');
        const panes = [...card.querySelectorAll('.tpane')].map((p) => ({
          head: (p.querySelector('.thead') || {}).textContent || '',
          on: p.classList.contains('on'),
          url: (p.querySelector('input') || {}).value || '',
          hasKey: !!p.querySelector('input[type=password]'),
        }));
        return {
          panes,
          nowuse: (card.querySelector('.nowuse') || {}).textContent || '',
          selects: [...card.querySelectorAll('select')].length,
          checkboxes: [...card.querySelectorAll('input[type=checkbox]')].length,
          text: card.innerText,
        };
      });
      ok(r.panes.length === 2, '칸 2개 (로컬·클라우드): ' + r.panes.map((p) => p.head).join(' / '));
      ok(r.panes[0].head.includes('로컬') && r.panes[1].head.includes('클라우드'), '왼쪽=로컬 · 오른쪽=클라우드');
      ok(!r.panes[0].hasKey && r.panes[1].hasKey, 'API 키 칸은 클라우드에만');
      const onIdx = r.panes.findIndex((p) => p.on);
      ok(onIdx === (cfg.cloud ? 1 : 0), `'지금 사용' 배지가 설정(cloud=${!!cfg.cloud})과 일치`);
      ok(r.panes[onIdx].head.includes('지금 사용'), '지금 쓰는 칸에 배지 표시');
      ok(r.panes[0].url === (cfg.localBaseUrl || ''), '로컬 주소 = 설정값 ' + r.panes[0].url);
      ok(r.panes[1].url === (cfg.cloudBaseUrl || ''), '클라우드 주소 = 설정값 ' + r.panes[1].url);
      ok(r.nowuse.includes(cfg.cloud ? '클라우드' : '로컬'), '「지금 보내는 곳」 표시: ' + r.nowuse.split('—')[0].trim());
      ok(r.selects === 0, '옛 「서버 프로필」 드롭다운 없음');
      ok(!r.text.includes('클라우드(comfy.org)') || !/클라우드(comfy.org)$/m.test(r.text), '옛 「클라우드」 체크박스 라벨 없음');
      ok(!r.text.includes('연결 테스트'), '하단 중복 「연결 테스트」 버튼 없음(각 칸의 🔌 테스트로 통일)');
      ok(!/동시[ ]*생성[sS]{0,40}input/.test(r.text), '「동시 생성」 입력칸 없음');

      // 램프 — 열 때 자동 실측한 결과가 채워질 때까지 기다린다
      await win.waitForFunction(() => {
        const l = [...document.querySelectorAll('.modal-card .lamp')];
        return l.length === 2 && l.every((x) => !x.className.includes('ing'));
      }, null, { timeout: 20000 }).catch(() => {});
      const lamps = await win.evaluate(() => [...document.querySelectorAll('.modal-card .lamp')].map((x) => x.className.replace('lamp ', '') + ':' + x.textContent));
      console.log('  램프 → ' + lamps.join(' | '));
      ok(lamps.length === 2 && lamps.every((x) => !x.startsWith('idle')), '두 칸 모두 자동 실측됨(미확인 아님)');

      // 🔌 테스트 버튼도 실제로 동작하는지(지금 쓰는 쪽)
      await win.click(`.modal-card .tpane:nth-child(${onIdx + 1}) button:has-text("테스트")`);
      await win.waitForTimeout(1200);
      const one = await win.evaluate((k) => (document.querySelectorAll('.modal-card .lamp')[k] || {}).className || '', onIdx);
      ok(/ok|no/.test(one), '🔌 테스트 클릭 → 결과 갱신 (' + one + ')');
    }

    // ── 헤더 드롭다운 왕복 — ☁↔🖥 전환이 실제로 설정을 바꾸고 팝업 배지가 따라오는지 ──
    await win.click('.modal-card button:has-text("닫기")');
    for (const [kind, file, cfg0] of [['image', 'comfy-image-config.json', before.img], ['video', 'comfy-video-config.json', before.vid]]) {
      const sel = kind === 'image' ? '.hgroup select[title^="이미지 생성 방식"]' : '.hgroup select[title^="i2v 비디오 엔진"]';
      const cur = await win.locator(sel).inputValue();
      const opts = await win.locator(sel + ' option').evaluateAll((os) => os.map((o) => o.value));
      if (cur.indexOf('comfy::') !== 0) { console.log('  (건너뜀 — 지금 ComfyUI 가 아님: ' + kind + ')'); continue; }
      const want = cur.indexOf('::cloud::') > 0 ? cur.replace('::cloud::', '::local::') : cur.replace('::local::', '::cloud::');
      const base = (x) => String(x || "").split(BS).pop().split("/").pop();
      if (!opts.includes(want)) { console.log('  (건너뜀 — 반대쪽 옵션 없음: ' + kind + ')'); continue; }
      await win.locator(sel).selectOption(want);
      await win.waitForTimeout(700);
      const after1 = read(file);
      ok(!!after1.cloud === !cfg0.cloud, `${kind} 드롭다운 전환 → 설정 cloud=${!!after1.cloud} (기대 ${!cfg0.cloud})`);
      ok(after1.baseUrl === (after1.cloud ? after1.cloudBaseUrl : after1.localBaseUrl), `${kind} baseUrl 이 그쪽 주소로 갱신`);
      ok(base(after1.workflowPath) === base(cur.split('::').slice(2).join('::')), `${kind} 모델(워크플로) 유지 — ${base(after1.workflowPath)}`);
      // 팝업 배지가 따라오는지
      await win.click('button:has-text("⚙ 설정")');
      await win.click(`.modal-card button:has-text("${kind === 'image' ? '🖼 ComfyUI 이미지' : '🎬 ComfyUI 비디오'}")`);
      await win.waitForTimeout(400);
      const onIdx2 = await win.evaluate(() => [...document.querySelectorAll('.modal-card .tpane')].findIndex((p) => p.classList.contains('on')));
      ok(onIdx2 === (after1.cloud ? 1 : 0), `${kind} 「지금 사용」 배지가 전환을 따라옴`);
      await win.click('.modal-card button:has-text("닫기")');
      // 원래대로 되돌린다(사용자 설정 보존)
      await win.locator(sel).selectOption(cur);
      await win.waitForTimeout(700);
      const back = read(file);
      ok(!!back.cloud === !!cfg0.cloud, `${kind} 원래 상태로 복구 (cloud=${!!back.cloud})`);
    }
    ok(errs.length === 0, '화면 오류(ReferenceError 등) 0건' + (errs.length ? ': ' + errs[0] : ''));

    await win.click('button:has-text("⚙ 설정")');
    await win.waitForSelector('.modal-card .split2', { timeout: 10000 });
    // 팝업이 세로 스크롤 없이 들어가는지(⚙ 설정은 탭 UI 라 스크롤이 생기면 안 된다)
    const sc = await win.evaluate(() => { const c = document.querySelector('.modal-card'); return { over: c.scrollHeight - c.clientHeight, h: c.getBoundingClientRect().height, vh: window.innerHeight }; });
    console.log(NL + `  카드 높이 ${Math.round(sc.h)}px / 화면 ${sc.vh}px · 넘침 ${sc.over}px`);
    ok(sc.h < sc.vh, '팝업이 화면 안에 들어간다');
  } finally { await app.close(); }

  // 설정파일이 변조되지 않았는지 (읽기만 하는 화면이어야 한다)
  const after = { img: read('comfy-image-config.json'), vid: read('comfy-video-config.json') };
  for (const k of ['img', 'vid']) {
    const bn = (x) => (typeof x === "string" ? x.split(BS).pop().split("/").pop() : x);
    for (const f of ['baseUrl', 'cloud', 'apiKey', 'localBaseUrl', 'cloudBaseUrl', 'workflowPath', 'concurrency', 'timeoutSec']) {
      const cmp = f === 'workflowPath' ? bn : ((x) => x);
      ok(JSON.stringify(cmp(before[k][f])) === JSON.stringify(cmp(after[k][f])), `${k}.${f} 그대로 (${JSON.stringify(cmp(after[k][f]) || '').slice(0, 42)})`);
    }
  }
  // 왕복 검사가 바꿔 놓은 워크플로 **절대경로**를 원래 값으로 되돌린다 — 테스트가 사용자 설정을 남기지 않게.
  //   (개발 실행이면 D:Primingcomfy… 로 바뀐다. 설치본은 _ensureBundled 가 교정하지만 굳이 남길 이유가 없다)
  for (const [k, f] of [['img', 'comfy-image-config.json'], ['vid', 'comfy-video-config.json']]) {
    const now = read(f);
    if (before[k].workflowPath && now.workflowPath !== before[k].workflowPath) {
      now.workflowPath = before[k].workflowPath;
      try { fs.writeFileSync(CFG(f), JSON.stringify(now, null, 2)); console.log('  ↺ ' + k + '.workflowPath 원래 경로로 복구'); } catch (e) { console.log('  ⚠ 복구 실패: ' + e.message); }
    }
  }
  console.log(NL + (bad ? '❌ ' + bad + '/' + n + ' 실패' : '✅ 2분할 패널 E2E ' + n + '/' + n + ' 통과'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
