'use strict';
// node test/channel-voice.test.js — 「대본의 채널(목소리)이 엉뚱하게 바뀌던 것」 검증.
//
// 배경(2026-08-31 실사고): 로이 — "고전서재 채널인데 음성이 선택된 음성이 아닌 다른 음성으로 TTS 변환됐다."
//   OmniVoice 서버 로그가 원인을 그대로 보여 줬다:
//     TTS 합성 시작 [Voice Clone(lib)]: text=세 아이는 자두나무 아래로…, **seed=5697**
//   06_고전서재 채널의 시드는 **40469** 다. 5697 은 **기본 채널(04_역사이야기, isDefault)** 의 시드다.
//
// 원인: 대본 4개를 한 번에 열면 open-script 가 `addItem(parsed, path, outRoot)` 를 **settings 없이** 부른다.
//   렌더러의 디바운스 자동저장(set-queue-settings)은 **활성 항목(=마지막에 연 것)** 에만 저장하므로,
//   workspace.json 실측에서도 4개 중 **마지막 1개만** presetName 을 갖고 있었다:
//       {file:"…8부…", settingsKeys:[]}          ← 채널 없음
//       {file:"…9부…", settingsKeys:[]}          ← 채널 없음
//       {file:"…10부…", settingsKeys:[]}         ← 채널 없음
//       {file:"…11부…", presetName:"06_고전서재"} ← 마지막에 연 것만
//   그 상태로 「만들기」를 누르면 run-batch 가 `presetName: s.presetName || null` → null 을 넘기고
//   runMakeAllCore 의 `P.getPreset(null)` 이 **기본 채널**을 돌려준다 → 엉뚱한 목소리로 조용히 합성.
//
// 지키는 것:
//   ① open-script 가 **여는 즉시** 그 채널을 항목 settings 에 박는다
//   ② addItem 이 settings 를 **병합**한다(통째로 덮으면 스타일·범위 등 기존 설정이 날아간다)
//   ③ run-batch 가 항목값이 없으면 **헤더(common) 채널로 폴백**한다 — 기본 채널로 떨어지지 않게
//   ④ 렌더러가 common 에 presetName·ttsSpeed·aiNotice 를 **실어 보낸다**(안 보내면 ③이 무의미)
//   ⑤ 어느 채널·목소리·시드·배속으로 만드는지 **1단계 로그에 남는다**(이번에 서버 로그를 뒤져야 했던 이유)
//
//   🔑 로직을 복사하지 않는다 — main.js·App.jsx 원문을 그대로 읽어 대조하고, addItem 은 원문을 실행한다.

const fs = require('fs');
const path = require('path');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + '  (기대 ' + JSON.stringify(b) + ' / 실제 ' + JSON.stringify(a) + ')');

// ── main.js 원문에서 함수 통째로 뽑기 ──
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' 를 찾을 수 없습니다(원문에 없음)');
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

