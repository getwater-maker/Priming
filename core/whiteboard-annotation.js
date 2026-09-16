'use strict';

/**
 * whiteboard-annotation.js — 장면 계획 + 선화 PNG → `<이름>.annotation.json`.
 *
 * 엔진은 **같은 이름 짝**(`01.png` ↔ `01.annotation.json`)을 요구하고, `assets/preview.html` 도
 * 그 규칙으로 자동 짝짓기를 한다. 그래서 그림 옆(`media-1/`)이 유일하게 자연스러운 자리다.
 *
 * 🔑 **있으면 건너뛴다.** 로이가 `preview.html` 로 고친 영역·순서를 다음 실행이 덮어쓰면
 *   그 수정이 **조용히 사라진다**(v0.3.86·v0.3.50 계열 — 사용자가 정한 값을 코드가 다시 계산해 덮은 사고).
 *   `fillTts`(음성이 있으면 안 만듦)·`runComfyImages`(이미지가 있으면 건너뜀)와 같은 이어받기 규칙이다.
 *   다시 만들려면 `force: true` 를 **명시**해야 하고, 그때는 경고를 남긴다.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WB = require('./whiteboard-render');

const ANN_EXT = '.annotation.json';
const TAIL_PAD_MS = 500;   // 마지막 영역이 끝난 뒤 여운 (SKILL.md: sceneDurationMs = 마지막 종료 + 0.5초)

/**
 * 그 그림의 **내용 지문**. 주석은 이 그림에서 뽑은 영역 좌표이므로, 그림이 바뀌면 주석도 낡는다.
 * 🔑 mtime 이 아니라 **내용 해시**인 이유: 미디어 캐시가 같은 그림을 복사하면 mtime 만 바뀐다 —
 *   그걸로 판정하면 내용이 같은데도 30분짜리 렌더를 다시 돌린다.
 * 못 읽으면 null(판정 불가) — 호출부가 mtime 폴백을 쓴다.
 */
function imageSig(imagePath) {
  try {
    const b = fs.readFileSync(imagePath);
    return crypto.createHash('sha1').update(b).digest('hex').slice(0, 16) + ':' + b.length;
  } catch (_) { return null; }
}

/** `media-1/01.png` → `media-1/01.annotation.json` */
function annotationPathFor(imagePath) {
  const dir = path.dirname(imagePath);
  const base = path.basename(imagePath).replace(/\.(png|jpg|jpeg)$/i, '');
  return path.join(dir, base + ANN_EXT);
}

/** 영역 초안 — OpenCV 연결요소. 실패해도 던지지 않고 사유를 돌려준다. */
async function draftRegions(imagePath, count, { abortSignal = null } = {}) {
  if (!WB.hasEnv()) return { ok: false, error: '화이트보드 가상환경이 없습니다 — ensureEnv() 를 먼저 부르세요' };
  const script = path.join(WB.ROOT, 'priming', 'draft_regions.py');
  if (!fs.existsSync(script)) return { ok: false, error: `영역 초안 스크립트가 없습니다: ${script}` };

  let payload = null; const errs = [];
  try {
    // ⚠ 자식 cwd 가 py/ 라 경로는 절대로 넘긴다.
    await WB.runPy(WB.venvPython(), [script, path.resolve(imagePath), String(count)], {
      abortSignal,
      onLine: (line) => {
        const m = /^REGIONS=(.+)$/.exec(line);
        if (m) { try { payload = JSON.parse(m[1]); } catch (e) { errs.push('영역 JSON 파싱 실패: ' + e.message); } }
        else { const e = /^\[err\]\s*(.*)$/.exec(line); if (e) errs.push(e[1].trim()); }
      },
    });
  } catch (e) { return { ok: false, error: e.message }; }

  if (!payload || !Array.isArray(payload.regions) || !payload.regions.length) {
    return { ok: false, error: errs.length ? errs.join(' · ') : '영역을 뽑지 못했습니다' };
  }
  return { ok: true, canvas: payload.canvas, regions: payload.regions };
}

