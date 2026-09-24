/**
 * video-fit.test.js — 🎞 영상이 음성보다 짧을 때 길이 맞추기 + 📄 대본 읽기 + ⏱ 챕터 안전장치 + 초기화 정렬 (2026-09-24, v0.5.33)
 *   🔑 실제 왕복: 5초 영상 + 약 12초 음성 → 진짜 빌더(.vrew) → 진짜 렌더러(MP4) → 뒷부분 화면이 **움직이는지** 잰다
 *   (전에는 마지막 프레임에서 멈췄다 = 이웃 프레임 차이 0).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const AdmZip = require('adm-zip');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vfit-'));
const FF = require(path.join(ROOT, 'core', 'media-utils')).getFfmpegPath();
const VF = require(path.join(ROOT, 'core', 'video-fit'));
const SR = require(path.join(ROOT, 'core', 'script-reader'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const dur = (f) => { const o = spawnSync(FF, ['-i', f], { encoding: 'utf8' }).stderr; const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(o); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0; };
/** t 초와 t+dt 초 프레임의 평균 화소 차이(0~255) — 0 이면 멈춰 있다 */
function motion(mp4, t, dt = 0.4) {
  const grab = (s) => execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-ss', String(s), '-i', mp4, '-frames:v', '1', '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', '-']);
  const a = grab(t), b = grab(t + dt);
  let d = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) d += Math.abs(a[i] - b[i]);
  return d / Math.min(a.length, b.length);
}

