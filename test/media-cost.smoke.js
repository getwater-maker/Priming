'use strict';
/**
 * node test/media-cost.smoke.js — 💰 이미지·비디오 예상 비용 표시
 *   ① core/media-cost 단가·글자 계산(원문 함수) ② 작업 화면: 이미지 엔진을 바꾸면 💰 가 단가대로 바뀌고, 영상 범위/방식에 따라 영상 개수가 바뀐다
 * ⚠ 임시 채널·임시 대본 · 생성 호출 없음(비용 0) · 끝나면 지운다 · 채널 목록 파일 전후 비교.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const MC = require('../core/media-cost');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcost-'));
const TAG = `__비용표시테스트_${process.pid}`;
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const CH = '__테스트채널_삭제해도됨_비용_' + process.pid;
const PRESETS = path.join(os.homedir(), '.flow-app', 'tts-presets.json');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

// ① 단가표 — 화면 없이
{
  const u = MC.imageUnit('gemini', false);
  ok(u.kind === 'paid' && Math.abs(u.usd - 0.0336) < 1e-9, '즉시 = 장당 $0.0336');
  ok(Math.abs(MC.imageUnit('gemini-batch', false).usd - 0.0168) < 1e-9, '배치 = 즉시의 절반 $0.0168');
  ok(MC.imageUnit('gemini-batch', false).usd * 2 === MC.imageUnit('gemini', false).usd, '배치 = 즉시의 정확히 절반(판정력)');
  ok(MC.imageUnit('comfy::x.json', false).kind === 'local' && MC.imageUnit('comfy::x.json', true).kind === 'paid', 'ComfyUI 로컬 = 무료 · 클라우드 = 유료');
  ok(MC.imageUnit('flow', false).kind === 'sub' && MC.imageUnit('genspark', false).kind === 'sub', 'Flow·Genspark = 구독');
  ok(MC.videoUnit('none', false) === null && MC.videoUnit('', false) === null, '영상 없음 = 표시 안 함');
  ok(MC.costText(MC.imageUnit('gemini', false), 10, 1400) === '470원 · 10개', '10장 즉시 = 470원 (10×0.0336×1400): ' + MC.costText(MC.imageUnit('gemini', false), 10, 1400));
  ok(MC.costText(MC.imageUnit('gemini', false), 0, 1400) === '남은 것 없음', '남은 것이 없으면 그렇게 표시');
  ok(MC.costText(MC.imageUnit('comfy::x.json', false), 5, 1400) === '무료(로컬) · 5개', '로컬 = 무료(로컬)');
}

const lines = ['# 비용표시', '', '## 도입부'];
for (let g = 1; g <= 4; g++) lines.push(`### 〔장면 ${g}〕`, `> 🖼️ 이미지: scene ${g}`, `${g}번 장면의 이야기입니다.`, '');
lines.push('## 본문');
for (let g = 5; g <= 6; g++) lines.push(`### 〔장면 ${g}〕`, `> 🖼️ 이미지: scene ${g}`, `${g}번 장면의 이야기입니다.`, '');

(async () => {
  fs.writeFileSync(MD, lines.join('\n'), 'utf8');
  const presetsBefore = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false;
  try {
    const win = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 820); });
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); }, { name: CH, dir: TMP });
    chMade = true;
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.waitForFunction((n) => [...document.querySelectorAll('select option')].some((o) => o.value === n), CH, { timeout: 8000 });
    await win.selectOption('select[title^="채널(프리셋) — 고르면"]', CH);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent.clip', { timeout: 20000 }); await win.waitForTimeout(600);

    // ② 이미지 메뉴 — 엔진별 💰
    await win.click('button[data-menu="image"]'); await win.waitForTimeout(300);
    const imgSel = win.locator('select:has(option[value="gemini-batch"])').first();
    const costTxt = async () => (await win.locator('[data-testid="img-cost"]').innerText()).trim();
    await imgSel.selectOption('gemini'); await win.waitForTimeout(300);
    const t1 = await costTxt();
    ok(/4장/.test(t1) && /원/.test(t1), '즉시 — 4장 · 원화 표시: ' + t1);
    await imgSel.selectOption('gemini-batch'); await win.waitForTimeout(300);
    const t2 = await costTxt();
    ok(/4장/.test(t2) && t2 !== t1, '배치 — 값이 달라졌다(판정력): ' + t2);
    const num = (s) => Number((s.match(/([\d,.]+)원/) || [])[1].replace(/,/g, ''));
    ok(Math.abs(num(t2) * 2 - num(t1)) <= 0.2 + num(t1) * 0.05, `배치 ≈ 즉시의 절반 (${num(t2)}원 × 2 ≈ ${num(t1)}원)`);
    await imgSel.selectOption('flow'); await win.waitForTimeout(300);
    ok(/구독/.test(await costTxt()), 'Flow = 구독으로 표시: ' + await costTxt());
    const tip = await win.locator('[data-testid="img-cost"]').getAttribute('title');
    ok(/아직 안 만든 그림 4장/.test(tip) && /1달러 ≈/.test(tip), '말풍선에 근거(장수·환율)가 있다');

    // ③ 비디오 메뉴 — 방식에 따라 개수
    await win.click('button[data-menu="video"]'); await win.waitForTimeout(300);
    const vidSelEng = win.locator('select:has(option[value="none"])').first();
    await vidSelEng.selectOption('none'); await win.waitForTimeout(300);
    ok((await win.locator('[data-testid="vid-cost"]').count()) === 0, '영상 없음 → 💰 를 보이지 않는다');
    await vidSelEng.selectOption('flow'); await win.waitForTimeout(300);
    const v1 = (await win.locator('[data-testid="vid-cost"]').innerText()).trim();
    ok(/구독/.test(v1) && /2개/.test(v1), '도입부 전체 = 영상 2개(1·2번 · 구독): ' + v1);
    await win.locator('[data-testid="vid-sel"]').selectOption('intro_odd'); await win.waitForTimeout(300);
    const v2 = (await win.locator('[data-testid="vid-cost"]').innerText()).trim();
    ok(/1개/.test(v2), '도입부 홀수 = 영상 1개(1번): ' + v2);
    // ④ 작업큐 합계 — 대본이 하나면 합계를 보이지 않고, 둘이 되면 「큐 2편」 합계가 나온다
    ok((await win.locator('[data-testid="vid-cost-q"]').count()) === 0, '대본 1개 → 큐 합계는 안 보인다');
    const MD2 = path.join(TMP, `${TAG}_둘째.md`); fs.writeFileSync(MD2, lines.join('\n').replace('# 비용표시', '# 비용표시 둘째'), 'utf8');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD2);
    await win.click('button[data-menu="script"]'); await win.waitForTimeout(200);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForTimeout(1500);
    await win.click('button[data-menu="image"]'); await win.waitForTimeout(1200);
    const imgSel2 = win.locator('select:has(option[value="gemini-batch"])').first();
    await imgSel2.selectOption('gemini'); await win.waitForTimeout(1200);
    const q1 = (await win.locator('[data-testid="img-cost"]').innerText()).trim();
    ok(/큐 2편/.test(q1) && /8장/.test(q1), '대본 2개 → 큐 2편 · 8장 합계: ' + q1);
    const one = Number(((q1.match(/💰\s*([\d,.]+)원 · 4장/) || [])[1] || '0').replace(/,/g, ''));
    const all = Number(((q1.match(/큐 2편\s*([\d,.]+)원/) || [])[1] || '0').replace(/,/g, ''));
    ok(one > 0 && Math.abs(all - one * 2) <= 1, `큐 합계 = 한 편의 2배 (${one}원 → ${all}원)`);
    await imgSel2.selectOption('gemini-batch'); await win.waitForTimeout(1200);
    const q2 = (await win.locator('[data-testid="img-cost"]').innerText()).trim();
    ok(q2 !== q1 && /큐 2편/.test(q2), '엔진을 바꾸면 큐 합계도 바뀐다(판정력): ' + q2);
    await win.click('button[data-menu="video"]'); await win.waitForTimeout(1200);
    const vq = (await win.locator('[data-testid="vid-cost-q"]').innerText()).trim();
    ok(/큐 2편/.test(vq), '영상도 큐 합계: ' + vq);
    ok(errors.length === 0, '화면 오류 0건' + (errors[0] ? ': ' + errors[0] : ''));
  } catch (e) { fail++; console.log('  ✗ 예외: ' + (e.stack || e.message)); }
  finally {
    if (chMade) { try { const w = await app.firstWindow(); await w.evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    try { await app.close(); } catch (_) {}
    try { fs.rmSync(SNAP, { force: true }); fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    const after = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
    if (presetsBefore !== after) { console.log('  ⚠ 채널 목록 파일이 전후로 달라졌다 — 임시 채널 정리 확인'); }
  }
  console.log(`\n${fail ? '❌' : '✅'} 비용 표시 — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
