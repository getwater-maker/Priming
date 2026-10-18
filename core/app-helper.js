'use strict';
/**
 * app-helper.js — 💬 「프로그램에 묻기」(v0.9.77 · 로이 2026-10-18 「왜 1028 은 진행을 안 했는지 물어볼 데가 없다」)
 *   오늘 로그 끝부분 + 큐 요약 + 앱 버전을 Claude(Sonnet)에 붙여 질문에 답하게 한다. 읽기 전용 — 답만 하고 아무것도 바꾸지 않는다.
 *   🔑 입구는 `CA.ask({use:'helper'})` 한 곳(main `app-ask`) · 모델 = 그 쓰임에 고른 것 > Sonnet(기본 · 로이 지정) — Opus 기본값으로 떨어지지 않는다.
 *   ⛔ 로그는 반드시 `log-scrub` 을 거친다(키·이메일·유튜브 채널/영상 이름) · 이 파일은 fs 를 쓰지 않는다(main 이 글을 읽어 넘긴다 — 테스트 쉽게).
 */
const { scrub } = require('./log-scrub');

const HELPER_MODEL = 'claude-sonnet-5-5';
const LOG_CHARS = 48000;        // 로그 끝에서 이만큼(≈ 1.5~2만 토큰)
const MAX_Q = 600;              // 질문 글자 상한
const MAX_HISTORY = 3;          // 이어 묻기에 실을 앞선 질문·답 쌍

const SYSTEM = [
  '당신은 Priming(롱폼 영상 제작 프로그램: 대본 → 음성(TTS) → 이미지 → 비디오 → .vrew/MP4 → 유튜브 업로드)의 안내 도우미입니다.',
  '사용자(로이)는 비전문가입니다. 한국어로, 짧고 쉬운 말로 답하세요. 결론을 먼저 한 줄, 그 근거가 된 로그 줄(시각 포함)을 이어서 인용하세요.',
  '아래에 주어지는 「큐 상태」와 「오늘 로그」에 있는 사실만 근거로 삼으세요. 로그에 없으면 지어내지 말고 "로그에서는 확인되지 않는다"고 하고, 확인할 방법(어느 버튼·어느 화면)을 안내하세요.',
  '용어: ⏹ 중단 요청 = 사람이 중단을 누른 것 · ✗ 실패 = 오류 · "큐 제작 종료" = ⚡ 만들기 루프가 끝난 것(남은 대본은 「대기」로 남고 다시 ⚡ 만들기를 눌러야 이어짐) · 「이번 편까지만」 = 지금 편만 끝내고 다음 편은 시작하지 않음 · 402 = 생성 크레딧 부족.',
  '이 도우미는 읽기 전용입니다. 설정을 바꾸거나 작업을 실행할 수 없으니, 해야 할 일은 사용자가 누를 버튼으로 안내하세요(코드 파일 수정을 권하지 마세요).',
  '시각은 모두 KST입니다. 답은 8줄 안쪽으로.',
].join('\n');

function queueSummary(qdto) {
  const items = (qdto && qdto.longform && qdto.longform.items) || [];
  if (!items.length) return '(큐 비어 있음)';
  const ST = { idle: '대기', running: '진행중', done: '완료', failed: '실패', interrupted: '중단됨(이어하기 가능)' };
  return items.map((it, i) => {
    const up = it.upload && it.upload.state ? ` · 업로드 ${it.upload.state}` : '';
    const run = it.run && (it.run.endedAt || it.run.start) ? ` · 마지막 제작 ${JSON.stringify(it.run).slice(0, 120)}` : '';
    return `${i + 1}. ${it.title || it.file || '대본'} — ${ST[it.status] || it.status}${up}${it.active ? ' · (화면에서 보는 중)' : ''}${run}`;
  }).join('\n');
}

/** 질문 → {system, text}. 로그는 끝 LOG_CHARS 만(줄 중간에서 시작하지 않게 첫 줄바꿈 뒤부터) */
function buildPrompt({ question, logText, queue, version, history, now }) {
  let log = scrub(String(logText || ''));
  if (log.length > LOG_CHARS) { log = log.slice(-LOG_CHARS); const nl = log.indexOf('\n'); if (nl >= 0) log = log.slice(nl + 1); }
  const hist = (Array.isArray(history) ? history : []).slice(-MAX_HISTORY)
    .map((h) => `Q: ${String(h.q || '').slice(0, MAX_Q)}\nA: ${String(h.a || '').slice(0, 1500)}`).join('\n\n');
  const q = String(question || '').trim().slice(0, MAX_Q);
  const text = [
    `[앱 버전] ${version || '?'}${now ? ` · 지금 ${now}(KST)` : ''}`,
    '[큐 상태]', queueSummary(queue),
    '[오늘 로그 — 끝부분, 시각은 KST]', log || '(로그 없음)',
    hist ? '[앞선 질문·답]\n' + hist : '',
    '[질문]', q,
  ].filter(Boolean).join('\n\n');
  return { system: SYSTEM, text, question: q };
}

module.exports = { buildPrompt, queueSummary, SYSTEM, HELPER_MODEL, LOG_CHARS, MAX_Q };
