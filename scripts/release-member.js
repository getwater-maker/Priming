'use strict';
/**
 * scripts/release-member.js — 🛒 판매판 올리기(승격) — v1.0.26 뼈대 · docs/판나누기-설계.md ②.
 *   ⛔ 로이가 「판매판 올려」라고 한 때만 Claude 가 `npm run release:member -- --confirm` 으로 실행한다. --confirm 없으면 계획만 보여 준다.
 * 순서: ① 작업 트리 깨끗 · main ② 시험(test:edition) ③ 로이판 발행물이 HEAD 에 있는가(vite build + 매니페스트 → 바뀐 것 없음)
 *       ④ 판매판 매니페스트(ref = HEAD) ⑤ 금지 검사(test:edition 이 판매판 매니페스트를 검사) ⑥ 커밋(매니페스트만) ⑦ 태그 member-v<ver>(ref 에) ⑧ 푸시
 *   ref = 이미 푸시된 로이판 커밋 — Worker 는 판매판 파일을 그 커밋에서 꺼낸다(매니페스트 커밋은 그 다음 커밋).
 */
const path = require('path'), fs = require('fs');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: o.inherit ? 'inherit' : 'pipe', shell: process.platform === 'win32' && cmd === 'npm' });
const CONFIRM = process.argv.includes('--confirm');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const steps = ['작업 트리 확인', 'npm run test:edition', 'npm run update:publish → 바뀐 것 없어야 함', 'gen-manifest --edition member --ref HEAD', 'test:edition(판매판 매니페스트 금지 검사)', `git commit update-manifest.member.json`, `git tag member-v${ver} <ref>`, 'git push origin main + 태그'];
if (!CONFIRM) { console.log(`🛒 판매판 올리기 계획(v${ver}) — 실행하려면 --confirm (로이 「판매판 올려」 때만)\n` + steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')); process.exit(0); }
const dirty = () => sh('git', ['status', '--porcelain', '--untracked-files=no']).trim();
if (sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim() !== 'main') throw new Error('main 브랜치에서만');
if (dirty()) throw new Error('커밋 안 된 변경이 있습니다 — 먼저 로이판으로 발행하세요');
sh('npm', ['run', 'test:edition'], { inherit: true });
sh('npm', ['run', 'update:publish'], { inherit: true });
if (dirty()) throw new Error('빌드·매니페스트가 HEAD 와 다릅니다 — 로이판 발행(커밋·푸시)부터');
const ref = sh('git', ['rev-parse', 'HEAD']).trim();
sh('node', ['scripts/gen-manifest.js', '--edition', 'member', '--ref', ref], { inherit: true });
sh('node', ['test/edition.test.js', '--member-manifest', 'update-manifest.member.json'], { inherit: true });
sh('git', ['add', 'update-manifest.member.json']);
sh('git', ['commit', '-m', `release: 판매판 v${ver} (ref ${ref.slice(0, 8)})`]);
sh('git', ['tag', `member-v${ver}`, ref]);
sh('git', ['push', 'origin', 'main', `member-v${ver}`], { inherit: true });
console.log(`✅ 판매판 v${ver} 올림 — ref ${ref}`);