/** 영역 상자 안을 지나는 펜 경로 — 방향에 맞춰 가운데를 가로지른다. */
function handPathFor(region, direction) {
  const { x, y, width: w, height: h } = region;
  const inset = Math.round(Math.min(w, h) * 0.08);
  if (direction === 'top_to_bottom') {
    const cx = Math.round(x + w / 2);
    return { start: [cx, y + inset], end: [cx, y + h - inset], easing: 'easeInOut' };
  }
  if (direction === 'right_to_left') {
    const cy = Math.round(y + h / 2);
    return { start: [x + w - inset, cy], end: [x + inset, cy], easing: 'easeInOut' };
  }
  const cy = Math.round(y + h / 2);
  return { start: [x + inset, cy], end: [x + w - inset, cy], easing: 'easeInOut' };
}

/**
 * 장면 하나의 주석을 만든다. **파일에 쓰지는 않는다**(호출부가 결정).
 * @param scene planScenes() 가 낸 장면
 * @param drafted draftRegions() 결과
 */
/**
 * 영역 배정 후보 두 가지 중 **굶는 영역이 적은 쪽**을 고른다.
 * 🔑 무조건 넓이순으로 바꾸면 안 된다 — 로이 대본 실측에서 장면 1 은 넓이순이 옳았지만(굶음 2 → 0)
 *   **장면 3 은 원래 순서가 옳았다**(굶음 0 → 넓이순이면 1). 규칙 하나를 강요하지 않고 **재 보고 고른다.**
 * ⚠ 동률이면 **원래(초안) 순서**를 쓴다 — 이유 없이 그리는 흐름을 흔들지 않는다.
 */
function pickRegionOrder(scene, drafted, opts) {
  const first = drafted.regions || [];
  const cands = [first, orderRegionsForReveal(first)];
  let best = null;
  for (const regions of cands) {
    const els = assignElements(scene, regions, opts);
    const starved = findStarved(els).length;
    if (!best || starved < best.starved) best = { els, starved };
    if (best.starved === 0) break;
  }
  return best.els;
}

/** 장면의 element 마다 영역 하나를 붙인다(순서는 호출부가 정한다). */
function assignElements(scene, regions, opts = {}) {
  return scene.elements.map((e, i) => {
    // 영역이 element 보다 적으면 마지막 영역을 다시 쓴다(그리는 자리가 없는 것보다 낫다).
    const r = regions[Math.min(i, regions.length - 1)];
    const dir = r.direction || 'left_to_right';
    return {
      id: `e${e.seq}`,
      label: opts.labelOf ? opts.labelOf(e, i) : `영역 ${e.seq}`,
      sequence: e.seq,
      subtitle: e.subtitle,
      region: r.region,
      reveal: {
        direction: dir,
        startMs: e.startMs,
        durationMs: e.durationMs,
        maskPaddingPx: 16,
        // ⏳ 겹치는 주체 보호는 아직 자동으로 못 낸다 — preview.html 에서 사람이 지정한다.
        protectedRegions: [],
      },
      handPath: handPathFor(r.region, dir),
    };
  });
}

/**
 * 장면 하나의 주석을 만든다. **파일에 쓰지는 않는다**(호출부가 결정).
 * @param scene planScenes() 가 낸 장면
 * @param drafted draftRegions() 결과
 */
function buildAnnotation(scene, drafted, opts = {}) {
  const els = pickRegionOrder(scene, drafted, opts);
  const lastEnd = els.length ? Math.max(...els.map((e) => e.reveal.startMs + e.reveal.durationMs)) : 0;
  return {
    sceneId: `scene-${String(scene.num).padStart(2, '0')}`,
    canvas: drafted.canvas,
    // 🔑 장면 길이 = 그 장면 문장들의 **TTS 합 그대로**. 이래야 장면을 이어붙인 영상이 음성과 맞는다.
    //   ⚠ SKILL.md 관례인 「마지막 영역 종료 + 0.5초」를 쓰면 장면마다 조금씩 길어져
    //     50장면이면 **10초가 밀린다**(A/V 싱크가 통째로 어긋난다). 여운은 이미 확보돼 있다 —
    //     마지막 영역이 GAP_MS(300ms) 먼저 끝나도록 그려지기 때문이다.
    sceneDurationMs: scene.durationMs || (lastEnd + TAIL_PAD_MS),
    storyBasis: scene.text || '',
    // 🔑 imageSig = 이 영역을 뽑은 **그림의 지문**. 그림이 바뀌면 영역이 엉뚱한 자리를 가리키므로
    //   다음 실행이 이 값을 보고 영역을 다시 뽑는다(2026-09-16 사고: 새 그림인데 옛 장면 영상이 나갔다).
    _priming: { sceneNum: scene.num, groupNums: scene.groupNums, sentenceNums: scene.sentenceNums, imageSig: opts.imageSig || null },
    elements: els,
  };
}

