'use strict';
// node test/tsv-images.test.js — 🖼 그림목록 TSV 파싱·일괄 생성 검증.
//
// 배경(2026-08-27): 강의 76강(D:\비즈니스PT)이 장면마다 선그림을 넣기로 했다. 지금까지는 로이가
//   ComfyUI 데스크탑에서 따로 만들어야 했다 → Priming 이 음성 만들 때 그림도 같이 만든다.
//
// 형식(음성 TSV 와 **다르다**): 헤더 한 줄 + 5칸
//   경로 · 장면번호 · 화면 한글(참고) · positive · negative
//
// 지키는 것:
//   ① 헤더를 **확장자로** 판별한다 — 라벨 문구를 못박으면 그쪽이 바꾸는 순간 첫 그림이 사라진다
//   ② 경로가 출력 폴더 밖으로 못 나간다(.. · 절대경로)
//   ③ 중복 경로는 **세운다** — 조용히 덮으면 그 장면이 영상에서 사라진다
//   ④ 프롬프트를 **손대지 않는다** — 화풍은 대본 쪽이 관리한다(로이 결정)
//   ⑤ **자리표시 파일을 「이미 있음」으로 보지 않는다** — 실사고: 70바이트 png 12개를 완성본으로
//      보고 한 장도 안 만든 채 "완료" 라고 보고했다
//
//   🔑 로직을 복사하지 않는다 — core/tsv-images.js 원문을 require 해 실행한다.

const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../core/tsv-images');

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + '  (기대 ' + JSON.stringify(b) + ' / 실제 ' + JSON.stringify(a) + ')');

const HEADER = '파일 경로\t장면\t화면 글\tpositive\tnegative';
const row = (p, s, c, pos, neg) => [p, s, c, pos, neg].join('\t');

console.log('\n[1] 헤더 판별 — 확장자로 가른다(라벨 문구에 기대지 않는다)');
{
  const r = T.parseImageTsv([HEADER, row('a/x.png', 'R-01', '한글', 'scene one', 'text')].join('\n'));
  eq(r.headerSkipped, true, '첫 줄이 경로가 아니면 헤더로 본다');
  eq(r.rows.length, 1, '데이터 1행');
  eq(r.errors.length, 0, '오류 없음');
}
{
  // 라벨을 바꿔도 동작해야 한다 — 이게 확장자로 판별하는 이유다.
  const r = T.parseImageTsv(['path\tscene\tcaption\tpos\tneg', row('a/x.png', 'R-01', '한글', 'scene', '')].join('\n'));
  eq(r.rows.length, 1, '헤더 라벨이 영어여도 건너뛴다');
}
{
  const r = T.parseImageTsv([row('a/x.png', 'R-01', '한글', 'scene', '')].join('\n'));
  eq(r.headerSkipped, false, '헤더가 없으면 없는 대로 읽는다');
  eq(r.rows.length, 1, '첫 줄도 데이터로 읽는다(그림이 사라지지 않는다)');
}

console.log('[2] 경로 안전 — 출력 폴더 밖으로 못 나간다');
const bads = [
  ['../x.png', '상위 폴더'],
  ['a/../../x.png', '중간의 ..'],
  ['C:/x.png', '절대경로(드라이브)'],
  ['/x.png', '절대경로(루트)'],
  ['a/x.txt', '이미지 확장자가 아님'],
  ['', '빈 경로'],
];
bads.forEach(([p, why]) => {
  const r = T.parseImageTsv([HEADER, row(p, 'R', 'c', 'pos', '')].join('\n'));
  eq(r.rows.length, 0, '거부: ' + why + ' (' + p + ')');
  ok(r.errors.length === 1, '  이유를 남긴다');
});
{
  const r = T.normalizeRelPath('003_돈이\\R-02.png');
  eq(r.rel, '003_돈이/R-02.png', '윈도우 역슬래시를 슬래시로 정규화');
}
{
  const r = T.normalizeRelPath('./a//b/x.PNG');
  eq(r.rel, 'a/b/x.PNG', '. 와 빈 칸을 접는다 · 대문자 확장자 허용');
}

console.log('[3] 중복 경로는 세운다(조용히 덮지 않는다)');
{
  const r = T.parseImageTsv([HEADER, row('a/x.png', 'R-01', 'c', 'p1', ''), row('a/x.png', 'R-02', 'c', 'p2', '')].join('\n'));
  eq(r.rows.length, 1, '뒤엣것은 버린다');
  ok(r.errors.length === 1 && /중복/.test(r.errors[0].message), '중복이라고 알린다');
}

