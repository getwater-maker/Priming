'use strict';
// 대본(.md) 덮어쓰기 = 같은 폴더 임시 파일에 다 쓴 뒤 rename 한 번(v0.9.94 · Lab 요청서 2026-10-21).
// 제자리 writeFileSync 는 쓰는 도중 앱이 죽거나 G: 가 순간 언마운트되면 .md 가 비거나 반쪽만 남는다 — 대본은 정본이라 되돌릴 곳이 없다.
// main.js 에서 대본을 쓰는 곳은 전부 이 함수를 거친다(`test:atomicmd` 가 직접 쓰기 0곳을 센다).
const fs = require('fs');

const TMP_SUFFIX = '.priming-tmp';
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);

function _sleep(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {} }

// 동기(호출하는 곳이 모두 동기 try 안이다). 실패하면 throw — 원래 파일은 그대로 남는다.
function writeTextAtomicSync(file, text, opts = {}) {
  const fsx = opts.fs || fs;
  const tmp = file + TMP_SUFFIX;
  try { fsx.writeFileSync(tmp, text, 'utf8'); }
  catch (e) { try { fsx.unlinkSync(tmp); } catch (_) {} throw e; }   // 반쯤 쓴 임시 파일을 남기지 않는다(원래 .md 는 손대지 않았다)
  let err = null;
  // 🔴 윈도우는 백신·탐색기 미리보기가 대상 파일을 잠깐 잡으면 rename 이 EPERM — 짧게 몇 번 다시 해 본다
  for (let i = 0; i < 5; i++) {
    try { fsx.renameSync(tmp, file); return; }
    catch (e) { err = e; if (!BUSY.has(e && e.code)) break; _sleep(40 * (i + 1)); }
  }
  try { fsx.unlinkSync(tmp); } catch (_) {}
  throw err;
}

module.exports = { writeTextAtomicSync, TMP_SUFFIX };
