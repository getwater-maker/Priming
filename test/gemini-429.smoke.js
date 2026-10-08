'use strict';
/**
 * node test/gemini-429.smoke.js — 나노바나나(Gemini) 429 한도 안내
 *   ① core/gemini-image.classify429 · explain429 · dailyResetKst (원문 함수)
 *   ② 앱 이미지 단계(imageBuild · 엔진 gemini)에 **가짜 429 응답**을 끼워 — 하루 한도는 즉시 멈추고(남은 그룹마다 같은 오류를 받지 않는다),
 *      분당 한도는 기다렸다가 같은 그룹을 다시 시도해 이어서 만든다.
 * ⚠ 실제 구글 호출 0 · 임시 채널/대본 · 끝나면 지운다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const GI = require('../core/gemini-image');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

// ① 분류·안내
{
  const body = (ids, msg, retry) => ({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: msg, details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: ids.map((q) => ({ quotaId: q, quotaMetric: 'x/' + q })) }].concat(retry ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: retry }] : []) } });
  ok(GI.classify429(body(['GenerateRequestsPerDayPerProjectPerModel'], 'Quota exceeded')).kind === 'daily', '하루 한도(quotaId PerDay) → daily');
  const mn = GI.classify429(body(['GenerateRequestsPerMinutePerProjectPerModel'], 'Quota exceeded', '12s'));
  ok(mn.kind === 'minute' && mn.retryAfterSec === 12, '분당 한도 → minute · 기다릴 시간 12초');
  const fr = GI.classify429({ error: { message: 'You exceeded your current quota. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-nano-banana-2.1 Please retry in 10h16m45.29s.' } });
  ok(fr.kind === 'free' && fr.retryAfterSec === 10 * 3600 + 16 * 60 + 45, '실제 무료 등급 429 → free · 재시도 시간 10h16m45s 파싱(' + fr.retryAfterSec + ')');
  ok(GI.classify429({ error: { message: 'Your prepayment credits are depleted. Please go to AI Studio billing.' } }).kind === 'billing', '충전 소진 문구 → billing');
  ok(GI.classify429({ error: { message: 'something odd' } }).kind === 'unknown', '모르는 429 → unknown');
  ok(GI.classify429(body(['GenerateRequestsPerMinutePerProjectPerModel'], 'x')).kind !== GI.classify429(body(['GenerateRequestsPerDayPerProjectPerModel'], 'x')).kind, '분당과 하루가 서로 다른 종류(판정력)');
  ok(GI.dailyResetKst(Date.parse('2026-10-08T07:00:00Z')) === '10월 9일 오후 4시', '일일 한도 풀리는 시각(여름 PDT) = 한국 오후 4시: ' + GI.dailyResetKst(Date.parse('2026-10-08T07:00:00Z')));
  ok(GI.dailyResetKst(Date.parse('2026-11-05T10:00:00Z')) === '11월 6일 오후 5시', '겨울(PST)에는 오후 5시');
  const ex = GI.explain429({ kind: 'daily' }, Date.parse('2026-10-08T07:00:00Z')).join('\n');
  ok(/하루 요청 한도/.test(ex) && /오후 4시/.test(ex) && /이어서/.test(ex), '하루 한도 안내문에 이유·풀리는 시각·이어 만드는 법');
  ok(/무료 등급/.test(GI.explain429({ kind: 'free' }).join('\n')) && /충전/.test(GI.explain429({ kind: 'billing' }).join('\n')), '무료·충전 안내문');
}

const lines = ['# 한도시험', '', '## 도입부'];
for (let g = 1; g <= 4; g++) lines.push(`### 〔장면 ${g}〕`, `> 🖼️ 이미지: scene ${g}`, `${g}번 장면의 이야기입니다.`, '');
lines.push('## 본문');
for (let g = 5; g <= 6; g++) lines.push(`### 〔장면 ${g}〕`, `> 🖼️ 이미지: scene ${g}`, `${g}번 장면의 이야기입니다.`, '');

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'g429-'));
  const TAG = `__한도시험_${process.pid}`;
  const CH = '__테스트채널_삭제해도됨_429_' + process.pid;
  const PRESETS = path.join(os.homedir(), '.flow-app', 'tts-presets.json');
  const presetsBefore = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  let chMade = false;
  try {
    const win = await app.firstWindow(); await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async ({ name, dir }) => { await window.api.addPreset({ name }); await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }); }, { name: CH, dir: TMP });
    chMade = true;
    const logOf = () => win.evaluate(() => (document.querySelector('#log') || {}).textContent || '');
    async function openScript(tag) {
      const sp = path.join(TMP, `${TAG}_${tag}.md`); fs.writeFileSync(sp, lines.join('\n'), 'utf8');
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, sp);
      return win.evaluate(async (c) => { const r = await window.api.openScript({ presetName: c }); return { outRoot: r.outRoot }; }, CH);
    }
    // main 의 fetch 를 가짜로 — generateContent 호출만 가로챈다. mode: 'daily' | 'minute-once' | 'free'
    const stub = (mode) => app.evaluate((_, md) => {
      global.__calls = 0; global.__mode = md; if (!global.__realFetch) global.__realFetch = global.fetch;
      const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const E = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      global.fetch = async (url, o) => {
        if (!String(url).includes(':generateContent')) return global.__realFetch(url, o);
        const n = ++global.__calls;
        if (global.__mode === 'daily') return E(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_content_requests_per_model_per_day, limit: 1000', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel', quotaMetric: 'generate_content_requests_per_model_per_day' }] }] } });
        if (global.__mode === 'free') return E(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-nano-banana-2.1 Please retry in 10h16m45.29s.' } });
        if (global.__mode === 'minute-once' && n === 1) return E(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '5s' }] } });
        return E(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] } }] });
      };
    }, mode);
    const calls = () => app.evaluate(() => global.__calls);
    const media = (o) => { const d = path.join(o.outRoot, 'media-1'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.(png|jpg)$/.test(f)).length : 0; };

    // ② A. 하루 한도 — 첫 호출에서 멈춘다
    console.log('② 하루 한도');
    let o = await openScript('A'); await stub('daily');
    await win.evaluate(() => window.api.imageBuild({ engine: 'gemini', styleId: null }));
    let lg = await logOf();
    ok(await calls() === 1, '하루 한도 → 구글 호출 1번만(남은 그룹마다 또 부르지 않는다): ' + await calls());
    ok(/하루 요청 한도/.test(lg) && /한국 시간/.test(lg), '로그에 하루 한도 안내 + 풀리는 한국 시간');
    ok(/남은 \d+장은 만들지 않고 멈춥니다/.test(lg), '남은 장수와 이어 만드는 법 안내');
    ok(media(o) === 0, '그림은 만들어지지 않았다');

    // B. 무료 등급
    console.log('② 무료 등급');
    o = await openScript('B'); await stub('free');
    await win.evaluate(() => window.api.imageBuild({ engine: 'gemini', styleId: null }));
    lg = await logOf();
    ok(await calls() === 1 && /무료 등급이라 이미지 생성이 막혀/.test(lg), '무료 등급 → 1번만 부르고 결제 안내: 호출 ' + await calls());

    // C. 분당 한도 — 기다렸다가 같은 그룹 다시
    console.log('② 분당 한도(5초 기다림)');
    o = await openScript('C'); await stub('minute-once');
    const before = (await logOf()).length;
    await win.evaluate(() => window.api.imageBuild({ engine: 'gemini', styleId: null }));
    lg = (await logOf()).slice(before);
    ok(/요청 한도\(분당\) — 5초 기다렸다가 다시 시도/.test(lg), '분당 한도 → 5초 기다렸다 다시 시도한다고 알림');
    ok(media(o) === 4, '다시 시도해서 4그룹 모두 만들어졌다(' + media(o) + ')');
    ok(await calls() === 5, '호출 = 실패 1 + 성공 4 = 5번: ' + await calls());
  } catch (e) { fail++; console.log('  ✗ 예외: ' + (e.stack || e.message)); }
  finally {
    try { await app.evaluate(() => { if (global.__realFetch) global.fetch = global.__realFetch; }); } catch (_) {}
    if (chMade) { try { const w = await app.firstWindow(); await w.evaluate(async (n) => { try { await window.api.removePreset({ name: n }); } catch (_) {} }, CH); } catch (_) {} }
    try { await app.close(); } catch (_) {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    const after = fs.existsSync(PRESETS) ? fs.readFileSync(PRESETS, 'utf8') : null;
    if (presetsBefore !== after) console.log('  ⚠ 채널 목록 파일이 전후로 달라졌다 — 임시 채널 정리 확인');
  }
  console.log(`\n${fail ? '❌' : '✅'} 429 한도 안내 — ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
