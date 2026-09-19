'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compareVersions } = require('../core/version-order');

let n = 0;
const ok = (v, label) => { assert.ok(v, label); n++; console.log('  ✓', label); };
ok(compareVersions('0.5.16', '0.5.15') > 0, '패치 버전 상승');
ok(compareVersions('0.10.0', '0.9.99') > 0, '문자열이 아니라 숫자로 비교');
ok(compareVersions('1.0', '1.0.0') === 0, '생략된 자리는 0');
ok(compareVersions('0.5.16-beta', '0.5.16') < 0, '프리릴리스는 정식보다 낮음');

const src = fs.readFileSync(path.join(__dirname, '..', 'light-updater.js'), 'utf8');
ok(/compareVersions\(manifest\.version, localPkg\.version\) < 0/.test(src), '원격 버전이 낮으면 적용 전에 중단');
const iGuard = src.indexOf('compareVersions(manifest.version, localPkg.version) < 0');
const iLoop = src.indexOf('for (const rel of Object.keys(manifest.files))');
ok(iGuard > 0 && iLoop > iGuard, '다운로드·덮어쓰기 루프보다 하향 차단이 먼저');
ok(/원격 매니페스트가 더 낮아 건너뜀/.test(src), '로그에 하향 차단 이유 표시');

console.log(`\n✅ light-updater-version: ${n}/${n}\n`);