/**
 * 🔴 **굶는 영역** — 렌더러(`render_stream_whiteboard._allowed_mask`)는 자기 영역에서
 *   **뒤에 오는 모든 영역**을 빼고 그린다(나중에 드러날 것을 미리 드러내지 않으려고).
 *   그래서 **앞 영역이 뒤 영역들에 통째로 덮이면 그릴 게 하나도 없어 화면이 그 시간만큼 멈춘다.**
 *
 *   실사고(2026-09-16, 로이 "10초 동안 화면이 멈춰있다가 움직이기 시작"):
 *     seq1 (762,0,582,397) 10.2초 · seq3 (0,0,858,768) · seq4 (858,0,486,768)
 *     → seq3 가 왼쪽 전부, seq4 가 오른쪽 전부를 덮어 **seq1 에 남는 면적 0** → 10.2초 정지.
 *     (영상 실측: 0.5~9초 구간의 변한 화소가 **0**)
 *
 *   ⚠ 기존 `findSwallowed` 는 **반대 방향**(뒤 영역이 앞 영역에 들어감)만 본다 — 이 사고는 못 잡는다.
 */

/** 직사각형에서 여러 직사각형을 뺀 **넓이**. 좌표를 압축해 격자로 센다(영역이 6개 남짓이라 저렴). */
function areaMinus(base, others) {
  const bx1 = base.x + base.width, by1 = base.y + base.height;
  if (base.width <= 0 || base.height <= 0) return 0;
  const xs = new Set([base.x, bx1]), ys = new Set([base.y, by1]);
  for (const o of others) {
    for (const v of [o.x, o.x + o.width]) if (v > base.x && v < bx1) xs.add(v);
    for (const v of [o.y, o.y + o.height]) if (v > base.y && v < by1) ys.add(v);
  }
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < X.length - 1; i++) {
    for (let j = 0; j < Y.length - 1; j++) {
      const cx = (X[i] + X[i + 1]) / 2, cy = (Y[j] + Y[j + 1]) / 2;
      if (others.some((o) => cx >= o.x && cx < o.x + o.width && cy >= o.y && cy < o.y + o.height)) continue;
      area += (X[i + 1] - X[i]) * (Y[j + 1] - Y[j]);
    }
  }
  return area;
}

/**
 * 그리는 차례에 **실제로 남는 면적이 거의 없는** element 를 찾는다.
 * @returns [{ seq, ratio, sec }] — ratio = 남는 면적 / 자기 면적
 */
function findStarved(elements, minRatio = 0.12) {
  const out = [];
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i];
    const mine = Math.max(1, e.region.width * e.region.height);
    const others = elements.slice(i + 1).map((x) => x.region)
      .concat(((e.reveal && e.reveal.protectedRegions) || []));
    const ratio = areaMinus(e.region, others) / mine;
    if (ratio < minRatio) out.push({ seq: e.sequence, ratio, sec: ((e.reveal && e.reveal.durationMs) || 0) / 1000 });
  }
  return out;
}

/**
 * 영역을 **그리는 순서**로 정렬한다 — 넓은 것부터.
 * 🔑 렌더러가 「뒤 영역을 뺀다」이므로 **넓은 영역이 앞에 와야** 뒤엣것을 빼도 그릴 자리가 남는다.
 *   반대로 두면(좁은 것 먼저) 그 좁은 영역이 뒤의 큰 영역에 통째로 먹혀 화면이 멈춘다(위 실사고).
 * ⚠ 같은 넓이면 **원래 순서**를 지킨다(초안의 왼→오 흐름을 헛되이 흔들지 않는다).
 */
