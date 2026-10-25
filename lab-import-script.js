'use strict';
/**
 * node lab-import-script.js <작업본 이름 일부> [--dry] [--force] — 원본 Priming 에서 만든 대본 하나를 **그림·음성·작업본까지** Priming Lab 으로 복사한다.
 *   Lab 은 원본과 데이터를 분리해 두므로(홈 = D:\Priming-VrewLab-data\home · 출력 = D:\Priming-VrewLab-data\output) 대본(.md)만 열면 그림·음성이 따라오지 않는다.
 *   · 원본은 읽기만 한다(쓰지 않는다 · 지우지 않는다).
 *   · 복사하는 것 ① 대본 .md → Lab scripts ② 출력 폴더(media-N·tts-N·.vrew …) → Lab output/<폴더이름> ③ 작업본(.smproj.json) — 안의 절대경로를 Lab 폴더로 바꿔 쓴다
 *     (바꾸지 않으면 Lab 편집이 원본 그림·음성 파일을 건드린다).
 *   · 이미 Lab 에 있으면 건너뛴다(--force 면 덮어씀). --dry = 무엇을 얼마나 복사할지만 보여 준다.
 *   보통 셸(진짜 홈)에서 실행한다 — lab-start.ps1 안에서 돌리면 원본 홈을 못 찾는다.
 */
const fs = require('fs'), path = require('path'), os = require('os');

const DATA = 'D:\\Priming-VrewLab-data';
const SRC = os.homedir();
const DST = path.join(DATA, 'home');
const dry = process.argv.includes('--dry');
const force = process.argv.includes('--force');
const query = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
if (path.resolve(SRC).toLowerCase() === path.resolve(DST).toLowerCase()) { console.error('지금 홈이 Lab 홈입니다 — 보통 셸에서 실행하세요'); process.exit(1); }
if (!query) { console.error('사용법: node lab-import-script.js "<대본 이름 일부>" [--dry] [--force]'); process.exit(1); }

const srcProj = path.join(SRC, '.priming-maker', 'projects');
const dstProj = path.join(DST, '.priming-maker', 'projects');
const all = fs.existsSync(srcProj) ? fs.readdirSync(srcProj).filter((f) => f.endsWith('.smproj.json')) : [];
const hits = all.filter((f) => f.toLowerCase().includes(query.toLowerCase()));
if (!hits.length) { console.error(`원본 작업본에서 「${query}」 를 못 찾았습니다(${srcProj})`); process.exit(1); }
if (hits.length > 1) { console.error(`「${query}」 에 맞는 작업본이 ${hits.length}개입니다 — 더 길게 적어 주세요:\n` + hits.slice(0, 15).map((h) => '  · ' + h.replace(/\.smproj\.json$/, '')).join('\n')); process.exit(1); }

const name = hits[0];
let text = fs.readFileSync(path.join(srcProj, name), 'utf8');
const snap = JSON.parse(text);
const srcOut = snap.outRoot, srcScript = snap.scriptPath;
console.log(`작업본: ${name.replace(/\.smproj\.json$/, '')}`);
console.log(`  원본 출력 폴더: ${srcOut || '(없음)'}`);
console.log(`  원본 대본 파일: ${srcScript || '(없음)'}`);

const dstOut = srcOut ? path.join(DATA, 'output', path.basename(srcOut)) : null;
const dstScript = srcScript ? path.join(DATA, 'scripts', path.basename(srcScript)) : null;

function dirSize(d) { let n = 0, c = 0; const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) walk(f); else { try { n += fs.statSync(f).size; c++; } catch (_) {} } } }; try { walk(d); } catch (_) {} return { n, c }; }
const mb = (n) => (n / 1048576).toFixed(0) + 'MB';

const plan = [];
if (srcScript && fs.existsSync(srcScript)) plan.push(['대본', srcScript, dstScript]); else console.log('  ⚠ 원본 대본 파일을 못 찾았습니다 — 작업본·출력만 복사합니다(대본은 직접 Lab scripts 에 넣으세요)');
let outInfo = null;
if (srcOut && fs.existsSync(srcOut)) { outInfo = dirSize(srcOut); plan.push(['출력 폴더', srcOut, dstOut]); } else console.log('  ⚠ 원본 출력 폴더를 못 찾았습니다(G: 드라이브가 연결돼 있나요?) — 작업본만 복사합니다(그림·음성 경로는 비어 있게 됩니다)');
plan.push(['작업본', path.join(srcProj, name), path.join(dstProj, name)]);
console.log('\n복사 계획:');
for (const [k, a, b] of plan) console.log(`  · ${k}: ${a}\n      → ${b}${fs.existsSync(b) && !force ? '   (이미 있음 — 건너뜀)' : ''}`);
if (outInfo) console.log(`  · 출력 폴더 크기 ${mb(outInfo.n)} · 파일 ${outInfo.c}개`);
if (dry) { console.log('\n--dry 라서 여기서 멈춥니다.'); process.exit(0); }

let done = 0;
for (const [k, a, b] of plan) {
  if (fs.existsSync(b) && !force) { console.log(`  · ${k} 건너뜀(이미 있음)`); continue; }
  fs.mkdirSync(path.dirname(b), { recursive: true });
  if (k === '출력 폴더') fs.cpSync(a, b, { recursive: true, force: true });
  else if (k === '작업본') {
    // 절대경로 바꿔 쓰기 — JSON 안에서는 역슬래시가 이스케이프된 꼴(\\\\)과 슬래시 꼴이 모두 올 수 있다
    const swap = (s, from, to) => {
      if (!from || !to) return s;
      const forms = (p) => [p, p.replace(/\\/g, '/'), JSON.stringify(p).slice(1, -1), JSON.stringify(p.replace(/\\/g, '/')).slice(1, -1)];
      const F = forms(from), T = forms(to);
      for (let i = 0; i < F.length; i++) s = s.split(F[i]).join(T[i]);
      return s;
    };
    let t2 = swap(text, srcOut, dstOut);
    t2 = swap(t2, srcScript, dstScript);
    const j2 = JSON.parse(t2);   // 깨졌으면 여기서 던진다
    j2.outRoot = dstOut || j2.outRoot; j2.scriptPath = dstScript || j2.scriptPath;
    fs.writeFileSync(b, JSON.stringify(j2));
  } else fs.copyFileSync(a, b);
  console.log(`  ✓ ${k}`);
  done++;
}
// 확인 — 새 작업본에 원본 폴더 경로가 남았는지
if (srcOut) {
  try {
    const chk = fs.readFileSync(path.join(dstProj, name), 'utf8');
    const left = [srcOut, srcOut.replace(/\\/g, '/'), JSON.stringify(srcOut).slice(1, -1)].some((f) => chk.includes(f));
    console.log(left ? '\n⚠ 새 작업본에 원본 폴더 경로가 남아 있습니다 — Lab 편집이 원본 파일에 닿을 수 있으니 알려 주세요' : '\n✓ 새 작업본에는 원본 폴더 경로가 남아 있지 않습니다(전부 Lab 폴더로 바꿈)');
  } catch (_) {}
}
console.log(`\n끝 — ${done}개 복사. Lab 에서 「${dstScript ? path.basename(dstScript) : '대본'}」 을 열면 그림·음성이 그대로 보입니다.`);
