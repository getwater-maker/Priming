'use strict';
/**
 * ui2api.js — ComfyUI "워크플로(UI) JSON" → "API 포맷(prompt) JSON" 변환기.
 *   서브그래프(definitions.subgraphs)를 평탄화한다. 프론트엔드 graphToPrompt 와 같은 규칙:
 *   - 내부 노드 id = "<서브그래프인스턴스id>:<내부id>"
 *   - 위젯값(widgets_values)은 object_info 의 input_order 순으로 소비.
 *     · control_after_generate 위젯은 값 뒤에 1칸을 더 먹는다.
 *     · COMFY_DYNAMICCOMBO_V3 는 선택된 option 의 하위 입력을 "name.sub" 로 전개.
 *     · COMFY_AUTOGROW_V3 는 위젯값을 안 먹고, 링크가 "values.a" 이름으로 들어온다.
 *   - 링크는 [노드id(string), 출력slot] 로. 서브그래프 경계는 origin_id -10(입력)/target -20(출력).
 *
 * 사용: node ui2api.js <ui.json> <object_info.json> <out.json> [--unlink=width,height]
 *   --unlink: 서브그래프 입력 슬롯 중 부모에서 링크로 들어오더라도 **승격 위젯 리터럴**을 쓴다
 *             (그 소스 노드는 그래프에서 제거). 우리 엔진이 해상도를 주입하려면 리터럴이어야 함.
 */
const fs = require('fs');

const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO']);
function isWidgetSpec(spec) {
  const t = spec && spec[0];
  if (Array.isArray(t)) return true;                 // 옵션 배열 = 콤보 위젯
  if (typeof t !== 'string') return false;
  if (t === 'COMFY_DYNAMICCOMBO_V3') return true;
  if (t === 'COMFY_AUTOGROW_V3') return false;       // 위젯값 소비 안 함(링크로만)
  // "FLOAT,INT" 처럼 복합 타입도 위젯이다(LTXVEmptyLatentAudio.frame_rate).
  return t.split(',').every((x) => WIDGET_TYPES.has(x.trim()));
}

/** object_info 정의를 바탕으로 widgets_values 를 이름→값 으로 푼다. */
function decodeWidgets(def, wv, warn) {
  const out = {};
  if (!def) return out;
  const req = (def.input && def.input.required) || {};
  const opt = (def.input && def.input.optional) || {};
  const order = [
    ...(((def.input_order || {}).required) || Object.keys(req)).map((n) => [n, req[n]]),
    ...(((def.input_order || {}).optional) || Object.keys(opt)).map((n) => [n, opt[n]]),
  ];
  let i = 0;
  const take = () => (i < wv.length ? wv[i++] : undefined);
  const walk = (entries, prefix) => {
    for (const [name, spec] of entries) {
      if (!spec) continue;
      if (!isWidgetSpec(spec)) continue;
      const key = prefix + name;
      const val = take();
      out[key] = val;
      const o = spec[1] || {};
      if (o.control_after_generate) take();          // "fixed"/"randomize" 등 1칸 더
      if (spec[0] === 'COMFY_DYNAMICCOMBO_V3') {
        const chosen = (o.options || []).find((x) => x && x.key === val);
        if (!chosen) { if (val !== undefined) warn(`동적콤보 "${key}" 옵션 "${val}" 을 스키마에서 못 찾음`); continue; }
        const sreq = ((chosen.inputs || {}).required) || {};
        const sopt = ((chosen.inputs || {}).optional) || {};
        walk([...Object.entries(sreq), ...Object.entries(sopt)], key + '.');
      }
    }
  };
  walk(order, '');
  if (i < wv.length) warn(`widgets_values 잉여 ${wv.length - i}개 (소비 ${i}/${wv.length})`);
  if (i > wv.length) warn(`widgets_values 부족 (필요 ${i}, 실제 ${wv.length})`);
  return out;
}

