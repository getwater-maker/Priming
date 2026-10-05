#!/usr/bin/env node
'use strict';
/**
 * 🎙 참조음성 만들기 CLI (v0.6.99 · 채널사업부 요청 2026-10-05 · 로이 「B 안」 확정)
 *   세션(Claude Code)이 참조음성을 만들고 검증할 때 OmniVoice API 키를 직접 다루지 않게 하는 **공식 입구**.
 *   앱 보이스디자인 창과 **같은 함수**(core/ref-voice · wav-slice · tts-backcheck · qwen-design · asr-client)를 쓴다.
 *   🔒 키는 앱의 키 저장소에서 서버 호출 모듈(omnivoice-provider · asr-client)이 안에서 읽는다 — 이 도구는 키를 읽거나 출력하지 않는다.
 *
 * 사용:
 *   node tools/ref-voice.js --lang ja --name JA_수면_남1 --instruct "<목소리 설명>" [--text "<참조문>"] [--takes 4] [--register]
 *        [--verify "문장1|문장2|문장3"] [--min 0.9] [--out <폴더>] [--overwrite]
 *   node tools/ref-voice.js --lang ja --verify-only JA_수면_남1     (이미 등록한 목소리를 새 문장으로 역대조만)
 *   한국어 별칭: --언어 --이름 --설명 --문장 --테이크 --등록 --검증 --최소 --출력 --검증만
 *
 * 순서: ① 테이크 n개(ja·ko = 보이스디자인 9893 · vi = OmniVoice 목소리 설명) ② 문장 사이 쉼에서 자르기(앱과 같은 cutRange)
 *       ③ 잘라낸 구간 받아쓰기 → 참조텍스트를 잘린 구간에 맞춤(refTextForCut) → 일치율(textMatchRatio) · 기준 미달 테이크 버림
 *       ④ --register 면 가장 좋은 테이크를 이 PC + 서버 공용 라이브러리에 등록(같은 이름이 서버에 있으면 멈춤 · --overwrite 로만)
 *       ⑤ 새 문장 3개를 합성(등록했으면 ref_name · 아니면 잘라낸 파일)해 역대조(tts-backcheck.checkAudio) ⑥ 결과표 TSV · 들어 볼 WAV 경로
 * 끝 코드: 0 = 역대조 통과(등록을 요청했으면 등록까지) · 1 = 미달·실패 · 2 = 사용법 오류
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const RV = require(path.join(ROOT, 'core', 'ref-voice'));
const WS = require(path.join(ROOT, 'core', 'wav-slice'));
const BC = require(path.join(ROOT, 'core', 'tts-backcheck'));
const QD = require(path.join(ROOT, 'core', 'qwen-design'));
const ASR = require(path.join(ROOT, 'tts', 'asr-client'));

const ALIAS = { '언어': 'lang', '이름': 'name', '설명': 'instruct', '문장': 'text', '테이크': 'takes', '등록': 'register', '검증': 'verify', '최소': 'min', '출력': 'out', '검증만': 'verify-only', '덮어쓰기': 'overwrite' };
const FLAGS = new Set(['register', 'overwrite', 'help']);
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; if (!a.startsWith('--')) continue;
    let k = a.slice(2), v; const eq = k.indexOf('=');
    if (eq >= 0) { v = k.slice(eq + 1); k = k.slice(0, eq); }
    k = ALIAS[k] || k;
    if (FLAGS.has(k)) { o[k] = true; continue; }
    if (v == null) v = argv[++i];
    o[k] = v;
  }
  return o;
}
const say = (s) => process.stdout.write(s + '\n');
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + ' KST';
const tsvEsc = (v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
const pct = (x) => (x == null ? '' : (x * 100).toFixed(1));
// 🔒 사람 말 오류 — 혹시 메시지에 키 모양 글자가 섞여도 지운다(서버가 헤더를 되돌려 주는 일은 없지만 이중 안전)
const clean = (s) => String(s || '').replace(/(x-api-key|api[_-]?key)\s*[:=]\s*\S+/gi, '$1: ***');

async function synthWith(provider, text, lang, ref) {
  return provider.synthesize(text, { ...ref, language: RV.CODE_OF[lang], seed: 12345 });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || (!o.name && !o['verify-only'])) {
    say('사용: node tools/ref-voice.js --lang ja|ko|vi --name <이름> --instruct "<목소리 설명>" [--text "<참조문>"] [--takes 4] [--register] [--verify "a|b|c"] [--min 0.9] [--out <폴더>]');
    say('      node tools/ref-voice.js --lang ja --verify-only <등록된 이름>');
    return 2;
  }
  const lang = RV.LANG_OF[o.lang || 'ko'];
  if (!lang) { say(`✗ 언어는 ko · ja · vi 중 하나입니다 (받은 값: ${o.lang})`); return 2; }
  const code = RV.CODE_OF[lang];
  const name = String(o.name || o['verify-only']).trim().replace(/[\\/:*?"<>|]/g, '');
  const verifyTexts = o.verify ? String(o.verify).split('|').map((s) => s.trim()).filter(Boolean) : RV.VERIFY_TEXTS[lang];
  const minTake = o.min != null ? Number(o.min) : 0.9;
  const passVerify = BC.PASS[code] || 0.85;
  const outDir = path.resolve(o.out || path.join(os.homedir(), '.flow-app', 'ref-design', name));
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];   // TSV 줄
  say(`🎙 참조음성 만들기 — ${name} · ${lang} · 결과 폴더 ${outDir}`);

  // OmniVoice 합성기(역대조용) — 키는 provider 가 앱 설정에서 안에서 읽는다
  const { OmniVoiceProvider } = require(path.join(ROOT, 'tts', 'providers', 'omnivoice-provider'));
  const cfg = require(path.join(ROOT, 'tts', 'tts-config')).getProvider('omnivoice');
  const omni = new OmniVoiceProvider({ baseUrl: cfg.baseUrl });

  let best = null, refName = null, regOk = true;
  if (!o['verify-only']) {
    const instruct = String(o.instruct || '').trim();
    if (!instruct) { say('✗ --instruct(목소리 설명)이 필요합니다'); return 2; }
    const text = String(o.text || RV.SAMPLE_TEXT[lang]).trim();
    const takes = Math.max(1, Math.min(10, Number(o.takes) || 4));
    if (lang !== 'vi') {
      say('   보이스디자인 서버 준비…');
      const st = await QD.start((l) => say('   ' + l)).catch((e) => ({ ok: false, error: e.message }));
      if (!st || !st.ok) { say('✗ 보이스디자인 서버(9893)를 준비하지 못했습니다 — ' + clean(st && st.error)); return 1; }
    }
    for (let t = 1; t <= takes; t++) {
      const seed = Math.floor(Math.random() * 1e6);
      const r = lang === 'vi' ? await ASR.designVoiceOmni({ text, instruct, language: 'vi', seed }) : await QD.generate({ instruct, text, language: lang });
      if (!r || !r.ok) { say(`   ✗ 테이크 ${t} 생성 실패 — ${clean(r && r.error)}`); rows.push(['테이크', t, '', '', '생성 실패', '', clean(r && r.error)]); continue; }
      const full = path.join(outDir, `take${t}_full.wav`); fs.writeFileSync(full, r.buffer);
      const cut = RV.cutRange(r.buffer, lang);
      const cutBuf = cut ? WS.sliceWav(r.buffer, cut.start, cut.end) : r.buffer;
      const cutPath = path.join(outDir, `take${t}.wav`); fs.writeFileSync(cutPath, cutBuf);
      // 판정 = **통째 테이크** 받아쓰기 vs 원문(앱 보이스디자인 창의 일치율과 같다). 잘라낸 구간 받아쓰기는 참조텍스트를 잘린 데에 맞추는 데만 쓴다
      //   (🔴 잘라낸 구간끼리 비교하면 참조텍스트가 받아쓰기에서 나온 경우 늘 100% 가 된다 — 첫 실측에서 잡음)
      const cf = await BC.checkAudio(r.buffer, text, code, outDir).catch(() => null);
      const heardFull = (cf && cf.heard) || '';
      const match = heardFull && !(cf && cf.unknown) ? RV.textMatchRatio(text, heardFull) : null;
      const c = await BC.checkAudio(cutBuf, text, code, outDir).catch(() => null);
      const heard = (c && c.heard) || '';
      const refText = (c && !c.unknown && heard) ? BC.refTextForCut(text, heard, code) : text;
      const sec = WS.parseWav(cutBuf).durationSec;
      const okTake = match != null && match >= minTake;
      say(`   ${okTake ? '✓' : '✗'} 테이크 ${t}: ${sec.toFixed(1)}초 · 일치 ${match == null ? '확인 불가' : pct(match) + '%'} · 참조텍스트 「${refText}」`);
      rows.push(['테이크', t, sec.toFixed(2), pct(match), okTake ? '통과' : '미달', refText, heardFull, cutPath]);
      if (okTake && (!best || match > best.match || (match === best.match && sec > best.sec))) best = { t, match, sec, cutPath, cutBuf, refText, instruct };
    }
    if (lang !== 'vi') { try { await QD.stop(() => {}); } catch (_) {} }   // VRAM 반납(/release — 서버는 끄지 않는다)
    if (!best) { say(`✗ 기준(${pct(minTake)}%) 넘는 테이크가 없습니다 — 설명·참조문을 바꾸거나 --takes 를 늘려 보세요`); writeTsv(outDir, name, lang, rows); return 1; }
    say(`   → 테이크 ${best.t} 선택 (${pct(best.match)}% · ${best.sec.toFixed(1)}초)`);
    fs.copyFileSync(best.cutPath, path.join(outDir, `${name}.wav`)); fs.writeFileSync(path.join(outDir, `${name}.txt`), best.refText, 'utf8');
    if (o.register) {
      const list = await ASR.listServerVoices().catch(() => null);
      const names = Array.isArray(list) ? list.map((v) => String((v && (v.name || v)) || '').replace(/\.wav$/i, '')) : (list && Array.isArray(list.voices) ? list.voices.map((v) => String(v.name || v).replace(/\.wav$/i, '')) : null);
      if (!names && !o.overwrite) { say('✗ 서버 라이브러리 목록을 확인하지 못해 등록을 멈춥니다(같은 이름을 덮어쓸 수 있어서) — 서버를 확인하거나 --overwrite'); writeTsv(outDir, name, lang, rows); return 1; }
      if (names && names.includes(name) && !o.overwrite) { say(`✗ 서버 라이브러리에 「${name}」 이 이미 있습니다 — 다른 이름을 쓰거나 --overwrite`); writeTsv(outDir, name, lang, rows); return 1; }
      const loc = RV.saveLocal(name, best.cutBuf, best.refText);
      const up = await RV.saveToLibrary({ name: loc.base, text: best.refText, instruct: best.instruct, wavBuffer: best.cutBuf });
      if (!up || !up.ok) { regOk = false; say(`✗ 서버 라이브러리 등록 실패 — ${clean(up && up.error)} (이 PC 에는 ${loc.wavPath} 로 저장됨)`); }
      else { refName = String(up.name || loc.base).replace(/\.wav$/i, ''); say(`   ☁ 등록: ${refName}${up.via === 'voicedesign' ? ' (보이스디자인 서버 경유)' : ''} · 이 PC ${loc.wavPath}`); }
    }
  } else refName = name;

  // ⑤ 새 문장 역대조
  const ok0 = await omni.init().catch(() => false);
  if (!ok0) { say(`✗ OmniVoice(${cfg.baseUrl || '주소 없음'})에 연결하지 못했습니다 — 역대조를 못 했습니다`); writeTsv(outDir, name, lang, rows); return 1; }
  const ref = refName ? { refName } : { refAudioPath: best.cutPath, refText: best.refText };
  say(`   🔎 새 문장 ${verifyTexts.length}개 역대조 — ${refName ? `ref_name「${refName}」(서버 라이브러리)` : '잘라낸 파일(등록 전)'} · 기준 ${pct(passVerify)}%`);
  let pass = 0;
  for (let i = 0; i < verifyTexts.length; i++) {
    const s = verifyTexts[i];
    try {
      const r = await synthWith(omni, s, lang, ref);
      const p = path.join(outDir, `verify${i + 1}.wav`); fs.writeFileSync(p, r.mp3Buffer);
      const c = await BC.checkAudio(r.mp3Buffer, s, code, outDir);
      const okV = !!(c && c.ok && !c.unknown);
      if (okV) pass++;
      say(`   ${okV ? '✓' : c && c.unknown ? '?' : '✗'} 「${s}」 ${c && c.score != null ? pct(c.score) + '%' : '확인 불가'} → 「${(c && c.heard) || ''}」`);
      rows.push(['역대조', i + 1, '', c && c.score != null ? pct(c.score) : '', okV ? '통과' : (c && c.unknown ? '확인 불가' : '미달'), s, (c && c.heard) || '', p]);
    } catch (e) { say(`   ✗ 「${s}」 합성 실패 — ${clean(e.message)}`); rows.push(['역대조', i + 1, '', '', '합성 실패', s, clean(e.message), '']); }
  }
  const tsv = writeTsv(outDir, name, lang, rows);
  const allOk = pass === verifyTexts.length && regOk && (!o.register || !!refName || !!o['verify-only']);
  say(`${allOk ? '✅' : '❌'} 역대조 ${pass}/${verifyTexts.length}${o.register ? (refName ? ' · 등록됨' : ' · 등록 안 됨') : ''} — 결과표 ${tsv}`);
  return allOk ? 0 : 1;
}
function writeTsv(dir, name, lang, rows) {
  const f = path.join(dir, `${name}_결과.tsv`);
  const head = [`# 참조음성 만들기 — ${name} · ${lang} · ${kst()}`, ['단계', '번호', '길이(초)', '일치율(%)', '상태', '글(참조텍스트·원문)', '받아쓰기', '파일'].join('\t')];
  fs.writeFileSync(f, '﻿' + [...head, ...rows.map((r) => r.map(tsvEsc).join('\t'))].join('\r\n') + '\r\n', 'utf8');
  return f;
}
if (require.main === module) main().then((code) => process.exit(code)).catch((e) => { process.stdout.write('✗ ' + clean(e && e.message) + '\n'); process.exit(1); });
module.exports = { parseArgs, clean };
