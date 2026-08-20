'use strict';
// node test/makeall-dry.smoke.js — 「⚡ 만들기」를 **실제로 끝까지 돌려보는** E2E (무음/dry 모드).
//
// 🔴 왜 필요한가(2026-08-20 실사고): `runMakeAllCore` 안에서 이미지 엔진 변수명을 `imgEngine` 으로 잘못 써
//   큐 7개가 전부 `imgEngine is not defined` 로 죽었다. **빌드도, 단위테스트도, 화면 E2E 도 못 잡았다** —
//   JSX·핸들러 안의 미정의 식별자는 **그 코드가 실제로 실행될 때만** 드러난다.
//   → 파이프라인 전 구간(1~4단계 + .vrew)을 한 번 실행해 ReferenceError 를 잡는다.
//
// 안전장치:
//   · **무음(dry) 모드** — TTS 서버·ComfyUI·브라우저를 전혀 부르지 않는다(무음 wav + .vrew 만).
//   · **임시 채널**을 만들어 출력 폴더를 임시 디렉터리로 돌린다 → 사용자의 G: 작업물을 건드리지 않는다.
//   · 끝나면 임시 채널·임시 폴더를 삭제한다(실패해도 finally 에서 정리).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'makeall-dry-'));
// 채널 이름에 pid 를 붙인다 — 앞선 실행이 비정상 종료로 채널을 남겼을 때 이름 충돌로 테스트가
//   흔들리지 않게(실측: 남은 채널 때문에 addPreset 이 "같은 이름" 오류로 실패한 적 있음).
const CH = '__테스트채널_삭제해도됨_' + process.pid;
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m); } else console.log('  · ' + m); };

// 롱폼 대본(H2 = 챕터, H3 = 섹션) — 짧게 3섹션.
const SCRIPT = [
  '# 테스트 대본 (자동 생성 — 지워도 됩니다)',
  '',
  '## 첫째 마당',
  '',
  '### 도입부',
  '',
  '어떤 사람은 말을 아낀다. 그 침묵이 오히려 힘이 된다.',
  '',
  '',
  '### 본론 하나',
  '',
  '급하게 말하면 속이 다 보인다. 한 박자만 늦추면 상대가 먼저 움직인다.',
  '',
  '',
  '## 둘째 마당',
  '',
  '### 마무리',
  '',
  '오늘 배운 것을 한 문장으로 남긴다. 그 한 줄이 다음을 바꾼다.',
  '',
  '',
].join('\n');
const SCRIPT_PATH = path.join(TMP, '[테스트_0000] 만들기 무음 점검.md');
fs.writeFileSync(SCRIPT_PATH, SCRIPT, 'utf8');

