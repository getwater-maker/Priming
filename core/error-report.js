'use strict';
/**
 * error-report.js — 🐞 오류가 나면 로그를 자동으로 보낸다(v0.9.26 · 로이 2026-10-15 「오류나면 자동으로」 · docs/회원제-설계.md §6).
 *   · 오류 줄(✗ · ❌ · 🐞 · 잡히지 않은 예외 모양)을 보면 60초 모았다가 **한 번** 보낸다 — 그날 같은 오류(숫자만 다른 것 포함)는 다시 안 보낸다
 *   · 본문 = 그날 로그 끝 200줄(64KB 이하) · 요약 = 첫 오류 줄 — 둘 다 **core/log-scrub 로 지운 뒤**
 *   · 보내기는 부르는 쪽(send)이 한다(회원 RPC priming_log) · 꺼져 있으면(isOn=false) 아무것도 안 한다
 *   · ⛔ 보내기 실패를 오류 줄(✗ 등)로 로그에 남기지 않는다(자기 자신을 다시 부르는 고리)
 * 테스트: test/error-report.test.js
 */
const { scrub } = require('./log-scrub');

const ERR_RE = /(^|[\s\]])(✗|❌|🐞)|Uncaught|TypeError|ReferenceError|is not defined|Cannot read propert/;
const MAX_BODY = 64 * 1024;

// 같은 오류 판정 — 숫자·경로 꼬리를 지운 앞부분
const sigOf = (line) => scrub(String(line)).replace(/\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim().slice(0, 160);

function createReporter({ send, readTail, isOn = () => true, delayMs = 60000, day = () => new Date().toISOString().slice(0, 10), setTimer = setTimeout } = {}) {
  const sent = new Set();   // `${day}|${sig}`
  let pending = [];
  let timer = null;
  let busy = false;

  function onLine(line) {
    const t = String(line || '');
    if (!ERR_RE.test(t)) return false;
    if (!isOn()) return false;
    const key = day() + '|' + sigOf(t);
    if (sent.has(key) || pending.some((p) => p.key === key)) return false;
    pending.push({ key, line: t });
    if (!timer) timer = setTimer(() => { timer = null; flush(); }, delayMs);
    return true;
  }

  async function flush() {
    if (busy || !pending.length) return null;
    if (!isOn()) { pending = []; return null; }
    busy = true;
    const batch = pending; pending = [];
    for (const p of batch) sent.add(p.key);
    try {
      let tail = '';
      try { tail = String((await readTail(200)) || ''); } catch (_) {}
      let body = scrub(tail);
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY) body = body.slice(-Math.floor(MAX_BODY / 3));   // 끝(최근)을 남긴다 · 한글 3바이트 기준 안전
      const summary = scrub(batch[0].line).slice(0, 300) + (batch.length > 1 ? ` (외 ${batch.length - 1}건)` : '');
      return await send({ kind: 'auto', summary, body });
    } catch (_) { return null; }
    finally { busy = false; }
  }

  return { onLine, flush, _pending: () => pending.length, _sent: () => sent.size };
}

module.exports = { createReporter, ERR_RE, sigOf, MAX_BODY };
