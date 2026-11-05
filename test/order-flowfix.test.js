'use strict';
/**
 * node test/order-flowfix.test.js — 🤖 2.0 덧붙임5(흐름 점검 · 2026-11-05) 51 · 53 · 52
 *   51 `"beauty": false` → 그림체 문구에서 사람 마디를 뺀다(style-store.getPrompt 한 곳 · 그림 캐시 열쇠도 그때만 달라진다)
 *   53 `"quoteCard": { bg, font, accent, text }` → 대사 카드 모양(없으면 지금 고정 값 · 픽셀 확인은 test:nodirective [3])
 *   🔒 칸이 없으면 모두 예전과 같다(글 · 열쇠 · ASS 줄).
 */
const fs = require('fs'), os = require('os'), path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const OC = require('../core/order-contract');
const SS = require('../core/style-store');
const MC = require('../core/media-cache');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowfix-'));
const mkOrder = (extra) => {
  const md = path.join(tmp, 'a.md'); fs.writeFileSync(md, '# t\n');
  const f = path.join(tmp, `o${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify({ v: 1, script: 'a.md', channelId: 'UC1', primingChannel: 'x', voice: 'v', style: 'webtoon-illust', upload: { enabled: false }, ...extra }));
  return OC.readOrder(f);
};

console.log('[51] 그림체 사람 마디 끄기');
{
  const r0 = mkOrder({});
  ok(r0.ok && r0.order.beauty === true && r0.order.quoteCard === null, '칸이 없으면 beauty=true · quoteCard=null(지금과 같음)');
  const r1 = mkOrder({ beauty: false });
  ok(r1.ok && r1.order.beauty === false, '"beauty": false 를 받는다');
  const r2 = mkOrder({ beauty: 'no' });
  ok(!r2.ok && /beauty/.test(r2.errors.join()), 'true/false 가 아니면 거절(조용히 무시하지 않음)');
  const base = SS.getPrompt('webtoon-illust');
  ok(/beautiful women and handsome men/.test(base) && SS.orderStyleKey() === '', '기본(꺼짐) = 그림체 글 그대로');
  const k0 = MC.imageKey('p', 'webtoon-illust', '16:9', 'local:qwen-2-1');
  SS.setOrderStyle({ noPeople: true });
  const off = SS.getPrompt('webtoon-illust');
  ok(!/women|handsome|faces/.test(off) && /prefer bright and well-lit imagery/.test(off) && /webtoon illustration style/.test(off), '켜면 사람 마디만 빠지고 「bright and well-lit」 · 화풍은 남는다');
  const k1 = MC.imageKey('p', 'webtoon-illust', '16:9', 'local:qwen-2-1');
  ok(k1 !== k0, '켜진 동안 그림 캐시 열쇠가 달라진다(미남미녀 그림이 캐시로 되살아나지 않게)');
  for (const s of SS.BUILT_IN_STYLES) {
    const p = SS.getPrompt(s.id);
    if (p && /beautiful women and handsome men/.test(p)) { ok(false, `${s.id} 에 미남미녀가 남았다`); break; }
  }
  ok(true, '씨앗 그림체 모두에서 미남미녀 마디가 빠진다');
  const P = require('../core/pipeline');
  const g1 = 'A wide stone courtyard of the ancient Jerusalem temple at mid-morning, a row of bronze trumpet-shaped offering chests along a pale limestone wall, warm sunlight.';
  ok(!P.PERSON_RE.test(P.buildImagePrompt(off, g1).replace(/no text|no watermark/g, '')) || !/modest/i.test(P.buildImagePrompt(off, g1)), '사람 없는 장면엔 옷차림 문구도 붙지 않는다(사람을 부르지 않는다)');
  SS.setOrderStyle({ noPeople: true, drop: ['Korean  manhwa INSPIRED'] });
  const off2 = SS.getPrompt('webtoon-illust');
  ok(!/manhwa/i.test(off2) && !/handsome/.test(off2) && /detailed background/.test(off2), 'styleDrop = 적힌 마디만 더 뺀다(대소문자 · 빈칸 무시)');
  ok(SS.trimStyle(base, { drop: ['no such clause'] }).missing.length === 1, '그림체에 없는 마디는 missing(부르는 쪽이 거절)');
  SS.setOrderStyle(null);
  ok(SS.getPrompt('webtoon-illust') === base && MC.imageKey('p', 'webtoon-illust', '16:9', 'local:qwen-2-1') === k0, '끄면 글 · 열쇠가 예전과 한 글자도 같다');
  const m = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const blk = m.slice(m.indexOf('async function runOrderHeadless'), m.indexOf('// 미리보기 오디오 — 파일을 base64'));
  ok(/SSb\.setOrderStyle\(so\)/.test(blk) && /finally \{[\s\S]{0,200}setOrderStyle\(null\)/.test(blk) && /styleTrim\.missing\.length\) return finish\(OC\.STATUS\.reject/.test(blk), '켜는 곳 = runOrderHeadless 한 곳 · 없는 마디는 거절 · finally 에서 끈다');
  ok((m.match(/setOrderStyle\(/g) || []).length === 2, 'setOrderStyle 은 main 에 켜기 · 끄기 두 번만');
  ok(/res\.log\.styleTrim = styleTrim \?/.test(blk), '결과서 log.styleTrim');
  const r3 = mkOrder({ styleDrop: ['a, b'] });
  ok(!r3.ok && /styleDrop/.test(r3.errors.join()), 'styleDrop 한 칸에 쉼표(마디 둘)면 거절');
}

console.log('[53] 대사 카드 모양');
{
  const nanum = path.join(__dirname, '..', 'assets', 'fonts', 'book', 'NanumMyeongjo-Bold.ttf');
  const q = OC.parseQuoteCard({ bg: '#1a2b3c', accent: 'C0A060', font: nanum });
  ok(!q.error && q.quoteCard.bg === '1A2B3C' && q.quoteCard.accent === 'C0A060' && q.quoteCard.text === null && q.quoteCard.fontName === 'NanumMyeongjo' && q.quoteCard.weight === 700, '색 · 글꼴(이름 · 굵기) 읽기');
  ok(/모르는 칸/.test(OC.parseQuoteCard({ color: '#000000' }).error), '모르는 칸 거절');
  ok(/비었습니다/.test(OC.parseQuoteCard({}).error), '빈 객체 거절');
  ok(/#RRGGBB/.test(OC.parseQuoteCard({ bg: 'red' }).error), '색 꼴이 틀리면 거절');
  ok(/한글이 없습니다/.test(OC.parseQuoteCard({ font: path.join(__dirname, '..', 'assets', 'fonts', 'book', 'CrimsonText-Bold.ttf') }).error), '한글 없는 글꼴 거절');
  ok(/없습니다/.test(OC.parseQuoteCard({ font: 'X:/없는/글꼴.ttf' }).error), '없는 글꼴 파일 거절');
  ok(!OC.parseQuoteCard({ font: 'Pretendard' }).quoteCard.fontFile, '"Pretendard" = 동봉 글꼴(지금 값)');
  const r = mkOrder({ quoteCard: { bg: '#102030' } });
  ok(r.ok && r.order.quoteCard && r.order.quoteCard.bg === '102030', '주문서에서 받는다');
  const VR = require('../core/vrew-render');
  const card = { kind: 'quote', t0: 0, t1: 4, speaker: '예수', trans: ['가난한 과부가'], orig: [] };
  const ramp = () => '', rel = (t) => Math.round(t * 1000);
  const a = VR.quoteEvents(card, 0, 4, '0:00:00.00', '0:00:04.00', ramp, rel).join('\n');
  const b = VR.quoteEvents({ ...card, qs: null }, 0, 4, '0:00:00.00', '0:00:04.00', ramp, rel).join('\n');
  ok(a === b && /\\fnPretendard/.test(a) && /&H131A21&/.test(a), '칸 없음 = 지금 값(Pretendard · #211A13 판)');
  const c = VR.quoteEvents({ ...card, qs: q.quoteCard }, 0, 4, '0:00:00.00', '0:00:04.00', ramp, rel).join('\n');
  ok(/&H3C2B1A&/.test(c) && /&H60A0C0&/.test(c) && /\\fnNanumMyeongjo/.test(c) && !/\\fnPretendard/.test(c), '칸 있음 = 판 · 강조 색 · 글꼴이 바뀐다');
  ok(/\\b0/.test(c) && !/\\b1/.test(c), '굵은 글꼴 파일이면 가짜 굵게를 겹치지 않는다');
  const m = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  ok(/c\.kind === 'quote' \? \{ \.\.\.c, qs: OR\.quoteCard \}/.test(m) && /\.\.\.\(qc \? \{ quoteCard:/.test(m), '주문 렌더에만 싣고(OR) 칸이 있을 때만 빌드 지문에 넣는다');
}

setTimeout(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail ? '❌' : '✅'} order-flowfix ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}, 100);
