'use strict';
/**
 * node test/logo-preview.smoke.js — 🏷 ① 칸 로고 자리 = .vrew 로고 트랙 (Lab · 차이표 #12 로고)
 *   ① 칸 로고는 core/overlay-layers(effLogo · posOfLogo · logoBox · chanLogoPos)로만 자리를 정한다 — .vrew 빌더와 같은 함수.
 *   경우: 기본(오른쪽 위) · ↖ 왼쪽 위 · 끌어 옮긴 자리가 화면 밖(아래 오른쪽 끝 → 화면 안으로 잘림) · 채널 기본 자리(logoX·logoY) · 큐 「로고 빼기」
 *   경우마다 무음 만들기(음성만)로 .vrew 를 굽고 로고 트랙(xPos·yPos·width)과 ① 칸 상자(data-x·y·w)를 대조한다.
 *   ⚠ 임시 채널·임시 폴더 · 로고 그림은 ffmpeg 로 만든 400×200(가로 2:1 — 세로 자르기가 비율을 타는지 본다)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const TAG = `로고시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const SCRIPT = ['# 로고 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장입니다. 둘째 문장입니다.', ''].join('\n');

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__로고채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logopv-e2e-'));
  const logo = path.join(outDir, 'logo.png');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=400x200:d=1', '-frames:v', '1', logo]);
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    ok(await win.evaluate(async ({ name, dir, logo }) => { try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, logoOn: true, logoPath: logo, logoSize: 15 } }); return true; } catch (_) { return false; } }, { name: chan, dir: outDir, logo }), '임시 채널(로고 켬 · 크기 15%)');
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });

    const make = async () => win.evaluate(async (name) => { try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 30, aiNotice: false, openVrew: false, outMode: 'audio' }); return 'ok'; } catch (e) { return e.message; } }, chan);
    const vrewLogo = () => {
      const v = fs.readdirSync(outDir, { recursive: true }).map((f) => path.join(outDir, String(f))).find((f) => /\.vrew$/i.test(f));
      if (!v) return undefined;
      const pj = JSON.parse(new AdmZip(v).readAsText('project.json'));
      const t = Object.values(pj.props.tracks).find((x) => x.type === 'image' && x.zIndex === 2000);
      return t ? { x: t.xPos, y: t.yPos, w: t.width } : null;
    };
    const stage = async () => {
      await win.locator('.sent[data-ln="1"] .clip-no .clip-no-n').first().click().catch(() => {});
      await win.waitForTimeout(500);
      return win.evaluate(() => { const i = document.querySelector('[data-testid="stage-logo"]'); return i ? { x: +i.dataset.x, y: +i.dataset.y, w: +i.dataset.w, nat: i.naturalWidth } : null; });
    };
    const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.0006 && Math.abs(a.y - b.y) < 0.0006 && Math.abs(a.w - b.w) < 0.0006;
    const check = async (label) => {
      const m = await make();
      const v = vrewLogo(), s = await stage();
      console.log(`   ${label}: .vrew ${JSON.stringify(v)} · ① ${JSON.stringify(s)}`);
      return { m, v, s };
    };

    let r = await check('기본');
    ok(r.m === 'ok' && same(r.v, r.s) && r.v.x > 0.8 && r.v.y < 0.06, '① 기본(오른쪽 위) — ① 칸 = .vrew');

    await win.evaluate(async () => window.api.setLogoSide({ shortsNum: 1, side: 'left' }));
    r = await check('↖ 왼쪽 위');
    ok(same(r.v, r.s) && r.v.x < 0.05, '② ↖ 왼쪽 위 — ① 칸 = .vrew');

    await win.evaluate(async () => window.api.setLogoPos({ shortsNum: 1, pos: { x: 0.97, y: 0.97 } }));
    r = await check('화면 밖으로 끌어 옮김');
    ok(same(r.v, r.s), '③ 화면 밖(0.97, 0.97)으로 끌어 옮긴 자리 — ① 칸도 .vrew 처럼 화면 안으로 자른다');
    ok(r.v && Math.abs(r.v.x - (1 - 0.15)) < 0.001 && Math.abs(r.v.y - (1 - (0.15 * 1920 / 2) / 1080)) < 0.001, `   잘린 자리 = 오른쪽 끝 0.85 · 아래 끝 1 − 로고 높이(그림 2:1 비율) (${r.v && r.v.y.toFixed(4)})`);

    await win.evaluate(async () => window.api.setLogoPos({ shortsNum: 1, pos: null }));
    await win.evaluate(async () => window.api.setLogoSide({ shortsNum: 1, side: 'right' }));
    await win.evaluate(async ({ name }) => window.api.savePreset({ name, patch: { logoX: 40, logoY: 30 } }), { name: chan });
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }).catch(() => {}); await win.waitForTimeout(500);
    r = await check('채널 기본 자리 40%·30%');
    ok(same(r.v, r.s) && Math.abs(r.v.x - 0.4) < 0.001 && Math.abs(r.v.y - 0.3) < 0.001, '④ 채널 기본 자리(logoX 40 · logoY 30) — ① 칸 = .vrew');

    await win.evaluate(async () => window.api.setQueueLogo({ mode: 'off' }));
    r = await check('큐 로고 빼기');
    ok(r.v === null && r.s === null, '⑤ 큐 「로고 빼기」 — .vrew 에도 ① 칸에도 로고 없음');
    ok(!errors.length, `화면 오류 0건 (${errors.slice(0, 2).join(' / ')})`);
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch {}
    await app.close();
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} logo-preview ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
