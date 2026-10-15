'use strict';
// node test/thumb-find.test.js — 🖼 대본 썸네일 찾기(core/thumb-find · v0.9.24)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { thumbKey, findThumbs } = require('../core/thumb-find');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  console.log('[1] 열쇠');
  ok(thumbKey('G:\\x\\[고전_1019] 노생거 사원 1부.md') === '[고전_1019]', '대본 경로 → [약칭_MMDD]');
  ok(thumbKey('/a/[일본_1016] 산시로.md') === '[일본_1016]', '다른 채널');
  ok(thumbKey('노생거 1부.md') === '' && thumbKey('') === '' && thumbKey(null) === '', '열쇠 없음 → 빈 값');
  ok(thumbKey('a [고전_1019] b.md') === '', '이름 맨 앞이 아니면 열쇠가 아니다');

  console.log('[2] 찾기');
  const R = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbfind-'));
  const mk = (rel) => { const p = path.join(R, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); };
  mk('01_고전이야기/[고전_1019] 썸네일_C.png');
  mk('01_고전이야기/[고전_1019] 썸네일_A.png');
  mk('01_고전이야기/[고전_1019] 썸네일_B.jpg');
  mk('01_고전이야기/[고전_1020] 썸네일_A.png');        // 다른 편
  mk('01_고전이야기/[고전_1019] 메모.txt');            // 그림 아님
  mk('_규격전_원본_20261009/[고전_1019] 썸네일_A.png');  // 보관함(_) — 건너뜀
  mk('[고전_1019] 바로아래.webp');                      // 폴더 바로 아래도 본다
  mk('02_서재/깊은/[고전_1019] 두단계.png');             // 두 단계 아래는 안 본다
  const got = await findThumbs(R, '[고전_1019]', 4);
  const names = got.map((f) => f.name);
  ok(names.length === 4, '최대 4장: ' + names.join(' | '));
  ok(names.slice(0, 3).join('|') === '[고전_1019] 바로아래.webp|[고전_1019] 썸네일_A.png|[고전_1019] 썸네일_B.jpg', '이름순(A·B·C 순서가 지켜진다)');
  const all = await findThumbs(R, '[고전_1019]', 10);
  ok(all.length === 4 && all.some((f) => /썸네일_C/.test(f.name)), 'C 까지 4장 — 다른 편·txt·보관함·두 단계 아래는 빠진다');
  ok(!all.some((f) => /_규격전/.test(f.path) || /두단계/.test(f.name) || /1020/.test(f.name)), '판정력: 걸러야 할 것이 하나도 없다');
  ok(all.every((f) => f.mtimeMs > 0 && fs.existsSync(f.path)), '경로·수정 시각이 실려 있다');
  ok((await findThumbs(R, '[고전_9999]')).length === 0, '없는 편 → 빈 목록');
  ok((await findThumbs(path.join(R, '없는폴더'), '[고전_1019]')).length === 0, '없는 폴더 → 빈 목록(던지지 않음)');
  ok((await findThumbs(R, '')).length === 0, '빈 열쇠 → 빈 목록(전부 잡지 않음)');
  fs.rmSync(R, { recursive: true, force: true });

  console.log(`\n${fail ? '❌' : '✅'} thumb-find — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
