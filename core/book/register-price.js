'use strict';
/**
 * register-price.js — 💾 종이책을 부크크에 신청할 때 4단계 「최종 정가」를 기록해 두고, 전자책 정가(종이책의 70%)의 근거로 쓴다.
 *   로이 2026-10-02: 「항상 종이책을 먼저 신청하고 진행 — 종이책의 가격을 가져와서 전자책의 가격을 산정」.
 *   종이책 정가는 원고 `> 정가:` 가 없으면 부크크가 쪽수로 정한 최소가격이라, 원고 값보다 **화면에서 읽은 값**이 정확하다.
 *   위치: <출력 루트>/.priming-register/paper-price.json  = { "<완성 파일 이름(권)>": { price, title, at } }
 */
const fs = require('fs');
const path = require('path');

const fileOf = (root) => path.join(root, '.priming-register', 'paper-price.json');
function _read(root) { try { const j = JSON.parse(fs.readFileSync(fileOf(root), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch (_) { return {}; } }

/** 기록(권 key 별로 덮어씀). 0 이하·숫자 아님은 무시. 반환: 기록된 값 또는 0 */
function savePaperPrice(root, key, price, title, now) {
  const n = Math.floor(Number(price) || 0);
  if (!root || !key || n <= 0) return 0;
  const all = _read(root);
  all[key] = { price: n, title: String(title || ''), at: new Date(now || Date.now()).toISOString() };
  fs.mkdirSync(path.dirname(fileOf(root)), { recursive: true });
  fs.writeFileSync(fileOf(root), JSON.stringify(all, null, 1), 'utf8');
  return n;
}
/** 읽기 → { price, title, at } 또는 null */
function loadPaperPrice(root, key) {
  const e = _read(root)[key];
  return e && Number(e.price) > 0 ? e : null;
}
/** 기록된 모든 권(최근 기록 먼저) → [{ key, price, at }] — 다른 권의 정가를 가져다 쓰도록 보여 줄 때 */
function listPaperPrices(root) {
  const all = _read(root);
  return Object.keys(all).filter((k) => Number(all[k] && all[k].price) > 0).map((k) => ({ key: k, price: Number(all[k].price), at: String(all[k].at || '') })).sort((a, b) => (a.at < b.at ? 1 : -1));
}
module.exports = { savePaperPrice, loadPaperPrice, listPaperPrices, fileOf };
