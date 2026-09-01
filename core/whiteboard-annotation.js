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

const WB = require('./whiteboard-render');

const ANN_EXT = '.annotation.json';
const TAIL_PAD_MS = 500;   // 마지막 영역이 끝난 뒤 여운 (SKILL.md: sceneDurationMs = 마지막 종료 + 0.5초)

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
function buildAnnotation(scene, drafted, opts = {}) {
  const regions = drafted.regions;
  const els = scene.elements.map((e, i) => {
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
    _priming: { sceneNum: scene.num, groupNums: scene.groupNums, sentenceNums: scene.sentenceNums },
    elements: els,
  };
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

  const ann = buildAnnotation(scene, d);
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
  return { ok: true, path: out, skipped: false, elements: ann.elements.length, swallowed };
}

/** 「🗑 이미지 삭제」와 함께 불린다 — 그림이 바뀌면 좌표가 틀린 자리를 가리키므로 주석도 지운다. */
function removeAnnotation(imagePath) {
  const p = annotationPathFor(imagePath);
  try { if (fs.existsSync(p)) { fs.unlinkSync(p); return true; } } catch (_) {}
  return false;
}

module.exports = { annotationPathFor, draftRegions, buildAnnotation, writeAnnotation, removeAnnotation, handPathFor, findSwallowed, ANN_EXT };
