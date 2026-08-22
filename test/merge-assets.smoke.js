'use strict';
// node test/merge-assets.smoke.js — 「📥 자산 이어받기」 앱 E2E (실제 Electron 부팅).
//   단위 테스트(merge-assets.test.js)는 순수 로직을 본다. 여기서는 **main.js 배선이 실제로 도는지**를 본다:
//     ① 통합대본(자산출처 메타)을 열면 **자동으로** 이어받기가 실행된다
//     ② 문장에 ttsAudioPath + ttsDurationSec 가 실려 화면 DTO 까지 온다(함정 ②)
//     ③ 경로가 **통합본 작업폴더 안**이다(원본 참조 금지 — 함정 ①) · 원본 폴더 무변경
//     ④ 헤더에 「📥 이어받기」 버튼이 뜨고, 눌러도(재실행) 깨지지 않는다
//     ⑤ 화면 오류 0건 — JSX 안의 미정의 식별자는 빌드가 못 잡는다(v0.3.22 사고)
//
//   ⚠ 사용자 작업물을 건드리지 않는다: 임시 채널(출력=임시폴더) + 임시 대본 + 임시 소스 출력폴더.
//     스냅샷은 만들지 않고 **번호 폴백** 경로를 태운다 → ~/.priming-maker/projects 에는 통합대본 것 하나만
//     생기고 그것도 끝에 지운다. 음성은 ffmpeg 로 만든 **진짜 무음 wav** 라 길이 실측이 성립한다.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-smoke-'));
const CH = '__테스트채널_삭제해도됨_' + process.pid;
const MERGED_BASE = '[테스트_0000] 이어받기 점검_' + process.pid;
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };

// ── 진짜 무음 wav (ffprobe 로 길이를 잴 수 있어야 한다) ──
let ffmpeg = null;
try {
  ffmpeg = require('ffmpeg-static');
  if (ffmpeg && ffmpeg.includes('app.asar') && !ffmpeg.includes('app.asar.unpacked')) ffmpeg = ffmpeg.replace('app.asar', 'app.asar.unpacked');
} catch {}
function silentWav(out, sec) {
  const r = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(sec), out], { stdio: 'ignore' });
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error('무음 wav 생성 실패');
}

// ── 픽스처 ──
const SRC_OUT = path.join(TMP, '[테스트] 소스1');           // 기존 회차의 출력폴더(자산이 여기 있다)
fs.mkdirSync(path.join(SRC_OUT, 'tts-1'), { recursive: true });
fs.mkdirSync(path.join(SRC_OUT, 'media-1'), { recursive: true });
const SRC_MD = path.join(TMP, '[테스트] 소스1.md');
const SRC_SENTS = ['첫째 문장입니다.', '둘째 문장입니다.', '셋째 문장입니다.'];
fs.writeFileSync(SRC_MD, ['# 소스1', '', '## 본문', '', '### 하나', ...SRC_SENTS, '', '> 🖼️ 이미지: a quiet wooden desk at night', ''].join('\n'), 'utf8');
if (ffmpeg) SRC_SENTS.forEach((_, i) => silentWav(path.join(SRC_OUT, 'tts-1', `${i + 1}.wav`), 1.5 + i * 0.5));
fs.writeFileSync(path.join(SRC_OUT, 'media-1', '01.png'), 'FIXTURE-IMAGE');

const MERGED_MD = path.join(TMP, MERGED_BASE + '.md');
fs.writeFileSync(MERGED_MD, [
  '# 통합본 점검',
  '',
  `> 📥 자산출처: ${SRC_MD} | ${SRC_OUT}`,
  '',
  '## 본문',
  '',
  '### 하나',
  ...SRC_SENTS,
  '',
  '> 🖼️ 이미지: a quiet wooden desk at night',
  '',
].join('\n'), 'utf8');

const fpSrc = () => fs.readdirSync(path.join(SRC_OUT, 'tts-1')).sort().join(',') + '|'
  + fs.readdirSync(path.join(SRC_OUT, 'media-1')).sort().join(',');
const FP_BEFORE = fpSrc();
const SNAP_OF_MERGED = path.join(os.homedir(), '.priming-maker', 'projects', MERGED_BASE + '.smproj.json');

