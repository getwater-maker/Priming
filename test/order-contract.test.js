'use strict';
// 🤖 2.0 무인 제작 — 주문서·결과서 계약(v1.0.18 · docs/요청서_2.0무인제작_2026-11-04.md)
//   [1] core/order-contract — 주문서 꼴 검사 · 있는 값 확인 · 운영 상태 · 결과서 한 번만 · 같은 목소리 · 측정 · 장부 · 모델 이름
//   [2] 유료 호출 문(PM_NO_PAID) — Claude·kie·Gemini 입구가 막힌다
//   [3] 유튜브 인증 프로필 — 프로필 파일이 따로 · 프로필에선 앱 기본(공용) 클라이언트로 떨어지지 않는다
//   [4] gpu-share 양보 시간 · omnivoice 미룸 시간을 쌓는다
//   [5] main·bootstrap 연결(소스) — 무인 실행 갈래 · 채널 덮기 · 업로드 관문 · 예약 끔 · 작업 큐 파일 안 씀 · 업데이트 안 함
//   [6] vrew-render — 중단이면 돌던 ffmpeg 를 끈다
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); c ? pass++ : fail++; };
const ROOT = path.join(__dirname, '..');
const OC = require('../core/order-contract');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-order-'));
const W = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === 'string' ? s : JSON.stringify(s)); return p; };

