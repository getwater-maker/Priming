/**
 * 채널 화풍 내보내기 — `~/.flow-app/channel-styles.json`
 * ============================================================================
 * 왜 있나: **화풍의 정본을 Priming 한 곳으로** 모으기 위해서다.
 *   아도나이로이 대시보드(http://localhost:8765)는 패키징의 「이미지 프롬프트」에 채널 화풍을
 *   앞에 붙여 **썸네일 프롬프트**를 만든다. 그런데 그 화풍 문자열이 채널마다
 *   `지침\config.md` 에 **손으로 복사**돼 있어서 앱과 어긋난다(실제로 어긋나 있었다 —
 *   고전서재 config 는 「짙은 수채」인데 앱의 롱폼 화풍은 Cozy Textured Digital Gouache).
 *   → 앱이 쓰는 그 문자열을 그대로 파일로 내보내고, 대시보드가 그걸 읽으면 어긋날 수가 없다.
 *
 * 정책
 *   · **앱이 실제로 전송하는 문자열**을 넣는다(`style-store.getPrompt` = 기본 스타일의
 *     공통보정 문구까지 포함). 여기서 다시 만들지 않는다 — 그러면 또 두 벌이 된다.
 *   · 채널 화풍은 **모드별**이다(`styleLong`/`styleShort`, 옛 `styleId` 폴백). 썸네일용은
 *     `styleThumb`(비면 롱폼 것) — 어디서 온 값인지 `from` 에 적어 소비자가 추측하지 않게 한다.
 *   · 내용이 그대로면 **다시 쓰지 않는다**(rev 가 헛되게 올라가지 않게). 저장은 tmp→rename.
 *   · 실패해도 앱은 그냥 간다 — 이건 부가 산출물이고, 여기서 예외가 나면 채널 저장이 막힌다.
 *   · 시각은 **KST**(전역 지침). UTC 로 적으면 대시보드가 하루 밀린 값을 보여 준다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const STORE_DIR = path.join(os.homedir(), '.flow-app');
const EXPORT_PATH = path.join(STORE_DIR, 'channel-styles.json');

// Priming 이 이미지 프롬프트를 만드는 방식(pipeline.buildImagePrompt) — 소비자가 규칙을 추측하지 않게 함께 적는다.
const COMBINE_RULE = '<화풍>, <장면묘사>, plain unmarked surfaces, clean blank walls, no text, no watermark, <얼굴 네거티브> + 맨 끝 마침표';
const NOTE = '이 파일은 Priming 이 자동으로 씁니다(앱 시작·채널 저장·스타일 편집 직후). 손으로 고치지 마세요 — 다음 저장에 덮어씁니다.';

/** KST(UTC+9) ISO 문자열 — `2026-08-21T15:52:00+09:00` */
function kstNow(now) {
  const d = now instanceof Date ? now : new Date();
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}T`
    + `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}+09:00`;
}

/** 스타일 하나를 해석 — 못 찾으면 missing 으로 표시한다(조용히 빈 문자열을 내보내지 않는다). */
function _resolve(styleId, from, SS) {
  const id = String(styleId || '').trim();
  if (!id) return null;
  const s = SS.getById(id);
  if (!s) return { styleId: id, styleName: '', prompt: '', from, missing: true };
  return { styleId: id, styleName: s.name, prompt: SS.getPrompt(id) || '', from, isBuiltIn: !!s.isBuiltIn };
}

/**
 * 내보낼 문서를 만든다(파일에 쓰지는 않는다 — 테스트가 이 함수만 검사할 수 있게 분리).
 * @param {object} deps 주입(테스트용). 기본은 실제 스토어.
 */
function build(deps = {}) {
  const SS = deps.styleStore || require('./style-store');
  const PS = deps.presetStore || require('../tts/preset-store');
  const presets = (typeof PS.loadAll === 'function' ? PS.loadAll() : []) || [];

  const channels = presets.map((p) => {
    // 모드별 화풍. 둘 다 없으면 옛 단일 필드(styleId)로 폴백 — 오래된 채널도 값이 나오게.
    const long = _resolve(p.styleLong || p.styleId, p.styleLong ? 'styleLong' : 'styleId', SS);
    const short = _resolve(p.styleShort || p.styleId, p.styleShort ? 'styleShort' : 'styleId', SS);
    // 썸네일용은 따로 지정할 수 있다(인물이 주인공이라 본문 화풍과 다를 수 있다 — 고전서재 사례).
    //   지정이 없으면 **롱폼 것을 쓴다**. 소비자가 폴백 로직을 또 만들지 않도록 여기서 확정한다.
    const thumbSet = _resolve(p.styleThumb, 'styleThumb', SS);
    const thumb = thumbSet || (long ? { ...long, from: 'long(폴백)' } : null);
    return { channel: p.name, group: p.group || '', long, short, thumb };
  });

  return {
    note: NOTE,
    updatedAt: kstNow(deps.now),
    rev: 1,                                          // write() 가 실제 값으로 채운다
    combineRule: COMBINE_RULE,
    channels,
    styles: SS.loadAll().map((s) => ({ id: s.id, name: s.name, prompt: s.prompt || '', isBuiltIn: !!s.isBuiltIn })),
  };
}

/** rev·updatedAt 을 뺀 나머지가 같은지 — 내용이 안 바뀌면 파일을 다시 쓰지 않는다. */
function _sameBody(a, b) {
  if (!a || !b) return false;
  const strip = (d) => JSON.stringify({ channels: d.channels, styles: d.styles, combineRule: d.combineRule });
  return strip(a) === strip(b);
}

function readExport() {
  try { return JSON.parse(fs.readFileSync(EXPORT_PATH, 'utf-8')); } catch (_) { return null; }
}

/**
 * 파일에 쓴다. 내용이 그대로면 건너뛴다.
 * @returns {{ok:boolean, changed:boolean, rev?:number, channels?:number, path:string, error?:string}}
 */
function write(deps = {}) {
  try {
    const doc = build(deps);
    const prev = readExport();
    if (_sameBody(prev, doc)) return { ok: true, changed: false, rev: prev.rev, channels: doc.channels.length, path: EXPORT_PATH };
    doc.rev = (prev && Number.isFinite(Number(prev.rev)) ? Number(prev.rev) : 0) + 1;
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const tmp = EXPORT_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
    fs.renameSync(tmp, EXPORT_PATH);                 // 원자적 — 대시보드가 반쪽 파일을 읽지 않게
    return { ok: true, changed: true, rev: doc.rev, channels: doc.channels.length, path: EXPORT_PATH };
  } catch (e) {
    return { ok: false, changed: false, path: EXPORT_PATH, error: String((e && e.message) || e) };
  }
}

module.exports = { build, write, readExport, kstNow, EXPORT_PATH, COMBINE_RULE };
