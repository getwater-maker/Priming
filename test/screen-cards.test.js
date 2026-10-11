'use strict';
/**
 * node test/screen-cards.test.js — 📜 화면 카드(역자 노트 원문-번역 병기 · 장 막간 — 삼국지 R4 · v0.7.98)
 *   [1] 마커 읽기(표기 꼴 · 울타리·주석 · 종류·칸) [2] 계획(문장 찾기 · +N · 시각 · 경고가 조용하지 않다) [3] 곡선·ASS(창 경계 이음)
 *   [4] 실제 MP4(어두운 판 · 서서히 · 끝나면 그대로 · 길이 불변 · 이음새 · 한자 글꼴 · 렌더 시간) [5] 지문·기본값(마커 없으면 예전과 같다)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, spawnSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const SC = require('../core/screen-cards');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const FF = require('../core/media-utils').getFfmpegPath();

const SCRIPT = [
  '# 카드 시험', '',
  '## 읽기 전에 · 옮긴이의 말', '',
  '### 서술의 이름',
  '> 🖼️ 이미지: a quiet courtyard',
  '> 📜 화면카드: 병기 | 원문=天下大勢分久必合 | 번역=천하의 큰 흐름은 나뉜 지 +0',
  '', '天下大勢，分久必合，合久必分。', '',
  '천하의 큰 흐름은 나뉜 지 오래되면 반드시 합쳐지고, 합쳐진 지 오래되면 반드시 나뉩니다.', '',
  '이야기는 이렇게 시작합니다.', '',
  '## 제1회 · 도원결의', '',
  '### 푸른 뱀과 천하의 재앙',
  '> 🖼️ 이미지: a palace hall',
  '> 📜 화면카드: 막간 | 문장=제1회 도원결의',
  '', '제1회, 도원결의.', '',
  '본문 문장입니다 하나.', '',
].join('\n');

(async () => {
  console.log('[1] 마커 읽기');
  {
    const mk = SC.markersOf(SCRIPT);
    ok(mk.length === 2 && mk[0].kind === 'pair' && mk[1].kind === 'interlude', '대본에서 카드 줄 둘(병기 · 막간)');
    ok(mk[0].heading === '서술의 이름' && mk[1].heading === '푸른 뱀과 천하의 재앙', '줄 위의 가장 가까운 제목을 기억한다');
    ok(mk[0].f['원문'].text === '天下大勢分久必合' && mk[0].f['번역'].extra === 0 && mk[0].line === 7, `칸·줄 번호(${JSON.stringify(mk[0].f['번역'])} · ${mk[0].line}줄)`);
    const m2 = SC.markersOf('### a\n> 📜 화면카드: 병기 | 원문=天下大勢分久必合 +1 | 번역＝천하의 큰 흐름 ＋2\n```\n> 📜 화면카드: 막간 | 문장=울타리 안\n```\n<!--\n> 📜 화면카드: 막간 | 문장=주석 안 줄\n-->\n> 📜 화면카드: 막간 | 문장=보이는 줄 입니다');
    ok(m2.length === 2 && m2[0].f['원문'].extra === 1 && m2[0].f['번역'].extra === 2 && m2[0].f['번역'].text === '천하의 큰 흐름', '`+N` · 전각 ＋ · 전각 ＝ 도 읽는다');
    ok(m2.length === 2 && m2[1].f['문장'].text === '보이는 줄 입니다', '코드 울타리·HTML 주석 안의 줄은 건너뛴다');
    ok(SC.markersOf('# t\n> 🖼️ 이미지: x\n본문\n').length === 0 && SC.markersOf('').length === 0 && SC.markersOf(null).length === 0, '카드 줄이 없으면 빈 목록(기본값)');
    ok(SC.markersOf('> 📜 화면카드: 모르는종류 | 문장=가나다라마')[0].kind === null, '모르는 종류는 kind=null(계획 단계에서 경고)');
    // 🔑 이 줄을 옛/현재 문장 분할기가 낭독으로 읽지 않는다(`>` 주석) · 이미지/영상 프롬프트로도 안 읽힌다
    const proj = P.parseScriptText(SCRIPT, 'longform', {}).projects[0];
    ok(proj.sentences.every((s) => !/화면카드|📜/.test(s.text)) && proj.sentences.length === 5, `카드 줄은 낭독 문장이 아니다(문장 ${proj.sentences.length}개)`);
    ok(proj.groups.every((g) => !/화면카드/.test(g.imagePrompt || '') && !/화면카드/.test(g.videoPrompt || '')), '그림·영상 프롬프트로도 안 읽힌다');
    ok(Array.isArray(proj.screenCards) && proj.screenCards.length === 2, '파서가 프로젝트에 마커를 단다(screenCards)');
    ok(P.parseScriptText(SCRIPT.split('\n').filter((l) => !/화면카드/.test(l)).join('\n'), 'longform', {}).projects[0].screenCards === undefined, '마커가 없으면 필드도 없다(예전과 같다)');
  }

  console.log('\n[2] 계획 — 문장 찾기 · 시각 · 경고');
  const mkProj = (sents, groups, durs) => {
    const ss = sents.map((t, i) => ({ id: 's' + i, text: t, ttsAudioPath: durs && durs[i] === 0 ? null : 'x.mp3', ttsDurationSec: durs ? durs[i] : 6 }));
    let k = 0; const gs = groups.map((g) => ({ phase: g.phase, sentenceIds: g.n.map(() => 's' + (k++)) }));
    return { sentences: ss, groups: gs };
  };
  {
    const pj = mkProj(['天下大勢，分久必合，合久必分。', '천하의 큰 흐름은 나뉜 지 오래되면 합쳐집니다.', '이야기는 시작합니다.', '제1회, 도원결의.', '본문입니다.'], [{ phase: '서술의 이름', n: [0, 1, 2] }, { phase: '푸른 뱀', n: [3, 4] }], [6, 7, 5, 3, 4]);
    let r = SC.plan(pj, SC.markersOf('### 서술의 이름\n> 📜 화면카드: 병기 | 원문=天下大勢分久必合 | 번역=천하의 큰 흐름\n'));
    ok(r.cards.length === 1 && r.warnings.length === 0, '병기 카드 하나 · 경고 없음');
    ok(r.cards[0].t0 === 0 && r.cards[0].t1 === 13 && r.cards[0].orig[0] === pj.sentences[0].text && r.cards[0].trans[0] === pj.sentences[1].text, `🔑 시각 0~13초 · 글자 = 그 문장 그대로(${r.cards[0].t0}~${r.cards[0].t1})`);
    r = SC.plan(pj, SC.markersOf('### 푸른 뱀\n> 📜 화면카드: 막간 | 문장=제1회 도원결의'));
    ok(r.cards.length === 1 && r.cards[0].kind === 'interlude' && r.cards[0].t0 === 18 && r.cards[0].t1 === 21 && r.cards[0].trans[0] === '제1회, 도원결의.', `막간: 3초 문장(18~21초) · 글자 그대로`);
    r = SC.plan(pj, SC.markersOf('> 📜 화면카드: 병기 | 원문=天下大勢分久必合 +1 | 번역=이야기는 시작'));
    ok(r.cards.length === 1 && r.cards[0].orig.length === 2 && r.cards[0].t1 === 18, '+1 = 그 문장 뒤로 한 문장 더(원문 두 줄)');
    const w = (txt) => SC.plan(pj, SC.markersOf(txt)).warnings.join(' / ');
    ok(/찾지 못/.test(w('> 📜 화면카드: 막간 | 문장=없는문장입니다')), '못 찾으면 경고(조용히 장면을 줄이지 않는다)');
    ok(/너무 짧/.test(w('> 📜 화면카드: 막간 | 문장=제1회')), '앞부분이 4글자 미만이면 경고');
    ok(/종류/.test(w('> 📜 화면카드: 모르는 | 문장=제1회도원결의')), '모르는 종류는 경고');
    ok(/칸이 없/.test(w('> 📜 화면카드: 병기 | 원문=天下大勢分久必合')), '번역= 칸이 없으면 경고');
    ok(/뒤로 5문장/.test(w('> 📜 화면카드: 막간 | 문장=제1회 도원결의 +5')), '+N 이 대본 끝을 넘으면 경고');
    const dup = mkProj(['같은 시작 문장입니다 하나.', '같은 시작 문장입니다 둘.'], [{ phase: 'a', n: [0, 1] }]);
    ok(/2개 맞/.test(SC.plan(dup, SC.markersOf('### a\n> 📜 화면카드: 막간 | 문장=같은 시작 문장입니다')).warnings.join('')), '둘 이상 맞으면 경고(앞부분을 더 길게)');
    ok(SC.plan(dup, SC.markersOf('### a\n> 📜 화면카드: 막간 | 문장=같은 시작 문장입니다 둘')).cards.length === 1, '앞부분을 길게 쓰면 하나로 정해진다');
    const noAudio = mkProj(['소리 없는 문장입니다 하나.'], [{ phase: 'a', n: [0] }], [0]);
    ok(/음성이 없는/.test(SC.plan(noAudio, SC.markersOf('> 📜 화면카드: 막간 | 문장=소리 없는 문장')).warnings.join('')), '음성이 없는 문장은 경고(시각을 모른다)');
    const two = SC.plan(pj, SC.markersOf('> 📜 화면카드: 막간 | 문장=이야기는 시작\n> 📜 화면카드: 막간 | 문장=이야기는 시작합니다'));
    ok(two.cards.length === 2 && /겹칩니다/.test(two.warnings.join('')), '시간이 겹치는 카드는 경고(둘 다 그린다)');
    ok(SC.plan(pj, []).cards.length === 0 && SC.plan(pj, null).warnings.length === 0, '마커가 없으면 계획도 비어 있다');
    // 그룹 이름이 안 맞아도(분할 방식) 대본 전체에서 찾는다
    ok(SC.plan(pj, SC.markersOf('### 다른이름\n> 📜 화면카드: 막간 | 문장=이야기는 시작')).cards.length === 1, '제목이 안 맞으면 대본 전체에서 찾는다');
  }

  console.log('\n[2b] 🅱 글자를 직접 적는 꼴 — 때=(시간 앵커) + 원문·번역·제목 = 적은 글 그대로 (v0.7.99)');
  {
    const pj = mkProj(['이 번역은 서술에서 인물을 부릅니다.', '유비 관우 장비 조조처럼 부릅니다.', '제1회, 도원결의.', '본문입니다 하나.'], [{ phase: '서술의 이름', n: [0, 1] }, { phase: '푸른 뱀', n: [2, 3] }], [6, 5, 4, 7]);
    let r = SC.plan(pj, SC.markersOf('### 서술의 이름\n> 📜 화면카드: 병기 | 때=이 번역은 서술에서 +1 | 원문=玄德曰：「然。」 // 二行目 | 번역=현덕이 말했다. // 둘째 줄'));
    const c = r.cards[0];
    ok(r.cards.length === 1 && r.warnings.length === 0 && c.literal === true, '때= 꼴: 카드 하나 · 경고 없음');
    ok(c.t0 === 0 && c.t1 === 11, `시간은 때 문장들이 읽히는 시간(0~11초 — +1 = 두 문장)`);
    ok(c.orig.join('|') === '玄德曰：「然。」|二行目' && c.trans.join('|') === '현덕이 말했다.|둘째 줄', '🔑 글자는 적은 그대로 · 「 // 」 는 줄바꿈 · 낭독 문장 글이 아니다');
    r = SC.plan(pj, SC.markersOf('### 서술의 이름\n> 📜 화면카드: 병기 | 때=이 번역은 서술에서 | 원문=玄德曰'));
    ok(r.cards.length === 1 && r.cards[0].orig[0] === '玄德曰' && r.cards[0].trans[0] === pj.sentences[0].text, '번역= 을 빼면 때 문장의 자막 글을 쓴다(일치 보장 모드)');
    r = SC.plan(pj, SC.markersOf('> 📜 화면카드: 막간 | 때=제1회 도원결의 | 제목=제1회 · 도원결의'));
    ok(r.cards.length === 1 && r.cards[0].kind === 'interlude' && r.cards[0].trans[0] === '제1회 · 도원결의' && r.cards[0].t0 === 11 && r.cards[0].t1 === 15, '막간: 제목= 글 그대로 · 때 문장 시간(11~15초)');
    r = SC.plan(pj, SC.markersOf('> 📜 화면카드: 막간 | 때=제1회 도원결의'));
    ok(r.cards[0].trans[0] === '제1회, 도원결의.', '제목= 을 빼면 때 문장의 자막 글');
    const w = (txt) => SC.plan(pj, SC.markersOf(txt)).warnings.join(' / ');
    ok(/찾지 못/.test(w('> 📜 화면카드: 막간 | 때=없는문장입니다 | 제목=가')), '때= 못 찾으면 경고');
    ok(/짧/.test(w('> 📜 화면카드: 막간 | 때=제1회 | 제목=가')), '때= 앞부분이 짧으면 경고');
    ok(/때=/.test(w('> 📜 화면카드: 막간 | 제목=제1회 도원결의')), '때= 없이 제목= 만 쓰면 경고');
    ok(/뒤로 9문장/.test(w('> 📜 화면카드: 막간 | 때=제1회 도원결의 +9 | 제목=가')), '때= 의 +N 이 대본 끝을 넘으면 경고');
    ok(/3줄을 넘/.test(w('> 📜 화면카드: 병기 | 때=제1회 도원결의 | 원문=가 // 나 // 다 // 라')), '글이 3줄을 넘으면 경고(그래도 카드는 만든다)');
    ok(SC.plan(pj, SC.markersOf('> 📜 화면카드: 병기 | 때=제1회 도원결의 | 원문=가 // 나 // 다 // 라')).cards.length === 1, '3줄 경고는 카드를 막지 않는다');
    ok(SC.plan(pj, SC.markersOf('> 📜 화면카드: 막간 | 문장=제1회 도원결의')).cards[0].literal === undefined, '옛 꼴(원문=/문장=)은 그대로 동작한다');
  }

  console.log('\n[2c] 🙈 자막=숨김 — 카드마다 고른다(기본 안 가림 · v0.8.0)');
  {
    const pj = mkProj(['이 번역은 서술에서 인물을 부릅니다.', '유비 관우 장비 조조처럼 부릅니다.', '제1회, 도원결의.'], [{ phase: 'a', n: [0, 1, 2] }], [6, 5, 4]);
    let r = SC.plan(pj, SC.markersOf('> 📜 화면카드: 병기 | 때=이 번역은 서술에서 | 원문=玄德 | 번역=현덕 | 자막=숨김\n> 📜 화면카드: 막간 | 때=제1회 도원결의 | 제목=제1회'));
    ok(r.cards.length === 2 && r.cards[0].hideCaptions === true && r.cards[1].hideCaptions === undefined && r.warnings.length === 0, '자막=숨김 이 있는 카드만 hideCaptions · 없으면 필드도 없다(기본 안 가림)');
    r = SC.plan(pj, SC.markersOf('> 📜 화면카드: 막간 | 문장=제1회 도원결의 | 자막=숨김'));
    ok(r.cards[0].hideCaptions === true, '옛 꼴(문장=)에서도 된다');
    r = SC.plan(pj, SC.markersOf('> 📜 화면카드: 막간 | 때=제1회 도원결의 | 제목=가 | 자막=가끔'));
    ok(r.cards.length === 1 && r.cards[0].hideCaptions === undefined && /자막= 값은/.test(r.warnings.join('')), '모르는 값은 경고하고 자막은 그대로(카드는 만든다)');
    ok(JSON.stringify(SC.signatureOf(SC.markersOf('> 📜 화면카드: 막간 | 문장=제1회 도원결의'))) !== JSON.stringify(SC.signatureOf(SC.markersOf('> 📜 화면카드: 막간 | 문장=제1회 도원결의 | 자막=숨김'))), '자막=숨김 을 바꾸면 지문이 달라진다(MP4 를 다시 굽는다)');
  }

  console.log('\n[3] 곡선 · ASS — 창 경계에서 번쩍이지 않는다');
  {
    const c = { kind: 'pair', t0: 10, t1: 22, orig: ['天下大勢'], trans: ['천하의 큰 흐름'], line: 1 };   // fade 1.5
    ok(SC.fadeOf(c) === 1.5 && SC.fadeOf({ t0: 0, t1: 2 }) === 0.5 && SC.fadeOf({ t0: 0, t1: 1 }) === 0.3, '서서히 = 구간의 1/4(최대 1.5초 · 최소 0.3초)');
    ok(SC.opacityAt(c, 9) === 0 && SC.opacityAt(c, 10.75) === 0.5 && SC.opacityAt(c, 16) === 1 && Math.abs(SC.opacityAt(c, 21.25) - 0.5) < 1e-9 && SC.opacityAt(c, 23) === 0, '곡선: 0 → 1(1.5초) · 유지 · 1 → 0');
    const lines = R.cardEvents([c], 8, 12);   // 창 8~12 — 나타나는 중
    ok(lines.length >= 4 && lines.every((l) => /^Dialogue: [089],/.test(l)), `창 안에 걸치면 판 1 + 글자 줄(${lines.length}줄)`);
    ok(/\\p1\}m 0 0 l 1920 0 1920 1080 0 1080/.test(lines[0]) && /^Dialogue: 0,/.test(lines[0]), '어두운 판 = 화면 전체 벡터 사각형 · 층 0(자막 층 1~4 아래)');
    ok(lines.slice(1).some((l) => /^Dialogue: 8,/.test(l) && /Noto Serif CJK KR Light Hanja/.test(l) && /天下大勢/.test(l)) && lines.some((l) => /Noto Serif KR Light/.test(l) && /천하의 큰 흐름/.test(l)), '원문 = 한자 글꼴 · 번역 = 한글 명조');
    ok(R.cardEvents([c], 0, 5).length === 0 && R.cardEvents([c], 23, 30).length === 0 && R.cardEvents(null, 0, 5).length === 0, '창 밖이면 이벤트가 없다');
    // 이음새 — 같은 카드를 8~10·10~12 두 창으로 자르면 첫 알파가 이어진다(10초 시점의 알파 = 직전 창의 끝 알파)
    const a1 = /\\1a&HFF&\\t\(0,1500,\\1a&H([0-9A-F]{2})&\)/.exec(R.cardEvents([c], 9, 12)[0]);   // 9~12 창: 10초부터 1.5초 동안 나타남
    ok(!!a1, `나타나는 곡선이 투명(FF) → 판 불투명도(${a1 && a1[1]})로 \\t 램프가 된다`);
    const w1 = R.cardEvents([c], 8, 11.5)[0], w2 = R.cardEvents([c], 11.5, 15)[0];
    const endA = /\\t\(\d+,\d+,\\1a&H([0-9A-F]{2})&\)/.exec(w1), startA = /\\1a&H([0-9A-F]{2})&/.exec(w2);
    ok(endA && startA && Math.abs(parseInt(endA[1], 16) - parseInt(startA[1], 16)) <= 3, `창 경계(11.5초)에서 판의 알파가 이어진다(앞 창 끝 ${endA && endA[1]} · 뒷 창 시작 ${startA && startA[1]})`);
    // 기본 = 예전과 같다: 카드 줄이 없으면 ASS 글이 한 글자도 안 달라진다
    const cs = { font: 'Pretendard', size: 54, bold: true }; let a = null, b = null;
    try { a = R.buildAss([], [], cs, { eventLines: [], layout: R.layoutFor(cs) }); b = R.buildAss([], [], cs, { eventLines: [], layout: R.layoutFor(cs), cardLines: null }); } catch (e) { a = 'x'; b = 'y'; console.log(e.message); }
    ok(a === b, '카드 줄이 없으면 ASS 가 예전과 같다');
  }

  console.log('\n[4] 실제 MP4 — 어두운 판 · 서서히 · 끝나면 그대로 · 길이 불변');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-'));
  try {
    const img = path.join(tmp, 'g.png');   // 밝고 색이 있는 그림(어두운 판이 눈에 띄게)
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080', '-frames:v', '1', img]);
    const proj = P.parseScriptText(SCRIPT, 'longform', {}).projects[0];
    proj.groups[0].imagePath = img; proj.groups[1].imagePath = img;
    proj.sentences.forEach((s, i) => { const mp3 = path.join(tmp, `s${i}.mp3`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '6', '-c:a', 'libmp3lame', mp3]); s.ttsAudioPath = mp3; s.ttsDurationSec = 6; });
    const vrew = path.join(tmp, 'a.vrew'); await P.buildProjectVrew(proj, vrew, {}, () => {}, 20, 1);
    const plan = SC.plan(proj, proj.screenCards);
    ok(plan.cards.length === 2 && plan.warnings.length === 0, `대본 마커 → 카드 2장(경고 ${plan.warnings.length}) · ${plan.cards.map((c) => c.kind + ' ' + c.t0 + '~' + c.t1).join(' · ')}`);
    const bake = async (name, o) => { const mp4 = path.join(tmp, name + '.mp4'); const t0 = Date.now(); const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 2, chunkSec: 4, ...o }); if (!res || !res.ok) throw new Error('렌더 실패 ' + name + ' ' + JSON.stringify(res)); return { mp4, sec: (Date.now() - t0) / 1000 }; };
    const base = await bake('base', {}), withC = await bake('cards', { cards: plan.cards }), none = await bake('none', { cards: [] });
    const dur = (f) => { try { execFileSync(FF, ['-hide_banner', '-i', f], { stdio: 'pipe' }); } catch (e) { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(e.stderr)); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0; } };
    const raw = (f, t, vf = 'scale=192:108') => execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', vf + ',format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    const mean = (b) => { let s = 0; for (const v of b) s += v; return s / b.length; };
    const dif = (a, b) => { let x = 0; for (let i = 0; i < a.length; i++) x += Math.abs(a[i] - b[i]); return x / a.length; };
    const bright = (b, thr) => { let n = 0; for (const v of b) if (v > thr) n++; return n; };
    ok(Math.abs(dur(base.mp4) - dur(withC.mp4)) < 0.1 && Math.abs(dur(base.mp4) - 30) < 0.15, `영상 길이 그대로(기본 ${dur(base.mp4).toFixed(2)} · 카드 ${dur(withC.mp4).toFixed(2)}초)`);
    ok(dif(raw(base.mp4, 5), raw(none.mp4, 5)) < 0.01 && dif(raw(base.mp4, 25), raw(none.mp4, 25)) < 0.01, '카드가 빈 목록이면 예전 결과와 같다(화소 차 0)');
    const mB = mean(raw(base.mp4, 5)), mC = mean(raw(withC.mp4, 5));
    ok(mC < mB * 0.35, `🔑 카드가 뜨는 동안(5초) 화면이 어둡다(밝기 ${mB.toFixed(0)} → ${mC.toFixed(0)})`);
    ok(bright(raw(withC.mp4, 5, 'scale=480:270'), 150) > 300, '카드 글자(밝은 글씨)가 보인다');
    const m01 = mean(raw(withC.mp4, 0.15)), m15 = mean(raw(withC.mp4, 0.75)), m3 = mean(raw(withC.mp4, 3));
    ok(m01 > m15 && m15 > m3 && m01 > mB * 0.85, `서서히 어두워진다(0.15초 ${m01.toFixed(0)} › 0.75초 ${m15.toFixed(0)} › 3초 ${m3.toFixed(0)} · 시작은 그림 그대로)`);
    const mo = mean(raw(withC.mp4, 11.25)), mo2 = mean(raw(withC.mp4, 11.85));
    ok(mo < mo2 && Math.abs(mean(raw(withC.mp4, 14)) - mean(raw(base.mp4, 14))) < 1.5, `끝나면 서서히 그림으로 돌아오고(${mo.toFixed(0)} → ${mo2.toFixed(0)}) 카드 뒤(14초)는 예전과 같다`);
    ok(dif(raw(withC.mp4, 14), raw(base.mp4, 14)) < 1.0 && dif(raw(withC.mp4, 27), raw(base.mp4, 27)) < 1.0, `카드가 없는 구간은 화소가 예전과 같다(14초 ${dif(raw(withC.mp4, 14), raw(base.mp4, 14)).toFixed(2)} · 27초 ${dif(raw(withC.mp4, 27), raw(base.mp4, 27)).toFixed(2)})`);
    ok(mean(raw(withC.mp4, 21)) < mB * 0.35, `막간 카드(18~24초)도 어둡다(21초 ${mean(raw(withC.mp4, 21)).toFixed(0)})`);
    // 🙈 자막=숨김 — 첫 카드(0~12초)만 숨김: 그 동안 하얀 자막이 사라지고, 둘째 카드(18~24초)·카드 밖은 그대로
    const hid = await bake('hide', { cards: plan.cards.map((c, i) => (i === 0 ? { ...c, hideCaptions: true } : c)) });
    const whites = (f, t) => bright(raw(f, t, 'scale=960:540'), 240);
    const wC = whites(withC.mp4, 5), wH = whites(hid.mp4, 5), wC2 = whites(withC.mp4, 21), wH2 = whites(hid.mp4, 21);
    ok(wC > 150 && wH < wC * 0.1, `🙈 자막=숨김 카드에서는 하얀 자막이 사라진다(5초 하얀 화소 ${wC} → ${wH})`);
    ok(Math.abs(wH2 - wC2) <= 5, `숨김이 없는 둘째 카드(21초)는 자막이 그대로다(${wC2} · ${wH2})`);
    ok(dif(raw(hid.mp4, 14), raw(withC.mp4, 14)) < 0.05 && dif(raw(hid.mp4, 27), raw(withC.mp4, 27)) < 0.05, '카드 밖(14·27초)은 숨김 여부와 상관없이 같다');
    // 조각 이음새(4초 · 8초 조각 경계) — 이웃 프레임 차이가 카드 없는 같은 경계와 비슷하다(판이 번쩍이지 않는다)
    const seq = (f, t0) => { const o = []; let prev = raw(f, t0); for (let k = 1; k <= 6; k++) { const c = raw(f, t0 + k * 0.04); o.push(dif(prev, c)); prev = c; } return o; };
    const s4 = seq(withC.mp4, 3.88), b4 = seq(base.mp4, 3.88), s8 = seq(withC.mp4, 7.88);
    console.log('   경계(4초)', s4.map((x) => x.toFixed(2)).join(' '), '| 카드 없는 같은 경계', b4.map((x) => x.toFixed(2)).join(' '), '| 경계(8초)', s8.map((x) => x.toFixed(2)).join(' '));
    ok(Math.max(...s4, ...s8) < Math.max(2.5, Math.max(...b4) + 2), `조각 경계(4·8초)에서 판이 번쩍이지 않는다(최대 ${Math.max(...s4, ...s8).toFixed(2)})`);
    console.log(`   렌더 시간(30초 영상 · 조각 4초): 기본 ${base.sec.toFixed(1)}s · 카드 2장 ${withC.sec.toFixed(1)}s`);
    // 눈으로 보는 증거 — 프레임 저장(PM_SHOT_DIR)
    if (process.env.PM_SHOT_DIR) {
      fs.mkdirSync(process.env.PM_SHOT_DIR, { recursive: true });
      for (const [t, nm] of [[1, 'fade1s'], [6, 'pair6s'], [21, 'interlude21s'], [14, 'after14s']]) spawnSync(FF, ['-y', '-v', 'error', '-ss', String(t), '-i', withC.mp4, '-frames:v', '1', path.join(process.env.PM_SHOT_DIR, nm + '.png')]);
      spawnSync(FF, ['-y', '-v', 'error', '-ss', '6', '-i', base.mp4, '-frames:v', '1', path.join(process.env.PM_SHOT_DIR, 'base6s.png')]);
      fs.copyFileSync(withC.mp4, path.join(process.env.PM_SHOT_DIR, 'cards_sample.mp4'));
    }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }

  console.log('\n[5] 지문 · 기본값');
  {
    const pj = P.parseScriptText(SCRIPT, 'longform', {}).projects[0];
    const none = P.parseScriptText(SCRIPT.split('\n').filter((l) => !/화면카드/.test(l)).join('\n'), 'longform', {}).projects[0];
    const a = P.vrewInputsOf(pj, null, 20), b = P.vrewInputsOf(none, null, 20);
    ok(Array.isArray(a.cards) && a.cards.length === 2 && !('cards' in b), '지문: 마커가 있으면 cards 가 들어가고, 없으면 키 자체가 없다(예전 지문과 같다)');
    const pj2 = P.parseScriptText(SCRIPT.replace('+0', '+1'), 'longform', {}).projects[0];
    ok(JSON.stringify(P.vrewInputsOf(pj2, null, 20).cards) !== JSON.stringify(a.cards), '마커를 바꾸면 지문이 달라진다(MP4 를 다시 굽는다)');
    const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    ok(/cards: cardsOptsFor\(pr\)/.test(M) && /function cardsOptsFor/.test(M) && /screenCards = _mk|proj\.screenCards = screenCards/.test(M), 'main: MP4 렌더에 카드를 넘기고 · 작업본 이어받기에서도 마커를 .md 에서 다시 읽는다');
  }
  console.log(`\n${fail ? '❌' : '✅'} screen-cards ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 오류:', e); process.exit(1); });
