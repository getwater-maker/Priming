'use strict';
// node test/tts-number.test.js — 「자막은 숫자 · TTS 는 정확한 발음」 규약 검증.
//
// 배경(2026-08-25): 로이가 TTS 때문에 대본에 숫자를 한글로 쓰고 있었는데(「천사백십팔년」)
//   자막이 그 한글을 그대로 받아 어색했다. 실측하니 전제가 거짓이었다 — 현재 OmniVoice 는
//   아라비아 숫자를 문맥에 맞게 정확히 읽는다(고유어/한자어까지 스스로 가린다).
//   측정법 = 합성 → ASR 전사 비교(23조 · 약 50클립 · 목소리 02_저음 2단계):
//     · 화이트리스트 단위 11개(회·차·등·호·위·도·분·초·세기·세대·세) 전수 11/11 일치
//     · "5개"→「다섯 개」 · "23살"→「스물세 살」 · "2시 30분"→「두 시 삼십 분」 · "1000명"→「천 명」
//     · 판정력 검증: ASR 은 자리읽기를 구분한다("일영영영"→`1-0-0-0…` · "일이년"→`1, 2년`)
//     · 🔴 강제 변환은 해롭다: "오개를 받았다" → 들림 「옥외를 받았다」
//     · 🟠 물결표는 예외: "50~60명" 그대로는 「50, 60명」 오독 / "50에서 60명" 은 정확
//
// 지키는 것:
//   ① 물결표(~) 변환은 남아 있다
//   ② 숫자→한글 강제 변환이 다시 들어오지 않는다 (A/B: 되살리면 이 섹션이 깨진다)
//   ③ 가공은 processForTTS 한 곳에서만 — 자막 경로는 원문 그대로
//   ④ TTS 캐시 키가 "실제 합성될 문자열" 기준 (사전·정규화를 고쳐도 옛 음성이 안 되살아난다)
//
//   🔑 로직을 복사하지 않는다 — 앱 원문 모듈을 require 해 그대로 돌린다.

const fs = require('fs');
const path = require('path');

const R = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const TP_SRC   = R('tts', 'text-pronouncer.js');
const MGR_SRC  = R('tts', 'tts-manager.js');
const PIPE_SRC = R('core', 'pipeline.js');
const VREW_SRC = R('vrew', 'vrew-builder.js');

const TP  = require('../tts/text-pronouncer');
const TC  = require('../core/tts-cache');
const { TTSManager } = require('../tts/tts-manager');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + `  (기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)})`);

// ── ① 물결표 → 「에서」 (실측으로 필요 확인된 유일한 변환) ──
eq(TP.normalizeForTTS('50~60명이 모였다.'), '50에서 60명이 모였다.', '반각 ~ 를 「에서」로');
eq(TP.normalizeForTTS('50〜60명'), '50에서 60명', 'wave dash 〜 도 처리');
eq(TP.normalizeForTTS('50～60명'), '50에서 60명', '전각 ～ 도 처리');
eq(TP.normalizeForTTS('50 ~ 60명'), '50에서 60명', '물결표 앞뒤 공백도 처리');
eq(TP.normalizeForTTS('1592~1598년'), '1592에서 1598년', '네 자리 연도 범위');
eq(TP.normalizeForTTS('앞뒤가 숫자가 아니면 그대로 ~ 둔다'), '앞뒤가 숫자가 아니면 그대로 ~ 둔다',
   '숫자 사이가 아닌 물결표는 건드리지 않는다');

// ── ② 숫자→한글 강제 변환이 사라졌는지 (실측 표를 회귀로 박는다) ──
//   전부 "그대로 통과" 해야 한다. 하나라도 한글로 바뀌면 옛 동작이 되살아난 것.
const UNCHANGED = [
  '1418년에 태어났다.', '12년 전이었다.', '1592년 4월 13일이었다.', '3월 5일 아침',
  '3회 우승했다.', '제2차 시도였다.', '1등을 했다.', '5호실이었다.', '2위였다.',
  '36도였다.', '30분 걸렸다.', '10초 남았다.', '19세기였다.', '3세대였다.', '40세였다.',
  '5개를 받았다.', '23살이었다.', '2시 30분에 만났다.', '3번 만났다.',
  '1,000명이 넘었다.', '3만 명이 죽었다.', '10%가 줄었다.', '3.5배 늘었다.', '100원',
];
for (const s of UNCHANGED) eq(TP.normalizeForTTS(s), s, '숫자를 한글로 바꾸지 않는다: ' + s);

