'use strict';
/**
 * node test/clip-ctx-wire.smoke.js — 오른쪽 클릭 메뉴의 「준비 중」 자리를 이미 있는 기능에 이은 것(Lab A단계) 실제 화면 E2E
 *   ✂ 무음 구간 줄이기(고른 클립만 · 채널 값은 그대로) · ⏩ 배속 효과 · ✂ 클립 나누기(자막 칸 열림) · ▤ 전체 자막 복사
 *   ⚠ 임시 채널·임시 출력 폴더 · 생성 서버를 부르지 않는다(dry)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const QT = require('../core/quiet-trim');

const TAG = `클립우클릭시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 우클릭 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');
const R = 24000;
// 말 1.0초 + 정적 1.5초 + 말 1.0초 + 끝 정확한 0 0.3초
function speech() {
  const seg = (s, v) => { const n = Math.round(s * R), a = new Int16Array(n); if (v) for (let i = 0; i < n; i++) a[i] = Math.round(12000 * Math.sin(2 * Math.PI * 220 * i / R)); return a; };
  const parts = [seg(1, 1), seg(1.5, 0), seg(1, 1), seg(0.3, 0)];
  const out = new Int16Array(parts.reduce((t, p) => t + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__클립우클릭채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipctx-e2e-'));
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('dialog', (d) => d.accept().catch(() => {}));
    await win.waitForSelector('h1', { timeout: 20000 });
    ok(await win.evaluate(async ({ name, dir }) => { try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, silenceSec: 0 } }); return true; } catch (e) { return String(e); } }, { name: chan, dir: outDir }) === true, '임시 채널');
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const made = await win.evaluate(async (name) => { try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 30, aiNotice: false, outMode: 'audio' }); return 'ok'; } catch (e) { return String(e.message || e); } }, chan);
    ok(made === 'ok', '무음 만들기로 음성 채우기 ' + made);
    await win.waitForTimeout(500);
    const sentOf = async (si) => win.evaluate(async (i) => {
      const r = await window.api.listQueue();
      const ss = r && r.dto && r.dto.projects[0].cuts[0].sentences; const s = ss && ss[i];
      return s ? { audio: s.audio, dur: s.dur, cs: s.cs, qo: s.qo } : null;
    }, si);
    const s0 = await sentOf(0);
    ok(s0 && s0.audio && fs.existsSync(s0.audio), '첫 문장 음성 파일 있음');
    fs.writeFileSync(s0.audio, QT.wavOf(speech(), R));
    const rawBytes = fs.readFileSync(s0.audio);
    const dur0 = s0.dur;

    const rightClick = async (n) => { await win.keyboard.press('Escape'); await win.locator(`.sent[data-ln="${n}"] .clip-r1`).first().click({ button: 'right', position: { x: 4, y: 4 } }); await win.waitForSelector('[data-testid="clip-ctx"]', { timeout: 4000 }); };
    const hover = async (tid) => { await win.hover(`[data-testid="${tid}"]`); await win.waitForTimeout(200); };
    // 사람처럼 — 상위 줄에서 옆으로 먼저 들어가 하위 칸에 닿은 뒤 목표 줄로(대각선으로 가로지르면 다른 줄 위를 지나 하위 칸이 닫힌다)
    const clickInSub = async (parentTid, sel) => {
      const pb = await win.locator(`[data-testid="${parentTid}"]`).boundingBox(); const sb = await win.locator('[data-testid^="cx-sub-"]').first().boundingBox();
      await win.mouse.move(sb.x + 8, pb.y + pb.height / 2); await win.waitForTimeout(100);
      await win.locator(sel).first().click(); await win.waitForTimeout(250);
    };

    console.log('\n[1] 메뉴 모양 — 이어진 자리는 더 이상 「준비 중」이 아니다');
    await rightClick(1);
    for (const tid of ['cx-split', 'cx-copyall', 'cx-quiet']) ok(await win.locator(`[data-testid="${tid}"]`).count() === 1 && await win.locator(`[data-testid="${tid}"].soon`).count() === 0, `${tid} 있음 · 흐리지 않음`);
    ok(await win.locator('[data-testid="clip-ctx"] .cx-row.soon:has-text("번역하기")').count() === 1, '아직 없는 「번역하기」는 그대로 준비 중');

    console.log('\n[2] ✂ 무음 구간 줄이기 — 쉼 최대 0.2초');
    await hover('cx-quiet');
    ok(await win.locator('[data-testid="cx-sub-quiet"]').count() === 1, '하위 메뉴가 열린다');
    await win.click('[data-testid="cx-quiet-0.2"]');
    await win.waitForTimeout(1500);
    let s1 = await sentOf(0);
    ok(s1 && s1.qo && s1.qo.max === 0.2, `문장에 quietOver 기록 ${JSON.stringify(s1 && s1.qo)}`);
    ok(Math.abs(s1.dur - 2.5) < 0.12, `원본 3.8초 → 말 2초 + 쉼 0.2초 + 끝 0.3초 = 2.5초 ${s1.dur.toFixed(2)}`);
    ok(s1.audio !== s0.audio && /_q[0-9a-f]{8}\.wav$/.test(s1.audio), '새 이름 사본(고정 이름 덮어쓰기 아님)');
    ok(Buffer.compare(fs.readFileSync(s0.audio), rawBytes) === 0, '원본 음성 파일은 그대로');
    const ch = await win.evaluate(async (name) => { const r = await window.api.getPreset ? await window.api.getPreset(name) : null; return r; }, chan).catch(() => null);
    ok(!ch || !ch.quietMaxSec, '채널 설정(quietMaxSec)은 건드리지 않음');

    console.log('\n[3] Ctrl+Z → 원래 길이');
    await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="1"] .clip-chk').first().click().catch(() => {});
    await win.keyboard.press('Control+z'); await win.waitForTimeout(1200);
    const s2 = await sentOf(0);
    ok(s2 && !s2.qo && Math.abs(s2.dur - dur0) < 0.05, `되돌리기 ${s2 && s2.dur}`);

    console.log('\n[4] ⏩ 배속 효과 — 효과 ▸ 배속 효과 ▸ 1.5배속');
    await rightClick(1);
    await hover('cx-fx');
    ok(await win.locator('[data-testid="cx-sub-fx"] .cx-row:has-text("배속 효과")').count() === 1, '효과 안에 「배속 효과」');
    await clickInSub('cx-fx', '[data-testid="cx-speed"]');
    ok(await win.locator('[data-testid="cx-sub-speed"]').count() === 1, '배속 하위 메뉴');
    await win.click('[data-testid="cx-speed-1.5"]'); await win.waitForTimeout(1500);
    const s3 = await sentOf(0);
    ok(s3 && s3.cs === 1.5, `배속 1.5 기록 cs=${s3 && s3.cs}`);
    await win.keyboard.press('Control+z'); await win.waitForTimeout(1000);

    console.log('\n[5] ✂ 클립 나누기 — 자막 칸이 열린다');
    await rightClick(1);
    await win.click('[data-testid="cx-split"]'); await win.waitForTimeout(500);
    const editing = await win.evaluate(() => { const a = document.activeElement; return !!(a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) && document.body.innerText.includes('나눌 자리에 커서'); });
    ok(editing, '편집 칸 열림 + 안내 문구');
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);

    console.log('\n[6] ▤ 전체 자막 복사하기');
    await rightClick(1);
    await win.click('[data-testid="cx-copyall"]'); await win.waitForTimeout(500);
    const st = await win.evaluate(() => document.body.innerText.match(/자막 \d+줄을 복사했습니다|복사하지 못했습니다[^\n]*/));
    ok(st && /줄을 복사했습니다/.test(st[0]), '복사 완료 안내 ' + (st && st[0]));

    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    try { if (win) await win.evaluate(async (n) => { try { await window.api.deletePreset({ name: n }); } catch {} }, chan); } catch {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(fail ? `\n❌ clip-ctx-wire ${pass}/${pass + fail}` : `\n✅ clip-ctx-wire ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
