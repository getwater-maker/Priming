'use strict';
/**
 * scripts/verify-published.js — 발행(push) 뒤 **서버(raw.githubusercontent.com)가 새 내용을 일관되게 주는지** 확인한다.
 *   raw 서버는 이미 있던 파일을 발행 뒤 약 5분 옛 내용으로 보여 줄 수 있다(2026-10-06 사고 — 그 사이 앱을 켠 PC 가 일부만 받아 백지).
 *   이 확인이 OK 가 되기 전에는 「앱 재시작하면 반영」이라고 안내하지 않는다.
 * 사용: node scripts/verify-published.js [--max 480] [--all]
 *   기본 = 마지막 커밋에서 바뀐 매니페스트 파일만 확인(--all 이면 전부) · 20초마다 다시 · 최대 --max 초.
 *   종료 코드 0 = 일치(안전) · 1 = 시간 안에 일치하지 않음.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--') ? true : process.argv[i + 1]); };
const MAX = Number(arg('--max', 480)) || 480;
const ALL = process.argv.includes('--all');
const BASE = 'https://raw.githubusercontent.com/getwater-maker/Priming/main/';
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const norm = (b) => { const o = []; for (let i = 0; i < b.length; i++) { if (b[i] === 13 && b[i + 1] === 10) continue; o.push(b[i]); } return Buffer.from(o); };
const BIN = new Set(['.vbin', '.bin', '.mp3', '.wav', '.ttf', '.otf', '.ico', '.png', '.jpg', '.jpeg']);

async function get(rel) { const r = await fetch(BASE + rel + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); }

(async () => {
  const local = JSON.parse(fs.readFileSync(path.join(ROOT, 'update-manifest.json'), 'utf8'));
  let rels = Object.keys(local.files);
  if (!ALL) {
    try {
      const ch = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
      const set = new Set(ch);
      const sub = rels.filter((r) => set.has(r)); rels = sub.length ? sub : rels;
    } catch (_) {}
  }
  // 🔴 매니페스트에 있는데 커밋(HEAD)에 없는 파일 = 서버에 영영 없다(404) → 모든 PC 업데이트가 막힌다(2026-10-06 · 설치 파일 .exe 사고).
  //   바뀐 파일만 보는 기본 모드에서도 이것은 **전부** 본다(그 .exe 는 마지막 커밋의 변경이 아니라서 놓쳤다).
  try {
    const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean));
    const orphan = Object.keys(local.files).filter((r) => !tracked.has(r));
    if (orphan.length) {
      console.log(`❌ 매니페스트에 있지만 저장소에 커밋되지 않은 파일 ${orphan.length}개 — 서버에 없어 모든 PC 업데이트가 막힙니다: ${orphan.slice(0, 5).join(', ')}${orphan.length > 5 ? ' …' : ''}\n   커밋하거나 gen-manifest 제외 목록에 넣고 다시 발행하세요.`);
      process.exit(1);
    }
  } catch (e) { console.log('⚠ git ls-files 실패 — 저장소에 없는 파일 확인을 건너뜁니다: ' + (e && e.message)); }
  const t0 = Date.now();
  for (;;) {
    const bad = [];
    try {
      const m = JSON.parse((await get('update-manifest.json')).toString('utf8'));
      if (m.version !== local.version) bad.push(`update-manifest.json(서버 v${m.version} ≠ v${local.version})`);
    } catch (e) { bad.push('update-manifest.json(' + e.message + ')'); }
    for (const rel of rels) {
      try {
        const b = await get(rel);
        const ext = path.extname(rel).toLowerCase();
        if (sha1(BIN.has(ext) ? b : norm(b)) !== local.files[rel]) bad.push(rel);
      } catch (e) { bad.push(rel + '(' + e.message + ')'); }
    }
    const sec = Math.round((Date.now() - t0) / 1000);
    if (!bad.length) { console.log(`✅ 서버가 v${local.version} 을 일관되게 줍니다(확인한 파일 ${rels.length}개 · ${sec}초) — 이제 앱을 다시 켜도 안전합니다`); process.exit(0); }
    if (sec >= MAX) { console.log(`❌ ${MAX}초 안에 일치하지 않았습니다 — 아직 옛 내용인 파일 ${bad.length}개: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ' …' : ''}\n   이 PC 들은 아직 앱을 다시 켜지 않는 게 좋습니다.`); process.exit(1); }
    console.log(`⏳ 서버 캐시가 아직 옛 내용 — ${bad.length}개 대기(${sec}초): ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ' …' : ''}`);
    await new Promise((r) => setTimeout(r, 20000));
  }
})();
