'use strict';
/**
 * ref-voice.js — 🎙 참조음성 만들기에서 앱(보이스디자인 창)과 CLI(tools/ref-voice.js)가 **같이 쓰는 것** (v0.6.99)
 *   채널사업부 요청(2026-10-05): 세션이 참조음성을 만들고 검증할 때 OmniVoice 키에 막히지 않게 — CLI 가 앱과 같은 함수로 한다.
 *   · 받아쓰기 일치율 `textMatchRatio`(앱 생성 직후 표시와 같은 값)
 *   · 자르기 규칙 `cutRange`(외국어 = 문장 사이 쉼 · 한국어 = 앞 무음·끝 감쇠)
 *   · 라이브러리 등록 `saveToLibrary`(이 PC ~/.flow-app/ref-audio + 서버 공용 라이브러리 · 구버전 서버면 보이스디자인 서버로)
 *   · 기본 예문·검증 문장
 *   🔑 API 키는 이 모듈이 다루지 않는다(서버 호출 모듈이 안에서 읽는다) — 화면·로그에 내보내지 않는다.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// 앱 언어 값(보이스디자인 창 select) ↔ 짧은 코드
const LANG_OF = { ko: 'Korean', ja: 'Japanese', vi: 'vi', Korean: 'Korean', Japanese: 'Japanese' };
const CODE_OF = { Korean: 'ko', Japanese: 'ja', vi: 'vi' };

// 🎨 기본 예문 — 앱 보이스디자인 창 VD_SAMPLE_TEXT 와 같다(test/ref-voice.test 가 둘을 대조한다).
//   ⚠ 일본어는 「昔々」로 시작하지 않는다 — Qwen3 ja 가 昔々 를 자주 잘못 읽었고(85~95% · 채널사업부 2026-10-05), 가나 「むかしむかし」로 쓰면
//     받아쓰기(Whisper)가 「昔々」로 적어 맞게 읽어도 점수가 깎인다(표기 차이 · CLI 첫 실측). 표기가 갈리는 낱말은 예문·검증문에 넣지 않는다.
const SAMPLE_TEXT = {
  Korean: '안녕하세요. 오늘은 아주 흥미로운 역사 이야기를 들려드리겠습니다. 오래전 이 땅에 살았던 사람들의 이야기를, 차분한 목소리로 하나씩 풀어 보겠습니다.',
  Japanese: 'ある村に、貧しいけれど心の優しい若者が住んでいました。彼は毎朝早く起きて、山へ薪を拾いに行きました。',
  vi: 'Ngày xửa ngày xưa, ở một ngôi làng nhỏ bên bờ sông, có một chàng trai nghèo nhưng rất tốt bụng. Mỗi sáng, anh dậy thật sớm và lên núi nhặt củi.',
};
// 🔎 등록 뒤 「새 문장」 역대조 — 예문과 다른 문장(참조텍스트를 그대로 따라 읽는지가 아니라, 처음 보는 글을 바르게 읽는지)
const VERIFY_TEXTS = {
  Korean: ['그날 밤, 마을에는 조용히 눈이 내리고 있었습니다.', '오래된 책장 속에서 누렇게 바랜 편지 한 통이 나왔습니다.', '할머니는 아이에게 옛날이야기를 하나 더 들려주었습니다.'],
  Japanese: ['その夜、村には静かに雪が降っていました。', '古い本棚の奥から、黄色く色あせた手紙が一通出てきました。', '翌朝、若者はいつものように山へ向かいました。'],
  vi: ['Đêm hôm ấy, tuyết rơi lặng lẽ trên ngôi làng nhỏ.', 'Từ trong kệ sách cũ, một lá thư đã ngả vàng rơi ra.', 'Bà kể cho đứa cháu nghe thêm một câu chuyện ngày xưa.'],
};

/** 두 글이 글자 기준으로 얼마나 같은가(0~1) — 문장부호·공백·대소문자 무시, 편집 거리. 받아쓰기 확인용(앱 보이스디자인 창과 같은 값). */
function textMatchRatio(a, b) {
  const n = (s) => [...String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')];
  const x = n(a), y = n(b);
  if (!x.length) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.max(0, 1 - prev[y.length] / x.length);
}

/** 자를 구간 {start, end, pauseAt?}(초) — 외국어는 문장 사이 쉼에서(낱말 한가운데를 베면 남은 글자가 새 문장 앞에 샌다) · 한국어는 앞 무음·끝 감쇠만 */
function cutRange(buf, lang) {
  const WS = require('./wav-slice');
  return (LANG_OF[lang] !== 'Korean' && WS.suggestPauseRange(buf)) || WS.suggestRange(buf);
}

const REF_DIR = () => path.join(os.homedir(), '.flow-app', 'ref-audio');
/** 이 PC 참조음성 폴더에 저장(같은 이름이 있으면 _2·_3 …) → { base, wavPath } */
function saveLocal(name, wavBuffer, refText) {
  const dir = REF_DIR();
  fs.mkdirSync(dir, { recursive: true });
  let base = name, i = 2;
  while (fs.existsSync(path.join(dir, base + '.wav'))) { base = name + '_' + i; i++; }
  const wavPath = path.join(dir, base + '.wav');
  fs.writeFileSync(wavPath, wavBuffer);
  fs.writeFileSync(path.join(dir, base + '.txt'), String(refText || ''), 'utf8');   // 같은 이름 .txt = 참조텍스트
  return { base, wavPath };
}
/** 서버 공용 라이브러리 등록(OmniVoice /save-ref-voice → 구버전이면 보이스디자인 /save-voice) → { ok, name, path, via } */
async function saveToLibrary({ name, text, instruct, wavBuffer }) {
  const ASR = require('../tts/asr-client');
  const r = await ASR.saveServerVoice({ name, text, instruct, wavBuffer }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  if (r && r.ok) return { ...r, via: 'omnivoice' };
  if (((r && r.error) || '') !== 'unsupported') return r;   // 진짜 실패는 그대로(주소·키·용량 등)
  try {
    const r2 = await require('./qwen-design').saveVoice({ name, text, instruct, wavBuffer });
    return r2 && r2.ok ? { ...r2, via: 'voicedesign' } : r2;
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

module.exports = { LANG_OF, CODE_OF, SAMPLE_TEXT, VERIFY_TEXTS, textMatchRatio, cutRange, REF_DIR, saveLocal, saveToLibrary };
