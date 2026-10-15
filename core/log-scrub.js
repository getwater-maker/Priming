'use strict';
/**
 * log-scrub.js — 🔐 로그를 밖(primingwave.com 오류 로그)으로 보내기 전에 지울 것을 지운다(v0.9.26 · 설계 docs/회원제-설계.md §6).
 *   지우는 것: API 키·토큰 모양 · 이메일 · 전화번호 · 사용자 폴더 이름(C:\Users\<이름> → ~) · Authorization/X-API-Key 값.
 *   🔑 이 파일 한 곳만 쓴다 — 보내는 입구(자동 전송 · 🐞 문제 보고)가 늘어도 여기를 거친다(test:logscrub).
 *   ⛔ 지나치게 지워 로그가 쓸모없어지지 않게: 대본 문장·채널 이름·D: 같은 작업 폴더 경로는 남긴다.
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

function scrub(text) {
  let s = String(text == null ? '' : text);
  for (const [re, to] of RULES) s = s.replace(re, to);
  s = s.replace(LONG_BLOB, '<긴값>');
  return s;
}

module.exports = { scrub };
