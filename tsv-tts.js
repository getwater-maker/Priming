#!/usr/bin/env node
'use strict';
/**
 * TSV 일괄 TTS — 헤드리스 CLI.
 *
 *   node tsv-tts.js <입력.tsv> --out <출력폴더> [옵션]
 *
 * 입력 형식은 한 줄에 `파일명<탭>문장` 이고, **그 파일명 그대로** mp3 가 나온다.
 * 리모션처럼 오디오 길이로 화면 길이를 정하는 파이프라인용이라 이름을 바꾸지 않는다.
 *
 * 옵션
 *   --out <폴더>          (필수) 출력 폴더
 *   --voice <이름>        서버 공용 목소리. 기본 #01_득수_noBreath
 *   --speed <배속>        1=원래 속도, 0.9=조금 느리게. 기본 1
 *   --speed-mode <모드>   atempo(기본) | server — 아래 설명
 *   --no-trim             앞뒤 무음을 자르지 않는다(기본은 자른다)
 *   --pad <초>            트림 여백. 기본 0.04 (파열음 보호)
 *   --dict <파일.md>      발음사전(마크다운 표)
 *   --prefix <문자열>     파일명 앞에 붙일 접두(시험용). 기본 없음
 *   --only <이름,이름>    이 파일명만 처리(배속 비교용)
 *   --limit <N>           앞에서 N개만
 *   --force               캐시·기존 파일을 무시하고 전부 다시 만든다
 *   --dry                 합성하지 않고 무엇을 할지만 보여준다
 *
 * ⚠ **목소리·배속·발음사전을 바꾸면 전량 재합성**된다(캐시 키가 달라진다).
 *   시험 단계에서 확정하고 그 뒤로 건드리지 말 것.
 */

const fs = require('fs');
const path = require('path');
const T = require('./core/tsv-tts');
const P = require('./core/pipeline');

const DEFAULT_VOICE = '#01_득수_noBreath';

/**
 * 🔑 **시드를 기본으로 고정한다 — 안 하면 같은 문장도 매번 다른 음성이 나온다.**
 *   2026-08-26 실측: seed 없이 같은 문장을 0.9 배속과 1.0 배속으로 각각 뽑았더니 **느리게 만든 쪽이
 *   더 짧게**(3.26초 vs 3.64초) 나왔다. 배속 때문이 아니라 **원본 합성이 서로 달랐기** 때문이다.
 *   그 상태로는 배속 A/B 를 판정할 수 없고, 대본을 고칠 때마다 그 문장 톤이 튄다.
 *   ⚠ 시드는 캐시 키에 들어가므로 **바꾸면 전량 재합성**이다. 시험 단계에서 확정할 것.
 *   `--seed 0` 을 주면 고정하지 않는다(매번 다른 결과).
 */
const DEFAULT_SEED = 20260826;

function parseArgs(argv) {
  const o = { _: [], speed: 1, speedMode: 'atempo', trim: true, voice: DEFAULT_VOICE, seed: DEFAULT_SEED };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--out') o.out = next();
    else if (a === '--voice') o.voice = next();
    else if (a === '--speed') o.speed = parseFloat(next());
    else if (a === '--speed-mode') o.speedMode = next();
    else if (a === '--seed') { const v = parseInt(next(), 10); o.seed = (v > 0 ? v : undefined); }
    else if (a === '--no-trim') o.trim = false;
    else if (a === '--pad') o.padSec = parseFloat(next());
    else if (a === '--dict') o.dict = next();
    else if (a === '--prefix') o.prefix = next();
    else if (a === '--only') o.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--limit') o.limit = parseInt(next(), 10);
    else if (a === '--force') o.force = true;
    else if (a === '--dry') o.dry = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else o._.push(a);
  }
  return o;
}

