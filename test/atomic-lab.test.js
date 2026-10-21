'use strict';
/**
 * node test/atomic-lab.test.js — Lab: .vrew · 클립 이력 · 빌드 지문도 임시 파일 → rename(core/atomic-write 한 곳 · 2026-10-22)
 *   [1] Buffer(zip) 를 바이트 그대로 쓴다 · 실패하면 옛 파일 그대로
 *   [2] build-fingerprint.writeRecord → readRecord 왕복 · 임시 파일 안 남음
 *   [3] 소스: vrew-builder 는 writeZip 대신 toBuffer + atomic-write · clip-history·build-fingerprint 는 writeFileSync 로 직접 쓰지 않는다
 */
const fs = require('fs'), path = require('path'), os = require('os');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const AW = require('../core/atomic-write');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-lab-'));
(async () => {
try {
  console.log('[1] Buffer(.vrew zip)');
  {
    const AdmZip = require('adm-zip');
    const z = new AdmZip();
    z.addFile('project.json', Buffer.from(JSON.stringify({ version: 16, 글: '한글' })));
    z.addFile('media/a.bin', Buffer.from([0, 255, 128, 10, 13, 0xef, 0xbb, 0xbf]));
    const buf = z.toBuffer();
    const f = path.join(tmp, '[역사_1022] 대본.vrew');
    fs.writeFileSync(f, 'OLD');
    AW.writeTextAtomicSync(f, buf);
    ok(Buffer.compare(fs.readFileSync(f), buf) === 0, '바이트 그대로(utf8 로 망가지지 않는다)');
    const back = new AdmZip(f);
    ok(JSON.parse(back.readAsText('project.json')).글 === '한글' && Buffer.compare(back.getEntry('media/a.bin').getData(), Buffer.from([0, 255, 128, 10, 13, 0xef, 0xbb, 0xbf])) === 0, '다시 열면 project.json·미디어가 그대로');
    ok(!fs.existsSync(f + AW.TMP_SUFFIX), '임시 파일이 남지 않는다');
    const half = { ...fs, writeFileSync: (p, d) => { fs.writeFileSync(p, d.subarray(0, 10)); throw Object.assign(new Error('끊김'), { code: 'EIO' }); } };
    let e = null; try { AW.writeTextAtomicSync(f, Buffer.alloc(5000, 7), { fs: half }); } catch (x) { e = x; }
    ok(e && Buffer.compare(fs.readFileSync(f), buf) === 0 && !fs.existsSync(f + AW.TMP_SUFFIX), '🔑 쓰다 죽으면 옛 .vrew 그대로 · 임시 파일 정리');
  }

  console.log('\n[2] 빌드 지문 기록');
  {
    const BF = require('../core/build-fingerprint');
    const vp = path.join(tmp, '대본.vrew'); fs.writeFileSync(vp, 'v');
    ok(await BF.recordBuilt({ outRoot: tmp, baseName: '대본', fp: 'abc', vrewPath: vp }) === true, 'recordBuilt 성공');
    const r = BF.readRecord(tmp, '대본');
    ok(r && r.fp === 'abc' && r.vrew && r.vrew.size === 1, 'readRecord 왕복(지문·.vrew 크기)');
    const dir = path.dirname(BF.recordPath(tmp, '대본'));
    ok(!fs.readdirSync(dir).some((n) => n.endsWith(AW.TMP_SUFFIX)), '임시 파일이 남지 않는다');
  }

  console.log('\n[3] 소스 — 직접 덮어쓰기 0');
  {
    const VB = R('vrew/vrew-builder.js');
    ok(!/\.writeZip\(/.test(VB), 'vrew-builder: writeZip 직접 쓰기 없음');
    ok(/require\('\.\.\/core\/atomic-write'\)\.writeTextAtomicSync\(vrewPath, zip\.toBuffer\(\)\)/.test(VB), 'vrew-builder: toBuffer + atomic-write');
    for (const f of ['core/clip-history.js', 'core/build-fingerprint.js']) {
      const s = R(f);
      ok(!/fs\.writeFileSync\(/.test(s) && /require\('\.\/atomic-write'\)\.writeTextAtomicSync\(/.test(s), `${f}: writeFileSync 직접 쓰기 없음 · atomic-write 사용`);
    }
  }
} finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }

console.log(`\n${fail ? '❌' : '✅'} atomic-lab ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
})();
