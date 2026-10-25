'use strict';
/**
 * node test/info-motion.test.js — 📇 정보 카드 움직임(v0.9.106 · 로이 2026-10-23 「1단계부터」)
 *   [1] 표 줄 강조 열쇠·창(rowKeys·rowCues) [2] 계획(표 rowHi · 확인표 tick) [3] 배치·ASS(조각 시간 창 · 숫자 강조색 · 창 없으면 예전과 같다)
 *   [4] 실제 MP4 화소 — 말하는 줄만 밝다 · 강조를 빼면(A/B) 두 시각의 그 줄 밝기가 같다 · 체크는 찍힌 뒤에 보인다
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const IC = require('../core/info-cards');
const IA = require('../core/info-ass');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const FF = require('../core/media-utils').getFfmpegPath();

const SCRIPT = [
  '# 움직임 시험', '',
  '## 도입부', '', '### 식탁', '> 🖼️ 이미지: a kitchen', '', '연금 이야기를 시작합니다.', '',
  '## 1장 — 당겨 받으면', '', '### 비율', '> 🖼️ 이미지: a table', '',
  '> 📊 표: 당겨 받을 때 받는 비율',
  '> | 당기는 기간 | 원래 금액 대비 |',
  '> | 1년 | 94% |',
  '> | 3년 | 82% |',
  '> | 5년 | 70% |',
  '> 📊 출처: 국민연금법',
  '1년을 당기면 원래 금액의 94%를 받습니다. 3년을 당기면 82%로 줄어듭니다. 5년을 당기면 70%까지 내려갑니다.', '',
  '> ✅ 확인: 내 비율 확인',
  '내 비율을 한 번 확인해 보세요.', '',
  '> 🔤 카드: 70세부터 | 매달 118만 원',
  '늦추면 매달 받는 돈이 늘어납니다.', '',
].join('\n');
const mk = (sec = 6) => { const pj = P.parseScriptText(SCRIPT, 'longform', {}).projects[0]; pj.sentences.forEach((s) => { s.ttsAudioPath = 'x.mp3'; s.ttsDurationSec = sec; }); return pj; };

(async () => {
  console.log('[1] 표 줄 강조 — 열쇠 · 창');
  {
    const k = IC.rowKeys([['기간', '비율'], ['1년', '94%'], ['3년', '82%'], ['5년', '70%']]);
    ok(k[0] === null && k[1].nums.join() === '94' && k[3].nums.join() === '70', '열쇠 = 그 줄에만 있는 두 자리+ 숫자(한 자리 「1」은 흔해서 뺀다 · 머리 줄 없음)');
    const k2 = IC.rowKeys([['열차', '할인'], ['KTX', '30%'], ['무궁화호', '30%']]);
    ok(k2[1].words.join() === 'KTX' && k2[2].words.join() === '무궁화호' && !k2[1].nums.length, '모든 줄에 같은 숫자(30%)면 숫자 대신 그 줄의 낱말');
    ok(IC.rowKeys([['a', 'b'], ['319만 3,511원', '정지'], ['519만 3,511원', '감액']])[1].nums.join() === '319', '「3,511」 처럼 두 줄에 같은 값은 뺀다 · 쉼표 숫자는 하나로 읽는다');
    const rows = [['기간', '비율'], ['1년', '94%'], ['3년', '82%']];
    const one = IC.rowCues(rows, [{ i: 0, text: '1년이면 94%이고 3년이면 82%입니다.', t0: 0, t1: 10 }], 0, 10);
    ok(one.length === 2 && one[0].row === 1 && one[1].row === 2 && one[0].t1 === one[1].t0 && one[1].t0 > 3 && one[1].t0 < 7 && one[1].t1 === 10, `한 문장에 두 줄 — 글자 위치 비율로 나눈다(1번 ${one[0] && one[0].t0.toFixed(1)}~ · 2번 ${one[1] && one[1].t0.toFixed(1)}~10)`);
    ok(one.filter((w) => w.s0 === 0).length === 1, '① 미리보기: 한 문장엔 가운데가 든 줄 하나만');
    ok(IC.rowCues(rows, [{ i: 0, text: '1년이면 94%입니다.', t0: 0, t1: 5 }], 0, 5).length === 0, '한 줄만 걸리면 켜지 않는다(우연일 수 있다 — 조용히 틀리지 않게)');
    ok(IC.rowCues(rows, [{ i: 0, text: '표를 보세요.', t0: 0, t1: 5 }], 0, 5).length === 0, '낭독에 열쇠가 없으면 강조 없음(예전과 같다)');
    const short = IC.rowCues([['a', 'b'], ['11', 'x'], ['22', 'y'], ['33', 'z']], [{ i: 0, text: '11 22 33 끝까지 이어지는 아주 긴 문장입니다 정말 깁니다', t0: 0, t1: 4 }], 0, 4);
    ok(short.every((w) => w.t1 - w.t0 >= IC.HI_MIN_SEC), `0.8초 미만 창은 버린다(${short.map((w) => w.row + ':' + (w.t1 - w.t0).toFixed(2)).join(' ')})`);
    const back = IC.rowCues(rows, [{ i: 0, text: '94%입니다.', t0: 0, t1: 3 }, { i: 1, text: '82%입니다.', t0: 3, t1: 6 }, { i: 2, text: '다시 94%를 봅니다.', t0: 6, t1: 9 }], 0, 9);
    ok(back.map((w) => w.row).join() === '1,2,1', '낭독이 앞 줄로 돌아가면 강조도 돌아간다');
  }

  console.log('\n[2] 계획');
  const pj = mk(), parsed = IC.fromRaw(SCRIPT);
  const pl = IC.plan(pj, parsed, { sections: false });
  const tb = pl.panels.find((p) => p.type === 'table'), ck = pl.panels.find((p) => p.type === 'check'), wd = pl.panels.find((p) => p.type === 'words');
  {
    ok(pl.warnings.length === 0, `경고 없음(${pl.warnings.join(' / ')})`);
    ok(tb && Array.isArray(tb.rowHi) && tb.rowHi.map((w) => w.row).join() === '1,2,3', `표: 낭독 순서대로 1→2→3번 줄(${tb && JSON.stringify((tb.rowHi || []).map((w) => [w.row, +w.t0.toFixed(1), +w.t1.toFixed(1)]))})`);
    ok(tb.rowHi[0].t0 > tb.t0 && tb.rowHi[2].t1 === tb.t1, '첫 줄은 그 숫자를 말할 때부터 · 마지막 줄은 표가 끝날 때까지');
    ok(tb.rowHi.map((w) => w.s0).join() === '1,2,3', `① 미리보기 문장 = 그 줄을 말하는 문장(${tb.rowHi.map((w) => w.s0 + '-' + w.s1).join(' ')} · 문장 ${pj.sentences.map((x) => x.text.slice(0, 6)).join('/')})`);
    ok(ck && Math.abs(ck.tick - (ck.t0 + IC.CHECK_TICK_SEC)) < 1e-9, `확인표: 체크는 판이 뜬 1초 뒤(${ck && (ck.tick - ck.t0).toFixed(2)})`);
    const ntP = P.parseScriptText(SCRIPT.replace(/1년을 당기면[^\n]*/, '표를 함께 보시지요.'), 'longform', {}).projects[0]; ntP.sentences.forEach((x) => { x.ttsAudioPath = 'x.mp3'; x.ttsDurationSec = 6; });
    const noTalk = IC.plan(ntP, IC.fromRaw(SCRIPT.replace(/1년을 당기면[^\n]*/, '표를 함께 보시지요.')), { sections: false });
    ok(noTalk.panels.find((p) => p.type === 'table') && !('rowHi' in noTalk.panels.find((p) => p.type === 'table')), '낭독이 표 줄을 안 말하면 rowHi 자체가 없다(예전 판과 같다)');
  }

  console.log('\n[3] 배치 · ASS');
  {
    const prims = IA.layoutOf(tb);
    const hi = prims.filter((q) => q.on);
    ok(hi.length === 6 && hi.every((q) => q.onS && q.k === 'rect'), `표: 줄마다 띠 + 막대 = 창 3 × 2 조각(${hi.length})`);
    const ys = [1, 2, 3].map((r) => hi.find((q) => q.on[0] === tb.rowHi[r - 1].t0).y);
    ok(ys[0] < ys[1] && ys[1] < ys[2], `강조 띠가 그 줄 자리에(위 ${ys.join(' < ')})`);
    const plain = IA.layoutOf({ ...tb, rowHi: undefined, _prims: null });
    ok(plain.length === prims.length - 6 && JSON.stringify(plain) === JSON.stringify(prims.filter((q) => !q.on)), '강조를 빼면 예전 표 조각과 한 글자도 같다');
    const evOn = IA.events([tb], 0, 1e9, 'F'), evOff = IA.events([{ ...tb, rowHi: undefined, _prims: null }], 0, 1e9, 'F');
    ok(evOn.length === evOff.length + 6 && evOff.every((l) => evOn.includes(l)), 'ASS: 강조 6줄만 더해진다(나머지 줄은 그대로)');
    const fmt = (s) => { const [h, m, x] = s.split(':'); return +h * 3600 + +m * 60 + +x; };
    const hiEv = evOn.filter((l) => !evOff.includes(l)).map((l) => fmt(l.split(',')[1]));
    ok(tb.rowHi.every((w) => hiEv.some((t) => Math.abs(t - w.t0) < 0.011)), 'ASS: 강조 줄은 그 창 시각에 시작한다');
    const ckPr = IA.layoutOf(ck), tick = ckPr.filter((q) => q.k === 'check' && q.on);
    ok(tick.length === 1 && Math.abs(tick[0].on[0] - ck.tick) < 1e-9, '확인표: 방금 것의 체크 하나만 시간 창(앞 것은 이미 찍혀 있다)');
    const ckEv = IA.events([ck], 0, 1e9, 'F').filter((l) => /^Dialogue: 8,/.test(l) && /\p1}m /.test(l)).map((l) => fmt(l.split(',')[1]));   // 체크 표시(층 8 도형)
    ok(ckEv.length === ck.list.length && ckEv.filter((t) => Math.abs(t - ck.tick) < 0.011).length === 1 && ckEv.filter((t) => Math.abs(t - ck.t0) < 0.011).length === ck.list.length - 1, `ASS: 방금 것의 체크만 찍히는 시각에 시작(${ckEv.map((t) => t.toFixed(2)).join(' · ')})`);
    const wPr = IA.layoutOf(wd).filter((q) => q.k === 'text');
    const runs = wPr.map((q) => (q.runs ? q.runs[0].filter((r) => r.c).map((r) => r.t) : []));
    ok(runs[0].join() === '70세' && runs[1].join() === '118만 원' && wPr.every((q) => q.runs[0].every((r) => !r.c || r.c === wd.theme?.colors?.accent || r.c === IA.C.accent)), `🔤 숫자 = 단위까지 강조색(${JSON.stringify(runs)})`);
    ok(wPr.every((q) => q.runs[0].map((r) => r.t).join('') === q.lines[0]), '조각을 이으면 원래 글 그대로(판 크기·줄바꿈 불변)');
    const wEv = IA.events([wd], 0, 1e9, 'F').filter((l) => /\\fn/.test(l));
    ok(wEv.some((l) => /\{\\1c&H[0-9A-F]{6}&\}118만 원\{\\1c&H[0-9A-F]{6}&\}/.test(l)), 'ASS: 숫자 조각만 글자색을 바꿨다 되돌린다');
    const noNum = IA.layoutOf({ type: 'words', words: ['연기연금', '늦출수록 늘어난다'], t0: 0, t1: 3 }).filter((q) => q.k === 'text');
    ok(noNum.every((q) => !q.runs), '숫자가 없는 낱말 카드는 예전과 같다(runs 없음)');
    const NR = (s) => (IA.layoutOf({ type: 'words', words: [s], t0: 0, t1: 3 }).find((q) => q.k === 'text').runs || [[]])[0].filter((r) => r.c).map((r) => r.t);
    ok(NR('50~90% 중 선택').join() === '50~90%' && NR('문의 1588-7788').join() === '1588-7788' && NR('11월분은 12월 10일까지').join() === '11월,12월,10일' && NR('1개월 0.6%').join() === '1개월,0.6%', '범위·전화번호·날짜·소수 단위');
  }

  console.log('\n[4] 실제 MP4 — 말하는 줄만 밝다');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'infomo-'));
  try {
    const img = path.join(tmp, 'g.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x406080:s=1920x1080', '-frames:v', '1', img]);
    const proj = P.parseScriptText(SCRIPT, 'longform', {}).projects[0];
    proj.groups.forEach((g) => { g.imagePath = img; });
    const mp3 = path.join(tmp, 's.mp3'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '6', '-c:a', 'libmp3lame', mp3]);
    proj.sentences.forEach((s, i) => { const f = path.join(tmp, `s${i}.mp3`); fs.copyFileSync(mp3, f); s.ttsAudioPath = f; s.ttsDurationSec = 6; });
    const vrew = path.join(tmp, 'a.vrew'); await P.buildProjectVrew(proj, vrew, {}, () => {}, 20, 1);
    const p2 = IC.plan(proj, IC.fromRaw(SCRIPT), { sections: false });
    const T2 = p2.panels.find((p) => p.type === 'table'), C2 = p2.panels.find((p) => p.type === 'check');
    const bake = async (name, info) => { const mp4 = path.join(tmp, name + '.mp4'); const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 2, chunkSec: 5, info }); if (!res || !res.ok) throw new Error('렌더 실패 ' + name); return mp4; };
    const hiPanels = p2.panels.map((p) => ({ ...p, _prims: null }));
    const withHi = await bake('hi', hiPanels);   // 렌더가 판마다 색·자리(theme)를 단다 — 화소를 잴 자리는 그 판으로 다시 잰다
    const noHi = await bake('nohi', p2.panels.map((p) => ({ ...p, rowHi: undefined, tick: undefined, _prims: null })));
    const prims = IA.layoutOf({ ...hiPanels.find((p) => p.type === 'table'), _prims: null }).filter((q) => q.on && q.w > 100);
    const band = (r) => prims.find((q) => q.on[0] === T2.rowHi[r - 1].t0);
    // 줄 띠의 왼쪽 끝 막대·글자를 피한 빈 오른쪽 부분의 밝기
    const lum = (f, t, b) => { const buf = execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `crop=300:${Math.max(8, b.h - 20)}:${b.x + b.w - 320}:${b.y + 10},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 }); let s = 0; for (const v of buf) s += v; return s / buf.length; };
    const mid = (r) => (T2.rowHi[r - 1].t0 + T2.rowHi[r - 1].t1) / 2;
    const b1 = band(1), b3 = band(3);
    const r1on = lum(withHi, mid(1), b1), r1off = lum(withHi, mid(3), b1), r3on = lum(withHi, mid(3), b3), r3off = lum(withHi, mid(1), b3);
    ok(r1on > r1off + 6 && r3on > r3off + 6, `말하는 줄만 밝다(1번 줄 ${r1on.toFixed(0)} vs ${r1off.toFixed(0)} · 3번 줄 ${r3on.toFixed(0)} vs ${r3off.toFixed(0)})`);
    const n1a = lum(noHi, mid(1), b1), n1b = lum(noHi, mid(3), b1);
    ok(Math.abs(n1a - n1b) < 1.5 && Math.abs(n1b - r1off) < 1.5, `A/B — 강조를 빼면 두 시각의 같은 줄 밝기가 같다(${n1a.toFixed(1)} · ${n1b.toFixed(1)}) · 꺼진 줄은 예전과 같다`);
    const cb = IA.layoutOf({ ...hiPanels.find((p) => p.type === 'check'), _prims: null }).find((q) => q.k === 'check' && q.on);
    const box = { x: cb.x - 0, y: cb.y, w: cb.size, h: cb.size };
    const dark = (t) => { const buf = execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', withHi, '-frames:v', '1', '-vf', `crop=${box.w}:${box.h}:${box.x}:${box.y},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 }); return buf.filter((v) => v < 60).length / buf.length; };
    const before = dark(C2.t0 + 0.6), after = dark(C2.tick + 0.6);
    ok(after > before + 0.1, `확인표: 체크가 찍힌 뒤에야 칸 안에 체크(어두운 화소 ${Math.round(before * 100)}% → ${Math.round(after * 100)}%)`);
    if (process.env.PM_SHOT_DIR) {
      fs.mkdirSync(process.env.PM_SHOT_DIR, { recursive: true });
      for (const [t, n] of [[mid(1), 'row1'], [mid(2), 'row2'], [mid(3), 'row3'], [C2.tick + 0.6, 'check'], [(p2.panels.find((p) => p.type === 'words').t0 + 1), 'words']]) execFileSync(FF, ['-y', '-v', 'error', '-ss', String(t), '-i', withHi, '-frames:v', '1', path.join(process.env.PM_SHOT_DIR, n + '.png')]);
    }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }

  console.log(`\n${fail ? '❌' : '✅'} info-motion ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 오류: ' + (e && e.stack || e)); process.exit(1); });
