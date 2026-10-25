'use strict';
/**
 * node test/stage-order-paste.smoke.js — 🖼 ① 칸 「순서(앞으로·뒤로)」와 「붙여넣기」(Lab)
 *   [1] 쌓는 순위 규칙(core/visual-span.groupRanks + look.layer) · [2] 실제 빌더 → .vrew 트랙 zIndex · [3] 실제 앱: 우클릭 메뉴 · 클립보드 그림 붙여넣기
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const VS = require('../core/visual-span');
const VL = require('../core/visual-look');
const P = require('../core/pipeline');

console.log('\n[1] 쌓는 순위 규칙');
const proj = (looks) => ({ groups: looks.map((l, i) => ({ num: i + 1, look: l, sentenceIds: ['s' + i] })), sentences: looks.map((_, i) => ({ id: 's' + i })) });
const rk = (looks) => VS.groupRanks(proj(looks), () => true);
ok(rk([{}, {}, {}]).join() === '0,1,2', '기본은 그룹 순서');
ok(rk([{ layer: 1 }, {}, {}]).join() === '1,0,2', '앞으로 1 = 이웃 하나를 넘는다');
ok(rk([{ layer: 99 }, {}, {}]).join() === '2,0,1', '맨 앞으로 = 맨 위');
ok(rk([{}, {}, { layer: -99 }]).join() === '1,2,0', '맨 뒤로 = 맨 아래');
ok(rk([{ layer: 1 }, { layer: -1 }, {}]).join() === '1,0,2', '둘이 서로 넘으면 자리를 바꾼다(순위는 늘 0..n-1 한 번씩)');
ok(VL.normLook({ layer: 3 }).layer === 3 && !('layer' in VL.normLook({ layer: 0 })) && VL.isDefault({ layer: 0 }) && !VL.isDefault({ layer: 1 }) && VL.normLook({ layer: 500 }).layer === 99, 'look.layer 정규화(기본 = 필드 없음 · ±99 로 자른다)');

console.log('\n[2] 실제 빌더 — .vrew 트랙 zIndex');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ord-'));
  const MD = path.join(os.tmpdir(), `순서시험_${process.pid}.md`);
  const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `순서시험_${process.pid}.smproj.json`);
  const png = path.join(tmp, 'c.png');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x336699:s=1280x720', '-frames:v', '1', png]);
  let app;
  try {
    const r = P.parseScriptText('# t\n## 장\n### ① 가\n가나다라마바사입니다.\n### ② 나\n둘째 문장입니다.\n', 'longform', {});
    const pr = r.projects[0];
    pr.groups.forEach((g) => { g.imagePath = png; });
    P.fillSilent(pr, path.join(tmp, 'tts'));
    const zOf = async (looks) => {
      pr.groups.forEach((g, i) => { g.look = looks[i]; });
      const v = path.join(tmp, 'o' + Math.random().toString(36).slice(2) + '.vrew'); await P.buildProjectVrew(pr, v, {}, () => {}, 20, 1);
      const pj = JSON.parse(new AdmZip(v).readAsText('project.json'));
      return Object.values(pj.props.tracks).filter((t) => t.type === 'image').map((t) => t.zIndex)   // 삽입 순서 = 그룹 순서(trackId 는 무작위라 정렬하지 않는다);
    };
    const z0 = await zOf([undefined, undefined]);
    const z1 = await zOf([{ layer: 1 }, undefined]);
    ok(z0.join() !== z1.join() && z0.length === 2, `🔑 앞으로 → .vrew 트랙 zIndex 가 바뀐다(${z0} → ${z1})`);

    console.log('\n[3] 실제 앱 — 우클릭 메뉴 · 붙여넣기');
    fs.writeFileSync(MD, ['# 순서 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '둘째 문장입니다.', ''].join('\n'), 'utf8');
    app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
    const win = await app.firstWindow(); const errors = []; win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, png);
    await win.evaluate(async () => window.api.attachAsset({ shortsNum: 1, groupNum: 1 }));
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }); await win.waitForTimeout(600);
    const look = () => win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts[0].look || null; });
    await win.locator('.sent[data-ln="1"]').first().click(); await win.waitForTimeout(500);
    await win.locator('.vlayer').first().click({ button: 'right' });
    await win.waitForSelector('[data-testid="stage-ctx"]', { timeout: 5000 });
    ok(await win.locator('[data-testid="sx-paste"].soon').count() === 0, '우클릭 ▸ 붙여넣기는 준비 중이 아니다');
    await win.hover('[data-testid="sx-ord"]'); await win.waitForSelector('[data-testid="sx-ord-front"]', { timeout: 3000 });
    ok(await win.locator('[data-testid="sx-sub-ord"] .soon').count() === 1 && await win.locator('[data-testid="sx-ord-reset"].soon').count() === 1, '순서 하위 메뉴: 네 줄은 동작 · 「원래대로」만 순서를 바꾸기 전이라 흐림');
    await win.click('[data-testid="sx-ord-front"]'); await win.waitForTimeout(1000);
    ok(((await look()) || {}).layer === 99, '맨 앞으로 → 그룹 look.layer = 99');
    await win.keyboard.press('Control+z'); await win.waitForTimeout(800);
    ok(!((await look()) || {}).layer, 'Ctrl+Z → 순서가 처음으로');
    // 붙여넣기 — 진짜 클립보드에 그림을 넣는다
    const c1 = await win.evaluate(async () => window.api.stagePasteImage({ shortsNum: 1, groupNum: 1 }));
    await app.evaluate(({ clipboard, nativeImage }, p) => { clipboard.clear(); }, png);
    const c0 = await win.evaluate(async () => window.api.stagePasteImage({ shortsNum: 1, groupNum: 1 }));
    ok(c0 && c0.ok === false && /클립보드/.test(c0.error), '클립보드에 그림이 없으면 거부: ' + (c0 && c0.error));
    void c1;
    await app.evaluate(({ clipboard, nativeImage }, p) => { clipboard.writeImage(nativeImage.createFromPath(p)); }, png);
    const c2 = await win.evaluate(async () => window.api.stagePasteImage({ shortsNum: 1, groupNum: 2 }));
    ok(c2 && c2.ok === true, '그림이 있으면 붙여넣는다');
    const ip = await win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts[1].imagePath || ''; });
    ok(/paste_[0-9a-f]{10}\.png$/.test(ip) && fs.existsSync(ip), '그림이 media-N 에 새 파일(paste_<지문>.png)로 들어갔다: ' + path.basename(ip));
    await win.keyboard.press('Control+z'); await win.waitForTimeout(800);
    const ip2 = await win.evaluate(async () => { const r = await window.api.listQueue(); return r.dto.projects[0].cuts[1].imagePath || ''; });
    ok(!/paste_/.test(ip2), 'Ctrl+Z → 붙여넣기 전으로');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { if (app) await app.close().catch(() => {}); for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} } try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(fail ? `\n❌ stage-order-paste ${pass}/${pass + fail}` : `\n✅ stage-order-paste ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