function usage() {
  console.log('사용법: node tsv-tts.js <입력.tsv> --out <출력폴더> [옵션]');
  console.log('       node tsv-tts.js --help   (옵션 전체)');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o._.length) { usage(); process.exit(o.help ? 0 : 1); }

  const tsvPath = o._[0];
  if (!fs.existsSync(tsvPath)) { console.error('입력 파일이 없습니다: ' + tsvPath); process.exit(1); }
  if (!o.out) { console.error('--out <출력폴더> 가 필요합니다.'); process.exit(1); }

  // ── TSV ──
  const parsed = T.parseTsv(fs.readFileSync(tsvPath, 'utf8'));
  if (parsed.errors.length) {
    console.error('TSV 오류 ' + parsed.errors.length + '건 — 하나라도 있으면 만들지 않습니다:');
    parsed.errors.forEach((e) => console.error('  ' + e.line + '행: ' + e.message));
    process.exit(1);
  }
  let rows = parsed.rows;
  if (o.only) {
    const want = new Set(o.only);
    rows = rows.filter((r) => want.has(r.name));
    const missing = o.only.filter((n) => !rows.some((r) => r.name === n));
    if (missing.length) console.error('⚠ --only 에서 못 찾은 이름: ' + missing.join(', '));
  }
  if (o.limit > 0) rows = rows.slice(0, o.limit);
  if (!rows.length) { console.error('처리할 행이 없습니다.'); process.exit(1); }

  // ── 발음사전 ──
  let dict = [];
  if (o.dict) {
    if (!fs.existsSync(o.dict)) { console.error('사전 파일이 없습니다: ' + o.dict); process.exit(1); }
    dict = T.parseDictMd(fs.readFileSync(o.dict, 'utf8'));
  }

  console.log('입력      ' + tsvPath + '  (' + rows.length + '행)');
  console.log('출력      ' + o.out);
  console.log('목소리    ' + o.voice);
  console.log('배속      ' + o.speed + '  (' + o.speedMode + ')');
  console.log('시드      ' + (o.seed != null ? o.seed + ' (고정 — 같은 문장은 항상 같은 음성)' : '없음 (매번 달라집니다)'));
  console.log('무음 트림 ' + (o.trim ? ('예 (여백 ' + (o.padSec != null ? o.padSec : 0.04) + '초)') : '아니오'));
  console.log('발음사전  ' + (dict.length ? (dict.length + '항목  ' + o.dict) : '없음'));
  if (o.prefix) console.log('접두      ' + o.prefix);
  if (o.force) console.log('강제      캐시를 무시하고 전부 다시 만듭니다');

  // ── 어떤 문장이 사전에 걸리는지 미리 보여준다(조용히 바뀌지 않게) ──
  if (dict.length) {
    const { processForTTS } = require('./tts/text-pronouncer');
    const hits = rows.filter((r) => processForTTS(r.text, dict) !== r.text);
    console.log('사전 적용 ' + hits.length + '행');
    hits.slice(0, 10).forEach((r) => {
      console.log('   ' + r.name + ': ' + r.text + '  ->  ' + processForTTS(r.text, dict));
    });
  }

  if (o.dry) { console.log('\n--dry 라 여기서 멈춥니다.'); return; }

  // ── TTS 연결 ──  ⚠ makeTtsManager 는 {mgr, ok} 를 돌려준다(매니저 자체가 아니다).
  console.log('\nOmniVoice 연결 중...');
  const { mgr, ok } = await P.makeTtsManager((m) => console.log('  ' + m), 'omnivoice');
  if (!ok) { console.error('OmniVoice 에 연결하지 못했습니다. 서버 주소·기동 상태를 확인하세요.'); process.exit(1); }

  const t0 = Date.now();
  const res = await T.runTsvBatch({
    rows, outDir: o.out, ttsMgr: mgr,
    voice: o.voice, speed: o.speed, speedMode: o.speedMode, seed: o.seed,
    trim: o.trim, padSec: o.padSec, dict,
    prefix: o.prefix, force: o.force,
    onLine: (m) => console.log(m),
  });

  const el = (Date.now() - t0) / 1000;
  console.log('\n────────────────────────────');
  console.log('만듦 ' + res.made + ' · 건너뜀 ' + res.skipped + ' · 실패 ' + res.failed.length + ' / 전체 ' + res.total);
  console.log('오디오 합계 ' + (res.totalDurationSec / 60).toFixed(1) + '분'
    + (res.totalTrimmedSec ? ('  (무음 ' + res.totalTrimmedSec.toFixed(1) + '초 제거)') : ''));
  console.log('걸린 시간 ' + el.toFixed(1) + '초'
    + (res.made ? ('  · 문장당 ' + (el / res.made).toFixed(2) + '초') : ''));
  if (res.failed.length) {
    console.log('\n실패 목록 (' + res.failedPath + '):');
    res.failed.forEach((f) => console.log('  ' + f.name + ' — ' + f.reason));
    process.exitCode = 2;
  }
}

main().catch((e) => { console.error('\n오류: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
