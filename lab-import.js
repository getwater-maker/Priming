'use strict';
/**
 * node lab-import.js [--with-keys] [--force] — 원본 Priming 설정 일부를 Priming Lab 데이터 폴더로 **복사**한다.
 *   · 원본 파일은 읽기만 한다(쓰지 않는다).
 *   · 채널(tts-presets.json)의 출력·대본 폴더는 Lab 폴더로 바꿔 쓴다 — Lab 에서 대본을 고치거나 만들어도 원본 폴더에 닿지 않게.
 *   · 토큰(youtube-auth·gmail·license)은 가져오지 않는다. API 키(tts-secrets.json)는 --with-keys 일 때만.
 *   · Lab 쪽에 이미 파일이 있으면 건너뛴다(--force 면 덮어씀).
 *   보통 셸(진짜 홈)에서 실행한다 — lab-start.ps1 안에서 돌리면 원본 홈을 못 찾는다.
 */
const fs = require('fs'), path = require('path'), os = require('os');

const DATA = 'D:\\Priming-VrewLab-data';
const SRC = os.homedir();
const DST = path.join(DATA, 'home');
const withKeys = process.argv.includes('--with-keys');
const force = process.argv.includes('--force');
if (path.resolve(SRC).toLowerCase() === path.resolve(DST).toLowerCase()) {
  console.error('지금 홈이 Lab 홈입니다 — 보통 셸에서 실행하세요'); process.exit(1);
}

const FILES = [
  ['.flow-app', 'tts-presets.json'],
  ['.flow-app', 'styles.json'],
  ['.flow-app', 'style-order.json'],
  ['.flow-app', 'channel-styles.json'],
  ['.flow-app', 'tts-config.json'],
  ['.flow-app', 'omnivoice-dict.json'],
  ['.priming-maker', 'comfy-config.json'],
  ['.priming-maker', 'comfy-image-config.json'],
  ['.priming-maker', 'comfy-video-config.json'],
  ['.priming-maker', 'caption-formats.json'],
];
if (withKeys) FILES.push(['.flow-app', 'tts-secrets.json']);

// 채널 값 중 폴더를 가리키는 키 → Lab 폴더로
const FOLDER_KEYS = ['outputFolder', 'outLong', 'outShort', 'outImages', 'outWhiteboard', 'outUpload', 'outReader', 'downloadFolder', 'imgTsvFolder', 'scriptFolder'];
const labFolder = (key) => path.join(DATA, key === 'scriptFolder' ? 'scripts' : 'output');

let copied = 0, skipped = 0;
for (const [dir, name] of FILES) {
  const from = path.join(SRC, dir, name), to = path.join(DST, dir, name);
  if (!fs.existsSync(from)) { console.log(`  · 원본 없음: ${dir}\\${name}`); continue; }
  if (fs.existsSync(to) && !force) { console.log(`  · 이미 있음(건너뜀): ${dir}\\${name}`); skipped++; continue; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  let text = fs.readFileSync(from, 'utf8');
  if (name === 'tts-presets.json') {
    const list = JSON.parse(text);
    let n = 0;
    for (const p of (Array.isArray(list) ? list : [])) {
      for (const k of FOLDER_KEYS) if (typeof p[k] === 'string' && p[k].trim()) { p[k] = labFolder(k); n++; }
    }
    text = JSON.stringify(list, null, 2);
    console.log(`  · 채널 ${list.length}개 — 폴더 값 ${n}개를 Lab 폴더로 바꿈`);
  }
  fs.writeFileSync(to, text);
  copied++;
  console.log(`  ✓ ${dir}\\${name}`);
}
for (const d of ['output', 'scripts']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
console.log(`\n복사 ${copied}개 · 건너뜀 ${skipped}개 → ${DST}`);
console.log(`대본은 ${path.join(DATA, 'scripts')} 로 **복사해서** 여세요(원본 대본을 열면 Lab 의 편집이 원본 .md 를 고칩니다).`);