console.log('[4] 칸·프롬프트');
{
  const r = T.parseImageTsv([HEADER, 'a/x.png\tR-01\t한글'].join('\n'));
  eq(r.rows.length, 0, '칸이 모자라면 거부');
}
{
  const r = T.parseImageTsv([HEADER, row('a/x.png', 'R-01', '한글', '   ', 'neg')].join('\n'));
  eq(r.rows.length, 0, 'positive 가 비면 거부');
}
{
  const r = T.parseImageTsv([HEADER, row('a/x.png', 'R-01', '한글', 'pos only')].join('\n'));
  eq(r.rows.length, 1, 'negative 는 없어도 된다');
  eq(r.rows[0].negative, '', '빈 문자열로 둔다');
}
{
  const POS = '  a person, minimal line drawing, single burnt-orange accent  ';
  const r = T.parseImageTsv([HEADER, row('a/x.png', 'R-01', '한글', POS, 'text, logo')].join('\n'));
  eq(r.rows[0].positive, POS.trim(), '🔑 프롬프트를 앞뒤 공백만 빼고 **그대로** 둔다(화풍은 대본 쪽 관리)');
  eq(r.rows[0].negative, 'text, logo', 'negative 도 그대로');
}

console.log('[5] 일괄 생성 — 이어받기·자리표시·실패 격리');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tsvimg-'));
const mkEngine = (behave) => {
  const calls = [];
  return {
    calls,
    async textToImage(o) {
      calls.push(o);
      const r = behave(o, calls.length);
      if (r && r.success) fs.writeFileSync(o.outputPath, Buffer.alloc(50000, 7));  // 정상 크기 파일
      return r;
    },
  };
};
const rows3 = T.parseImageTsv([HEADER,
  row('s/a.png', 'R-01', 'c1', 'pos-a', 'neg-a'),
  row('s/b.png', 'R-02', 'c2', 'pos-b', ''),
  row('s/c.png', 'R-03', 'c3', 'pos-c', ''),
].join('\n')).rows;

