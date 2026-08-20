'use strict';
// node test/timestamps-ui.smoke.js — 실제 앱을 띄워 ⏱ 타임스탬프 버튼·창을 확인하는 E2E.
//   흐름: 부팅 → (파일 대화상자 스텁) 저장된 롱폼 작업본 불러오기 → capbar 버튼 클릭 → 창의 텍스트 검증.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
// TTS 길이가 들어있는 롱폼 작업본을 하나 고른다(없으면 건너뜀).
const SAVES = path.join(os.homedir(), '.priming-maker', 'projects');
function pickSnapshot() {
  if (!fs.existsSync(SAVES)) return null;
  for (const f of fs.readdirSync(SAVES).sort()) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(SAVES, f), 'utf8'));
      if (j.mode !== 'longform' || !j.projects || !j.projects[0]) continue;
      const tot = j.projects[0].groups.reduce((a, g) => a + (g.sentences || []).reduce((x, s) => x + (s.ttsDurationSec || 0), 0), 0);
      if (tot > 300) return path.join(SAVES, f);
    } catch (_) {}
  }
  return null;
}

(async () => {
  const snap = pickSnapshot();
  if (!snap) { console.log('⚠ TTS 길이가 있는 롱폼 작업본이 없어 건너뜀'); return; }
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') console.log('[renderer:error]', m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });
    console.log('· 부팅 OK');

    // 파일 대화상자 스텁 — 실제 클릭 없이 작업본을 연다
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, snap);
    // IPC 를 직접 부르면 화면(React state)이 안 바뀐다 → 실제 버튼을 눌러 앱과 똑같은 경로로 연다
    await win.click('button:has-text("작업열기")');
    await win.waitForFunction(() => /TTS [1-9]/.test((document.querySelector('.worktimes') || {}).textContent || ''), null, { timeout: 20000 });
    const nCuts = await win.locator('.cutrow, .gcard, .cuts-grid > *').count();
    console.log('· 작업본 로드 OK —', path.basename(snap), '·', (await win.locator('.worktimes').innerText()).split('·')[0].trim());

    const btn = win.locator('#capbar button:has-text("타임스탬프")');
    await btn.waitFor({ timeout: 10000 });
    if (await btn.isDisabled()) throw new Error('TTS 가 있는데 버튼이 비활성 — capbar: ' + (await win.locator('.worktimes').innerText()));
    // capbar 안에서 '분할'(H3 선택) 보다 앞에 있어야 한다 — 요청된 위치
    const order = await win.evaluate(() => {
      const kids = [...document.querySelector('#capbar').children];
      return kids.findIndex((e) => /타임스탬프/.test(e.textContent)) < kids.findIndex((e) => /분할/.test(e.textContent));
    });
    if (!order) throw new Error('버튼이 분할바 앞에 있지 않음');
    console.log('· 버튼 위치 OK (분할바 앞)');

    await btn.click();
    await win.waitForSelector('.modal-card:has-text("유튜브 타임스탬프")', { timeout: 5000 });
    const text = await win.locator('.modal-card:has-text("유튜브 타임스탬프") textarea').inputValue();
    const lines = text.trim().split('\n');
    if (!/^0:00 /.test(lines[0])) throw new Error('첫 줄이 0:00 이 아님: ' + lines[0]);
    if (lines.length < 2) throw new Error('챕터가 1개뿐');
    for (const ln of lines) if (!/^\d{1,2}:\d{2}(:\d{2})? \S/.test(ln)) throw new Error('형식 이상: ' + ln);
    console.log('· 창 OK — 챕터 ' + lines.length + '개');
    console.log('  ' + lines.slice(0, 3).join(' / ') + ' …');

    // 복사 동작 (클립보드 권한 없는 환경에서도 앱이 죽지 않는지)
    await win.click('.modal-card:has-text("유튜브 타임스탬프") button:has-text("복사")');
    await win.waitForTimeout(300);
    // ESC 로 닫힘
    await win.keyboard.press('Escape');
    await win.waitForSelector('.modal-card:has-text("유튜브 타임스탬프")', { state: 'detached', timeout: 3000 });
    console.log('· 복사·ESC 닫기 OK');
    console.log('✅ timestamps-ui.smoke.js 통과');
  } finally {
    await app.close();
  }
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