// A/B 성격 — 옛 구현의 흔적이 원문에 없는지
ok(!/_convertSinoNumbersBeforeUnits/.test(TP_SRC), '옛 함수 _convertSinoNumbersBeforeUnits 가 없다');
ok(!/UNITS\s*=\s*\[/.test(TP_SRC), '한자어 단위 화이트리스트가 없다');
const normBody = TP_SRC.slice(TP_SRC.indexOf('function normalizeForTTS'));
ok(!/numToHangulSino/.test(normBody.slice(0, 400)),
   'numToHangulSino 가 normalizeForTTS 에 배선되지 않았다(순수 유틸로만 남음)');
// 유틸 자체는 여전히 옳게 동작(되살릴 때를 위해)
eq(TP.numToHangulSino(1418), '천사백십팔', 'numToHangulSino 유틸은 그대로 동작');
eq(TP.numToHangulSino(100), '백', 'numToHangulSino: 100 → 백');

// ── ③ 가공은 processForTTS 한 곳에서만 · 사전이 자동 규칙보다 우선 ──
ok(typeof TP.processForTTS === 'function', 'processForTTS 를 export 한다');
const dict = [{ source: '6월', pron: '유월' }, { source: '삼국지', pron: '삼국지' }];
eq(TP.processForTTS('6월 항쟁', dict), '유월 항쟁', '사전이 적용된다');
eq(TP.processForTTS('50~60명', dict), '50에서 60명', '사전 + 정규화가 함께 적용된다');
eq(TP.processForTTS('꺼진 항목은 무시 6월', [{ source: '6월', pron: '유월', enabled: false }]),
   '꺼진 항목은 무시 6월', 'enabled:false 항목은 적용되지 않는다');
eq(TP.processForTTS('1592년', []), '1592년', '사전이 비면 숫자는 그대로');
// 긴 source 우선
eq(TP.processForTTS('정약용', [{ source: '약', pron: 'X' }, { source: '정약용', pron: '정냐굥' }]),
   '정냐굥', '긴 source 를 먼저 매칭한다');

// 배선 대조 — synthesize 가 자체 가공을 하지 않고 processText 를 쓴다
ok(/const processed = this\.processText\(text\)/.test(MGR_SRC), 'synthesize 가 this.processText 를 쓴다');
ok(/processForTTS/.test(MGR_SRC), 'tts-manager 가 processForTTS 를 경유한다');
ok(!/const dictApplied = applyOmniVoiceDict/.test(MGR_SRC), 'synthesize 안의 옛 2단 가공이 사라졌다');
ok(/async prepareDict\(\)/.test(MGR_SRC), 'prepareDict() 가 있다');
ok(/processText\(text\)\s*\{/.test(MGR_SRC), 'processText() 가 있다');

// 자막 경로는 원문 그대로여야 한다
ok(/splitCaptionLines\(s\.text/.test(VREW_SRC), '자막은 s.text 원문을 쓴다');
ok(!/normalizeForTTS|processForTTS|text-pronouncer/.test(VREW_SRC),
   '자막 빌더는 TTS 가공 함수를 쓰지 않는다(자막에 발음 표기가 새지 않는다)');

// ── ④ TTS 캐시 키 = 실제 합성될 문자열 ──
ok(/typeof ttsMgr\.processText === 'function'/.test(PIPE_SRC), 'pipeline 이 ttsMgr.processText 로 키 텍스트를 만든다');
// 2026-08-31: 음량 정규화 목표(normDb)가 키에 함께 들어가면서 세 번째 인자가 확장됐다.
//   여기서 지키는 것은 첫 인자가 keyText(= 실제 합성될 문자열)라는 것 하나다.
ok(PIPE_SRC.includes('TtsCache.keyFor(keyText, sf, { ...synthOpts'), '캐시 키가 keyText 기준이다');
ok(!/TtsCache\.keyFor\(s\.text, sf, synthOpts\)/.test(PIPE_SRC), '옛 "원문 기준" 키가 사라졌다');
ok(/prepareDict/.test(PIPE_SRC), '루프 전에 사전을 맞춘다(첫 문장만 옛 사전으로 계산되는 것 방지)');

const mgr = new TTSManager({});
mgr._dictCache = [{ source: '정약용', pron: '정냐굥' }];
eq(mgr.processText('정약용 선생'), '정냐굥 선생', 'TTSManager.processText 가 사전을 적용한다');
eq(mgr.processText('1592년'), '1592년', 'TTSManager.processText 는 숫자를 그대로 둔다');

const opts = { provider: 'omnivoice', refName: 'v1', seed: 1 };
// 사전에 걸리는 문장 → 키가 달라져 재합성된다 (옛 코드는 같은 키 = 옛 음성 재활용)
ok(TC.keyFor(mgr.processText('정약용 선생'), 1.15, opts) !== TC.keyFor('정약용 선생', 1.15, opts),
   '사전이 걸린 문장은 원문 키와 달라진다(= 옛 음성이 되살아나지 않는다)');
// 사전에 안 걸리는 문장 → 키가 그대로 = 기존 캐시가 유지된다(통째 무효화 없음)
ok(TC.keyFor(mgr.processText('1592년 봄이었다.'), 1.15, opts) === TC.keyFor('1592년 봄이었다.', 1.15, opts),
   '가공이 필요없는 문장은 키가 그대로다(기존 캐시 통째 무효화 없음)');
// 사전을 고치면 키가 바뀐다
const mgr2 = new TTSManager({});
mgr2._dictCache = [{ source: '정약용', pron: '정약뇽' }];
ok(TC.keyFor(mgr.processText('정약용'), 1.15, opts) !== TC.keyFor(mgr2.processText('정약용'), 1.15, opts),
   '사전 발음을 고치면 키가 바뀐다(발음사전 수정이 실제로 반영된다)');

// ── ⑤ 대본 작성 가이드에 규약이 적혀 있는지 ──
const GUIDE = R('docs', '대본-작성-가이드.md');
ok(/숫자는 아라비아 숫자로 쓴다/.test(GUIDE), '가이드에 「숫자는 아라비아 숫자로」 규약이 있다');
ok(/세 번/.test(GUIDE), '가이드에 고유어 예외(「세 번」)가 적혀 있다');

console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 숫자 표기(자막=숫자 / TTS=발음) ' + n + '/' + n + ' 통과');
process.exit(bad ? 1 : 0);
