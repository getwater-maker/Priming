'use strict';
/**
 * node test/script-style.test.js — 🎨 대본 화풍 줄이 채널 화풍보다 우선(채널사업부 요청 2026-09-29 · v0.5.89)
 *   `# 제목` 아래 `> 🎨 화풍: watercolor (수채화)` → 이 편 본문 이미지 = 그 스타일. 없으면 채널. 모르는 id = 경고 + 채널.
 *   🔑 원문 함수를 뽑아 실행한다(파서 · resolveScriptStyle · effStyleId).
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const LP = require('../core/parsers/longform-parser');
const P = require('../core/pipeline');

console.log('\n[1] 파서 — 🎨 줄 읽기');
{
  const body = '\n## 도입부\n> 🖼️ 이미지: a man shouting in a small room\n작은 일에도 화를 냅니다. 그 뒤에는 이유가 있습니다.\n';
  const s = (x) => LP.scriptStyleOf(x);
  const a = s('# 제목\n> 🎨 화풍: watercolor (수채화)' + body);
  ok(a && a.id === 'watercolor' && a.name === '수채화', '기본 형식 → id watercolor · 이름 수채화');
  ok(s('# 제목\n> 🎨 화풍：user_1784618892499_qtnb（따듯한 회화풍 일러스트）' + body).id === 'user_1784618892499_qtnb', '전각 콜론·전각 괄호');
  ok(s('# 제목\n>🎨 화풍: cinematic' + body).id === 'cinematic' && s('# 제목\n>🎨 화풍: cinematic' + body).name === null, '이름 없이 id 만');
  ok(s('# 제목\n> 🎨 화풍: **ink** (수묵화)' + body).id === 'ink', '굵게(**) 벗긴다');
  ok(s('# 제목\n> 🎨 화풍: ink\n> 🎨 화풍: oil' + body).id === 'ink', '여러 줄이면 첫 줄');
  ok(s('# 제목' + body + '> 🎨 화풍: oil\n') === null, '첫 장 제목(##) 뒤의 줄은 읽지 않는다(편 전체에 한 줄 · 자리 = 제목 바로 아래)');
  ok(s('# 제목\n```\n> 🎨 화풍: oil\n```' + body) === null, '코드 블록 안은 무시');
  ok(s('# 제목' + body) === null, '줄이 없으면 null(= 채널 화풍)');
  const with_ = P.parseScriptText('# 제목\n> 🎨 화풍: watercolor (수채화)' + body, 'longform', {}).projects[0];
  const without = P.parseScriptText('# 제목' + body, 'longform', {}).projects[0];
  ok(JSON.stringify(with_.sentences.map((x) => x.text)) === JSON.stringify(without.sentences.map((x) => x.text)) && with_.groups.length === without.groups.length && with_.groups[0].imagePrompt === without.groups[0].imagePrompt, '🔑 문장·그룹·🖼️ 프롬프트는 이 줄이 있어도 똑같다(낭독·자막에 안 들어간다)');
  ok(with_.scriptStyle && with_.scriptStyle.id === 'watercolor' && !without.scriptStyle, 'parseScriptText → project.scriptStyle');
  ok(P.toDTO({ projects: [with_], kind: 'longform' }).projects[0].scriptStyle.id === 'watercolor', '화면 DTO 에 scriptStyle');
}

console.log('\n[2] 화풍 결정 — 대본 > 채널(헤더) > 기본 · 모르는 id 는 경고 + 채널');
{
  const M = read('main.js');
  const i0 = M.indexOf('const _styleWarned = new Set();'), i1 = M.indexOf('\n}\n', M.indexOf('function effStyleId(')) + 3;
  ok(i0 > 0 && i1 > i0, 'resolveScriptStyle · effStyleId 를 찾았다');
  const STYLES = [{ id: 'watercolor', name: '수채화' }, { id: 'cinematic', name: '시네마틱' }, { id: 'u1', name: '따듯한 회화풍 일러스트' }, { id: 'u2', name: '따듯한 회화풍 일러스트' }, { id: 'u3', name: '다산의뜰 수채화' }];
  const fakeSS = { getById: (id) => STYLES.find((x) => x.id === id) || null, loadAll: () => STYLES };
  const logs = [];
  const ctx = { S: { parsed: null, scriptPath: 'x.md' }, log: (m) => logs.push(m), require: (m) => (/style-store/.test(m) ? fakeSS : require(m)), console };
  vm.createContext(ctx);
  vm.runInContext(M.slice(i0, i1) + '\nthis.eff = effStyleId; this.res = resolveScriptStyle;', ctx);
  const pr = (ss) => ({ scriptStyle: ss });
  const SC = '__script__';
  ctx.S.preset = { styleLong: 'cinematic' };   // 채널 화풍(안전망 폴백)
  ok(ctx.eff('cinematic', null, pr({ id: 'watercolor', name: '수채화', raw: 'watercolor (수채화)' })) === 'cinematic', '🔑 2026-10-07 대본 우선 폐기 — 헤더에서 스타일을 직접 고르면 대본 🎨 줄이 있어도 그 스타일');
  ok(ctx.eff(SC, null, pr({ id: 'watercolor', name: '수채화', raw: 'watercolor (수채화)' })) === 'watercolor', '🔑 📜 대본스타일 + 대본 🎨 watercolor → watercolor');
  ok(logs.some((l) => /화풍 = 대본 「수채화」\(watercolor\)/.test(l)), '로그: 대본 화풍을 쓴다고 알린다');
  ok(ctx.eff('cinematic', null, pr(null)) === 'cinematic' && ctx.eff(null, null, pr(null)) === null, '일반 스타일은 그대로 · 없으면 기본(없음)');
  logs.length = 0;
  ok(ctx.eff(SC, null, pr(null)) === 'cinematic' && logs.some((l) => /「📜 대본스타일」인데 이 대본에 🎨 화풍 줄이 없습니다/.test(l)), '📜 대본스타일인데 줄이 없고 못 물어본 경우(큐의 다른 대본) → ⚠ + 채널 화풍 안전망');
  logs.length = 0;
  ok(ctx.eff(SC, null, pr({ id: 'watercolr', name: null, raw: 'watercolr' })) === 'cinematic', '모르는 id → 채널 화풍으로(멈추지 않는다)');
  ok(logs.some((l) => /⚠ 대본의 🎨 화풍 「watercolr」 — 이런 스타일 id 가 없습니다/.test(l)), '모르는 id 는 ⚠ 경고');
  const before = logs.length; ctx.eff(SC, null, pr({ id: 'watercolr', name: null, raw: 'watercolr' }));
  ok(logs.length === before, '같은 경고는 한 번만(그룹마다 도배하지 않는다)');
  ok(ctx.eff(SC, null, pr({ id: 'nope', name: '다산의뜰 수채화', raw: 'nope (다산의뜰 수채화)' })) === 'u3', 'id 가 틀려도 이름과 같은 스타일이 **하나뿐**이면 그것');
  ok(ctx.eff(SC, null, pr({ id: 'nope2', name: '따듯한 회화풍 일러스트', raw: 'nope2 (따듯한 회화풍 일러스트)' })) === 'cinematic', '🔴 같은 이름이 둘(따듯한 회화풍 일러스트 u1·u2)이면 이름으로 고르지 않는다 → 채널');
  ok(ctx.eff(SC, null, pr({ id: 'u2', name: '따듯한 회화풍 일러스트', raw: 'u2' })) === 'u2', '🔑 id 로 정확히 — u2');
  // 채널 기본 스타일이 「대본스타일」(`__script__`) 이면 폴백으로 쓰지 않는다(없는 스타일 id 로 그림을 시도하지 않게 · v0.7.41)
  ctx.S.preset = { styleLong: SC };
  ok(ctx.eff(SC, null, pr(null)) === null, '채널 기본이 대본스타일이고 대본에 🎨 줄이 없으면 폴백 = 없음(스타일 id 로 __script__ 를 넘기지 않는다)');
  ok(ctx.eff(SC, null, pr({ id: 'watercolor', name: '수채화', raw: 'watercolor' })) === 'watercolor', '채널 기본이 대본스타일이어도 대본 🎨 줄이 있으면 그 화풍');
  {
    const CS = require('../core/channel-styles');
    const doc = CS.build({ styleStore: { getById: () => null, loadAll: () => [], getPrompt: () => '' }, presetStore: { loadAll: () => [{ name: 'X', styleLong: SC }] } });
    const L = doc.channels[0].long;
    ok(L && L.script === true && !L.missing && L.styleName === '대본스타일' && L.prompt === '', '채널 화풍 내보내기: 대본스타일은 missing 이 아니라 script:true(고정 프롬프트 없음)');
  }
}

{
  // 채널 편집 「제작 도구」의 이미지 스타일 목록에도 「📜 대본스타일」이 있다(v0.7.41 · 로이 — 헤더에만 있고 채널 편집엔 없었다)
  const APP = read('renderer/src/App.jsx');
  ok(/styleLong: e\.target\.value \}\)\}>\s*<option value=\{SCRIPT_STYLE_ID\}[\s\S]{0,220}?>📜 대본스타일<\/option>/.test(APP), '채널 편집 스타일 목록에 「📜 대본스타일」');
}

console.log('\n[3] 모든 이미지 입구가 대본 화풍을 거친다(소스 전수)');
{
  const M = read('main.js');
  const n = (M.match(/effStyleId\(/g) || []).length - 1;   // 정의 제외
  ok(n >= 9, `effStyleId 호출 ${n}곳 — 배치 제출 · 캐시 지우기 · .vrew 내보내기 재생성 · 이미지 · 영상(선행 이미지) · ⚡ 만들기 · 프롬프트 보기 · 그룹 영상 · 🔄 한 장`);
  const bare = M.split('\n').filter((l) => /[{,]\s*styleId = null\b/.test(l) && /= (args|opts);/.test(l));
  ok(bare.length === 0, `입구에서 styleId 를 그대로 받는 곳 0 (${bare.map((l) => l.trim().slice(0, 50)).join(' | ') || '없음'})`);
  ok(/const styleId = effStyleId\(_styleArg\);   \/\/ 🎨 대본 화풍 우선\(큐에서/.test(M), '큐(여러 대본)에서 📜 대본스타일이면 대본마다 자기 🎨 줄(runMakeAllCore)');
  ok(/const styleId = effStyleId\(_styleArg\);   \/\/ 🎨 대본 화풍 우선\(캐시 키도 같은 값\)/.test(M), '캐시 키도 같은 값 — 채널 화풍으로 만든 옛 그림이 캐시에서 되살아나지 않는다');
  ok(/scriptStyle: pr\.scriptStyle \|\| null,       \/\/ 🎨 대본 화풍\(정해진 화풍/.test(M) && /proj\.scriptStyle = scriptStyle \|\| \(ps && ps\.scriptStyle\) \|\| null;/.test(M) && /scriptStyle = _LP\.scriptStyleOf\(_raw\)/.test(M), '작업본에 저장 · 다시 열 때 .md 로 다시 채운다(작업본 복원 경로)');
  const APP = read('renderer/src/App.jsx');
  ok(/data-testid="style-src"/.test(APP) && /🎨 대본: \{hit\.name\}/.test(APP) && /value=\{SCRIPT_STYLE_ID\}[\s\S]{0,160}📜 대본스타일<\/option>/.test(APP), '화면: ② 이미지 스타일 목록에 「📜 대본스타일」 · 고른 때만 출처 표시');
  ok(/data-testid="style-pick"/.test(APP) && (APP.match(/await runStyleId\(\)/g) || []).length >= 7 && /qStyle = await runStyleId\(\)/.test(APP) && /batchStyle = await runStyleId\(\)/.test(APP), '대본스타일 + 대본에 🎨 없음 → 만들기 전에 스타일 선택 팝업(이미지·영상·🔄·큐·만들기·배치) · 취소하면 시작하지 않는다');
  ok(!/<option value="grok(-api)?">/.test(APP), '③ 비디오 목록(헤더·채널 편집)에 Grok 구독·API 항목이 없다');
  ok(/## 2\.5\. 🎨 이 편의 화풍/.test(read('docs/대본-작성-가이드.md')), '대본-작성-가이드.md 에 규격');
}

console.log(`\n${fail ? '❌' : '✅'} script-style ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
