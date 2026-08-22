'use strict';

/**
 * gen-manifest.js — light-updater 용 update-manifest.json 생성.
 *   앱 런타임 파일(JS/JSON/HTML/CSS/dist/아이콘 등)의 sha1 목록 + 버전 + deps 해시.
 *   node_modules·소스·산출물·대용량 정적자산은 제외 (light-updater.js 의 제외 정책과 일치).
 *
 * 사용: vite build 후 `node scripts/gen-manifest.js` (= npm run update:publish).
 *   생성된 update-manifest.json + 변경 파일들을 git commit + push 하면 클라이언트가 변경분만 받음.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'update-manifest.json');

// 폴더 단위 제외 (이름 일치) — 주의: 'dist' 는 여기 넣지 않는다(renderer/dist 는 포함해야 함).
const EXCLUDE_DIR_NAMES = new Set(['node_modules', '.git', 'output', 'test', 'lora-dataset', 'scripts', 'Ace Step', 'kaggle-lora', 'qwen-design', 'ace-step']);
// 상대경로(슬래시) 정규식 제외 — 대용량/정적/소스 + 루트 설치산출물 dist/
const EXCLUDE_REL = [
  /^dist\//,            // electron-builder 설치파일 산출물 (renderer/dist 는 제외 안 됨)
  /^renderer\/src\//,
  /^tts\/omnivoice-backend\//,
  /^assets\/fonts\//,
  // 프로젝트 루트에 임시로 둔 미디어(영상·음원)는 앱 파일이 아니므로 제외.
  //   ⚠ 안 막으면 mp3 하나만 놔둬도 매니페스트에 섞여 GitHub 에 올라가고 **모든 PC 가 수십MB 를 받는다.**
  //   dummy-tts.mp3(무음 더미)는 앱이 쓰므로 유지. 하위 폴더 미디어(vrew/dummy 등)는 영향 없음.
  /^(?!dummy-tts\.mp3$)[^/]+\.(mp3|mp4|wav|m4a|flac|ogg|aac|mov|mkv|webm|avi|m4v)$/i,
];
// 파일명/경로 제외 (_ 로 시작하는 스크래치/노트 파일 전부 제외)
const EXCLUDE_FILE = [/\.map$/, /^_/, /\.vrew$/, /\.debug\.json$/, /^\./, /^update-manifest\.json$/];

// 바이너리 확장자 (.gitattributes 의 binary 선언과 일치) — EOL 정규화 안 함, 원본 바이트로 해시.
const BINARY_EXT = new Set(['.vbin', '.bin', '.mp3', '.wav', '.ttf', '.otf', '.ico', '.png', '.jpg', '.jpeg']);

function sha1(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }

// 텍스트 파일은 CRLF→LF 정규화 후 해시 — git(eol=lf)·raw.githubusercontent 가 LF 로 서빙하므로 일치 보장.
function normalizeLF(buf) {
  const out = Buffer.allocUnsafe(buf.length);
  let j = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue; // CRLF 의 CR 제거
    out[j++] = buf[i];
  }
  return out.subarray(0, j);
}
function hashFile(abs, name) {
  const buf = fs.readFileSync(abs);
  const ext = path.extname(name).toLowerCase();
  return sha1(BINARY_EXT.has(ext) ? buf : normalizeLF(buf));
}

function walk(dir, rel, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (st.isDirectory()) {
      if (EXCLUDE_DIR_NAMES.has(name)) continue;
      if (EXCLUDE_REL.some((re) => re.test(r + '/'))) continue;
      walk(abs, r, out);
    } else {
      if (EXCLUDE_REL.some((re) => re.test(r))) continue;
      if (EXCLUDE_FILE.some((re) => re.test(name) || re.test(r))) continue;
      out[r] = hashFile(abs, name);
    }
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// 🔢 **버전 역행 차단** — 2026-08-21·22 에 두 번 났다(0.3.25→0.2.99, 0.3.26→0.3.0).
//   세션이 여러 개 도는 저장소에서 버전을 "내가 아는 값 + 1" 로 쓰면 이렇게 뒤로 간다.
//   코드는 멀쩡해도 로그의 「v0.x.x 시작」이 **어느 코드인지 못 가리키게** 되므로 여기서 막는다.
//   되돌리기가 정말 목적이면 ALLOW_VERSION_DOWNGRADE=1 을 붙여 실행한다.
function _verNum(v) {
  const p = String(v || '0').split('.').map((x) => parseInt(x, 10) || 0);
  return (p[0] || 0) * 1e6 + (p[1] || 0) * 1e3 + (p[2] || 0);
}
try {
  const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (prev && prev.version && _verNum(pkg.version) < _verNum(prev.version) && !process.env.ALLOW_VERSION_DOWNGRADE) {
    console.error(`\n❌ 버전이 거꾸로 갑니다: 지금 배포본 v${prev.version} → package.json v${pkg.version}`);
    console.error(`   package.json 의 version 을 v${prev.version} 보다 큰 값으로 올린 뒤 다시 실행하세요.`);
    console.error(`   (정말 되돌리려면: ALLOW_VERSION_DOWNGRADE=1 npm run update:publish)\n`);
    process.exit(1);
  }
} catch (_) { /* 첫 배포이거나 매니페스트가 없으면 검사 생략 */ }

const files = {};
walk(ROOT, '', files);
const depsHash = sha1(Buffer.from(JSON.stringify(pkg.dependencies || {})));
const manifest = { version: pkg.version, deps: depsHash, files };
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));
console.log(`update-manifest.json 생성: v${pkg.version} · ${Object.keys(files).length}개 파일 · deps ${depsHash.slice(0, 8)}`);
