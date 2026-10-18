'use strict';
// 🧭 리본 메뉴 따라가기 우선순위 + 🪙 포인트 해석 (v0.9.72)
const assert = require('assert');
const MF = require('../core/menu-follow');
const { pointsOf } = require('../core/license');

const mk = (o) => ({ phase: 'running', stages: { tts: { state: 'wait' }, image: { state: 'wait' }, video: { state: 'wait' }, out: { state: 'wait' }, ...o } });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

ok(MF.pick({}) === null, '아무것도 안 돌면 null');
ok(MF.pick({ make: mk({ tts: { state: 'run' } }) }) === 'script', 'TTS → 대본·음성');
ok(MF.pick({ make: mk({ image: { state: 'run' } }) }) === 'image', '이미지 → 이미지');
ok(MF.pick({ make: mk({ video: { state: 'run' } }) }) === 'video', '비디오 → 비디오');
ok(MF.pick({ make: mk({ out: { state: 'run' } }) }) === 'finish', '4단계 → 완성');
ok(MF.pick({ make: mk({ tts: { state: 'done' }, image: { state: 'done' } }) }) === null, '끝난 단계는 안 센다');
ok(MF.pick({ make: { ...mk({ tts: { state: 'run' } }), phase: 'done' } }) === null, '끝난 만들기는 안 센다');
ok(MF.pick({ stage: { id: 'a', phase: 'video' } }) === 'video', '단계 버튼(비디오)');
ok(MF.pick({ mp4: { phase: 'video' } }) === 'finish', 'MP4 굽는 중 → 완성');
ok(MF.pick({ mp4: { phase: 'done' } }) === null, 'MP4 끝남 → 안 센다');
ok(MF.pick({ yt: { phase: 'prepare' } }) === 'finish', '업로드 중 → 완성');
ok(MF.pick({ yt: { phase: 'error' } }) === null, '업로드 실패 → 안 센다');
// 동시 진행 — 뒤 단계 우선
ok(MF.pick({ make: mk({ tts: { state: 'run' }, image: { state: 'run' } }) }) === 'image', 'TTS+이미지 동시 → 이미지');
ok(MF.pick({ make: mk({ image: { state: 'run' }, video: { state: 'run' } }) }) === 'video', '이미지+비디오 → 비디오');
ok(MF.pick({ make: mk({ tts: { state: 'run' } }), mp4: { phase: 'video' } }) === 'finish', '다음 대본 TTS + 앞 대본 MP4 → 완성');
ok(MF.pick({ stage: { phase: 'tts' }, yt: { phase: 'sending' } }) === 'finish', '단계 TTS + 업로드 → 완성');

// 포인트
ok(pointsOf({}) === null, '포인트 없음 = null');
ok(JSON.stringify(pointsOf({ points_granted: 1000, points_remaining: 640 })) === '{"granted":1000,"remaining":640}', '숫자 그대로');
ok(JSON.stringify(pointsOf({ points_granted: '500', points_remaining: '0' })) === '{"granted":500,"remaining":0}', '문자열 숫자 · 0 은 값이다');
ok(pointsOf({ points_granted: 'abc', points_remaining: null }) === null, '숫자가 아니면 null');
console.log(`menu-follow ✓ ${n}`);