function orderRegionsForReveal(regions) {
  return (regions || []).map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const A = a.r.region.width * a.r.region.height, B = b.r.region.width * b.r.region.height;
      return B !== A ? B - A : a.i - b.i;
    })
    .map((x) => x.r);
}

/**
 * 앞 영역에 거의 통째로 들어간 영역을 찾는다.
 * ⚠ 그러면 그 차례에 **드러날 게 없어** 화면이 멈춘 것처럼 보인다 — 렌더는 성공하는데 결과가 틀린,
 *   사람이 눈으로 봐야만 아는 종류다. 막지는 않고(초안이라 사람이 고친다) **반드시 알린다**.
 */
function findSwallowed(elements, ratio = 0.8) {
  const area = (r) => Math.max(1, r.width * r.height);
  const inter = (a, b) => {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  };
  const out = [];
  for (let i = 1; i < elements.length; i++) {
    for (let j = 0; j < i; j++) {
      if (inter(elements[i].region, elements[j].region) / area(elements[i].region) >= ratio) {
        out.push({ seq: elements[i].sequence, insideOf: elements[j].sequence });
        break;
      }
    }
  }
  return out;
}

/**
 * 장면 주석을 파일로. **있으면 건너뛴다**(사람이 고친 것을 지우지 않는다).
 * @returns {Promise<{ok:boolean, path?:string, skipped?:boolean, error?:string}>}
 */
async function writeAnnotation(scene, imagePath, { force = false, log = () => {}, abortSignal = null } = {}) {
  const out = annotationPathFor(imagePath);
  if (fs.existsSync(out) && !force) return { ok: true, path: out, skipped: true };
  if (fs.existsSync(out) && force) {
    log(`⚠ 장면 ${scene.num} 주석을 다시 만듭니다 — 손으로 고친 영역·순서가 사라집니다 (${path.basename(out)})`);
  }
  const d = await draftRegions(imagePath, scene.elements.length, { abortSignal });
  if (!d.ok) return { ok: false, error: d.error };

  const ann = buildAnnotation(scene, d, { imageSig: imageSig(imagePath) });
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(ann, null, 2), 'utf8');
  } catch (e) { return { ok: false, error: `주석을 쓰지 못했습니다: ${e.message}` }; }

  // 쓰자마자 fail-closed 검사 — 여기서 어긋나면 렌더가 엉뚱한 자리를 그린다.
  const chk = WB.checkCanvas(imagePath, out);
  if (!chk.ok) return { ok: false, error: chk.error };

  const swallowed = findSwallowed(ann.elements);
  for (const s2 of swallowed) {
    log(`⚠ 장면 ${scene.num} 영역 ${s2.seq} 가 영역 ${s2.insideOf} 안에 거의 다 들어갑니다 — `
      + `그 차례에 새로 드러날 게 없습니다. 「✏ 영역 편집」에서 경계를 옮기세요`);
  }
  // 🔴 넓이순 배정으로도 남는 자리가 없으면(영역이 서로 거의 같은 자리) 그 시간만큼 화면이 멈춘다.
  for (const st of findStarved(ann.elements)) {
    log(`⚠ 장면 ${scene.num} 영역 ${st.seq} 는 뒤 영역들에 거의 다 덮입니다(남는 자리 ${(st.ratio * 100).toFixed(0)}%) — `
      + `그 ${st.sec.toFixed(1)}초 동안 화면이 멈춘 것처럼 보입니다. 「✏ 영역 편집」에서 경계를 겹치지 않게 옮기세요`);
  }
  return { ok: true, path: out, skipped: false, elements: ann.elements.length, swallowed };
}

/** 「🗑 이미지 삭제」와 함께 불린다 — 그림이 바뀌면 좌표가 틀린 자리를 가리키므로 주석도 지운다. */
function removeAnnotation(imagePath) {
  const p = annotationPathFor(imagePath);
  try { if (fs.existsSync(p)) { fs.unlinkSync(p); return true; } } catch (_) {}
  return false;
}

module.exports = { annotationPathFor, imageSig, draftRegions, areaMinus, findStarved, orderRegionsForReveal, pickRegionOrder, assignElements, buildAnnotation, writeAnnotation, removeAnnotation, handPathFor, findSwallowed, ANN_EXT };
