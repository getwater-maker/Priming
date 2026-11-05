'use strict';
/**
 * node test/no-directive.test.js [--write] — 🔒 지시 줄이 없으면 출력이 바이트 단위로 같다(2.0 덧붙임4 회귀 기준 · v1.0.29)
 *   2.0 의 새 장면 지시 줄(💬 대사카드 · 🎞 판 · 🎞 움직임 …)은 **줄이 있을 때만** 켜진다. 줄이 없는 제작본(= 지금 주문 · 롱폼)은
 *   대본 → 카드 마커 → 쉼 계획 → 빌드 지문 → .vrew(project.json) → MP4 까지 **덧붙임4 이전 코드와 같은 바이트**여야 한다.
 *   기준값(test/fixtures/no-directive.golden.json)은 덧붙임4 코드를 넣기 **전** 코드(v1.0.28)로 `--write` 해서 찍었다.
 *   ⛔ 이 시험이 깨지면 지시 줄 없는 출력이 바뀐 것 — 의도한 변화(렌더러 개선 등)일 때만 `--write` 로 기준을 다시 찍고 작업노트에 까닭을 적는다.
 *   [2] 판정력 — 같은 대본에 지시 줄을 넣으면 실제로 달라지고 그 장치가 MP4 에 보이는지(새 지시 줄을 더할 때마다 여기에 한 칸씩).
 */
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const P = require('../core/pipeline');
const SC = require('../core/screen-cards');
const R = require('../core/vrew-render');
const FF = require('../core/media-utils').getFfmpegPath();
const GOLD = path.join(__dirname, 'fixtures', 'no-directive.golden.json');
const WRITE = process.argv.includes('--write');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const RID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|^(?=[a-zA-Z]*\d)[0-9a-zA-Z]{10}(?=\.|$)/;   // uuid · 빌더가 뽑는 10글자 이름(파일 이름 앞부분 포함)
const RIDG = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?<=^|[\\/])(?=[a-zA-Z]*\d)[0-9a-zA-Z]{10}(?=\.|$)/g;
/** 무작위 id 를 지우고 id 로 엮은 묶음은 내용 차례로 — 그 밖의 값·차례는 그대로 */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === 'string') return v.replace(RIDG, '*').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<시각>');   // 만든 시각(comment)
  if (!v || typeof v !== 'object') return v;
  const ks = Object.keys(v);
  if (ks.some((k) => RID.test(k))) return ks.map((k) => [RID.test(k) ? '*' : k, canon(v[k])]).map((e) => JSON.stringify(e)).sort();
  const o = {}; for (const k of ks) o[k] = canon(v[k]); return o;
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** 대본 글 → 마커 · 쉼 · 지문 · .vrew · MP4 (임시 폴더 dir) */
async function run(raw, dir, keep, qs) {
  const norm = (s) => String(s).split(dir).join('<T>').split(dir.replace(/\\/g, '\\\\')).join('<T>').split(dir.replace(/\\/g, '/')).join('<T>');
  const out = {};
  const preset = { interludePauseSec: 2 };   // 채널 막간 쉼이 켜져 있어도 카드 줄이 없으면 쉼이 없다
  const markers = SC.markersOf(raw);
  out.markers = JSON.stringify(markers);
  const r = P.parseScriptText(raw, 'longform', {});
  const pr = r.projects[0];
  if (markers.length) pr.screenCards = markers;   // main 이 대본을 열 때와 같은 규칙(줄이 있을 때만 싣는다)
  pr.groups.forEach((g, i) => { const img = path.join(dir, `g${i}.png`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x${(0x203050 + i * 0x101010).toString(16)}:s=1344x768`, '-frames:v', '1', img]); g.imagePath = img; });
  pr.sentences.forEach((s, i) => { const mp3 = path.join(dir, `s${i}.mp3`); const d = 1.2 + 0.1 * i; execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=f=${300 + 40 * i}:d=${d}`, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', mp3]); s.ttsAudioPath = mp3; s.ttsDurationSec = d; });
  out.groups = JSON.stringify(pr.groups.map((g) => [g.num, g.title, g.sentenceIds.length]));
  out.pausePlan = JSON.stringify([...P.pausePlanOf(pr, preset).map]);
  out.inputs = sha(norm(JSON.stringify(P.vrewInputsOf(pr, preset, 20))));
  const plan = SC.plan(pr, pr.screenCards || [], { pauseSec: preset.interludePauseSec });
  out.cards = JSON.stringify(plan.cards);
  const vrew = path.join(dir, 't.vrew');
  await P.buildProjectVrew(pr, vrew, preset, () => {}, 20, 1);
  const pj = new AdmZip(vrew).readAsText('project.json');
  { const cj = JSON.stringify(canon(JSON.parse(norm(pj)))); if (process.env.ND_DUMP) fs.writeFileSync(process.env.ND_DUMP, cj); out.projectJson = sha(cj); }   // .vrew 는 실행마다 새 id 를 뽑고 id 로 엮은 묶음의 차례도 바뀐다 → id 를 지우고 내용으로 비교
  out.fxSide = fs.existsSync(vrew + '.fx.json');
  const mp4 = path.join(dir, 't.mp4');
  const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 2, dissolveSec: 0, fx: null, cards: plan.cards.length ? plan.cards.map((c) => (qs && c.kind === 'quote' ? { ...c, qs } : c)) : null, info: null, infoSeed: 't' });
  if (!res || !res.ok) throw new Error('렌더 실패 ' + (res && res.error));
  out.mp4 = sha(fs.readFileSync(mp4));
  if (keep) keep.push({ mp4, plan, pr });
  return out;
}
const durOf = (f) => { try { execFileSync(FF, ['-hide_banner', '-i', f], { stdio: 'pipe' }); } catch (e) { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(e.stderr)); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0; } return 0; };
/** 그 시각 프레임에서 (색 rgb 와 가까운 화소 비율, 밝은 글자 화소 수) */
function frameAt(f, t, rgb) {
  const b = execFileSync(FF, ['-loglevel', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=480:270,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
  let near = 0, bright = 0; const n = b.length / 3;
  for (let i = 0; i < b.length; i += 3) { if (Math.abs(b[i] - rgb[0]) + Math.abs(b[i + 1] - rgb[1]) + Math.abs(b[i + 2] - rgb[2]) < 24) near++; if (b[i] > 200 && b[i + 1] > 190) bright++; }
  return { near: near / n, bright };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodir-'));
  let out = {};
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'no-directive.md'), 'utf8').replace(/\r\n/g, '\n');
  try { out = await run(raw, tmp); }
  catch (e) { ok(false, '실행 실패: ' + (e && e.stack || e)); }
  if (WRITE && !fail) { fs.writeFileSync(GOLD, JSON.stringify(out, null, 2) + '\n'); console.log('  ✎ 기준 기록: ' + GOLD); }
  else if (!WRITE) {
    console.log('[1] 지시 줄 없는 제작본 = 덧붙임4 이전 코드와 같은 출력');
    const G = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
    ok(out.markers === '[]', '지시 줄이 없으면 카드 마커 0');
    for (const k of Object.keys(G)) ok(JSON.stringify(out[k]) === JSON.stringify(G[k]), `${k} 가 기준과 같다${out[k] === G[k] ? '' : ` (지금 ${String(out[k]).slice(0, 24)} · 기준 ${String(G[k]).slice(0, 24)})`}`);
    console.log('[2] 판정력 — 💬 대사카드 한 줄을 넣으면');
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nodir2-'));
    try {
      const raw2 = raw.replace('### 말하는 뱀\n', '### 말하는 뱀\n\n> 💬 대사카드: 뱀 | 하나님이 참으로 // 그렇게 말씀하시더냐\n');
      const keep = [];
      const o2 = await run(raw2, dir2, keep);
      const { mp4, plan } = keep[0];
      const c = plan.cards[0] || {};
      ok(plan.cards.length === 1 && c.kind === 'quote' && c.speaker === '뱀' && (c.trans || []).join('/') === '하나님이 참으로/그렇게 말씀하시더냐', '카드 1장 · 말한 사람 · 대사 두 줄');
      ok(o2.mp4 !== G.mp4 && o2.projectJson !== G.projectJson && o2.inputs !== G.inputs, 'MP4 · .vrew · 빌드 지문이 모두 달라진다(시험이 헛단언이 아니다)');
      const pz = JSON.parse(o2.pausePlan);
      ok(pz.length === 1 && pz[0][1] === SC.QUOTE.def, `장면 끝 문장 뒤 무음 ${SC.QUOTE.def}초 한 곳`);
      ok(Math.abs(c.t1 - c.t0 - SC.QUOTE.def) < 1e-6, '카드 = 그 무음 동안(장면 끝 문장이 다 읽힌 뒤)');
      const d0 = durOf(mp4);
      ok(d0 > 0 && Math.abs(c.t1 - d0) < 0.3, `카드는 영상 끝 무음에 놓인다(카드 끝 ${Number(c.t1).toFixed(2)} · 영상 ${d0.toFixed(2)})`);
      const brown = [0x21, 0x1A, 0x13];
      const fEarly = frameAt(mp4, c.t0 + 0.5, brown), fLate = frameAt(mp4, c.t0 + 3.0, brown), fBefore = frameAt(mp4, c.t0 - 0.5, brown);
      ok(fLate.near > 0.85 && fBefore.near < 0.05, `카드 동안 화면 대부분이 갈색 판(${(fLate.near * 100).toFixed(0)}%) · 카드 전에는 없음(${(fBefore.near * 100).toFixed(0)}%)`);
      ok(fLate.bright > fEarly.bright * 1.5 && fLate.bright > 300, `글자가 차례로 찬다(0.5초 ${fEarly.bright} → 3초 ${fLate.bright} 화소)`);
    } catch (e) { ok(false, '판정력 실행 실패: ' + (e && e.stack || e)); }
    finally { try { fs.rmSync(dir2, { recursive: true, force: true }); } catch (_) {} }
    console.log('[3] 💬 덧붙임5 53 — 주문 칸 quoteCard(판 · 강조 · 글꼴)가 있으면 그 값으로');
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'nodir3-'));
    try {
      const raw3 = raw.replace('### 말하는 뱀\n', '### 말하는 뱀\n\n> 💬 대사카드: 뱀 | 하나님이 참으로 // 그렇게 말씀하시더냐\n');
      const qc = require('../core/order-contract').parseQuoteCard({ bg: '#1A3050', accent: '#40C0A0', font: path.join(__dirname, '..', 'assets', 'fonts', 'book', 'NanumMyeongjo-Bold.ttf') }).quoteCard;
      ok(qc && qc.bg === '1A3050' && qc.fontName && qc.fontFile, `칸 읽음(글꼴 이름 「${qc && qc.fontName}」)`);
      const keep = [];
      await run(raw3, dir3, keep, qc);
      const { mp4, plan } = keep[0];
      const c = plan.cards[0] || {};
      const fNew = frameAt(mp4, c.t0 + 3.0, [0x1A, 0x30, 0x50]), fOld = frameAt(mp4, c.t0 + 3.0, [0x21, 0x1A, 0x13]);
      ok(fNew.near > 0.85 && fOld.near < 0.02, `판이 주문 색(#1A3050 ${(fNew.near * 100).toFixed(0)}% · 옛 갈색 ${(fOld.near * 100).toFixed(0)}%)`);
      ok(fNew.bright > 300, `글자가 그려진다(${fNew.bright} 화소 — 주문 글꼴로)`);
      const fb = execFileSync(FF, ['-loglevel', 'error', '-ss', String(c.t0 + 3.0), '-i', mp4, '-frames:v', '1', '-vf', 'format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 25 });
      let green = 0; for (let i = 0; i < fb.length; i += 3) if (fb[i + 1] > 140 && fb[i + 1] - fb[i] > 60) green++;   // 강조 색 #40C0A0 쪽 화소(판 #1A3050 · 글자 흰빛과 다름)
      ok(green > 200, `말한 사람이 강조 색(#40C0A0 쪽 화소 ${green})`);
    } catch (e) { ok(false, '53 실행 실패: ' + (e && e.stack || e)); }
    finally { try { fs.rmSync(dir3, { recursive: true, force: true }); } catch (_) {} }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? '❌' : '✅'} no-directive ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
