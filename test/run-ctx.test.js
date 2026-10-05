// 🔒 제작 중 다른 대본을 골라도 완성 파일 이름·업로드 제목이 따라가지 않는다 (2026-10-05 실사고, v0.6.98)
//   사고: 큐 2번째 1009(첨성대)를 만드는 도중 큐에서 1007(울산)을 클릭 → 1009 내용이 1009 폴더에
//   「[역사_1007] 울산 반구대….vrew/.mp4」 로 구워지고, 유튜브에 **1007 제목·설명**으로 올라갔다.
//   원인: runMakeAllBody 는 parsed·outRoot 는 고정했지만 vrewBaseName·ytMetaFor·resolveBgm 이 S.scriptPath(=화면에서 고른 대본)를 읽었다.
//   main.js 원문에서 함수·구간을 뽑아 검사한다(복사본 금지). 앱을 띄우지 않는다.
const fs = require('fs'), path = require('path');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const fnBody = (sig) => { const a = MAIN.indexOf(sig); const b = MAIN.indexOf('\n}\n', a); return a >= 0 && b > a ? MAIN.slice(a, b + 2) : ''; };
const handlerBody = (ch) => { const a = MAIN.indexOf(`ipcMain.handle('${ch}'`); const b = MAIN.indexOf('\n});\n', a); return a >= 0 && b > a ? MAIN.slice(a, b + 4) : ''; };

console.log('[1] vrewBaseName — ctx 가 화면의 대본을 이긴다');
{
  const src = fnBody('function vrewBaseName(');
  ok(!!src, 'vrewBaseName 이 main.js 에 있다');
  const S = { scriptPath: 'G:/x/[역사_1007] 울산.md', parsed: { projects: [{ shortsNum: 1 }], fileTitle: '울산' } };
  const f = new Function('S', 'path', '_safeFolder', 'getModeProfile', 'currentMode', src + '\nreturn vrewBaseName;')(
    S, path, (s) => s, () => ({ vrewPrefix: 'x' }), () => 'longform');
  const pr = { shortsNum: 1 };
  const ctx = { scriptPath: 'G:/x/[역사_1009] 첨성대.md', parsed: { projects: [pr] } };
  ok(f(pr, ctx) === '[역사_1009] 첨성대', 'ctx 를 주면 그 대본 이름');
  ok(f(pr) === '[역사_1007] 울산', '판정력: ctx 없으면 화면의 대본 이름(=사고가 난 경로)');
}

console.log('[2] runMakeAllBody — 대본 경로까지 시작 시점에 고정');
{
  const B = fnBody('async function runMakeAllBody(');
  ok(!!B, 'runMakeAllBody 가 있다');
  const pin = B.indexOf('const scriptPath = S.scriptPath; const runCtx = { parsed, scriptPath, outRoot };');
  ok(pin > 0, 'scriptPath·runCtx 를 시작 때 고정한다');
  const after = B.slice(pin + 80);
  ok(!/S\.(scriptPath|parsed|outRoot)\b/.test(after), '고정 뒤로는 S.scriptPath·S.parsed·S.outRoot 를 읽지 않는다');
  ok(!/vrewBaseName\(pr\)/.test(B), 'vrewBaseName 을 ctx 없이 부르지 않는다');
  const mp4Calls = B.match(/renderUploadMp4\([^)]*\)/g) || [];
  ok(mp4Calls.length > 0 && mp4Calls.every((c) => /runCtx\)$/.test(c)), 'renderUploadMp4 에 runCtx 를 넘긴다');
  const upCalls = B.match(/maybeAutoUpload\([^)]*\)/g) || [];
  ok(upCalls.length > 0 && upCalls.every((c) => /runCtx\)$/.test(c)), 'maybeAutoUpload 에 runCtx 를 넘긴다');
  ok(/runWhiteboardFor\([^)]*ctx: runCtx/.test(B), '화이트보드에도 runCtx 를 넘긴다');
}

console.log('[3] export-vrew — 같은 고정');
{
  const H = handlerBody('export-vrew');
  ok(!!H, 'export-vrew 처리기가 있다');
  const pin = H.indexOf('const parsed = S.parsed, outRoot = S.outRoot, scriptPath = S.scriptPath; const runCtx');
  ok(pin > 0, '시작 때 parsed·outRoot·scriptPath 를 고정한다');
  ok(!/S\.(scriptPath|parsed|outRoot)\b/.test(H.slice(pin + 100)), '고정 뒤로는 S.* 를 읽지 않는다');
  ok(/vrewBaseName\(pr, runCtx\)/.test(H) && /renderUploadMp4\([^)]*runCtx\)/.test(H), '이름·MP4(업로드)에 runCtx');
}

console.log('[4] 업로드 메타까지 ctx 가 이어진다');
{
  ok(/async function renderUploadMp4\(vrewPath, baseName, preset, pr = null, ctx = null\)/.test(MAIN), 'renderUploadMp4 가 ctx 를 받는다');
  const R = fnBody('async function renderUploadMp4(');
  ok(/maybeAutoUpload\(pr, r\.output \|\| outPath, preset, ctx\)/.test(R), 'renderUploadMp4 → maybeAutoUpload 로 ctx');
  const M = fnBody('function maybeAutoUpload(');
  ok(/ytMetaFor\(pr, ctx\)/.test(M), 'maybeAutoUpload → ytMetaFor(pr, ctx) (제목·설명·챕터가 만든 대본 것)');
  const W = fnBody('async function runWhiteboardFor(');
  ok(/vrewBaseName\(pr, ctx\)/.test(W) && /ctx \? ctx\.scriptPath : S\.scriptPath/.test(W), '화이트보드 이름·배경음악도 ctx');
}

console.log(`\n${fail ? '✗' : '✓'} run-ctx: ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
