'use strict';
/**
 * node test/kie.test.js — 🧩 kie.ai 연결(v0.9.66) — 가짜 fetch 로만(네트워크·요금 없음)
 *   · 모델 표: 이름·모델 문자열·가격·입력 칸(16:9 / 9:16) · 길이 고르기(8초 상한) · 요금 계산
 *   · core/kie-api: 키 없음 · createTask → recordInfo(대기 → 성공) → 받기 · 영상은 그림 올리기 먼저 · 402/401 = 멈춤(fatal) · 실패 사유
 *   · 키 검증(api-key-check 'kie') · 예상 비용(media-cost) · 화면·main 연결(소스 점검)
 */
const fs = require('fs'), path = require('path'), os = require('os');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const KM = require('../core/kie-models');
const KEY = 'KIE-SECRET-9999';

process.env.PM_UI_SMOKE = '1';
const calls = [];
let script = [];   // 순서대로 돌려줄 응답 (url 정규식 → 응답)
const mkRes = (body, status = 200) => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), arrayBuffer: async () => Buffer.alloc(4096, 7) });
global.__kieTest = {
  key: KEY,
  fetch: async (url, opt = {}) => {
    calls.push({ url, opt });
    const i = script.findIndex((s) => s.re.test(url));
    if (i < 0) return mkRes({ code: 404, msg: 'no route ' + url });
    const s = script[i]; if (!s.keep) script.splice(i, 1);
    return typeof s.res === 'function' ? s.res(url, opt) : s.res;
  },
};
const KA = require('../core/kie-api');

