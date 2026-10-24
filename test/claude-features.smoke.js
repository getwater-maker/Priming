'use strict';
// node test/claude-features.smoke.js — 🤖 Claude API 기능을 앱에서 실제로 눌러 본다(v0.7.94) · **가짜 Claude**(main 의 global.__claudeApiTest)로만.
//   ① ✍ 빈 프롬프트 채우기 ② 🔁 이미지 프롬프트 다시 쓰기(고른 그룹 없음 = 전체) ③ 🔁 영상 프롬프트 다시 쓰기 → Ctrl+Z 되돌리기
//   ④ 🔍 그림 검수(가짜 그림 · 문제 1장 → 「다시 그리기」 표시) ⑤ 🎨 보이스디자인 설명 만들기
//   ⛔ 진짜 키·진짜 API 를 쓰지 않는다 · 임시 채널·임시 폴더(끝나면 지움)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-feat-'));
const CH = '__테스트채널_삭제해도됨_' + process.pid;
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };
const SCRIPT = ['# 클로드 기능 시험 (자동 생성 — 지워도 됩니다)', '', '## 첫째 마당', '',
  '### 도입부', '> 🖼️ 이미지: old prompt one', '', '어떤 사람은 말을 아낀다. 그 침묵이 오히려 힘이 된다.', '', '',
  '### 본론 하나', '', '두 사람이 낮은 탁자를 사이에 두고 오래 이야기했다.', '', '',
  '### 본론 둘', '> 🖼️ 이미지: old prompt three', '', '바람이 불자 마당의 감나무가 흔들렸다.', ''].join('\n');
