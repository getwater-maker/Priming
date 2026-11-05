'use strict';
/**
 * node test/scene-directives.test.js — 🎞 장면 지시 줄(2.0 덧붙임4 ㊷ · v1.0.31)
 *   [1] 읽기(움직임 이름 · 판 · 모르는 이름) · [2] 장면 → 그룹(도입부 묶음 · 같은 글) · [3] 연달아 금지 · [4] 빌드에 실제로 닿는다(.vrew 켄번스)
 *   [5] 줄 없으면 아무것도 안 바뀜 · [6] 배선(파서 · 작업본 이어받기 · 결과서 칸)
 */
const fs = require('fs'), os = require('os'), path = require('path');
const AdmZip = require('adm-zip');
const { execFileSync } = require('child_process');
const SD = require('../core/scene-directives');
const P = require('../core/pipeline');
const KB = require('../core/ken-burns');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  console.log('[1] 읽기');
  ok(SD.motionId('줌인') === 'in' && SD.motionId('줌 아웃') === 'out' && SD.motionId('좌->우') === 'lr' && SD.motionId('우→좌 팬') === 'rl' && SD.motionId('아래 → 위') === 'bt' && SD.motionId('상→하 팬') === 'tb' && SD.motionId('없음') === 'none', '움직임 이름 여섯 + 없음(띄어쓰기 · -> 받음)');
  ok(SD.motionId('회전') === null && SD.motionId('') === null, '모르는 이름 = null');
  const md = '# t\n## 도입부\n### 샷1\n> 🎞 움직임: 줌인\n첫 문장입니다.\n### 샷2\n> 🎞 움직임: 줌아웃\n둘째 문장입니다.\n## 장1\n### 가\n> 🎞 판: 따로\n> 🎞 움직임: 좌→우 팬\n셋째 문장입니다.\n### 나\n> 🎞 움직임: 좌->우\n넷째 문장입니다.\n### 다\n> 🎞 움직임: 회전\n다섯째 문장입니다.\n### 라\n> 🎞 앞으로올줄: 무엇\n여섯째 문장입니다.\n';
  const L = SD.parse(md);
  ok(L.length === 6 && L.every((d) => d.first) && L.map((d) => d.first.ord).join() === '0,1,2,2,3,4', '지시 6줄(모르는 🎞 줄은 조용히 둔다) · 장면 첫 문장 순번');
  ok(L[5].error && /회전/.test(L[5].error), '모르는 움직임 이름은 오류 글');

  console.log('[2] 장면 → 그룹 · [3] 연달아 금지');
  const pr = P.parseScriptText(md, 'longform', {}).projects[0];   // 파서가 이미 apply 했다
  const sd = pr.sceneDirectives;
  ok(sd && sd.motionOrdered === 3 && sd.layerScenes === 1, '파서가 얹었다: 지정 움직임 3 · 판 따로 1 ' + JSON.stringify(sd && { m: sd.motionOrdered, l: sd.layerScenes }));
  const mo = pr.groups.map((g) => (g.look && g.look.motion) || '-').join(',');
  ok(mo === 'in,lr,rl,-,-', '도입부 두 장면 = 한 그룹(앞 장면 줌인이 이김) · 가 = 좌→우 · 나 = 좌→우 지정이지만 앞과 같아 우→좌 · 다(모르는 이름)·라 = 그대로 ' + mo);
  ok(sd.motionChanged.length === 1 && sd.motionChanged[0].g === 3 && /연달아/.test(sd.motionChanged[0].why), '바꾼 것은 결과서에(motionChanged)');
  ok(sd.warnings.length === 3 && sd.warnings.some((w) => /앞 장면 지시를 이미/.test(w)) && sd.warnings.some((w) => /회전/.test(w)) && sd.warnings.some((w) => /G2 — 판 따로 장면은 층 움직임이 이깁니다/.test(w)), '경고 3(도입부 겹침 · 모르는 이름 · 판 따로 + 움직임 = 층 움직임이 이김 v1.0.32)');
  ok(pr.groups[1].layered === true && !pr.groups[0].layered, '판 따로 = 그 그룹에 표시(layered)');
  ok(KB.patternIndexOf(pr.groups[0]) === 0 && KB.patternIndexOf(pr.groups[2]) === 3, '켄번스 패턴 = 지정 움직임(줌인 0 · 우→좌 3)');

  console.log('[4] 빌드에 닿는다');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scdir-'));
  try {
    pr.groups.forEach((g, i) => { const img = path.join(tmp, `g${i}.png`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x306090:s=1344x768', '-frames:v', '1', img]); g.imagePath = img; });
    pr.sentences.forEach((s, i) => { const mp3 = path.join(tmp, `s${i}.mp3`); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=d=1.5', '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', mp3]); s.ttsAudioPath = mp3; s.ttsDurationSec = 1.5; });
    const v = path.join(tmp, 't.vrew'); await P.buildProjectVrew(pr, v, {}, () => {}, 20, 1);
    const pj = JSON.parse(new AdmZip(v).readAsText('project.json'));
    const kbs = Object.values(pj.props.tracks).filter((t) => t.type === 'image' && t.kenburnsAnimationInfo).map((t) => t.kenburnsAnimationInfo);
    const z = KB.KEN_BURNS_PATTERNS;
    const same = (a, b) => Math.abs(a.scale - b.scale) < 1e-3 && Math.abs(a.centerX - b.centerX) < 1e-3 && Math.abs(a.centerY - b.centerY) < 1e-3;
    ok(kbs.length >= 3 && same(kbs[0].from, KB._clampKbFrame(z[0].from)) && same(kbs[0].to, KB._clampKbFrame(z[0].to)), '.vrew G1 트랙 = 줌인 패턴');
    ok(same(kbs[2].from, KB._clampKbFrame(z[3].from)), '.vrew G3 트랙 = 우→좌(연달아 금지로 바꾼 값)');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }

  console.log('[5] 줄 없으면');
  const plain = P.parseScriptText('# t\n## 장\n### 가\n문장입니다.\n', 'longform', {}).projects[0];
  ok(plain.sceneDirectives === undefined && !plain.groups[0].look && !plain.groups[0].layered, '지시 줄이 없으면 sceneDirectives·look·layered 를 만들지 않는다');
  ok(SD.apply(plain, '# t\n## 장\n### 가\n문장입니다.\n') === null, 'apply = null');

  console.log('[6] 배선');
  const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const LP = fs.readFileSync(path.join(__dirname, '..', 'core', 'parsers', 'longform-parser.js'), 'utf8');
  ok(/require\('\.\.\/scene-directives'\)\.apply\(proj, raw\)/.test(LP), '파서(처음 열기)가 apply');
  ok(/require\('\.\/core\/scene-directives'\)\.apply\(proj, sceneRaw\)/.test(M), '작업본 이어받기도 .md 에서 다시 apply(.md 가 정본)');
  ok(/motionOrdered:/.test(M) && /motionChanged:/.test(M) && /layerScenes:/.test(M) && /layerReverted:/.test(M), '결과서 ㊼ 칸(motionOrdered · motionChanged · layerScenes · layerReverted)');
  console.log(`\n${fail ? '❌' : '✅'} scene-directives ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
