'use strict';
/**
 * test/flow-connect.test.js — Flow 접속 대기 회귀 (2026-09-04)
 *
 * 🔴 실사고: 헤더에서 Flow 를 골라 이미지를 만들었는데 Flow 창이 뜨고 아무것도 안 만든 뒤 Genspark 로 넘어갔다.
 *   로그: `[Flow] 계정 1 실행 오류: page.goto: Timeout 30000ms exceeded. … waiting until "networkidle"`.
 *   Flow SPA 는 백그라운드 통신이 끊이지 않아 networkidle(0.5초 무통신)에 30초 안에 못 닿는 날이 있다
 *   (정상일 때도 11~14초 — 09-03 로그). Genspark 전환은 순환의 설계된 이어받기이지 버그가 아니다.
 *
 * 🔑 앱 원문을 그대로 돌린다 — page 만 가짜로 주입해 _gotoFlow/_waitFlowReady 를 실행한다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0, fails = 0;
function ok(label, fn) { n++; try { fn(); console.log('  ✓ [' + n + '] ' + label); } catch (e) { fails++; console.log('  ✗ [' + n + '] ' + label + '\n      ' + e.message); } }
async function okAsync(label, fn) { n++; try { await fn(); console.log('  ✓ [' + n + '] ' + label); } catch (e) { fails++; console.log('  ✗ [' + n + '] ' + label + '\n      ' + e.message); } }

const ROOT = path.join(__dirname, '..');
const ENGINE = fs.readFileSync(path.join(ROOT, 'flow-engine.js'), 'utf8').replace(/\r\n/g, '\n');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const { FlowAutomator } = require(path.join(ROOT, 'flow-engine.js'));

/** 가짜 page — goto 가 어떻게 불리는지 기록하고, evaluate 는 준비 신호를 흉내낸다. */
function fakePage({ url = 'https://labs.google/fx/ko/tools/flow', readyAfter = 0, gotoFail = false } = {}) {
  let evalCount = 0;
  return {
    calls: [],
    url: () => url,
    async goto(u, opts) { this.calls.push({ u, opts }); if (gotoFail) throw new Error('page.goto: Timeout 60000ms exceeded.'); },
    async waitForTimeout() {},
    async evaluate(fn) { evalCount++; return evalCount > readyAfter ? '홈(새 프로젝트)' : null; },
  };
}
function mk(page) { const eng = Object.create(FlowAutomator.prototype); eng.page = page; eng.logs = []; eng.log = (m) => eng.logs.push(String(m)); return eng; }

