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
const menu = require('./_menu');
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

    // ☁/🖥 보기(v0.9.38 · 로이 「ComfyUI 설정이 복잡하다」) — 고른 쪽 칸 하나만 · 숨긴 쪽 값은 그대로 · 고급은 접힘
    await win.click('.modal-card button:has-text("🎛 ComfyUI")');
    await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="comfy-view"] button').count() === 2, '보기 단추 ☁ 클라우드 / 🖥 로컬');
    const defView = await win.evaluate(() => (document.querySelector('[data-testid="comfy-view"] button.on') || {}).dataset.view);
    ok(defView === (before.img.cloud === false ? 'local' : 'cloud'), '기본 보기 = 이미지가 지금 쓰는 쪽 (' + defView + ')');
    for (const view of ['cloud', 'local']) {
      await win.click('[data-testid="comfy-view"] button[data-view="' + view + '"]');
      await win.waitForTimeout(300);
      for (const [kind, cfg] of [['img', before.img], ['vid', before.vid]]) {
        console.log(NL + '── 보기 ' + view + ' · ' + kind);
        const r = await win.evaluate((k) => {
          const card = document.querySelector('.modal-card [data-sec="' + k + '"]');
          const panes = [...card.querySelectorAll('.tpane')].map((p) => ({
            head: (p.querySelector('.thead') || {}).textContent || '',
            on: p.classList.contains('on'),
            url: (p.querySelector('input') || {}).value || '',
            hasKey: !!p.querySelector('input[type=password]'),
          }));
          return { panes, nowuse: (card.querySelector('.nowuse') || {}).textContent || '', selects: [...card.querySelectorAll('select')].length, text: card.innerText,
            chips: [...card.querySelectorAll('.frow span[title]')].map((x) => x.textContent) };
        }, kind);
        ok(r.panes.length === 1, '칸 1개: ' + r.panes.map((p) => p.head).join(' / '));
        const isCloud = view === 'cloud';
        ok(r.panes[0].head.includes(isCloud ? '클라우드' : '로컬'), '보기에 맞는 칸');
        ok(r.panes[0].hasKey === isCloud, 'API 키 칸은 클라우드 보기에만');
        ok(r.panes[0].url === ((isCloud ? cfg.cloudBaseUrl : cfg.localBaseUrl) || ''), '주소 = 설정값 ' + r.panes[0].url);
        ok(r.panes[0].on === (isCloud === !!cfg.cloud), '「지금 사용」 배지는 실제 설정을 따른다(보기와 무관)');
        ok(r.nowuse.includes(cfg.cloud ? '클라우드' : '로컬'), '「지금 보내는 곳」 = 실제 설정: ' + r.nowuse.split('—')[0].trim());
        ok(r.selects === (kind === 'vid' ? 1 : 0), '옛 서버 프로필 드롭다운 없음 (select ' + r.selects + ')');
        ok(!/프롬프트 노드|타임아웃\(초\)/.test(r.text), '프롬프트 노드·타임아웃은 「⚙ 고급」 안에 접혀 있다');
        ok(!/동시[ ]*생성[\s\S]{0,40}input/.test(r.text) && !/2장 동시|3개 동시/.test(r.text), '동시 생성은 칸·줄이 아니라 Hint 설명');
        if (kind === 'img') ok(/인물 일관성\(Qwen\)/.test(r.text) === !isCloud, '👤 인물 일관성(Qwen 로컬 전용)은 로컬 보기에만');
        if (kind === 'vid') ok(r.text.includes('영상 업스케일') && r.text.includes('최대 길이'), '비디오: 최대 길이 · 영상 업스케일은 그대로 보인다');
        ok(!r.chips.some((c) => isCloud ? /\((로컬|local)\)/i.test(c) : /\((클라우드|cloud)\)/i.test(c)), '반대쪽 전용 워크플로 칩은 숨긴다: ' + r.chips.join(', '));
        await win.waitForFunction((kd) => { const l = [...document.querySelectorAll('.modal-card [data-sec="' + kd + '"] .lamp')]; return l.length === 1 && !l[0].className.includes('ing'); }, kind, { timeout: 20000 }).catch(() => {});
        const lamp = await win.evaluate((kd) => (document.querySelector('.modal-card [data-sec="' + kd + '"] .lamp') || {}).className || '', kind);
        ok(/ok|no/.test(lamp), '보이는 칸이 자동 실측됨 (' + lamp + ')');
      }
    }
    await win.click('.modal-card [data-testid="comfy-adv-img"] summary');
    await win.waitForTimeout(200);
    ok(/프롬프트 노드/.test(await win.locator('.modal-card [data-sec="img"]').innerText()), '「⚙ 고급」을 펼치면 프롬프트 노드 칸이 보인다');
    await win.click('[data-testid="comfy-view"] button[data-view="' + defView + '"]');

    // ── 헤더 드롭다운 왕복 — ☁↔🖥 전환이 실제로 설정을 바꾸고 팝업 배지가 따라오는지 ──
    await win.click('.modal-card button:has-text("닫기")');
    // 비디오 드롭다운에 🖥 로컬 항목이 **있어야** 한다(2026-08-20 오후 로이: "비디오에서 로컬 LTX2.5도 추가해줘")
    await menu(win, 'video');
    const vidOpts = await win.locator('.hgroup select[data-testid="video-engine"] option').evaluateAll((os) => os.map((o) => o.value + '|' + o.textContent));
    ok(vidOpts.some((o) => o.includes('::local::')), '비디오 드롭다운에 로컬 항목 있음');
    ok(vidOpts.some((o) => o.includes('🖥')), '비디오 드롭다운에 🖥 표시 있음');
    ok(vidOpts.some((o) => o.includes('::cloud::')), '비디오 드롭다운에 클라우드 항목도 있다');
    ok(vidOpts.some((o) => /::local::.*LTX2\.5/.test(o)), '🖥 로컬 × LTX2.5 조합이 목록에 있다: '
       + (vidOpts.filter((o) => o.includes('::local::')).map((o) => o.split('|')[1]).join(', ') || '(없음)'));
    // ☁ MiniMax H3 레퍼런스(클라우드) — 2026-08-30 신설. 번들 등록만으로 드롭다운에 떠야 한다
    //   (ComfyUI 워크플로는 하드코딩 <option> 이 아니라 목록 기반이라 헤더·채널편집 양쪽에 자동 반영된다).
    ok(vidOpts.some((o) => /::cloud::.*MiniMax H3 레퍼런스/.test(o)),
       '☁ 클라우드 × MiniMax H3 레퍼런스 조합이 목록에 있다: '
       + (vidOpts.filter((o) => o.includes('::cloud::')).map((o) => o.split('|')[1]).join(', ') || '(없음)'));
    await menu(win, 'image');
    const imgOpts = await win.locator('.hgroup select[title^="이미지 생성 방식"] option').evaluateAll((os) => os.map((o) => o.value));
    ok(imgOpts.some((o) => o.includes('::local::')) && imgOpts.some((o) => o.includes('::cloud::')),
       '이미지 드롭다운은 로컬·클라우드 둘 다 유지');
    // ── 🌐 브라우저 이미지 — 옛 「⚙ 이미지 순환」 모달을 없애고 드롭다운·설정탭으로 분리 (2026-08-26 로이 요청) ──
    //   ① 드롭다운은 Flow·Genspark 로 분리(고른 쪽이 먼저 돌고 한도면 다른 쪽이 이어받는다)
    //   ② 이미지 줄 ⚙ 버튼은 1개(옛 ⚙순환 + ⚙ComfyUI 두 개를 통합)
    //   ③ LoRA 수집은 ⚙ 설정 → 🌐 브라우저 이미지 탭으로 이동
    const imgPairs = await win.locator('.hgroup select[title^="이미지 생성 방식"] option').evaluateAll((os) => os.map((o) => o.value + '|' + o.textContent));
    ok(imgPairs.some((o) => o.startsWith('flow|')), '이미지 드롭다운에 Flow 항목: ' + (imgPairs.find((o) => o.startsWith('flow|')) || ''));
    ok(imgPairs.some((o) => o.startsWith('genspark|')), '이미지 드롭다운에 Genspark 항목: ' + (imgPairs.find((o) => o.startsWith('genspark|')) || ''));
    ok(!imgPairs.some((o) => o.startsWith('rotate|')), '옛 「순환(무료)」 항목 없음');
    // ── 「(로컬)」 중복 제거 (로이 2026-09-16: "컴피유아이에 로컬이 있는 이유는? 중복이면 제거해") ──
    //   optgroup 이 이미 로컬/클라우드를 가르므로 **이름 접미사 「(로컬)」 은 표시에서 떼고**,
    //   그 워크플로(= 클라우드에 없는 모델)는 ☁ 그룹에서 **아예 감춘다**(고르면 반드시 실패하는 항목).
    const imgComfy = imgPairs.filter((o) => o.indexOf('comfy::') === 0);
    // ⚠ 🖥 는 서로게이트 페어라 문자 클래스 [☁🖥] 로는 반쪽만 지워진다 → 대안(|)으로 통째 제거.
    const labelOf = (o) => (o.split('|')[1] || '').replace(/^(?:☁|🖥)\s*/u, '').trim();
    ok(!imgComfy.some((o) => /\((?:로컬|local)\)/i.test(labelOf(o))),
       '드롭다운 라벨에 「(로컬)」 접미사 없음: ' + imgComfy.map(labelOf).join(' / '));
    const side = (k) => imgComfy.filter((o) => o.includes('::' + k + '::')).map(labelOf);
    const cloudNames = side('cloud'), localNames = side('local');
    ok(cloudNames.length && localNames.length, '☁·🖥 양쪽 모두 항목이 있다');
    ok(cloudNames.every((nm) => localNames.includes(nm)), '☁ 목록 ⊆ 🖥 목록 (클라우드에만 있는 유령 항목 없음)');
    // 설정에 로컬 전용(이름 끝 「(로컬)」) 워크플로가 있으면 ☁ 에서 빠져 있어야 한다.
    //   ⚠ 지금 클라우드를 쓰고 그 워크플로가 선택돼 있으면 일부러 보여 주므로(빈칸 방지) 그때는 건너뛴다.
    const icfg = read('comfy-image-config.json');
    const onlyLocal = ((icfg && icfg.workflows) || [])
      .filter((w) => w && /\((?:로컬|local)\)\s*$/i.test(w.name || ''))
      .map((w) => w.name.replace(/\s*\((?:로컬|local)\)\s*$/i, '').trim());
    if (onlyLocal.length && !icfg.cloud) {
      ok(onlyLocal.every((nm) => localNames.includes(nm) && !cloudNames.includes(nm)),
         '로컬 전용 워크플로는 🖥 에만 나온다: ' + onlyLocal.join(', ')
         + ' (☁ ' + cloudNames.join('/') + ' · 🖥 ' + localNames.join('/') + ')');
    } else console.log('  · (로컬 전용 워크플로가 없거나 클라우드 모드 — 이 검사는 건너뜀)');
    // 반대 방향도 대칭으로 — 「(클라우드)」 이름은 🖥 로컬 그룹에서 감춘다(로컬엔 그 노드가 없다, v0.3.85).
    const vcfg = require('../core/comfy-video').loadConfig();   // 앱과 같은 읽기(번들 이름은 loadConfig 가 늘 새로 매긴다 · 저장 파일엔 옛 이름이 남을 수 있다 · v0.8.14)
    const vComfy = vidOpts.filter((o) => o.indexOf('comfy::') === 0);
    const vSide = (k) => vComfy.filter((o) => o.includes('::' + k + '::')).map(labelOf);
    const vCloud = vSide('cloud'), vLocal = vSide('local');
    ok(!vComfy.some((o) => /\((?:로컬|local|클라우드|cloud)\)/i.test(labelOf(o))),
       '비디오 라벨에도 「(로컬)·(클라우드)」 접미사 없음: ' + vComfy.map(labelOf).join(' / '));
    const onlyCloud = ((vcfg && vcfg.workflows) || [])
      .filter((w) => w && /\((?:클라우드|cloud)\)\s*$/i.test(w.name || ''))
      .map((w) => w.name.replace(/\s*\((?:클라우드|cloud)\)\s*$/i, '').trim());
    if (onlyCloud.length) {
      ok(onlyCloud.every((nm) => vCloud.includes(nm) && !vLocal.includes(nm)),
         '클라우드 전용 워크플로는 ☁ 에만 나온다: ' + onlyCloud.join(', ')
         + ' (☁ ' + vCloud.join('/') + ' · 🖥 ' + vLocal.join('/') + ')');
    }
    // 🔴 Genspark·Flow 는 **무료가 아니다** — 각 서비스 구독 요금제(Genspark 구독 / Flow 는 Google AI Pro·Ultra).
    //   라벨이 「무료」면 사용자가 과금 구조를 오해한다(2026-08-27 로이 지적 + v0.3.36 실측: 구독 없는 Flow 계정은 소개 페이지만 열림).
    ok(!imgPairs.some((o) => /무료/.test(o)), '이미지 드롭다운에 「무료」 표기가 없다: ' + imgPairs.join(' / '));
    ok(imgPairs.some((o) => o.startsWith('genspark|') && /구독/.test(o)), 'Genspark 항목이 「구독」으로 표기된다');
    ok(imgPairs.some((o) => o.startsWith('flow|') && /구독/.test(o)), 'Flow 항목도 「구독」으로 표기된다(Google AI 구독 필요)');
    const row = await win.evaluate(() => {
      const sel = document.querySelector('.hgroup select[title^="이미지 생성 방식"]');
      const grp = sel && sel.closest('.hgroup');
      return grp ? [...grp.querySelectorAll('button')].map((b) => ((b.getAttribute('title') || '') + '~' + (b.textContent || '').trim())) : [];
    });
    // 🔑 「② 이미지」 줄의 ⚙(이미지 설정)은 **제거**했다 (로이 2026-09-16: "첫줄 설정버튼과 같은 기능이면 제거").
    //   첫 줄 「⚙ 설정」이 지금 고른 엔진에 맞는 탭을 열어 준다(settingsTabForEngine).
    ok(!row.some((b) => b.startsWith('이미지 설정')), '「② 이미지」 줄에 옛 ⚙(이미지 설정)이 없다 — 첫 줄 ⚙ 설정으로 통합');
    ok(!row.some((b) => b.includes('이미지 순환')), '옛 「⚙ 이미지 순환」 버튼 없음');
    ok(!row.some((b) => (b.split('~')[1] || '') === '⚙ ComfyUI'), '옛 「⚙ ComfyUI」 버튼 없음');
    // v0.7.94 — Ollama ⚙ 는 뺐다(프롬프트 작성 = Claude API). 그 자리에 🔁 이미지 프롬프트 · 🔍 검수 · 📥 붙여넣기
    ok(!row.some((b) => /Ollama/.test(b)), '옛 Ollama ⚙ 없음(v0.7.94 Claude API)');
    ok(row.some((b) => (b.split('~')[1] || '') === '🔁 이미지 프롬프트') && row.some((b) => (b.split('~')[1] || '') === '🔍 검수') && row.some((b) => (b.split('~')[1] || '') === '📥'), '② 이미지 줄: 🔁 이미지 프롬프트 · 🔍 검수 · 📥');

    await win.click('button:has-text("⚙ 설정")');
    await win.waitForSelector('.modal-card', { timeout: 10000 });
    ok(await win.locator('.modal-card button:has-text("🌐 Flow")').count() === 1, '설정에 「🌐 Flow」 탭이 있다(옛 「브라우저 이미지·비디오」)');
    await win.click('.modal-card button:has-text("🌐 Flow")');
    await win.waitForTimeout(250);
    const free = await win.evaluate(() => {
      const c = document.querySelector('.modal-card');
      return { text: c.textContent, opts: [...c.querySelectorAll('select option')].map((o) => o.value) };
    });
    ok(free.text.includes('LoRA 학습용 이미지 수집'), 'LoRA 수집 섹션이 설정 탭으로 옮겨졌다');
    ok(free.text.includes('트리거'), 'LoRA 트리거 입력이 있다');
    ok(free.opts.includes('Nano Banana 2 Lite'), 'Flow 이미지 모델 선택이 있다');
    ok(free.text.includes('이어받지 않습니다'), 'Flow·Genspark 는 서로 이어받지 않는다는 안내가 있다');
    ok(free.text.includes('구독') && !free.text.includes('무료'), '탭 안내가 「구독 요금제」로 정정됐다(무료 아님)');
    // ⚙ 설정 탭 구조(v0.7.40 · 로이): ComfyUI(이미지+비디오+TTS 서버) · Flow · API 키 · 유튜브 — 계정 탭 없음 · 브라우저 설치는 Flow 탭 · Flow 이미지 모델 = 2.1
    {
      const tabsTxt = await win.locator('.settings-card .st-tabs button').allInnerTexts();
      ok(tabsTxt.length === 6 && /ComfyUI/.test(tabsTxt[0]) && /Flow/.test(tabsTxt[1]) && /API/.test(tabsTxt[2]) && /채널 연결/.test(tabsTxt[3]) && /폴더/.test(tabsTxt[4]) && /계정/.test(tabsTxt[5]), '탭 6개(v0.9.26 👤 계정 · v0.9.36 📺 채널 연결): ' + tabsTxt.join(' / '));
      ok(!tabsTxt.some((x) => /TTS 서버|브라우저 이미지|▶ 유튜브/.test(x)), '옛 「TTS 서버」·「브라우저 이미지」·「▶ 유튜브」 탭은 없다');
      ok(await win.locator('.settings-card button:has-text("브라우저 설치")').count() === 1, '「⬇ 브라우저 설치」 가 Flow 탭에 있다');
      ok((await win.locator('.settings-card select option[value="Nano Banana 2.1"]').count()) === 1, 'Flow 이미지 모델에 Nano Banana 2.1 이 있다');
      const w = await win.evaluate(() => Math.round(document.querySelector('.settings-card').getBoundingClientRect().width));
      ok(w <= 800, '팝업 폭이 줄었다(' + w + 'px)');
      await win.click('.settings-card button:has-text("🎛 ComfyUI")');
      await win.waitForTimeout(400);
      const ctext = await win.evaluate(() => document.querySelector('.settings-card .st-body').textContent);
      ok(/이미지/.test(ctext) && /비디오/.test(ctext) && /TTS 서버/.test(ctext), 'ComfyUI 탭 안에 이미지·비디오·TTS 서버가 함께 있다');
      await win.click('.settings-card button:has-text("🌐 Flow")');
      await win.waitForTimeout(300);
    }
    // 💡 설명글은 평소엔 안 보이고, 설명이 달린 칸에 마우스를 올릴 때만 팝업으로 뜬다(v0.7.39 · v0.9.18 ⓘ 없음 · 줄 차지 없음)
    {
      ok(await win.locator('.settings-card .hint-src').count() >= 1, '설정 탭에 설명(숨김)이 있다');
      ok(await win.locator('.settings-card .hint-i').count() === 0, 'ⓘ 아이콘이 없다(v0.9.18)');
      ok(await win.locator('.settings-card .hint-src').first().isHidden(), '설명글은 평소에 보이지 않는다(줄도 차지하지 않는다)');
      const tgt = win.locator('.settings-card [data-has-hint]').first();
      ok(await tgt.count() === 1, '설명이 달린 칸 표시(data-has-hint)');
      await tgt.hover();
      await win.waitForTimeout(450);
      ok(await win.locator('#hint-float').isVisible(), '그 칸에 마우스를 올리면 설명 팝업이 뜬다');
      const srcs = (await win.locator('.settings-card .hint-src').allTextContents()).map((t) => t.trim().slice(0, 10)).filter(Boolean);
      const shown = await win.locator('#hint-float').textContent();
      ok(srcs.some((w) => shown.includes(w)), '팝업 내용 = 숨겨 둔 설명 중 하나');
      await win.mouse.move(5, 5);
      await win.waitForTimeout(100);
      ok(!(await win.locator('#hint-float').isVisible()), '마우스를 치우면 사라진다');
    }
    ok(!free.text.includes('되돌아가'), '옛 「원래 엔진으로 되돌아간다」 안내는 없다');
    await win.click('.modal-card button:has-text("닫기")');

    // 옛 순환 모달·정규화가 남아 있지 않은지 (원문 대조)
    ok(!APP.includes('imgRotOpen'), '옛 순환 모달 상태(imgRotOpen)가 사라졌다');
    ok(!APP.includes('openImgRotation'), '옛 순환 모달 함수가 사라졌다');
    ok(!APP.includes("['genspark', 'flow'].includes(p.imgEngine)"), '채널값을 순환으로 되돌리던 정규화가 사라졌다');
    ok(!APP.includes("['genspark', 'flow'].includes(s.imgEngine)"), '항목값을 순환으로 되돌리던 정규화가 사라졌다');
    ok(APP.includes("p.imgEngine === 'rotate' ? 'genspark'"), "옛 'rotate' 는 genspark 로 이관된다");

    for (const [kind, file, cfg0] of [['image', 'comfy-image-config.json', before.img], ['video', 'comfy-video-config.json', before.vid]]) {
      await menu(win, kind);
      const sel = kind === 'image' ? '.hgroup select[title^="이미지 생성 방식"]' : '.hgroup select[data-testid="video-engine"]';
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
      await win.click('.modal-card button:has-text("🎛 ComfyUI")');
      await win.waitForTimeout(400);
      const onIdx2 = await win.evaluate((kd) => [...document.querySelectorAll('.modal-card [data-sec="' + (kd === 'image' ? 'img' : 'vid') + '"] .tpane')].findIndex((p) => p.classList.contains('on')), kind);
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
