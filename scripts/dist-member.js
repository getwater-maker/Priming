'use strict';
/**
 * scripts/dist-member.js — 🛒 판매판 설치본 만들기(v1.0.26 뼈대 → v1.0.27 · docs/판나누기-설계.md ②).
 *   기본          = 회원용 `dist/member/Priming-Setup-<ver>.exe`(appId 그대로 · edition.json = member)
 *   `--preview`   = 🏠 로이 PC 에 로이판과 **나란히** 까는 판매판 미리보기(로이 2026-11-05 「따로 쓰기」)
 *                   `dist/member-preview/Priming-Member-Preview-Setup-<ver>.exe` · 다른 appId·설치 폴더·이름(「Priming 판매판」)
 *                   · edition.json 에 dataHome = 설정·채널·키·로그인을 「홈\PrimingMember」 아래로(로이판과 섞이지 않는다 · bootstrap)
 *   edition.json 은 저장소 폴더에 쓰지 않는다 — 임시 파일을 extraResources 로 설치폴더(app/)에만 넣는다(그 사이 로이판 개발 실행이 판매판이 되지 않게).
 *   ⛔ 게시(--publish)하지 않는다 — 판매판 올리기는 로이 「판매판 올려」 때만(release:member --installer 가 판매판 저장소 Release 에 올린다).
 *   v1.0.38: 담는 파일 = 판매판 폴더(D:\Priming-Member)와 같은 목록(같은 gen-manifest --edition member) — 로이판 HEAD 에서 만든다.
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ED = require('../core/edition');
const PREVIEW = process.argv.includes('--preview');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const cfg = JSON.parse(JSON.stringify(pkg.build));
// 📦 담을 파일 = **판매판 매니페스트의 파일 목록 그대로**(허용 목록) + node_modules — v1.0.27 첫 빌드는 「전부 + 제외」 방식이라
//   저장소 폴더의 작업 파일(lora-dataset-clean 2.2GB · video · 샘플.vrew …)이 섞여 2.7GB → NSIS 가 못 묶었다. 라이트 업데이트가 받는 파일과 설치본이 같아진다.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'priming-dist-member-'));
const manOut = path.join(tmp, 'member-manifest.json');
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-manifest.js'), '--edition', 'member', '--out', manOut], { cwd: ROOT, stdio: 'inherit' });
const memberFiles = Object.keys(JSON.parse(fs.readFileSync(manOut, 'utf8')).files);
cfg.files = [...memberFiles, 'node_modules/**/*'];
delete cfg.asarUnpack;   // asar 꺼짐(설정 그대로) — 판매판에 없는 tts/omnivoice-backend 를 가리키지 않게
// publish 설정은 남긴다(--publish never 라 올리지는 않는다) — 지우면 작업트리(.git 이 파일)에서 저장소를 못 찾아 latest.yml 단계가 「reading 'channel'」 로 실패했다(첫 승격 v1.0.28)
const ed = PREVIEW ? { edition: 'member', dataHome: 'PrimingMember' } : { edition: 'member' };
if (PREVIEW) {
  cfg.appId = 'com.user.priming.memberpreview';
  cfg.productName = 'Priming 판매판';
  cfg.extraMetadata = { ...(cfg.extraMetadata || {}), name: 'priming-member-preview', productName: 'Priming 판매판' };   // 설치 폴더 = %LOCALAPPDATA%\Programs\priming-member-preview
  cfg.artifactName = 'Priming-Member-Preview-Setup-${version}.${ext}';
  cfg.directories = { ...(cfg.directories || {}), output: 'dist/member-preview' };
} else {
  cfg.artifactName = 'Priming-Setup-${version}.${ext}';
  // 🛒 v1.0.38 저장소 분리 — 판매판 설치본은 판매판 저장소(비공개 · getwater-maker/Priming-Member)의 Release 로만 나간다(release:member --installer)
  cfg.publish = [{ provider: 'github', owner: 'getwater-maker', repo: 'Priming-Member', releaseType: 'release' }];
  cfg.directories = { ...(cfg.directories || {}), output: 'dist/member' };
}
const edFile = path.join(tmp, 'edition.json');
fs.writeFileSync(edFile, JSON.stringify(ed) + '\n');
cfg.extraResources = [...(cfg.extraResources || []), { from: edFile, to: 'app/edition.json' }];
const tmpCfg = path.join(tmp, 'builder.json');
fs.writeFileSync(tmpCfg, JSON.stringify(cfg, null, 2));
try {
  execFileSync('npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', '--config', JSON.stringify(tmpCfg)], { cwd: ROOT, stdio: 'inherit', shell: true });
  console.log(`🛒 판매판${PREVIEW ? ' 미리보기' : ''} 설치본 → ${cfg.directories.output}/`);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