(async () => {
  const app = await electron.launch({ args: [ROOT], env: { ...process.env, PM_UI_SMOKE: '1' } });
  const errs = [];
  let chMade = false;
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    win.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await win.waitForSelector('h1', { timeout: 20000 });

    // ① 임시 채널 — 출력 폴더를 임시 디렉터리로 (사용자 작업물 보호)
    //   앞선 실행이 남긴 테스트 채널이 있으면 먼저 지운다(이름 충돌로 흔들리지 않게).
    const leftovers = await win.evaluate(async () => {
      const ps = (await window.api.listPresets()) || [];
      const olds = ps.map((p) => p.name).filter((nm) => nm.indexOf('__테스트채널_삭제해도됨') === 0);
      for (const nm of olds) { try { await window.api.removePreset({ name: nm }); } catch (_) {} }
      return olds;
    });
    if (leftovers.length) console.log('  (앞선 실행이 남긴 테스트 채널 ' + leftovers.length + '개 정리)');
    const add = await win.evaluate(async (name) => {
      try { await window.api.addPreset({ name }); } catch (e) { return 'add:' + e.message; }
      return 'ok';
    }, CH);
    ok(add === 'ok', '임시 채널 생성: ' + add);
    chMade = add === 'ok';
    const sv = await win.evaluate(async ({ name, dir }) => {
      try { await window.api.savePreset({ name, patch: { outputFolder: dir, outLong: dir, outShort: dir, scriptFolder: dir } }); return 'ok'; }
      catch (e) { return 'save:' + e.message; }
    }, { name: CH, dir: TMP });
    ok(sv === 'ok', '출력 폴더를 임시 폴더로 지정: ' + sv);

    // ② 대본 열기 (파일 대화상자 스텁 + 그 채널로)
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, SCRIPT_PATH);
    const opened = await win.evaluate(async (name) => {
      const r = await window.api.openScript({ presetName: name });
      return r && r.dto ? { groups: (r.dto.projects[0].cuts || []).length, outRoot: r.outRoot } : null;
    }, CH);
    ok(!!opened && opened.groups >= 3, '대본 열기 — 그룹 ' + (opened && opened.groups));
    ok(!!opened && String(opened.outRoot).startsWith(TMP), '출력 경로가 임시 폴더: ' + (opened && opened.outRoot));

    // ③ 🔴 「⚡ 만들기」 실행 — 무음(dry). **이미지 엔진을 로컬 ComfyUI 로 지정**해
    //    이번에 깨졌던 `_imgLocalGpu` 판정 줄을 반드시 지나가게 한다.
    const t0 = Date.now();
    const res = await win.evaluate(async (name) => {
      try {
        await window.api.makeAll({
          presetName: name, dry: true, engine: 'comfy::dummy.json', videoEngine: 'none',
          styleId: null, captionMaxChars: 7, aiNotice: true, openVrew: false,
        });
        return 'ok';
      } catch (e) { return 'ERR: ' + e.message; }
    }, CH);
    console.log('  (만들기 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
    ok(res === 'ok', '⚡ 만들기(무음) 예외 없이 완주: ' + res);
    ok(!/is not defined/.test(res), '🔴 ReferenceError 없음(imgEngine 계열 사고 재발 방지)');

    // ④ 로그창에 실패 흔적이 없어야 한다 (핸들러가 삼킨 예외도 잡는다)
    const logText = await win.evaluate(() => (document.querySelector('#log') || {}).textContent || '');
    ok(!/is not defined/.test(logText), '로그에 "is not defined" 없음');
    ok(!/✗ 실패/.test(logText), '로그에 "✗ 실패" 없음');
    ok(!/오류|Error/.test(logText.split('절전 차단 —')[1] || ''), '만들기 구간에 오류 줄 없음');
    ok(errs.length === 0, '화면 오류 0건' + (errs.length ? ': ' + errs[0] : ''));

    // ⑤ 단계가 끝까지 흘렀는지 — 여기까지 로그가 찍히면 runMakeAllCore 를 완주한 것이다.
    ok(/1단계 — 음성/.test(logText), '1단계 실행됨');
    ok(/4단계 — .vrew/.test(logText), '4단계 도달(함수 끝까지 실행)');
    ok(/전체 제작 완료/.test(logText), '정상 종료');
    ok(/절전 차단 해제/.test(logText), '절전 차단이 해제됨(finally 통과)');
    // ⑥ 무음 모드는 **이미지가 없으므로 이미지 게이트가 .vrew 를 막는 것이 정상**이다.
    //    → 이 줄이 뜨는 것 자체가 v0.3.10 이미지 게이트가 살아 있다는 증거(반쪽 .vrew 방지).
    ok(/이미지 미생성 그룹 3개/.test(logText), '이미지 게이트가 .vrew 를 막았다(무음 모드에선 정상)');
    ok(!/음성 없는 문장/.test(logText), '무음 모드에선 TTS 누락 게이트가 걸리지 않는다(음성은 채워졌다)');
    // ⑦ 결과물 — 무음 음성 파일이 실제로 만들어졌는지
    const outs = fs.readdirSync(path.join(TMP, path.basename(SCRIPT_PATH).replace(/\.md$/, '')));
    ok(outs.some((f) => /^tts-/.test(f)) && outs.some((f) => /^media-/.test(f)), '출력 하위폴더(tts-N·media-N) 생성');
    const ttsDir = path.join(TMP, path.basename(SCRIPT_PATH).replace(/\.md$/, ''), 'tts-1');
    const wavs = fs.existsSync(ttsDir) ? fs.readdirSync(ttsDir).filter((f) => /\.(wav|mp3)$/i.test(f)) : [];
    ok(wavs.length >= 3, '무음 음성 파일 ' + wavs.length + '개 생성(문장 수만큼)');
  } finally {
    // 정리 — 임시 채널 삭제 후 앱 종료, 임시 폴더 삭제
    try {
      if (chMade) {
        const win2 = await app.firstWindow();
        const del = await win2.evaluate(async (name) => {
          try { await window.api.removePreset({ name }); return 'ok'; } catch (e) { return 'del:' + e.message; }
        }, CH);
        console.log('  (임시 채널 삭제: ' + del + ')');
      }
    } catch (_) {}
    await app.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(bad ? '\n❌ ' + bad + '/' + n + ' 실패' : '\n✅ 만들기(무음) E2E ' + n + '/' + n + ' 통과');
  process.exit(bad ? 1 : 0);
})().catch(async (e) => { console.error('❌ 실패:', e.message); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
