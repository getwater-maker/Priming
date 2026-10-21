'use strict';
/**
 * node test/kb-preview.smoke.js — 🎞 ① 미리보기 켄번스 = .vrew 켄번스 (Lab · 차이표 #12)
 *   ① 기본 패턴: ① 칸 그림의 animation-name(kbN)이 그 그룹 .vrew 트랙의 패턴이고, 만들어진 @keyframes 를 거꾸로 풀면 .vrew from/to 와 같다
 *   ② 켄번스 구간(look.kbSeg=3): ① 칸이 kbs_… 애니메이션을 쓰고, 단계마다 프레임 = .vrew 구간 트랙 from(·마지막 to) · 단계 시각 = 구간이 시작하는 문장 시각
 *   ⚠ 임시 채널·임시 폴더 · 무음 만들기(dry) · 그림은 ffmpeg 로 만든 시험 그림
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const TAG = `켄번스시험_${process.pid}`;
const MD = path.join(os.tmpdir(), `${TAG}.md`);
const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
const g1 = Array.from({ length: 9 }, (_, i) => `첫 장면의 ${i + 1}번째 문장은 조금 길게 이어서 씁니다.`).join(' ');
const SCRIPT = ['# 켄번스 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', g1, '', '### ② 둘째 장면', '> 🖼️ 이미지: a field', '', '둘째 장면 문장입니다.', ''].join('\n');

// "s%{transform:scale(k) translate(x%,y%)}" → [{stop, scale, centerX, centerY}]
function parseKeyframes(css, name) {
  const i = css.indexOf('@keyframes ' + name + '{'); if (i < 0) return null;
  const body = css.slice(i, css.indexOf('}}', i) + 2);
  return [...body.matchAll(/([\d.]+)%\{transform:scale\(([\d.]+)\) translate\((-?[\d.]+)%,(-?[\d.]+)%\)\}/g)].map((m) => ({ stop: +m[1] / 100, scale: 1 / +m[2], centerX: 0.5 - +m[3] / 100, centerY: 0.5 - +m[4] / 100 }));
}
const near = (a, b, e = 0.002) => Math.abs(a - b) <= e;
const sameFrame = (a, b) => a && b && near(a.scale, b.scale) && near(a.centerX, b.centerX) && near(a.centerY, b.centerY);

(async () => {
  for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  fs.writeFileSync(MD, SCRIPT, 'utf8');
  const chan = `__켄번스채널_${process.pid}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kbpv-e2e-'));
  const imgs = [1, 2].map((k) => { const f = path.join(outDir, `src${k}.png`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=1920x1080:d=1`, '-frames:v', '1', f]); return f; });
  const errors = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let win;
  try {
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    ok(await win.evaluate(async ({ name, dir }) => { try { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir, silenceSec: 0 } }); return true; } catch (_) { return false; } }, { name: chan, dir: outDir }), '임시 채널');
    await win.reload(); await win.waitForSelector('h1', { timeout: 20000 }); await win.waitForTimeout(400);
    await win.selectOption('select[title^="채널(프리셋)"]', chan); await win.waitForTimeout(400);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    for (const [k, img] of imgs.entries()) {
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, img);
      await win.evaluate(async (g) => window.api.attachAsset({ shortsNum: 1, groupNum: g }), k + 1);
    }
    await win.evaluate(async () => window.api.setGroupLook({ shortsNum: 1, groupNum: 1, patch: { kbSeg: 3 } }));
    const made = await win.evaluate(async (name) => { try { await window.api.makeAll({ presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none', styleId: null, captionMaxChars: 30, aiNotice: false, openVrew: false }); return 'ok'; } catch (e) { return e.message; } }, chan);
    ok(made === 'ok', '무음 만들기(그림 붙임 · .vrew) ' + made);
    // 화면이 새 DTO 를 받도록 — 큐 다시 고르기
    await win.reload(); await win.waitForSelector('.sent[data-ln]', { timeout: 20000 }).catch(() => {});
    await win.waitForTimeout(600);

    const vrew = fs.readdirSync(outDir, { recursive: true }).map((f) => path.join(outDir, String(f))).find((f) => /\.vrew$/i.test(f));
    ok(!!vrew, '.vrew 있음');
    const pj = JSON.parse(new AdmZip(vrew).readAsText('project.json'));
    const T = pj.props.tracks, A = pj.props.assets;
    const kbOfClip = (c) => (c.assetIds || []).map((a) => T[((A[a] || {}).trackIds || [])[0]]).find((t) => t && t.type === 'image');
    const clips = pj.transcript.clips;
    const durOf = (c) => (c.words || []).reduce((a, w) => a + (+w.duration || 0), 0);

    // ② 1번 그룹(구간 3) — 문장 9개가 앞 클립들 · 구간 트랙마다 다른 kenburns
    const segTracks = []; let t = 0, total1 = 0; const segStart = [];
    const mid1 = (kbOfClip(clips[0]) || {}).mediaId;   // 그룹 = 그림 파일 — 2번 그룹은 다른 그림
    const g2Start = clips.findIndex((c) => { const tr = kbOfClip(c); return tr && tr.mediaId !== mid1; });
    clips.slice(0, g2Start > 0 ? g2Start : clips.length).forEach((c) => { const tr = kbOfClip(c); const d = durOf(c); if (tr && !segTracks.includes(tr)) { segTracks.push(tr); segStart.push(t); } t += d; });
    total1 = t;
    ok(segTracks.length === 3, `.vrew 1번 그룹 = 구간 트랙 3개 (${segTracks.length})`);

    await win.locator('.sent[data-ln="1"] .clip-no .clip-no-n').first().click(); await win.waitForTimeout(500);
    const st = await win.evaluate(() => { const i = document.querySelector('#stageVisual img.kb'); const css = [...document.querySelectorAll('style#kb-css, style#kb-seg-css')].map((e) => e.textContent).join('\n'); return i ? { name: getComputedStyle(i).animationName, css } : null; });
    ok(st && /^kbs_/.test(st.name), `① 칸 1번 그룹 = 구간 애니메이션 (${st && st.name})`);
    const kf = st ? parseKeyframes(st.css, st.name) : null;
    ok(kf && kf.length === 4, `구간 3 → 단계 4개 (${kf && kf.length})`);
    if (kf && segTracks.length === 3) {
      const want = segTracks.map((tr) => tr.kenburnsAnimationInfo.from).concat([segTracks[2].kenburnsAnimationInfo.to]);
      ok(want.every((f, k) => sameFrame(f, kf[k])), '단계마다 프레임 = .vrew 구간 트랙 켄번스(from · 마지막 to)');
      const wantStops = segStart.map((x) => x / total1).concat([1]);
      const worst = kf.reduce((m, x, k) => Math.max(m, Math.abs(x.stop - wantStops[k])), 0);
      ok(worst < 0.002, `단계 시각 = .vrew 구간 시작 시각 비율 (최대 차이 ${worst.toFixed(4)} · ${wantStops.map((x) => x.toFixed(3)).join('/')})`);
    }

    // ① 기본 패턴 — 2번 그룹
    const c2 = clips[g2Start]; const tr2 = c2 && kbOfClip(c2);
    const n2 = await win.evaluate(() => [...document.querySelectorAll('.sent[data-ln]')].map((e) => +e.getAttribute('data-ln')).sort((a, b) => b - a)[0]);
    await win.locator(`.sent[data-ln="${n2}"] .clip-no .clip-no-n`).first().click(); await win.waitForTimeout(500);
    const st2 = await win.evaluate(() => { const i = document.querySelector('#stageVisual img.kb'); return i ? getComputedStyle(i).animationName : null; });
    const kf2 = parseKeyframes(st.css, st2 || '');
    ok(/^kb\d+$/.test(st2 || '') && kf2 && tr2 && sameFrame(kf2[0], tr2.kenburnsAnimationInfo.from) && sameFrame(kf2[kf2.length - 1], tr2.kenburnsAnimationInfo.to), `① 칸 2번 그룹 ${st2} = .vrew 켄번스 from/to`);
    ok(!errors.length, `화면 오류 0건 (${errors.slice(0, 2).join(' / ')})`);
  } finally {
    try { await win.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, chan); } catch {}
    await app.close();
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} kb-preview ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
