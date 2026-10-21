'use strict';
/**
 * node test/atomic-md.test.js — 대본(.md) 덮어쓰기 = 임시 파일 → rename (v0.9.94 · Lab 요청서 2026-10-21)
 *   [1] 진짜 파일: 덮어쓰기 · 임시 파일이 남지 않는다
 *   [2] 쓰다 죽음(임시 파일 쓰기 실패) · rename 실패 → 원래 .md 그대로 · 임시 파일 정리 · throw
 *   [3] 윈도우 EPERM(백신이 잠깐 잡음) → 다시 해서 성공
 *   [4] main.js 소스: 대본 경로에 writeFileSync 로 직접 쓰는 곳 0 · 모두 writeScriptAtomic
 */
const fs = require('fs'), path = require('path'), os = require('os');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const AW = require('../core/atomic-write');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-md-'));
try {
  console.log('[1] 진짜 파일');
  {
    const f = path.join(tmp, '[역사_1021] 대본.md');
    fs.writeFileSync(f, '옛 대본', 'utf8');
    AW.writeTextAtomicSync(f, '# 새 대본\n\n문장 하나.\n');
    ok(fs.readFileSync(f, 'utf8') === '# 새 대본\n\n문장 하나.\n', '내용이 바뀐다(한글 이름 · 덮어쓰기)');
    ok(!fs.existsSync(f + AW.TMP_SUFFIX) && fs.readdirSync(tmp).length === 1, '임시 파일이 남지 않는다');
    const big = '가'.repeat(3_000_000);
    AW.writeTextAtomicSync(f, big);
    ok(fs.readFileSync(f, 'utf8').length === big.length, '큰 대본(3백만 자)도 통째로');
  }

  console.log('\n[2] 실패해도 원래 대본은 그대로');
  {
    const f = path.join(tmp, 'b.md');
    fs.writeFileSync(f, '원래 대본', 'utf8');
    // 쓰는 도중 죽음 — 임시 파일에 반쯤 쓰고 throw
    const half = { ...fs, writeFileSync: (p, t) => { fs.writeFileSync(p, String(t).slice(0, 2), 'utf8'); throw Object.assign(new Error('디스크 끊김'), { code: 'EIO' }); } };
    let e1 = null; try { AW.writeTextAtomicSync(f, '새 대본 전체', { fs: half }); } catch (e) { e1 = e; }
    ok(e1 && e1.code === 'EIO', '쓰기 실패는 throw(호출하는 곳이 「저장하지 못했습니다」를 띄운다)');
    ok(fs.readFileSync(f, 'utf8') === '원래 대본', '🔑 쓰다 죽어도 원래 .md 는 한 글자도 안 바뀐다');
    ok(!fs.existsSync(f + AW.TMP_SUFFIX), '반쯤 쓴 임시 파일은 치운다');
    // rename 실패(EPERM 아님) — 다시 하지 않고 임시 파일을 치운다
    let renames = 0;
    const noRen = { ...fs, renameSync: () => { renames++; throw Object.assign(new Error('없는 폴더'), { code: 'ENOENT' }); } };
    let e2 = null; try { AW.writeTextAtomicSync(f, '새 대본', { fs: noRen }); } catch (e) { e2 = e; }
    ok(e2 && e2.code === 'ENOENT' && renames === 1, `rename 실패 → throw · ENOENT 는 다시 하지 않는다(${renames}번)`);
    ok(fs.readFileSync(f, 'utf8') === '원래 대본' && !fs.existsSync(f + AW.TMP_SUFFIX), 'rename 실패 → 원래 대본 그대로 · 임시 파일 정리');
  }

  console.log('\n[3] EPERM 잠깐 → 다시 해서 성공');
  {
    const f = path.join(tmp, 'c.md');
    fs.writeFileSync(f, '원래', 'utf8');
    let n = 0;
    const flaky = { ...fs, renameSync: (a, b) => { if (++n < 3) throw Object.assign(new Error('잠김'), { code: 'EPERM' }); return fs.renameSync(a, b); } };
    AW.writeTextAtomicSync(f, '새것', { fs: flaky });
    ok(n === 3 && fs.readFileSync(f, 'utf8') === '새것', `EPERM 두 번 뒤 세 번째에 성공(${n}번)`);
    let m = 0;
    const locked = { ...fs, renameSync: () => { m++; throw Object.assign(new Error('잠김'), { code: 'EBUSY' }); } };
    let e3 = null; try { AW.writeTextAtomicSync(f, '또 새것', { fs: locked }); } catch (e) { e3 = e; }
    ok(e3 && m === 5 && fs.readFileSync(f, 'utf8') === '새것' && !fs.existsSync(f + AW.TMP_SUFFIX), `계속 잠겨 있으면 5번 뒤 throw · 원래 그대로(${m}번)`);
  }

  console.log('\n[4] main.js 소스 — 대본 쓰기는 한 곳');
  {
    const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const direct = M.match(/writeFileSync\(\s*(S\.scriptPath|sp|X\.scriptPath|scriptPath|runCtx\.scriptPath)\s*,/g) || [];
    ok(direct.length === 0, `대본 경로에 writeFileSync 로 직접 쓰는 곳 0 (${direct.length}곳${direct.length ? ' — ' + direct.join(' · ') : ''})`);
    const n = (M.match(/writeScriptAtomic\(/g) || []).length;
    ok(n === 14, `writeScriptAtomic 쓰는 곳 14 (지금 ${n}) — 늘거나 줄면 이 숫자도 같이 고친다`);
    ok(/require\('\.\/core\/atomic-write'\)/.test(M), 'main 이 core/atomic-write 를 쓴다');
  }
} finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }

console.log(`\n${fail ? '❌' : '✅'} atomic-md ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
