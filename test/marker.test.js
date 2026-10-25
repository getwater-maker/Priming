'use strict';
/**
 * node test/marker.test.js — ⚑ 마커(Lab · Vrew 「마커」) 저장·이어받기·IPC·화면 연결 소스 검사
 *   저장 필드 s.marker · DTO mk · 작업본 저장/이어받기(2곳) · 글 고침 이어받기 · IPC clip-marker(되돌리기 먼저) · preload · 화면
 *   ⛔ 마커는 출력(.vrew·MP4)에 영향을 주지 않는다 — 빌드 지문·.vrew 빌더가 marker 를 읽지 않는다(읽으면 마커만 달아도 다시 만든다)
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const M = rd('main.js'), P = rd('core/pipeline.js'), PL = rd('preload.js'), APP = rd('renderer/src/App.jsx'), VB = rd('vrew/vrew-builder.js'), CSS = rd('renderer/src/styles.css');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

console.log('\n[1] 저장·이어받기');
ok(/mk: s\.marker \? 1 : null/.test(P) && /mk: s\.marker \? 1 : null, vl:/.test(M), 'DTO(pipeline)와 작업본 저장(main)에 mk');
ok((M.match(/s\.marker = true;\s*\/\/ ⚑ 마커/g) || []).length === 2 && /ss\.mk && ss\.text === s\.text\) s\.marker = true/.test(M), '작업본 이어받기 두 곳(무조건 · 같은 문장일 때만)');
ok(/if \(keep\.marker\) s\.marker = true/.test(M), '글이 같은 문장은 편집 뒤에도 마커 유지');
ok(/old\.length === 1 && plan\.newTexts\.length === 1 && old\[0\]\.marker\) s\.marker = true/.test(M), '한 문장을 고쳐 한 문장이면 마커 유지');
ok(/function _captureState/.test(M) && /sentences: pr\.sentences\.map\(_cloneObj\)/.test(M), '되돌리기 캡처가 문장을 통째로 복제 — 새 필드도 자동으로 따라간다');

console.log('\n[2] IPC clip-marker');
const cm = M.slice(M.indexOf("ipcMain.handle('clip-marker'"), M.indexOf("ipcMain.handle('clip-voice-overwrite'"));
ok(cm.length > 200, 'clip-marker 핸들러 있음');
ok(cm.indexOf("undoPush(") > 0 && cm.indexOf('undoPush(') < cm.indexOf('s.marker = true'), '바꾸기 전에 되돌리기 저장');
ok(/mode === 'on' \|\| args\.mode === 'off'/.test(cm) && /sents\.every\(\(s\) => !!s\.marker\)/.test(cm), 'toggle = 전부 달려 있으면 지움 · 아니면 모두 닮');
ok(/storeActive\(\); syncSnapshotNow\(\)/.test(cm), '저장(작업본)까지');
ok(!/quietPass|ttsAudioPath/.test(cm), '음성은 건드리지 않는다');
ok(/clipMarker: \(args\) => ipcRenderer\.invoke\('clip-marker', args\)/.test(PL), 'preload 연결');

console.log('\n[3] 출력에 영향 없음(판정력)');
ok(!/marker|\.mk\b/.test(VB), '.vrew 빌더가 marker 를 읽지 않는다');
ok(/VOLATILE_KEYS = new Set\(\[[^\]]*'marker'/.test(rd('core/build-fingerprint.js')), '🔑 빌드 지문이 marker 를 뺀다(문장 객체가 통째로 지문에 들어가므로 VOLATILE_KEYS — 마커만 달아도 .vrew 를 다시 만들지 않는다 · test:buildfp 가 실측)');

console.log('\n[4] 화면');
ok(/data-testid="clip-marker"/.test(APP) && /li === 0 && s\.mk/.test(APP), '클립(문장 첫 줄)에 ⚑ 표시');
ok(/function clipMarker\(mode\)/.test(APP) && /api\.clipMarker\(/.test(APP), '화면 함수 clipMarker');
ok(/label="마커" kbd=/.test(APP) && /data-testid="cx-marker"|tid="cx-marker"/.test(APP) && /tid="cx-marker-list"/.test(APP), '우클릭 메뉴 마커 · 마커 모아 보기');
ok(/data-testid="rb-marker"/.test(APP) && /data-testid="rb-marker-list"/.test(APP) && !/clipSoon\('마커'\)/.test(APP), '편집 탭 마커·마커 목록 단추 · 준비 중 표시 없음');
ok(/data-testid="marker-list"/.test(APP) && /data-testid="marker-item"/.test(APP), '모아 보기 목록 창');
ok(/\.clip-marker\{/.test(CSS) && /\.marker-item\{/.test(CSS), '스타일');

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