console.log('[1] 주문서 계약');
{
  const cfgF = W(path.join(tmp, 'cfg.json'), { root: path.join(tmp, '2.0'), outDir: path.join(tmp, 'out'), uploadApps: { '2.0': 'adonai20' } });
  const cfg = OC.loadConfig(cfgF);
  ok(cfg.ordersDir === path.join(tmp, '2.0', '주문', '제작') && cfg.resultsDir === path.join(tmp, '2.0', '결과', '제작') && cfg.opsFile === path.join(tmp, '2.0', '운영', '운영상태.json'), '폴더 자리는 root 하나에서 나온다');
  ok(OC.loadConfig(path.join(tmp, 'none.json')).root === OC.DEFAULT_ROOT, '설정이 없으면 기본 root(2.0 폴더)');
  const md = W(path.join(cfg.ordersDir, 'roy-bible_1210.md'), '# 제목\n\n### 장면\n> 🖼️ 이미지: a quiet hill.\n첫 문장입니다.\n');
  const good = { script: 'roy-bible_1210.md', channelId: 'roy-bible', primingChannel: '05_로이의성경이야기', voice: 'srv:#05_득수_낭독2', style: 'webtoon-illust', voiceEngine: 'omnivoice', imageEngine: 'local:qwen-2-1', thumbPrompt: 'hill at dawn', upload: { title: '임시', app: '2.0' } };
  const of = W(path.join(cfg.ordersDir, 'roy-bible_1210.json'), good);
  const r = OC.readOrder(of);
  ok(r.ok && r.order.script === md, '좋은 주문 = 통과 · 제작본 상대 경로는 주문서 폴더 기준');
  ok(r.order.voice === '#05_득수_낭독2' && r.order.noPaid === true && r.order.orderId === 'roy-bible_1210', 'srv: 접두는 떼고 · noPaid 기본 켬 · orderId 기본 = 파일 이름');
  const bad = OC.readOrder(W(path.join(tmp, 'b.json'), { ...good, imageEngine: 'kie:qwen-2-1', voiceEngine: 'gemini', noPaid: false, voice: '', upload: { title: '' } }));
  ok(!bad.ok && bad.errors.length >= 5, `유료 엔진·noPaid 끔·빈 목소리·빈 제목·빈 앱 = 거절 (${bad.errors.length}건)`);
  ok(!OC.readOrder(W(path.join(tmp, 'c.json'), '{깨짐')).ok, '깨진 JSON = 거절');
  ok(!OC.readOrder(W(path.join(tmp, 'd.json'), { ...good, script: 'nope.md' })).ok, '없는 제작본 = 거절');
  ok(OC.readOrder(W(path.join(cfg.ordersDir, 'e_x.json'), { ...good, upload: { enabled: false } })).ok, '업로드 끈 주문은 제목·앱이 없어도 된다');
  const known = { channels: ['05_로이의성경이야기'], voices: ['#05_득수_낭독2'], styles: ['webtoon-illust'] };
  ok(OC.checkKnown(r.order, known).length === 0, '있는 채널·목소리·그림체 = 통과');
  ok(OC.checkKnown({ ...r.order, voice: '없음' }, known).length === 1, '없는 목소리 = 거절(기본값으로 대신 만들지 않는다)');
  ok(OC.checkKnown(r.order, { ...known, voices: null }).length === 1, '서버 목록을 못 읽으면 거절(fail-closed)');
  ok(OC.checkKnown({ ...r.order, style: 'x', primingChannel: 'y' }, known).length === 2, '없는 그림체·채널 = 거절');
  ok(JSON.stringify(OC.emptyPromptGroups({ projects: [{ groups: [{ num: 1, imagePrompt: 'a' }, { num: 2, imagePrompt: ' ' }, { num: 3 }] }] })) === '[2,3]', '빈 그림 지시문 장면 번호');
  // 운영 상태
  ok(!OC.readOps(path.join(tmp, 'no-ops.json')).run, '운영 상태 파일이 없으면 멈춤');
  ok(OC.readOps(W(path.join(tmp, 'ops1.json'), { 상태: '운영' })).run, '「상태: 운영」 = 진행');
  ok(OC.readOps(W(path.join(tmp, 'ops2.json'), { state: 'run' })).run, '「state: run」 = 진행');
  ok(!OC.readOps(W(path.join(tmp, 'ops3.json'), { 상태: '멈춤' })).run, '「멈춤」 = 멈춤');
  ok(!OC.readOps(W(path.join(tmp, 'ops4.json'), '{')).run, '못 읽으면 멈춤');
  // 결과서 한 번만
  const rd = path.join(tmp, 'res');
  const p1 = OC.writeResultOnce(rd, 'roy-bible_1210', { a: 1 });
  const p2 = OC.writeResultOnce(rd, 'roy-bible_1210', { a: 2 });
  ok(path.basename(p1) === 'roy-bible_1210.json' && path.basename(p2) === 'roy-bible_1210_2.json' && JSON.parse(fs.readFileSync(p1, 'utf8')).a === 1, '결과서는 덮어쓰지 않는다 — 두 번째는 _2');
  OC.writeReceipt(rd, 'roy-bible_1210', { pid: 1 });
  OC.writeBeat(rd, 'roy-bible_1210', { stage: '음성' });
  ok(fs.existsSync(OC.receiptPath(rd, 'roy-bible_1210')) && JSON.parse(fs.readFileSync(OC.beatPath(rd, 'roy-bible_1210'), 'utf8')).stage === '음성', '받음 · 진행 신호 파일');
  ok(/KST$/.test(OC.kst()), '시각은 KST');
  ok(!OC.stopRequested(rd, 'roy-bible_1210'), '중단 요청 없음');
  W(OC.stopPaths(rd, 'roy-bible_1210')[0], 'x');
  ok(OC.stopRequested(rd, 'roy-bible_1210') && !OC.stopRequested(rd, 'other_1210'), '이 주문만 중단 요청');
  W(OC.stopPaths(rd, '')[1], 'x');
  ok(OC.stopRequested(rd, 'other_1210'), '_중단요청 = 전부');
  // 같은 목소리 묶음
  W(path.join(cfg.ordersDir, 'jj_1210.json'), { ...good, channelId: 'jj', voice: '#05_득수_낭독2' });
  W(path.join(cfg.ordersDir, 'kk_1210.json'), { ...good, channelId: 'kk', voice: '별빛' });
  W(path.join(cfg.ordersDir, 'll_1211.json'), { ...good, channelId: 'll' });
  const sv = OC.sameVoiceInBatch(cfg.ordersDir, r.order);
  ok(sv.length === 1 && sv[0].channelId === 'jj', '같은 예정일 · 다른 채널 · 같은 목소리만');
  ok(OC.mmddOf('roy-bible_1210') === '1210' && OC.mmddOf('roy-bible_1210_2') === '1210', 'MMDD 읽기');
  // 측정
  const st = OC.sceneStats([{ sec: 10, motion: '줌인' }, { sec: 30, motion: '줌인' }, { sec: 5, motion: '좌→우 팬' }]);
  ok(st.sceneAvgSec === 15 && st.sceneMaxSec === 30 && st.motions['줌인'] === 2, '장면 평균·최장·움직임 개수');
  ok(OC.charsPerMin(['가 나 다', '라마'], 30) === 10, '낭독 속도 = 공백 제외 글자 ÷ 분');
  ok(OC.motionName(0) === '줌인' && OC.motionName(-1) === '없음' && OC.MOTION_NAMES.length === require('../core/ken-burns').KEN_BURNS_PATTERNS.length, '움직임 이름 = 켄번스 패턴 수와 같다');
  ok(!/sk-ant-abcdefghijklmnop1234/.test(OC.reasonLine(new Error('키 sk-ant-abcdefghijklmnop1234 틀림\n둘째 줄'))) && !/둘째/.test(OC.reasonLine(new Error('a\n둘째'))), '까닭 = 한 줄 · 비밀 값 가림');
  // 장부
  const lf = path.join(tmp, 'ledger.json');
  ok(OC.ledgerGet('roy-bible_1210', lf) === null, '장부 비어 있음');
  OC.ledgerSet('roy-bible_1210', { videoId: 'abcdefghijk' }, lf);
  ok(OC.ledgerGet('roy-bible_1210', lf).videoId === 'abcdefghijk', '장부에 영상 ID');
  ok(OC.workflowModels(path.join(ROOT, 'comfy', 'image_qwen21_turbo.json')).some((m) => /qwen_image_2\.1/.test(m)), '워크플로에서 모델 이름');
  const b = OC.blankResult(r.order, { version: '1.0.18' });
  ok(['status', 'stage', 'reason', 'uploaded', 'videoId', 'resumable', 'files', 'log', 'sameVoice', 'startedAt', 'endedAt'].every((k) => k in b) && b.uploaded === '안 함', '결과서 칸이 늘 같은 자리에');
}