(async () => {
  console.log('\n[1] 계획(순수 계산)');
  ok(VF.plan(5, 5.05).mode === 'none', '차이가 0.1초 이내면 손대지 않는다');
  ok(VF.plan(5, 6).mode === 'slow' && Math.abs(VF.plan(5, 6).ratio - 1.2) < 1e-9, '1.3배까지는 느리게');
  ok(VF.plan(5, 6.5).mode === 'slow' && VF.plan(5, 6.6).mode === 'loop', '경계 1.3배');
  const p20 = VF.plan(5, 20);
  ok(p20.mode === 'loop' && p20.xfade === 0.5 && p20.n * 5 - (p20.n - 1) * 0.5 >= 20, `20초 = 반복 ${p20.n}번 + 크로스페이드 · 길이 충분`);
  ok(VF.plan(5, 200).xfade === 0, '너무 많이 반복해야 하면 크로스페이드 없이');
  ok(VF.plan(0, 10).mode === 'none' && VF.plan(5, 0).mode === 'none', '길이를 모르면 손대지 않는다');
  const a = VF.buildArgs('s.mp4', 5, 20, 'o.mp4', p20).join(' ');
  ok(/xfade=transition=fade:duration=0\.500:offset=4\.500/.test(a) && /anullsrc=r=48000:cl=stereo/.test(a) && /-t 20\.000/.test(a), 'ffmpeg: 이음새 크로스페이드 · 무음 오디오 · 목표 길이');
  ok(/setpts=1\.20000\*PTS/.test(VF.buildArgs('s.mp4', 5, 6, 'o.mp4', VF.plan(5, 6)).join(' ')), 'ffmpeg: 느리게(setpts)');

  console.log('\n[2] 실제 ffmpeg — 길이 · 오디오 · 캐시 · 실패 폴백');
  const src = path.join(TMP, 'src.mp4');
  execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x352:rate=24:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', src]);
  const cdir = path.join(TMP, 'cache');
  let r = await VF.fitVideo(src, 5, 6, { dir: cdir });
  ok(r.mode === 'slow' && Math.abs(dur(r.path) - 6) < 0.1, `느리게 → ${dur(r.path).toFixed(2)}초`);
  r = await VF.fitVideo(src, 5, 17.3, { dir: cdir });
  ok(r.mode === 'loop' && Math.abs(dur(r.path) - 17.3) < 0.1, `반복 → ${dur(r.path).toFixed(2)}초`);
  ok(/Audio: aac/.test(spawnSync(FF, ['-i', r.path], { encoding: 'utf8' }).stderr), '무음 aac 트랙(빌더가 선언하는 영상 오디오와 맞춘다)');
  ok(motion(r.path, 12.0) > 1, `반복 구간도 움직인다(차이 ${motion(r.path, 12.0).toFixed(1)})`);
  const r2 = await VF.fitVideo(src, 5, 17.3, { dir: cdir });
  ok(r2.cached && r2.path === r.path, '같은 원본·같은 목표 → 캐시');
  const srcMtime = fs.statSync(src).mtimeMs;
  ok(fs.statSync(src).mtimeMs === srcMtime && dur(src) < 5.2, '🔑 원본은 그대로');
  const bad = path.join(TMP, 'bad.mp4'); fs.writeFileSync(bad, 'not a video');
  const rb = await VF.fitVideo(bad, 5, 12, { dir: cdir });
  ok(rb.mode === 'fail' && rb.path === bad, '실패하면 원본을 돌려준다(던지지 않는다)');
  ok(!fs.readdirSync(cdir).some((f) => /\.part-/.test(f)), '실패해도 반쪽 파일이 남지 않는다');

  console.log('\n[3] 🔑 실제 왕복 — 빌더(.vrew) → 렌더러(MP4): 뒷부분이 멈추지 않는다');
  try {
    const P = require(path.join(ROOT, 'core', 'pipeline'));
    const R = require(path.join(ROOT, 'core', 'vrew-render'));
    const rs = P.parseScriptText('# t\n## 장\n### 장면\n첫 문장입니다. 둘째 문장입니다. 셋째 문장입니다. 넷째 문장입니다. 다섯째 문장입니다.\n', 'longform', {});
    const pr = rs.projects[0];
    const img = path.join(TMP, 'g.png');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=1920x1080', '-frames:v', '1', img]);
    const vid = path.join(TMP, 'g.mp4');
    execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', vid]);
    pr.groups[0].imagePath = img; pr.groups[0].videoPath = vid;
    P.fillSilent(pr, path.join(TMP, 'tts'));
    const total = pr.sentences.reduce((s, x) => s + x.ttsDurationSec, 0);
    const logs = [];
    const vrew = path.join(TMP, 't.vrew');
    await P.buildProjectVrew(pr, vrew, {}, (l) => logs.push(l), 20, 1);
    const zip = new AdmZip(vrew);
    const pj = JSON.parse(zip.readAsText('project.json'));
    const vf = pj.files.find((f) => f.sourceFileType === 'ASSET_VIDEO');
    ok(total > 6.5 && vf && vf.videoAudioMetaInfo.duration >= total - 0.1, `.vrew 에 든 영상 길이 ${vf && vf.videoAudioMetaInfo.duration.toFixed(2)}초 ≥ 음성 ${total.toFixed(2)}초`);
    ok(logs.some((l) => /🎞 G1 영상 5\.0초 →/.test(l)), '로그에 길이 맞추기가 남는다');
    ok(pr.groups[0].videoPath === vid, '그룹의 영상 경로(원본)는 바뀌지 않는다');
    const mp4 = path.join(TMP, 't.mp4');
    const res = await R.renderVrewToMp4({ vrewPath: vrew, outPath: mp4, log: () => {}, par: 1 });
    ok(res && res.ok, 'MP4 렌더 성공');
    const late = motion(mp4, Math.max(5.6, total - 1.2));
    ok(late > 1, `🔑 영상 원본(5초)이 끝난 뒤에도 화면이 움직인다 (차이 ${late.toFixed(1)} — 멈추면 0)`);
    // A/B — 맞추기를 끄면(옛 동작) 멈춘다
    const vrew0 = path.join(TMP, 't0.vrew'), mp40 = path.join(TMP, 't0.mp4');
    const { buildVrew } = require(path.join(ROOT, 'vrew', 'vrew-builder'));
    await buildVrew({ sentences: pr.sentences, groups: pr.groups, vrewPath: vrew0, opts: { aspect: '16:9', skipSelfCheck: true, captionMaxChars: 20, fitVideo: false } });
    await R.renderVrewToMp4({ vrewPath: vrew0, outPath: mp40, log: () => {}, par: 1 });
    const late0 = motion(mp40, Math.max(5.6, total - 1.2));
    ok(late0 < 0.5, `A/B: 맞추기를 끄면 멈춘다 (차이 ${late0.toFixed(2)}) — 위 단언이 헛단언이 아니다`);
  } catch (e) { ok(false, '왕복 실패: ' + e.message); }

  console.log('\n[4] 📄 대본 읽기 블록');
  const dto = { title: '[고전_0930] 제목', cuts: [
    { num: 1, h2: '도입부', phase: '〔첫 장면 · 5샷 · I2V〕', sentences: [{ text: '가.' }, { text: '나.', speaker: '엄마' }] },
    { num: 2, h2: '도입부', phase: '〔둘째 장면〕', sentences: [{ text: '다.' }, { text: '라.', mark: { h2: '1장', phase: '새 장면' } }] },
  ] };
  const b = SR.readerBlocks(dto);
  ok(b[0].t === 'h1' && b[0].text === '[고전_0930] 제목', 'h1 = 대본 제목');
  ok(b.filter((x) => x.t === 'h2').map((x) => x.text).join('|') === '도입부|1장', 'h2 는 바뀔 때만 · 합친 그룹 안 챕터 표식에서 다시');
  ok(!b.some((x) => x.t === 'h3' && /5샷|첫 장면/.test(x.text)), '제작메모뿐인 H3 는 뺀다(⏱ 챕터와 같은 규칙)');
  ok(b.some((x) => x.t === 'h3' && x.text === '〔둘째 장면〕'), '보통 H3 는 둔다');
  const ps = b.filter((x) => x.t === 'p');
  ok(ps[0].groupNum === 1 && ps[0].sents[1].speaker === '엄마' && ps[0].sents[1].i === 1, '문단 = 그룹 · 문장 번호(i)가 편집 주소와 같다 · 화자');
  ok(ps.length === 3 && ps[2].sents[0].i === 1, '합친 그룹은 표식에서 문단을 가른다(i 는 그룹 안 번호 그대로)');
  ok(SR.readerBlocks(dto, { headings: false }).every((x) => x.t !== 'h3') && SR.readerBlocks(dto, { headings: false }).some((x) => x.t === 'h2'), '섹션 제목(###) 끄기 — ## 장 제목은 남는다');
  const html = SR.readerHtml(b, { fontPt: 12 });
  ok(/@page \{ size: A4/.test(html) && /font-size: 12pt/.test(html) && !/<script/i.test(html), 'A4 · 글자 크기 · 스크립트 없음');
  ok(SR.readerHtml([{ t: 'p', groupNum: 1, sents: [{ i: 0, text: '<b>x</b>' }] }]).includes('&lt;b&gt;x&lt;/b&gt;'), '본문 글자는 이스케이프');
  ok(JSON.stringify(SR.nUpLayout(2)) === '{"landscape":true,"cols":2,"rows":1}' && SR.nUpLayout(4).cols === 2 && SR.nUpLayout(4).rows === 2 && SR.nUpLayout(9).cols === 3 && SR.nUpLayout(6).landscape, '한 장에 N 쪽 배치(2·6 가로 · 4·9 세로)');
  const st = SR.readerStats({ cuts: [{ sentences: [{ text: '가 나', dur: 2 }, { text: '다', dur: 3 }] }] });
  ok(st.chars === 3 && st.sents === 2 && st.dur === 5, '통계(공백 제외 글자 · 문장 · 음성)');
  ok(!/typeof require/.test(read('core/script-reader.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),'script-reader: 렌더러 번들 백지 사고 패턴 없음');

  console.log('\n[5] 배선');
  const M = read('main.js'), A = read('renderer/src/App.jsx'), B = read('vrew/vrew-builder.js'), CSS = read('renderer/src/styles.css');
  ok(/require\('\.\.\/core\/video-fit'\)\.fitVideo\(_vsrc/.test(B) && /mediaZip\.push\(\{ src: _vsrc/.test(B) && /fs\.statSync\(_vsrc\)\.size/.test(B), '빌더: 맞춘 파일로 크기·메타·zip');
  ok(/opts\.fitVideo !== false/.test(B), '빌더: 끌 수 있다(A/B)');
  ok(/getMediaDuration\(file\)/.test(M) && /CHAPTER_TOL_SEC/.test(M) && /descriptionNoChapters/.test(M), '⏱ 업로드 전 MP4 실제 길이로 챕터 대조');
  ok(/loadConfig\(\)\.videoMaxSec/.test(M) && /regroupIntroByTtsDuration\(pr, \{ maxSec \}\)/.test(M), '도입부 재배치 = 영상 최대 길이');
  ok(M.includes("ipcMain.handle('script-reader-pdf'") && /embedPages/.test(M) && read('preload.js').includes('scriptReaderPdf:'), '📄 A4 PDF IPC · 모아 찍기(pdf-lib)');
  ok(/button:has-text|📄 대본 보기/.test(A) && A.includes("<ScriptReader api={api}"), '④ 완성 📄 대본 보기 → 읽기 창');
  ok(/\.hmain\{display:grid;grid-template-columns:fit-content\(100%\)/.test(CSS) && /\.pipecol\{display:grid;grid-template-columns:minmax\(0,1fr\)/.test(CSS), '🆕 초기화 줄과 섹션이 한 열 폭을 쓴다');
  const pj = JSON.parse(read('package.json'));
  ok(!('pdf-lib' in (pj.dependencies || {})) && fs.existsSync(path.join(ROOT, 'node_modules', 'pdf-lib')), 'pdf-lib 는 기존 설치물(의존성 추가 없음)');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? '❌' : '✅'} video-fit · reader ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