(async () => {
  {
    const eng = mkEngine(() => ({ success: true }));
    const r = await T.runImageBatch({ rows: rows3, outRoot: TMP, engine: eng, seed: 20260826, dims: { w: 1024, h: 1024 }, onLine: () => {} });
    eq(r.made, 3, '3장 생성');
    eq(r.failed.length, 0, '실패 없음');
    ok(fs.existsSync(path.join(TMP, 's', 'a.png')), '하위 폴더를 만들어 저장한다');
    eq(eng.calls[0].prompt, 'pos-a', 'positive 를 그대로 넘긴다');
    eq(eng.calls[0].negative, 'neg-a', 'negative 를 그대로 넘긴다');
    eq(eng.calls[1].negative, undefined, 'negative 가 비면 안 넘긴다');
    eq(eng.calls[0].seed, 20260826, '🔑 시드를 고정해 넘긴다(같은 그림을 다시 뽑을 수 있게)');
    eq(eng.calls[0].dims.w, 1024, '해상도 1024');
    eq(eng.calls[0].dims.h, 1024, '정사각형');
  }
  {
    // 이어받기 — 이미 있으면 건너뛴다(마음에 안 드는 그림만 지우고 다시 돌리는 방식)
    const eng = mkEngine(() => ({ success: true }));
    const r = await T.runImageBatch({ rows: rows3, outRoot: TMP, engine: eng, onLine: () => {} });
    eq(r.made, 0, '이미 있으면 만들지 않는다');
    eq(r.skipped, 3, '3장 건너뜀');
    eq(eng.calls.length, 0, '엔진을 아예 부르지 않는다');
  }
  {
    // 🔴 자리표시(70B) — 실사고. 완성본으로 보면 한 장도 안 만들고 "완료" 가 된다.
    fs.writeFileSync(path.join(TMP, 's', 'b.png'), Buffer.alloc(70, 0));
    const eng = mkEngine(() => ({ success: true }));
    const lines = [];
    const r = await T.runImageBatch({ rows: rows3, outRoot: TMP, engine: eng, onLine: (m) => lines.push(m) });
    eq(r.made, 1, '🔑 자리표시 파일은 「없는 것」으로 보고 다시 만든다');
    eq(eng.calls.length, 1, '그 한 장만 만든다');
    ok(lines.some((l) => /자리표시/.test(l)), '왜 다시 만드는지 로그로 알린다');
  }
  {
    // force — 다 다시 만든다
    const eng = mkEngine(() => ({ success: true }));
    const r = await T.runImageBatch({ rows: rows3, outRoot: TMP, engine: eng, force: true, onLine: () => {} });
    eq(r.made, 3, 'force 면 이미 있어도 다시 만든다');
  }
  {
    // 실패 격리 — 한 장 실패해도 나머지는 만든다
    const T2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tsvimg2-'));
    const eng = mkEngine((o, i) => (i === 2 ? { success: false, error: '모델 없음' } : { success: true }));
    const r = await T.runImageBatch({ rows: rows3, outRoot: T2, engine: eng, onLine: () => {} });
    eq(r.made, 2, '실패해도 나머지는 만든다');
    eq(r.failed.length, 1, '실패 1건');
    eq(r.failed[0].reason, '모델 없음', '이유를 남긴다');
    try { fs.rmSync(T2, { recursive: true, force: true }); } catch {}
  }
  {
    // 연속 실패 상한 — 서버가 죽었을 때 900장을 헛돌지 않는다
    const T3 = fs.mkdtempSync(path.join(os.tmpdir(), 'tsvimg3-'));
    const many = [];
    for (let i = 0; i < 20; i++) many.push({ rel: 's/x' + i + '.png', scene: 'R', caption: '', positive: 'p', negative: '' });
    const eng = mkEngine(() => ({ success: false, error: '연결 실패' }));
    const r = await T.runImageBatch({ rows: many, outRoot: T3, engine: eng, onLine: () => {} });
    ok(r.failed.length <= 5, '연속 실패가 상한에서 멈춘다 (' + r.failed.length + '건)');
    try { fs.rmSync(T3, { recursive: true, force: true }); } catch {}
  }
  {
    // 부정 프롬프트가 안 들어가는 워크플로면 **한 번만** 알린다(조용히 버리지 않는다)
    const T4 = fs.mkdtempSync(path.join(os.tmpdir(), 'tsvimg4-'));
    const eng = mkEngine(() => ({ success: true, negApplied: false }));
    const lines = [];
    await T.runImageBatch({ rows: rows3, outRoot: T4, engine: eng, onLine: (m) => lines.push(m) });
    const warns = lines.filter((l) => /부정 프롬프트를 쓰지 않습니다/.test(l));
    eq(warns.length, 1, 'negative 가 무시되면 딱 한 번 알린다');
    try { fs.rmSync(T4, { recursive: true, force: true }); } catch {}
  }
  {
    // 중단
    const T5 = fs.mkdtempSync(path.join(os.tmpdir(), 'tsvimg5-'));
    const eng = mkEngine(() => ({ success: true }));
    const r = await T.runImageBatch({ rows: rows3, outRoot: T5, engine: eng, onLine: () => {}, abortSignal: () => true });
    eq(r.made, 0, '중단하면 한 장도 만들지 않는다');
    try { fs.rmSync(T5, { recursive: true, force: true }); } catch {}
  }

  console.log('[6] 실제 입력 회귀 — 강의 3강 그림목록');
  const REAL = 'D:/비즈니스PT/lecture-video/images/003_그림목록.tsv';
  if (fs.existsSync(REAL)) {
    const r = T.parseImageTsv(fs.readFileSync(REAL, 'utf8'));
    eq(r.errors.length, 0, '실제 파일에 오류 0');
    eq(r.headerSkipped, true, '헤더 한 줄을 건너뛴다');
    ok(r.rows.length >= 12, '12장 이상 (' + r.rows.length + ')');
    ok(r.rows.every((x) => /^003_/.test(x.rel)), '모든 경로가 강 폴더 안');
    ok(r.rows[0].positive.length > 50, 'positive 가 완성 프롬프트다(스타일 포함)');
  } else {
    console.log('  ⏭ 건너뜀 — 이 PC 에 강의 그림목록이 없습니다');
  }

    console.log('[6-b] 짝 찾기 — 음성 TSV ↔ 같은 번호의 그림목록');
  {
    // 🔑 main.js 원문에서 뽑아 실행한다(복사본을 두면 앱과 갈라져도 통과한다).
    const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const ex = (src, name) => {
      const i = src.indexOf('function ' + name + '(');
      let d = 0, st = false, j = i;
      for (; j < src.length; j++) { const c = src[j]; if (c === '{') { d++; st = true; } else if (c === '}') { d--; if (st && d === 0) { j++; break; } } }
      return src.slice(i, j);
    };
    const M = new Function('fs', 'path', [ex(MAIN, '_lecNum'), ex(MAIN, '_pairImageTsv')].join(String.fromCharCode(10)) + String.fromCharCode(10) + 'return { _lecNum, _pairImageTsv };')(fs, path);
    eq(M._lecNum('003_돈이_만들어지는_구조.tsv'), '003', '앞 숫자를 뽑는다');
    eq(M._lecNum('노번호.tsv'), '', '숫자가 없으면 빈 문자열');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-'));
    fs.writeFileSync(path.join(d, '003_그림목록.tsv'), 'x');
    fs.writeFileSync(path.join(d, '007_그림목록.tsv'), 'x');
    eq(path.basename(M._pairImageTsv('/a/003_강.tsv', d) || ''), '003_그림목록.tsv', '같은 번호를 찾는다');
    eq(M._pairImageTsv('/a/999_강.tsv', d), null, '없는 번호는 null(그 강은 음성만)');
    eq(M._pairImageTsv('/a/노번호.tsv', d), null, '번호가 없으면 null');
    eq(M._pairImageTsv('/a/003_강.tsv', ''), null, '폴더가 비면 null');
    eq(M._pairImageTsv('/a/003_강.tsv', path.join(d, '없음')), null, '없는 폴더에도 안 던진다');
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
  console.log('[7] 소스 위생');
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'core', 'tsv-images.js'), 'utf8');
  ok(SRC.indexOf(String.fromCharCode(0)) < 0, 'NUL 바이트 없음');
  ok(!/stylePrompt|buildImagePrompt/.test(SRC), '🔑 앱이 화풍을 덧붙이지 않는다(프롬프트 가공 코드 없음)');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log('\n' + (bad ? '❌ ' + bad + '/' + n + ' 실패' : '✅ ' + n + '/' + n + ' 통과'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