console.log('[2] 유료 호출 문');
{
  const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  process.env.PM_NO_PAID = '1';
  const CA = require('../core/claude-api');
  ok(CA.available() === false, 'Claude available() = false');
  CA.ask({ text: 'x' }).then((r) => ok(r.ok === false && r.noPaid, 'Claude ask() 가 부르지 않고 돌아온다'));
  ok(/PM_NO_PAID === '1'\) return '';/.test(src('core/kie-api.js')) && /PM_NO_PAID === '1'\) throw/.test(src('core/kie-api.js')), 'kie 키·호출 막힘');
  ok(/PM_NO_PAID === '1'\) return '';/.test(src('core/gemini-image.js')), 'Gemini 이미지 키 막힘');
  ok(/PM_NO_PAID === '1'\) throw/.test(src('core/spell-check.js')), 'claude CLI(끊어 읽기·맞춤법) 막힘');
  delete process.env.PM_NO_PAID;
}

console.log('[3] 유튜브 인증 프로필');
{
  const YT = require('../core/youtube-upload');
  YT._setDefaultClient({ clientId: 'd', clientSecret: 's', projectId: 'p' });
  ok(path.basename(YT.authFile()) === 'youtube-auth.json', '기본 = 예전 파일');
  ok(YT.status().hasClient === true, '기본에선 앱 기본 클라이언트가 있다');
  YT.setAuthProfile('2.0');
  ok(path.basename(YT.authFile()) === 'youtube-auth.2.0.json', '프로필 = 따로 파일');
  ok(YT.status().hasClient === false || fs.existsSync(YT.authFile()), '프로필에선 앱 기본(공용) 클라이언트로 떨어지지 않는다');
  ok(!/[\\/]/.test(YT.setAuthProfile('../x\\y')), '프로필 이름의 경로 글자(/ \\)는 지운다');
  YT.setAuthProfile('');
  YT._setDefaultClient(undefined);
}

console.log('[4] 양보 시간');
{
  const GS = require('../core/gpu-share');
  GS.resetYield(); GS.addYield(30, 'tts'); GS.addYield(12, 'image'); GS.addYield(-5, 'tts');
  const y = GS.yieldStats();
  ok(y.tts === 30 && y.image === 12 && y.total === 42, '음성·그림 양보 초를 따로 쌓는다');
  const pv = fs.readFileSync(path.join(ROOT, 'tts', 'providers', 'omnivoice-provider.js'), 'utf8');
  ok(/deferT0/.test(pv) && /addYield\(\(reqT0 - deferT0\) \/ 1000, 'tts'\)/.test(pv), 'omnivoice 미룸 = 차례를 얻은 순간 기다린 초를 쌓는다');
}

