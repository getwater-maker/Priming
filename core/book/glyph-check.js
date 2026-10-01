'use strict';
/**
 * glyph-check.js — 📝 글꼴에 없는 글자 찾기(삼국지 R12 · 로이 2026-10-01 「槳 한 글자만 굵은 고딕으로 튄다」)
 *   Chromium 은 글자마다 글꼴 목록을 앞에서부터 훑어 「그 글자를 가진 첫 글꼴」을 쓰고, 목록 끝까지 없으면 **시스템 대체 글꼴(고딕)** 이 그린다.
 *   조판 때 원고 글자 중 목록의 어느 글꼴에도 없는 글자를 알려 준다. 판정은 출판 세션의 글리프검사.py 와 같다
 *   (KoPub 바탕 Light → Noto Serif KR → 나눔명조 → 바탕(Windows) → 한자 보강 자리 → 못 찾으면 「시스템 대체」).
 *   TTF/TTC 의 cmap(format 4·12)을 직접 읽는다 — 의존성 추가 없음. 결과는 파일별로 캐시(수 MB 글꼴을 매번 읽지 않는다).
 */
const fs = require('fs');
const path = require('path');

function _cmapOffsets(buf, base) {
  // base = sfnt 시작 위치(TTC 면 첫 글꼴의 오프셋)
  const n = buf.readUInt16BE(base + 4);
  for (let i = 0; i < n; i++) {
    const e = base + 12 + i * 16;
    if (buf.toString('latin1', e, e + 4) === 'cmap') return buf.readUInt32BE(e + 8);
  }
  return -1;
}
/** 파일 → Set<codepoint> (읽을 수 없으면 null) */
function readCmap(file) {
  try {
    const buf = fs.readFileSync(file);
    let base = 0;
    if (buf.toString('latin1', 0, 4) === 'ttcf') base = buf.readUInt32BE(12);   // TTC — 첫 글꼴
    const off = _cmapOffsets(buf, base);
    if (off < 0) return null;
    const nt = buf.readUInt16BE(off + 2);
    const subs = [];
    for (let i = 0; i < nt; i++) {
      const p = off + 4 + i * 8;
      subs.push({ pid: buf.readUInt16BE(p), eid: buf.readUInt16BE(p + 2), o: off + buf.readUInt32BE(p + 4) });
    }
    // 유니코드 표만(플랫폼 0 · 3/1 · 3/10) — 12(전 범위) 우선
    const pick = (f) => subs.filter((s) => (s.pid === 0 || (s.pid === 3 && (s.eid === 1 || s.eid === 10))) && buf.readUInt16BE(s.o) === f);
    const set = new Set();
    for (const s of pick(12)) {
      const ng = buf.readUInt32BE(s.o + 12);
      for (let g = 0; g < ng; g++) {
        const q = s.o + 16 + g * 12;
        const a = buf.readUInt32BE(q), b = buf.readUInt32BE(q + 4);
        for (let c = a; c <= b && c - a < 0x20000; c++) set.add(c);
      }
    }
    for (const s of pick(4)) {
      const segX2 = buf.readUInt16BE(s.o + 6), seg = segX2 / 2;
      const endO = s.o + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
      for (let i = 0; i < seg; i++) {
        const end = buf.readUInt16BE(endO + i * 2), start = buf.readUInt16BE(startO + i * 2);
        const delta = buf.readInt16BE(deltaO + i * 2), ro = buf.readUInt16BE(rangeO + i * 2);
        if (start === 0xFFFF) continue;
        for (let c = start; c <= end; c++) {
          let gid;
          if (ro === 0) gid = (c + delta) & 0xFFFF;
          else {
            const gp = rangeO + i * 2 + ro + (c - start) * 2;
            if (gp + 2 > buf.length) continue;
            gid = buf.readUInt16BE(gp); if (gid) gid = (gid + delta) & 0xFFFF;
          }
          if (gid) set.add(c);
        }
      }
    }
    return set.size ? set : null;
  } catch (_) { return null; }
}
const _cache = new Map();
function cmapOf(file) {
  let st; try { st = fs.statSync(file); } catch (_) { return null; }
  const k = file + '|' + st.size + '|' + Math.round(st.mtimeMs);
  if (!_cache.has(k)) _cache.set(k, readCmap(file));
  return _cache.get(k);
}

// 글꼴이 없어도 되는 글자(제어·공백·서식) — 눈에 안 보이거나 브라우저가 처리한다
const IGNORABLE = new Set([...Array.from({ length: 0x20 }, (_, i) => i), 0x7F, 0xA0, 0x200B, 0x200C, 0x200D, 0xFEFF, 0xFE0F, 0xFE0E]);

/** 글꼴 사슬 — 이름 목록과 파일 후보. 파일이 없으면(예: 한자 보강 자리) 그 칸은 비어 있다. */
function defaultChain(fontDir, win = process.platform === 'win32') {
  const W = win ? 'C:/Windows/Fonts/' : '';
  const chain = [
    ['KoPub월드 바탕(Light)', [path.join(fontDir, 'KoPubWorld-Batang-Light.ttf')]],
    ['Noto Serif KR(Light)', [path.join(fontDir, 'NotoSerifKR-Light.ttf')]],
    ['나눔명조', [path.join(fontDir, 'NanumMyeongjo-Regular.ttf')]],
  ];
  if (win) chain.push(['바탕(Windows)', [W + 'batang.ttc']]);
  chain.push(['한자 보강 명조', [path.join(fontDir, 'HanjaSerif-Light.ttf')]]);   // 파일이 있을 때만 — 승인 전엔 비어 있다
  return chain;
}

/**
 * 텍스트 → { missing:[{ch, cp, n}], checked, chain:[이름…] } — 사슬 어디에도 없는 글자(= 시스템 대체로 튄다).
 *   firstLimit: 맨 앞 글꼴(본문)에 없는 글자 수도 함께 센다(참고).
 */
function missingGlyphs(text, chain) {
  const maps = chain.map(([name, files]) => ({ name, set: files.map(cmapOf).find(Boolean) || null }));
  const have = maps.filter((m) => m.set);
  const seen = new Map();
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80 || IGNORABLE.has(cp)) continue;
    seen.set(ch, (seen.get(ch) || 0) + 1);
  }
  const missing = [];
  let notInFirst = 0;
  for (const [ch, n] of seen) {
    const cp = ch.codePointAt(0);
    if (have[0] && !have[0].set.has(cp)) notInFirst++;
    if (!have.some((m) => m.set.has(cp))) missing.push({ ch, cp, n });
  }
  missing.sort((a, b) => b.n - a.n);
  return { missing, checked: seen.size, notInFirst, chain: have.map((m) => m.name), unreadable: maps.filter((m) => !m.set).map((m) => m.name) };
}
/** 조판 HTML 에서 보이는 글자만(태그·style·script 제거) */
function visibleText(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]*>/g, ' ');
}
function formatWarning(r) {
  if (!r.missing.length) return '';
  const list = r.missing.slice(0, 12).map((m) => `${m.ch}(U+${m.cp.toString(16).toUpperCase().padStart(4, '0')}${m.n > 1 ? ' ×' + m.n : ''})`).join(' ');
  return `⚠ 글꼴에 없는 글자 ${r.missing.length}종: ${list}${r.missing.length > 12 ? ' …' : ''} — 시스템 대체 글꼴(고딕)로 보입니다. 한국 정자(예: 愼)로 바꾸거나 한자 보강 명조 글꼴이 필요합니다`;
}
module.exports = { readCmap, cmapOf, defaultChain, missingGlyphs, visibleText, formatWarning, IGNORABLE };
