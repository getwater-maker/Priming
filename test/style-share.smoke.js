'use strict';
// node test/style-share.smoke.js — 🎨 이미지 스타일 편집창 E2E(실제 앱을 띄운다).
//   왜 필요한가: 원문 문자열 대조(style-share.test.js [9])는 "그 코드가 있다"만 본다. JSX 핸들러의
//   미정의 식별자는 **빌드가 못 잡고 클릭할 때만** 드러난다(v0.3.22 `onPickImgEngine is not defined`
//   · `imgEngine is not defined` 계열 사고가 이 저장소에서 두 번 났다). 그래서 실제로 눌러 본다.
//   덤으로 **서버가 구버전일 때 조용히 이 PC 스타일만 쓰는지**(404 → 안내문)도 실물로 확인된다.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const STORE = path.join(os.homedir(), '.flow-app', 'styles.json');
const EXPORT = path.join(os.homedir(), '.flow-app', 'channel-styles.json');   // 🎨 대시보드(8765)가 읽는 채널 화풍
const readStore = () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return []; } };

let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };

(async () => {
  const before = readStore();
  console.log('── 시작 — 이 PC 사용자 스타일 ' + before.length + '개');
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    const errs = [];
    win.on('console', (m) => { if (m.type() === 'error') { errs.push(m.text()); console.log('[renderer:error]', m.text()); } });
    win.on('pageerror', (e) => { errs.push(String(e.message || e)); console.log('[pageerror]', e.message); });
    await win.waitForSelector('h1', { timeout: 20000 });

    // 🎨 편집창 열기 — 이 버튼이 openStyleEditor(동기화 포함)를 부른다.
    await win.click('button[title*="이미지 스타일 편집"]');
    await win.waitForSelector('.modal-card:has-text("이미지 스타일 편집")', { timeout: 10000 });
    await win.waitForTimeout(1200);                     // 동기화 1회(서버 응답 또는 실패)

    const r = await win.evaluate(() => {
      const cards = [...document.querySelectorAll('.modal-card')];
      const card = cards.find((c) => (c.textContent || '').includes('이미지 스타일 편집'));
      const btns = [...card.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
      return {
        rows: card.querySelectorAll('textarea').length,        // 스타일 1개당 프롬프트 textarea 1개
        editable: card.querySelectorAll('input').length,       // 사용자 스타일 이름칸 + 새 스타일 입력 2개
        text: card.innerText,
        btns,
        note: (card.querySelector('.meta + div .meta') || {}).textContent || '',
      };
    });
    ok(r.btns.some((b) => b.includes('☁ 동기화')), '☁ 동기화 버튼 있음');
    ok(r.text.includes('여러 PC 공용'), '「여러 PC 공용」 안내 문구 표시');
    ok(r.rows >= 28, '스타일 목록이 렌더됨(스타일 ' + r.rows + '개 · 편집칸 ' + r.editable + '개)');

    // 수동 동기화 — 눌러서 실제로 서버와 오간다(구버전 서버면 안내문이 뜬다).
    await win.click('.modal-card button:has-text("☁ 동기화")');
    await win.waitForTimeout(2500);
    const note = await win.evaluate(() => {
      const cards = [...document.querySelectorAll('.modal-card')];
      const card = cards.find((c) => (c.textContent || '').includes('이미지 스타일 편집'));
      // ☁ 동기화 버튼과 같은 줄의 안내문만 읽는다(목록의 '읽기전용' 라벨과 섞이지 않게).
      const btn = [...card.querySelectorAll('button')].find((b) => (b.textContent || '').includes('☁ 동기화'));
      const row = btn && btn.parentElement;
      return ((row && row.querySelector('span.meta')) || {}).textContent || '';
    });
    console.log('  동기화 결과: ' + (note || '(안내문 없음 = 정상 동기화)'));
    ok(!/동기화 중…$/.test(note), '동기화가 끝났다(진행중 문구가 남아 있지 않다)');
    if (note) {
      // 서버가 살아 있으면 성공 문구, 못 쓰면 이유 + 무엇을 할지 — 둘 중 하나여야 한다(정체불명 문구 금지).
      ok(/맞췄습니다|구버전|받지 못|주소|올리지/.test(note), '동기화 결과를 사람 말로 알려준다');
    }

    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    const closed = await win.evaluate(() => ![...document.querySelectorAll('.modal-card')].some((c) => (c.textContent || '').includes('이미지 스타일 편집')));
    ok(closed, 'ESC 로 닫힌다');
    // 🎨 채널편집 → 제작 도구 탭: 롱폼 화풍 + **썸네일 화풍**(대시보드용) 칸이 있어야 한다. (쇼츠 화풍 칸은 2026-08-22 쇼츠 모드 제거와 함께 삭제)
    await win.click('button[title*="채널(프리셋) 설정 편집"]');
    await win.waitForSelector('.modal-card.tabbed', { timeout: 10000 });
    await win.click('.modal-card button:has-text("제작 도구")');
    await win.waitForTimeout(300);
    const t = await win.evaluate(() => {
      const card = [...document.querySelectorAll('.modal-card')].find((c) => (c.textContent || '').includes('이미지 스타일'));
      const rows = [...card.querySelectorAll('.crow')];
      const lab = (r) => ((r.querySelector('.l') || {}).textContent || '');
      const thumb = rows.find((r) => lab(r).includes('썸네일'));
      const sel = thumb && thumb.querySelector('select');
      return {
        styleRows: rows.filter((r) => lab(r).includes('스타일')).length,
        firstOpt: sel && sel.options.length ? sel.options[0].text : '',
        text: card.innerText,
      };
    });
    ok(t.styleRows === 1, '롱폼 화풍 칸 1개 (' + t.styleRows + '개)');
    ok(/롱폼과 같게/.test(t.firstOpt), '썸네일 화풍 칸의 기본값 = 롱폼과 같게 → ' + t.firstOpt);
    ok(t.text.includes('channel-styles.json'), '내보내는 파일 경로를 화면이 알려 준다');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);

    ok(errs.length === 0, '화면 오류 0건' + (errs.length ? ' → ' + errs.join(' / ') : ''));
  } finally {
    await app.close().catch(() => {});
  }

  // 동기화가 이 PC 스타일을 지우지 않았는지 — 개수는 줄어들 수 없다(서버가 구버전이면 그대로).
  const after = readStore();
  const lost = before.filter((s) => !after.some((x) => x.id === s.id)).map((s) => s.name);
  ok(after.length >= before.length, '사용자 스타일 개수 ' + before.length + ' → ' + after.length + ' (줄지 않음)');
  ok(lost.length === 0, '사라진 스타일 없음' + (lost.length ? ' → ' + lost.join(', ') : ''));

  // 🎨 앱을 켜면(4초 뒤) 채널 화풍이 내보내진다 — 아도나이로이 대시보드(8765)가 읽는 그 파일.
  let ex = null;
  try { ex = JSON.parse(fs.readFileSync(EXPORT, 'utf8')); } catch (_) {}
  ok(!!ex, '채널 화풍 파일이 있다 → ' + EXPORT);
  if (ex) {
    ok(Array.isArray(ex.channels) && ex.channels.length > 0, '채널 ' + ex.channels.length + '개');
    ok(/[+]09:00$/.test(ex.updatedAt || ''), 'updatedAt 이 KST(+09:00) → ' + ex.updatedAt);
    const miss = ex.channels.filter((c) => !c.long || (!c.long.prompt && !c.long.missing));
    ok(miss.length === 0, '모든 채널에 롱폼 화풍 문자열이 있다' + (miss.length ? ' → ' + miss.map((c) => c.channel).join(',') : ''));
    ok(ex.channels.every((c) => c.thumb && c.thumb.from), '채널마다 썸네일 화풍이 확정돼 있다(폴백도 표기)');
  }

  console.log('\n결과: ' + (n - bad) + '/' + n + (bad ? ' — 실패 ' + bad : ' 통과'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
