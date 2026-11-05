'use strict';
/**
 * node test/codex-image.test.js — 🎨 그림 엔진 코덱스(2.0 덧붙임3 ㉞~㊶ · v1.0.33) · 진짜 코덱스·할당량을 쓰지 않는다(가짜 = test/fixtures/fake-codex.js)
 *   [1] 꼬리(㊵) · 판 비교 · [2] 실행 파일 찾기(파일 있음 + --version 답함 · 여럿이면 높은 판)
 *   [3] 🔴 실행 전 확인 셋(auth_mode · auth.json 키 · 프로세스/사용자/시스템 환경 변수 · 크레딧)
 *   [4] 사용량 읽기 · [5] 한 장 그리기(복사만 · 지시 · 자식 환경에 키 없음 · 실패 · 시간 초과) · [6] ㊴ 1.15배 CPU 확대
 *   [7] 주문서 칸(codex · characters · thumbPrompts) · [8] 지시 줄 👤 인물 · [9] 지킬 선(소스 검사)
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const FF = require('../core/media-utils').getFfmpegPath();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-t-'));
const home = path.join(tmp, '.codex');
process.env.PM_CODEX_HOME = home;
const CX = require('../core/codex-image');
const FAKE = path.join(__dirname, 'fixtures', 'fake-codex.js');
const W = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof o === 'string' ? o : JSON.stringify(o)); return f; };

(async () => {
  try {
    console.log('[1] 꼬리 · 판 비교');
    ok(CX.withTail('A night village.') === 'A night village. ' + CX.TAIL && CX.withTail('a cat') === 'a cat. ' + CX.TAIL, '꼬리는 지시문 뒤에 붙이기만(앞은 그대로)');
    ok(/decorations/.test(CX.TAIL) && /night/.test(CX.TAIL) && /exactly the number/.test(CX.TAIL), '꼬리 세 뜻(장식 · 밤 · 개수)');
    const vs = ['0.166.0', '0.165.9', '0.166.0-alpha.6', '0.167.0-alpha.1', '0.166.0-alpha.12'].sort(CX.cmpVer);
    ok(vs.join() === '0.165.9,0.166.0-alpha.6,0.166.0-alpha.12,0.166.0,0.167.0-alpha.1', '판 비교(꼬리 숫자 · 정식판 > alpha) ' + vs.join());

    console.log('[2] 실행 파일 찾기');
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(path.join(bin, 'aaaa'), { recursive: true });
    fs.mkdirSync(path.join(bin, 'bbbb'), { recursive: true });
    try { fs.linkSync(process.execPath, path.join(bin, 'bbbb', 'codex.exe')); } catch (_) { fs.copyFileSync(process.execPath, path.join(bin, 'bbbb', 'codex.exe')); }
    process.env.PM_CODEX_BIN_ROOT = bin;
    let f = await CX.findCodex();
    ok(!f.exe && f.tried.find((t) => t.dir === 'aaaa').why === 'codex.exe 없음' && /답하지/.test(f.tried.find((t) => t.dir === 'bbbb').why), '빈 폴더 · --version 이 코덱스로 답하지 않는 파일 = 못 찾음(코덱스 0)');
    process.env.PM_CODEX_BIN_ROOT = path.join(tmp, '없는곳');
    f = await CX.findCodex();
    ok(!f.exe && f.tried[0].why === '폴더 없음', '폴더가 없으면 못 찾음');
    delete process.env.PM_CODEX_BIN_ROOT;
    const real = await CX.findCodex();
    if (real.exe) ok(/^\d+\.\d+\.\d+/.test(real.version) && /codex\.exe$/i.test(real.exe), `이 PC 의 진짜 코덱스 = ${real.version}(폴더 이름을 박지 않음 · --version 만 · 그림 호출 없음)`);
    else ok(true, '이 PC 에 코덱스 없음 — 건너뜀');

    console.log('[3] 실행 전 확인 셋');
    const auth = (o) => W(path.join(home, 'auth.json'), o);
    const sess = (rl) => W(path.join(home, 'sessions', '2026', '11', '05', 'rollout-x-base.jsonl'), JSON.stringify({ timestamp: '2026-11-05T01:00:00Z', payload: { type: 'token_count', rate_limits: rl } }) + '\n');
    const RL = (used, credits = false, plan = 'team') => ({ primary: { used_percent: used, window_minutes: 10080, resets_at: 1794420405 }, credits: { has_credits: credits }, plan_type: plan });
    const env0 = { ...process.env }; delete env0.OPENAI_API_KEY; delete env0.CODEX_API_KEY;
    process.env.PM_CODEX_REG_FAKE = JSON.stringify({});
    auth({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: {} }); sess(RL(12));
    let pf = await CX.preflight({ env: env0 });
    ok(pf.ok && pf.checks.authMode === 'chatgpt' && pf.checks.authKeyEmpty && pf.checks.envEmpty.process && pf.checks.envEmpty.user && pf.checks.envEmpty.system && pf.checks.hasCredits === false, '모두 맞으면 통과');
    auth({ auth_mode: 'apikey', OPENAI_API_KEY: null });
    pf = await CX.preflight({ env: env0 }); ok(!pf.ok && /구독 로그인이 아닙니다/.test(pf.why), '① auth_mode ≠ chatgpt → 막음');
    auth({ auth_mode: 'chatgpt', OPENAI_API_KEY: 'sk-x' });
    pf = await CX.preflight({ env: env0 }); ok(!pf.ok && /auth\.json 에 API 키/.test(pf.why), '② auth.json 에 키 → 막음');
    auth({ auth_mode: 'chatgpt', OPENAI_API_KEY: null });
    pf = await CX.preflight({ env: { ...env0, OPENAI_API_KEY: 'sk-fake' } }); ok(!pf.ok && /프로세스 환경/.test(pf.why), '③ 프로세스 OPENAI_API_KEY → 막음(시험 ㄴ′)');
    pf = await CX.preflight({ env: { ...env0, CODEX_API_KEY: 'k' } }); ok(!pf.ok && /프로세스 환경/.test(pf.why), '③ 프로세스 CODEX_API_KEY → 막음');
    process.env.PM_CODEX_REG_FAKE = JSON.stringify({ user: { CODEX_API_KEY: true } });
    pf = await CX.preflight({ env: env0 }); ok(!pf.ok && /사용자 환경/.test(pf.why), '③ 사용자 환경 변수 → 막음');
    process.env.PM_CODEX_REG_FAKE = JSON.stringify({ system: { OPENAI_API_KEY: true } });
    pf = await CX.preflight({ env: env0 }); ok(!pf.ok && /시스템 환경/.test(pf.why), '③ 시스템 환경 변수 → 막음');
    process.env.PM_CODEX_REG_FAKE = JSON.stringify({});
    sess(RL(12, true));
    pf = await CX.preflight({ env: env0 }); ok(!pf.ok && /크레딧/.test(pf.why), '크레딧이 있으면 막음(한도를 넘으면 돈이 나간다)');
    fs.rmSync(path.join(home, 'auth.json'));
    pf = await CX.preflight({ env: env0 }); ok(!pf.ok && /없음/.test(pf.why), 'auth.json 이 없으면 막음');
    auth({ auth_mode: 'chatgpt', OPENAI_API_KEY: null }); sess(RL(12));

    console.log('[4] 사용량');
    const u = CX.latestUsage();
    ok(u && u.usedPercent === 12 && u.windowMinutes === 10080 && /^2026-11-12 03:06 KST$/.test(u.resetsAt) && u.planType === 'team' && u.hasCredits === false, '주간 % · 창 · 초기화(KST) · plan · credits ' + JSON.stringify(u));
    ok(CX.concOf(undefined) === 4 && CX.concOf(9) === 6 && CX.concOf(2) === 2 && CX.capOf(undefined) === 60 && CX.capOf(30) === 30, '동시 줄 기본 4 · 상한 6 · 사용량 상한 기본 60');

    console.log('[5] 한 장 그리기(가짜 코덱스)');
    const png = path.join(tmp, 'src.png'); execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x806040:s=1672x941', '-frames:v', '1', png]);
    const logf = path.join(tmp, 'fake.log');
    Object.assign(process.env, { FAKE_CODEX_PNG: png, FAKE_LOG: logf, FAKE_USED: '20', OPENAI_API_KEY: 'sk-parent-should-not-pass' });
    const work = path.join(tmp, 'work');
    const r = await CX.generate({ exe: 'node', prefixArgs: [FAKE], prompt: CX.withTail('a hill'), refs: [png], transparent: true, outPath: path.join(tmp, 'out', 'a.png'), workDir: work });
    delete process.env.OPENAI_API_KEY;
    const call = JSON.parse(fs.readFileSync(logf, 'utf8').trim().split('\n').pop());
    ok(r.ok && fs.existsSync(path.join(tmp, 'out', 'a.png')) && /^fake/.test(r.threadId), '그림을 편 폴더로 복사 · thread id');
    ok(fs.existsSync(r.src) && fs.readdirSync(path.dirname(r.src)).length === 1, '코덱스 폴더의 그림은 그대로(복사만 · 지우거나 옮기지 않음)');
    ok(r.usage && r.usage.usedPercent > 20 && r.toolSec[0] === 1.5, '그 실행 기록에서 사용량 · 도구 시간을 읽는다');
    ok(call.args.join(' ') === `exec --json --skip-git-repo-check -s read-only -c model_reasoning_effort="low" -C ${work} -`, '부르는 꼴 = exec --json --skip-git-repo-check -s read-only -C <빈 작업 폴더> -');
    ok(/image_gen__imagegen/.test(call.stdin) && /"transparent_background":true/.test(call.stdin) && /"referenced_image_paths":\[/.test(call.stdin) && /exactly once/.test(call.stdin) && /do not run shell commands/i.test(call.stdin), '지시 = 내장 도구를 정확히 한 번 · 셸 없음 · 투명 · 참조 그림');
    ok(call.envKey === false, '자식 코덱스 환경에는 API 키가 넘어가지 않는다(부모에 있어도)');
    process.env.FAKE_FAIL_AFTER = '0';
    const r2 = await CX.generate({ exe: 'node', prefixArgs: [FAKE], prompt: 'x', outPath: path.join(tmp, 'out', 'b.png'), workDir: work });
    ok(!r2.ok && /그림이 나오지 않았습니다/.test(r2.error) && !fs.existsSync(path.join(tmp, 'out', 'b.png')), '실패 = 그림 없음 + 까닭');
    delete process.env.FAKE_FAIL_AFTER; process.env.FAKE_SLEEP_MS = '3000';
    const r3 = await CX.generate({ exe: 'node', prefixArgs: [FAKE], prompt: 'x', outPath: path.join(tmp, 'out', 'c.png'), workDir: work, timeoutMs: 800 });
    ok(!r3.ok && /시간 초과/.test(r3.error), '시간 초과 = 실패(시험 ㄹ′)');
    delete process.env.FAKE_SLEEP_MS;

    console.log('[6] ㊴ 확대');
    const fit = path.join(tmp, 'fit.png'); await CX.fitTo(png, fit, 1920, 1080);
    const z = require('../vrew/vrew-builder').readImageSize(fit);
    ok(z.w === 1920 && z.h === 1080 && fs.existsSync(png), '1672×941 → 1920×1080(CPU Lanczos · 원본은 그대로)');

    console.log('[7] 주문서 칸');
    const OC = require('../core/order-contract');
    const md = W(path.join(tmp, 'o', 'x.md'), '# t\n### 가\n> 🖼️ 이미지: a.\n문장입니다.\n');
    const base = { script: md, channelId: 'c1', primingChannel: 'p', voice: 'v', style: 's', upload: { enabled: false } };
    const rd = (o) => OC.readOrder(W(path.join(tmp, 'o', 'o.json'), { ...base, ...o }));
    let q = rd({ imageEngine: 'codex:imagegen' });
    ok(q.ok && q.order.codex.scope === 'all' && q.order.codex.concurrency === 4 && q.order.codex.capPercent === 60, '코덱스 엔진 = 받음 · 기본 편 전체 · 4줄 · 60%');
    q = rd({ imageEngine: 'codex:imagegen', codex: { scope: 'intro', concurrency: 6, capPercent: 40, timeoutSec: 30 } });
    ok(q.ok && q.order.codex.scope === 'intro' && q.order.codex.concurrency === 6 && q.order.codex.timeoutSec === 30, '도입부만 · 6줄 · 상한 40');
    ok(!rd({ imageEngine: 'codex:imagegen', codex: { concurrency: 7 } }).ok, '7줄 = 거절(6 위는 열지 않음)');
    ok(!rd({ imageEngine: 'local:qwen-2-1', codex: { scope: 'all' } }).ok, '코덱스 엔진이 아닌데 codex 칸 = 거절(조용히 무시 안 함)');
    q = rd({ imageEngine: 'codex:imagegen', characters: [{ name: '과부', prompt: 'an old widow' }, { name: 'Jesus', prompt: 'a man', redraw: true }] });
    ok(q.ok && q.order.characters.length === 2 && q.order.characters[1].redraw === true, '캐릭터 셋 인물 목록');
    ok(!rd({ imageEngine: 'codex:imagegen', characters: [{ name: '과부', prompt: '' }] }).ok && !rd({ imageEngine: 'codex:imagegen', characters: [{ name: 'a/b', prompt: 'x' }] }).ok && !rd({ characters: [{ name: '과부', prompt: 'x' }] }).ok, '빈 지시문 · 이상한 이름 · 코덱스 아님 = 거절');
    q = rd({ imageEngine: 'codex:imagegen', thumbPrompts: ['a', 'b', 'c'] });
    ok(q.ok && q.order.thumbPrompts.length === 3, '썸네일 3안');
    ok(!rd({ thumbPrompts: ['a', 'b', 'c', 'd'] }).ok && !rd({ thumbPrompts: ['a'], thumbPrompt: 'b' }).ok, '4안 · 한 장 칸과 함께 = 거절');
    ok(rd({}).ok && rd({}).order.codex === null && rd({}).order.characters.length === 0 && rd({}).order.thumbPrompts.length === 0, '칸이 없으면 지금 그대로(코덱스 없음)');

    console.log('[8] 👤 인물 지시 줄');
    const SD = require('../core/scene-directives'), P = require('../core/pipeline');
    const pr = P.parseScriptText('# t\n## 장\n### 가\n> 🖼️ 이미지: a.\n> 👤 인물: 과부, 예수\n첫 문장입니다.\n### 나\n> 🖼️ 이미지: b.\n둘째 문장입니다.\n', 'longform', {}).projects[0];
    ok(JSON.stringify(pr.groups[0].cast) === '["과부","예수"]' && !pr.groups[1].cast && pr.groups.map((g) => g.imagePrompt).join() === 'a.,b.', '`> 👤 인물:` = 그 장면 인물(그림 지시문은 그대로)');
    ok(SD.parse('# t\n### 가\n> 👤 인물:\n문장.\n')[0].error, '빈 인물 줄 = 오류 글');

    console.log('[9] 지킬 선');
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'core', 'codex-image.js'), 'utf8');
    const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    ok(!/image_gen\.py|gpt-image|api\.openai\.com|images\/generations/i.test(SRC + M), 'API 폴백 스크립트 · gpt-image API 를 부르지 않는다');
    ok(!/(rmSync|unlinkSync|renameSync)\([^)]*generated_images/.test(SRC + M) && /copyFileSync\(png, outPath\)/.test(SRC), 'generated_images 는 복사만');
    ok(!/login|logout|--upgrade|credits.*purchase/i.test(SRC.replace(/로그인/g, '')), '로그인 · 로그아웃 · 업데이트 · 크레딧 구매 없음');
    ok(/delete env\.OPENAI_API_KEY; delete env\.CODEX_API_KEY/.test(SRC) && /'-s', 'read-only'/.test(SRC), '자식 환경에서 키를 지우고 · 읽기 전용 샌드박스');
    ok(/_orderCodexPrep\(it, order, L\)/.test(M) && /_orderCodexRevert\(cx, it, L, e\.message\)/.test(M) && /class CodexFail/.test(M), '편 통째 되돌림 배선');
    ok(/for \(let t = 1; t <= 2; t\+\+\)/.test(M.slice(M.indexOf('async function _codexDraw'), M.indexOf('async function _orderCodexPrep'))), '실패한 장의 재시도는 한 번까지');
    ok(/imgEngine: order\.imageEngine === OC\.CODEX_ENGINE \? 'local:qwen-2-1'/.test(M), '코덱스 편이 남긴 장면 · 되돌림은 로컬 Qwen 이 그린다');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
  console.log(`\n${fail ? '❌' : '✅'} codex-image ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
