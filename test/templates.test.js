'use strict';
/**
 * node test/templates.test.js — 📋 효과 템플릿(Lab · 남은 기능 ⑨)
 *   [1] 순수 규칙(core/templates) · [2] 실제 앱: 효과를 준 클립 → 저장 → 다른 클립에 입히기 · 자리·순서는 그대로 · 되돌리기 · 덮어쓰기·삭제 · 패널
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const TP = require('../core/templates');

console.log('\n[1] 순수 규칙');
const L = { fill: 'cover', flipH: true, zoom: 150, rot: 10, bg: '#00ff00', filter: 'bw', opacity: 60, crop: { l: 0.2 }, trans: { type: 'wipeleft', sec: 2 }, box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, layer: 2, kbSeg: 3, motion: 'in' };
const pk = TP.pickLook(L);
ok(pk.zoom === 150 && pk.filter === 'bw' && pk.opacity === 60 && pk.crop.l === 0.2 && pk.trans.type === 'wipeleft' && pk.fill === 'cover' && pk.flipH === true && pk.motion === 'in', '효과 필드를 담는다(확대·회전·배경·필터·불투명·자르기·전환·반전·채우기·움직임)');
ok(!('box' in pk) && !('layer' in pk) && !('kbSeg' in pk) && !('fx' in pk), '🔑 자리(box)·순서(layer)·켄번스 구간·오버레이는 담지 않는다');
ok(Object.keys(TP.pickLook({ fill: 'auto', motion: 'auto' })).length === 0, '기본값만 있으면 비어 있다');
const old = { box: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, layer: 1, kbSeg: 2, zoom: 200, filter: 'sepia' };
const ap = TP.applyLook(old, { zoom: 120, opacity: 50 });
ok(ap.zoom === 120 && ap.opacity === 50 && !ap.filter && ap.box.w === 0.4 && ap.layer === 1 && ap.kbSeg === 2, '입히면 효과는 템플릿 것으로 바뀌고(없는 효과 = 꺼짐) 자리·순서·켄번스 구간은 그대로');
ok(TP.applyLook({ zoom: 150 }, {}) === undefined, '효과 없는 템플릿을 입히면 look 이 비어 기본으로');
const mk = TP.make('  회상 장면  ', { zoom: 130 }, { vol: 0.5, denoise: 2 });
ok(mk.name === '회상 장면' && mk.look.zoom === 130 && mk.vol === 0.5 && mk.denoise === 2, '템플릿 만들기(이름 다듬기 · 소리 효과 포함)');
ok(TP.make('   ', { zoom: 130 }) === null && TP.isEmpty(TP.make('x', {}, {})) && !TP.isEmpty(mk), '이름이 없으면 null · 효과가 없으면 빈 템플릿');
ok(/확대 130%/.test(TP.describe(mk)) && /볼륨 50%/.test(TP.describe(mk)) && /노이즈 중/.test(TP.describe(mk)), '한 줄 설명');

console.log('\n[2] 실제 앱');
(async () => {
  const M = read('main.js'), PL = read('preload.js'), APP = read('renderer/src/App.jsx');
  ok(/ipcMain\.handle\('tpl-save'/.test(M) && /ipcMain\.handle\('tpl-apply'/.test(M) && /tplApply: \(args\)/.test(PL) && /data-testid="tpl-panel"/.test(APP) && /data-testid="rb-tpl-save"/.test(APP) && !/준비 중 — 로고는 삽입 메뉴/.test(APP), '소스 배선 · 템플릿 탭의 「준비 중」 문구가 사라졌다');
  const TAG = `템플릿시험_${process.pid}`;
  const MD = path.join(os.tmpdir(), `${TAG}.md`);
  const SNAP = path.join(os.homedir(), '.priming-maker', 'projects', `${TAG}.smproj.json`);
  fs.writeFileSync(MD, ['# 시험', '', '## 장', '### ① 첫', '> 🖼️ 이미지: a', '', '첫 문장입니다. 둘째 문장입니다.', '', '### ② 둘', '> 🖼️ 이미지: b', '', '셋째 문장입니다.', ''].join('\n'), 'utf8');
  const errors = []; const made = [];
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow(); win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.setViewportSize({ width: 1366, height: 800 }).catch(() => {});
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    const st = () => win.evaluate(async () => { const r = await window.api.listQueue(); const c = r.dto.projects[0].cuts; return { g1: c[0].look || null, g2: c[1].look || null, s: c.flatMap((x) => x.sentences || []).map((s) => ({ vl: s.vl || null, dn: s.dn || 0 })) }; });
    const call = (name, args) => win.evaluate(async ({ name, args }) => window.api[name](args), { name, args });
    // 효과 준비 — G1: 확대·필터·불투명도 + 자리·순서 / 문장 1: 볼륨·노이즈 / G2: 자기 자리(box)
    await call('setGroupLook', { shortsNum: 1, groupNum: 1, patch: { zoom: 150, filter: 'bw', opacity: 60, layer: 1 } });
    await call('clipVolume', { shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }], vol: 0.5 });
    await call('clipDenoise', { shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }], level: 2 });
    await call('setGroupLook', { shortsNum: 1, groupNum: 2, patch: { box: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, zoom: 300 } });
    const s0 = await st();
    ok(s0.g1.zoom === 150 && s0.g2.zoom === 300 && s0.s[0].vl === 0.5 && s0.s[0].dn === 2, '준비: G1 효과 · 문장1 소리 효과 · G2 자기 효과·자리');
    // 저장
    const bad = await call('tplSave', { shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }], name: '   ' });
    ok(bad.ok === false && /이름/.test(bad.error), '이름이 없으면 거부: ' + bad.error);
    const none = await call('tplSave', { shortsNum: 1, items: [{ groupNum: 2, sentIdx: 0 }], name: '__시험없음' });
    ok(none.ok === true, '(G2 는 효과가 있어 저장된다 — 아래에서 지운다)'); made.push(...(none.list || []).filter((t) => t.name === '__시험없음').map((t) => t.id));
    const sv = await call('tplSave', { shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }], name: '__시험템플릿' });
    ok(sv.ok && !sv.replaced && sv.list.some((t) => t.name === '__시험템플릿' && /확대 150%/.test(t.desc) && /볼륨 50%/.test(t.desc)), '저장 → 목록에 이름·설명');
    made.push(...sv.list.filter((t) => t.name === '__시험템플릿').map((t) => t.id));
    const sv2 = await call('tplSave', { shortsNum: 1, items: [{ groupNum: 1, sentIdx: 0 }], name: '__시험템플릿' });
    ok(sv2.ok && sv2.replaced && sv2.list.filter((t) => t.name === '__시험템플릿').length === 1, '같은 이름은 덮어쓴다(중복 없음)');
    const tid = sv.list.find((t) => t.name === '__시험템플릿').id;
    // 입히기 — 문장 3(G2)에
    const ap = await call('tplApply', { shortsNum: 1, items: [{ groupNum: 2, sentIdx: 0 }], id: tid });
    const s1 = await st();
    ok(ap.ok && s1.g2.zoom === 150 && s1.g2.filter === 'bw' && s1.g2.opacity === 60, `G2 에 효과가 입혀졌다(확대 ${s1.g2 && s1.g2.zoom} · 필터 ${s1.g2 && s1.g2.filter} · 불투명 ${s1.g2 && s1.g2.opacity})`);
    ok(s1.g2.box && Math.abs(s1.g2.box.w - 0.5) < 1e-6 && !s1.g2.layer, '🔑 G2 의 자리(box)는 그대로(순서는 템플릿에 없어 안 생김)');
    ok(s1.s[2].vl === 0.5 && s1.s[2].dn === 2, '문장 3 에 소리 효과(볼륨 50% · 노이즈 중)');
    ok(s1.g1.layer === 1, '원본 클립(G1)의 순서는 그대로');
    await win.evaluate(async () => window.api.undo({})); await win.waitForTimeout(500);
    const s2 = await st();
    ok(s2.g2.zoom === 300 && !s2.g2.filter && !s2.s[2].vl && !s2.s[2].dn, '되돌리기 → G2 효과·문장 소리 효과가 입히기 전으로');
    // 패널(화면)
    await win.keyboard.press('Escape'); await win.locator('.sent[data-ln="3"] .clip-chk').first().click(); await win.waitForTimeout(250);
    await win.click('.menus button[data-menu="template"]'); await win.waitForTimeout(250);
    await win.click('[data-testid="rb-tpl-apply"]'); await win.waitForSelector('[data-testid="tpl-panel"]', { timeout: 3000 });
    await win.waitForSelector('[data-testid="tpl-item"]', { timeout: 3000 });
    ok(await win.locator('[data-testid="tpl-item"]', { hasText: '__시험템플릿' }).count() === 1, '패널 목록에 저장한 템플릿');
    await win.locator('[data-testid="tpl-item"]', { hasText: '__시험템플릿' }).locator('[data-testid="tpl-apply"]').click(); await win.waitForTimeout(1200);
    ok((await st()).g2.filter === 'bw', '패널에서 「고른 클립에 입히기」');
    await win.fill('[data-testid="tpl-name"]', '__시험화면저장'); await win.click('[data-testid="tpl-save"]'); await win.waitForTimeout(900);
    ok(await win.locator('[data-testid="tpl-item"]', { hasText: '__시험화면저장' }).count() === 1, '패널에서 이름 적어 저장(고른 첫 클립의 효과)');
    await win.locator('[data-testid="tpl-item"]', { hasText: '__시험화면저장' }).locator('[data-testid="tpl-del"]').click(); await win.waitForTimeout(700);
    ok(await win.locator('[data-testid="tpl-item"]', { hasText: '__시험화면저장' }).count() === 0, '삭제');
    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally {
    try { const w = await app.firstWindow(); await w.evaluate(async () => { const r = await window.api.tplList(); for (const t of (r.list || [])) if (/^__시험/.test(t.name)) await window.api.tplDelete({ id: t.id }); }); } catch (_) {}
    await app.close().catch(() => {});
    for (const f of [MD, SNAP]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
  console.log(`\n${fail ? '❌' : '✅'} templates ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
