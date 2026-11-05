'use strict';
/**
 * scripts/export-member.js — 🛒 판매판 폴더로 한 방향 복사(v1.0.38 · 로이 2026-11-05 「분리 + 한 방향 복사」 · docs/판나누기-설계.md ②).
 *
 *   로이판(D:\Priming · 이 저장소)에서 **판매판 파일만** 골라 판매판 폴더(기본 D:\Priming-Member · 저장소 getwater-maker/Priming-Member)에 옮긴다.
 *   - 고르는 기준 = `gen-manifest --edition member`(= core/edition 의 FEATURES·MEMBER_DROP) 그대로 — ⛔ 여기서 따로 고르지 않는다(두 벌 금지).
 *   - 판매판 폴더를 그 목록과 **똑같이** 맞춘다: 없는 파일은 복사, 다른 파일은 덮어쓰기, 목록에 없는 파일은 지운다(아래 KEEP 만 남긴다).
 *   - 판매판 폴더 고유 파일: update-manifest.json(판매판 매니페스트 — 회원 업데이트가 읽는다) · CLAUDE.md(docs/판매판-폴더-CLAUDE.md 를 그대로)
 *     · edition.json(member — 그 폴더에서 켜면 판매판) · .gitignore · .gitattributes.
 *   ⛔ 판매판 폴더에서 코드를 고치지 않는다 — 다음 복사 때 덮인다. 고칠 것은 로이판에서 고치고 다시 복사한다.
 *   git(커밋·태그·푸시)은 하지 않는다 — release-member.js 가 한다.
 *
 *   사용: node scripts/export-member.js [--to <폴더>] [--dry]
 *     --to   판매판 폴더(기본 환경변수 PM_MEMBER_DIR 또는 D:\Priming-Member) · 없으면 만든다
 *     --dry  바꿀 것만 보여 주고 아무것도 쓰지 않는다
 *   모듈로 부르면 exportMember({ to, dry, log }) → { to, manifest, added, changed, deleted }
 */
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TO = process.env.PM_MEMBER_DIR || 'D:\\Priming-Member';
const CLAUDE_TEMPLATE = path.join(ROOT, 'docs', '판매판-폴더-CLAUDE.md');
// 판매판 폴더에서 지우지 않는 것(파일 목록과 무관) — 폴더 이름은 통째, 파일은 루트 이름
const KEEP_DIRS = new Set(['.git', 'node_modules', 'dist']);
const OWN_FILES = ['update-manifest.json', 'CLAUDE.md', 'edition.json', '.gitignore', '.gitattributes'];
const MEMBER_GITIGNORE = 'node_modules/\ndist/\n*.tmp-update\n';

// gen-manifest 와 같은 해시(텍스트 = CRLF→LF) — 이미 같은 파일은 다시 쓰지 않는다
const BINARY_EXT = new Set(['.vbin', '.bin', '.mp3', '.wav', '.ttf', '.otf', '.ico', '.png', '.jpg', '.jpeg', '.webp', '.gif']);
function hashOf(abs) {
  let buf = fs.readFileSync(abs);
  if (!BINARY_EXT.has(path.extname(abs).toLowerCase())) buf = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return crypto.createHash('sha1').update(buf).digest('hex');
}
function walk(dir, rel, out) {
  for (const name of fs.readdirSync(dir)) {
    const r = rel ? rel + '/' + name : name;
    const abs = path.join(dir, name);
    let st; try { st = fs.lstatSync(abs); } catch (_) { continue; }
    if (st.isDirectory() || st.isSymbolicLink()) { if (!rel && KEEP_DIRS.has(name)) continue; if (st.isDirectory()) walk(abs, r, out); continue; }
    out.push(r);
  }
  return out;
}
const verNum = (v) => { const p = String(v || '0').split('.').map((x) => parseInt(x, 10) || 0); return p[0] * 1e6 + (p[1] || 0) * 1e3 + (p[2] || 0); };

