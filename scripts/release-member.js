'use strict';
/**
 * scripts/release-member.js — 🛒 판매판 올리기(승격) — v1.0.38 저장소 분리(로이 2026-11-05 「분리 + 한 방향 복사」 · docs/판나누기-설계.md ②).
 *   ⛔ 로이가 「판매판 올려」라고 한 때만 Claude 가 `npm run release:member -- --confirm [--installer]` 로 실행한다. --confirm 없으면 계획만 보여 준다.
 *
 * 순서(로이판 D:\Priming 에서 실행):
 *   ① 로이판 main · HEAD 푸시됨 ② test:edition(로이판 쪽 판정 · E2E 없이)
 *   ③ 판매판에 들어갈 파일(+ vite build 결과)이 커밋 그대로인가 — 판매판은 이미 푸시된 로이판 커밋에서만 나간다(판매판 밖 문서의 미커밋 변경은 무시)
 *   ④ export-member → 판매판 폴더(D:\Priming-Member)를 판매판 파일과 똑같이 맞춘다(+ 판매판 update-manifest.json)
 *   ⑤ test:edition --dir <판매판 폴더>(금지 파일·문자열 0 · 매니페스트와 폴더 일치 · 그 폴더 파일만으로 켜기·롱폼 무음 만들기)
 *   ⑥ 판매판 저장소 커밋 · 태그 member-v<ver> · 푸시(origin = getwater-maker/Priming-Member · 비공개)
 *   ⑦ (--installer) 판매판 설치본 Priming-Setup-<ver>.exe → 판매판 저장소 Release member-v<ver>
 *      — 의존성(package.json dependencies)이 바뀐 승격·처음 판매판 설치·판 경로가 바뀐 판(v1.0.38)은 설치본이 필요하다.
 */
const path = require('path'), fs = require('fs');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const { exportMember, DEFAULT_TO } = require('./export-member');
const MEMBER_REPO = 'getwater-maker/Priming-Member';
const argv = process.argv.slice(2);
const CONFIRM = argv.includes('--confirm');
const INSTALLER = argv.includes('--installer');
const TO = path.resolve(argv.includes('--to') ? argv[argv.indexOf('--to') + 1] : DEFAULT_TO);
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { cwd: o.cwd || ROOT, encoding: 'utf8', stdio: o.inherit ? 'inherit' : 'pipe', shell: process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx') });
const gm = (...a) => sh('git', ['-C', TO, ...a]);
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const steps = [
  '로이판 main · HEAD 푸시됨', 'npm run test:edition -- --no-e2e', 'vite build → 판매판 파일·renderer/dist 가 커밋 그대로',
  `export-member → ${TO}`, `test:edition --dir ${TO}`, `판매판 저장소 커밋 · 태그 member-v${ver} · 푸시(${MEMBER_REPO})`,
  INSTALLER ? `판매판 설치본 → ${MEMBER_REPO} Release member-v${ver}` : '(설치본은 --installer 때만)',
];
if (!CONFIRM) { console.log(`🛒 판매판 올리기 계획(v${ver}) — 실행하려면 --confirm (로이 「판매판 올려」 때만)\n` + steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')); process.exit(0); }

// ① ~ ③ 로이판 — 지키는 것: **판매판에 들어갈 파일이 푸시된 로이판 커밋 그대로인가**
//   (v1.0.38: 같은 폴더의 다른 세션이 고치다 만 문서(판매판에 안 들어감) 때문에 막히지 않게 — 판매판 파일만 본다)
const dirtyList = (...p) => sh('git', ['-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=no', ...p]).split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
if (sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim() !== 'main') throw new Error('main 브랜치에서만');
sh('git', ['fetch', '-q', 'origin', 'main']);
if (sh('git', ['rev-parse', 'HEAD']).trim() !== sh('git', ['rev-parse', 'origin/main']).trim()) throw new Error('로이판 HEAD 가 푸시되지 않았습니다 — 로이판 발행(커밋·푸시)부터');
sh('npm', ['run', 'test:edition', '--', '--no-e2e'], { inherit: true });
sh('npm', ['run', 'build:renderer'], { inherit: true });
const memberFiles = new Set(Object.keys(exportMember({ to: TO, dry: true, log: () => {} }).manifest.files));
const untracked = sh('git', ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
const bad = [...dirtyList(), ...untracked].filter((f) => memberFiles.has(f) || f.startsWith('renderer/dist/'));
if (bad.length) throw new Error('판매판 파일이 커밋된 것과 다릅니다(빌드 포함) — 로이판 발행부터: ' + bad.slice(0, 5).join(', '));
const others = dirtyList();
if (others.length) console.log('ⓘ 판매판에 안 들어가는 커밋 안 된 변경(다른 세션 것일 수 있음 · 무시): ' + others.slice(0, 5).join(', '));
// 판매판 저장소가 준비돼 있는가(처음 한 번: 로이 확인 뒤 `gh repo create getwater-maker/Priming-Member --private` + 이 폴더를 git init · origin 연결)
if (!fs.existsSync(path.join(TO, '.git'))) throw new Error(`판매판 폴더가 git 저장소가 아닙니다: ${TO} — 처음 한 번 저장소를 만들고 연결하세요(docs/판나누기-설계.md ②)`);
const origin = (() => { try { return gm('remote', 'get-url', 'origin').trim(); } catch (_) { return ''; } })();
if (!/getwater-maker\/Priming-Member(\.git)?$/i.test(origin)) throw new Error('판매판 폴더의 origin 이 ' + MEMBER_REPO + ' 가 아닙니다: ' + (origin || '(없음)'));
if (gm('status', '--porcelain').trim()) console.log('⚠ 판매판 폴더에 커밋 안 된 변경이 있었습니다 — 복사가 덮어씁니다(⛔ 판매판 폴더에서 코드를 고치지 않는다)');

// ④ 복사 → ⑤ 판매판 폴더 시험
const res = exportMember({ to: TO });
sh('node', ['test/edition.test.js', '--dir', TO], { inherit: true });

// ⑥ 판매판 저장소
gm('add', '-A');
const src = String(res.manifest.source || '').slice(0, 8);
if (gm('status', '--porcelain').trim()) gm('commit', '-m', `release: 판매판 v${ver} (로이판 ${src})`);
else console.log('판매판 파일이 바뀐 것이 없습니다 — 커밋 없이 태그만');
const tag = `member-v${ver}`;
try { gm('rev-parse', '-q', '--verify', 'refs/tags/' + tag); throw new Error(`태그 ${tag} 가 이미 있습니다 — 버전을 올려 로이판을 발행한 뒤 다시`); }
catch (e) { if (/이미 있습니다/.test(e.message)) throw e; }
gm('tag', tag);
sh('git', ['-C', TO, 'push', 'origin', 'HEAD:main', tag], { inherit: true });
console.log(`✅ 판매판 v${ver} 올림 — ${MEMBER_REPO} ${tag} (로이판 ${src})`);

// ⑦ 설치본
if (INSTALLER) {
  sh('npm', ['run', 'dist:member'], { inherit: true });
  const exe = path.join(ROOT, 'dist', 'member', `Priming-Setup-${ver}.exe`);
  if (!fs.existsSync(exe)) throw new Error('설치본이 없습니다: ' + exe);
  sh('gh', ['release', 'create', tag, exe, '--repo', MEMBER_REPO, '--title', `Priming v${ver}`, '--notes', `판매판 v${ver} (로이판 ${src})`], { inherit: true });
  console.log(`✅ 판매판 설치본 → ${MEMBER_REPO} Release ${tag}`);
}
