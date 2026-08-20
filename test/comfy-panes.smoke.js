'use strict';
// node test/comfy-panes.smoke.js — ⚙ 설정의 ComfyUI 「🖥 로컬 / ☁ 클라우드」 2분할 패널 E2E.
//   실제 앱을 띄워: 두 칸 렌더 · '지금 사용' 배지가 설정과 일치 · 램프 실측 · 옛 이중 진입점(서버 프로필·
//   클라우드 체크박스·하단 연결테스트)이 사라졌는지 · **설정파일이 변조되지 않았는지** 확인한다.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const NL = String.fromCharCode(10);
const CFG = (f) => path.join(os.homedir(), '.priming-maker', f);
const read = (f) => { try { return JSON.parse(fs.readFileSync(CFG(f), 'utf8')); } catch { return {}; } };

let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };

(async () => {
  const before = { img: read('comfy-image-config.json'), vid: read('comfy-video-config.json') };
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') console.log('[renderer:error]', m.text()); });
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

    // 팝업이 세로 스크롤 없이 들어가는지(⚙ 설정은 탭 UI 라 스크롤이 생기면 안 된다)
    const sc = await win.evaluate(() => { const c = document.querySelector('.modal-card'); return { over: c.scrollHeight - c.clientHeight, h: c.getBoundingClientRect().height, vh: window.innerHeight }; });
    console.log(NL + `  카드 높이 ${Math.round(sc.h)}px / 화면 ${sc.vh}px · 넘침 ${sc.over}px`);
    ok(sc.h < sc.vh, '팝업이 화면 안에 들어간다');
  } finally { await app.close(); }

  // 설정파일이 변조되지 않았는지 (읽기만 하는 화면이어야 한다)
  const after = { img: read('comfy-image-config.json'), vid: read('comfy-video-config.json') };
  for (const k of ['img', 'vid']) {
    for (const f of ['baseUrl', 'cloud', 'apiKey', 'localBaseUrl', 'cloudBaseUrl', 'workflowPath', 'concurrency', 'timeoutSec']) {
      ok(JSON.stringify(before[k][f]) === JSON.stringify(after[k][f]), `${k}.${f} 그대로 (${JSON.stringify(after[k][f] || '').slice(0, 42)})`);
    }
  }
  console.log(NL + (bad ? '❌ ' + bad + '/' + n + ' 실패' : '✅ 2분할 패널 E2E ' + n + '/' + n + ' 통과'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