const KEEP = Symbol('keep-inner-widget-value');
const PASSTHRU = new Set(['Reroute', 'RerouteNode', 'Reroute (rgthree)']); // 타입 없는 통과 노드 → 접어 없앤다

function convert(ui, oi, opts = {}) {
  const unlink = new Set(opts.unlink || []);
  const warnings = [];
  const graph = {};
  const dropped = new Set();

  // 부모 링크: id → {origin_id, origin_slot}
  const pLinks = new Map();
  for (const l of ui.links || []) pLinks.set(l[0], { origin: String(l[1]), slot: l[2] });

  const subDefs = new Map(((ui.definitions || {}).subgraphs || []).map((s) => [s.id, s]));

  // 노드를 그래프에 추가 (prefix 는 서브그래프 내부용)
  function addNode(node, prefix, resolveLink) {
    const def = oi[node.type];
    if (!def) { warnings.push(`알 수 없는 노드 타입 "${node.type}" (id ${node.id}) — 건너뜀`); return; }
    if (node.mode) { warnings.push(`노드 ${node.id} mode=${node.mode}(뮤트/바이패스) — 미지원, 그대로 포함`); }
    const id = prefix + node.id;
    const inputs = decodeWidgets(def, node.widgets_values || [], (m) => warnings.push(`[${node.type} ${id}] ${m}`));
    for (const inp of node.inputs || []) {
      if (inp.link == null) continue;
      const src = resolveLink(inp.link);
      if (src === KEEP) continue;                    // 승격 위젯값이 비었음 → 내부 노드 기본값 유지
      if (!src) { warnings.push(`[${node.type} ${id}] 링크 ${inp.link} 해석 실패`); continue; }
      inputs[inp.name] = src;                        // 링크가 위젯 리터럴을 덮어씀
    }
    graph[id] = { inputs, class_type: node.type, _meta: { title: node.title || def.display_name || node.type } };
  }

  // ── 1) 최상위 노드 ──
  const pById = new Map((ui.nodes || []).map((n) => [String(n.id), n]));
  const pResolve = (lid, depth = 0) => {
    const l = pLinks.get(lid);
    if (!l || depth > 16) return null;
    const src = pById.get(l.origin);
    if (src && PASSTHRU.has(src.type)) {              // Reroute 는 접어 없앰 — 그 입력의 원천으로
      const up = (src.inputs || [])[0];
      return up && up.link != null ? pResolve(up.link, depth + 1) : null;
    }
    return [l.origin, l.slot];
  };
  for (const node of ui.nodes || []) {
    if (subDefs.has(node.type)) continue;            // 서브그래프 인스턴스는 아래에서
    if (PASSTHRU.has(node.type)) continue;
    addNode(node, '', pResolve);
  }

  // ── 2) 서브그래프 평탄화 ──
  for (const inst of ui.nodes || []) {
    const sub = subDefs.get(inst.type);
    if (!sub) continue;
    const P = inst.id + ':';
    const sLinks = new Map((sub.links || []).map((l) => [l.id, l]));

    // 승격 위젯값: sub.inputs 순서에서 위젯형 슬롯만 세어 widgets_values 와 정렬
    const promoted = new Map();
    {
      let k = 0;
      const wv = inst.widgets_values || [];
      for (const slot of sub.inputs || []) {
        const t = String(slot.type || '');
        const isWidget = WIDGET_TYPES.has(t) || t === 'COMBO';
        if (!isWidget) continue;
        promoted.set(slot.name, wv[k++]);
      }
      if (k !== wv.length) warnings.push(`서브그래프 ${inst.id}: 승격 위젯 ${k}개 vs widgets_values ${wv.length}개 (불일치)`);
    }
    // 부모에서 링크로 들어오는 슬롯
    const linkedSlot = new Map();
    for (const inp of inst.inputs || []) if (inp.link != null) linkedSlot.set(inp.name, inp.link);

    // 슬롯 index → 값(리터럴) 또는 부모 링크 [id,slot]
    const slotValue = (idx) => {
      const slot = (sub.inputs || [])[idx];
      if (!slot) return null;
      const label = slot.label || slot.name;
      const lid = linkedSlot.get(slot.name);
      if (lid != null && !unlink.has(label)) {
        const l = pLinks.get(lid);
        return l ? { link: [l.origin, l.slot] } : null;
      }
      if (lid != null && unlink.has(label)) {
        const l = pLinks.get(lid);
        if (l) dropped.add(l.origin);                // 리터럴로 대체 → 소스 노드 제거
      }
      const lit = promoted.get(slot.name);
      // 승격 위젯값이 없는 템플릿(예: LTX2.3)은 내부 노드의 자체 위젯값을 그대로 쓴다.
      if (lit === undefined) return { keep: true };
      return { literal: lit };
    };

    const sById = new Map((sub.nodes || []).map((n) => [n.id, n]));
    const sResolve = (lid, depth = 0) => {
      const l = sLinks.get(lid);
      if (!l || depth > 16) return null;
      if (l.origin_id === -10) {                     // 서브그래프 입력 경계
        const v = slotValue(l.origin_slot);
        if (!v) return null;
        if (v.keep) return KEEP;
        return v.link ? v.link : { __literal: v.literal };
      }
      const src = sById.get(l.origin_id);
      if (src && PASSTHRU.has(src.type)) {
        const up = (src.inputs || [])[0];
        return up && up.link != null ? sResolve(up.link, depth + 1) : null;
      }
      return [P + l.origin_id, l.origin_slot];
    };

    for (const node of sub.nodes || []) {
      if (PASSTHRU.has(node.type)) continue;
      addNode(node, P, sResolve);
    }
    // 위 resolveLink 가 리터럴을 {__literal} 로 준 것을 실제 값으로 치환
    for (const id of Object.keys(graph)) {
      const inp = graph[id].inputs;
      for (const k of Object.keys(inp)) {
        if (inp[k] && typeof inp[k] === 'object' && !Array.isArray(inp[k]) && '__literal' in inp[k]) inp[k] = inp[k].__literal;
      }
    }

    // 서브그래프 출력 → 부모 소비자 재배선
    (sub.outputs || []).forEach((o, oi2) => {
      const inner = (o.linkIds || []).map((lid) => sLinks.get(lid)).find((l) => l && l.target_id === -20);
      if (!inner) return;
      const srcRef = [P + inner.origin_id, inner.origin_slot];
      // 부모 쪽: inst 의 출력 슬롯 oi2 를 쓰는 링크들
      for (const l of ui.links || []) {
        if (String(l[1]) === String(inst.id) && l[2] === oi2) {
          const consumer = graph[String(l[3])];
          if (!consumer) continue;
          const cNode = (ui.nodes || []).find((n) => String(n.id) === String(l[3]));
          const cInp = (cNode.inputs || [])[l[4]];
          if (cInp) consumer.inputs[cInp.name] = srcRef;
        }
      }
    });
  }

  for (const id of dropped) { delete graph[id]; warnings.push(`노드 ${id} 제거 — --unlink 로 리터럴 대체됨`); }
  return { graph, warnings };
}

if (require.main === module) {
  const [uiPath, oiPath, outPath, ...rest] = process.argv.slice(2);
  const unlinkArg = (rest.find((a) => a.startsWith('--unlink=')) || '').replace('--unlink=', '');
  const ui = JSON.parse(fs.readFileSync(uiPath, 'utf8'));
  const oi = JSON.parse(fs.readFileSync(oiPath, 'utf8'));
  const { graph, warnings } = convert(ui, oi, { unlink: unlinkArg ? unlinkArg.split(',') : [] });
  fs.writeFileSync(outPath, JSON.stringify(graph, null, 2), 'utf8');
  console.log(`노드 ${Object.keys(graph).length}개 → ${outPath}`);
  if (warnings.length) { console.log('경고:'); for (const w of warnings) console.log('  -', w); }
}
module.exports = { convert };
