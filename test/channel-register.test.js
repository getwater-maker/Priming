'use strict';
// 🤖 2.0 새 채널 등록 입구(v1.0.19 · 요청서_2.0무인제작_덧붙임_2026-11-04 ⑭) — core/channel-register
//   [1] 등록 파일 꼴 검사(빈 칸 · 범위 · 글자 · 참조 음성 파일)
//   [2] 있는지 확인(plan) — 같은 이름 채널 · 복사 원본 · 서버 목록 · 휴지통 · 그림체 이름/id
//   [3] 새 채널 값(buildPreset) — 원본의 정체 칸(유튜브 채널·로고·배경 음악·폴더)이 새지 않는다
//   [4] 등록 한 번(가짜 저장소) — 기존 채널 그대로 · 다시 등록 = 됨(바꾸지 않음) · 값이 다르면 거절
//   [5] 새 목소리 — 받아쓰기 대조 · 같은 바이트 = 다시 올리지 않음 · 다른 바이트 = 거절 · 서버가 이름을 바꾸면 실패
//   [6] 새 그림체 — 더하고 공용 목록에 올린다 · id 가 같고 내용이 다르면 거절
//   [7] 연결(소스) — tools/order.js register · bootstrap 무인 표시 · main 갈래 · 덮어쓰기·지우기 호출 0
//   ⛔ 진짜 참조음성 폴더·서버·채널 파일을 건드리지 않는다 — 저장은 모두 가짜(deps)로 돈다
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); c ? pass++ : fail++; };
const ROOT = path.join(__dirname, '..');
const CR = require('../core/channel-register');
const OC = require('../core/order-contract');
const WS = require('../core/wav-slice');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-chreg-'));
const W = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.isBuffer(s) || typeof s === 'string' ? s : JSON.stringify(s)); return p; };
const clone = (x) => JSON.parse(JSON.stringify(x));

