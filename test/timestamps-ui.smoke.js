'use strict';
// node test/timestamps-ui.smoke.js — 실제 앱을 띄워 ⏱ 타임스탬프 버튼·창을 확인하는 E2E.
//   흐름: 부팅 → (파일 대화상자 스텁) 저장된 롱폼 작업본 불러오기 → capbar 버튼 클릭 → 창의 텍스트 검증.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const menu = require('./_menu');

const ROOT = path.join(__dirname, '..');
// TTS 길이가 들어있는 롱폼 작업본을 하나 고른다(없으면 건너뜀).
const SAVES = path.join(os.homedir(), '.priming-maker', 'projects');
// ⚠ 대본(.md) 이 실재하는 스냅샷만 고른다 — 「작업열기」 버튼이 없어졌으므로(2026-09-16) 이제
//   **대본을 열어** 자동 이어받기(♻)로 작업본을 되살린다. 그 대본이 그새 수정됐으면 새로 파싱돼
//   TTS 가 없을 수 있으므로 후보를 여러 개 모아 순서대로 시도한다.
function pickSnapshots(max = 5) {
  const out = [];
  if (!fs.existsSync(SAVES)) return out;
  for (const f of fs.readdirSync(SAVES).sort()) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(SAVES, f), 'utf8'));
      if (j.mode !== 'longform' || !j.projects || !j.projects[0]) continue;
      if (!j.scriptPath || !fs.existsSync(j.scriptPath)) continue;
      const tot = j.projects[0].groups.reduce((a, g) => a + (g.sentences || []).reduce((x, s) => x + (s.ttsDurationSec || 0), 0), 0);
      if (tot > 300) out.push(j.scriptPath);
      if (out.length >= max) break;
    } catch (_) {}
  }
  return out;
}
// 작업 큐(workspace.json) 백업/복원 — 이 테스트가 사용자의 큐를 바꿔 놓지 않게.
const WS = path.join(os.homedir(), '.priming-maker', 'workspace.json');
function wsBackup() { try { return fs.existsSync(WS) ? fs.readFileSync(WS, 'utf8') : null; } catch (_) { return null; } }
function wsRestore(b) { try { if (b === null) { if (fs.existsSync(WS)) fs.unlinkSync(WS); } else fs.writeFileSync(WS, b, 'utf8'); } catch (_) {} }

(async () => {
  const cands = pickSnapshots();
  if (!cands.length) { console.log('⚠ TTS 길이가 있는 롱폼 작업본이 없어 건너뜀'); return; }
  const wsSaved = wsBackup();
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => { if (m.type() === 'error') console.log('[renderer:error]', m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });
    console.log('· 부팅 OK');

    // 대본을 열어 **자동 이어받기(♻)** 로 작업본을 되살린다. 대화상자는 스텁하고, IPC 를 직접 부르지 않고
    //   실제 버튼을 눌러 앱과 똑같은 경로로 연다(IPC 직접 호출은 화면 state 가 안 바뀐다).
    let snap = null;
    for (const p of cands) {
      await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, p);
      await win.click('.hgroup button:has-text("열기")');
      try {
        await win.waitForFunction(() => /TTS [1-9]/.test((document.querySelector('.worktimes') || {}).textContent || ''), null, { timeout: 25000 });
        snap = p; break;
      } catch (_) { console.log('  · TTS 없음(대본이 수정됐을 수 있음) — 다음 후보:', path.basename(p)); }
    }
    if (!snap) { console.log('⚠ 후보 ' + cands.length + '개 모두 TTS 가 없어 건너뜀'); return; }
    console.log('· 작업본 로드 OK —', path.basename(snap), '·', (await win.locator('.worktimes').innerText()).split('·')[0].trim());

    await menu(win, 'finish');
    const btn = win.locator('#capbar button:has-text("타임스탬프")');
    await btn.waitFor({ timeout: 10000 });
    if (await btn.isDisabled()) throw new Error('TTS 가 있는데 버튼이 비활성 — capbar: ' + (await win.locator('.worktimes').innerText()));
    // 🧭 v0.5.42 — 타임스탬프는 「완성」 메뉴 리본(#capbar), 분할바는 「대본·음성」 메뉴로 갔다(한 줄에 같이 있지 않다)
    const inFinish = await win.evaluate(() => !!document.querySelector('.ribbon[data-menu-on="finish"] #capbar'));
    if (!inFinish) throw new Error('타임스탬프 버튼이 완성 메뉴에 없음');
    console.log('· 버튼 위치 OK (완성 메뉴)');

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
    wsRestore(wsSaved); // 사용자의 작업 큐를 테스트가 바꿔 놓지 않게 되돌린다
  }
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
