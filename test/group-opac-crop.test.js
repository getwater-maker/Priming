'use strict';
/**
 * node test/group-opac-crop.test.js — 🖼 본 그림 불투명도·자르기(Lab · 원본 v0.9.104 삽입 규칙을 그룹 그림에도)
 *   [1] 규칙(visual-look) · [2] 🔑 실제 왕복: 빌더(.vrew editInfo) → 렌더러(MP4) → 화소 · [3] 실제 앱: ① 칸 세로 도구 막대
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const VL = require('../core/visual-look');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const FF = require('../core/media-utils').getFfmpegPath();

console.log('\n[1] 규칙');
ok(VL.normLook({ opacity: 40 }).opacity === 40 && !('opacity' in VL.normLook({ opacity: 100 })) && !('opacity' in VL.normLook({})), '불투명도: 100 이면 필드 없음');
ok(JSON.stringify(VL.normLook({ crop: { t: 0.1, l: 0.2 } }).crop) === '{"t":0.1,"r":0,"b":0,"l":0.2}' && !('crop' in VL.normLook({ crop: null })) && !('crop' in VL.normLook({ crop: { l: 0.6, r: 0.6 } })), '자르기: 합이 90% 넘으면 버린다 · 없으면 필드 없음');
ok(VL.isDefault({ opacity: 100 }) && !VL.isDefault({ opacity: 70 }) && !VL.isDefault({ crop: { t: 0.1 } }) && VL.isDefault({ crop: null }), '기본이면 look 을 비운다');
ok(/불투명도 60%/.test(VL.describe({ opacity: 60 })) && /자르기/.test(VL.describe({ crop: { t: 0.1 } })), '로그용 설명');

console.log('\n[2] 실제 왕복 — 빨강|파랑 4:3 그림');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-'));
  try {
    const img = path.join(tmp, 'rb.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=600x900', '-f', 'lavfi', '-i', 'color=c=blue:s=600x900', '-filter_complex', 'hstack', '-frames:v', '1', img]);
    const r = P.parseScriptText('# t\n## 장\n### 장면\n가나다라마바사입니다. 둘째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0]; pr.groups[0].imagePath = img;
    P.fillSilent(pr, path.join(tmp, 'tts'));
    async function bake(name, look) {
      pr.groups[0].look = look || undefined;
      const vrew = path.join(tmp, name + '.vrew'); await P.buildProjectVrew(pr, vrew, {}, () => {}, 20, 1);
      const mp4 = path.join(tmp, name + '.mp4');
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
      if (!res || !res.ok) throw new Error('렌더 실패 ' + (res && res.error));
      const raw = execFileSync(FF, ['-loglevel', 'error', '-ss', '0.5', '-i', mp4, '-frames:v', '1', '-vf', 'scale=96:54', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
      const trk = Object.values(JSON.parse(new AdmZip(vrew).readAsText('project.json')).props.tracks).find((t) => t.type === 'image');
      return { px: (x, y) => { const i = (y * 96 + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; }, trk };
    }
    const isRed = (p) => p[0] > 150 && p[1] < 90 && p[2] < 90, isBlue = (p) => p[2] > 150 && p[0] < 90 && p[1] < 90, isBlack = (p) => p[0] < 30 && p[1] < 30 && p[2] < 30;
    const base = await bake('base', null);
    ok(isRed(base.px(30, 6)) && isBlue(base.px(66, 6)), '기준: 왼쪽 빨강 · 오른쪽 파랑');
    ok(!base.trk.editInfo || (!base.trk.editInfo.crop && base.trk.editInfo.opacity == null), '.vrew 트랙 editInfo 에 자르기·불투명도 없음');

    const cr = await bake('crop', { crop: { l: 0.5 } });
    ok(cr.trk.editInfo && cr.trk.editInfo.crop === 'inset(0% 0% 0% 50%)', `🔑 .vrew editInfo.crop = ${cr.trk.editInfo && cr.trk.editInfo.crop}(삽입 그림과 같은 Vrew 실측 꼴)`);
    ok(Math.abs(cr.trk.originalWidthHeightRatio - (600 / 900)) < 0.01 && cr.trk.width < 0.5, `박스는 자른 뒤 비율(2:3)로 — 폭 ${cr.trk.width.toFixed(3)}`);
    ok(isBlue(cr.px(48, 6)) && isBlack(cr.px(15, 6)) && !isRed(cr.px(30, 6)), '🔑 MP4: 빨강 반쪽이 잘려 나갔다(가운데 파랑 · 양옆 검정)');

    const op = await bake('opac', { opacity: 50 });
    ok(op.trk.editInfo && op.trk.editInfo.opacity === 0.5, '.vrew editInfo.opacity = 0.5');
    const rp = op.px(30, 6);
    ok(rp[0] > 90 && rp[0] < 160 && rp[1] < 40 && rp[2] < 40, `🔑 MP4: 불투명도 50% — 빨강이 검정과 반반(${rp})`);

    const both = await bake('both', { crop: { l: 0.5 }, opacity: 50 });
    const bp = both.px(48, 6);
    ok(bp[2] > 90 && bp[2] < 160 && bp[0] < 40, `자르기 + 불투명도 함께(${bp})`);

    const off = await bake('off', { opacity: 100, crop: null });
    ok(isRed(off.px(30, 6)) && isBlue(off.px(66, 6)) && !(off.trk.editInfo && (off.trk.editInfo.crop || off.trk.editInfo.opacity != null)), '끄면 처음과 같다');
    const fbg = await bake('bgcrop', { crop: { l: 0.5 }, bg: '#00ff00' });
    ok(isBlack(fbg.px(15, 6)), '자른 그림에는 배경색을 쓰지 않는다(자르기가 이긴다 — 띠가 검정)');
  } catch (e) { ok(false, '왕복 실패: ' + (e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }

  console.log('\n[3] 실제 앱 — ① 칸 세로 도구 막대');
  const TAG = `투명자르기시험_${process.pid}`;
  const MD = path.join(os.tmpdir(), `${TAG}.md`);
  const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
  fs.writeFileSync(MD, ['# 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장입니다. 둘째 문장입니다.', '', '### ② 둘째', '> 🖼️ 이미지: b', '', '셋째 문장입니다.', ''].join('\n'), 'utf8');
  const png = path.join(os.tmpdir(), TAG + '.png');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1200x900:d=1', '-frames:v', '1', png]);
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow(); win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, png);
    await win.evaluate(async () => window.api.attachAsset({ shortsNum: 1, groupNum: 1 }));
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(700);
    const look = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts[0].look || null; });
    await win.locator('.sent[data-ln="1"]').first().click(); await win.waitForTimeout(500);
    await win.locator('.vlayer').first().click(); await win.waitForTimeout(300);
    ok(await win.locator('[data-testid="vtb-opac"]').count() === 1 && await win.locator('[data-testid="vtb-opac"].soon').count() === 0 && await win.locator('[data-testid="vtb-crop"].soon').count() === 0, '막대의 불투명도·자르기는 준비 중이 아니다');
    await win.click('[data-testid="vtb-opac"]'); await win.waitForSelector('[data-testid="sx-opac"]', { timeout: 3000 });
    await win.locator('[data-testid="sx-opac"]').fill('40'); await win.waitForTimeout(900);
    ok(((await look()) || {}).opacity === 40, '불투명도 40 → 그룹 look.opacity');
    const op = await win.evaluate(() => { const e = document.querySelector('.vlayer'); return e ? getComputedStyle(e).opacity : null; });
    ok(Math.abs(parseFloat(op) - 0.4) < 0.02, `① 미리보기 불투명도 ${op}`);
    await win.click('[data-testid="sx-opac-reset"]'); await win.waitForTimeout(800);
    ok(!((await look()) || {}).opacity, '100% 로 되돌리기 → look 에서 사라진다');
    await win.locator('.vlayer').first().click(); await win.waitForTimeout(300);
    await win.click('[data-testid="vtb-crop"]'); await win.waitForSelector('[data-testid="sx-crop-l"]', { timeout: 3000 });
    await win.locator('[data-testid="sx-crop-l"]').fill('30'); await win.waitForTimeout(900);
    const l1 = (await look()) || {};
    ok(l1.crop && Math.abs(l1.crop.l - 0.3) < 0.001, `자르기 왼쪽 30% → look.crop ${JSON.stringify(l1.crop)}`);
    ok(await win.locator('.vlayer .vcrop').count() >= 1, '① 미리보기가 잘린 모양(vcrop)으로 그려진다');
    await win.evaluate(async () => window.api.undo({})); await win.waitForTimeout(700);   // (슬라이더에 초점이 있으면 키보드 Ctrl+Z 가 칸 안에서 먹는다 — 되돌리기 IPC 로)
    ok(!((await look()) || {}).crop, '되돌리기 → 자르기 전으로');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); for (const f of [MD, SNAP, png]) { try { fs.rmSync(f, { force: true }); } catch {} } }
  console.log(`\n${fail ? '❌' : '✅'} group-opac-crop ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
