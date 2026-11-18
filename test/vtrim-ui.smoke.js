'use strict';
/**
 * node test/vtrim-ui.smoke.js — ✂ 「비디오 시작점 변경」 실제 화면 E2E(v1.0.63 · Vrew 동일화)
 *   ② 그룹 썸네일 메뉴 「[ ] 비디오 시작점 변경」(영상 그룹만 · 볼륨 앞) → 창: 큰 미리보기 · 필름 띠 · 소리 파형(소리가 있을 때)
 *   양 끝 끌기(시작·끝) · 상자 끌기(옮기기) · 띠 누르기(주황 선) · ▶ = 주황 선부터 재생 · ↶ 되돌리기 · ✓ 적용 → 그룹 look.vtrim · Ctrl+Z
 *   ① 칸 정지 장면이 고른 시작점으로 옮겨진다 · (구워지는 결과 실측은 test/vtrim.test.js)
 *   ⚠ 생성 서버를 부르지 않는다 · 시험 대본·영상은 임시 폴더 · 채널 출력 폴더의 <TAG> 폴더만 끝에 지운다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TAG = `시작점시험_${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vtui-'));
const MD = path.join(TMP, `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 시작점 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장입니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n');
const FF = require('../core/media-utils').getFfmpegPath();
const VID = path.join(TMP, 'rgb.mp4');
const near = (a, b, e = 0.2) => Math.abs(Number(a) - b) <= e;

(async () => {
  try { fs.rmSync(SNAP, { force: true }); } catch {}
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  // 6초: 빨강 · 초록 · 파랑(2초씩) · 소리는 2~4초에만
  const fc = 'color=c=red:s=640x360:r=30:d=2[a];color=c=green:s=640x360:r=30:d=2[b];color=c=blue:s=640x360:r=30:d=2[c];[a][b][c]concat=n=3:v=1:a=0[v];anullsrc=r=48000:cl=stereo:d=2[s1];sine=f=1000:d=2:sample_rate=48000,aformat=channel_layouts=stereo[t];anullsrc=r=48000:cl=stereo:d=2[s2];[s1][t][s2]concat=n=3:v=0:a=1[au]';
  execFileSync(FF, ['-y', '-loglevel', 'error', '-filter_complex', fc, '-map', '[v]', '-map', '[au]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', VID]);
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 860 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const g1 = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts[0]; });
    const menu = async (i = 0) => { await win.keyboard.press('Escape'); await win.locator('.cut').nth(i).locator('.thumb').first().click(); await win.waitForSelector('[data-testid=vr-menu]', { timeout: 3000 }); };
    const box = () => win.evaluate(() => { const b = document.querySelector('[data-testid=vtrim-box]'); return b ? { in: +b.dataset.in, out: +b.dataset.out } : null; });
    const vtime = () => win.evaluate(() => { const v = document.querySelector('[data-testid=vtrim-video]'); return v ? v.currentTime : null; });

    console.log('\n[1] 영상 첨부 → ② 그룹 메뉴 「[ ] 비디오 시작점 변경」');
    await menu(1);
    ok(await win.locator('[data-testid=mn-vtrim]').count() === 0, '영상 없는 그룹(G2)에는 항목이 없다');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, VID);
    await win.keyboard.press('Escape');
    await win.locator('.cut').nth(0).locator('.thumb').first().click();
    await win.click('[data-testid=vr-menu] button:has-text("첨부")');
    for (let i = 0; i < 20 && !(await g1()).videoPath; i++) await win.waitForTimeout(250);
    ok(/rgb\.mp4$/.test((await g1()).videoPath || ''), 'G1 에 영상 첨부');
    await menu(0);
    const items = await win.evaluate(() => [...document.querySelectorAll('[data-testid=vr-menu] button')].map((b) => b.dataset.testid || b.innerText.trim().slice(0, 8)));
    ok(items.includes('mn-vtrim') && items.indexOf('mn-vtrim') < items.indexOf('mn-vsnd'), 'Vrew 순서 — 「비디오 시작점 변경」 다음에 「볼륨」 ' + JSON.stringify(items.filter((x) => /^mn-/.test(x))));
    ok(/\[ \] 비디오 시작점 변경/.test(await win.locator('[data-testid=mn-vtrim]').innerText()), '항목 이름 — ' + await win.locator('[data-testid=mn-vtrim]').innerText());

    console.log('\n[2] 창 — 미리보기 · 필름 띠 · 파형 · 상자');
    await win.click('[data-testid=mn-vtrim]');
    await win.waitForSelector('[data-testid=vtrim-modal]', { timeout: 3000 });
    ok(/비디오 시작점 변경/.test(await win.locator('[data-testid=vtrim-modal] .vtrim-h').innerText()), '창 제목');
    await win.waitForSelector('[data-testid=vtrim-box]', { timeout: 15000 });
    await win.waitForFunction(() => { const f = document.querySelector('.vtrim-film'); return f && /url\(/.test(f.style.backgroundImage || ''); }, null, { timeout: 15000 });
    ok(true, '필름 띠(영상 전체 프레임)가 깔렸다');
    ok(await win.locator('[data-testid=vtrim-wave]').isVisible(), '🔑 소리가 있는 영상 → 필름 띠 아래 소리 파형');
    const wg = await win.evaluate(() => { const s = document.querySelector('.vtrim-film').getBoundingClientRect(), w = document.querySelector('[data-testid=vtrim-wave]').getBoundingClientRect(); return { sl: s.left, sw: s.width, wl: w.left, ww: w.width, below: w.top >= s.bottom - 1 }; });
    ok(near(wg.sl, wg.wl, 1) && near(wg.sw, wg.ww, 1) && wg.below, '파형은 필름 띠와 같은 폭·같은 시간 기준(바로 아래) ' + JSON.stringify(wg));
    const wavePx = await win.evaluate(() => { const c = document.querySelector('[data-testid=vtrim-wave]'); const g = c.getContext('2d'); const W = c.width, H = c.height; const col = (x) => { let n = 0; const d = g.getImageData(Math.floor(x * W), 0, 1, H).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; }; return { early: col(0.15), mid: col(0.5), late: col(0.85) }; });
    ok(wavePx.mid > wavePx.early * 4 && wavePx.mid > wavePx.late * 4, '🔑 파형 — 소리 있는 2~4초 자리만 크다 ' + JSON.stringify(wavePx));
    let b = await box();
    ok(b && b.in === 0 && near(b.out, 6, 0.1), '처음엔 0초부터(그룹 음성이 없어 영상 전체 길이) ' + JSON.stringify(b));
    ok(/00:06/.test(await win.locator('[data-testid=vtrim-len]').innerText()) && /00:00 \/ 00:06/.test(await win.locator('[data-testid=vtrim-time]').innerText()), '상자 길이 00:06 · 재생 위치 「00:00 / 00:06」');
    ok(await win.locator('[data-testid=vtrim-play]').isVisible() && await win.locator('[data-testid=vtrim-reset]').isVisible() && await win.locator('[data-testid=vtrim-apply]').isVisible(), '▶ · ↶ 되돌리기 · ✓ 적용');

    console.log('\n[3] 끌기 — 양 끝 · 상자 · 띠(주황 선)');
    const S = await win.locator('.vtrim-film').boundingBox();
    const drag = async (sel, dx) => { const r = await win.locator(sel).boundingBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await win.mouse.move(x, y); await win.mouse.down(); await win.mouse.move(x + dx / 2, y, { steps: 4 }); await win.mouse.move(x + dx, y, { steps: 4 }); await win.mouse.up(); await win.waitForTimeout(200); };
    await drag('[data-testid=vtrim-h-l]', S.width / 3);
    b = await box();
    ok(near(b.in, 2, 0.2) && near(b.out, 6, 0.1), '🔑 왼쪽 끝을 끌면 시작점이 바뀐다 ' + JSON.stringify(b));
    ok(near(await vtime(), b.in, 0.25), `미리보기가 그 시작점으로 간다(${(await vtime()).toFixed(2)}초)`);
    await drag('[data-testid=vtrim-h-r]', -S.width / 6);
    b = await box();
    ok(near(b.in, 2, 0.2) && near(b.out, 5, 0.2), '🔑 오른쪽 끝을 끌면 끝점이 바뀐다 ' + JSON.stringify(b));
    await drag('[data-testid=vtrim-box]', S.width / 6);
    const b2 = await box();
    ok(near(b2.in, b.in + 1, 0.2) && near(b2.out - b2.in, b.out - b.in, 0.02), '🔑 상자를 끌면 길이는 그대로 옮겨진다 ' + JSON.stringify(b2));
    await drag('[data-testid=vtrim-box]', S.width);
    const b3 = await box();
    ok(near(b3.out, 6, 0.02) && near(b3.out - b3.in, b2.out - b2.in, 0.02), '영상 끝을 넘어가지 않는다 ' + JSON.stringify(b3));
    await win.mouse.click(S.x + S.width * (1 / 6), S.y + S.height / 2); await win.waitForTimeout(250);
    ok(/00:01 \/ 00:06/.test(await win.locator('[data-testid=vtrim-time]').innerText()) && near(await vtime(), 1, 0.25), '띠(상자 밖)를 누르면 주황 선이 그 자리로 — ' + await win.locator('[data-testid=vtrim-time]').innerText());
    const hx = await win.evaluate(() => { const h = document.querySelector('[data-testid=vtrim-head]').getBoundingClientRect(), s = document.querySelector('.vtrim-film').getBoundingClientRect(); return (h.left + h.width / 2 - s.left) / s.width; });
    ok(near(hx, 1 / 6, 0.02), `주황 선 위치(${hx.toFixed(3)})`);

    console.log('\n[4] ▶ = 주황 선부터 재생');
    await win.click('[data-testid=vtrim-play]'); await win.waitForTimeout(1100);
    const tPlay = await vtime();
    ok(tPlay > 1.4 && tPlay < 2.8 && /■/.test(await win.locator('[data-testid=vtrim-play]').innerText()), `주황 선(1초)부터 흘러간다 — ${tPlay.toFixed(2)}초 · 단추 ■`);
    ok(!/00:01 \//.test(await win.locator('[data-testid=vtrim-time]').innerText()), '주황 선도 따라 움직인다 — ' + await win.locator('[data-testid=vtrim-time]').innerText());
    await win.click('[data-testid=vtrim-play]'); await win.waitForTimeout(200);
    ok(/▶/.test(await win.locator('[data-testid=vtrim-play]').innerText()), '다시 누르면 멈춘다');

    console.log('\n[5] ↶ 되돌리기 · ✓ 적용 → look.vtrim · ① 칸 · Ctrl+Z');
    await win.click('[data-testid=vtrim-reset]'); await win.waitForTimeout(200);
    b = await box();
    ok(b.in === 0 && near(b.out, 6, 0.1), '↶ 되돌리기 = 처음부터 ' + JSON.stringify(b));
    await drag('[data-testid=vtrim-h-l]', S.width / 3);
    await drag('[data-testid=vtrim-h-r]', -S.width / 3);
    b = await box();
    await win.click('[data-testid=vtrim-apply]'); await win.waitForTimeout(800);
    ok(await win.locator('[data-testid=vtrim-modal]').count() === 0, '적용하면 창이 닫힌다');
    const vt = ((await g1()).look || {}).vtrim;
    ok(vt && near(vt.in, 2, 0.2) && near(vt.out, 4, 0.2) && near(vt.d, 6, 0.1) && vt.in === b.in && vt.out === b.out, '🔑 그룹 look.vtrim 에 저장 ' + JSON.stringify(vt));
    await menu(0);
    ok(/2\.\d~4\.\d초|1\.9~4\.\d초|2\.\d~3\.9초/.test(await win.locator('[data-testid=mn-vtrim]').innerText()), '메뉴에 지금 구간 — ' + await win.locator('[data-testid=mn-vtrim]').innerText());
    await win.keyboard.press('Escape');
    await win.locator('.sent.clip[data-ln="1"] .clip-no').first().click(); await win.waitForTimeout(900);
    const st = await win.evaluate(() => { const v = document.querySelector('.vlayer video'); return v ? { t: v.currentTime, ready: v.readyState } : null; });
    ok(st && near(st.t, vt.in, 0.25), `🔑 ① 칸 정지 장면이 고른 시작점(${vt.in}초)에서 — ${st && st.t.toFixed(2)}초`);
    await menu(0); await win.click('[data-testid=mn-vtrim]');
    await win.waitForSelector('[data-testid=vtrim-box]', { timeout: 15000 });
    b = await box();
    ok(b.in === vt.in && b.out === vt.out, '다시 열면 저장한 구간 그대로 ' + JSON.stringify(b));
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid=vtrim-modal]').count() === 0, 'Esc 로 닫힌다(바뀌지 않음)');
    ok(JSON.stringify(((await g1()).look || {}).vtrim) === JSON.stringify(vt), '닫기만 하면 값은 그대로');
    await win.locator('.sent.clip[data-ln="1"] .clip-cap').first().click({ position: { x: 3, y: 3 } }).catch(() => {});
    await win.keyboard.press('Escape');
    await win.keyboard.press('Control+z'); await win.waitForTimeout(800);
    ok(!(((await g1()).look || {}).vtrim), 'Ctrl+Z → 시작점 설정이 없어진다(처음부터)');
    // 처음부터 + 전체 길이로 적용 = 필드 없음
    await menu(0); await win.click('[data-testid=mn-vtrim]');
    await win.waitForSelector('[data-testid=vtrim-box]', { timeout: 15000 });
    await win.click('[data-testid=vtrim-apply]'); await win.waitForTimeout(700);
    ok(!(((await g1()).look || {}).vtrim), '처음부터 끝까지 그대로 적용하면 필드를 두지 않는다(옛 동작 그대로)');

    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    await app.close().catch(() => {});
    try { fs.rmSync(SNAP, { force: true }); } catch {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
    // 🧹 대본을 열면 채널 출력 폴더 아래 <TAG> 폴더가 생긴다 — 이름이 TAG 인 것만 지운다
    const roots = new Set(); try { for (const p of require('../tts/preset-store').loadAll()) { const o = p.outLong || p.outputFolder; if (o) roots.add(o); } } catch {}
    for (const r of roots) { const d = path.join(r, TAG); if (fs.existsSync(d)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} if (fs.existsSync(d)) { fail++; console.log('  ✗ 시험 출력 폴더를 지우지 못했다: ' + d); } } }
  }
  console.log(fail ? `\n❌ vtrim-ui ${pass}/${pass + fail}` : `\n✅ vtrim-ui ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
