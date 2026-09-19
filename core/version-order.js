'use strict';

// 배포 버전 비교. 1.2.10 > 1.2.9 를 문자열 비교로 틀리지 않게 숫자 단위로 본다.
// prerelease 는 정식 버전보다 낮게 취급한다(0.5.16-beta < 0.5.16).
function parts(version) {
  const raw = String(version || '0').trim().replace(/^v/i, '');
  const [main, pre = ''] = raw.split('-', 2);
  const nums = main.split('.').map((x) => parseInt(x, 10) || 0);
  return { nums, pre };
}

function compareVersions(a, b) {
  const x = parts(a), y = parts(b);
  const n = Math.max(x.nums.length, y.nums.length, 3);
  for (let i = 0; i < n; i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (!!x.pre !== !!y.pre) return x.pre ? -1 : 1;
  if (x.pre === y.pre) return 0;
  return x.pre > y.pre ? 1 : -1;
}

module.exports = { compareVersions };
