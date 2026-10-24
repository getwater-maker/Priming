'use strict';
/**
 * node test/menubar-frame.smoke.js — Vrew 메뉴 줄 1단계(틀) 실제 화면 E2E (Lab · docs/VrewLab/메뉴줄_배치안.md)
 *   ① 메뉴 11개(Vrew 순서 + 제작) ② 탭마다 리본이 바뀐다 · 1366px 한 줄(넘침 0) ③ 옛 단추 testid 가 새 탭에서 눌린다
 *   ④ Priming 전용 자리: 모드 전환 = 오른쪽(채널·검색 뒤) · ⚡ 만들기 = 맨 오른쪽 큰 단추 ⑤ 제작 ▸ 이미지/비디오 전환
 *   ⑥ 편집 탭 단추(A단계 기능)가 클립을 고르면 켜진다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const MD = path.join(os.tmpdir(), `메뉴줄시험_${process.pid}.md`);
fs.writeFileSync(MD, ['# 메뉴줄 시험', '', '## 장', '### ① 첫 장면', '> 🖼️ 이미지: a room', '', '첫 문장은 조금 길게 씁니다. 둘째 문장입니다.', '', '### ② 둘째 장면', '> 🖼️ 이미지: a street', '', '셋째 문장입니다.', ''].join('\n'), 'utf8');

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errors = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.setViewportSize({ width: 1366, height: 768 }).catch(() => {});
    await win.waitForSelector('[data-testid="ribbon"]', { timeout: 30000 });
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, MD);
    await win.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');
    await win.waitForSelector('.sent[data-ln]', { timeout: 20000 });
    await win.waitForTimeout(500);

    console.log('\n[1] 메뉴 11개 · 기본 = 홈');
    const labels = await win.locator('.menus button[data-menu]').allInnerTexts();
    ok(labels.join(',') === '파일,홈,편집,자막,서식,삽입,AI 목소리,템플릿,효과,제작,도움말', '탭 이름·순서 ' + labels.join(' · '));
    ok(await win.locator('.menus button.on').innerText() === '홈', '기본 탭 = 홈');

    console.log('\n[2] 탭마다 리본이 바뀌고 한 줄에 들어간다(1366px)');
    const expect = { file: ['open-after-make', 'rb-new', 'rb-backup', 'rb-fileinfo'], home: ['today-scripts', 'rb-undo', 'rb-redo', 'rb-cut', 'rb-copy', 'rb-paste', 'rb-clip-merge', 'rb-clip-split', 'rb-clip-quiet'], edit: ['rb-undo', 'rb-clip-select', 'rb-cut', 'rb-clip-split', 'rb-clip-merge', 'rb-clip-quiet', 'rb-marker', 'rb-overwrite-voice', 'rb-find-edit'], caption: ['reader-open', 'rb-copy-all-caps'], format: [], insert: ['ins-image', 'ins-logo'], voice: ['tts-engine-btn', 'relink-work', 'tts-cost'], template: ['rib-template'], effect: ['rb-speed-1.5', 'rb-fit-contain'], make: ['make-sub-image', 'urldl-open'], help: ['rb-help-settings', 'rb-help-update', 'guide-open-btn', 'monitor-off'] };
    const seen = new Set();
    for (const id of Object.keys(expect)) {
      await win.click(`.menus button[data-menu="${id}"]`); await win.waitForTimeout(150);
      const m = await win.evaluate((i) => { const rb = document.querySelector('.ribbon'); return { on: rb.getAttribute('data-menu-on'), over: rb.scrollWidth - rb.clientWidth, html: rb.innerHTML.length, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }, id);
      ok(m.on === id && m.over <= 0 && m.doc <= 0, `${id}: 리본 열림 · 넘침 ${m.over}px · 문서 넘침 ${m.doc}`);
      seen.add(m.html);
      for (const t of expect[id]) ok(await win.locator(`[data-testid="${t}"]`).count() >= 1, `${id} 탭에 ${t}`);
    }
    ok(seen.size >= 9, `탭마다 리본 내용이 다르다(${seen.size}종)`);
    ok(await win.locator('.rb-reader').count() === 0, '옛 상시 묶음(rb-reader)이 없다 — 단추는 탭으로 흩어졌다');
    await win.click('.menus button[data-menu="home"]'); await win.waitForTimeout(100);
    for (const gone of ['reader-open', 'urldl-open', 'guide-open-btn']) ok(await win.locator(`[data-testid="${gone}"]`).count() === 0, `홈 탭에는 ${gone} 없음(자기 탭에서만 보인다)`);
    const mb = await win.locator('.menubar').boundingBox();
    ok(mb && mb.height < 56, `메뉴 줄 한 줄(${mb && Math.round(mb.height)}px)`);

    console.log('\n[3] Priming 전용 자리');
    const pos = await win.evaluate(() => {
      const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width, h: r.height }; };
      return { menus: q('.menus'), mode: q('.menubar .modetoggle'), chan: q('.menubar > select'), find: q('.menubar .findbar'), cta: q('.menubar .cta') };
    });
    ok(pos.mode && pos.chan && pos.mode.l > pos.find.r - 1 && pos.mode.l > pos.chan.r, '모드 전환(롱폼·리모션·출판)이 채널·검색 뒤 = 오른쪽 위');
    ok(pos.cta && pos.cta.r > pos.mode.r && pos.cta.h >= 28, '⚡ 만들기가 맨 오른쪽 큰 단추');
    ok(await win.locator('.menubar button:has-text("중단")').count() === 1, '■ 중단도 메뉴 줄');
    const hit = await win.evaluate(() => { const b = document.querySelector('.menubar .cta'); const r = b.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(h && h.closest('.cta')); });
    ok(hit, '⚡ 만들기가 실제로 눌린다(화면 안 · 가려지지 않음)');
    ok((await win.locator('.modetoggle button').allInnerTexts()).join('|').replace(/\s/g, '').includes('롱폼') && await win.locator('.modetoggle button').count() === 3, '모드 3개');

    console.log('\n[4] 제작 ▸ 이미지/비디오 전환');
    await win.click('.menus button[data-menu="make"]'); await win.waitForTimeout(150);
    ok(await win.locator('[data-testid="img-engine"]').count() === 1 && await win.locator('[data-testid="video-engine"]').count() === 0, '이미지 도구만');
    await win.click('[data-testid="make-sub-video"]'); await win.waitForTimeout(150);
    ok(await win.locator('[data-testid="video-engine"]').count() === 1 && await win.locator('[data-testid="img-engine"]').count() === 0, '비디오 도구만');

    console.log('\n[5] 편집 탭 — 클립을 고르면 켜진다');
    await win.click('.menus button[data-menu="edit"]'); await win.waitForTimeout(150);
    ok(await win.locator('[data-testid="rb-clip-split"]').isDisabled(), '클립을 안 골랐으면 나누기 꺼짐');
    await win.locator('.sent[data-ln="1"] .clip-chk').first().click(); await win.waitForTimeout(300);
    // 클립을 고르면 서식 탭으로 바뀌는 흐름이 있다 — 편집 탭으로 다시
    await win.click('.menus button[data-menu="edit"]'); await win.waitForTimeout(200);
    ok(!(await win.locator('[data-testid="rb-clip-split"]').isDisabled()) && !(await win.locator('[data-testid="rb-clip-quiet"]').isDisabled()), '클립을 고르면 나누기·무음 줄이기 켜짐');
    await win.click('[data-testid="rb-clip-split"]'); await win.waitForTimeout(400);
    ok(await win.evaluate(() => document.body.innerText.includes('나눌 자리에 커서')), '클립 나누기 = 자막 칸 열림 + 안내');
    await win.keyboard.press('Escape');

    ok(errors.length === 0, '화면 오류 없음 ' + errors.join(' | ').slice(0, 200));
  } catch (e) { fail++; console.log('  ✗ 예외 ' + (e && e.stack || e)); }
  finally { await app.close().catch(() => {}); try { fs.rmSync(MD, { force: true }); } catch {} }
  console.log(fail ? `\n❌ menubar-frame ${pass}/${pass + fail}` : `\n✅ menubar-frame ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