(async () => {
  console.log('[1] 모델 표');
  ok(KM.IMAGE.length >= 10 && KM.VIDEO.length >= 10, `이미지 ${KM.IMAGE.length}개 · 비디오 ${KM.VIDEO.length}개`);
  const ids = KM.IMAGE.concat(KM.VIDEO).map((m) => m.id);
  ok(new Set(ids).size === ids.length, 'id 겹침 없음(엔진 값이 하나로 정해진다)');
  for (const m of KM.IMAGE) {
    const a = KM.buildImageInput(m, { prompt: 'a cat.', aspect: '16:9' });
    const b = KM.buildImageInput(m, { prompt: 'a cat.', aspect: '9:16' });
    ok(m.model && m.usd > 0 && a.prompt === 'a cat.' && /16:9|landscape_16_9/.test(JSON.stringify(a)) && /9:16/.test(JSON.stringify(b)), `이미지 ${m.label}: ${m.model} · 16:9/9:16 · ${KM.priceTag(m)}`);
  }
  for (const m of KM.VIDEO) {
    const d = KM.pickDuration(m, 5.2);
    const a = KM.buildVideoInput(m, { prompt: 'slow pan', aspect: '16:9', durationSec: d, imageUrl: 'https://x/img.png' });
    const s = JSON.stringify(a);
    ok(m.model && /https:\/\/x\/img\.png/.test(s) && new RegExp(`"duration":"?${d}"?`).test(s) && KM.videoUsd(m, d) > 0 && m.durs.includes(d),
      `비디오 ${m.label}: ${m.model} · 그림 주소 · ${d}초 · $${KM.videoUsd(m, d).toFixed(3)}`);
    ok(!/"(generate_audio|audio|sound)":true/.test(s), `  └ 소리 켜는 칸 없음(그룹 영상은 음소거)`);
  }
  const k3 = KM.byVal('kie:kling-3', 'video');
  ok(typeof KM.buildVideoInput(k3, { prompt: 'p', aspect: '16:9', durationSec: 5, imageUrl: 'u' }).duration === 'string', 'Kling 3.0 의 duration 은 글자(문서 그대로)');
  ok(KM.pickDuration(k3, 4.1) === 5 && KM.pickDuration(k3, 2) === 3 && KM.pickDuration(k3, 30) === KM.MAX_SEC, '길이: 음성 이상 가장 짧은 것 · 상한 8초');
  const veo = KM.byVal('kie:veo-3-1-lite', 'video');
  ok(KM.pickDuration(veo, 5) === 6 && KM.pickDuration(veo, 20) === 8, 'Veo(4·6·8초)도 같은 규칙');
  ok(KM.isKieVal('kie:z-image') && !KM.isKieVal('comfy::x') && KM.byVal('kie:z-image', 'video') === null && KM.byVal('kie:nope', 'image') === null, '엔진 값 판정 · 종류가 다르면 못 찾음');

  console.log('[2] 이미지 만들기(가짜 kie)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kie-test-'));
  const zi = KM.byVal('kie:z-image', 'image');
  script = [
    { re: /jobs\/createTask/, res: mkRes({ code: 200, msg: 'success', data: { taskId: 'task_1' } }) },
    { re: /recordInfo/, res: mkRes({ code: 200, data: { taskId: 'task_1', state: 'generating' } }) },
    { re: /recordInfo/, res: mkRes({ code: 200, data: { taskId: 'task_1', state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://tempfile.aiquickdraw.com/a/b.png'] }) } }) },
    { re: /tempfile\.aiquickdraw/, res: mkRes('') },
  ];
  calls.length = 0;
  const _sleep = global.setTimeout;
  let r = await KA.generateImageToFile({ model: zi, prompt: 'a quiet room.', aspect: '16:9', outPathNoExt: path.join(tmp, '01') });
  ok(r.ok && fs.existsSync(r.path) && /01\.png$/.test(r.path), '성공 → media 폴더에 01.png');
  const body = JSON.parse(calls[0].opt.body);
  ok(body.model === 'z-image' && body.input.aspect_ratio === '16:9' && body.input.prompt === 'a quiet room.', 'createTask 몸 = {model, input}');
  ok(calls[0].opt.headers.Authorization === 'Bearer ' + KEY, 'Bearer 키');
  ok(calls.filter((c) => /recordInfo\?taskId=task_1/.test(c.url)).length === 2, '대기 → 성공까지 상태를 묻는다');

  script = [{ re: /jobs\/createTask/, res: mkRes({ code: 402, msg: 'Credits insufficient' }) }];
  r = await KA.generateImageToFile({ model: zi, prompt: 'x', aspect: '16:9', outPathNoExt: path.join(tmp, '02') });
  ok(!r.ok && r.fatal && /크레딧/.test(r.error), '402 → 크레딧 부족 · 멈춤(fatal)');
  script = [{ re: /jobs\/createTask/, res: mkRes({ code: 401, msg: 'You do not have access permissions ' + KEY }) }];
  r = await KA.generateImageToFile({ model: zi, prompt: 'x', aspect: '16:9', outPathNoExt: path.join(tmp, '03') });
  ok(!r.ok && r.fatal && !r.error.includes(KEY), '401 → 키 오류 · 멈춤 · 키 원문이 메시지에 없음');
  script = [
    { re: /jobs\/createTask/, res: mkRes({ code: 200, data: { taskId: 'task_2' } }) },
    { re: /recordInfo/, res: mkRes({ code: 200, data: { state: 'fail', failCode: '500', failMsg: 'content policy' } }) },
  ];
  r = await KA.generateImageToFile({ model: zi, prompt: 'x', aspect: '16:9', outPathNoExt: path.join(tmp, '04') });
  ok(!r.ok && !r.fatal && /content policy/.test(r.error), '생성 실패 → 사유를 그대로(다음 그룹은 계속)');

  console.log('[3] 영상 만들기(그림 올리기 → 작업)');
  const img = path.join(tmp, 'g.png'); fs.writeFileSync(img, Buffer.alloc(2048, 1));
  const mm = KM.byVal('kie:minimax-h3', 'video');
  script = [
    { re: /file-stream-upload/, res: mkRes({ success: true, code: 200, data: { downloadUrl: 'https://tempfile.redpandaai.co/x/g.png' } }) },
    { re: /jobs\/createTask/, res: mkRes({ code: 200, data: { taskId: 'task_v' } }) },
    { re: /recordInfo/, res: mkRes({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://tempfile.aiquickdraw.com/v.mp4'] }) } }) },
    { re: /v\.mp4/, res: mkRes('') },
  ];
  calls.length = 0;
  r = await KA.generateVideoToFile({ model: mm, imagePath: img, prompt: 'slow push in', aspect: '16:9', durationSec: 6, outputPath: path.join(tmp, '01.mp4') });
  ok(r.ok && fs.existsSync(path.join(tmp, '01.mp4')), '성공 → 01.mp4');
  ok(/kieai\.redpandaai\.co\/api\/file-stream-upload/.test(calls[0].url) && calls[0].opt.body instanceof FormData, '그림은 multipart 로 먼저 올린다');
  const vb = JSON.parse(calls[1].opt.body);
  ok(vb.model === 'minimax-h3/image-to-video' && vb.input.first_frame_url === 'https://tempfile.redpandaai.co/x/g.png' && vb.input.duration === 6 && vb.input.resolution === '768P', '올린 주소를 첫 프레임으로 · 길이·해상도');
  ok(!/[^\x20-\x7e]/.test(String(calls[0].opt.body.get('fileName'))) && /^priming_/.test(calls[0].opt.body.get('fileName')), '올리는 파일 이름은 ASCII(한글 경로를 밖으로 안 보냄)');
  ok(KA._resultUrls({ resultJson: JSON.stringify({ data: { result_urls: ['u1'] } }) })[0] === 'u1' && KA._resultUrls({ response: { resultUrls: ['u2'] } })[0] === 'u2', 'Veo 1080p 꼴·response 꼴 결과 주소도 읽는다');

  console.log('[4] 키 검증 · 비용 · 연결');
  const V = require('../core/api-key-check');
  const vf = (body) => async () => ({ status: 200, text: async () => JSON.stringify(body) });
  let v = await V.verify('kie', KEY, {}, vf({ code: 200, msg: 'success', data: 1234.5 }));
  ok(v.level === 'ok' && /1,234\.5/.test(v.message), '키 통과 · 남은 크레딧');
  v = await V.verify('kie', KEY, {}, vf({ code: 401, msg: 'You do not have access permissions' }));
  ok(v.level === 'bad' && !v.message.includes(KEY), 'HTTP 200 + code 401 → 거부(몸의 code 를 본다)');
  ok(V.ids.includes('kie'), '검증 목록에 kie');
  const MC = require('../core/media-cost');
  const iu = MC.imageUnit('kie:nano-banana-2-1'); const vu = MC.videoUnit('kie:grok-video-1-5');
  ok(iu.kind === 'paid' && Math.abs(iu.usd - 0.02) < 1e-9, '이미지 비용 = 표의 장당 값');
  ok(vu.kind === 'paid' && Math.abs(vu.usd - 0.0225) < 1e-9, '비디오 비용 = 초당 × 가장 짧은 길이');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'src', 'App.jsx'), 'utf8');
  ok(/isKieVal\(startEngine\)\) return runKieImages/.test(main) && /isKieVal\(videoEngine\)\) \{ await runKieVideos/.test(main), 'main: 이미지·비디오 단계가 kie 로 간다');
  ok(/'kie-key-get'/.test(main) && /'kie-key-save'/.test(main) && /kieKeyGet/.test(fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8')), '키 저장 IPC');
  ok((app.match(/<EngineOptions kind="image"/g) || []).length === 2 && (app.match(/<EngineOptions kind="video"/g) || []).length === 2, '헤더·채널 편집 두 곳이 같은 목록(EngineOptions)');
  ok(!/<option value="flow">/.test(app) && !/<option value="genspark">/.test(app) && !/<option value="gemini-batch">/.test(app), '옛 항목(Flow·Genspark·나노바나나)은 목록에서 빠짐');
  ok(/data-testid="kie-key"/.test(app), '⚙ 설정 → 🔑 API 키에 kie 칸');
  ok(!/require\.main/.test(fs.readFileSync(path.join(__dirname, '..', 'core', 'kie-models.js'), 'utf8')), 'kie-models 는 렌더러 번들 안전(CJS 자기검사 없음)');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\n${fail ? '❌' : '✅'} kie ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
