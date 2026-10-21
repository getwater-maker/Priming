// 🩹 비정상 종료 감지 (Lab · Vrew 차이표 #5) — 시작할 때 잠금 파일을 쓰고, 정상 종료(before-quit) 때 지운다.
//   다음 시작에 잠금 파일이 남아 있고 그 프로세스가 살아 있지 않으면 = 지난번에 비정상으로 닫혔다.
//   ⛔ 시작 화면은 여전히 빈 화면이다(로이 2026-06-22) — 이 판정은 「♻ 지난 큐 · 🕘 백업」을 **권하는** 안내에만 쓴다.
const fs = require('fs');
const path = require('path');

function _alive(pid) {
  if (!(pid > 0)) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

// → { crashed, prev } · 새 잠금을 쓴다. 같은 PC 에서 앱이 이미 켜져 있으면(살아 있는 pid) crashed 아님.
function begin(file, info = {}) {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const crashed = !!(prev && prev.pid && prev.pid !== process.pid && !_alive(prev.pid));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, startedAt: Date.now(), ...info }), 'utf8');
    fs.renameSync(tmp, file);
  } catch {}
  return { crashed, prev: crashed ? prev : null };
}
function end(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && j.pid === process.pid) fs.unlinkSync(file); } catch {}
}
module.exports = { begin, end, _alive };