function exportMember({ to = DEFAULT_TO, dry = false, log = console.log } = {}) {
  to = path.resolve(to);
  if (path.resolve(to) === ROOT || to.startsWith(ROOT + path.sep)) throw new Error('판매판 폴더가 로이판 저장소 안입니다: ' + to);
  if (!fs.existsSync(CLAUDE_TEMPLATE)) throw new Error('판매판 폴더용 CLAUDE.md 원본이 없습니다: ' + CLAUDE_TEMPLATE);
  // ① 판매판 파일 목록 = gen-manifest --edition member(한 곳)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'priming-export-member-'));
  let man;
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-manifest.js'), '--edition', 'member', '--out', path.join(tmp, 'm.json')], { cwd: ROOT, stdio: 'pipe' });
    man = JSON.parse(fs.readFileSync(path.join(tmp, 'm.json'), 'utf8'));
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
  if (!man || man.edition !== 'member' || !man.files) throw new Error('판매판 매니페스트를 만들지 못했습니다');
  // 버전은 앞으로만(판매판 저장소의 지금 매니페스트보다 낮으면 멈춘다 · gen-manifest 와 같은 우회 변수)
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(to, 'update-manifest.json'), 'utf8'));
    if (prev && prev.version && verNum(man.version) < verNum(prev.version) && !process.env.ALLOW_VERSION_DOWNGRADE) throw new Error(`판매판 버전이 거꾸로 갑니다: v${prev.version} → v${man.version}`);
  } catch (e) { if (/거꾸로/.test(e.message)) throw e; }

  const want = new Set(Object.keys(man.files));
  const have = fs.existsSync(to) ? walk(to, '', []) : [];
  const added = [], changed = [], deleted = [];
  for (const rel of have) if (!want.has(rel) && !OWN_FILES.includes(rel)) deleted.push(rel);
  for (const rel of want) {
    const dst = path.join(to, rel.split('/').join(path.sep));
    if (!fs.existsSync(dst)) added.push(rel);
    else if (hashOf(dst) !== man.files[rel]) changed.push(rel);
  }
  log(`🛒 판매판 v${man.version} → ${to}\n   파일 ${want.size}개 · 새로 ${added.length} · 바뀜 ${changed.length} · 지움 ${deleted.length}${dry ? ' (--dry: 쓰지 않음)' : ''}`);
  for (const [k, arr] of [['＋', added], ['～', changed], ['－', deleted]]) for (const r of arr.slice(0, 15)) log(`   ${k} ${r}`);
  if (dry) return { to, manifest: man, added, changed, deleted };

  fs.mkdirSync(to, { recursive: true });
  for (const rel of deleted) {
    const f = path.join(to, rel.split('/').join(path.sep));
    try { fs.unlinkSync(f); } catch (_) {}
    // 빈 폴더 정리(판매판 폴더 안만)
    for (let d = path.dirname(f); d.startsWith(to + path.sep); d = path.dirname(d)) { try { fs.rmdirSync(d); } catch (_) { break; } }
  }
  for (const rel of [...added, ...changed]) {
    const src = path.join(ROOT, rel.split('/').join(path.sep)), dst = path.join(to, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    if (hashOf(dst) !== man.files[rel]) throw new Error('복사한 파일의 해시가 매니페스트와 다릅니다(로이판 파일이 그 사이 바뀌었나?): ' + rel);
  }
  // 판매판 폴더 고유 파일
  fs.writeFileSync(path.join(to, 'update-manifest.json'), JSON.stringify(man, null, 2));
  fs.copyFileSync(CLAUDE_TEMPLATE, path.join(to, 'CLAUDE.md'));
  fs.writeFileSync(path.join(to, 'edition.json'), JSON.stringify({ edition: 'member' }) + '\n');
  fs.writeFileSync(path.join(to, '.gitignore'), MEMBER_GITIGNORE);
  fs.copyFileSync(path.join(ROOT, '.gitattributes'), path.join(to, '.gitattributes'));
  log(`✅ 판매판 폴더를 맞췄습니다(로이판 ${String(man.source || '').slice(0, 8)})`);
  return { to, manifest: man, added, changed, deleted };
}

module.exports = { exportMember, DEFAULT_TO, OWN_FILES, KEEP_DIRS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--to');
  try { exportMember({ to: i >= 0 ? argv[i + 1] : DEFAULT_TO, dry: argv.includes('--dry') }); }
  catch (e) { console.error('❌ ' + e.message); process.exit(1); }
}