console.log('[5] main · bootstrap 연결');
{
  const m = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const bs = fs.readFileSync(path.join(ROOT, 'bootstrap.js'), 'utf8');
  ok(/if \(HEADLESS\) \{ _headlessMain\(\); return; \}/.test(m), 'whenReady — 무인 실행이면 창을 만들지 않는다');
  ok(/function writeWorkspace\(\) \{\n  if \(HEADLESS\) return;/.test(m), '무인 실행은 로이 앱의 작업 큐 파일을 덮지 않는다');
  ok(/if \(!HEADLESS\) await require\('\.\/light-updater'\)\.applyUpdates\(\)/.test(bs) && /electron-order/.test(bs) && /disableHardwareAcceleration/.test(bs), 'bootstrap — 업데이트 안 함 · 자기 저장 공간 · 화면 가속 끔');
  const blk = m.slice(m.indexOf('async function runOrderHeadless'), m.indexOf('// 미리보기 오디오 — 파일을 base64'));
  ok(/P\.setPresetOverride\(base\.name, preset\)/.test(blk) && !/preset-store'\)\.save/.test(blk), '채널 값은 이 프로세스에서만 덮는다(설정 파일 저장 없음)');
  ok(/enqueueYtUpload\(\{ file: mp4, channelId: ytCh, meta, finish: null, noSchedule: true, itemId: it\.id \}\)/.test(blk) && !/YT\.uploadVideo/.test(blk), '업로드는 같은 관문(enqueueYtUpload) · 마무리·예약 끔');
  ok(/const sched = noSchedule \? null :/.test(m), 'runYtUpload — noSchedule 이면 예약하지 않는다');
  ok(/videoEngine: 'none'/.test(blk) && /outTarget: 'mp4'/.test(blk) && /uploadAfter: 'off'/.test(blk) && /openVrew: false/.test(blk), '영상 없음 · MP4 · 화면 업로드 끔 · .vrew 안 엶');
  ok(/process\.env\.PM_NO_PAID = '1'/.test(blk) && /process\.env\.PM_CAPMARKS_OFF = '1'/.test(blk), '유료 호출 문 · 끊어 읽기 끔');
  ok(/OC\.readOps\(cfg\.opsFile\)[\s\S]*OC\.readOps\(cfg\.opsFile\)/.test(blk), '운영 상태를 시작 전·업로드 직전 두 번 읽는다');
  ok(/OC\.ledgerGet\(order\.orderId\)/.test(blk) && (blk.match(/OC\.ledgerSet\(/g) || []).length === 2, '장부 — 이미 올린 주문은 만들지 않음 · 올린 뒤 기록');
  ok(/emptyPromptGroups/.test(blk) && /royOpenInfo/.test(blk), '빈 지시문 · 🟥 미확인 경험 = 거절');
  ok(/if \(!HEADLESS && orderRunnerActive\(\)\)/.test(m), '로이 앱은 무인 제작이 쓰는 ComfyUI 를 끄지 않는다');
  ok(/dialog\.showMessageBox = async/.test(m) && /shell\.openPath = async \(\) => ''/.test(m), '무인 실행 — 묻는 창·파일 열기 없음');
}

console.log('[6] MP4 렌더 즉시 중단');
{
  const vr = fs.readFileSync(path.join(ROOT, 'core', 'vrew-render.js'), 'utf8');
  ok(/const abortWatch = setInterval\(\(\) => \{\n    if \(!isAborted\(\)\) return;\n    for \(const cp of ctx\.children\)/.test(vr) && /clearInterval\(abortWatch\)/.test(vr), '중단이면 0.5초 안에 돌던 ffmpeg 를 끈다');
  const i1 = vr.indexOf("if (isAborted()) return { ok: false, cancelled: true, error: '중단됨' };   // 끈 ffmpeg"), i2 = vr.indexOf('if (firstErr) return { ok: false, error: firstErr.message };');
  ok(i1 > 0 && i2 > i1, '끈 ffmpeg 의 오류보다 중단이 먼저(결과 = 중단됨)');
}

setTimeout(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${pass} 통과 · ${fail} 실패`);
  process.exit(fail ? 1 : 0);
}, 300);
