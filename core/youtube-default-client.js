'use strict';
/**
 * youtube-default-client.js — 🎬 Priming 기본 유튜브 연결(앱 신분증) — 2026-09-30 로이 결정 · v0.5.91
 *
 *   업로드 전용 구글 클라우드 프로젝트 「Priming Upload」(priming-upload)의 **데스크톱 앱** 클라이언트.
 *   🔑 데스크톱(installed) 앱의 client_secret 은 구글도 비밀로 보지 않는다(모든 설치본에 들어가는 값) — 그래서 앱에 넣어 배포한다.
 *      사용자마다 다른 것은 **채널 연결(각자의 로그인 허락 — 그 PC 에만 암호화 저장)** 이다. 이 값으로는 남의 채널에 올릴 수 없다.
 *   ⚠ 분석용 `adonairoy` 프로젝트와 **다른** 프로젝트다(YPP 정지 전염 방지로 분리) — 그쪽 값은 절대 여기에 넣지 않는다.
 *   ⚠ 악용되면 구글 클라우드에서 클라이언트 비밀을 교체하고 이 파일만 갈아 끼운다(전원 채널 다시 연결).
 *   사용자가 자기 프로젝트 파일을 가져오면(⚙ 설정 → ▶ 유튜브 → 고급) 그것이 이 기본값보다 먼저다(자기 한도).
 */
module.exports = {
  clientId: "932586314031-uueg6e7s7vnnru316h8ojn5kq9aoav1v.apps.googleusercontent.com",
  clientSecret: "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",
  projectId: "priming-upload",
};
