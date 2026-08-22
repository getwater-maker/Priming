/**
 * ☁ 공유 기능 수리 회귀(2026-08-22) — 감사에서 나온 실사고 시나리오를 고정한다.
 *   ① TTS 캐시 키에 refName — srv: 목소리끼리 캐시 교차 적중(엉뚱한 목소리 재활용) 방지
 *   ② listServerVoices 실패(null) ≠ 빈 라이브러리([]) — 조회 실패 때 전 목소리 재업로드(_2/_3 오염) 방지
 *   ③ main.js 동기화 가드 배선(원문 대조) — null 스킵 · single-flight · 참조텍스트 없는 wav 스킵
 *   ④ 스타일 push 실패(dirty) 뒤 pull 이 로컬 편집을 지우지 않는다(합쳐서 되올림)
 *   ⑤ rev 를 모르는 PC 의 첫 push 가 서버를 무검사 덮어쓰지 않는다(pull-union 먼저)
 *
 * style-share.test.js 와 같은 방식: USERPROFILE 을 갈아끼워 "다른 PC" 를 만들고,
 * api.py 규약 그대로의 HTTP 스텁 서버에 대고 **원문 함수를 실행**한다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let ok = 0, fail = 0;
const chk = (cond, label, extra) => {
  if (cond) { ok++; console.log('  OK   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

const REAL_HOME = os.homedir();
const REAL_STORE = path.join(REAL_HOME, '.flow-app', 'styles.json');
const realBefore = fs.existsSync(REAL_STORE) ? fs.readFileSync(REAL_STORE, 'utf8') : null;

// ── 스텁 서버: /styles(rev 낙관적 잠금) + /ref-voices ───────────────────────
let DOC = { rev: 0, styles: [], order: [] };
let mode = 'ok';                                   // 'ok' | '404'
let refVoices = [];                                 // /ref-voices 응답용
const putLog = [];                                  // {baseRev} 기록 — baseRev -1 미사용 단언용
const clean = (arr) => (Array.isArray(arr) ? arr : [])
  .filter((s) => s && s.id && s.name && s.prompt)
  .map((s) => ({ id: String(s.id).trim(), name: String(s.name).trim(), prompt: String(s.prompt).trim() }))
  .filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i);
const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (mode === '404') return send(404, { detail: 'Not Found' });
  if (req.method === 'GET' && req.url === '/ref-voices') return send(200, { dir: 'stub', voices: refVoices });
  if (req.method === 'GET' && req.url === '/styles') return send(200, Object.assign({}, DOC, { updatedAt: 'x' }));
  if (req.method === 'PUT' && req.url === '/styles') {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      let j = {}; try { j = JSON.parse(body); } catch (_) {}
      const baseRev = Number.isFinite(j.baseRev) ? j.baseRev : -1;
      putLog.push({ baseRev });
      if (baseRev >= 0 && baseRev !== DOC.rev) return send(409, Object.assign({ error: 'conflict' }, DOC));
      DOC = { rev: DOC.rev + 1, styles: clean(j.styles), order: (j.order || []).filter((x) => typeof x === 'string') };
      return send(200, Object.assign({}, DOC, { updatedAt: 'x' }));
    });
  }
  return send(404, { detail: 'Not Found' });
});

let BASE = '';
const homes = {};
function pc(name, baseOverride) {
  if (!homes[name]) homes[name] = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-' + name + '-'));
  process.env.USERPROFILE = homes[name];
  process.env.HOME = homes[name];
  ['../core/style-store', '../tts/asr-client', '../tts/tts-config', '../tts/secret-store'].forEach((m) => {
    try { delete require.cache[require.resolve(m)]; } catch (_) {}
  });
  const cfg = require('../tts/tts-config');
  cfg.getProvider = (n) => (n === 'omnivoice' ? { baseUrl: baseOverride !== undefined ? baseOverride : BASE } : {});
  return { SS: require('../core/style-store'), ASR: require('../tts/asr-client') };
}
const userStyles = (SS) => JSON.parse(fs.existsSync(SS.STORE_PATH) ? fs.readFileSync(SS.STORE_PATH, 'utf8') : '[]');
const namesOf = (SS) => userStyles(SS).map((s) => s.name).sort();
const quiet = () => {};

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = 'http://127.0.0.1:' + server.address().port;

  // ── [1] TTS 캐시 키 — refName 이 목소리 정체성에 들어간다 ──────────────────
  console.log('\n[1] TTS 캐시 키에 refName');
  {
    const TC = require('../core/tts-cache');
    const base = { provider: 'omnivoice', seed: 5697, cfgValue: 2, language: 'ko' };  // srv: 모드 = refAudioPath/refText 없음
    const kA = TC.keyFor('안녕하세요.', 1.15, { ...base, refName: '저음남성' });
    const kB = TC.keyFor('안녕하세요.', 1.15, { ...base, refName: '고전여성' });
    const kA2 = TC.keyFor('안녕하세요.', 1.15, { ...base, refName: '저음남성' });
    chk(kA !== kB, '다른 srv: 목소리 = 다른 캐시 키 (교차 적중 차단 — 2026-08-22 감사 high)');
    chk(kA === kA2, '같은 목소리 = 같은 키(재활용은 유지)');
    chk(kA !== TC.keyFor('안녕하세요.', 1.15, base), 'refName 유무도 키를 가른다');
  }

  // ── [2] listServerVoices — 실패(null) 와 빈 라이브러리([]) 구분 ─────────────
  console.log('\n[2] 참조음성 목록: 실패 ≠ 빈 목록');
  {
    mode = 'ok'; refVoices = [];
    let { ASR } = pc('v1');
    let r = await ASR.listServerVoices();
    chk(Array.isArray(r) && r.length === 0, '서버가 살아 있고 비어 있으면 = [] (동기화 진행 가능)');
    refVoices = [{ name: '한준', text: 't', bytes: 10 }];
    r = await pc('v1').ASR.listServerVoices();
    chk(Array.isArray(r) && r.length === 1 && r[0].name === '한준', '목소리가 있으면 그대로 배열');
    mode = '404';
    r = await pc('v1').ASR.listServerVoices();
    chk(r === null, 'HTTP 오류(404·구버전) = null (빈 목록으로 오인 금지)');
    mode = 'ok';
    r = await pc('v2', 'http://127.0.0.1:1').ASR.listServerVoices();     // 닫힌 포트
    chk(r === null, '연결 실패 = null');
    r = await pc('v3', '').ASR.listServerVoices();
    chk(r === null, '주소 미설정 = null');
  }

  // ── [3] main.js 동기화 가드 배선(원문 대조) ────────────────────────────────
  console.log('\n[3] main.js 참조음성 동기화 가드');
  {
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
    chk(/if \(serverNames == null\) return 0/.test(SRC), '목록 조회 실패(null)면 업로드 안 함 — _2/_3 오염 사고 차단');
    chk(/_refSyncBusy/.test(SRC) && /if \(_refSyncBusy\) return 0/.test(SRC), 'single-flight — 동기화 2개가 동시에 돌지 않는다(같은 초 _2·_3 생성 사고)');
    chk(/if \(!text\.trim\(\)\) \{ noText\+\+; continue; \}/.test(SRC), '참조텍스트(.txt) 없는 wav 는 올리지 않는다(빈 텍스트 = Auto 엉뚱 목소리)');
    chk(/let server = null;/.test(SRC) && /if \(server && server\.length\)/.test(SRC), 'list-ref-audio 도 null 을 실패로 다룬다');
  }

  // ── [4] 스타일: push 실패(dirty) 뒤 pull 이 로컬 편집을 지우지 않는다 ────────
  console.log('\n[4] 오프라인 편집 보존(dirty 병합)');
  {
    DOC = { rev: 0, styles: [], order: [] }; mode = 'ok'; putLog.length = 0;
    const { SS } = pc('D');
    SS.add({ name: '기존', prompt: 'p' });
    let r = await SS.pullFromServer(quiet);                       // 첫 동기화 — rev 확보
    chk(r.ok, '준비: 첫 동기화 완료', r);
    mode = '404';                                                 // 서버가 꺼진 사이…
    const { SS: SSd } = pc('D');
    SSd.add({ name: '오프라인편집', prompt: 'p2' });
    r = await SSd.pushToServer(quiet);
    chk(!r.ok, '준비: push 실패(서버 다운)', r);
    mode = 'ok';
    DOC = { rev: DOC.rev + 1, styles: [...DOC.styles, { id: 'other', name: '남의편집', prompt: 'p3' }], order: [] }; // 다른 PC 가 그 사이 저장
    r = await pc('D').SS.pullFromServer(quiet);
    const nm = namesOf(pc('D').SS);
    chk(nm.includes('오프라인편집'), '🔴 pull 이 못 올린 로컬 편집을 지우지 않는다(예전엔 통째 교체로 소실)', nm);
    chk(nm.includes('남의편집'), '다른 PC 의 편집도 함께 남는다', nm);
    chk(DOC.styles.some((s) => s.name === '오프라인편집'), '못 올렸던 편집이 서버로 되올라갔다', DOC.styles.map((s) => s.name));
  }

  // ── [5] rev 를 모르는 PC 의 첫 push — 서버 무검사 덮어쓰기 금지 ─────────────
  console.log('\n[5] 첫 push 는 pull-union 먼저(baseRev -1 금지)');
  {
    DOC = { rev: 5, styles: [{ id: 's1', name: '서버스타일', prompt: 'p' }], order: [] };
    mode = 'ok'; putLog.length = 0;
    const { SS } = pc('E');                                       // style-sync.json 없음 = rev 모름
    SS.add({ name: '새PC스타일', prompt: 'p2' });
    const r = await SS.pushToServer(quiet);
    chk(r.ok, '첫 push 성공', r);
    chk(DOC.styles.some((s) => s.name === '서버스타일'), '🔴 서버의 남의 스타일이 지워지지 않았다(예전엔 baseRev -1 로 통째 덮어씀)', DOC.styles.map((s) => s.name));
    chk(DOC.styles.some((s) => s.name === '새PC스타일'), '이 PC 의 새 스타일도 올라갔다');
    chk(putLog.every((p) => p.baseRev >= 0), '무검사 덮어쓰기(baseRev -1)를 한 번도 안 보냈다', putLog);
  }

  server.close();
  process.env.USERPROFILE = REAL_HOME; process.env.HOME = REAL_HOME;

  // 실제 홈 파일 무변경 확인(스타일 공유 테스트와 동일한 안전 단언)
  const realAfter = fs.existsSync(REAL_STORE) ? fs.readFileSync(REAL_STORE, 'utf8') : null;
  chk(realAfter === realBefore, '실제 ~/.flow-app/styles.json 은 한 글자도 바뀌지 않았다');

  console.log(fail ? `\n결과: ${ok} OK / ${fail} FAIL` : `\n결과: ${ok} OK / 0 FAIL`);
  process.exit(fail ? 1 : 0);
})();
