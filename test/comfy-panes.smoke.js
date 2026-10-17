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
  const rawBefore = {}; for (const f of ['comfy-image-config.json', 'comfy-video-config.json']) { try { rawBefore[f] = fs.readFileSync(CFG(f), 'utf8'); } catch (_) {} }   // 🛡 왕복 뒤 원문 그대로 되돌린다(v0.9.66 — 옛 항목은 떠나면 목록에서 사라져 드롭다운으로 못 돌아간다)
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
    // 🧩 v0.9.66(로이 2026-10-17 「장기적으로 kie 하나로 운영」) — 목록 = 첫 항목(ComfyUI 하나) + kie.ai 모델
    //   비디오: ☁ MiniMax H3 레퍼런스(R2V) → kie 비디오 → 없음 · 이미지: 🖥 Qwen-Image 2.1 Turbo(로컬) → kie 이미지
    //   Flow·Genspark·나노바나나·다른 ComfyUI 워크플로는 뺐다 — 저장값이 그것이면 「(옛 설정) …」 한 줄로만 보인다.
    await menu(win, 'video');
    const vidOpts = await win.locator('.hgroup select[data-testid="video-engine"] option').evaluateAll((os) => os.map((o) => o.value + '|' + o.textContent));
    ok(/::cloud::.*\|☁ MiniMax H3 레퍼런스 \(R2V\)$/.test(vidOpts[0] || ''), '비디오 첫 항목 = ☁ MiniMax H3 레퍼런스 (R2V): ' + (vidOpts[0] || ''));
    const vKie = vidOpts.filter((o) => o.indexOf('kie:') === 0);
    ok(vKie.length >= 10 && vKie.every((o) => /\|🧩 .+ · \$[\d.]+\/(초|편~)$/.test(o)), `kie 비디오 ${vKie.length}개 · 이름 · 요금: ` + vKie.slice(0, 3).map((o) => o.split('|')[1]).join(' / '));
    ok(vidOpts.some((o) => o.startsWith('none|')), '「없음 (이미지만)」 유지');
    ok(!vidOpts.some((o) => /^(flow|genspark)\|/.test(o) || /\|☁ LTX|\|🖥 LTX/.test(o) || (/^comfy::/.test(o) && !/\(옛 설정\)/.test(o) && o !== vidOpts[0])),
       '옛 항목(Flow·Genspark·LTX 등)은 목록에 없다(저장값이면 「(옛 설정)」 한 줄만)');
    await menu(win, 'image');
    const imgPairs = await win.locator('.hgroup select[data-testid="img-engine"] option').evaluateAll((os) => os.map((o) => o.value + '|' + o.textContent));
    ok(/::local::.*image_qwen21_turbo\.json\|🖥 Qwen-Image 2\.1 Turbo \(로컬\)$/.test(imgPairs[0] || ''), '이미지 첫 항목 = 🖥 Qwen-Image 2.1 Turbo (로컬): ' + (imgPairs[0] || ''));
    const iKie = imgPairs.filter((o) => o.indexOf('kie:') === 0);
    ok(iKie.length >= 10 && iKie.every((o) => /\|🧩 .+ · \$[\d.]+\/장$/.test(o)), `kie 이미지 ${iKie.length}개 · 장당 요금: ` + iKie.slice(0, 3).map((o) => o.split('|')[1]).join(' / '));
    ok(!imgPairs.some((o) => /^(flow|genspark|gemini|gemini-batch|rotate)\|/.test(o) && !/\(옛 설정\)/.test(o)), '옛 항목(Flow·Genspark·나노바나나·순환)은 목록에 없다');
    ok(!imgPairs.some((o) => /무료/.test(o)), '이미지 드롭다운에 「무료」 표기가 없다');
    // 채널 편집도 같은 목록(EngineOptions 한 곳)
    ok((APP.match(/<EngineOptions kind="image"/g) || []).length === 2 && (APP.match(/<EngineOptions kind="video"/g) || []).length === 2, '헤더·채널 편집이 같은 목록을 쓴다');
    const row = await win.evaluate(() => {
      const sel = document.querySelector('.hgroup select[data-testid="img-engine"]');
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
      const sel = kind === 'image' ? '.hgroup select[data-testid="img-engine"]' : '.hgroup select[data-testid="video-engine"]';
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
      await win.click('[data-testid="comfy-view"] button[data-view="' + (after1.cloud ? 'cloud' : 'local') + '"]').catch(() => {});
      await win.waitForTimeout(250);
      const onHead = await win.evaluate((kd) => { const p = document.querySelector('.modal-card [data-sec="' + (kd === 'image' ? 'img' : 'vid') + '"] .tpane.on .thead'); return p ? p.textContent : ''; }, kind);
      ok(onHead.includes(after1.cloud ? '☁' : '🖥') && onHead.includes('지금 사용'), `${kind} 「지금 사용」 배지가 전환을 따라옴 (${onHead})`);
      await win.click('.modal-card button:has-text("닫기")');
      // 원래대로 되돌린다(사용자 설정 보존)
      if ((await win.locator(sel + ' option').evaluateAll((os) => os.map((o) => o.value))).includes(cur)) { await win.locator(sel).selectOption(cur); await win.waitForTimeout(700); }
      else { fs.writeFileSync(CFG(file), rawBefore[file], 'utf8'); console.log('  · (옛 설정 항목은 목록에 없어 파일 원문으로 되돌림)'); }
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