(async () => {
  if (!ffmpeg) { console.log('ffmpeg-static 없음 — 건너뜀'); process.exit(0); }
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = [];
  let chMade = false;
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    win.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });

    // 대화상자 스텁 — 파일 선택은 통합대본으로, 완료/경고 팝업은 자동 확인(테스트가 멈추지 않게).
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      dialog.showMessageBox = async () => ({ response: 0 });
    }, MERGED_MD);

    // 임시 채널(출력=임시폴더) — 사용자 G: 작업물 보호
    await win.evaluate(async () => {
      const ps = (await window.api.listPresets()) || [];
      for (const nm of ps.map((p) => p.name).filter((x) => x.indexOf('__테스트채널_삭제해도됨') === 0)) {
        try { await window.api.removePreset({ name: nm }); } catch (_) {}
      }
    });
    const add = await win.evaluate(async (name) => { try { await window.api.addPreset({ name }); return 'ok'; } catch (e) { return e.message; } }, CH);
    ok(add === 'ok', '임시 채널 생성');
    chMade = add === 'ok';
    await win.evaluate(async ({ name, dir }) => window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }), { name: CH, dir: TMP });

    // ── ① 대본 열기 → 자동 이어받기 ──
    const r = await win.evaluate(async (name) => {
      const res = await window.api.openScript({ presetName: name });
      const pr = res && res.dto && res.dto.projects && res.dto.projects[0];
      return {
        outRoot: res && res.outRoot,
        mergeSources: res && res.dto && res.dto.mergeSources,
        sents: pr ? [].concat(...pr.cuts.map((c) => c.sentences)) : [],
        images: pr ? pr.cuts.map((c) => c.imagePath) : [],
      };
    }, CH);
    ok(r.mergeSources === 1, 'DTO 에 mergeSources=1 (📥 버튼 조건)');
    ok(r.sents.length === 3, '문장 3개');
    ok(r.sents.every((s) => s.audio), '① 자동 이어받기 — 전 문장에 음성 경로가 붙었다');
    ok(r.sents.every((s) => s.dur > 0), '② 전 문장에 길이(ttsDurationSec)가 있다 (함정 ②)');
    ok(Math.abs(r.sents[0].dur - 1.5) < 0.2 && Math.abs(r.sents[2].dur - 2.5) < 0.2,
      `길이가 원본과 일치 (${r.sents.map((s) => s.dur).join(', ')})`);
    const inWork = (p) => p && String(p).toLowerCase().startsWith(String(r.outRoot).toLowerCase() + path.sep);
    ok(r.sents.every((s) => inWork(s.audio)), '③ 음성 경로가 통합본 작업폴더 안 (원본 참조 금지 — 함정 ①)');
    ok(r.images.every((p) => !p || inWork(p)), '③ 이미지 경로도 작업폴더 안');
    ok(r.images.filter(Boolean).length === 1, '이미지 1개 연결');
    ok(fs.existsSync(path.join(r.outRoot, 'tts-1', '1.wav')), '실제 파일이 복사됐다');
    ok(fs.readFileSync(path.join(r.outRoot, 'media-1', '01.png'), 'utf8') === 'FIXTURE-IMAGE', '이미지 내용 일치');
    ok(fpSrc() === FP_BEFORE, '③ 소스(원본) 출력폴더 무변경');

    const logText = await win.evaluate(() => (document.querySelector('#log') || {}).textContent || '');
    ok(/자산 이어받기 완료/.test(logText), '로그에 「자산 이어받기 완료」');
    ok(!/is not defined/.test(logText), '로그에 "is not defined" 없음');

    // ── ④ 헤더 「📥 이어받기」 버튼 ──
    const btn = await win.$('button:has-text("📥 이어받기")');
    ok(!!btn, '④ 「📥 이어받기」 버튼이 보인다');
    if (btn) {
      await btn.click();
      await win.waitForTimeout(1500);
      const again = await win.evaluate(() => (document.querySelector('#log') || {}).textContent || '');
      ok((again.match(/자산 이어받기 완료/g) || []).length >= 2, '④ 버튼 재실행도 완료된다(멱등)');
      ok(fpSrc() === FP_BEFORE, '재실행 후에도 원본 무변경');
    }
    ok(errs.length === 0, '⑤ 화면 오류 0건' + (errs.length ? ': ' + errs[0] : ''));
  } catch (e) {
    bad++; console.log('  ✗ 예외: ' + (e && e.message));
  } finally {
    try {
      if (chMade) {
        const w = await app.firstWindow();
        await w.evaluate(async (name) => { try { await window.api.removePreset({ name }); } catch (_) {} }, CH);
      }
    } catch {}
    try { await app.close(); } catch {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
    try { if (fs.existsSync(SNAP_OF_MERGED)) fs.unlinkSync(SNAP_OF_MERGED); } catch {}
  }
  console.log(`\n${bad === 0 ? '✅' : '❌'} 자산 이어받기 E2E: ${n - bad}/${n} 통과`);
  process.exit(bad ? 1 : 0);
})();
