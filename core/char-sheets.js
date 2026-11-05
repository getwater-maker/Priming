// core/char-sheets.js
// ─────────────────────────────────────────────────────────────────────────────
// 👤 캐릭터셋 보기(2.0 덧붙임4 ㊺ · v1.0.25) — **읽기만** 한다. 그리지도 · 지우지도 · 이름을 바꾸지도 않는다.
//   원천 = 대본 인물 카드(`char-refs.parseCards`) + <출력>/characters/ 의 그림 + 장면 배역(`char-refs.castFor`).
//   · 한 인물의 그림 = `<이름>.<확장자>`(인물 시트) · `<이름>.face.<확장자>`(Qwen 얼굴 시트) · `<이름>.<종류>.<확장자>`(앞으로의
//     캐릭터 셋 ㊳ — 예 expr = 표정 9칸 · body = 전신). 같은 이름 `.json` 옆 파일에 `engine` 이 있으면 그 이름을 보인다.
//   · 장면 = 그룹마다 castFor(낭독에 이름 + 그림 프롬프트에 그 성별의 사람) — 그림 엔진의 실제 참조(qwenCast·refGate)보다 넓다.
//   Node 전용(fs) — main 만 부른다(렌더러 번들에 넣지 않는다).
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const CR = require('./char-refs');

const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const KIND_LABEL = { sheet: '인물 시트', face: '얼굴 시트', expr: '표정 9칸', body: '전신' };

function _readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }

/** 한 인물의 그림 파일들 — [{kind, label, engine, path, mtimeMs}] (인물 시트 → 얼굴 → 나머지 이름순) */
function filesFor(outRoot, card, names) {
  const dir = CR.sheetDir(outRoot);
  const base = path.basename(CR.sheetBase(outRoot, card));
  const list = names || (() => { try { return fs.readdirSync(dir); } catch (_) { return []; } })();
  const out = [];
  for (const f of list) {
    const ext = path.extname(f).toLowerCase();
    if (!IMG_EXT.includes(ext)) continue;
    const stem = f.slice(0, -ext.length);
    let kind = null;
    if (stem === base) kind = 'sheet';
    else if (stem.startsWith(base + '.') && /^[a-z0-9_-]{1,20}$/i.test(stem.slice(base.length + 1))) kind = stem.slice(base.length + 1).toLowerCase();
    if (!kind) continue;
    const p = path.join(dir, f);
    let st = null; try { st = fs.statSync(p); } catch (_) { continue; }
    const side = _readJson(path.join(dir, stem + '.json'));
    let engine = side && side.engine ? String(side.engine) : '';
    if (!engine) {
      if (kind === 'face') engine = side ? '로컬 Qwen (앱이 그림)' : '바꿔 넣은 그림';
      else if (kind === 'sheet') engine = ext === '.png' ? '나노바나나 또는 클라우드 (앱이 그림)' : '바꿔 넣은 그림';
      else engine = '';
    }
    out.push({ kind, label: KIND_LABEL[kind] || kind, engine, path: p, mtimeMs: Math.round(st.mtimeMs), name: f });
  }
  const rank = (k) => (k === 'sheet' ? 0 : k === 'face' ? 1 : 2);
  return out.sort((a, b) => rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name));
}

function _narration(pr, g) {
  const byId = new Map((pr.sentences || []).map((s) => [s.id, s]));
  return (g.sentenceIds || []).map((id) => (byId.get(id) || {}).text || '').join(' ');
}

/**
 * @param {{outRoot:string, mdText:string, projects:Array}} a
 * @returns {{ok:boolean, dir:string, cards:Array<{name,gender,desc,files,scenes:number[]}>, byGroup:Object<string,string[]>, msg:string}}
 *   byGroup 열쇠 = `<shortsNum>:<그룹 번호>` → 그 장면 인물 이름(배역 순)
 */
function listCharSheets({ outRoot, mdText, projects }) {
  const cards = CR.parseCards(mdText || '');
  const dir = outRoot ? CR.sheetDir(outRoot) : '';
  if (!cards.length) return { ok: true, dir, cards: [], byGroup: {}, msg: '이 대본에는 인물 카드가 없습니다(메타 줄 「… 카드: 영어 묘사」)' };
  let names = [];
  try { names = outRoot ? fs.readdirSync(dir) : []; } catch (_) {}
  const scenes = new Map(cards.map((c) => [c.name, []]));
  const byGroup = {};
  for (const pr of projects || []) {
    for (const g of pr.groups || []) {
      const cast = CR.castFor(_narration(pr, g), g.imagePrompt || '', cards);
      if (!cast.length) continue;
      byGroup[`${pr.shortsNum}:${g.num}`] = cast.map((c) => c.name);
      for (const c of cast) scenes.get(c.name).push(g.num);
    }
  }
  const out = cards.map((c) => ({ name: c.name, gender: c.gender, desc: c.desc, files: outRoot ? filesFor(outRoot, c, names) : [], scenes: scenes.get(c.name) }));
  const nFiles = out.reduce((a, c) => a + c.files.length, 0);
  return { ok: true, dir, cards: out, byGroup, msg: nFiles ? '' : '아직 그린 인물 시트가 없습니다 — 인물 참조를 쓰는 그림 엔진으로 만들면 생깁니다' };
}

module.exports = { listCharSheets, filesFor, KIND_LABEL };
