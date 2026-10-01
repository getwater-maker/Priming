// .vrew 건너뛰기 지문 — 같은 입력은 같은 지문, 바뀐 입력은 다른 지문, 기록이 어긋나면 다시 만든다.
const fs = require('fs'), os = require('os'), path = require('path');
const BF = require('../core/build-fingerprint');
const P = require('../core/pipeline');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  const wav = path.join(dir, '1.wav'); fs.writeFileSync(wav, Buffer.alloc(5000, 1));
  const img = path.join(dir, '01.png'); fs.writeFileSync(img, Buffer.alloc(3000, 2));
  const mk = () => ({
    aspect: '16:9',
    sentences: [{ id: 's1', text: '안녕', ttsAudioPath: wav, ttsDurationSec: 1.2, ttsStatus: 'done', vrewClips: [{ text: '안녕' }] }],
    groups: [{ id: 'g1', sentenceIds: ['s1'], imagePath: img, imageStatus: 'done', selected: false, videoPath: null }],
  });
  const preset = { captionStyle: { size: 40 }, aiNotice: { enabled: false } };
  const fpOf = (pr, ps = preset, n = 7, extra = {}) => BF.fingerprint({ v: '1', outMode: 'full', ...extra, inputs: P.vrewInputsOf(pr, ps, n) });

  const a = await fpOf(mk());
  ok(a && a.length === 64, '지문 계산');
  ok(a === await fpOf(mk()), '같은 입력 = 같은 지문');
  // 작업본 왕복(undefined 소실·null) + 진행 상태 값은 지문에 영향 없음
  const rt = JSON.parse(JSON.stringify(mk())); rt.sentences[0].ttsStatus = 'idle'; rt.groups[0].selected = true; rt.groups[0].extra = null;
  ok(a === await fpOf(rt), '왕복·진행상태 무관');
  // 바뀌면 달라진다 (판정력)
  const t = mk(); t.sentences[0].text = '안녕하세요';
  ok(a !== await fpOf(t), '문장 수정');
  ok(a !== await fpOf(mk(), { ...preset, captionStyle: { size: 44 } }), '자막 서식');
  ok(a !== await fpOf(mk(), { ...preset, aiNotice: { enabled: true, text: 'x' } }), 'AI 고지');
  ok(a !== await fpOf(mk(), preset, 9), '자막 글자수');
  ok(a !== await fpOf(mk(), preset, 7, { outMode: 'audio' }), '출력 방식');
  ok(a !== await fpOf(mk(), preset, 7, { v: '2' }), '앱 버전');
  const ov = mk(); ov.overlays = [{ path: img, from: 1 }];
  ok(a !== await fpOf(ov), '삽입 추가');
  fs.writeFileSync(img, Buffer.alloc(3100, 3));
  ok(a !== await fpOf(mk()), '그림 파일이 바뀜(크기)');
  fs.writeFileSync(img, Buffer.alloc(3000, 2));
  const b = await fpOf(mk());
  fs.unlinkSync(wav);
  ok(b !== await fpOf(mk()), '음성 파일 사라짐');

  // 기록 흐름
  const out = path.join(dir, 'out'); fs.mkdirSync(out);
  const vrew = path.join(out, '대본.vrew'); fs.writeFileSync(vrew, 'vrew-v1');
  const mp4 = path.join(out, '대본.mp4');
  let r = await BF.checkUpToDate({ outRoot: out, baseName: '대본', fp: a, vrewPath: vrew });
  ok(!r.vrewOk && r.why === '이전 기록 없음', '기록 없음 → 만든다');
  ok(await BF.recordBuilt({ outRoot: out, baseName: '대본', fp: a, vrewPath: vrew }), '기록');
  r = await BF.checkUpToDate({ outRoot: out, baseName: '대본', fp: a, vrewPath: vrew });
  ok(r.vrewOk && !r.mp4Ok, '같은 지문·.vrew 그대로 → 건너뜀');
  r = await BF.checkUpToDate({ outRoot: out, baseName: '대본', fp: b, vrewPath: vrew });
  ok(!r.vrewOk, '지문이 다르면 만든다');
  r = await BF.checkUpToDate({ outRoot: out, baseName: '대본', fp: null, vrewPath: vrew });
  ok(!r.vrewOk, '지문 계산 실패 → 만든다(fail-closed)');
  fs.writeFileSync(vrew, 'vrew-edited-by-user');
  r = await BF.checkUpToDate({ outRoot: out, baseName: '대본', fp: a, vrewPath: vrew });
  ok(!r.vrewOk, '.vrew 가 바뀌었으면 만든다');
  fs.writeFileSync(vrew, 'vrew-v1');
  await BF.recordBuilt({ outRoot: out, baseName: '대본', fp: a, vrewPath: vrew });
  fs.writeFileSync(mp4, 'mp4data');
  ok(await BF.recordMp4({ outRoot: out, baseName: '대본', mp4Path: mp4 }), 'MP4 기록');
  r = await BF.checkUpToDate({ outRoot: out, baseName: '대본', fp: a, vrewPath: vrew, mp4Path: mp4 });
  ok(r.vrewOk && r.mp4Ok, 'MP4 까지 최신');
  fs.unlinkSync(mp4);
  r = await BF.checkUpToDate({ outRoot: out, baseName: '대본', fp: a, vrewPath: vrew, mp4Path: mp4 });
  ok(r.vrewOk && !r.mp4Ok, 'MP4 만 없음 → MP4 만 굽는다');
  fs.unlinkSync(vrew);
  r = await BF.checkUpToDate({ outRoot: out, baseName: '대본', fp: a, vrewPath: vrew });
  ok(!r.vrewOk, '.vrew 삭제됨 → 만든다');

  // 🔖 기록 없는 기존 완성물 채택 — 입력보다 .vrew 가 새로울 때만
  {
    const o2 = path.join(dir, 'out2'); fs.mkdirSync(o2);
    const v2 = path.join(o2, 'x.vrew'), m2 = path.join(o2, 'x.mp4'), scr = path.join(dir, 'x.md');
    const inp = P.vrewInputsOf(mk(), preset, 7);
    fs.writeFileSync(wav, Buffer.alloc(5000, 1)); fs.writeFileSync(scr, 'script');
    const old = new Date(Date.now() - 3600e3); fs.utimesSync(wav, old, old); fs.utimesSync(img, old, old); fs.utimesSync(scr, old, old);
    const args = { outRoot: o2, baseName: 'x', fp: a, vrewPath: v2, inputs: inp, extraPaths: [scr] };
    ok(!await BF.adoptIfFresh(args), '.vrew 없음 → 채택 안 함');
    fs.writeFileSync(v2, 'v');
    ok(await BF.adoptIfFresh(args), '입력보다 새로운 .vrew → 채택');
    r = await BF.checkUpToDate({ outRoot: o2, baseName: 'x', fp: a, vrewPath: v2 });
    ok(r.vrewOk, '채택 뒤 건너뜀');
    ok(!await BF.adoptIfFresh(args), '이미 기록이 있으면 다시 채택 안 함');
    fs.rmSync(path.join(o2, '.priming-build'), { recursive: true });
    const fut = new Date(Date.now() + 3600e3); fs.utimesSync(wav, fut, fut);
    ok(!await BF.adoptIfFresh(args), '음성이 .vrew 보다 새로우면 채택 안 함');
    fs.utimesSync(wav, old, old); fs.utimesSync(scr, fut, fut);
    ok(!await BF.adoptIfFresh(args), '대본이 .vrew 보다 새로우면 채택 안 함');
    fs.utimesSync(scr, old, old);
    ok(!await BF.adoptIfFresh({ ...args, mp4Path: m2 }), 'MP4 모드인데 MP4 없음 → 채택 안 함');
    fs.writeFileSync(m2, 'm');
    ok(await BF.adoptIfFresh({ ...args, mp4Path: m2 }), 'MP4 까지 있으면 채택');
    r = await BF.checkUpToDate({ outRoot: o2, baseName: 'x', fp: a, vrewPath: v2, mp4Path: m2 });
    ok(r.vrewOk && r.mp4Ok, '채택 뒤 .vrew·MP4 모두 건너뜀');
    fs.rmSync(path.join(o2, '.priming-build'), { recursive: true });
    fs.unlinkSync(img);
    ok(!await BF.adoptIfFresh(args), '입력 파일(그림)이 없으면 채택 안 함');
  }

  // 소스 대조 — buildProjectVrew 가 preset/project 에서 읽는 필드가 vrewInputsOf 에도 있다
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'pipeline.js'), 'utf8');
  const body = src.slice(src.indexOf('async function buildProjectVrew'), src.indexOf('// ── 이미지 생성'));
  const inputs = src.slice(src.indexOf('function vrewInputsOf'), src.indexOf('async function buildProjectVrew'));
  for (const k of [...body.matchAll(/(?:preset|project)\.([A-Za-z]+)/g)].map((m) => m[1])) {
    if (['aspect', 'sentences', 'groups'].includes(k) || inputs.includes(`.${k}`)) { pass++; continue; }
    fail++; console.log('✗ vrewInputsOf 에 없음:', k);
  }
  // main.js 4단계가 지문 판정을 쓴다
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  ok(/P\.vrewInputsOf\(pr, ep, captionMaxChars\)/.test(main) && /BF\.checkUpToDate/.test(main) && /BF\.adoptIfFresh/.test(main), 'main 4단계 연결');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`build-fingerprint: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
