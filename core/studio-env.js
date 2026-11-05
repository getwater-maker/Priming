'use strict';
/**
 * core/studio-env.js — 🏠 로이판 전용 값(로이 PC 경로·관리자 결제 주소) 한 곳(v1.0.26).
 * 🛒 판매판 매니페스트에서 빠진다(core/edition FEATURES.omniServer) — 회원 PC 에 로이 서버 경로가 내려가지 않게.
 * 이 파일이 없으면 부르는 쪽은 「서버 PC 아님」·회원 충전 페이지로 동작한다.
 */
module.exports = {
  OMNI_HOME: 'D:/TTS_Model',                 // 메인 PC OmniVoice 자족형 폴더
  SERVER_REF_DIR: 'D:/TTS_Model/ref-audio',  // 메인 PC 참조음성 라이브러리(서버 공용)
  KIE_BILLING_URL: 'https://kie.ai/billing', // 👑 관리자 kie 충전
};