console.log('\n[1] 접속 대기 방식 — 원문 대조');
ok('goto(FLOW_URL) 에 networkidle 이 남아 있지 않다 (실사고 원인)', () => {
  assert.ok(!/this.page.goto\(FLOW_URL,\s*\{\s*waitUntil:\s*'networkidle'/.test(ENGINE), 'networkidle goto 잔존');
});
ok('reload 도 networkidle 을 쓰지 않는다', () => { assert.ok(!/reload\(\{\s*waitUntil:\s*'networkidle'/.test(ENGINE)); });
ok('FLOW_URL 로 가는 곳은 전부 _gotoFlow 를 거친다 (직접 goto 0곳)', () => {
  assert.strictEqual((ENGINE.match(/this\.page\.goto\(FLOW_URL/g) || []).length, 1, '_gotoFlow 안의 1곳만 허용');
  assert.ok((ENGINE.match(/await this\._gotoFlow\(/g) || []).length >= 4, '호출 4곳(로그인·접속·403·메인복귀)');
});
ok('_gotoFlow 는 load 까지만 기다리고 상한을 60초로 둔다', () => {
  assert.ok(/goto\(FLOW_URL, \{ waitUntil: 'load', timeout: 60000 \}\)/.test(ENGINE));
});

console.log('\n[2] _gotoFlow / _waitFlowReady 원문 실행');
await0();
async function await0() {
  await okAsync('정상 접속: load 로 goto 하고 준비 신호를 보면 로그에 남는다', async () => {
    const eng = mk(fakePage());
    await eng._gotoFlow('접속');
    assert.strictEqual(eng.page.calls.length, 1);
    assert.strictEqual(eng.page.calls[0].opts.waitUntil, 'load');
    assert.ok(eng.logs.some((l) => l.includes('접속 완료(접속)') && l.includes('홈(새 프로젝트)')), eng.logs.join(' | '));
  });
  await okAsync('준비 신호가 늦게 와도(폴링 3회 뒤) 잡는다', async () => {
    const eng = mk(fakePage({ readyAfter: 3 }));
    const sig = await eng._waitFlowReady(5000);
    assert.strictEqual(sig, '홈(새 프로젝트)');
  });
  await okAsync('로그인 화면(accounts.google)도 준비 신호로 본다 — evaluate 없이', async () => {
    const eng = mk(fakePage({ url: 'https://accounts.google.com/signin' }));
    eng.page.evaluate = async () => { throw new Error('evaluate 를 부르면 안 된다'); };
    assert.strictEqual(await eng._waitFlowReady(2000), '로그인 화면');
  });
  await okAsync('🔴 goto 가 타임아웃으로 던져도 _gotoFlow 는 던지지 않는다 (옛 코드는 여기서 계정 전체가 죽었다)', async () => {
    const eng = mk(fakePage({ gotoFail: true }));
    await eng._gotoFlow('접속');
    assert.ok(eng.logs.some((l) => l.includes('페이지 로드가 늦습니다')), eng.logs.join(' | '));
    assert.ok(eng.logs.some((l) => l.includes('접속 완료')), '화면이 떠 있으면 그대로 진행한다');
  });
  await okAsync('준비 신호를 끝내 못 봐도 던지지 않고 경고만 남긴다 (fail-open)', async () => {
    const eng = mk(fakePage({ readyAfter: 1e9 }));
    eng._waitFlowReady = FlowAutomator.prototype._waitFlowReady;
    const sig = await eng._waitFlowReady(300);
    assert.strictEqual(sig, null);
  });
  await okAsync('evaluate 가 예외를 내도(페이지 전환 중) 판정은 계속된다', async () => {
    const eng = mk(fakePage());
    let k = 0; eng.page.evaluate = async () => { k++; if (k < 3) throw new Error('Execution context was destroyed'); return '프롬프트 입력칸'; };
    assert.strictEqual(await eng._waitFlowReady(5000), '프롬프트 입력칸');
  });

  console.log('\n[3] main.js — 엔진 로그가 이미지 경로에서도 파일에 남는다');
  ok('hookFlowEngLog 헬퍼가 있고 이미지·비디오 두 경로가 모두 부른다', () => {
    assert.ok(/function hookFlowEngLog\(eng\)/.test(MAIN));
    assert.ok((MAIN.match(/hookFlowEngLog\(eng\)/g) || []).length >= 2, '호출 2곳 이상');
  });
  ok('runFlowImages 본문 안에서 후킹한다 (09-04 사고 때 접속 단계 로그가 파일에 없었다)', () => {
    const i = MAIN.indexOf('async function runFlowImages(');
    const j = MAIN.indexOf('\nasync function ', i + 10);
    const body = MAIN.slice(i, j > 0 ? j : undefined);
    assert.ok(body.includes('hookFlowEngLog(eng)'), 'runFlowImages 에 후킹 없음');
  });
  ok('후킹은 한 번만 (재사용 인스턴스 중복 기록 방지)', () => { assert.ok(/eng\._appLogHooked\)/.test(MAIN) || /eng\._appLogHooked \|\|/.test(MAIN)); });

  console.log('\n[4] 2026-09-04 Flow 새 UI(flow.google.com · Angular Material) — 실측 셀렉터가 코드에 있다');
  ok('FLOW_URL 이 flow.google.com 이고 옛 labs.google 도 호스트 판정에 남아 있다(리다이렉트 대비)', () => {
    assert.ok(/^const FLOW_URL = 'https:\/\/flow\.google\.com\/';/m.test(ENGINE), 'FLOW_URL');
    assert.ok(/^const FLOW_HOST_RE = .*labs\\.google.*flow\\.google\\.com/m.test(ENGINE), 'FLOW_HOST_RE 두 호스트');
    assert.ok(!/waitForURL\(\/labs\\.google\//.test(ENGINE), 'waitForURL 에 labs.google 단독 판정 잔존');
  });
  ok('프롬프트 입력칸 = ProseMirror(contenteditable) 도 받는다 (옛 role=textbox 유지)', () => {
    assert.ok(/^const PROMPT_BOX = .*ProseMirror.*contenteditable/m.test(ENGINE));
    assert.ok(/^const PROMPT_BOX = .*div\[role="textbox"\]/m.test(ENGINE));
  });
  ok('aria-label 앵커 6종: 설정 트리거·생성 시작·모델 제품군 선택·프롬프트 상자에 소재 추가·미디어 메뉴 추가·옵션 더보기', () => {
    for (const a of ['설정 트리거', '생성 시작', '모델 제품군 선택', '프롬프트 상자에 소재 추가', '미디어 메뉴 추가', '옵션 더보기'])
      assert.ok(ENGINE.includes(`button[aria-label="${a}"]`), a + ' 없음');
  });
  ok('설정 팝업 탭은 role=radio(mat-button-toggle) 도 찾는다 — 옛 role=tab 만 보면 전부 실패', () => {
    const i = ENGINE.indexOf('  _tabLocator(name) {');
    assert.ok(i > 0, '_tabLocator 없음');
    assert.ok(/radio/.test(ENGINE.slice(i, i + 800)), 'radio 없음');
  });
  ok('결과 이미지는 context.request.get 으로 받는다(페이지 fetch 는 CORS 로 막힌다) + 타일 = flow-grid-tile-container', () => {
    assert.ok(/async _fetchDataUrl\(url\)/.test(ENGINE) && /ctx\.request\.get\(/.test(ENGINE));
    assert.ok((ENGINE.match(/_fetchDataUrl\(/g) || []).length >= 4, '호출 4곳 이상(정의 포함)');
    assert.ok(ENGINE.includes('flow-grid-tile-container'));
  });
  ok('업로드 = filechooser 폴백 + 권리 「동의」 확인창 처리 + 프레임은 라이브러리 경로가 있다', () => {
    assert.ok(/async _uploadViaChooser\(imagePath, num, label\)/.test(ENGINE) && /waitForEvent\('filechooser'/.test(ENGINE));
    assert.ok(/async _acceptUploadConsent\(num, label\)/.test(ENGINE) && /동의함/.test(ENGINE));
    assert.ok(/async _attachFrameViaLibrary\(imagePath, num\)/.test(ENGINE) && /await this\._attachFrameViaLibrary\(imagePath, num\)/.test(ENGINE));
  });
  ok('자동 첨부 감지(_promptBarHasAttachment)가 있고 실패 처리 직전에 한 번 더 본다 (E2E 08:59 — 붙었는데 false)', () => {
    assert.ok(/async _promptBarHasAttachment\(\)/.test(ENGINE));
    assert.ok((ENGINE.match(/await this\._promptBarHasAttachment\(\)/g) || []).length >= 4, '호출 4곳 이상');
    assert.ok(!ENGINE.includes('document.document'), 'document.document 오타(E2E 실사고) 잔존');
  });
  await okAsync('_promptBarHasAttachment — 칩에 이미지가 있으면 true, 없으면 false, evaluate 예외면 false(안 던짐)', async () => {
    const mkP = (ret, throws) => { const e = mk({ async evaluate(fn) { if (throws) throw new Error('ctx destroyed'); return ret; } }); return e; };
    assert.strictEqual(await mkP(true)._promptBarHasAttachment(), true);
    assert.strictEqual(await mkP(false)._promptBarHasAttachment(), false);
    assert.strictEqual(await mkP(true, true)._promptBarHasAttachment(), false);
  });
  ok('_modelMatches — 라벨 뒤에 글자가 더 있으면 다른 모델(Nano Banana 2 ≠ Nano Banana 2 Lite), 아이콘 글자는 무시', () => {
    const e = mk({});
    assert.strictEqual(e._modelMatches('Veo 3.1 - Lite', 'Veo 3.1 - Lite'), true);
    assert.strictEqual(e._modelMatches('🍌 Nano Banana 2 Lite', 'Nano Banana 2 Lite'), true);
    assert.strictEqual(e._modelMatches('Nano Banana 2 Lite expand_more', 'Nano Banana 2 Lite'), true);
    assert.strictEqual(e._modelMatches('Nano Banana 2 Lite', 'Nano Banana 2'), false, 'Lite 를 2 로 오판');
    assert.strictEqual(e._modelMatches('Veo 3.1 - Lite', 'Veo 3.1 - Fast'), false);
    assert.strictEqual(e._modelMatches('', 'Veo 3.1 - Lite'), false);
  });

  console.log('\n[4] i2v 시작 프레임 — 앞 컷 그림이 다시 붙는 사고 (2026-10-06 아내 PC: 2·3·4·6번이 1번 그림에서 시작)');
  // 가짜 page — 칩·자산 목록 상태를 들고, evaluate 는 호출된 함수의 이름 대신 원문 일부로 어느 질의인지 가린다.
  function stPage(st) {
    const opts = { nth: (i) => ({ async click() { st.clicks.push(i); st.onClick && st.onClick(i); } }) };
    return {
      keyboard: { async press() {} },
      async waitForTimeout() {},
      locator: (sel) => sel.includes('role="option"') ? opts : { async count() { return 0; } },
      async evaluate(fn) {
        const src = String(fn);
        if (src.includes('[role="option"]')) return st.options.map((o) => ({ ...o }));
        if (src.includes('.click()')) { if (!st.chips.length) return false; st.chipClicks++; if (st.chipsRemovable) st.chips = []; return true; }
        if (src.includes('button[class*="chip"]')) return st.chips.slice();
        return null;
      },
    };
  }
  const mkSt = (st) => { st.clicks = st.clicks || []; st.chipClicks = 0; const e = mk(stPage(st)); return e; };

  ok('_isCompleteMp4 — 온전한 MP4 true · 잘린 조각/moov 없음/ftyp 아님 false', () => {
    const box = (t, n) => { const b = Buffer.alloc(8 + n); b.writeUInt32BE(8 + n, 0); b.write(t, 4, 'latin1'); return b; };
    const full = Buffer.concat([box('ftyp', 8), box('mdat', 4000), box('moov', 200)]);
    assert.strictEqual(FlowAutomator._isCompleteMp4(full), true);
    assert.strictEqual(FlowAutomator._isCompleteMp4(full.subarray(0, 2000)), false, 'mdat 중간에서 잘린 Range 조각(실제 05.mp4)');
    assert.strictEqual(FlowAutomator._isCompleteMp4(Buffer.concat([box('ftyp', 8), box('mdat', 4000)])), false, 'moov 없음');
    assert.strictEqual(FlowAutomator._isCompleteMp4(Buffer.concat([box('mdat', 4000), box('moov', 200)])), false, 'ftyp 로 시작 안 함');
    assert.strictEqual(FlowAutomator._isCompleteMp4(null), false);
  });
  await okAsync('_selectUploadedOption — 앞 컷 선택(1번)이 남아 있어도 새로 올린 그림만 선택한다', async () => {
    const st = { chips: [], options: [{ k: 'u1', sel: true }] };
    const e = mkSt(st);
    const before = await e._assetOptionKeys();
    // 업로드 → 새 자산이 맨 앞에 생긴다(선택 안 됨). 옛 코드는 「선택된 게 있으니」 아무것도 안 했다.
    st.options = [{ k: 'u2', sel: false }, { k: 'u1', sel: true }];
    st.onClick = (i) => { st.options[i].sel = !st.options[i].sel; };
    assert.strictEqual(await e._selectUploadedOption(before, 2, 'i2v'), true, e.logs.join(' | '));
    assert.deepStrictEqual(st.options.map((o) => o.sel), [true, false], '새 그림만 선택돼야 한다');
  });
  await okAsync('_selectUploadedOption — 새 그림이 목록에 안 보이면 false(그 컷을 만들지 않는다) · 목록 구조가 없으면 null', async () => {
    const st = { chips: [], options: [{ k: 'u1', sel: true }] };
    const e = mkSt(st);
    const t = Date.now; let fake = 0; Date.now = () => (fake += 5000);
    try { assert.strictEqual(await e._selectUploadedOption([{ k: 'u1', sel: true }], 2, 'i2v'), false); } finally { Date.now = t; }
    const e2 = mkSt({ chips: [], options: [] });
    const t2 = Date.now; let f2 = 0; Date.now = () => (f2 += 5000);
    try { assert.strictEqual(await e2._selectUploadedOption([], 2, 'i2v'), null); } finally { Date.now = t2; }
  });
  await okAsync('_verifyFreshAttachment — 칩 주소가 앞 컷과 같은데 파일이 다르면 false · 다른 그림이면 true', async () => {
    const st = { chips: ['blob:A'], options: [], chipsRemovable: true };
    const e = mkSt(st);
    assert.strictEqual(await e._verifyFreshAttachment('D:/x/01.jpg', 1, 'i2v'), true);
    st.chips = ['blob:A'];   // 2번을 붙였는데 1번 그림이 그대로
    assert.strictEqual(await e._verifyFreshAttachment('D:/x/02.jpg', 2, 'i2v'), false, '앞 컷 그림을 통과시켰다');
    st.chips = ['blob:B'];
    assert.strictEqual(await e._verifyFreshAttachment('D:/x/02.jpg', 2, 'i2v'), true);
    st.chips = ['blob:B'];   // 같은 파일 재첨부(재시도)는 통과
    assert.strictEqual(await e._verifyFreshAttachment('D:/x/02.jpg', 2, 'i2v'), true);
  });
  await okAsync('_clearStaleAttachments — 칩을 떼면 true · 안 떨어지면 false(fail-closed)', async () => {
    const a = mkSt({ chips: ['blob:A'], options: [], chipsRemovable: true });
    assert.strictEqual(await a._clearStaleAttachments(2, 'i2v'), true);
    const b = mkSt({ chips: ['blob:A'], options: [], chipsRemovable: false });
    assert.strictEqual(await b._clearStaleAttachments(2, 'i2v'), false);
    const c = mkSt({ chips: [], options: [] });
    assert.strictEqual(await c._clearStaleAttachments(1, 'i2v'), true);
  });
  ok('원문 배선 — 프레임·애셋 첨부가 떼기·검증을 거치고 「이미 붙어 있으니 그대로」 경로가 없다 · 옛 「선택 없을 때만 첫 항목」 제거', () => {
    assert.ok(!ENGINE.includes('그대로 씁니다'), '앞 컷 칩을 그대로 쓰는 경로 잔존');
    assert.strictEqual((ENGINE.match(/await this\._clearStaleAttachments\(num, '(i2v|애셋)'\)/g) || []).length, 2);
    assert.strictEqual((ENGINE.match(/await this\._verifyFreshAttachment\(imagePath, num, '(i2v|애셋)'\)/g) || []).length, 2);
    assert.ok(/const pick = await this\._selectUploadedOption\(beforeOpts, num, label\)/.test(ENGINE));
    assert.ok(!/if \(!selN\)/.test(ENGINE), '옛 선택 로직 잔존');
    assert.ok(/_isCompleteMp4\(b\)/.test(ENGINE) && /seen\.add\(hashOf\(vbuf\)\)/.test(ENGINE), '저장 전 온전성·중복 검사');
  });

  console.log(`\n${fails ? '❌' : '✅'} flow-connect: ${n - fails}/${n}`);
  process.exit(fails ? 1 : 0);
}