console.log('\n[1] addItem 원문 실행 — settings 병합 (통째 덮어쓰기 금지)');
{
  const src = extractFn(MAIN, 'addItem');
  // 원문이 쓰는 바깥 것들만 최소 스텁으로 채운다(로직은 원문 그대로).
  let idSeq = 0;
  const S = { modes: { longform: { items: [], activeId: null } }, mode: 'longform' };
  const sandbox = { S, newItemId: () => 'q' + (++idSeq), scheduleAutoSave: () => {}, writeWorkspace: () => {} };
  const fn = new Function('S', 'newItemId', 'scheduleAutoSave', 'writeWorkspace',
    src + '\nreturn addItem;')(sandbox.S, sandbox.newItemId, sandbox.scheduleAutoSave, sandbox.writeWorkspace);

  // 새 항목: 채널이 즉시 박힌다
  const a = fn({ f: 1 }, 'D:/a.md', 'D:/out/a', { presetName: '06_고전서재' });
  eq(a.settings && a.settings.presetName, '06_고전서재', 'ⓐ 새 항목에 채널이 저장된다');

  // 그 항목에 다른 설정이 나중에 붙는다(렌더러 디바운스 저장 흉내)
  a.settings = { ...a.settings, styleId: 'watercolor', vidFrom: 1, vidTo: 5 };

  // 같은 대본을 다시 열었을 때: 채널은 갱신되고 **기존 설정은 살아남는다**
  const a2 = fn({ f: 2 }, 'D:/a.md', 'D:/out/a', { presetName: '01_로이의고전이야기' });
  ok(a2 === a, 'ⓑ 같은 대본은 같은 큐 항목을 재사용한다');
  eq(a2.settings.presetName, '01_로이의고전이야기', 'ⓒ 다시 열면 그때 채널로 갱신된다');
  eq(a2.settings.styleId, 'watercolor', 'ⓓ 🔴 기존 설정(스타일)이 살아남는다 — 병합이지 덮어쓰기가 아니다');
  eq(a2.settings.vidTo, 5, 'ⓔ 🔴 기존 설정(영상 범위)도 살아남는다');

  // settings 를 안 주면 기존 값을 건드리지 않는다
  const a3 = fn({ f: 3 }, 'D:/a.md', 'D:/out/a', null);
  eq(a3.settings.presetName, '01_로이의고전이야기', 'ⓕ settings 없이 부르면 기존 설정 유지');

  // 실사고 재현: 대본 4개를 연달아 열면 **전부** 채널을 갖는다
  const files = ['8부', '9부', '10부', '11부'];
  const S2 = { modes: { longform: { items: [], activeId: null } }, mode: 'longform' };
  const fn2 = new Function('S', 'newItemId', 'scheduleAutoSave', 'writeWorkspace',
    src + '\nreturn addItem;')(S2, () => 'x' + (++idSeq), () => {}, () => {});
  for (const f of files) fn2({ t: f }, 'D:/' + f + '.md', 'D:/out', { presetName: '06_고전서재' });
  const withCh = S2.modes.longform.items.filter((it) => it.settings && it.settings.presetName === '06_고전서재').length;
  eq(withCh, 4, 'ⓖ 🔴 실사고 재현 — 4개를 한 번에 열어도 **전부** 채널을 갖는다 (예전엔 1개뿐)');
}

console.log('[2] open-script 원문 — 여는 즉시 채널을 박는다');
{
  ok(/addItem\(S\.parsed, S\.scriptPath, S\.outRoot, \(preset && preset\.name\) \? \{ presetName: preset\.name \} : null\)/.test(MAIN),
    'ⓐ open-script 가 preset.name 을 addItem 에 넘긴다');
  // ⚠ 검사는 **open-script 핸들러 범위**로 좁힌다 — 쓰이지 않는 setSingleItem 의 호출까지 잡으면 헛실패한다.
  const _os = MAIN.indexOf("ipcMain.handle('open-script'");
  const _osBlock = MAIN.slice(_os, _os + 4000);
  ok(_os > 0, 'ⓑ open-script 핸들러를 찾았다');
  ok(!/addItem(S.parsed, S.scriptPath, S.outRoot);/.test(_osBlock),
    'ⓒ 🔴 그 안에 옛 호출(settings 없이 addItem)이 남아 있지 않다');
}

console.log('[3] run-batch 원문 — 항목값 없으면 헤더 채널 폴백');
{
  ok(/const _pn = s\.presetName \|\| common\.presetName \|\| null;/.test(MAIN),
    'ⓐ presetName 이 항목 → 헤더 순으로 결정된다');
  ok(/presetName: _pn,/.test(MAIN), 'ⓑ 그 값을 runMakeAllCore 로 넘긴다');
  ok(!/presetName: s\.presetName \|\| null, speed: s\.ttsSpeed \|\| null,/.test(MAIN),
    'ⓒ 🔴 옛 코드(항목값만 보고 null 로 떨어지던 것)가 남아 있지 않다');
  ok(/⚠ 채널이 지정되지 않았습니다/.test(MAIN),
    'ⓓ 끝내 채널이 없으면 **조용히 넘어가지 않고** 경고한다');
  ok(/common\.ttsSpeed != null \? common\.ttsSpeed : null/.test(MAIN),
    'ⓔ 배속도 같은 구멍이었다 — 헤더 폴백');
  ok(/aiNotice: \(s\.aiNotice != null \? !!s\.aiNotice : !!common\.aiNotice\)/.test(MAIN),
    'ⓕ AI 고지도 헤더 폴백');
}

