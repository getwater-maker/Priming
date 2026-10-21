// 🎞 켄번스 한 곳(Lab · 차이표 #12) — 패턴 표 · 그룹 번호 공식 · 검정 방지 클램프 · 구간(웨이포인트) · 화면 CSS.
//   .vrew 빌더(vrew/vrew-builder)가 트랙에 쓰는 값과 ① 미리보기(App.jsx)가 그리는 움직임이 **같은 표**에서 나온다.
//   MP4(core/vrew-render kenBurnsFilter)는 .vrew 트랙을 읽으므로 따로 맞출 것이 없다.
//   ⚠ 렌더러 번들에 들어간다 — require·fs 를 쓰지 않는다(순수 계산만).
// 켄번스 패턴 풀 — 12개(줌2·팬4·대각4·코너푸시2).
// ★ Vrew 좌표: scale = "이미지에서 보이는 영역의 비율"(1.0=전체, 작을수록 줌인).
//   크롭창이 이미지를 벗어나면(=center 가 [scale/2, 1−scale/2] 밖) 뒤 검정이 노출됨.
// ★★ 이 12개는 앱 미리보기(renderer/src/styles.css @keyframes kb0~kb11)와 "정확히" 일치시킨다.
//   미리보기는 object-fit:cover + `transform: scale(S) translate(T%)` (CSS scale=확대배율, 1.08~1.22).
//   Vrew scale(=보이는 영역 비율)는 그 역수: scale_vrew = 1/scale_css → 0.82~0.93 (약한 줌).
//   center = 0.5 − T/100 (translate 부호 반영). 예전엔 scale 0.60~0.66(=1.5~1.67배 강줌)이라
//   Vrew 에서만 이미지가 34~40% 잘려 상단이 날아갔음 → 미리보기와 동일한 약한 줌으로 통일.
//   인덱스도 미리보기와 같은 (g.num*7+3)%12 로 맞춰(_kenBurnsFor(g.num)) 그룹별 패턴이 완전 일치.
const KEN_BURNS_PATTERNS = [
  // 0) 중앙 슬로우 줌인 (kb0: 1.08→1.22)
  { from: { scale: 0.926, centerX: 0.50, centerY: 0.50 }, to: { scale: 0.820, centerX: 0.50, centerY: 0.50 } },
  // 1) 중앙 줌아웃 (kb1: 1.22→1.08)
  { from: { scale: 0.820, centerX: 0.50, centerY: 0.50 }, to: { scale: 0.926, centerX: 0.50, centerY: 0.50 } },
  // 2) 좌 → 우 가로 팬 (kb2: translate -5%→5%)
  { from: { scale: 0.862, centerX: 0.55, centerY: 0.50 }, to: { scale: 0.862, centerX: 0.45, centerY: 0.50 } },
  // 3) 우 → 좌 가로 팬 (kb3)
  { from: { scale: 0.862, centerX: 0.45, centerY: 0.50 }, to: { scale: 0.862, centerX: 0.55, centerY: 0.50 } },
  // 4) 하 → 상 세로 팬 (kb4)
  { from: { scale: 0.862, centerX: 0.50, centerY: 0.45 }, to: { scale: 0.862, centerX: 0.50, centerY: 0.55 } },
  // 5) 상 → 하 세로 팬 (kb5)
  { from: { scale: 0.862, centerX: 0.50, centerY: 0.55 }, to: { scale: 0.862, centerX: 0.50, centerY: 0.45 } },
  // 6) 좌상 → 중앙 대각 줌인 (kb6: 1.10 t(-4,-4) → 1.20 t(2,2))
  { from: { scale: 0.909, centerX: 0.54, centerY: 0.54 }, to: { scale: 0.833, centerX: 0.48, centerY: 0.48 } },
  // 7) 우상 → 중앙 대각 줌인 (kb7)
  { from: { scale: 0.909, centerX: 0.46, centerY: 0.54 }, to: { scale: 0.833, centerX: 0.52, centerY: 0.48 } },
  // 8) 좌하 → 중앙 대각 줌인 (kb8)
  { from: { scale: 0.909, centerX: 0.54, centerY: 0.46 }, to: { scale: 0.833, centerX: 0.48, centerY: 0.52 } },
  // 9) 우하 → 중앙 대각 줌인 (kb9)
  { from: { scale: 0.909, centerX: 0.46, centerY: 0.46 }, to: { scale: 0.833, centerX: 0.52, centerY: 0.52 } },
  // 10) 전체 → 우상 코너 푸시인 (kb10: 1.08 → 1.22 t(5,-5))
  { from: { scale: 0.926, centerX: 0.50, centerY: 0.50 }, to: { scale: 0.820, centerX: 0.45, centerY: 0.55 } },
  // 11) 전체 → 좌하 코너 푸시인 (kb11: 1.08 → 1.22 t(-5,5))
  { from: { scale: 0.926, centerX: 0.50, centerY: 0.50 }, to: { scale: 0.820, centerX: 0.55, centerY: 0.45 } },
];

