'use strict';
/**
 * scripts/dist-member.js — 🛒 판매판 설치본(Priming-Setup-<ver>.exe) 만들기(v1.0.26 · 뼈대 · docs/판나누기-설계.md ②).
 *   ① 설치폴더에 들어갈 edition.json = member 를 잠깐 쓴다(끝나면 지운다 — 저장소엔 넣지 않는다 · .gitignore)
 *   ② package.json 의 build 설정을 복사해 판매판 제외 목록(core/edition)·설치본 이름을 더한 임시 설정으로 electron-builder 를 부른다.
 *   ⛔ 게시(--publish)하지 않는다 — 판매판 올리기는 로이 「판매판 올려」 때만(release:member).
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ED = require('../core/edition');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const cfg = JSON.parse(JSON.stringify(pkg.build));
cfg.artifactName = 'Priming-Setup-${version}.${ext}';
cfg.directories = { ...(cfg.directories || {}), output: 'dist/member' };
const drop = [];
for (const f of Object.values(ED.FEATURES)) if (!f.editions.includes('member')) for (const p of f.files || []) drop.push('!' + (p.endsWith('/') ? p + '**' : p));
cfg.files = [...cfg.files, ...drop, '!docs/**', 'docs/대본-작성-가이드.md', '!CLAUDE.md', '!AGENTS.md', '!tools/**', '!test/**', '!scripts/**', '!update-manifest.json'];
delete cfg.publish;
const tmpCfg = path.join(os.tmpdir(), 'priming-member-builder.json');
fs.writeFileSync(tmpCfg, JSON.stringify(cfg, null, 2));
const EF = path.join(ROOT, 'edition.json');
fs.writeFileSync(EF, JSON.stringify({ edition: 'member' }) + '\n');
try {
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', '--config', tmpCfg], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  console.log('🛒 판매판 설치본 → dist/member/');
} finally {
  try { fs.unlinkSync(EF); } catch (_) {}
  try { fs.unlinkSync(tmpCfg); } catch (_) {}
}