console.log('[4] 렌더러 원문 — common 에 채널·배속·AI고지를 싣는다');
{
  const i = APP.indexOf('api.runBatch(');
  ok(i > 0, 'ⓐ runBatch 호출을 찾았다');
  const call = APP.slice(i, i + 500);
  ok(/presetName: presetName \|\| null/.test(call), 'ⓑ 🔴 common.presetName 을 보낸다 (안 보내면 [3]이 무의미)');
  ok(/ttsSpeed:/.test(call), 'ⓒ common.ttsSpeed 를 보낸다');
  ok(/aiNotice/.test(call), 'ⓓ common.aiNotice 를 보낸다');
}

console.log('[5] voiceLabel 원문 실행 — 어느 채널·목소리·시드인지 한 줄로 남는다');
{
  const bs = String.fromCharCode(92);
  const voiceLabel = new Function('path', extractFn(MAIN, 'voiceLabel') + '\nreturn voiceLabel;')(path);
  eq(voiceLabel({ name: '06_고전서재', voiceCloneRefAudio: 'srv:#05_득수_낭독2', seed: 40469 }),
    '채널 「06_고전서재」 · 목소리 ☁ #05_득수_낭독2 · 시드 40469', 'ⓐ 서버 목소리는 ☁ 로 표기 + 채널·시드');
  eq(voiceLabel({ name: '출판', voiceCloneRefAudio: ['C:', 'x', 'ref-audio', '02_저음 2단계.wav'].join(bs), seed: 5697 }),
    '채널 「출판」 · 목소리 02_저음 2단계.wav · 시드 5697', 'ⓑ 로컬 파일은 파일명만');
  ok(/참조음성 없음/.test(voiceLabel({ name: 'X', voiceCloneRefAudio: '', seed: 1 })), 'ⓒ 참조음성이 없으면 경고 표기');
  // 🔑 시드가 비면 서버가 매번 다른 시드를 쓴다 → 같은 채널인데 편마다 톤이 달라진다. 로그가 그걸 말해야 한다.
  ok(/매번 톤이 달라집니다/.test(voiceLabel({ name: 'X', voiceCloneRefAudio: 'srv:a' })), 'ⓓ 시드가 없으면 경고로 알린다');
  ok(/매번 톤이 달라집니다/.test(voiceLabel({ name: 'X', voiceCloneRefAudio: 'srv:a', seed: '' })), 'ⓔ 빈 문자열도 경고');
  ok(/시드 0/.test(voiceLabel({ name: 'X', voiceCloneRefAudio: 'srv:a', seed: 0 })), 'ⓕ 시드 0 은 유효한 값이다(경고 금지)');
  ok(/저장하지 않고|기존 시드를 그대로/.test(APP), 'ⓖ 렌더러: 숫자가 아닌 시드는 저장하지 않고 알린다(시드가 날아가면 톤이 매번 달라진다)');
  eq(voiceLabel(null), '⚠ 채널 없음', 'ⓗ 채널이 없어도 던지지 않는다');
  // 1단계·전체TTS·그룹TTS·도입부 네 경로가 **같은 함수**로 찍는다(표기가 갈리면 로그 대조가 안 된다)
  eq((MAIN.match(/voiceLabel\(/g) || []).length - 1, 5, 'ⓘ voiceLabel 을 쓰는 곳 5군데(1단계·전체TTS·그룹TTS 2 ·도입부)');
  ok(/🎙 1단계 — 음성\(TTS\) 일괄 변환… \(\$\{voiceLabel\(preset\)\}/.test(MAIN), 'ⓙ 1단계가 이 함수를 쓴다');
  ok(/⚠ 채널을 찾지 못했습니다/.test(MAIN), 'ⓚ 채널을 못 찾으면 그 사실이 로그에 남는다');
}

console.log('[6] resolvePreset 원문 실행 — **이름이 낡은 전역을 이긴다**');
{
  // 🔴 실사고(2026-09-15): 큐에서 대본을 바꿔도 S.preset 은 '마지막에 연 대본'의 채널로 남았다.
  //   그 상태에서 🎤 를 누르면 `S.preset || P.getPreset(name)` 이 **전역을 먼저** 골라 남의 목소리로 합성했다.
  const CH = {
    '06_고전서재': { name: '06_고전서재', voiceCloneRefAudio: 'srv:#05_득수_낭독2', seed: 40469 },
    '08_다산의뜰': { name: '08_다산의뜰', voiceCloneRefAudio: 'srv:고전_ok', seed: 5697 },
    '04_역사이야기': { name: '04_역사이야기', voiceCloneRefAudio: 'srv:02_저음 2단계', seed: 5697, isDefault: true },
  };
  const mk = (S) => {
    const logs = [];
    const P = { getPreset: (nm) => (nm ? (CH[nm] || null) : CH['04_역사이야기']) };
    const fn = new Function('S', 'P', 'log', extractFn(MAIN, 'resolvePreset') + '\nreturn resolvePreset;')(S, P, (l) => logs.push(String(l)));
    return { fn, logs };
  };
  // 실사고 재현: 전역은 다산인데 이 대본은 고전서재다
  {
    const S = { preset: CH['08_다산의뜰'] };
    const { fn } = mk(S);
    eq(fn('06_고전서재').voiceCloneRefAudio, 'srv:#05_득수_낭독2', 'ⓐ 이름이 이긴다 — 낡은 전역(다산)을 따르지 않는다');
  }
  { const S = { preset: CH['08_다산의뜰'] }; eq(mk(S).fn(null).name, '08_다산의뜰', 'ⓑ 이름이 없으면 전역(=활성 대본의 채널)'); }
  { const S = { preset: null }; eq(mk(S).fn(null).name, '04_역사이야기', 'ⓒ 전역도 없으면 기본 채널'); }
  {
    const S = { preset: CH['08_다산의뜰'] }; const r = mk(S);
    eq(r.fn('없는채널').name, '08_다산의뜰', 'ⓓ 이름을 못 찾으면 폴백하되');
    ok(r.logs.some((l) => /없는채널/.test(l) && /찾지 못했/.test(l)), 'ⓔ **조용히 넘어가지 않고** 로그로 알린다');
  }
  // 🔑 A/B 역검증: 옛 표현식이면 같은 시나리오에서 남의 목소리가 나온다(이 테스트가 헛단언이 아님을 확인)
  {
    const S = { preset: CH['08_다산의뜰'] };
    const P = { getPreset: (nm) => (nm ? (CH[nm] || null) : CH['04_역사이야기']) };
    const old = new Function('S', 'P', 'return function (n) { return S.preset || P.getPreset(n); };')(S, P);
    eq(old('06_고전서재').name, '08_다산의뜰', 'ⓕ (역검증) 옛 코드는 실제로 남의 채널을 골랐다');
  }
}

console.log('[7] syncActiveToS 원문 실행 — 큐에서 대본을 바꾸면 채널도 따라온다');
{
  const CH = {
    '06_고전서재': { name: '06_고전서재', voiceCloneRefAudio: 'srv:#05_득수_낭독2' },
    '08_다산의뜰': { name: '08_다산의뜰', voiceCloneRefAudio: 'srv:고전_ok' },
  };
  const P = { getPreset: (nm) => (nm ? (CH[nm] || null) : null) };
  const items = [
    { id: 'q1', parsed: { t: 1 }, scriptPath: 'a.md', outRoot: 'A', settings: { presetName: '06_고전서재' } },
    { id: 'q2', parsed: { t: 2 }, scriptPath: 'b.md', outRoot: 'B', settings: { presetName: '08_다산의뜰' } },
    { id: 'q3', parsed: { t: 3 }, scriptPath: 'c.md', outRoot: 'C', settings: null },   // 옛 항목(채널 없음)
  ];
  const S = { modes: { longform: { items, activeId: 'q2' } }, mode: 'longform', preset: null };
  const activeItem = () => S.modes[S.mode].items.find((x) => x.id === S.modes[S.mode].activeId) || null;
  const fn = new Function('S', 'P', 'activeItem', extractFn(MAIN, 'syncActiveToS') + '\nreturn syncActiveToS;')(S, P, activeItem);

  fn(); eq(S.preset && S.preset.name, '08_다산의뜰', 'ⓐ 활성 항목의 채널이 전역에 실린다');
  S.modes.longform.activeId = 'q1'; fn();
  eq(S.preset && S.preset.name, '06_고전서재', 'ⓑ **대본을 바꾸면 채널도 바뀐다** (이게 없어서 남의 목소리가 나갔다)');
  eq(S.parsed.t, 1, 'ⓒ 대본 미러도 함께 바뀐다(기존 동작 보존)');
  S.modes.longform.activeId = 'q3'; fn();
  eq(S.preset && S.preset.name, '06_고전서재', 'ⓓ 항목에 채널이 없으면 **기존 채널 유지** — 기본 채널로 떨어뜨리지 않는다');
  S.modes.longform.activeId = null; fn();
  eq(S.parsed, null, 'ⓔ 활성 항목이 없으면 대본은 비우고');
  eq(S.preset && S.preset.name, '06_고전서재', 'ⓕ 채널은 건드리지 않는다');
}

console.log('[8] 배선 원문 대조 — 합성·내보내기 경로에 낡은 전역 우선이 남아 있지 않다');
{
  const body = (marker, len) => { const i = MAIN.indexOf(marker); return i < 0 ? '' : MAIN.slice(i, i + len); };
  const vrew = body("ipcMain.handle('export-vrew'", 1800);
  const grp = body("ipcMain.handle('tts-group'", 2200);
  const intro = body("ipcMain.handle('intro-video-prep'", 1400);
  ok(vrew && grp && intro, 'ⓐ 세 핸들러를 원문에서 찾았다');
  for (const [nm, src] of [['export-vrew', vrew], ['tts-group', grp], ['intro-video-prep', intro]]) {
    ok(/resolvePreset\(/.test(src), `ⓑ ${nm} 가 resolvePreset 을 쓴다`);
    ok(!/S\.preset \|\|/.test(src), `ⓒ ${nm} 에 옛 \`S.preset ||\` 가 남아 있지 않다`);
  }
  // 위험한 형태는 **이름을 넘기면서도 전역을 먼저 고르는 것**이다.
  //   `S.preset || P.getPreset(null)`(=resolvePreset 내부 폴백·기본 채널)은 정상이므로 제외하고,
  //   주석도 제외한 뒤(설명문에 옛 표현식이 적혀 있다) 실제 코드에만 남았는지 본다.
  const code = MAIN.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const hits = (code.match(/S\.preset \|\| P\.getPreset\((?!null\))/g) || []);
  eq(hits.length, 0, 'ⓓ 이름을 넘기면서 전역을 먼저 고르는 표현식 잔존 0');
}

console.log('[9] 그룹 TTS — **채널 시드 고정**, 다른 take 는 Shift+클릭일 때만');
{
  const i = MAIN.indexOf("ipcMain.handle('tts-group'");
  const src = MAIN.slice(i, i + 2200);
  ok(/roll = false/.test(src), 'ⓐ roll 인자를 받는다(기본 false = 고정)');
  ok(/const rollPreset = roll \? \{ \.\.\.preset, seed: Math\.floor/.test(src), 'ⓑ **roll 일 때만** 시드를 갈아끼운다');
  ok(/: preset;/.test(src), 'ⓒ 평소엔 채널 프리셋을 그대로 쓴다(시드 고정)');
  ok(!/const rollPreset = \{ \.\.\.preset, seed: Math\.floor/.test(MAIN), 'ⓓ 옛 무조건 랜덤화가 남아 있지 않다');
  ok(/voiceLabel\(preset\)/.test(src), 'ⓔ 어느 목소리·시드로 만드는지 로그에 남는다');
  ok(/시드 \$\{rollPreset\.seed\}/.test(src), 'ⓕ 시드를 바꿨을 땐 바꾼 값을 분명히 남긴다');
  // 렌더러: Shift 여부를 실제로 넘기는가
  ok(/onGroupTts\(pr\.shortsNum, c\.num, e\.shiftKey\)/.test(APP), 'ⓖ 렌더러가 shiftKey 를 전달한다');
  ok(/runGroupTts\(shortsNum, groupNum, roll = false\)/.test(APP), 'ⓗ 기본값은 고정(roll=false)');
  ok(/roll: !!roll/.test(APP), 'ⓘ IPC 인자에 roll 을 싣는다 — 안 실으면 Shift 가 조용히 무시된다');
  ok(/Shift\+클릭/.test(APP), 'ⓙ 버튼 설명에 Shift+클릭 동작이 적혀 있다(숨은 동작 금지)');
}

console.log('[10] 소스 위생');
{
  ok(!/\r\n/.test(MAIN), 'ⓐ main.js 줄끝 LF 유지 (CRLF 로 저장하면 원문 대조 테스트들이 헛실패한다)');
  ok(MAIN.indexOf('\u0000') < 0, 'ⓑ main.js 에 NUL 없음');
}

console.log('\n' + (bad ? `❌ ${bad}/${n} 실패` : `✅ ${n}/${n} 통과`));
process.exit(bad ? 1 : 0);