// 미리보기(App.jsx)와 동일 공식: 그룹 번호(1-based) 기반 (num*7+3)%12.
// 곱수 7 은 풀 길이 12 와 서로소 → 인덱스가 0~11 전부 비반복 순회.
function _pickKenBurnsIndex(groupNum) {
  const len = KEN_BURNS_PATTERNS.length;
  return (((Number(groupNum) || 0) * 7) + 3) % len;
}

// ★ 검정 방지 클램프: scale 은 (0,1] (1 초과면 이미지보다 큰 영역 = 검정), center 는
//   크롭창이 이미지 안에 머물도록 [scale/2, 1−scale/2] 로 접음. 손으로 쓴 패턴이 범위를
//   벗어나도(또는 향후 수정으로) 절대 뒤 배경이 노출되지 않게 하는 안전망.
function _clampKbFrame(f) {
  const s = Math.min(1, Math.max(0.2, Number(f.scale) || 1));
  const m = s / 2;
  const clamp = (v, d) => Math.min(1 - m, Math.max(m, (v == null ? d : Number(v))));
  return { scale: s, centerX: clamp(f.centerX, 0.5), centerY: clamp(f.centerY, 0.5) };
}
// 🎞 켄번스 구간(v0.7.75 · 삼국지 R2 — 한 장이 몇 분이어도 한 번의 팬으로 끝나지 않게).
//   한 그룹 그림이 보이는 시간(자기 문장 + 이어 깐 범위)을 문장 경계에서 N 구간으로 나누고, 구간마다 **자기 자산(트랙)**을 둔다 — 같은 그림 파일을 가리키는 트랙 N 개, 각자 kenburnsAnimationInfo.
//   → Vrew 가 읽는 구조 그대로(필드를 더하지 않는다)이고 🎬 MP4 렌더러도 손대지 않는다(자산마다 자기 구간 안에서 0→1 로 진행).
//   웨이포인트: 양 끝은 옛 패턴(from/to)과 같고, 사이는 구간마다 방향이 달라지게 살짝 흔든다. 구간 k 의 끝 프레임 = 구간 k+1 의 시작 프레임 → 이음새에서 튀지 않는다.
const KB_SEG_AUTO_SEC = 60;   // 'auto' = 구간당 약 60초
const KB_SEG_MIN_SEC = 8;     // 구간이 이보다 짧아지게 나누지 않는다
const KB_SEG_MAX = 8;
function kbWaypoints(from, to, n, seed) {
  const f = _clampKbFrame(from), t = _clampKbFrame(to);
  const out = [f];
  const sg0 = ((Number(seed) || 0) % 2) ? 1 : -1;
  for (let k = 1; k < n; k++) {
    const u = k / n, sg = (k % 2 ? 1 : -1) * sg0;
    const sc = Math.min(0.95, Math.max(0.80, f.scale + (t.scale - f.scale) * u + sg * 0.022));
    out.push(_clampKbFrame({ scale: sc, centerX: f.centerX + (t.centerX - f.centerX) * u + sg * 0.035, centerY: f.centerY + (t.centerY - f.centerY) * u - sg * 0.025 }));
  }
  out.push(t);
  return out;
}
/** 켄번스 구간 수 — want = 'auto' | 2..8 | 없음(1). dur = 그림이 보이는 전체 초. 짧으면 1(나누지 않음). */
function kbSegCount(want, dur, nSent) {
  const d = Number(dur) || 0;
  let n = 1;
  if (want === 'auto') n = Math.round(d / KB_SEG_AUTO_SEC);
  else if (Number(want) >= 2) n = Math.floor(Number(want));
  n = Math.min(n, Math.floor(d / KB_SEG_MIN_SEC), KB_SEG_MAX, Math.max(1, nSent | 0));
  return Math.max(1, n);
}
// 🖼 그룹 「움직임」(core/visual-look MOTIONS) → 켄번스. auto = 그룹 번호로 돌아가며 · none = 멈춘 그림(필드를 안 쓴다)
function _kenBurnsForLook(g) {
  const m = (g && g.look && g.look.motion) || 'auto';
  if (m === 'none') return null;
  const idx = { in: 0, out: 1, lr: 2, rl: 3, bt: 4, tb: 5 }[m];
  if (idx == null) return _kenBurnsFor(g.num);
  const kb = KEN_BURNS_PATTERNS[idx];
  return { from: _clampKbFrame(kb.from), to: _clampKbFrame(kb.to) };
}
function _kenBurnsFor(groupIdx) {
  const kb = KEN_BURNS_PATTERNS[_pickKenBurnsIndex(groupIdx)];
  return { from: _clampKbFrame(kb.from), to: _clampKbFrame(kb.to) };
}


