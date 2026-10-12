'use strict';
/**
 * node test/info-cards.test.js — 📇 정보 카드(정보튜브 · v0.8.2)
 *   [1] 표시 줄 읽기 [2] 분할기 연동(낭독·자막·그룹·프롬프트 불변 · 「이미지:」 낱말 함정 차단) [3] 판 계획(시각·겹침·누적·경고)
 *   [4] 배치·ASS(글자 66px+ · 표 칸 · 창 경계 이음) [5] 실제 MP4(판이 보인다 · 표에서 자막 숨김 · 판 밖 화면은 예전과 같다) [6] 지문·기본값
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, spawnSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const IC = require('../core/info-cards');
const SS = require('../core/sentence-splitter');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const IA = require('../core/info-ass');
const FF = require('../core/media-utils').getFfmpegPath();

const SCRIPT = [
  '# 정보 시험', '',
  '## 도입부', '',
  '### 식탁', '> 🖼️ 이미지: a kitchen', '',
  '어머님이 봉투를 내려놓으십니다.', '',
  '## 1장 — 내 자리는 어디일까?', '',
  '### 세 갈래', '> 🖼️ 이미지: a living room', '> 🎬 비디오(I2V): slow push-in', '',
  '> 🔤 카드: 지역가입자 | 임의계속가입 | 피부양자',
  '퇴직을 하면 건강보험 자격이 바뀝니다. 곧바로 다른 곳에 들어가면 다릅니다.', '',
  '> 📊 표: 퇴직 뒤 내 자리는 어디일까? 영상 이미지: 낱말',
  '> | 구분 | 지역가입자 | 임의계속가입 |',
  '> | 기준 | 소득 + 재산 | 퇴직 전 12개월 보수 |',
  '> 📊 출처: 국민건강보험공단',
  '두 번째는 임의계속가입입니다. 날짜가 있습니다.', '',
  '> ✅ 확인: 내 자리 확인',
  '그런데 날짜를 꼭 지키셔야 합니다.', '',
  '## 2장 — 왜 달라질까?', '',
  '### 질문', '> 🖼️ 이미지: a memo', '',
  '> ✅ 확인: 고지서 금액 읽기',
  '질문을 적어 둔 메모를 펼칩니다.', '',
  '## 마무리', '',
  '### 저녁', '> 🖼️ 이미지: dinner', '',
  '오늘 말씀드린 것을 정리했습니다.', '',
].join('\n');

(async () => {
  console.log('[1] 표시 줄 읽기');
  {
    let k = IC.lineKind('> 🔤 카드: 가 | 나나 | 다', null);
    ok(k && k.mark.kind === 'words' && k.mark.words.join(',') === '가,나나,다' && !k.mark.clear, '🔤 낱말 1~3개');
    ok(IC.lineKind('> 🔤 카드: -', null).mark.clear && IC.lineKind('> 🔤 카드:', null).mark.clear && IC.lineKind('> 🔤 카드: 끄기', null).mark.clear, '🔤 카드: - / 빈칸 / 끄기 = 끄기');
    k = IC.lineKind('> 📊 표: 제목', null);
    ok(k.mark.kind === 'table' && k.opensTable && k.mark.title === '제목', '📊 표 제목 — 표가 열린다');
    const open = k.mark;
    ok(IC.lineKind('> | a | b |', open).rowText.join(',') === 'a,b' && IC.lineKind('> | a | b |', null) === null, '표 줄(> |)은 표가 열려 있을 때만 행으로');
    ok(IC.lineKind('> | --- | --- |', open).rowText === null, '구분선 줄은 건너뛴다');
    ok(IC.lineKind('> 📊 출처: 공단', open).sourceText === '공단' && IC.lineKind('> ✅ 확인: 내 자리', null).mark.text === '내 자리', '출처 · ✅ 확인');
    ok(IC.lineKind('> 🖼️ 이미지: x', null) === null && IC.lineKind('본문입니다', null) === null && IC.lineKind('> 📝 메모', null) === null, '다른 줄은 건드리지 않는다');
  }

  console.log('\n[2] 분할기 연동 — 낭독·자막·그룹·프롬프트는 마커가 있어도 같다');
  {
    const withM = P.parseScriptText(SCRIPT, 'longform', {}).projects[0];
    const plain = P.parseScriptText(SCRIPT.split('\n').filter((l) => !/^\s*>\s*(🔤|📊|✅|\|)/.test(l)).join('\n'), 'longform', {}).projects[0];
    ok(withM.sentences.length === plain.sentences.length && withM.groups.length === plain.groups.length && withM.sentences.every((s, i) => s.text === plain.sentences[i].text), `문장 ${withM.sentences.length}=${plain.sentences.length} · 그룹 ${withM.groups.length}=${plain.groups.length} · 문장 글 동일`);
    ok(withM.groups.every((g, i) => g.imagePrompt === plain.groups[i].imagePrompt && g.videoPrompt === plain.groups[i].videoPrompt), '그림·영상 프롬프트 동일(표 제목에 「영상 이미지:」 낱말이 있어도)');
    ok(withM.sentences.every((s) => !/카드|표:|확인|출처|\|/.test(s.text)), '표시 줄이 낭독 문장에 섞이지 않는다');
    ok(Array.isArray(withM.infoMarks) && withM.infoMarks.length === 4 && plain.infoMarks === undefined, '파서가 표시 줄 서명을 단다(4개) · 없으면 필드도 없다');
    const trap = P.parseScriptText('# t\n## 가\n### a\n> 🖼️ 이미지: real prompt\n> 🔤 카드: 영상 자료: 이미지: 보험료\n\n본문입니다.\n', 'longform', {}).projects[0];
    ok(trap.groups[0].imagePrompt === 'real prompt', '🔑 「이미지:」 낱말이 든 🔤 줄이 그림 프롬프트를 덮어쓰지 않는다(옛 파서 함정)');
  }

  console.log('\n[3] 판 계획');
  const mk = () => {
    const proj = P.parseScriptText(SCRIPT, 'longform', {}).projects[0];
    proj.sentences.forEach((s) => { s.ttsAudioPath = 'x.mp3'; s.ttsDurationSec = 6; });   // 문장마다 6초
    return proj;
  };
  const parsed = IC.fromRaw(SCRIPT);
  {
    const pj = mk();
    ok(parsed.texts.length === pj.sentences.length && parsed.marks.length === 4 && parsed.sections.length === 4, `재료: 문장 ${parsed.texts.length} · 표시 ${parsed.marks.length} · 구간 ${parsed.sections.length}`);
    const { panels, warnings } = IC.plan(pj, parsed, { sections: true });
    const by = (ty) => panels.filter((p) => p.type === ty);
    ok(warnings.length === 0, `경고 없음(${warnings.join(' / ')})`);
    ok(by('cover').length === 3 && by('cover')[0].n === 1 && by('cover')[0].m === 2 && !by('cover')[0].closing && by('cover')[2].closing === true && /^마무리/.test(by('cover')[2].title), '구간 표지: 도입부 제외 · 「N / M」(마무리는 번호 없이 이름만 · 막대 꽉 참)');
    ok(by('cover').every((c) => c.hideCaptions === true && Math.abs((c.t1 - c.t0) - 3.5) < 1e-6), '구간 표지 3.5초 · 그동안 자막 가림');
    ok(by('cover')[0].title === '내 자리는 어디일까?', '구간 이름은 「1장 —」 번호를 뗀다');
    const tb = by('table')[0];
    ok(tb && tb.hideCaptions === true && tb.rows.length === 2 && tb.source === '국민건강보험공단' && tb.t1 - tb.t0 >= 6 - 1e-6, '표: 머리+1행 · 출처 · 전체 화면(자막 가림) · 최소 6초');
    ok(by('check').length === 2 && by('check')[0].list.join() === '내 자리 확인' && by('check')[1].list.join() === '내 자리 확인,고지서 금액 읽기', '✅ 확인표는 영상 전체에서 쌓인다(구간마다 초기화 안 함)');
    const wd = by('words')[0];
    ok(wd && wd.words.length === 3 && wd.t0 === by('cover')[0].t1 || wd, '🔤 낱말 카드 — 다음 낭독 문단부터');
  }
  {
    // 겹침 순서 — 표 > 구간 표지 > 확인표 > 낱말 카드(낱말은 표·표지·확인표가 뜬 동안 숨었다 돌아온다)
    const pj = mk();
    const { panels } = IC.plan(pj, parsed, { sections: true });
    const words = panels.filter((p) => p.type === 'words'), cover1 = panels.filter((p) => p.type === 'cover')[0], table = panels.filter((p) => p.type === 'table')[0];
    ok(words.every((w) => !(w.t0 < table.t1 && w.t1 > table.t0)) && words.every((w) => !(w.t0 < cover1.t1 - 1e-6 && w.t1 > cover1.t0 + 1e-6)), '낱말 카드는 표·구간 표지가 뜬 동안 보이지 않는다');
    ok(panels.every((p) => p.type !== 'cover' || !(p.t0 < table.t1 && p.t1 > table.t0)) , '구간 표지도 표가 뜬 동안은 숨는다');
    const off = IC.plan(pj, parsed, { sections: false });
    ok(off.panels.every((p) => p.type !== 'cover') && off.panels.length > 0, '구간 표지는 채널 옵션이 꺼지면 안 만든다(표시 줄 판은 그대로)');
    ok(IC.plan(pj, IC.fromRaw('# t\n## a\n### b\n본문입니다.\n'), { sections: false }).panels.length === 0, '표시 줄이 없고 표지도 꺼져 있으면 빈 계획(예전과 같다)');
  }
  {
    // 경고 — 조용히 줄이지 않는다
    const pj = mk(); pj.sentences.pop();   // 작업본에서 문장 하나가 빠졌다 → 대본과 불일치
    const r = IC.plan(pj, parsed, { sections: true });
    ok(r.panels.length === 0 && /문장 .*≠.*문장/.test(r.warnings.join('')), '대본과 작업본의 문장 수가 다르면 ⚠ 후 전부 건너뛴다(조용히 틀리지 않는다)');
    const pj2 = mk(); pj2.sentences[3].text = '전혀 다른 문장입니다 정말로.';
    const r2 = IC.plan(pj2, parsed, { sections: false });
    ok(/글이 다른 곳 1개/.test(r2.warnings.join('')), '문장 글이 다른 자리는 ⚠ (그 자리만 건너뜀)');
    const long = IC.plan(mk(), IC.fromRaw(SCRIPT.replace('> ✅ 확인: 내 자리 확인', '> ✅ 확인: 이 문구는 열네 글자를 훨씬 넘기는 아주 긴 문구입니다')), { sections: false });
    ok(/권장 14자/.test(long.warnings.join('')), '✅ 문구가 14자를 넘으면 ⚠ (줄바꿈하지 않고 그대로)');
    const four = IC.plan(mk(), IC.fromRaw(SCRIPT.replace('지역가입자 | 임의계속가입 | 피부양자', 'a가 | b나 | c다 | d라')), { sections: false });
    ok(/낱말 4개/.test(four.warnings.join('')) && four.panels.find((p) => p.type === 'words').words.length === 3, '🔤 낱말이 4개면 ⚠ 후 앞 3개만');
    const noRows = IC.plan(mk(), IC.fromRaw(SCRIPT.replace(/> \| .*\n/g, '')), { sections: false });
    ok(/표 줄/.test(noRows.warnings.join('')), '표 줄(> |)이 없는 📊 표는 ⚠ 후 건너뜀');
  }

  console.log('\n[4] 배치 · ASS');
  {
    const warns = [];
    const words = { type: 'words', t0: 10, t1: 30, words: ['지역가입자', '임의계속가입', '피부양자'] };
    const prims = IA.layoutOf(words, (m) => warns.push(m));
    const texts = prims.filter((q) => q.k === 'text');
    ok(texts.length === 3 && texts.every((q) => q.fs >= 66), `낱말 글자 ≥ 66px(화면 높이 6.1%) — ${texts.map((q) => q.fs).join(',')}`);
    const right = Math.max(...prims.filter((q) => q.k === 'rect').map((q) => q.x + q.w));
    ok(right <= 1880 && Math.min(...prims.filter((q) => q.k === 'rect').map((q) => q.x)) > 960, '낱말·확인표 판은 화면 오른쪽에 고정(1/3~절반 안)');
    const chk = { type: 'check', t0: 0, t1: 9, list: ['가나다라마', '내 자리 확인', '이 문구는 열네 글자를 훨씬 넘기는 아주 아주 긴 문구입니다'], done: 3, all: 3 };
    const cw = []; IA.layoutOf(chk, (m) => cw.push(m));
    ok(cw.some((m) => /판 폭을 넘/.test(m)), '확인표 한 줄이 판 폭을 넘으면 ⚠(줄바꿈하지 않고 그대로)');
    const tbl = { type: 'table', t0: 0, t1: 8, title: '제목', rows: [['구분', '지역가입자', '임의계속가입', '피부양자'], ['보험료 기준', '소득 + 재산', '퇴직 전 12개월 보수', '없음'], ['신청 기한', '자동', '첫 고지서 납부기한 + 2개월', '자녀 직장에서 신고']], source: '공단' };
    const tw = []; const tp = IA.layoutOf(tbl, (m) => tw.push(m));
    const cells = tp.filter((q) => q.k === 'text' && q.layer === 8);
    ok(cells.length >= 12 && Math.min(...cells.filter((q) => q.fs !== 72 && q.fs !== 50).map((q) => q.fs)) >= 66 && tw.length === 0, `표 글자 66px 이상으로 한 화면에 들어간다(${tw.join(' / ') || '경고 없음'})`);
    ok(cells.some((q) => q.lines.join('') === '지역가입자') && !cells.some((q) => q.lines.some((l) => l === '지역가입')), '표 칸에서 낱말(지역가입자)이 한가운데서 끊기지 않는다');
    const big = { type: 'table', t0: 0, t1: 8, title: '큰 표', rows: Array.from({ length: 9 }, (_, r) => ['항목 ' + r, '아주 긴 설명이 한 칸에 들어가는 경우 ' + r, '또 다른 긴 설명입니다 ' + r]), source: '' };
    const bw = []; IA.layoutOf(big, (m) => bw.push(m));
    ok(bw.some((m) => /한 화면에 안 들어가/.test(m)), '너무 큰 표는 ⚠(조용히 넘치지 않는다)');
    // 곡선 — 창 경계에서 이어진다
    const e1 = IA.events([words], 0, 20, 'Pretendard'), e2 = IA.events([words], 20, 40, 'Pretendard');
    ok(e1.length > 0 && e2.length > 0 && IA.events([words], 40, 50, 'Pretendard').length === 0, '창 안에 걸친 판만 이벤트가 된다');
    ok(/\\fnPretendard\\fs66\\b1/.test(e1.join('')), '글자 줄: 글꼴·크기·굵게');
    const a = /\\t\(\d+,\d+,\\1a&H([0-9A-F]{2})&\)/.exec(IA.events([words], 8, 10.25, 'Pretendard')[0]), b = /\\1a&H([0-9A-F]{2})&/.exec(IA.events([words], 10.25, 14, 'Pretendard')[0]);
    ok(a && b && Math.abs(parseInt(a[1], 16) - parseInt(b[1], 16)) <= 3, `창 경계(10.25초)에서 판 알파가 이어진다(앞 창 끝 ${a && a[1]} · 뒷 창 시작 ${b && b[1]})`);
  }

  console.log('\n[5] 실제 MP4');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'info-'));
  try {
    const img = path.join(tmp, 'g.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080', '-frames:v', '1', img]);
    const proj = P.parseScriptText(SCRIPT, 'longform', {}).projects[0];
    proj.groups.forEach((g) => { g.imagePath = img; });
    proj.sentences.forEach((s, i) => { const mp3 = path.join(tmp, `s${i}.mp3`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '6', '-c:a', 'libmp3lame', mp3]); s.ttsAudioPath = mp3; s.ttsDurationSec = 6; });
    const vrew = path.join(tmp, 'a.vrew'); await P.buildProjectVrew(proj, vrew, {}, () => {}, 20, 1);
    const pl = IC.plan(proj, IC.fromRaw(SCRIPT), { sections: true });
    const bake = async (name, o) => { const mp4 = path.join(tmp, name + '.mp4'); const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 2, chunkSec: 5, ...o }); if (!res || !res.ok) throw new Error('렌더 실패 ' + name + ' ' + JSON.stringify(res)); return mp4; };
    const base = await bake('base', {}), withI = await bake('info', { info: pl.panels }), none = await bake('none', { info: [] });
    const raw = (f, t, vf = 'scale=192:108') => execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', vf + ',format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    const dif = (a, b) => { let x = 0; for (let i = 0; i < a.length; i++) x += Math.abs(a[i] - b[i]); return x / a.length; };
    const mean = (b) => { let s = 0; for (const v of b) s += v; return s / b.length; };
    const at = (ty, k = 0) => pl.panels.filter((p) => p.type === ty)[k];
    ok(dif(raw(base, 5), raw(none, 5)) < 0.01 && dif(raw(base, 40), raw(none, 40)) < 0.01, '판이 빈 목록이면 예전 결과와 같다(화소 차 0)');
    const cv = at('cover'), tb = at('table'), wd = at('words'), ck = at('check');
    const tCv = (cv.t0 + cv.t1) / 2, tTb = (tb.t0 + tb.t1) / 2;
    ok(mean(raw(withI, tCv)) < mean(raw(base, tCv)) * 0.5, `구간 표지가 뜨면 화면이 어두워진다(밝기 ${mean(raw(base, tCv)).toFixed(0)} → ${mean(raw(withI, tCv)).toFixed(0)})`);
    ok(mean(raw(withI, tTb)) < mean(raw(base, tTb)) * 0.35, `표가 뜨면 전체 화면이 어두워진다(${mean(raw(base, tTb)).toFixed(0)} → ${mean(raw(withI, tTb)).toFixed(0)})`);
    // 🙈 자막 가림 — 렌더가 만든 ASS(keepTmp)에서 확인: 표(18~30초)·구간 표지(6~9.5초) 안의 자막 이벤트(층 1~4)가 없고, 판 밖에는 있다
    {
      // 조각 시작 시각은 5초 배수가 아니다(장면 경계에 맞춘다) → 조각 번호 대신 「판 있을 때 vs 없을 때」자막 이벤트 총수로 본다
      const keepRun = async (info) => {
        const before = new Set(fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('priming-mp4-')));
        await R.renderVrewToMp4({ vrewPath: vrew, outPath: path.join(tmp, 'keep.mp4'), log: () => {}, par: 2, chunkSec: 5, info, keepTmp: true });
        const dir = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('priming-mp4-') && !before.has(d)).map((d) => path.join(os.tmpdir(), d))[0];
        let n = 0;
        for (const f of fs.readdirSync(dir).filter((x) => /^seg_\d+\.ass$/.test(x))) n += fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => /^Dialogue: [1-4],[^,]*,[^,]*,[BC],/.test(l)).length;
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
        return n;
      };
      const nWith = await keepRun(pl.panels), nWithout = await keepRun(null);
      ok(nWith > 0 && nWith < nWithout, `표·구간 표지가 뜨는 동안 자막 이벤트가 빠진다(판 있음 ${nWith} < 없음 ${nWithout})`);
    }
    // 낱말 카드 — 오른쪽에만 달라지고 왼쪽 화면은 그대로
    const tW = (wd.t0 + wd.t1) / 2;
    const L = (f) => raw(f, tW, 'crop=iw/2:ih:0:0,scale=192:216'), Rr = (f) => raw(f, tW, 'crop=iw/2:ih:iw/2:0,scale=192:216');
    ok(dif(L(base), L(withI)) < 8 && dif(Rr(base), Rr(withI)) > 4 * dif(L(base), L(withI)), `낱말 카드: 오른쪽 절반이 훨씬 크게 달라진다(왼쪽은 좁아진 자막만)(왼쪽 차 ${dif(L(base), L(withI)).toFixed(2)} · 오른쪽 차 ${dif(Rr(base), Rr(withI)).toFixed(2)})`);
    // 판이 없는 구간은 예전과 같다
    const free = Math.max(0.5, pl.panels.reduce((m, p) => Math.min(m, p.t0), 1e9) / 2);   // 첫 판이 뜨기 전(판 없음 · 자막 가림 없음)
    ok(dif(raw(withI, free), raw(base, free)) < 1.0, `판이 뜨기 전(${free.toFixed(1)}초) 화면은 예전과 같다`);
    ok(mean(raw(withI, ck.t0 + 0.05)) > 0 && Math.abs(mean(raw(withI, tW)) - mean(raw(base, tW))) < 25, '낱말 카드는 그림을 가리지 않는다(평균 밝기 변화 작음)');
    if (process.env.PM_SHOT_DIR) {
      fs.mkdirSync(process.env.PM_SHOT_DIR, { recursive: true });
      for (const [t, n] of [[tCv, 'cover'], [tTb, 'table'], [tW, 'words'], [(ck.t0 + ck.t1) / 2, 'check']]) spawnSync(FF, ['-y', '-v', 'error', '-ss', String(t), '-i', withI, '-frames:v', '1', path.join(process.env.PM_SHOT_DIR, n + '.png')]);
    }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }

  console.log('\n[6] 지문 · 채널 옵션 · 기본값');
  {
    const pj = P.parseScriptText(SCRIPT, 'longform', {}).projects[0];
    const off = P.vrewInputsOf(pj, {}, 20), on = P.vrewInputsOf(pj, { infoCards: true }, 20);
    ok(!('infoCards' in off) && !('info' in off) && on.infoCards === true && Array.isArray(on.info) && on.info.length === 4, '지문: 채널 옵션이 꺼지면 키가 없다(예전과 같다) · 켜지면 옵션 + 표시 줄이 들어간다');
    const pj2 = P.parseScriptText(SCRIPT.replace('내 자리 확인', '다른 문구'), 'longform', {}).projects[0];
    ok(JSON.stringify(P.vrewInputsOf(pj2, { infoCards: true }, 20).info) !== JSON.stringify(on.info), '표시 줄 글을 바꾸면 지문이 달라진다(MP4 를 다시 굽는다)');
    const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'), A = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');
    ok(/info: infoOptsFor\(pr, preset, ctx && ctx\.scriptPath\)/.test(M) && /function infoOptsFor/.test(M) && /infoMarks = _sg/.test(M), 'main: MP4 렌더에 정보 카드를 넘기고 · 작업본 이어받기에서도 표시 줄을 .md 에서 다시 읽는다');
    ok(/infoCards: !!ch\.infoCards/.test(A) && /infoCards: !!p\.infoCards/.test(A) && /data-testid="ch-infocards"/.test(A), '채널 편집: 「📇 정보 카드」 칸 · 읽기·저장 두 곳 다');
    const q = IC.signatureOf(IC.fromRaw(SCRIPT)); ok(q.length === 4 && /^표:/.test(q[1]), '서명 = 표시 줄 글 + 문장 위치');
  }
  console.log('\n[7] v0.8.3 — 자막 폭 · 구간 표지 줄바꿈 · 표 칸 너비/세로 가운데');
  {
    // 구간 표지 줄바꿈 — 쉼표 뒤에서, 낱말 가운데는 안 끊는다
    const t1 = '지역가입자 · 임의계속가입 · 피부양자, 내 자리는 어디일까?';
    const w1 = IA.balancedWrap(t1, 84, 1500);
    ok(w1.length === 2 && w1[0] === '지역가입자 · 임의계속가입 · 피부양자,' && w1[1] === '내 자리는 어디일까?', '구간 표지: 쉼표 뒤에서 끊는다(' + w1.join(' / ') + ')');
    ok(IA.balancedWrap('짧은 제목', 84, 1500).length === 1, '구간 표지: 한 줄에 들어가면 그대로');
    const w3 = IA.balancedWrap('가나다라 마바사아 자차카타 파하거너 더러머버 서어저처 커터퍼허 고노도로 모보소오 조초코토', 84, 1500);
    ok(w3.length >= 2 && w3.every((l) => !/^\s|\s$/.test(l)), '구간 표지: 길면 두 줄 이상(공백 가장자리 없음)');
    // 표 — 첫 열·짧은 칸은 한 줄 · 세로 가운데
    const tp = { type: 'table', title: '내 보험료', rows: [['구분', '보험료 기준', '내는 사람'], ['지역가입자', '소득 + 재산', '본인'], ['피부양자', '없음', '면제']], t0: 0, t1: 9 };
    const prim = IA.layoutOf(tp, () => {}), tx = prim.filter((q) => q.k === 'text');
    ok(tx.filter((q) => q.fs >= 66 || q.layer === 8).every((q) => q.lines.length === 1 || q.fs === 72), '표: 짧은 칸(구분·보험료 기준·소득 + 재산)이 한 줄');
    const ys = tx.slice(1).map((q) => q.y), mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    ok(Math.abs(mid - 540) < 140 && ys.every((y) => y > 250), '표: 세로 가운데 쪽에 놓인다(가운데 y ' + Math.round(mid) + ')');
    ok(tx.slice(1).every((q) => q.fs === 66), '표: 글자 66px 유지');
    // v0.8.4 — 이음 기호(+ → ~ ×)는 줄 끝에 홀로 두지 않는다 · 낱말 카드도 균형 줄바꿈
    const bw = IA.balancedWrap('첫 고지서 납부기한 + 2개월', 66, 700);
    ok(bw.length === 2 && !/[+→~×]$/.test(bw[0]) && bw.join(' ') === '첫 고지서 납부기한 + 2개월', '줄바꿈: 「+」 가 줄 끝에 홀로 남지 않는다(' + bw.join(' / ') + ')');
    const bw2 = IA.balancedWrap('가 → 나 → 다라마바사아자차카', 66, 700);
    ok(bw2.every((l) => !/(^|\s)[+→~×]$/.test(l)), '줄바꿈: 「→」 도 줄 끝에 두지 않는다(' + bw2.join(' / ') + ')');
    const wl = IA.layoutOf({ type: 'words', words: ['첫 고지서 납부기한 + 2개월'], t0: 0, t1: 5 }, () => {}).filter((q) => q.k === 'text');
    ok(wl.length === 2 && wl.every((q) => !/[+→~×]$/.test(q.lines[0])), '낱말 카드: 균형 줄바꿈(' + wl.map((q) => q.lines[0]).join(' / ') + ')');
    // 자막 폭 — 낱말 카드·확인표가 뜨는 동안 판 왼쪽 안으로
    const wp = { type: 'words', words: ['임의계속가입'], t0: 5, t1: 12 }, cp = { type: 'check', list: ['첫째 확인'], t0: 20, t1: 25 };
    const left = (q) => IA.panelLeft(q), L = IA.panelLeft(wp);
    ok(L > 900 && L < 1700 && IA.panelLeft({ type: 'table', rows: [['a']] }) === null, '판 왼쪽 가장자리: 낱말 ' + L + ' · 표는 없음');
    const cues = [{ start: 4, end: 9, text: 'a', style: { width: 0.96, xOffset: 0 } }, { start: 14, end: 18, text: 'b', style: { width: 0.96, xOffset: 0 } }, { start: 6, end: 8, text: 'c' }];
    const nc = R.narrowCuesForPanels(cues, [wp, cp], left);
    const right = (c) => ((1 - c.style.width) / 2 * 1920 + (c.style.xOffset || 0) * 960) + c.style.width * 1920;
    ok(right(nc[0]) <= L - 40 + 1 && nc[0].style.width < 0.96, '자막이 낱말 판과 겹치면 폭이 판 앞까지로 줄어든다(오른쪽 끝 ' + Math.round(right(nc[0])) + ')');
    ok(nc[1] === cues[1] && nc[2] === cues[2], '판이 없는 시각·style 없는 큐는 그대로');
    ok(R.narrowCuesForPanels(cues, [], left) === cues && R.narrowCuesForPanels(cues, [{ type: 'table', t0: 0, t1: 30 }], left) === cues, '판이 없거나 표뿐이면 같은 배열');
    const left0 = (1 - 0.96) / 2 * 1920; ok(Math.abs(((1 - nc[0].style.width) / 2 * 1920 + nc[0].style.xOffset * 960) - left0) < 1, '자막 줄의 왼쪽 가장자리는 그대로');
  }
  console.log('\n[8] v0.8.5 — 편마다 달라지는 색·모양 · 장면마다 달라지는 자리(core/info-theme)');
  {
    const IT = require('../core/info-theme');
    // 색 — 어떤 색조에서도 글자 대비 4.5:1 이상(최악 = 흰 그림 위)
    let worst = 99;
    for (let h = 0; h < 360; h += 15) for (const sat of [0.1, 0.5, 0.9]) {
      const pal = IT.makePalette(h, h + 40, sat), tx = [0xF4, 0xF1, 0xEA];
      worst = Math.min(worst, IT.ratio(tx, IT.under(pal.panel, 0.84)), IT.ratio(tx, IT.under(pal.bg, 0.92)), IT.ratio(IT.under(pal.accent, 1), IT.under(pal.bg, 0.92)), IT.ratio(IT.under(pal.dim, 1), IT.under(pal.panel, 0.84)));
    }
    ok(worst >= 4.5, '팔레트: 모든 색조에서 글자·강조·흐린 글자 대비 4.5:1 이상(최저 ' + worst.toFixed(2) + ')');
    // 씨앗 — 같으면 같고 이름이 달라지면 모양이 갈린다
    const names = []; for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d += 3) names.push('[정보_' + String(m).padStart(2, '0') + String(d).padStart(2, '0') + ']');
    const shapes = new Set(names.map((n) => IT.SHAPES[IT.hash32(n) % IT.SHAPES.length]));
    ok(IT.hash32('[정보_1015]') === IT.hash32('[정보_1015]') && shapes.size === 4, '씨앗: 같은 이름은 같은 값 · 여러 편에서 모양 4가지가 다 나온다');
    // 색조·빈 자리 읽기 — 합성 그림(왼쪽 = 단색 갈색 · 오른쪽 = 무늬)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ithm-'));
    const img = path.join(tmp, 'a.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x3a5a8a:s=960x1080', '-f', 'lavfi', '-i', 'testsrc2=s=960x1080', '-filter_complex', 'hstack', '-frames:v', '1', img]);
    const gray = path.join(tmp, 'g.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=1920x1080', '-frames:v', '1', gray]);
    const segAt = (t) => ({ file: img, rel: 0 });
    const mk = (type, scene, t0, t1) => (type === 'words' ? { type, scene, t0, t1, words: ['지역가입자', '임의계속가입'] } : { type, scene, t0, t1, list: ['첫째', '둘째'] });
    const build = () => [mk('words', 1, 5, 12), mk('check', 1, 12, 16), mk('words', 2, 30, 36), { type: 'cover', scene: 3, t0: 50, t1: 54, n: 1, m: 3, title: 't' }, { type: 'table', scene: 3, t0: 60, t1: 70, title: 'x', rows: [['a', 'b']] }];
    const P1 = build(), r1 = await IT.assign(P1, { seed: '[정보_1015]', segAt, total: 80, capBottom: true, ffmpeg: FF, log: () => {} });
    const P2 = build(); await IT.assign(P2, { seed: '[정보_1015]', segAt, total: 80, capBottom: true, ffmpeg: FF, log: () => {} });
    ok(JSON.stringify(P1.map((q) => q.theme)) === JSON.stringify(P2.map((q) => q.theme)), '같은 편·같은 그림이면 다시 돌려도 같은 결과(결정적)');
    ok(P1[0].theme.pos === P1[1].theme.pos, '같은 장면(###) 안에서는 낱말 카드와 확인표가 같은 자리');
    ok(P1.every((q) => q.theme && q.theme.colors && /^[0-9A-F]{6}$/.test(q.theme.colors.panel)) && r1.colors && r1.shape === P1[0].theme.shape, '모든 판에 팔레트·모양이 달린다(표·구간 표지 포함)');
    ok(['lc', 'lt'].includes(P1[0].theme.pos), '빈 자리 = 왼쪽(단색 쪽)을 고른다(' + P1[0].theme.pos + ')');
    const P3 = build(); await IT.assign(P3, { seed: '[정보_1015]', segAt, total: 80, capBottom: false, ffmpeg: FF, log: () => {} });
    ok(P3.filter((q) => q.type === 'words' || q.type === 'check').every((q) => q.theme.pos === 'rc' || q.theme.pos === 'rt'), '자막이 아래쪽이 아니면 왼쪽 자리는 쓰지 않는다');
    // 배치 — 자리에 따라 판이 옮겨 가고 · 왼쪽 판은 자막 폭을 줄이지 않는다
    const lw = { ...mk('words', 1, 0, 5), theme: { shape: 'frame', pos: 'lt' } }, rw = { ...mk('words', 1, 0, 5), theme: { shape: 'tag', pos: 'rc' } };
    const lr = IA.layoutOf(lw, () => {}).find((q) => q.k === 'rect'), rr = IA.layoutOf(rw, () => {}).find((q) => q.k === 'rect');
    ok(lr.x === 40 && lr.y === 110 && rr.x + rr.w === 1880 && IA.panelLeft(lw) === null && IA.panelLeft(rw) === rr.x, '배치: 왼쪽 위 = (40,110) · 오른쪽 가운데 = 오른쪽 끝 · 왼쪽 판은 자막 폭 제한 없음');
    for (const sh of IT.SHAPES) { const t = IA.layoutOf({ ...mk('check', 1, 0, 5), theme: { shape: sh, pos: 'rc', colors: { accent: 'AABBCC' } } }, () => {}); ok(t.length >= 6 && t.filter((q) => q.k === 'text').every((q) => q.fs >= 66), '모양 ' + sh + ': 글자 66px 이상'); }
    // 색이 거의 없는 그림은 고정 색 · 모양·자리는 그대로
    const Pg = build(), rg = await IT.assign(Pg, { seed: 'x', segAt: () => ({ file: gray, rel: 0 }), total: 80, capBottom: true, ffmpeg: FF, log: () => {} });
    ok(rg.colors === null && Pg[0].theme.shape && !Pg[0].theme.colors, '색이 없는 그림 → 고정 색(예전 팔레트) · 모양·자리는 정해진다');
    // 그림을 못 읽어도 던지지 않는다
    const Pb = build(); await IT.assign(Pb, { seed: 'x', segAt: () => ({ file: path.join(tmp, '없음.png'), rel: 0 }), total: 80, capBottom: true, ffmpeg: FF, log: () => {} });
    ok(Pb.every((q) => q.theme && !q.theme.colors), '그림을 못 읽으면 예전 모양으로(오류 없이)');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
  console.log('\n[9] v0.8.6 — 얼굴 가림 거부권 · 인물 반대쪽 힌트 · 대본 자리 꼬리표 @왼쪽위');
  {
    const IT = require('../core/info-theme');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ithf-'));
    const mkImg = (name, leftHex, rightHex) => { const f = path.join(tmp, name + '.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=' + leftHex + ':s=960x1080', '-f', 'lavfi', '-i', 'color=c=' + rightHex + ':s=960x1080', '-filter_complex', 'hstack', '-frames:v', '1', f]); return f; };
    const skinL = mkImg('skinL', '0xc08a6a', '0x3a5a8a'), skinAll = mkImg('skinAll', '0xc08a6a', '0xc08a6a'), clean = mkImg('clean', '0x3a5a8a', '0x3a5a8a');
    const one = () => [{ type: 'words', scene: 1, t0: 5, t1: 12, words: ['지역가입자', '임의계속가입'] }];
    const run = async (file, extra = {}, panels = one()) => { const logs = []; await IT.assign(panels, { seed: '[정보_1015]', segAt: () => ({ file, rel: 0 }), total: 40, capBottom: true, ffmpeg: FF, log: (m) => logs.push(m) }); return { pos: panels[0].theme.pos, logs, panels }; };
    ok(IT.isSkin(0xc0, 0x8a, 0x6a) && !IT.isSkin(0x3a, 0x5a, 0x8a) && !IT.isSkin(250, 235, 215), '살색 판정: 살색 O · 파랑 X · 아주 밝은 벽 X');
    // 얼굴 가림 = 거부권 — 왼쪽 전체가 살색이면 왼쪽 자리는 점수 비교 전에 탈락
    const r1 = await run(skinL); ok(/^r/.test(r1.pos), '왼쪽이 살색이면 왼쪽 자리 탈락 → 오른쪽(' + r1.pos + ')');
    // 모두 탈락 — 가장 덜 덮는 자리 + ⚠ 로그(장면 번호)
    const r2 = await run(skinAll); ok(!!r2.pos && r2.logs.some((l) => /⚠.*G2/.test(l)), '네 자리 모두 탈락이면 ⚠ 로그(장면 G2)와 함께 한 자리를 고른다(' + r2.pos + ')');
    // 인물 반대쪽 힌트
    const h1 = await run(clean, {}, [{ ...one()[0], hint: 'left' }]), h2 = await run(clean, {}, [{ ...one()[0], hint: 'right' }]);
    ok(/^l/.test(h1.pos) && /^r/.test(h2.pos), '프롬프트 힌트: 인물이 오른쪽이면 판은 왼쪽 · 왼쪽이면 오른쪽(' + h1.pos + ' · ' + h2.pos + ')');
    const h3 = await run(skinL, {}, [{ ...one()[0], hint: 'left' }]); ok(/^r/.test(h3.pos), '힌트보다 얼굴 가림 거부권이 먼저(' + h3.pos + ')');
    // 대본 꼬리표가 이긴다
    const t1 = await run(skinL, {}, [{ ...one()[0], posTag: 'lt' }]); ok(t1.pos === 'lt', '대본 꼬리표 @왼쪽위 가 자동 판단보다 이긴다');
    // 꼬리표 읽기
    const L1 = IC.lineKind('> 🔤 카드: 지역가입자 | 임의계속가입 @왼쪽위'), L2 = IC.lineKind('> ✅ 확인: 내 자리 확인 @오른쪽가운데'), L3 = IC.lineKind('> ✅ 확인: 문구 @위쪽');
    ok(L1.mark.pos === 'lt' && L1.mark.words.join('|') === '지역가입자|임의계속가입' && L2.mark.pos === 'rc' && L2.mark.text === '내 자리 확인', '꼬리표: 🔤·✅ 줄 끝 @자리 를 떼어 읽는다(문구에 안 섞임)');
    ok(L3.mark.badPos === '위쪽' && L3.mark.text === '문구' && !L3.mark.pos, '꼬리표: 모르는 값은 badPos(⚠)');
    ok(!('pos' in IC.lineKind('> 🔤 카드: 가 | 나').mark), '꼬리표 없으면 예전과 같다(자동)');
    // 계획 — 장면 단위 · 충돌은 첫 것만 + ⚠ · 서명에 자리가 들어간다
    const S2 = SCRIPT.replace('> 🔤 카드: 지역가입자 | 임의계속가입 | 피부양자', '> 🔤 카드: 지역가입자 | 임의계속가입 | 피부양자 @왼쪽위').replace('> ✅ 확인: 내 자리 확인', '> ✅ 확인: 내 자리 확인 @오른쪽위');
    const pj = P.parseScriptText(S2, 'longform', {}).projects[0];
    pj.sentences.forEach((x) => { x.ttsAudioPath = 'x.mp3'; x.ttsDurationSec = 5; });
    const pl2 = IC.plan(pj, IC.fromRaw(S2), { sections: false });
    const wp = pl2.panels.find((q) => q.type === 'words'), cp = pl2.panels.find((q) => q.type === 'check');
    ok(wp && wp.pos === 'lt' && wp.posTag === 'lt', '계획: 🔤 판에 자리(lt)가 달린다');
    ok(cp && cp.posTag && (cp.scene !== wp.scene || cp.posTag === 'lt'), '계획: 같은 장면이면 첫 꼬리표(lt)를 쓴다 · 다른 장면이면 자기 것');
    ok(IC.signatureOf(IC.fromRaw(S2)) .some((x) => /@lt/.test(x)) && IC.signatureOf(IC.fromRaw(S2)).join() !== IC.signatureOf(IC.fromRaw(SCRIPT)).join(), '서명에 자리가 들어간다(옮기면 MP4 를 다시 굽는다)');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
  console.log(`\n${fail ? '❌' : '✅'} info-cards ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 오류:', e); process.exit(1); });
