'use strict';
/**
 * node test/ai-subtitle.test.js — 🌐 AI 자막 교정·번역 순수 규칙(core/ai-subtitle) + 소스 배선
 *   화면·IPC·SRT 는 test/ai-subtitle-ui.smoke.js(가짜 Claude 응답으로 실제 앱)
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const AS = require('../core/ai-subtitle');
const list = [{ n: 1, text: '첫째 문장입니다.', ref: { groupNum: 1, sentIdx: 0 } }, { n: 2, text: '둘째 문장 입니다.', ref: { groupNum: 1, sentIdx: 1 } }, { n: 5, text: '다섯째 문장입니다.', ref: { groupNum: 2, sentIdx: 0 } }];

console.log('\n[1] 교정 — 요청·해석·안전 검사');
const rq = AS.proofRequest(list);
ok(/교정자/.test(rq.system) && /뜻·말투·어휘·문장 길이를 바꾸지 않는다/.test(rq.system) && /^1\t첫째/m.test(rq.text) && /^5\t다섯째/m.test(rq.text), '요청: 교정만 · 뜻 불변 · 번호+문장');
const p = AS.parseProof([{ n: 2, after: '둘째 문장입니다.', why: '띄어쓰기' }, { n: 1, after: '첫째 문장입니다.' }, { n: 9, after: '없는 번호' }, { n: 5, after: '' }, { n: 5, after: '다섯째 문장입니다. 이어서 아주아주 길게 새 내용을 마구 덧붙여 놓은 문장입니다 정말로.' }, { n: 2, after: '또 다른' }], list);
ok(p.proposals.length === 1 && p.proposals[0].n === 2 && p.proposals[0].why === '띄어쓰기' && p.proposals[0].ref.sentIdx === 1, '유효한 제안 하나만 남는다(원문과 같음·없는 번호·빈 글·너무 늘어남·중복은 버림)');
ok(p.dropped === 5, `버린 수 ${p.dropped}`);
ok(AS.parseProof(null, list).proposals.length === 0 && AS.parseProof('x', list).proposals.length === 0, '엉뚱한 답이면 제안 0개(던지지 않는다)');

console.log('\n[2] 번역 — 요청·해석');
const tq = AS.translateRequest(list, 'ja');
ok(/日本語/.test(tq.system) && /번역가/.test(tq.system) && /"t"/.test(tq.system), '요청: 언어 이름 · JSON 모양');
const t = AS.parseTranslate([{ n: 1, t: ' Hello ' }, { n: 2, t: '' }, { n: 5, t: 'Five' }, { n: 1, t: '중복' }], list);
ok(t.map.get(1) === 'Hello' && t.map.get(5) === 'Five' && t.missing.length === 1 && t.missing[0] === 2, '번역 지도 · 빠진 번호 알림(중복은 첫 값)');
ok(AS.langOf('en').maxChars > AS.langOf('ja').maxChars && AS.langOf('zz') === null, '언어 표(라틴 문자는 한 줄이 길다 · 모르는 언어 null)');

console.log('\n[3] 나눔 · 소스 배선');
ok(AS.chunks(Array.from({ length: 130 }, (_, i) => i)).map((x) => x.length).join() === '60,60,10', '60개씩 나눠 보낸다');
const M = rd('main.js'), P = rd('core/pipeline.js'), CA = rd('core/claude-api.js'), APP = rd('renderer/src/App.jsx'), PL = rd('preload.js');
ok(/ipcMain\.handle\('ai-proof'/.test(M) && /ipcMain\.handle\('ai-translate'/.test(M) && /use: 'spell'/.test(M) && /use: 'translate'/.test(M), 'main: 두 IPC 모두 CA.ask 에 use 를 댄다');
ok(/translate: '🌐 AI 자막 번역'/.test(CA), 'USES 에 translate');
const ap = M.slice(M.indexOf("ipcMain.handle('ai-proof'"), M.indexOf("ipcMain.handle('ai-translate'"));
ok(!/_editSentences|editSentences|writeScriptAtomic|undoPush/.test(ap), '🔑 교정 IPC 는 대본을 고치지 않는다(제안만)');
ok(/writeSrt\(t\.pr, out, L\.maxChars/.test(M) && /textOf = null/.test(P) && /textOf \? null : s\.capBreaks/.test(P), '번역은 같은 writeSrt(시각 공유) · 원문 줄 나눔은 번역에 쓰지 않는다');
ok(!/(?<!ai)Translate.*ttsAudioPath/.test(M.slice(M.indexOf("ipcMain.handle('ai-translate'"), M.indexOf("// 🎙 음성 덮어쓰기"))), '번역은 음성·대본에 손대지 않는다');
ok(/aiProof: \(args\)/.test(PL) && /aiTranslate: \(args\)/.test(PL) && /data-testid="ai-proof-panel"/.test(APP) && /data-testid="ai-tr-panel"/.test(APP) && !/clipSoon\('AI 자막/.test(APP), '화면 연결 · 준비 중 없음');
console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
