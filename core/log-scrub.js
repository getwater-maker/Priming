'use strict';
/**
 * log-scrub.js — 🔐 로그를 밖(primingwave.com 오류 로그)으로 보내기 전에 지울 것을 지운다(v0.9.26 · 설계 docs/회원제-설계.md §6).
 *   지우는 것: API 키·토큰 모양 · 이메일 · 전화번호 · 사용자 폴더 이름(C:\Users\<이름> → ~) · Authorization/X-API-Key 값.
 *   🔑 이 파일 한 곳만 쓴다 — 보내는 입구(자동 전송 · 🐞 문제 보고)가 늘어도 여기를 거친다(test:logscrub).
 *   ⛔ 지나치게 지워 로그가 쓸모없어지지 않게: 대본 문장·D: 같은 작업 폴더 경로는 남긴다.
 *   🎬 단, **YouTube 에서 받은 값**(연결 채널 이름·올린 영상 제목·재생목록 이름·영상 주소 ID)이 든 유튜브 관련 줄은 가린다(scrubYouTube).
 */

const RULES = [
  // 헤더·이름=값 꼴로 실린 비밀 — 값만 가린다
  [/((?:authorization|x-api-key|apikey|api[_-]?key|token|password|passwd|secret)\s*[:=]\s*)(?:bearer\s+)?["']?[^\s"',;]+/gi, '$1<가림>'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer <가림>'],
  // 알려진 키 모양
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '<JWT>'],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g, '<키>'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, '<키>'],
  [/\bhf_[A-Za-z0-9]{20,}/g, '<키>'],
  [/\bxai-[A-Za-z0-9]{20,}/g, '<키>'],
  [/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{10,}/g, '<키>'],
  [/\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, '<키>'],
  // 이메일 · 전화번호
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<이메일>'],
  [/\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b/g, '<전화>'],
  // 사용자 폴더 이름(윈도우 · 슬래시 꼴 둘 다)
  [/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"'<>|]+/gi, '~'],
  [/(\/Users\/|\/home\/)[^/\s"']+/g, '~'],
];

// 숫자·글자가 섞인 32자 이상 덩어리(이름 없는 키·토큰) — 해시(16진 40자 sha1 등)도 함께 가려진다
const LONG_BLOB = /\b(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}={0,2}/g;

// 🎬 YouTube API 로 받은 값(연결된 채널 이름 · 올린 영상 제목 · 재생목록 이름)은 밖으로 보내지 않는다(v0.9.69 · 구글 API 심사 「Limited Use」 —
//   「YouTube 데이터는 우리에게 오지 않는다」가 방침의 문장이다). 유튜브 관련 줄(YT_LINE)만 줄 단위로 가린다 — 대본 제목이 든 다른 줄은 그대로.
const YT_LINE = /유튜브|YouTube|youtu\.?be|업로드 마무리|재생목록|채널 연결/i;
const YT_RULES = [
  [/「[^」\n]*」/g, '「<가림>」'],                                   // 「채널」 · 제목 「영상 제목」 · 재생목록 「이름」
  [/(대기[^\n(]*)\([^()\n]*\)\s*$/, '$1(<가림>)'],                  // ⏳ 유튜브 업로드 대기 — 앞에 N건 (제목)
  [/\(있는 목록:[^)\n]*\)/, '(있는 목록: <가림>)'],                  // 재생목록 이름 목록
  [/(연결됨\s*[—-]\s*).+$/, '$1<가림>'],                           // ✅ 유튜브 채널 연결됨 — 채널 이름
  [/(youtu\.be\/|youtube\.com\/(?:watch\?v=|playlist\?list=|shorts\/)|studio\.youtube\.com\/video\/)[A-Za-z0-9_-]+/gi, '$1<가림>'],
];
function scrubYouTube(text) {
  return String(text).split('\n').map((ln) => {
    if (!YT_LINE.test(ln)) return ln;
    for (const [re, to] of YT_RULES) ln = ln.replace(re, to);
    return ln;
  }).join('\n');
}

function scrub(text) {
  let s = String(text == null ? '' : text);
  s = scrubYouTube(s);
  for (const [re, to] of RULES) s = s.replace(re, to);
  s = s.replace(LONG_BLOB, '<긴값>');
  return s;
}

module.exports = { scrub };
