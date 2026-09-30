'use strict';
/**
 * node test/caption-edit-keep.smoke.js — 자막(문장) 수정을 **연속으로** 해도 잠기지 않고, 만들어 둔 그림·영상이 사라지지 않는다.
 *   로이 2026-09-30: "자막 수정을 할 수 있어. 그런데 한번 더 수정하려고 하면 락이 걸려서 추가 수정이 안 돼.
 *                    그리고 자막 수정을 하면 만들었던 이미지와 비디오가 여전히 모두 사라져버려."
 *   실제 앱을 띄워 그림·영상을 붙이고 → 화면에서 두 번 연속 고치고 → 작업본 저장 → 대본을 다시 열어 그림이 남는지 본다.
 *   ⚠ 임시 채널·임시 출력폴더·임시 .md 만 쓴다(사용자 대본 무변경). 끝나면 지운다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TAG = `__자막수정유지_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const FF = require('../core/media-utils').getFfmpegPath();
const SCRIPT = [
  '# 자막 수정 유지 테스트', '', '## 도입부', '### 〔첫 장면〕', '> 🖼️ 이미지: a quiet room',
  '첫째 문장입니다. 둘째 문장입니다. 셋째 문장입니다.', '', '### 〔두 번째 장면〕', '> 🖼️ 이미지: a bus stop',
  '넷째 문장입니다. 다섯째 문장입니다.', '', '### 〔세 번째 장면〕', '> 🖼️ 이미지: a river',
  '여섯째 문장입니다. 일곱째 문장입니다.', '',
].join('\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
let lsDetail = null;

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'capkeep-'));
  const png = (n, color) => { const p = path.join(work, n + '.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180`, '-frames:v', '1', p]); return p; };
  const mp4 = (n) => { const p = path.join(work, n + '.mp4'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=320x180:d=1', '-pix_fmt', 'yuv420p', p]); return p; };
  const P1 = png('a', 'red'), P2 = png('b', 'blue'), P3 = png('c', 'yellow'), V1 = mp4('v1');
  const errors = [];
  const chan = `__자막수정채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capkeep-out-'));
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    const made = await win.evaluate(async ({ name, dir }) => {
      try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); return true; } catch (_) { return false; }
    }, { name: chan, dir: outDir });
    ok(made, '임시 채널 만들기');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 });   // 채널 목록을 새로 읽는다
    await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan);   // 임시 채널 — 사용자 채널의 출력 폴더를 건드리지 않는다
    await win.waitForTimeout(500);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sblk', { timeout: 20000 });
    lsDetail = await win.evaluate(() => { try { return localStorage.getItem('pm.clipDetail'); } catch (_) { return null; } });
    if (await win.locator('.clipbar button[data-detail="0"]').count()) await win.click('.clipbar button[data-detail="0"]');

    // 그림·영상을 붙인다(파일 고르기 대화상자 스텁)
    const attach = async (g, file) => {
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, file);
      return win.evaluate(async (num) => { const d = await window.api.attachAsset({ shortsNum: 1, groupNum: num }); return d.projects[0].cuts.map((c) => ({ i: !!c.imagePath, v: !!c.videoPath })); }, g);
    };
    await attach(1, P1); await attach(2, P2); await attach(3, P3);
    const st0 = await attach(1, V1);
    ok(st0.every((c) => c.i) && st0[0].v, `그림 3개 · 영상 1개를 붙였다 (${JSON.stringify(st0)})`);
    const media = () => win.evaluate(async () => { const r = await window.api.ytStatus ? null : null; return null; });
    const snapMedia = () => win.evaluate(() => window.__dtoNow ? window.__dtoNow() : null);
    // 화면에 보이는 그림 수(썸네일) — DTO 대신 실제 DOM
    const domThumbs = () => win.evaluate(() => document.querySelectorAll('.cut .gicon img, .cut .gicon video, .cut img.gthumb').length);

    // ── [1] 화면에서 연속 두 번 고친다(잠기지 않는가)
    console.log('\n[1] 화면에서 같은 문장을 두 번 연속 고친다');
    const block = (g, i) => win.locator('.cut').nth(g).locator('.sblk').nth(i);
    for (const [round, txt] of [[1, '첫 번째로 고친 문장입니다.'], [2, '두 번째로 다시 고친 문장입니다.']]) {
      await block(0, 1).locator('.sblk-lines').click();
      await win.waitForSelector('.sblk.editing textarea', { timeout: 5000 });
      await win.fill('.sblk.editing textarea', txt);
      await win.locator('.sblk.editing textarea').blur();
      await win.waitForSelector('.sblk.editing', { state: 'detached', timeout: 10000 });
      const okMd = await win.waitForFunction((t) => document.body.innerText.includes(t), txt, { timeout: 10000 }).then(() => true).catch(() => false);
      ok(okMd && fs.readFileSync(MD, 'utf8').includes(txt), `${round}번째 수정이 저장됐다 (화면 · 대본 .md)`);
    }
    // 세 번째: 다른 그룹의 문장도(편집 잠금이 남아 있지 않은가)
    await block(1, 0).locator('.sblk-lines').click();
    await win.waitForSelector('.sblk.editing textarea', { timeout: 5000 });
    await win.fill('.sblk.editing textarea', '다른 그룹도 고칩니다.');
    await win.locator('.sblk.editing textarea').blur();
    await win.waitForSelector('.sblk.editing', { state: 'detached', timeout: 10000 });
    ok(fs.readFileSync(MD, 'utf8').includes('다른 그룹도 고칩니다.'), '🔑 세 번째(다른 그룹)도 고쳐진다 — 잠김 없음');

    // 그림·영상이 남았는가(응답 DTO)
    const keep1 = await win.evaluate(async () => {
      const r = await window.api.editSentences({ shortsNum: 1, groupNum: 3, sentIdx: 0, count: 1, text: '여섯째를 고쳤습니다.' });
      return r && r.ok ? r.dto.projects[0].cuts.map((c) => ({ i: !!c.imagePath, v: !!c.videoPath, stale: !!c.imageStale })) : { err: r && r.error };
    });
    ok(Array.isArray(keep1) && keep1.every((c) => c.i && !c.stale) && keep1[0].v, `🔑 고친 뒤에도 그림 3개 · 영상 1개가 그대로 (${JSON.stringify(keep1)})`);

    // ── [2] 작업본 저장 → 대본을 다시 연다(앱 재시작과 같은 복원 경로)
    console.log('\n[2] 저장한 작업본으로 다시 열어도 그림·영상이 남는다');
    await win.evaluate(async () => { try { await window.api.saveProject(); } catch (_) {} });
    await win.waitForTimeout(600);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    const reopened = await win.evaluate(async (name) => {
      const d = await window.api.openScript({ presetName: name });
      return (d.projects || d.dto && d.dto.projects || [])[0].cuts.map((c) => ({ i: !!c.imagePath, v: !!c.videoPath, stale: !!c.imageStale }));
    }, chan);
    ok(reopened.length === 3 && reopened.every((c) => c.i && !c.stale) && reopened[0].v, `🔑 다시 열어도 그림 3개 · 영상 1개 (${JSON.stringify(reopened)})`);

    // ── [3] 고치자마자 (자동저장 전에) 대본을 다시 열어도
    console.log('\n[3] 고치자마자 (자동저장 전에) 대본을 다시 열어도');
    const shape = (d) => (((d && d.projects) || (d && d.dto && d.dto.projects) || [])[0] || { cuts: [] }).cuts.map((c) => ({ i: !!c.imagePath, v: !!c.videoPath, stale: !!c.imageStale }));
    const early = await win.evaluate(async (name) => {
      await window.api.editSentences({ shortsNum: 1, groupNum: 2, sentIdx: 1, count: 1, text: '다섯째를 바로 고쳤습니다.' });
      return await window.api.openScript({ presetName: name });
    }, chan);
    const eS = shape(early);
    ok(eS.length === 3 && eS.every((c) => c.i && !c.stale), `🔑 고친 직후 다시 열어도 그림이 그대로 (${JSON.stringify(eS)})`);

    // ── [4] ✂ 그룹 분할(대본 .md 에 없는 구조)이 있는 상태에서 자막을 고치고 다시 열기
    console.log('\n[4] ✂ 분할한 구조 + 자막 수정 + 다시 열기');
    const sp = await win.evaluate(async () => {
      const d = await window.api.splitGroup({ shortsNum: 1, groupNum: 1 });
      return d.projects[0].cuts.map((c) => ({ n: c.sentences.length, i: !!c.imagePath, v: !!c.videoPath }));
    });
    ok(sp.length === 4 && sp[0].i && sp[0].v, `분할: 그룹 4개, 앞 조각은 그림·영상 그대로 (${JSON.stringify(sp)})`);
    const afterEdit = await win.evaluate(async (name) => {
      const r = await window.api.editSentences({ shortsNum: 1, groupNum: 3, sentIdx: 0, count: 1, text: '분할 뒤에 고친 문장입니다.' });
      return r && r.ok ? r.dto : { err: r && r.error };
    }, chan);
    const aS = shape(afterEdit);
    ok(!afterEdit.err && aS.length === 4 && aS.filter((c) => c.i).length >= 3 && !aS.some((c) => c.stale), `분할 뒤 자막 수정 — 그림이 그대로 (${JSON.stringify(aS)})`);
    // 앱 재시작과 같은 경로: 작업본을 저장하고 새로 연다
    await win.evaluate(async () => { try { await window.api.saveProject(); } catch (_) {} });
    await win.waitForTimeout(800);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    const reopened2 = await win.evaluate(async (name) => await window.api.openScript({ presetName: name }), chan);
    const rS = shape(reopened2);
    ok(rS.length === 4 && rS.filter((c) => c.i).length >= 3 && !rS.some((c) => c.stale), `🔑 분할한 구조도 다시 열면 그대로, 그림도 그대로 (${JSON.stringify(rS)})`);

    // ── [5] 수정 실패 뒤에도 편집이 잠기지 않는다(화면)
    console.log('\n[5] 저장이 거절된 뒤에도 다시 고칠 수 있다');
    const mdNow = fs.readFileSync(MD, 'utf8');
    await block(0, 0).locator('.sblk-lines').click();
    await win.waitForSelector('.sblk.editing textarea', { timeout: 5000 });
    // 다음 저장 한 번을 실패시킨다(대본 파일을 잠깐 지운다 → '대본 파일을 찾을 수 없습니다')
    await win.evaluate(() => { window.__origConfirm = window.confirm; window.confirm = () => false; });   // 「편집창을 열까요?」에 아니요
    fs.renameSync(MD, MD + '.hold');
    await win.fill('.sblk.editing textarea', '실패할 저장입니다.');
    await win.locator('.sblk.editing textarea').blur();
    await win.waitForTimeout(900);
    fs.renameSync(MD + '.hold', MD);
    // 같은 편집칸(또는 새로 연 칸)에서 다시 고친다
    if (!(await win.locator('.sblk.editing textarea').count())) {
      await block(0, 0).locator('.sblk-lines').click();
      await win.waitForSelector('.sblk.editing textarea', { timeout: 5000 });
    }
    await win.fill('.sblk.editing textarea', '실패 뒤에 다시 고친 문장입니다.');
    await win.locator('.sblk.editing textarea').blur();
    await win.waitForSelector('.sblk.editing', { state: 'detached', timeout: 10000 }).catch(() => {});
    ok(fs.readFileSync(MD, 'utf8').includes('실패 뒤에 다시 고친 문장입니다.'), '🔑 저장이 한 번 거절돼도 다음 수정은 저장된다 — 잠김 없음');
    await win.evaluate(() => { if (window.__origConfirm) window.confirm = window.__origConfirm; });
    void mdNow;

    ok(errors.length === 0, `화면 오류 0건 ${errors.length ? '— ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch (_) {}
    try { await win.evaluate((v) => { try { if (v == null) localStorage.removeItem('pm.clipDetail'); else localStorage.setItem('pm.clipDetail', v); } catch (_) {} }, lsDetail); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} 자막 수정 유지 E2E ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 오류:', e); process.exit(1); });
