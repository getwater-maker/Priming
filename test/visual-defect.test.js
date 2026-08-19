'use strict';
/**
 * test/visual-defect.test.js — 생성 시각물의 '이상(검정·노이즈)' 판정 회귀 테스트
 *
 * 🔑 판정 함수를 **main.js 원문에서 그대로 뽑아** 실행한다 — 여기에 로직을 복사해 두면
 *    앱과 갈라져도 테스트가 통과해 버려 아무것도 지켜 주지 못한다.
 *
 * 배경: 클라우드 동시 생성 시 서버가 completed 로 보고하면서도 못 쓸 결과를 내보낸다.
 *   ① 검정(2026-08-14)  ② 노이즈 = 디노이즈 안 된 latent (2026-08-19, 203장 중 7장)
 *   실측 임계 — 노이즈 거칠기 13.4~13.6 / 정상 최대 4.8, 노이즈 구조 5.4~7.5 / 정상 최소 14.0
 *
 * 실행: node test/visual-defect.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ff = require(path.join(ROOT, 'core', 'media-utils')).getFfmpegPath();
if (!ff) { console.log('⚠ ffmpeg 없음 — 건너뜀'); process.exit(0); }

// ── main.js 에서 판정 블록 추출 ──
const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const a = src.indexOf('const BAD_DARK_MEAN');
const b = src.indexOf('\n}\n', src.indexOf('return _visRemember(key, ok.every', a)) + 3;
if (a < 0 || b < 3) { console.error('❌ main.js 에서 판정 블록을 못 찾음 (함수명이 바뀌었나?)'); process.exit(1); }
const mod = { exports: {} };
new Function('fs', 'require', 'module', src.slice(a, b) + '\nmodule.exports={looksBadImage,looksBadVideo};')
  (fs, (m) => require(m.startsWith('./') ? path.join(ROOT, m) : m), mod);
const { looksBadImage, looksBadVideo } = mod.exports;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visdef-'));
const mk = (name, args) => {
  const out = path.join(dir, name);
  execFileSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', ...args, out]);
  return out;
};
const NOISE_VF = 'geq=random(1)*255:random(2)*255:random(3)*255';
let pass = 0, fail = 0;
const check = (name, got, want) => {
  if (got === want) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — 판정 ${got}, 기대 ${want}`); }
};

(async () => {
console.log('▸ 이미지');
check('완전 검정 → 폐기', await looksBadImage(mk('black.png', ['-f', 'lavfi', '-i', 'color=c=black:s=1344x768', '-frames:v', '1'])), true);
check('거의 검정 → 폐기', await looksBadImage(mk('near.png', ['-f', 'lavfi', '-i', 'color=c=0x050505:s=1344x768', '-frames:v', '1'])), true);
check('랜덤 노이즈 → 폐기', await looksBadImage(mk('noise.png', ['-f', 'lavfi', '-i', 'nullsrc=s=1344x768', '-vf', NOISE_VF, '-frames:v', '1'])), true);
// ⚠ 아래는 '지우면 안 되는' 쪽 — 오탐 1건이 멀쩡한 그림을 지우고 .vrew 를 막는다.
check('그라데이션 → 유지', await looksBadImage(mk('grad.png', ['-f', 'lavfi', '-i', 'gradients=s=1344x768:c0=0x102030:c1=0xd0c0a0', '-frames:v', '1'])), false);
check('어두운 밤 장면 → 유지', await looksBadImage(mk('dark.png', ['-f', 'lavfi', '-i', 'gradients=s=1344x768:c0=0x05070c:c1=0x2a3040', '-frames:v', '1'])), false);
check('컬러바 → 유지', await looksBadImage(mk('bars.png', ['-f', 'lavfi', '-i', 'testsrc2=s=1344x768', '-frames:v', '1'])), false);
// 결이 거친 그림(필름 그레인)은 거칠기가 올라가도 '구조'가 있으므로 유지돼야 한다 = AND 조건이 필요한 이유
check('필름그레인 낀 그림 → 유지', await looksBadImage(mk('grain.png', ['-f', 'lavfi', '-i', 'gradients=s=1344x768:c0=0x203040:c1=0xc0b090', '-vf', 'noise=alls=18:allf=t+u', '-frames:v', '1'])), false);
// ③ 색 깨짐 — 조건이 깨졌지만 노이즈까지는 안 간 것(얼굴 타일 + 형광색). 실제로 [고전_0826] 27.png 가 이랬다.
check('색 깨짐(형광+색튐) → 폐기', await looksBadImage(mk('glitch.png', ['-f', 'lavfi', '-i', 'testsrc2=s=1344x768', '-vf', 'noise=alls=60:allf=t', '-frames:v', '1'])), true);
// ⚠ 색만 거칠고 형광이 없으면 **유지**해야 한다 — AND 조건이 필요한 이유(형광만/색거칠기만 쓰면 멀쩡한 그림이 지워진다).
check('색만 거친 그림 → 유지', await looksBadImage(mk('chromy.png', ['-f', 'lavfi', '-i', 'gradients=s=1344x768:c0=0x203040:c1=0xc0b090', '-vf', 'noise=alls=90:allf=t+u', '-frames:v', '1'])), false);
check('없는 파일 → 유지(오탐 방지)', await looksBadImage(path.join(dir, 'nope.png')), false);

console.log('▸ 영상');
const H264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
check('검정 영상 → 폐기', await looksBadVideo(mk('vblack.mp4', ['-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=5', ...H264])), true);
check('노이즈 영상 → 폐기', await looksBadVideo(mk('vnoise.mp4', ['-f', 'lavfi', '-i', 'nullsrc=s=640x360:d=5', '-vf', NOISE_VF, ...H264, '-crf', '5'])), true);
// ⚠ 정상 영상 대역으로 `testsrc2`(컬러바)를 쓰면 안 된다 — **순수 원색만으로 이뤄진 합성 패턴**이라
//   규칙 ③(형광 + 색 튐)이 겨냥하는 특징을 그대로 갖는다. 실제 생성물에는 그런 그림이 없다
//   (실측: 대본 이미지 262장·영상 31개에서 형광 비율 0.00%, 오탐 0). 매끄러운 그라데이션이 현실적인 대역이다.
check('정상 영상 → 유지', await looksBadVideo(mk('vgood.mp4', ['-f', 'lavfi', '-i', 'gradients=s=640x360:c0=0x1a2a3a:c1=0xd8c8a8:d=5', ...H264])), false);
check('없는 영상 → 유지(오탐 방지)', await looksBadVideo(path.join(dir, 'nope.mp4')), false);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log(`\n${pass}/${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
})();
