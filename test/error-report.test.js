'use strict';
// node test/error-report.test.js — 🐞 오류 로그 자동 전송(core/error-report · v0.9.26)
const { createReporter, ERR_RE, MAX_BODY } = require('../core/error-report');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  console.log('[1] 오류 줄 판정');
  ok(ERR_RE.test('✗ 실패: G3 이미지') && ERR_RE.test('[화면] 🐞 화면 오류: x is not defined') && ERR_RE.test('❌ 업로드 실패') && ERR_RE.test('TypeError: a.b'), '오류 줄을 잡는다');
  ok(!ERR_RE.test('⚡ 전체 제작 완료') && !ERR_RE.test('🎤 TTS 12/40') && !ERR_RE.test('✅ 완료') && !ERR_RE.test('⏭ 건너뜀'), '보통 줄은 안 잡는다(판정력)');

  console.log('[2] 모아서 한 번 · 같은 오류는 그날 한 번');
  const sent = []; let timers = [];
  const R = createReporter({
    send: async (p) => { sent.push(p); return { ok: true }; },
    readTail: async () => 'a\n[10:00:01] 계정 roy@x.kr 키 sk-ant-AbCdEfGhIjKlMnOpQrSt\n✗ 실패: C:\\Users\\Pink-Desktop\\x.png',
    setTimer: (fn) => { timers.push(fn); return 1; }, day: () => '2026-10-15',
  });
  ok(R.onLine('✗ 실패: G3 이미지 (12초)') === true, '첫 오류 → 대기열');
  ok(R.onLine('✗ 실패: G3 이미지 (15초)') === false, '숫자만 다른 같은 오류 → 무시');
  ok(R.onLine('❌ 업로드 실패') === true && R.onLine('보통 줄') === false, '다른 오류는 함께 모은다 · 보통 줄은 무시');
  ok(timers.length === 1 && sent.length === 0, '타이머는 한 번만 · 아직 안 보냄');
  timers[0](); await new Promise((r) => setTimeout(r, 10));
  ok(sent.length === 1 && sent[0].kind === 'auto', '60초 뒤 한 번에 보냄');
  ok(/외 1건/.test(sent[0].summary) && /G3 이미지/.test(sent[0].summary), '요약 = 첫 오류 + 외 n건: ' + sent[0].summary);
  ok(!/roy@x\.kr|sk-ant-AbCd|Pink-Desktop/.test(sent[0].body) && /<이메일>/.test(sent[0].body), '🔐 본문은 지운 뒤 보낸다(이메일·키·사용자 폴더)');
  timers = [];
  ok(R.onLine('✗ 실패: G3 이미지 (99초)') === false && timers.length === 0, '보낸 오류는 그날 다시 안 보낸다');

  console.log('[3] 꺼져 있으면 · 보내기 실패 · 크기');
  { const s2 = []; const R2 = createReporter({ send: async (p) => s2.push(p), readTail: async () => 'x', isOn: () => false, setTimer: () => 1 });
    ok(R2.onLine('✗ 실패') === false && R2._pending() === 0, '자동 전송 끔 → 모으지도 않는다'); }
  { const R3 = createReporter({ send: async () => { throw new Error('offline'); }, readTail: async () => 'x', setTimer: () => 1 });
    R3.onLine('✗ 실패 A'); ok(await R3.flush() === null, '보내기 실패해도 던지지 않는다'); }
  { const s4 = []; const big = '가'.repeat(80000) + '끝줄';
    const R4 = createReporter({ send: async (p) => { s4.push(p); return { ok: true }; }, readTail: async () => big, setTimer: () => 1 });
    R4.onLine('✗ 큰 로그'); await R4.flush();
    ok(Buffer.byteLength(s4[0].body, 'utf8') <= MAX_BODY && s4[0].body.endsWith('끝줄'), '64KB 이하로 자르고 최근(끝)을 남긴다'); }

  console.log(`\n${fail ? '❌' : '✅'} error-report — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
