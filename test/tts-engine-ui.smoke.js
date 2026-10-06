'use strict';
/**
 * tts-engine-ui.smoke.js — 🔊 채널 목소리 팝업 실제 앱 E2E (v0.6.69 채널별·얼굴·요금)
 *   ① 헤더: 옛 「출력」·「Vrew 음성」·「다시 연결」 없음 · 🔊 버튼이 실제로 눌림
 *   ② 팝업 크기 고정 — 탭 5개를 돌아도 창의 폭·높이가 같다
 *   ③ 탭 = 엔진: MAI 97개 카드(언어 전체) · 한국어 거르기 4개 · Gemini 30개 · 카드 누르면 선택 · 말투는 그 목소리 것만
 *   ④ 키 없는 유료 엔진을 「이 엔진으로 만들기」 후 저장 → 막힘
 *   🔑 저장되는 동작은 하지 않는다(로이 설정 불변 — 끝에 파일 비교).
 *   ⚠ renderer/dist 를 읽는다 — 화면을 고쳤으면 `npm run build:renderer` 뒤에 돌릴 것.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');

let pass = 0; const fails = [];
const ok = (c, n) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fails.push(n); console.log('  ❌ ' + n); } };

(async () => {
  const cfgPath = path.join(os.homedir(), '.priming-maker', 'tts-engines.json');
  const before = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null;
  const presetPath = path.join(os.homedir(), '.flow-app', 'tts-presets.json');
  const presetsBefore = fs.existsSync(presetPath) ? fs.readFileSync(presetPath, 'utf8') : null;
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push(String(e.message || e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    const btn = win.locator('[data-testid="tts-engine-btn"]');
    await btn.waitFor({ timeout: 10000 });
    ok(await btn.isVisible(), '🔊 음성 엔진 버튼이 보인다');
    ok((await win.locator('.rb-t', { hasText: 'Vrew 음성' }).count()) === 0, '「Vrew 음성」 버튼 없음');
    ok((await win.locator('.rb-t', { hasText: '다시 연결' }).count()) === 0, '「다시 연결」 버튼 없음');
    ok((await win.locator('option[value="visual"]').count()) === 0, '「출력 — 화면만」 고르기 없음');
    const hit = await btn.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && el.contains(t); });
    ok(hit, '버튼이 실제로 눌리는 자리(elementFromPoint)');
    await btn.click();
    const card = win.locator('[data-testid="tts-eng-card"]');
    await card.waitFor({ timeout: 8000 });

    // 💱 환율 · 📺 채널 얼굴 버튼(누르지 않는다 — 그리면 로이 얼굴이 바뀐다)
    await win.waitForTimeout(1500);   // 환율 받기(비동기)
    const fxTxt = await win.locator('[data-testid="tts-fx"]').innerText();
    ok(/1달러 ≈ [\d,]+원/.test(fxTxt) && !/지난 값/.test(fxTxt), `환율 = 시장 환율 + 카드 수수료를 원화로 (${fxTxt.replace(/\s+/g, ' ').trim()})`);
    ok((await win.locator('[data-testid="tts-chlogo"]').count()) === 1, '고른 채널 줄에 🏷 로고(사람 얼굴 아님)');
    ok((await win.locator('[data-testid="tts-chan-list"] [data-testid="tts-face-img"]').count()) === 0
      || (await win.locator('[data-testid="tts-chan-list"] img').first().getAttribute('src') || '').length > 0, '채널 목록 그림 = 채널 로고만');
    await win.locator('[data-testid="tts-tab-omnivoice"]').click(); await win.waitForTimeout(2500);   // 서버 목소리 목록
    ok((await win.locator('[data-testid="tts-face-all"]').count()) === 0, '🧹 한꺼번에 하기는 ⋯ 안에 숨어 있다');
    await win.locator('[data-testid="tts-more"]').click(); await win.waitForTimeout(150);
    ok((await win.locator('[data-testid="tts-face-all"]').count()) === 1, '⋯ → 「🎨 얼굴 모두 그리기」(누르지 않는다)');
    await win.locator('[data-testid="tts-more"]').click(); await win.waitForTimeout(100);

    // ① 채널 목록(채널마다 목소리)
    const chans = win.locator('[data-testid="tts-chan"]');
    ok((await chans.count()) >= 1, `채널 목록 (${await chans.count()}개)`);
    if ((await chans.count()) >= 2) {
      await chans.nth(1).click(); await win.waitForTimeout(150);
      const b1 = await card.boundingBox();
      await chans.nth(0).click(); await win.waitForTimeout(150);
      const b0 = await card.boundingBox();
      ok(Math.round(b0.height) === Math.round(b1.height), '채널을 바꿔도 창 크기 같다');
    }

    // ② 크기 고정
    const sizes = [];
    for (const id of ['omnivoice', 'gemini', 'mai', 'typecast', 'elevenlabs']) {
      const tab = win.locator(`[data-testid="tts-tab-${id}"]`);
      ok((await tab.count()) === 1, `탭 ${id}`);
      await tab.click(); await win.waitForTimeout(250);
      const b = await card.boundingBox();
      sizes.push(`${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    ok(new Set(sizes).size === 1, `탭마다 창 크기가 같다 (${sizes.join(' · ')})`);

    // 🎨 보이스디자인 탭(로이 2026-10-07) — ElevenLabs 뒤 · 누르면 보이스디자인 창이 음성 설정 **위에** 뜨고(실제로 눌리는 자리) · 닫으면 음성 설정이 그대로
    {
      // Qwen 서버를 실제로 켜지 않게 IPC 를 바꿔 끼운다(모델 로딩·GPU 사용 방지)
      await app.evaluate(({ ipcMain }) => {
        for (const ch of ['qwen-design-status', 'qwen-design-start', 'qwen-design-stop']) ipcMain.removeHandler(ch);
        ipcMain.handle('qwen-design-status', () => ({ installed: true, remote: false, target: 'stub' }));
        ipcMain.handle('qwen-design-start', () => ({ ok: true }));
        ipcMain.handle('qwen-design-stop', () => { global.__vdStop = (global.__vdStop || 0) + 1; return { ok: true }; });
      });
      const ids = await win.locator('[role="tablist"] button').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
      ok(ids.indexOf('tts-tab-voicedesign') === ids.indexOf('tts-tab-elevenlabs') + 1, `🎨 보이스디자인 탭이 ElevenLabs 바로 뒤 (${ids.join(', ')})`);
      const box0 = await card.evaluate((e) => { const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); });
      await win.locator('[data-testid="tts-tab-voicedesign"]').click(); await win.waitForTimeout(600);
      // v0.7.22 — 팝업이 아니라 이 창의 탭 안에 그린다(로이 「다른 탭들처럼」)
      ok((await win.locator('[data-testid="vd-dlg"]').count()) === 0, '보이스디자인은 따로 뜨는 팝업이 아니다');
      const pane = card.locator('[data-testid="tts-eng-voicedesign"]');
      ok(await pane.isVisible() && await pane.locator('[data-testid="vd-generate"]').isVisible(), '음성 설정 창 안에 보이스디자인 본문(목소리 생성 단추)이 보인다');
      ok((await card.locator('[data-testid="tts-voice-grid"]').count()) === 0, '보이스디자인 탭에선 목소리 카드 목록 대신 그 본문');
      ok(/2px solid/.test(await win.locator('[data-testid="tts-tab-voicedesign"]').evaluate((e) => e.style.borderBottom)), '보이스디자인 탭이 고른 탭으로 표시된다');
      const gen = await win.evaluate(() => { const b = document.querySelector('[data-testid="vd-generate"]'); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!(el && el.closest('[data-testid="vd-generate"]')); });
      ok(gen, '목소리 생성 단추가 실제로 눌리는 자리에 있다(elementFromPoint)');
      // 🎨 v0.7.23 — 설명 칸 안내·기본 문장·후보 여러 개·설명 도우미·고른 후보 저장
      ok((await pane.locator('[data-testid="vd-instruct"]').getAttribute('placeholder')) === '영어로 입력해주세요.', '목소리 설명 칸 안내 = 「영어로 입력해주세요.」');
      ok((await pane.locator('textarea').nth(1).inputValue()) === '오래전 이 땅에 살았던 사람들의 이야기를, 차분한 목소리로 하나씩 풀어 보겠습니다.', '미리들을 문장 = 짧은 한 문장');
      await pane.locator('[data-testid="vd-chips"] button', { hasText: '여성' }).click();
      await pane.locator('[data-testid="vd-chips"] button', { hasText: '차분한' }).click();
      ok((await pane.locator('[data-testid="vd-instruct"]').inputValue()) === 'female, calm', `설명 도우미가 영어 낱말을 넣는다 (${await pane.locator('[data-testid="vd-instruct"]').inputValue()})`);
      await pane.locator('[data-testid="vd-chips"] button', { hasText: '여성' }).click();
      ok((await pane.locator('[data-testid="vd-instruct"]').inputValue()) === 'calm', '한 번 더 누르면 뺀다');
      const wavDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdc-'));
      const mkWav = (sec) => { const n = Math.round(16000 * sec), b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), 44 + i * 2); return b; };
      await app.evaluate(({ ipcMain }, dir) => {
        const sep = dir.includes('\\') ? '\\' : '/';
        global.__vdGen = []; global.__vdSave = null;
        for (const ch of ['qwen-design-generate', 'qwen-design-save']) ipcMain.removeHandler(ch);
        ipcMain.handle('qwen-design-generate', (_e, a) => { const i = global.__vdGen.length + 1; global.__vdGen.push(a); return { ok: true, tempPath: dir + sep + `c${i}.wav`, durationSec: 1 + i * 0.5, suggest: { start: 0, end: 1 }, text: a.text }; });
        ipcMain.handle('qwen-design-save', (_e, a) => { global.__vdSave = a; return { ok: true, path: dir + sep + 'saved.wav', name: 'saved.wav', text: a.text, durationSec: 1 }; });
      }, wavDir);
      for (let i = 1; i <= 3; i++) fs.writeFileSync(path.join(wavDir, `c${i}.wav`), mkWav(1 + i * 0.5));
      await pane.locator('[data-testid="vd-count"]').fill('3');
      await pane.locator('[data-testid="vd-generate"]').click();
      await win.waitForFunction(() => document.querySelectorAll('[data-testid="vd-cand"]').length === 3, null, { timeout: 8000 }).catch(() => {});
      ok((await pane.locator('[data-testid="vd-cand"]').count()) === 3, `개수 3 → 후보 3개 (${await pane.locator('[data-testid="vd-cand"]').count()})`);
      const gens = await app.evaluate(() => global.__vdGen);
      ok(gens.length === 3 && gens[0].newBatch === true && gens[1].newBatch === false && gens.every((g) => g.instruct === 'calm'), '생성 요청 3번 · 첫 번째만 새 묶음 · 같은 설명');
      ok(/✔ 고름/.test(await pane.locator('[data-testid="vd-cand"]').nth(0).innerText()), '첫 후보를 바로 고른다');
      await pane.locator('[data-testid="vd-cand"]').nth(1).locator('button', { hasText: '고르기' }).click();
      ok(/✔ 고름/.test(await pane.locator('[data-testid="vd-cand"]').nth(1).innerText()), '「고르기」로 후보 2를 고른다');
      ok(await pane.locator('[data-testid="vd-playall"]').isVisible(), '후보가 여럿이면 「차례로 모두 듣기」');
      await pane.locator('input[placeholder^="예: 고전서재"]').fill('테스트목소리');
      await pane.locator('button', { hasText: '💾 저장' }).click(); await win.waitForTimeout(500);
      const sv = await app.evaluate(() => global.__vdSave);
      ok(sv && sv.tempPath === path.join(wavDir, 'c2.wav'), `저장 = 고른 후보 2의 파일 (${sv && sv.tempPath})`);
      await pane.locator('[data-testid="vd-cand"]').nth(0).locator('button', { hasText: '✕' }).click();
      ok((await pane.locator('[data-testid="vd-cand"]').count()) === 2, '✕ 로 후보 하나 버리기');
      try { fs.rmSync(wavDir, { recursive: true, force: true }); } catch (_) {}
      ok(await card.evaluate((e) => { const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }) === box0, '창 크기는 그대로 (' + box0 + ')');
      await win.locator('[data-testid="tts-tab-omnivoice"]').click(); await win.waitForTimeout(500);
      ok((await pane.count()) === 0 && await card.locator('[data-testid="tts-voice-grid"]').isVisible(), 'OmniVoice 탭을 누르면 목소리 카드로 돌아온다');
      ok((await app.evaluate(() => global.__vdStop || 0)) === 1, '탭을 떠나면 보이스디자인 서버를 끈다(stop 1번)');
      await win.locator('[data-testid="tts-tab-voicedesign"]').click(); await win.waitForTimeout(400);
      await win.locator('[data-testid="tts-tab-omnivoice"]').click(); await win.waitForTimeout(400);
      ok(await card.isVisible(), '탭을 오가도 음성 설정 창은 그대로');
    }

    // ③ MAI 카드
    await win.locator('[data-testid="tts-tab-mai"]').click(); await win.waitForTimeout(200);
    const cards = win.locator('[data-testid="tts-voice-card"]');
    ok((await cards.count()) === 4, `MAI 기본 = 한국어 카드 4개 (${await cards.count()})`);
    await win.locator('[data-testid="tts-voice-lang"]').selectOption('');
    await win.waitForTimeout(200);
    ok((await cards.count()) === 97, `MAI 언어 전체 = 97개 (${await cards.count()})`);
    // ↕ 정렬(v0.7.23) — 성별 → 연령대: ♂ 카드가 모두 ♀ 카드보다 앞 · 분류 없는 카드는 뒤
    {
      const gseq = () => cards.evaluateAll((els) => els.map((e) => (e.innerText.includes('♂') ? 0 : e.innerText.includes('♀') ? 1 : 2)));
      const before = await gseq();
      await win.locator('[data-testid="tts-voice-sort"]').selectOption('gender'); await win.waitForTimeout(200);
      const g = await gseq();
      ok(g.length === 97 && g.every((x, i) => i === 0 || g[i - 1] <= x), `↕ 성별 정렬 — ♂ → ♀ → 미표시 순 (${g.filter((x) => x === 0).length}·${g.filter((x) => x === 1).length}·${g.filter((x) => x === 2).length})`);
      ok(!before.every((x, i) => i === 0 || before[i - 1] <= x), '(판정력) 기본 순서는 성별로 정렬돼 있지 않았다');
      await win.locator('[data-testid="tts-voice-sort"]').selectOption(''); await win.waitForTimeout(150);
      ok(JSON.stringify(await gseq()) === JSON.stringify(before), '「기본 순서」로 되돌리면 처음 순서');
    }
    await win.locator('[data-testid="tts-voice-q"]').fill('Grant');
    await win.waitForTimeout(150);
    const nGrant = await cards.count();
    ok(nGrant > 10 && nGrant < 97, `검색 「Grant」 거르기 (${nGrant}개)`);
    await win.locator('[data-testid="tts-voice-q"]').fill('');
    // 🔎 성별·연령대 거르기(로이 2026-10-06 「언어·성별·연령대로 구분해서」) — 선택지에 개수 · 고르면 그 수만큼만 보인다
    {
      const gl = await win.locator('[data-testid="tts-voice-gender"] option').allInnerTexts();
      const num = (k) => Number(((gl.find((t) => t.includes(k)) || '').match(/\((\d+)\)/) || [])[1] || 0);
      const nM = num('남성'), nF = num('여성'), nN = num('미표시');
      ok(nM > 0 && nF > 0 && nM + nF + nN === 97, `성별 선택지에 개수(남 ${nM} · 여 ${nF} · 미표시 ${nN} = 97)`);
      await win.locator('[data-testid="tts-voice-gender"]').selectOption('male'); await win.waitForTimeout(200);
      ok((await cards.count()) === nM, `성별 ♂ 남성만 = ${nM}개 (${await cards.count()})`);
      await win.locator('[data-testid="tts-voice-gender"]').selectOption('female'); await win.waitForTimeout(200);
      ok((await cards.count()) === nF, `성별 ♀ 여성만 = ${nF}개 (${await cards.count()})`);
      await win.locator('[data-testid="tts-voice-gender"]').selectOption(''); await win.waitForTimeout(100);
      ok((await win.locator('[data-testid="tts-voice-age"] option').count()) >= 5, '연령대 선택지(전체 · 어린이·청소년 · 청년 · 중년 · 노년 …)');
      await win.locator('[data-testid="tts-voice-age"]').selectOption('young'); await win.waitForTimeout(200);
      const nY = await cards.count();
      ok(nY < 97, `연령대 청년만 → 거른다(MAI 는 연령 정보가 거의 없어 ${nY}개)`);
      await win.locator('[data-testid="tts-voice-age"]').selectOption(''); await win.waitForTimeout(150);
      ok((await cards.count()) === 97, '연령대 전체로 되돌리면 97개');
    }
    await win.locator('[data-testid="tts-voice-card"][data-voice="ko-KR-Haena"]').click();
    await win.waitForTimeout(150);
    const haena = await win.locator('[data-testid="tts-voice-card"][data-voice="ko-KR-Haena"]').innerText();
    ok(/✔/.test(haena), '카드를 누르면 선택 표시(✔)');
    const styleOpts = await win.locator('[data-testid="tts-eng-mai"] select').evaluateAll((ss) => ss.map((s) => [...s.options].map((o) => o.value)));
    ok(styleOpts.some((o) => o.includes('softvoice') && !o.includes('narrator')), '말투 = 고른 목소리(해나)가 되는 것만');
    const gridScroll = await win.locator('[data-testid="tts-voice-grid"]').evaluate((el) => el.scrollHeight > el.clientHeight);
    ok(gridScroll, '목록이 길면 카드 칸 안에서만 스크롤');

    ok(/✅/.test(await win.locator('[data-testid="tts-tab-mai"]').innerText()), '카드를 고르면 그 엔진 탭에 ✅(이 채널이 이 엔진으로)');
    ok(/MAI-Voice · 해나/.test(await win.locator('[data-testid="tts-chan"]').filter({ hasText: '●' }).first().innerText()), '왼쪽 채널 줄에 바뀐 목소리(얼굴·이름) · ● 표시');
    const price = await win.locator('[data-testid="tts-price"]').innerText();
    { const m = /1만 자 ≈ ([\d,]+)원/.exec(price); const w = m ? Number(m[1].replace(/,/g, '')) : 0;
      ok(w >= 250 && w <= 400 && !/\$/.test(price), `요금 표시 = 원화 — MAI 2.1 1만 자 $0.22 × 환율 ≈ ${w}원 · 달러 표시 없음 (${price.replace(/\s+/g, ' ').slice(0, 80)})`); }
    ok((await win.locator('[data-testid="tts-voice-card"][data-voice="ko-KR-Haena"] button[title*="AI 로 얼굴"]').count()) === 1, '카드에 🎨 AI 얼굴 · 🖼 그림 버튼');
    { const pb = win.locator('[data-testid="tts-voice-card"][data-voice="ko-KR-Haena"] [data-testid="tts-voice-play"]');
      const t = (await pb.innerText()).trim(); const bb = await pb.boundingBox();
      ok(/🔈|⏳/.test(t) && !/듣기/.test(t) && (await pb.getAttribute('aria-label')) === '샘플 듣기', `카드 🔈 = 아이콘만(글자 없음 · 「${t}」)`);
      ok(bb && bb.height <= 32 && bb.width >= 30, `🔈 버튼이 한 줄 · 큼직(${bb && Math.round(bb.width)}×${bb && Math.round(bb.height)})`); }

    // 🃏 v0.6.85 — 설명은 첫 줄만(전체는 마우스) · 🔈 듣는 중에 다시 누르면 멈춤
    { const d = win.locator('[data-testid="tts-voice-card"][data-voice="ko-KR-Haena"] [data-testid="tts-voice-desc"]');
      if (await d.count()) {
        const m = await d.evaluate((el) => ({ h: el.getBoundingClientRect().height, ws: getComputedStyle(el).whiteSpace, t: el.getAttribute('title') || '', txt: el.textContent }));
        ok(m.h <= 16 && m.ws === 'nowrap' && m.t.includes(m.txt), `설명 = 한 줄(${Math.round(m.h)}px) · 전체는 마우스(title)`);
      } else ok(true, '(해나 카드에 설명 없음 — 건너뜀)'); }
    { const pb = win.locator('[data-testid="tts-voice-card"][data-voice="ko-KR-Haena"] [data-testid="tts-voice-play"]');
      await pb.click();
      const started = await win.waitForFunction((sel) => (document.querySelector(sel) || {}).textContent === '⏹', '[data-testid="tts-voice-card"][data-voice="ko-KR-Haena"] [data-testid="tts-voice-play"]', { timeout: 15000 }).then(() => true).catch(() => false);
      if (started) {
        await pb.click(); await win.waitForTimeout(400);
        ok((await pb.innerText()).trim() === '🔈', '🔑 🔈 듣는 중(⏹)에 다시 누르면 멈춘다(처음부터 다시 나오지 않는다)');
      } else ok(false, '🔈 샘플이 15초 안에 재생되지 않음(회사 샘플 주소 · 인터넷 확인)'); }

    // Gemini 30
    await win.locator('[data-testid="tts-tab-gemini"]').click(); await win.waitForTimeout(200);
    ok((await cards.count()) >= 30, `Gemini 카드 30개 이상 (${await cards.count()})`);

    // ④ 키 없는 유료 엔진(MAI)으로 바꾼 채 저장 → 막힘(채널 설정 불변)
    if (!/🔑/.test(await win.locator('[data-testid="tts-tab-mai"]').innerText())) {
      await win.locator('[data-testid="tts-eng-save"]').click();
      await win.waitForTimeout(400);
      ok(/API 키를 넣어야/.test(await win.locator('[data-testid="tts-eng-msg"]').innerText()), '키 없는 유료 엔진은 저장을 막고 알린다');
      ok(await card.isVisible(), '막히면 창이 그대로');
    }
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    ok((await card.count()) === 0, 'Esc 로 닫힌다');
    // 🔑 ⚙ 설정 → 🔑 API 키 = TTS API 4줄(v0.6.78 · 아무것도 입력하지 않는다)
    await win.locator('button:has-text("⚙ 설정")').first().click(); await win.waitForTimeout(400);
    await win.locator('.modal-card button:has-text("API 키")').first().click(); await win.waitForTimeout(600);
    ok(await win.locator('[data-testid="tts-keys"]').isVisible(), '⚙ 설정 → 🔑 API 키에 「🔊 TTS API」 칸');
    for (const id of ['gemini', 'mai', 'typecast', 'elevenlabs']) ok((await win.locator(`[data-testid="tts-key-${id}"]`).count()) === 1, `TTS 키 줄 ${id}`);
    ok(/저장됨|없음/.test(await win.locator('[data-testid="tts-key-gemini"]').innerText()), '키 상태(저장됨…끝 4자리 / 없음)');
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
    ok(errs.length === 0, `화면 오류 0건 (${errs.join(' | ')})`);
  } finally {
    await app.close().catch(() => {});
    const after = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null;
    ok(after === before, '로이 음성 엔진 설정 파일 불변');
    const presetsAfter = fs.existsSync(presetPath) ? fs.readFileSync(presetPath, 'utf8') : null;
    ok(presetsAfter === presetsBefore, '로이 채널 설정(tts-presets.json) 불변');
  }
  console.log(`\n${fails.length ? '❌' : '✅'} 음성 엔진 화면 E2E ${pass}/${pass + fails.length}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