const SCRIPT_PATH = path.join(TMP, `클로드기능시험_${process.pid}.md`);
fs.writeFileSync(SCRIPT_PATH, SCRIPT, 'utf8');

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = []; let chMade = false;
  try {
    // 🤖 가짜 Claude — 요청서의 `## [1-N]` 머리를 읽어 그대로 답한다 · 그림이 오면 검수 답 · 그 밖은 목소리 설명
    await app.evaluate(() => {
      global.__claudeApiCalls = [];
      global.__claudeApiTest = { cfg: { key: 'sk-ant-fake' }, fetch: async (url, opt) => {
        const b = JSON.parse(opt.body); global.__claudeApiCalls.push(b);
        const c = b.messages[0].content; const txt = typeof c === 'string' ? c : c.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
        let out;
        if (/출판사의 편집자/.test(b.system || '')) out = '{"keywords":["산책","성찰"],"tagline":"짧은 산책의 기록","intro":"걷는 동안 생각한 것들을 적은 책입니다."}';
        else if (/한국어 교정자/.test(b.system || '')) out = /느겼습니다/.test(txt) ? '[{"틀림":"느겼습니다","바름":"느꼈습니다"}]' : '[]';
        else if (Array.isArray(c) && c.some((x) => x.type === 'image')) out = /감나무/.test(txt) ? '{"ok":false,"issues":["그림 안에 글자가 있음"]}' : '{"ok":true}';
        else if (/## \[1-\d+\]/.test(txt)) {
          const only = /영상 모션 프롬프트를 새로/.test(txt) ? 'video' : /이미지 생성 프롬프트를 새로/.test(txt) ? 'image' : '';
          const word = /이번 요청 안내/.test(txt) ? 'regen' : only ? 'rewritten' : 'filled';
          out = [...txt.matchAll(/## \[1-(\d+)\]/g)].map((m) => `## [1-${m[1]}]\n` + (only !== 'video' ? `이미지: ${word} image ${m[1]}\n` : '') + (only !== 'image' ? `영상: ${word} motion ${m[1]}\n` : '')).join('');
        } else out = 'male, sixties, low warm pitch, slow storytelling pace';
        return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: out }], usage: { input_tokens: 10, output_tokens: 10 } }) };
      } };
    });
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    win.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });
    await win.evaluate(async () => { for (const p of (await window.api.listPresets()) || []) if (p.name.indexOf('__테스트채널_삭제해도됨') === 0) { try { await window.api.removePreset({ name: p.name }); } catch (_) {} } });
    chMade = (await win.evaluate(async (name) => { try { await window.api.addPreset({ name }); return 'ok'; } catch (e) { return e.message; } }, CH)) === 'ok';
    ok(chMade, '임시 채널');
    await win.evaluate(async ({ name, dir }) => window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, scriptFolder: dir } }), { name: CH, dir: TMP });
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, SCRIPT_PATH);
    const groupsOf = async () => win.evaluate(async () => { const g = (d) => { const pr = d.projects[0]; return (pr.cuts || pr.groups).map((x) => ({ num: x.num, img: x.imagePrompt || '', vid: x.videoPrompt || '', stale: !!x.imageStale })); }; return g((await window.api.listQueue()).dto); });
    const opened = await win.evaluate(async (name) => { const r = await window.api.openScript({ presetName: name }); return !!(r && r.dto); }, CH);
    ok(opened, '대본 열기');
    await win.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });

    // ① ✍ 빈 칸 채우기 — G2(프롬프트 없음)만 채우고 G1·G3 은 그대로
    await win.evaluate(async () => window.api.generatePromptsApi({ mode: 'fill', vidSel: 'list:2' }));
    let gs = await groupsOf();
    ok(gs[1].img === 'filled image 2' && gs[0].img === 'old prompt one' && gs[2].img === 'old prompt three', '✍ 빈 칸만 채움: ' + gs.map((g) => g.img).join(' | '));

    // ② 🔁 이미지 프롬프트 — 리본 단추(② 이미지 탭) · 고른 그룹 없음 = 전체 덮어쓰기
    await require('./_menu').byText(win, '이미지').catch(() => {});
    const btnI = win.locator('[data-testid=rewrite-img-prompts]');
    ok(await btnI.count() === 1, '② 이미지 리본에 🔁 이미지 프롬프트 단추');
    await btnI.click();
    for (let i = 0; i < 30 && !(await groupsOf()).every((x) => /^rewritten image/.test(x.img)); i++) await win.waitForTimeout(500);
    gs = await groupsOf();
    ok(gs.every((g) => /^rewritten image/.test(g.img)), '🔁 이미지 프롬프트 전부 새로: ' + gs.map((g) => g.img).join(' | '));
    ok(gs[1].vid === 'filled motion 2', '이미지만 다시 쓸 땐 영상 프롬프트는 그대로');

    // ③ 🔁 영상 프롬프트(③ 비디오 탭) — 영상 범위 = 직접 입력 없음이면 도입부 → G1 · 그다음 Ctrl+Z
    await require('./_menu').byText(win, '비디오').catch(() => {});
    const btnV = win.locator('[data-testid=rewrite-vid-prompts]');
    ok(await btnV.count() === 1, '③ 비디오 리본에 🔁 영상 프롬프트 단추');
    await btnV.click();
    for (let i = 0; i < 30 && !(await groupsOf()).some((x) => /^rewritten motion/.test(x.vid)); i++) await win.waitForTimeout(500);
    gs = await groupsOf();
    ok(gs.some((g) => /^rewritten motion/.test(g.vid)) && gs.every((g) => /^rewritten image/.test(g.img)), '🔁 영상 프롬프트 새로(이미지는 그대로): ' + gs.map((g) => g.vid || '-').join(' | '));
    await win.evaluate(async () => window.api.undo && window.api.undo());
    gs = await groupsOf();
    ok(!gs.some((g) => /^rewritten motion/.test(g.vid)), 'Ctrl+Z(되돌리기) = 영상 다시 쓰기 전으로: ' + gs.map((g) => g.vid || '-').join(' | '));

    // ④ 🔍 그림 검수 — G1·G3 에 가짜 그림(ffmpeg 로 만든 PNG) · G3(감나무) = 문제
    const FF = require(path.join(ROOT, 'core', 'media-utils')).getFfmpegPath();
    const png = path.join(TMP, 'fake.png');
    require('child_process').execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180', '-frames:v', '1', png]);
    for (const num of [1, 3]) {
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, png);
      await win.evaluate(async (num) => window.api.attachAsset({ shortsNum: 1, groupNum: num }), num);
    }
    const r4 = await win.evaluate(async () => { try { return await window.api.claudeVisionCheck({}); } catch (e) { return { err: e.message }; } });
    ok(r4 && !r4.err && r4.checked === 2 && r4.flagged.length === 1 && r4.flagged[0].num === 3 && r4.flagged[0].attached === true, '🔍 검수: 문제 그림 = G3 하나' + JSON.stringify(r4 && (r4.err || r4.flagged)));
    if (r4 && r4.flagged && r4.flagged.length) {
      await win.evaluate(async () => window.api.claudeVisionMark({ groups: [3] }));
      gs = await groupsOf();
      ok(!gs[2].stale && !gs[0].stale, '사람이 첨부한 그림은 「다시 그리기」로 표시하지 않는다(기계 판정으로 지우지 않음)');
      const sentImage = await app.evaluate(() => global.__claudeApiCalls.some((b) => Array.isArray(b.messages[0].content) && b.messages[0].content.some((x) => x.type === 'image' && x.source.media_type === 'image/jpeg')));
      ok(sentImage, '검수 요청에 그림(JPEG 로 줄여)이 실렸다');
    }

    // ④-2 🤖 한 그룹 프롬프트 재생성(📝 프롬프트 수정 창) — 칸만 채우고 그룹은 안 바꾼다 · 근거 = 저장 전 글 + 요청 + 앞뒤 장면
    const before = await groupsOf();
    await win.evaluate(async () => { const el = [...document.querySelectorAll('button')].find((b) => /프롬프트 보기/.test(b.title || '')); if (el) el.click(); });
    await win.waitForSelector('[data-testid=regen-hint]', { timeout: 8000 });
    ok(await win.locator('[data-testid=regen-image-prompt]').count() === 1 && await win.locator('[data-testid=regen-video-prompt]').count() === 1, '📝 창에 🤖 프롬프트 재생성 단추 둘(이미지·영상)');
    await win.fill('[data-testid=regen-hint]', '밤 장면으로');
    await win.locator('textarea').first().fill('my unsaved edit');
    await win.click('[data-testid=regen-image-prompt]');
    await win.waitForFunction(() => /^regen image/.test((document.querySelector('.modal-card textarea') || {}).value || ''), null, { timeout: 15000 }).catch(() => {});
    const boxI = await win.locator('.modal-card textarea').first().inputValue();
    ok(/^regen image \d+$/.test(boxI), '🤖 이미지 칸이 새 글로 채워짐: ' + boxI);
    await win.click('[data-testid=regen-video-prompt]');
    await win.waitForFunction(() => [...document.querySelectorAll('.modal-card textarea:not([readonly])')].some((t) => /^regen motion/.test(t.value)), null, { timeout: 15000 }).catch(() => {});
    const boxV = await win.evaluate(() => [...document.querySelectorAll('.modal-card textarea:not([readonly])')].map((t) => t.value)[1] || '');
    ok(/^regen motion \d+$/.test(boxV), '🤖 영상 칸이 새 글로 채워짐: ' + boxV);
    const after = await groupsOf();
    ok(JSON.stringify(before) === JSON.stringify(after), '그룹의 저장된 프롬프트는 그대로(「저장·생성」을 눌러야 바뀜)');
    const reqs = await app.evaluate(() => global.__claudeApiCalls.filter((b) => /이번 요청 안내/.test(JSON.stringify(b.messages[0].content))).map((b) => b.messages[0].content));
    ok(reqs.length === 2 && /로이의 요청\*\*: 밤 장면으로/.test(reqs[0]) && /지금 프롬프트: my unsaved edit/.test(reqs[0]), '요청에 로이의 요청 + 저장 전에 고친 글이 실렸다');
    ok(/\(뒤\) 대본/.test(reqs[0]) || /\(앞\) 대본/.test(reqs[0]), '요청에 앞·뒤 장면(일관성 참고)이 실렸다');
    ok(/이미지 프롬프트: regen image \d+/.test(reqs[1]) && !/^이미지:/m.test(reqs[1]), '영상 재생성은 칸의 (방금 새로 쓴) 이미지 프롬프트를 근거로');
    if (process.env.PM_SHOT) { try { await win.locator('.modal-card').first().screenshot({ path: process.env.PM_SHOT }); } catch (_) {} }
    await win.click('.modal-card button:has-text("닫기")').catch(() => {});

    // ⑤ 🎨 보이스디자인 설명 만들기
    const vi = await win.evaluate(async () => window.api.claudeVoiceInstruct({ wish: '60대 남자, 낮고 따뜻하게', lang: 'Korean' }));
    ok(vi && vi.ok && /sixties/.test(vi.instruct), '🎨 보이스디자인 설명: ' + (vi && (vi.instruct || vi.error)));
    // ⑥ 📖 출판 — 소개글 초안 · 교정 제안(보고서는 <작품>/완성 = 임시 폴더 안)
    const bookDir = path.join(TMP, '시험작품', '원고'); fs.mkdirSync(bookDir, { recursive: true });
    const bookPath = path.join(bookDir, '시험책.md');
    fs.writeFileSync(bookPath, '# 시험책\n> 저자: 로이\n\n## 1장. 하나\n\n나는 그렇게 느겼습니다. 그리고 오래 걸었다.\n\n## 2장. 둘\n\n바람이 불었다.\n', 'utf8');
    const ob = await win.evaluate((p) => window.api.openBookPath({ scriptPath: p }), bookPath);
    ok(ob && ob.dto && ob.dto.kind === 'book', '출판 원고 열기');
    const bl = await win.evaluate(async () => window.api.bookClaudeBlurb());
    ok(bl && bl.ok && bl.keywords === '산책, 성찰' && /짧은/.test(bl.tagline) && bl.intro.length > 5, '✍ 소개글·키워드 초안: ' + JSON.stringify(bl).slice(0, 120));
    const dry = await win.evaluate(async () => window.api.bookClaudeProofread({ dry: true }));
    ok(dry && dry.ok && dry.chars > 10 && dry.chunks >= 1 && dry.estUsd > 0, `🔎 교정 미리 셈: ${dry && dry.chars}자 · ${dry && dry.chunks}묶음 · ≈$${dry && dry.estUsd.toFixed(4)}`);
    const pf = await win.evaluate(async () => window.api.bookClaudeProofread({}));
    const inTmp = pf && pf.path && path.resolve(pf.path).startsWith(path.resolve(TMP));
    if (pf && pf.path && !inTmp) { try { fs.unlinkSync(pf.path); } catch (_) {} }
    ok(pf && pf.ok && pf.count === 1 && inTmp, '🔎 교정 제안 1건 · 보고서는 작품/완성(임시 폴더): ' + (pf && (pf.path || pf.error)));
    const rep = inTmp ? fs.readFileSync(pf.path, 'utf8') : '';
    ok(/느겼습니다\*\* → \*\*느꼈습니다/.test(rep) && /- 6줄:/.test(rep) && /원고는 고치지 않았습니다/.test(rep), '보고서: 줄 번호 · 틀림→바름 · 원고 불변 안내');
    ok(/느겼습니다/.test(fs.readFileSync(bookPath, 'utf8')), '원고는 그대로(제안만)');

    const calls = await app.evaluate(() => global.__claudeApiCalls.length);
    ok(calls >= 4, `가짜 Claude 호출 ${calls}번(진짜 API 아님)`);
    ok(errs.length === 0, '화면 오류 0건' + (errs.length ? ': ' + errs[0] : ''));
  } catch (e) { bad++; console.log('  ✗ 예외: ' + e.message); }
  finally {
    try { const win = await app.firstWindow(); if (chMade) await win.evaluate(async (name) => window.api.removePreset({ name }), CH); } catch (_) {}
    await app.close().catch(() => {});
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(`\n${bad ? '❌' : '✅'} claude-features E2E ${n - bad}/${n}`);
  process.exit(bad ? 1 : 0);
})();
