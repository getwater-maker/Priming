'use strict';
// node test/thumb-editor.smoke.js — 🖼 썸네일 편집기 E2E(v0.9.102). 실제 앱 + 임시 폴더만(로이 app-folders.json 은 전후 그대로 되돌린다).
//   ① 🖼 탭의 ✏ 수정 → 편집기가 열리고 패키징 문구가 들어온다 ② 글자를 크게 하면 오른쪽 열 침범 경고 ③ 문구를 고치면 「패키징과 다름」
//   ④ 저장 → 완성본은 1280×720 PNG 로 같은 이름 · 이전 파일은 _캔바원본 에 보존 · 사이드카에 로이수정 ⑤ 다른 안(B)은 건드리지 않는다
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-editor-'));
const CH = '__테스트채널_삭제해도됨_te' + process.pid;
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
const AF = path.join(os.homedir(), '.priming-maker', 'app-folders.json');
const afBak = fs.existsSync(AF) ? fs.readFileSync(AF) : null;
const restoreAf = () => { try { if (afBak) fs.writeFileSync(AF, afBak); else fs.rmSync(AF, { force: true }); } catch (_) {} };

// 1280×720 단색 PNG(외부 의존 없이)
const crcT = (() => { const t = []; for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(w, h, rgb) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

const KEY = '[테스트_1019]';
const FIN = path.join(TMP, '99_썸네일', '01_테스트채널');
const CHD = path.join(TMP, '01_테스트', '01_테스트채널');
fs.mkdirSync(FIN, { recursive: true });
for (const s of ['A', 'B', 'C']) fs.writeFileSync(path.join(FIN, `${KEY} 썸네일_${s}.png`), png(1280, 720, [120, 120, 120]));
fs.mkdirSync(path.join(CHD, '썸네일', '2026_10'), { recursive: true });
fs.writeFileSync(path.join(CHD, '썸네일', '2026_10', `${KEY} 바탕.png`), process.env.REALBG ? fs.readFileSync(process.env.REALBG) : png(1280, 720, [40, 60, 90]));   // REALBG = 눈으로 볼 때만 쓰는 진짜 그림(읽기만)
fs.mkdirSync(path.join(CHD, '대본', '2026_10'), { recursive: true });
fs.mkdirSync(path.join(CHD, '패키징', '2026_10'), { recursive: true });
const SP = path.join(CHD, '대본', '2026_10', `${KEY} 시험.md`);
fs.writeFileSync(SP, ['# 시험', '', '## 마당', '', '### 절 1', '> 🖼️ 이미지: a room', '', '첫 문장이다. 둘째 문장이다.', ''].join('\n'), 'utf8');
const pk = (a, l1, l2) => `## 썸네일 문구 ${a}\n| 줄 | 문구 | 색 |\n|---|---|---|\n| 1 | ${l1} | 흰색 |\n| 2 | ${l2} | 노랑 |\n\n`;
fs.writeFileSync(path.join(CHD, '패키징', '2026_10', `${KEY} 시험.md`), `# 패키징\n\n## 제목\n시험 제목\n\n${pk('A', '폐비를 감싼 신하들에게', '성종이 되물은 한 줄')}${pk('B', '연산군의 어머니에게', '성종이 남긴 4자')}${pk('C', '다 계산하고도', '빼놓은 한 가지')}`, 'utf8');
const BEFORE_B = fs.readFileSync(path.join(FIN, `${KEY} 썸네일_B.png`));

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false; const errs = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 860); });
    await win.waitForSelector('h1', { timeout: 20000 });
    const add = await win.evaluate(async ({ name, dir }) => { try { try { await window.api.addPreset({ name }); } catch (_) {} await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); return 'ok'; } catch (e) { return e.message; } }, { name: CH, dir: TMP });
    chMade = add === 'ok'; ok(chMade, '임시 채널: ' + add);
    await win.evaluate(async (d) => window.api.saveAppFolders({ thumbs: d }), path.join(TMP, '99_썸네일'));
    await app.evaluate(({ dialog }, fp) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] }); }, SP);
    const dto = await win.evaluate(async (name) => { const r = await window.api.openScript({ presetName: name }); return r && r.dto; }, CH);
    await app.evaluate(({ BrowserWindow }, d) => { BrowserWindow.getAllWindows()[0].webContents.send('dto-update', d); }, dto);
    await win.waitForSelector('[data-testid="thumb-edit"]', { timeout: 15000 });

    await win.click('[data-testid="thumb-edit"]');
    await win.waitForSelector('[data-testid="thumb-editor"]', { timeout: 10000 });
    await win.waitForFunction(() => !document.querySelector('[data-testid="thed-save"]').disabled, null, { timeout: 15000 });
    const l0 = await win.inputValue('[data-testid="thed-line-0"]');
    ok(l0 === '폐비를 감싼 신하들에게', '① 편집기가 열리고 패키징 A안 문구가 들어온다: ' + l0);
    ok((await win.locator('[data-testid="thed-line-1"]').inputValue()) === '성종이 되물은 한 줄', '① 2줄(노랑) 문구');
    ok(!(await win.locator('[data-testid="thed-w-diff"]').count()), '① 처음엔 「패키징과 다름」 표시 없음');
    const cv = await win.evaluate(() => { const c = document.querySelector('[data-testid="thed-canvas"]'); return [c.width, c.height]; });
    ok(cv[0] === 1280 && cv[1] === 720, '① 캔버스 = 1280×720');
    // 배경이 실제로 그려졌나(Codex 바탕 = 어두운 파랑)
    const px = await win.evaluate(() => { const c = document.querySelector('[data-testid="thed-canvas"]'); return [...c.getContext('2d').getImageData(1200, 700, 1, 1).data]; });
    ok(px[2] > px[0] && px[3] === 255, '① 배경 그림(Codex 바탕)이 그려졌다: ' + px.join(','));

    if (process.env.SHOT) { await win.waitForTimeout(500); await win.screenshot({ path: process.env.SHOT }); }
    // ② 글자를 크게 → 오른쪽 열 침범 경고
    await win.locator('[data-testid="thed-size"]').fill('200');
    await win.waitForSelector('[data-testid="thed-w-right"]', { timeout: 3000 });
    ok(true, '② 글자가 오른쪽 열을 넘으면 경고');
    await win.locator('[data-testid="thed-size"]').fill('70');
    await win.waitForFunction(() => !document.querySelector('[data-testid="thed-w-right"]'), null, { timeout: 3000 });
    ok(true, '② 줄이면 경고가 사라진다');

    // ③ 문구 수정 → 다름
    await win.fill('[data-testid="thed-line-0"]', '고친 첫 줄');
    await win.waitForSelector('[data-testid="thed-w-diff"]', { timeout: 3000 });
    ok(true, '③ 문구를 고치면 「패키징 문구와 다름」');

    // ④ 저장
    await win.click('[data-testid="thed-save"]');
    await win.waitForSelector('[data-testid="thed-msg"]', { timeout: 15000 });
    const msg = await win.textContent('[data-testid="thed-msg"]');
    ok(/저장했습니다/.test(msg), '④ 저장 성공 안내: ' + msg);
    const fa = path.join(FIN, `${KEY} 썸네일_A.png`), buf = fs.readFileSync(fa);
    ok(buf.readUInt32BE(16) === 1280 && buf.readUInt32BE(20) === 720 && buf.length < 2 * 1024 * 1024 && buf.length > 2000, '④ 완성본 = 1280×720 PNG · 2MB 이하 · 새로 그려짐(' + buf.length + 'B)');
    const kept = fs.readdirSync(path.join(FIN, '_캔바원본'));
    ok(kept.length === 1 && /썸네일_A\.png$/.test(kept[0]) && fs.statSync(path.join(FIN, '_캔바원본', kept[0])).size < 6000, '④ 이전 파일은 _캔바원본 에 그대로 보존: ' + kept.join(','));
    const sc = JSON.parse(fs.readFileSync(path.join(FIN, `${KEY} 썸네일_문구.json`), 'utf8'));
    ok(sc.캔버스 === 1280 && sc.안.A.줄[0].글 === '고친 첫 줄' && sc.안.A.줄[1].색 === '#ffd600' && sc.안.A.로이수정 === true && sc.안.A.크기 === 70, '④ 사이드카: 줄·색·크기·로이수정 표시');
    // ⑤ 다른 안·패키징은 그대로
    ok(Buffer.compare(fs.readFileSync(path.join(FIN, `${KEY} 썸네일_B.png`)), BEFORE_B) === 0, '⑤ B안 파일은 건드리지 않았다');
    ok(/성종이 되물은 한 줄/.test(fs.readFileSync(path.join(CHD, '패키징', '2026_10', `${KEY} 시험.md`), 'utf8')) && !/고친 첫 줄/.test(fs.readFileSync(path.join(CHD, '패키징', '2026_10', `${KEY} 시험.md`), 'utf8')), '⑤ 패키징 .md 는 고치지 않았다');
    ok(!fs.readdirSync(FIN).some((f) => /priming-tmp/.test(f)), '⑤ 임시 파일이 남지 않았다');
    // 한 번 더 저장 → 보존본이 _2 로 쌓인다(덮어쓰지 않는다)
    await win.click('[data-testid="thed-save"]'); await win.waitForFunction(() => /저장했습니다/.test((document.querySelector('[data-testid="thed-msg"]') || {}).textContent || ''), null, { timeout: 15000 });
    ok(fs.readdirSync(path.join(FIN, '_캔바원본')).length === 2, '⑤ 두 번째 저장 → 보존본이 하나 더(_2) — 이전 것을 덮지 않는다');
    ok(errs.length === 0, '화면 오류 0건' + (errs.length ? ': ' + errs[0] : ''));
  } finally {
    try { if (chMade) { const w2 = await app.firstWindow(); await w2.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, CH); } } catch (_) {}
    await app.close(); restoreAf();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 썸네일 편집기 E2E ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('❌ 실패:', e.message); restoreAf(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