/** 소리가 든 16-bit mono WAV(초) — freq 로 바이트를 다르게 */
function toneWav(sec, freq = 220, sr = 16000) {
  const n = Math.round(sec * sr), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const SRC = {
  id: 'p_05', name: '05_로이의성경이야기', engine: 'omnivoice', voice: 'clone', voiceCloneRefAudio: 'srv:#05_득수_낭독2', voiceCloneRefText: '남의 텍스트',
  styleId: 'chibi', styleLong: 'webtoon-illust', speedLong: 1.1, seed: 5697, language: 'ko', isDefault: true,
  captionStyle: { size: '100' }, capLong: { size: '100', font: 'Pretendard' }, aiNotice: { enabled: true, text: '고지' }, dictPath: 'D:/사전.tsv',
  outputFolder: 'G:/05', outLong: 'G:/05/vrew', outUpload: 'G:/05/up', outReader: 'C:/dl', scriptFolder: 'D:/05/대본', downloadFolder: 'D:/05/dl',
  logoPath: 'D:/05/logo.png', logoOn: true, logoX: 90, logoY: 5, ytChannelId: 'UCxxxx05', ytAuto: true, ytPlaylist: 'PL05', ytSchedule: { on: true, time: '18:00' },
  bgmOn: true, bgmPath: 'D:/05/bgm.mp3', speakers: [{ name: '노인', voice: 'srv:노인' }], profileId: 'getoversea01', imgEngine: 'kie:qwen-2-1', videoEngine: 'kie:minimax-h3', group: '',
};
const OTHER = { id: 'p_06', name: '06_고전서재', voiceCloneRefAudio: 'srv:#05_득수_낭독2', styleLong: 'oil', speedLong: 1 };
const STYLES = [{ id: 'webtoon-illust', name: '웹툰 일러스트', prompt: 'webtoon' }, { id: 'oil', name: '유화', prompt: 'oil' }, { id: 'a1', name: '같은이름', prompt: 'x' }, { id: 'a2', name: '같은이름', prompt: 'y' }];

/** 가짜 저장소 — add 만 기록한다(update·remove 가 불리면 시험이 잡는다) */
function fakeDeps(o = {}) {
  const st = { presets: clone(o.presets || [SRC, OTHER]), styles: clone(o.styles || STYLES), voices: [...(o.voices || ['#05_득수_낭독2', '별빛'])], calls: [] };
  if (o.deleted) st.deleted = o.deleted;
  const deps = {
    presets: {
      loadAll: () => clone(st.presets),
      add: (p) => { st.calls.push('preset.add'); st.presets.push(clone(p)); return p; },
      update: () => { st.calls.push('preset.update'); }, remove: () => { st.calls.push('preset.remove'); },
    },
    styles: {
      loadAll: () => clone(st.styles),
      add: (s) => { st.calls.push('style.add'); st.styles.push(clone(s)); return { ...s }; },
      update: () => { st.calls.push('style.update'); }, remove: () => { st.calls.push('style.remove'); },
    },
    listVoices: async () => { if (o.voicesNull) return null; const v = [...st.voices]; v.deleted = st.deleted || []; return v; },
    voiceAudio: async (n) => (o.srvAudio ? o.srvAudio[n] || null : null),
    localVoice: (n) => (o.localAudio ? o.localAudio[n] || null : null),
    checkAudio: async () => { st.calls.push('checkAudio'); return o.check || { ok: true, score: 0.97, heard: '…' }; },
    saveVoice: async ({ name, text }) => { st.calls.push(`saveVoice:${name}:${text}`); if (o.saveName) return { ok: true, name: o.saveName }; st.voices.push(name); return { ok: true, name }; },
    wavSec: (b) => WS.parseWav(b).durationSec,
    pushStyles: async () => { st.calls.push('pushStyles'); },
    afterPreset: () => { st.calls.push('afterPreset'); },
    at: '2026-11-04 22:00:00 KST', version: '1.0.19',
  };
  return { st, deps };
}
const REGDIR = path.join(tmp, '2.0', '주문', '등록');
const regFile = (name, obj) => W(path.join(REGDIR, name + '.json'), obj);
const GOOD = { channelId: 'jj', voice: '#05_득수_낭독2', style: 'webtoon-illust', speed: 1.05, from: '05_로이의성경이야기' };

(async () => {
  console.log('[1] 등록 파일 꼴');
  {
    const r = CR.readRegistration(regFile('jj', GOOD));
    ok(r.ok && r.reg.primingChannel === '2.0_jj' && r.reg.voice.mode === 'existing' && r.reg.style.mode === 'existing', '좋은 등록 = 통과 · Priming 채널 이름 기본 = 2.0_<채널 ID>');
    ok(CR.readRegistration(regFile('x1', { ...GOOD, voice: 'srv:별빛' })).reg.voice.name === '별빛', 'srv: 접두는 뗀다');
    const bad = CR.readRegistration(regFile('x2', { channelId: 'j j', voice: '', style: '', speed: 3 }));
    ok(!bad.ok && bad.errors.length === 4, `글자 틀린 채널 ID · 빈 목소리 · 빈 그림체 · 배속 범위 밖 = 거절 (${bad.errors.length}건)`);
    ok(!CR.readRegistration(regFile('x3', { ...GOOD, speed: null })).ok, '배속이 비면 거절(기본값으로 메우지 않는다)');
    ok(!CR.readRegistration(regFile('x4', { ...GOOD, primingChannel: 'a/b' })).ok, '채널 이름에 / = 거절');
    ok(!CR.readRegistration(W(path.join(REGDIR, 'x5.json'), '{깨짐')).ok, '깨진 JSON = 거절');
    W(path.join(REGDIR, 'jj_ref.wav'), toneWav(6));
    const nv = CR.readRegistration(regFile('x6', { ...GOOD, voice: { name: 'jj_낭독', file: 'jj_ref.wav', text: '참조 문장입니다.' } }));
    ok(nv.ok && nv.reg.voice.mode === 'new' && nv.reg.voice.file === path.join(REGDIR, 'jj_ref.wav') && nv.reg.voice.lang === 'ko', '새 목소리 — 파일 상대 경로는 등록 파일 폴더 기준 · 언어 기본 ko');
    const nb = CR.readRegistration(regFile('x7', { ...GOOD, voice: { name: 'a:b', file: 'none.mp3', text: '', lang: 'en' } }));
    ok(!nb.ok && nb.errors.length === 4, `새 목소리 — 이름 글자 · .wav 아님 · 빈 참조 텍스트 · 언어 = 거절 (${nb.errors.length}건)`);
    const ns = CR.readRegistration(regFile('x8', { ...GOOD, style: { name: 'jj 수채', tail: 'watercolor' } }));
    ok(ns.ok && ns.reg.style.mode === 'new' && ns.reg.style.id === '2.0-jj' && ns.reg.style.prompt === 'watercolor', '새 그림체 — tail 도 지시문으로 받는다 · id 기본 = 2.0-<채널 ID>');
    const cfg = OC.loadConfig(W(path.join(tmp, 'cfg.json'), { root: path.join(tmp, '2.0') }));
    ok(cfg.regDir === REGDIR && cfg.regResultsDir === path.join(tmp, '2.0', '결과', '등록'), '등록 폴더 자리 = root\\주문\\등록 · 결과\\등록');
  }

  console.log('[2] 있는지 확인');
  {
    const reg = (o) => CR.readRegistration(regFile('p', { ...GOOD, ...o })).reg;
    const known = { presets: [SRC, OTHER], voices: ['#05_득수_낭독2', '별빛'], deleted: ['지운목소리'], styles: STYLES };
    ok(CR.plan(reg({}), known).errors.length === 0, '있는 목소리·그림체·원본 = 통과');
    ok(CR.plan(reg({ primingChannel: '06_고전서재' }), known).errors.length === 1, '같은 이름 채널이 있으면 거절(덮어쓰지 않는다)');
    ok(CR.plan(reg({ from: '없는채널' }), known).errors.length === 1, '없는 복사 원본 = 거절');
    ok(CR.plan(reg({ voice: '없음' }), known).errors.length === 1, '서버에 없는 목소리 = 거절');
    ok(CR.plan(reg({}), { ...known, voices: null }).errors.length === 1, '서버 목록을 못 읽으면 거절(fail-closed)');
    W(path.join(REGDIR, 'del.wav'), toneWav(5));
    ok(CR.plan(reg({ voice: { name: '지운목소리', file: 'del.wav', text: 't' } }), known).errors.length === 1, '서버 휴지통에 있는 이름으로 새 등록 = 거절');
    const pn = CR.plan(reg({ style: '유화' }), known);
    ok(!pn.errors.length && pn.style.id === 'oil', '그림체는 이름으로도 부른다(하나뿐일 때) → id');
    ok(CR.plan(reg({ style: '같은이름' }), known).errors.length === 1, '같은 이름 그림체가 여럿이면 거절(id 로)');
    ok(CR.plan(reg({ style: { id: 'oil', name: '유화', prompt: '다른 지시문' } }), known).errors.length === 1, '새 그림체 id 가 있고 내용이 다르면 거절');
    ok(CR.plan(reg({ style: { id: 'oil', name: '유화', prompt: 'oil' } }), known).style.how === '이미 있는 같은 그림체', '새 그림체 id·이름·지시문이 같으면 그대로 쓴다');
    ok(CR.plan(reg({ style: { id: 'new1', name: '유화', prompt: 'z' } }), known).errors.length === 1, '새 그림체 이름이 다른 그림체와 같으면 거절');
  }

  console.log('[3] 새 채널 값');
  {
    const reg = CR.readRegistration(regFile('b', GOOD)).reg;
    const p = CR.plan(reg, { presets: [SRC], voices: ['#05_득수_낭독2'], styles: STYLES });
    const np = CR.buildPreset(reg, p, { at: 'T' });
    ok(np.name === '2.0_jj' && np.voiceCloneRefAudio === 'srv:#05_득수_낭독2' && np.voiceCloneRefText === '' && np.styleLong === 'webtoon-illust' && np.styleId === 'webtoon-illust' && np.speedLong === 1.05, '목소리 srv: · 그림체 · 배속 = 등록 값');
    ok(!np.ytChannelId && !np.ytAuto && np.ytSchedule.on === false && !np.ytPlaylist, '원본의 유튜브 채널·자동 업로드·예약·재생목록이 새지 않는다');
    ok(!np.logoPath && !np.logoOn && !np.bgmOn && !np.bgmPath && np.speakers.length === 0 && np.profileId === 'default', '원본의 로고·배경 음악·화자·브라우저 프로필이 새지 않는다');
    ok(['outputFolder', 'outLong', 'outUpload', 'outReader', 'scriptFolder', 'downloadFolder'].every((k) => np[k] === ''), '원본의 폴더 자리가 새지 않는다');
    ok(!('id' in np) && !np.isDefault, 'id·기본 채널 표시는 복사하지 않는다(저장소가 새 id)');
    ok(np.capLong.font === 'Pretendard' && np.aiNotice.text === '고지' && np.dictPath === 'D:/사전.tsv' && np.seed === 5697, '자막 모양·화면 AI 고지·발음 사전·시드는 원본에서');
    ok(np.imgEngine === 'local:qwen-2-1' && np.videoEngine === 'none' && np.group === '2.0', '그림 = 로컬 · 영상 없음(유료 영상이 켜지지 않게) · 묶음 2.0');
    ok(np.order20 && np.order20.channelId === 'jj' && np.order20.from === '05_로이의성경이야기' && np.order20.file === 'b', '2.0 표시(order20) — 채널 ID · 원본 · 등록 파일');
    ok(SRC.ytChannelId === 'UCxxxx05' && SRC.logoOn === true, '원본 객체는 건드리지 않는다');
    const reg2 = CR.readRegistration(regFile('b2', { ...GOOD, from: '' })).reg;
    const t = CR.buildPreset(reg2, CR.plan(reg2, { presets: [], voices: ['#05_득수_낭독2'], styles: STYLES }));
    ok(t.aiNotice.enabled === true && /AI 도구/.test(t.aiNotice.text) && t.engine === 'omnivoice' && t.inferenceTimesteps === 32 && t.order20.from === null, '원본이 없으면 기본 틀(화면 AI 고지 켬 · 음성 품질 32)');
  }

  console.log('[4] 등록 한 번');
  {
    const { st, deps } = fakeDeps();
    const before = clone(st.presets);
    const f = regFile('jj', GOOD);
    const r = await CR.register(f, deps);
    ok(r.status === '됨' && r.channel === '새로 만듦' && st.calls.filter((c) => c === 'preset.add').length === 1, `됨 · 채널 하나 더함 (${r.status} ${r.reason})`);
    ok(JSON.stringify(st.presets.slice(0, 2)) === JSON.stringify(before), '기존 채널 둘은 한 글자도 그대로');
    ok(!st.calls.some((c) => /update|remove/.test(c)), '덮어쓰기·지우기 호출 0');
    ok(JSON.stringify(r.sameVoice) === JSON.stringify(['05_로이의성경이야기', '06_고전서재']) && JSON.stringify(r.sameStyle) === JSON.stringify(['05_로이의성경이야기']), '같은 목소리·그림체를 쓰는 다른 채널 이름');
    ok(r.forOrder.primingChannel === '2.0_jj' && r.forOrder.voice === '#05_득수_낭독2' && r.forOrder.style === 'webtoon-illust' && r.forOrder.speed === 1.05, '주문서에 쓸 이름(forOrder)');
    ok(r.voice.how === '기존' && r.style.how === '기존' && !st.calls.some((c) => /saveVoice|style.add|checkAudio/.test(c)), '기존 목소리·그림체 = 서버·그림체 목록을 건드리지 않는다');
    ok(st.calls.includes('afterPreset'), '채널을 만들면 채널 화풍 내보내기를 다시 한다');
    const r2 = await CR.register(f, deps);
    ok(r2.status === '됨' && r2.channel === '이미 같은 값으로 있음' && st.calls.filter((c) => c === 'preset.add').length === 1, '같은 등록을 다시 = 됨 · 아무것도 바꾸지 않음');
    const r3 = await CR.register(regFile('jj_b', { ...GOOD, speed: 1.2 }), deps);
    ok(r3.status === '거절' && /이미 있습니다/.test(r3.reason) && st.presets.find((p) => p.name === '2.0_jj').speedLong === 1.05, '같은 이름에 다른 값 = 거절 · 먼저 만든 채널 그대로');
    const r4 = await CR.register(regFile('x9', { ...GOOD, voice: '없음' }), deps);
    ok(r4.status === '거절' && r4.channelId === 'jj' && r4.file === 'x9' && r4.forOrder === null, '없는 목소리 = 거절 결과서(채널 ID·파일 이름은 실린다)');
    const out = OC.writeResultOnce(path.join(tmp, '결과'), 'jj', r);
    const out2 = OC.writeResultOnce(path.join(tmp, '결과'), 'jj', r2);
    ok(path.basename(out) === 'jj.json' && path.basename(out2) === 'jj_2.json', '결과서는 한 번만(다시 = _2)');
  }

  console.log('[5] 새 목소리');
  {
    const wav = toneWav(6, 220);
    W(path.join(REGDIR, 'n.wav'), wav);
    const REG = { ...GOOD, primingChannel: '2.0_nv', voice: { name: 'nv_낭독', file: 'n.wav', text: '참조 문장입니다.' } };
    {
      const { st, deps } = fakeDeps();
      const r = await CR.register(regFile('nv', REG), deps);
      ok(r.status === '됨' && r.voice.how === '새로 등록' && st.calls.includes('saveVoice:nv_낭독:참조 문장입니다.') && st.calls.indexOf('checkAudio') < st.calls.findIndex((c) => c.startsWith('saveVoice')), `받아쓰기 대조 → 저장(이름·참조 텍스트) → 됨 (${r.reason})`);
      ok(st.presets.find((p) => p.name === '2.0_nv').voiceCloneRefAudio === 'srv:nv_낭독' && r.sameVoice.length === 0, '새 채널이 새 목소리를 가리킨다 · 같은 목소리 채널 없음');
    }
    {
      const { st, deps } = fakeDeps({ check: { ok: false, score: 0.42, heard: '전혀 다른 말' } });
      const r = await CR.register(regFile('nv', REG), deps);
      ok(r.status === '거절' && /42%/.test(r.reason) && !st.calls.some((c) => c.startsWith('saveVoice')) && !st.calls.includes('preset.add'), '참조 텍스트가 음성과 다르면 거절 · 저장 0 · 채널 0');
    }
    {
      const { st, deps } = fakeDeps({ check: { ok: true, score: null, unknown: true } });
      const r = await CR.register(regFile('nv', REG), deps);
      ok(r.status === '됨' && r.notes.some((n) => /확인하지 못했습니다/.test(n)), '받아쓰기를 못 하면 등록은 하고 결과서에 적는다');
    }
    {
      const { st, deps } = fakeDeps({ voices: ['#05_득수_낭독2', 'nv_낭독'], srvAudio: { 'nv_낭독': wav } });
      const r = await CR.register(regFile('nv', REG), deps);
      ok(r.status === '됨' && r.voice.how === '이미 등록된 같은 음성' && !st.calls.some((c) => c.startsWith('saveVoice')), '서버에 같은 이름·같은 바이트 = 다시 올리지 않고 됨(멱등)');
    }
    {
      const { st, deps } = fakeDeps({ voices: ['#05_득수_낭독2', 'nv_낭독'], srvAudio: { 'nv_낭독': toneWav(6, 330) } });
      const r = await CR.register(regFile('nv', REG), deps);
      ok(r.status === '거절' && /다른 목소리/.test(r.reason) && !st.calls.some((c) => c.startsWith('saveVoice')), '서버에 같은 이름·다른 음성 = 거절(덮어쓰지 않는다)');
    }
    {
      const { st, deps } = fakeDeps({ localAudio: { 'nv_낭독': toneWav(6, 330) } });
      const r = await CR.register(regFile('nv', REG), deps);
      ok(r.status === '거절' && !st.calls.some((c) => c.startsWith('saveVoice')), '이 PC 참조음성 폴더에 같은 이름·다른 음성 = 거절');
    }
    {
      const { st, deps } = fakeDeps({ saveName: 'nv_낭독_2' });
      const r = await CR.register(regFile('nv', REG), deps);
      ok(r.status === '실패' && !st.calls.includes('preset.add'), '서버가 다른 이름으로 저장하면 실패 · 채널 0');
    }
    {
      W(path.join(REGDIR, 'short.wav'), toneWav(1));
      const { st, deps } = fakeDeps();
      const r = await CR.register(regFile('nv', { ...REG, voice: { ...REG.voice, file: 'short.wav' } }), deps);
      ok(r.status === '거절' && /2~40초/.test(r.reason) && !st.calls.some((c) => c.startsWith('saveVoice')), '참조 음성이 너무 짧으면 거절');
    }
  }

  console.log('[6] 새 그림체');
  {
    const { st, deps } = fakeDeps();
    const r = await CR.register(regFile('ns', { ...GOOD, primingChannel: '2.0_ns', style: { name: 'jj 수채', prompt: 'watercolor, soft' } }), deps);
    ok(r.status === '됨' && r.style.id === '2.0-jj' && r.style.how === '새로 등록' && st.styles.some((s) => s.id === '2.0-jj' && s.prompt === 'watercolor, soft'), `그림체 목록에 더함 (${r.reason})`);
    ok(st.calls.indexOf('style.add') < st.calls.indexOf('pushStyles') && st.calls.indexOf('pushStyles') < st.calls.indexOf('preset.add'), '그림체 → 공용 목록 올리기 → 채널 순서');
    ok(st.presets.find((p) => p.name === '2.0_ns').styleLong === '2.0-jj' && r.forOrder.style === '2.0-jj', '새 채널·주문서 이름이 새 그림체 id');
    const r2 = await CR.register(regFile('ns', { ...GOOD, primingChannel: '2.0_ns', style: { name: 'jj 수채', prompt: 'watercolor, soft' } }), deps);
    ok(r2.status === '됨' && st.calls.filter((c) => c === 'style.add').length === 1, '같은 등록 다시 = 그림체를 또 더하지 않는다');
  }

  console.log('[7] 연결(소스)');
  {
    const src = fs.readFileSync(path.join(ROOT, 'core', 'channel-register.js'), 'utf8');
    ok(!/presets\.(update|remove)|styles\.(update|remove)|\.reorder\(/.test(src), 'channel-register 에 채널·그림체 덮어쓰기·지우기·순서 바꾸기 호출 0');
    const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    ok(/_headlessArg\('register'\)/.test(main) && /async function _headlessRegister\(/.test(main) && /CR\.register\(file,/.test(main), 'main 무인 갈래 → _headlessRegister → CR.register');
    ok(/writeResultOnce\(cfg\.regResultsDir/.test(main), '등록 결과서 = 결과\\등록 에 한 번만');
    const body = main.slice(main.indexOf('async function _headlessRegister('), main.indexOf('/** ④ 2.0 의 OAuth 앱으로 채널 연결'));
    ok(/RV\.saveLocal\(/.test(body) && /uploadRefVoice\(/.test(body), '새 목소리 저장 = 보이스디자인 저장과 같은 길(saveLocal + uploadRefVoice)');
    ok(/pushStylesToServer\(\)/.test(body) && /exportChannelStyles\(\)/.test(body), '그림체 공용 목록 올리기 · 채널 화풍 내보내기');
    const boot = fs.readFileSync(path.join(ROOT, 'bootstrap.js'), 'utf8');
    ok(/HEADLESS_FLAGS = \[[^\]]*'--register'/.test(boot), 'bootstrap — --register 는 무인 실행(업데이트 안 함 · 창 없음)');
    const tool = fs.readFileSync(path.join(ROOT, 'tools', 'order.js'), 'utf8');
    ok(/case 'register':[^\n]*'--register'/.test(tool), 'tools/order.js register <파일>');
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? '✗' : '✓'} channel-register ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