// 🎞 구간 계획 — 빌더와 미리보기가 같은 규칙으로 「문장 → 구간」·웨이포인트를 정한다.
//   vis = 그 그림이 보이는 문장들 [{d: 초}] (순서대로) · want = look.kbSeg(1|2..8|'auto') · kb = {from, to} · seed = 그룹 번호
//   → null(나누지 않음) | { m, wp: 프레임 m+1개, segOf: vis 마다 구간 번호 0..m-1 }
function planSegments(want, vis, kb, seed) {
  if (!kb || !kb.from || want === 1 || want === '1' || !want) return null;
  const total = vis.reduce((a, x) => a + x.d, 0);
  const n = kbSegCount(want, total, vis.length);
  if (n < 2) return null;
  // 문장 가운데 시각으로 구간을 정한다 — 구간이 빈 채로 남으면(아주 긴 문장) 그만큼 구간 수를 줄인다
  const idx = []; let acc = 0;
  for (const x of vis) { idx.push(Math.min(n - 1, Math.floor(((acc + x.d / 2) / total) * n))); acc += x.d; }
  const used = [...new Set(idx)].sort((a, b) => a - b);
  const m = used.length; if (m < 2) return null;
  const remap = new Map(used.map((u, k) => [u, k]));
  const wp = kbWaypoints(kb.from, kb.to || kb.from, m, seed);
  return { m, wp, segOf: idx.map((i) => remap.get(i)), total };
}

// ── ① 미리보기 CSS — Vrew 프레임(보이는 영역 비율 s · 가운데 cx, cy) → object-fit:cover 그림의 transform ──
//   보이는 창이 화면을 채우려면 배율 1/s · 창 가운데를 화면 가운데로 = translate((0.5−cx)·100%, (0.5−cy)·100%) (scale 뒤에 적용 = 그림 크기 기준 %)
function cssTransform(f) {
  const fr = _clampKbFrame(f || {});
  return `scale(${(1 / fr.scale).toFixed(5)}) translate(${((0.5 - fr.centerX) * 100).toFixed(3)}%,${((0.5 - fr.centerY) * 100).toFixed(3)}%)`;
}
// 프레임들 + 시각 비율(0..1, 프레임과 같은 개수) → @keyframes 본문
function cssKeyframes(name, frames, stops) {
  const st = stops || frames.map((_, i) => (frames.length > 1 ? i / (frames.length - 1) : 0));
  return `@keyframes ${name}{` + frames.map((f, i) => `${(st[i] * 100).toFixed(3)}%{transform:${cssTransform(f)}}`).join('') + '}';
}
// 패턴 12개의 기본 CSS(kb0~kb11) — styles.css 에 손으로 쓴 값을 대신한다
function patternCss() {
  return KEN_BURNS_PATTERNS.map((p, i) => cssKeyframes('kb' + i, [_clampKbFrame(p.from), _clampKbFrame(p.to)])).join('\n');
}
// 그룹의 켄번스 { from, to } — look.motion 우선 · 'none' = null (빌더 _kenBurnsForLook 과 같은 함수)
function forLook(g) { return _kenBurnsForLook(g); }
function patternIndexOf(g) {
  const m = (g && g.look && g.look.motion) || 'auto';
  if (m === 'none') return -1;
  const idx = { in: 0, out: 1, lr: 2, rl: 3, bt: 4, tb: 5 }[m];
  return idx == null ? _pickKenBurnsIndex(g && g.num) : idx;
}

module.exports = { KEN_BURNS_PATTERNS, KB_SEG_AUTO_SEC, KB_SEG_MIN_SEC, KB_SEG_MAX, _pickKenBurnsIndex, _clampKbFrame, kbWaypoints, kbSegCount, _kenBurnsForLook, _kenBurnsFor, planSegments, cssTransform, cssKeyframes, patternCss, forLook, patternIndexOf };
