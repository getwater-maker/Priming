'use strict';
/**
 * node test/interlude-pause.test.js — ⏸ 막간 쉼 + 📜 카드 자리 표시 (v0.9.25 · 채널사업부 요청 2026-10-15)
 *   [1] 쉼 계획(채널 값은 막간만 · +N 끝 문장 · `쉼=` 덮어쓰기·0 끄기 · 잘못된 값 경고 · 못 찾은 카드엔 쉼 없음)
 *   [2] 카드 시각(쉼만큼 카드가 늘고 뒤 카드가 밀린다 · 쉼 0 = 예전 계획과 한 글자도 같다 · 원본 불변)
 *   [3] 대본 보기 표시(DTO card · cardBad) [4] 지문·main 연결(정보 카드·챕터도 같은 쉼)
 *   [5] 실제 .vrew → MP4(길이 + 쉼 · 쉼 구간 무음 · 카드가 떠 있음 · 자막 없음 · 뒤 카드가 밀림 · tts 원본·임시 파일)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const SC = require('../core/screen-cards');
const P = require('../core/pipeline');
const R = require('../core/vrew-render');
const FF = require('../core/media-utils').getFfmpegPath();

const JA = ['# [일본_TEST] 銀河鉄道の夜', '', '## 本編', '',
  '### 一',
  '> 📜 화면카드: 막간 | 때=第一章午后 | 제목=一、午后の授業',
  '[室主] 第一章、午后の授業。', '',
  '[朗読] 「ではみなさんは。」と先生が云いました。', '',
  '> 📜 화면카드: 해설 | 때=活版所というのは | 제목=活版所',
  '[室主] 活版所というのは、印刷する所のことです。', '',
].join('\n');
const parse = (t) => P.parseScriptText(t, 'longform', {}).projects[0];
const withDur = (pj, d = 3) => { pj.sentences.forEach((s) => { s.ttsAudioPath = 'x.mp3'; s.ttsDurationSec = d; }); return pj; };

(async () => {
  console.log('[1] 쉼 계획');
  {
    const pj = withDur(parse(JA));
    ok(SC.pausesOf(pj, pj.screenCards, 0).list.length === 0 && SC.pausesOf(pj, pj.screenCards, undefined).list.length === 0, '채널 값 0·없음 = 쉼 없음(기본 = 예전과 같다)');
    const p5 = SC.pausesOf(pj, pj.screenCards, 5);
    ok(p5.list.length === 1 && p5.map.get(pj.sentences[0].id) === 5 && p5.total === 5, `채널 5초 → 막간 하나만(해설 제외) · 그 때= 문장 뒤 (${JSON.stringify(p5.list)})`);
    const plus = withDur(parse(JA.replace('때=第一章午后 |', '때=第一章午后 +1 |')));
    ok(SC.pausesOf(plus, plus.screenCards, 4).map.get(plus.sentences[1].id) === 4 && !SC.pausesOf(plus, plus.screenCards, 4).map.has(plus.sentences[0].id), '+N 이면 마지막 문장 뒤에 쉰다');
    const off = withDur(parse(JA.replace('제목=一、午后の授業', '제목=一、午后の授業 | 쉼=0')));
    ok(SC.pausesOf(off, off.screenCards, 5).list.length === 0, '`쉼=0` = 그 카드만 끈다');
    const own = withDur(parse(JA.replace('제목=活版所', '제목=活版所 | 쉼=2').replace('제목=一、午后の授業', '제목=一、午后の授業 | 쉼=3초')));
    const po = SC.pausesOf(own, own.screenCards, 0);
    ok(po.map.get(own.sentences[0].id) === 3 && po.map.get(own.sentences[2].id) === 2 && po.total === 5, '`쉼=` 은 채널 값이 0 이어도 그 카드에 쓴다(해설에도 · 「3초」 꼴도)');
    ok(SC.pausesOf(withDur(parse(JA.replace('제목=一、午后の授業', '제목=一、午后の授業 | 쉼=99'))), parse(JA.replace('제목=一、午后の授業', '제목=一、午后の授業 | 쉼=99')).screenCards, 0).list[0].sec === SC.PAUSE_MAX, `상한 ${SC.PAUSE_MAX}초`);
    const badv = withDur(parse(JA.replace('제목=一、午后の授業', '제목=一、午后の授業 | 쉼=길게')));
    const pb = SC.pausesOf(badv, badv.screenCards, 5);
    ok(pb.list.length === 0 && /쉼= 값은/.test(pb.warnings.join('')), '잘못된 쉼= 값 → 경고 + 쉬지 않음(조용히 채널 값으로 바꾸지 않는다)');
    const miss = withDur(parse(JA.replace('때=第一章午后', '때=없는문장입니다')));
    ok(SC.pausesOf(miss, miss.screenCards, 5).list.length === 0, '문장을 못 찾은 카드엔 쉼도 없다');
    const silent = parse(JA); silent.sentences.forEach((s, i) => { s.ttsAudioPath = i === 0 ? null : 'x'; s.ttsDurationSec = i === 0 ? null : 3; });
    ok(SC.pausesOf(silent, silent.screenCards, 5).list.length === 0, '음성이 없는 문장엔 쉼을 넣지 않는다(카드도 안 그려지는 조건과 같다)');
  }

  console.log('\n[2] 카드 시각');
  {
    const pj = withDur(parse(JA));
    const a = SC.plan(pj, pj.screenCards), b = SC.plan(pj, pj.screenCards, { pauseSec: 0 });
    ok(JSON.stringify(a.cards) === JSON.stringify(b.cards) && a.cards.every((c) => !('pauseSec' in c)), '쉼 0 = 예전 계획과 같다(pauseSec 키도 없다)');
    const c = SC.plan(pj, pj.screenCards, { pauseSec: 5 });
    const ma = c.cards.find((x) => x.label === '막간'), ks = c.cards.find((x) => x.label === '해설');
    ok(ma.t0 === 0 && ma.t1 === 8 && ma.pauseSec === 5, `막간 카드 = 제목 3초 + 쉼 5초 동안(${ma.t0}~${ma.t1} · 쉼 ${ma.pauseSec})`);
    ok(ks.t0 === 11 && ks.t1 === 14 && !ks.pauseSec, `뒤 카드는 쉼만큼 밀린다(해설 ${ks.t0}~${ks.t1} · 쉼 없음 6→11)`);
    ok(pj.sentences.every((s) => s.ttsDurationSec === 3 && s.ttsAudioPath === 'x.mp3'), '계획은 문장(원본)을 바꾸지 않는다');
    const w = SC.withPauses(pj, c.pauses.map);
    ok(w !== pj && w.sentences[0].ttsDurationSec === 8 && w.sentences[1] === pj.sentences[1] && pj.sentences[0].ttsDurationSec === 3, 'withPauses = 쉼이 붙은 문장만 새 객체(원본 불변)');
    ok(SC.withPauses(pj, new Map()) === pj, '쉼이 없으면 그대로(같은 객체)');
    // 렌더: 쉼 구간의 자막은 쉼 시작에서 끊긴다(제목을 읽는 동안은 보인다)
    const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'vrew-render.js'), 'utf8');
    ok(/pauseCaptionWins = pw/.test(src) && /e = \{ \.\.\.e, end: w\[0\] \}/.test(src), '렌더: 쉼 창에 걸친 자막은 쉼 시작에서 끊고, 쉼 안에서 시작한 자막은 뺀다');
  }

  console.log('\n[3] 대본 보기 표시(DTO)');
  {
    const t = JA.replace('때=第一章午后 |', '때=第一章午后 +1 |') + '\n> 📜 화면카드: 낱말 | 때=どこにもない文 | 원문=x | 번역=y\n';
    const pj = parse(t);   // 음성 없이도 맞춘다
    const dto = P.toDTO({ fileTitle: 't', meta: {}, mode: 'longform', projects: [pj] }).projects[0];
    const ss = dto.cuts.flatMap((c) => c.sentences);
    ok(ss[0].card && ss[0].card.role === 'start' && ss[0].card.label === '막간' && ss[0].card.interlude && !ss[0].card.last, `때= 문장 = 「📜 막간」 시작 (${JSON.stringify(ss[0].card && { r: ss[0].card.role, l: ss[0].card.label })})`);
    ok(ss[1].card && ss[1].card.role === 'cont' && ss[1].card.last, '+1 이어지는 문장 = 이어짐 · 끝(⏸ 은 여기에)');
    ok(ss[2].card && ss[2].card.label === '해설' && ss[2].card.interlude === false && /活版所/.test(ss[2].card.tip), '해설 카드 · 마우스 글(제목=)');
    ok(ss[0].card.pause === null, '쉼= 칸이 없으면 pause=null(화면이 채널 막간 쉼을 더한다)');
    ok(Array.isArray(dto.cardBad) && dto.cardBad.length === 1 && /찾지 못했습니다/.test(dto.cardBad[0]), `못 찾은 카드 줄 = cardBad ⚠ (${dto.cardBad && dto.cardBad[0]})`);
    const none = P.toDTO({ fileTitle: 't', meta: {}, mode: 'longform', projects: [parse('# t\n\n### a\n본문입니다.\n')] }).projects[0];
    ok(none.cardBad === null && none.cuts[0].sentences[0].card === null, '카드 줄이 없으면 card·cardBad 모두 null');
    const own = P.toDTO({ fileTitle: 't', meta: {}, mode: 'longform', projects: [parse(JA.replace('제목=活版所', '제목=活版所 | 쉼=2'))] }).projects[0];
    ok(own.cuts.flatMap((c) => c.sentences)[2].card.pause === 2, '쉼= 칸은 그 값이 그대로 실린다');
    const A = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');
    ok(/data-testid="card-mark"/.test(A) && /cm\.pause != null \? cm\.pause : \(cm\.interlude \? \(cardPause \|\| 0\) : 0\)/.test(A) && /cardPause \|\| 0\]\.join\('#'\)/.test(A), '화면: ② 클립 칸 왼쪽 열에 📜 표시 · ⏸ = 칸 쉼= > 채널 막간 쉼(막간만) · 그룹 열쇠에 채널 쉼');
    ok(/data-testid="card-bad"/.test(A) && /interludePauseSec: Number\(p\.interludePauseSec\)/.test(A) && /interludePauseSec: Math\.max\(0, Math\.min\(15, numOr\(ch\.interludePauseSec, 0\)\)\)/.test(A), '채널 편집 「막간 쉼」 읽기·저장 두 곳 다 · ⚠ 못 찾은 카드 표시');
  }

  console.log('\n[4] 지문 · main 연결');
  {
    const pj = withDur(parse(JA));
    const a = P.vrewInputsOf(pj, {}, 20), b = P.vrewInputsOf(pj, { interludePauseSec: 5 }, 20);
    ok(!('pauses' in a) && Array.isArray(b.pauses) && b.pauses.length === 1, '지문: 쉼이 있으면 pauses(.vrew 를 다시 만든다) · 없으면 키 없음(예전 지문)');
    ok(JSON.stringify(P.vrewInputsOf(pj, { interludePauseSec: 3 }, 20).pauses) !== JSON.stringify(b.pauses), '쉼 길이를 바꾸면 지문이 달라진다');
    const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    ok(/plan\(pr, pr\.screenCards, \{ pauseSec: preset && preset\.interludePauseSec \}\)/.test(M) && /cards: cardsOptsFor\(pr, preset\)/.test(M), 'MP4 카드 계획 = 같은 채널 쉼');
    ok(/IC\.plan\(require\('\.\/core\/screen-cards'\)\.withPauses\(pr, P\.pausePlanOf\(pr, preset\)\.map\)/.test(M), '정보 카드 시각도 쉼만큼 민다');
    ok(/addPausesToDtoProject\(dp, pr, P\.pausePlanOf\(pr, pausePreset\)\.map\)/.test(M) && (M.match(/maybeAutoUpload\([^)]*, true\)/g) || []).length === 2 && /ytMetaFor\(pr, ctx, isWb \? null : preset\)/.test(M) && /ytMetaFor\(j\.pr, j\.ctx, isWb \? null : j\.preset\)/.test(M), '유튜브 챕터도 쉼만큼 민다(MP4 업로드만 · 화이트보드는 아님)');
  }

  console.log('\n[5] 실제 .vrew → MP4');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pause-'));
  try {
    const img = path.join(tmp, 'g.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x6a8fbf:s=1920x1080', '-frames:v', '1', img]);
    const make = () => {
      const pj = parse(JA);
      pj.groups.forEach((g) => { g.imagePath = img; });
      pj.sentences.forEach((s, i) => { const f = path.join(tmp, `s${i}.wav`); if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${330 + i * 110}:sample_rate=24000`, '-t', '3', '-ac', '1', f]); s.ttsAudioPath = f; s.ttsDurationSec = 3; });
      return pj;
    };
    const bake = async (name, preset) => {
      const pj = make(); const logs = [];
      const before = fs.readdirSync(os.tmpdir()).filter((x) => x.startsWith('pm-pause-')).length;
      const vrew = path.join(tmp, name + '.vrew'); await P.buildProjectVrew(pj, vrew, preset, (l) => logs.push(String(l)), 20, 1);
      const after = fs.readdirSync(os.tmpdir()).filter((x) => x.startsWith('pm-pause-')).length;
      const cards = SC.plan(pj, pj.screenCards, { pauseSec: preset.interludePauseSec }).cards;
      const mp4 = path.join(tmp, name + '.mp4');
      const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: (l) => logs.push(String(l)), par: 2, chunkSec: 4, cards });
      return { pj, mp4, res, logs, tmpLeft: after - before };
    };
    const durF = (f) => { const r = require('child_process').spawnSync(FF, ['-i', f], { encoding: 'utf8' }); const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0; };
    const maxVol = (f, t0, len) => { const r = require('child_process').spawnSync(FF, ['-ss', String(t0), '-t', String(len), '-i', f, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); const m = /max_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr); return m ? (m[1] === '-inf' ? -200 : Number(m[1])) : NaN; };
    const raw = (f, t, vf = 'scale=480:270,format=gray') => execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
    const mean = (b) => { let x = 0; for (const v of b) x += v; return x / b.length; };
    const whites = (f, t) => { let n = 0; for (const v of raw(f, t, 'scale=960:540,format=gray')) if (v >= 250) n++; return n; };

    const base = await bake('base', {});
    const pz = await bake('pause', { interludePauseSec: 3 });
    ok(base.res.ok && pz.res.ok, `렌더 성공(기본 · 쉼 3초)${pz.res.ok ? '' : ' — ' + pz.res.error}`);
    const dB = durF(base.mp4), dP = durF(pz.mp4);
    ok(Math.abs(dB - 9) < 0.15 && Math.abs(dP - 12) < 0.15, `🔑 영상 길이 = 기존 + 막간 수 × 쉼(${dB.toFixed(2)} → ${dP.toFixed(2)}초)`);
    ok(pz.logs.some((l) => /⏸ 막간 쉼 1곳 · 3초/.test(l)) && !base.logs.some((l) => /막간 쉼/.test(l)), `빌드 로그 「⏸ 막간 쉼 1곳 · 3초」 (${(pz.logs.find((l) => /막간 쉼/.test(l)) || '').slice(0, 60)})`);
    const vSpeak = maxVol(pz.mp4, 0.5, 2), vPause = maxVol(pz.mp4, 3.25, 2.5), vNext = maxVol(pz.mp4, 6.3, 2.4);
    ok(vSpeak > -30 && vPause < -60 && vNext > -30, `소리: 제목 ${vSpeak}dB · 🔑 쉼(3.25~5.75초) ${vPause}dB · 다음 낭독(6.3초~) ${vNext}dB`);
    const mPic = mean(raw(base.mp4, 4.5)), mPause = mean(raw(pz.mp4, 4.5)), mAfter = mean(raw(pz.mp4, 7.5));
    ok(mPause < mPic * 0.5 && mAfter > mPic * 0.85, `🔑 쉼 동안 막간 카드가 떠 있다(4.5초 밝기 ${mPause.toFixed(0)} · 카드 없는 기본 ${mPic.toFixed(0)}) · 카드 뒤(7.5초) 그림 ${mAfter.toFixed(0)}`);
    const wSpeak = whites(pz.mp4, 1.5), wPause = whites(pz.mp4, 4.5);
    ok(wSpeak > 100 && wPause < wSpeak * 0.1, `자막: 제목 읽는 동안 보이고(1.5초 하얀 화소 ${wSpeak}) 🔑 쉼 동안 없다(4.5초 ${wPause})`);
    const kB = mean(raw(base.mp4, 7.5)), kP = mean(raw(pz.mp4, 10.5));
    ok(kB < mPic * 0.5 && kP < mPic * 0.5, `해설 카드가 쉼만큼 밀려 그려진다(기본 7.5초 ${kB.toFixed(0)} · 쉼 10.5초 ${kP.toFixed(0)})`);
    ok(pz.pj.sentences.every((s) => s.ttsDurationSec === 3 && /s\d\.wav$/.test(s.ttsAudioPath)) && pz.tmpLeft === 0, '문장(작업본)·tts 원본 불변 · 임시 무음 파일은 지워진다');
    // 📝 SRT(v0.9.94 · Lab 요청 2026-10-21) — 쉼만큼 뒤 자막이 밀려야 위 MP4(다음 낭독 6초~)와 맞는다
    {
      const starts = (f) => fs.readFileSync(f, 'utf8').split(/\n\n+/).filter(Boolean).map((b) => { const m = /^(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})/m.exec(b); return m ? [(+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000, (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000] : null; }).filter(Boolean);
      const sB = path.join(tmp, 'b.srt'), sB2 = path.join(tmp, 'b2.srt'), sB3 = path.join(tmp, 'b3.srt'), sP = path.join(tmp, 'p.srt');
      P.writeSrt(base.pj, sB, 20); P.writeSrt(base.pj, sB2, 20, {}); P.writeSrt(base.pj, sB3, 20, { interludePauseSec: 0 }); P.writeSrt(pz.pj, sP, 20, { interludePauseSec: 3 });
      ok(fs.readFileSync(sB, 'utf8') === fs.readFileSync(sB2, 'utf8') && fs.readFileSync(sB, 'utf8') === fs.readFileSync(sB3, 'utf8'), 'SRT: 쉼이 없으면(preset 없음 · {} · 0초) 예전과 한 글자도 같다');
      const tb = starts(sB), tp = starts(sP);
      ok(tb.length === 3 && tb.map((x) => x[0]).join() === '0,3,6', `SRT 기본 시작 = 0·3·6초 (${tb.map((x) => x[0]).join(',')})`);
      ok(tp.length === 3 && tp.map((x) => x[0]).join() === '0,6,9', `🔑 SRT 쉼 3초 = 막간 뒤 자막이 3초 밀린다 0·6·9초 (${tp.map((x) => x[0]).join(',')}) — MP4 다음 낭독 6초~와 같다`);
      ok(tp[0][1] === 3, `SRT: 쉼 동안은 자막 없음(막간 문장 자막 끝 = 음성 끝 3초 · ${tp[0] && tp[0][1]})`);
      ok(Math.abs(tp[2][1] - dP) < 0.15, `SRT 마지막 자막 끝 = 영상 길이(${tp[2][1]} · ${dP.toFixed(2)}초)`);
      const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
      const calls = (M.match(/P\.writeSrt\([^\n]*/g) || []).filter((c) => !/L\.maxChars/.test(c));   // 🌐 AI 번역 SRT(언어별 글자 수 · resolvePreset 으로 같은 쉼)는 따로
      ok(calls.length === 2 && calls.every((c) => /captionMaxChars, (preset|ep)\)/.test(c)), `main 의 SRT 쓰기 ${calls.length}곳 모두 .vrew 와 같은 preset 을 넘긴다`);
    }
    if (process.env.PM_SHOT_DIR) { fs.mkdirSync(process.env.PM_SHOT_DIR, { recursive: true }); for (const [t, nm] of [[1.5, 'pause_title'], [4.5, 'pause_mid'], [7.5, 'pause_after'], [10.5, 'pause_kaisetsu']]) execFileSync(FF, ['-y', '-v', 'error', '-ss', String(t), '-i', pz.mp4, '-frames:v', '1', path.join(process.env.PM_SHOT_DIR, nm + '.png')]); }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }

  console.log(`\n${fail ? '❌' : '✅'} interlude-pause ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 오류:', e); process.exit(1); });
