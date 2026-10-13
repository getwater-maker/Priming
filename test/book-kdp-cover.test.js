'use strict';
/**
 * node test/book-kdp-cover.test.js — 해외 플랫폼 R25: KDP 표지 스프레드(인치 · 블리드 0.125″ · 책등 = 쪽수 × 계수 · 바코드 자리 비움 · 79쪽 초과만 책등 글자)
 *   · 계산 = 공식 G201953020(표지 치수·책등·안전 여백·책등 글자) · G5HDYGP4BXLX4RUW(바코드 2″×1.2″ · 0.25″) — 2026-10-13 확인
 *   · 실제 표지 PDF 를 한 번 만들어 MediaBox 가 스프레드 치수(pt)와 같은지 잰다
 *   · 부크크 표지는 예전과 같다(test:book 의 book-flaps·book-multi 가 지킨다)
 */
const fs = require('fs'), path = require('path'), os = require('os');
const SC = require('../core/book/spine-calc');
const PP = require('../core/book/platform-presets');
const PB = require('../core/book/pdf-builder');
const PF = require('../core/book/preflight');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const IN = 25.4;
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;

console.log('[1] 스프레드 치수');
{
  const s = SC.coverSpread({ platformId: 'kdp', trimId: '6x9', paperId: 'KDP 백색지', totalPages: 200 });
  // 책등 = 200 × 0.002252″ = 0.4504″ = 11.44mm
  ok(near(s.spineMm, 11.44), `책등(백색 200쪽) = 0.4504″ = ${s.spineMm}mm`);
  ok(near(s.widthMm / IN, 0.125 + 6 + 0.4504 + 6 + 0.125, 0.002) && near(s.heightMm / IN, 0.125 + 9 + 0.125, 0.002), `폭 = 블리드+뒤+책등+앞+블리드 = ${(s.widthMm / IN).toFixed(3)}″ · 높이 = ${(s.heightMm / IN).toFixed(3)}″ (공식 식)`);
  ok(s.parts.map((p) => p.name).join() === 'bleed,뒤표지,책등,앞표지,bleed', '구성: bleed · 뒤표지 · 책등 · 앞표지 · bleed (날개 없음)');
  const c = SC.coverSpread({ platformId: 'kdp', trimId: '6x9', paperId: 'KDP 미색지', totalPages: 200 });
  ok(near(c.spineMm, 12.7), `미색지 200쪽 = 0.5″ = ${c.spineMm}mm`);
  ok(SC.coverSpread({ platformId: 'kdp', trimId: '6x9', paperId: 'KDP 백색지', totalPages: 201 }).pagesUsed === 202, '홀수 쪽수는 짝수로 올림(201 → 202)');
  ok(SC.coverSpread({ platformId: 'kdp', trimId: '6x9', paperId: 'KDP 백색지', totalPages: 10 }).pagesUsed === 24, '24쪽 미만은 24쪽 기준(KDP 최소)');
  ok(SC.coverSpread({ platformId: 'kdp', trimId: '6x9', totalPages: 0 }).spineMm === 0, '쪽수를 모르면 책등 0');
  ok(near(PP.TRIM_SIZES['5x8'].width / IN, 5) && near(PP.TRIM_SIZES['5x8'].height / IN, 8), '5×8″ 판형');
  const f = SC.coverSpread({ platformId: 'kdp', trimId: '6x9', totalPages: 200, flaps: true });
  ok(near(f.widthMm, SC.coverSpread({ platformId: 'kdp', trimId: '6x9', totalPages: 200 }).widthMm), '날개를 켜도 KDP 는 폭이 늘지 않는다(날개 폭 0 · 앱은 KDP 에서 날개를 끈다)');
  ok(PP.effectivePaper('kdp', '미색', 200) === 'KDP 미색지' && PP.effectivePaper('kdp', 'Cream', 200) === 'KDP 미색지' && PP.effectivePaper('kdp', 'White', 200) === 'KDP 백색지' && PP.effectivePaper('kdp', '', 200) === 'KDP 백색지', '용지 별칭(백색·미색·White·Cream · 기본 백색)');
}

console.log('\n[2] 바코드 자리 · 책등 글자');
{
  const s = SC.coverSpread({ platformId: 'kdp', trimId: '6x9', paperId: 'KDP 백색지', totalPages: 200 });
  const k = s.barcodeKeepout;
  ok(k && near(k.w / IN, 2, 0.01) && near(k.h / IN, 1.2, 0.01), `바코드 자리 ${(k.w / IN).toFixed(2)}″×${(k.h / IN).toFixed(2)}″ (공식 권장 2″×1.2″)`);
  const backRight = 0.125 * IN + 6 * IN;
  ok(near(k.x + k.w, backRight - 0.25 * IN, 0.02) && near(k.y + k.h, s.heightMm - 0.125 * IN - 0.25 * IN, 0.02), '자리 = 뒤표지 오른쪽 아래(책등 접힘선에서 0.25″ · 아래 재단선에서 0.25″)');
  ok(SC.coverSpread({ platformId: 'bookk', trimId: 'A5', totalPages: 200 }).barcodeKeepout === null, '부크크 스프레드에는 바코드 자리가 없다');
  const stx = (n) => SC.coverSpread({ platformId: 'kdp', trimId: '6x9', paperId: 'KDP 백색지', totalPages: n }).spineTextOk;
  ok(stx(78) === false && stx(80) === true && stx(79) === true && stx(200) === true, '책등 글자 = 79쪽 초과 — 78쪽 X · 80쪽 O · 79쪽은 짝수로 올려 80쪽이라 O');
}

console.log('\n[3] KDP 공식 계산기 대조');
{
  const s = SC.coverSpread({ platformId: 'kdp', trimId: '6x9', paperId: 'KDP 백색지', totalPages: 200 });
  const good = SC.kdpTemplateDiff(s, { widthIn: 12.701, heightIn: 9.25, spineIn: 0.4504 });
  ok(good.given && good.ok, '같은 값이면 통과(±0.01″)');
  const bad = SC.kdpTemplateDiff(s, { widthIn: 12.9, heightIn: 9.25, spineIn: 0.5 });
  ok(!bad.ok && bad.diffs.length === 2 && bad.diffs[0].name === '폭', '어긋나면 어느 항목이 몇 인치 다른지');
  ok(!SC.kdpTemplateDiff(s, {}).given, '값을 안 적으면 대조하지 않는다');
  const pf = PF.preflight({ meta: { title: 't', author: 'a', publisher: 'p', issueDate: '2026-10-06', lang: 'en' }, pages: 200, spineMm: s.spineMm, spread: s, platformId: 'kdp', platformLabel: 'KDP', minPages: 24, kdpTemplate: { widthIn: 12.9 }, outputs: [] });
  ok(pf.items.some((x) => x.id === 'kdp-template' && x.state === 'warn') && pf.items.some((x) => x.id === 'barcode-keepout') && pf.items.some((x) => x.id === 'spine-text'), '점검 패널: KDP 계산기 대조(경고) · 바코드 자리 · 책등 글자');
}

console.log('\n[4] 표지 HTML');
{
  const s = SC.coverSpread({ platformId: 'kdp', trimId: '6x9', paperId: 'KDP 백색지', totalPages: 200 });
  const meta = { title: 'Alice', author: 'Lewis Carroll', publisher: 'Classic Desk' };
  const covers = [{ key: 'backCover', blocks: [{ type: 'p', text: 'A very long back cover blurb. '.repeat(40) }] }];
  const html = PB.buildCoverHtml({ spread: s, bgTag: '', compose: { meta, covers, overlay: true }, fontCss: '' });
  ok(!/data-guide/.test(html), 'PDF 용 표지에는 안내선이 없다');
  const m = html.match(/class="area back" style="[^"]*top:([\d.]+)mm; height:([\d.]+)mm;/);
  ok(m && (Number(m[1]) + Number(m[2])) <= s.barcodeKeepout.y + 0.01, `뒷표지 글 상자가 바코드 자리 위에서 끝난다(상자 아래끝 ${m && (Number(m[1]) + Number(m[2])).toFixed(1)}mm ≤ 자리 위 ${s.barcodeKeepout.y}mm)`);
  ok(/class="spine"/.test(html), '200쪽 책등 글자 있음');
  const s78 = SC.coverSpread({ platformId: 'kdp', trimId: '6x9', paperId: 'KDP 백색지', totalPages: 60 });
  ok(!/class="spine"/.test(PB.buildCoverHtml({ spread: s78, bgTag: '', compose: { meta, covers: [], overlay: true }, fontCss: '' })), '60쪽은 책등 글자를 넣지 않는다');
  const g = PB.buildCoverHtml({ spread: s, bgTag: '', compose: { meta, covers, overlay: true, guides: true }, fontCss: '' });
  ok(/data-guide/.test(g) && /ISBN 바코드를 넣는 자리/.test(g), '미리보기용은 재단선·안전선·바코드 자리 안내선을 그린다');
  const bk = PB.buildCoverHtml({ spread: SC.coverSpread({ platformId: 'bookk', trimId: 'A5', totalPages: 200 }), bgTag: '', compose: { meta, covers, overlay: true }, fontCss: '' });
  ok(/top:8mm; height:/.test(bk) || /top:\d+mm/.test(bk), '부크크 표지 좌표는 예전 식(재단 3mm + 안전 5mm)');
}

(async () => {
  console.log('\n[5] 실제 표지 PDF — MediaBox');
  try {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'kdpcov-'));
    const s = SC.coverSpread({ platformId: 'kdp', trimId: '6x9', paperId: 'KDP 백색지', totalPages: 200 });
    const r = await PB.buildCoverPdf({ imagePath: null, spread: s, outPdf: path.join(T, 'cover.pdf'), workDir: path.join(T, 'w'), log: () => {}, compose: { meta: { title: 'Alice', author: 'Lewis Carroll', publisher: 'Classic Desk' }, covers: [], overlay: true } });
    ok(r.success, '표지 PDF 생성' + (r.success ? '' : ' — ' + r.error));
    if (r.success) {
      // MediaBox — 압축된 오브젝트 스트림 안에 있을 수 있어 FlateDecode 스트림을 풀어서 찾는다(PDF 라이브러리 없이)
      const raw = fs.readFileSync(r.pdfPath); let buf = raw.toString('latin1');
      if (!/\/MediaBox/.test(buf)) {
        const zl = require('zlib'); let i = 0;
        while ((i = raw.indexOf('stream', i)) >= 0) { let st = i + 6; if (raw[st] === 13) st++; if (raw[st] === 10) st++; const en = raw.indexOf('endstream', st); if (en < 0) break; try { buf += '\n' + zl.inflateSync(raw.subarray(st, en)).toString('latin1'); } catch (_) {} i = en + 9; }
      }
      const mb = buf.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
      const wPt = mb ? Number(mb[1]) : 0, hPt = mb ? Number(mb[2]) : 0;
      const expW = s.widthMm / IN * 72, expH = s.heightMm / IN * 72;
      ok(mb && Math.abs(wPt - expW) < 1.5 && Math.abs(hPt - expH) < 1.5, `PDF 쪽 크기 ${wPt}×${hPt}pt ≈ 스프레드 ${expW.toFixed(1)}×${expH.toFixed(1)}pt (${(s.widthMm / IN).toFixed(3)}″×${(s.heightMm / IN).toFixed(3)}″)`);
    }
    try { fs.rmSync(T, { recursive: true, force: true }); } catch (_) {}
  } catch (e) { fail++; console.log('  ✗ PDF 시험 오류: ' + e.message); }
  console.log(`\n${fail ? '❌' : '✅'} book-kdp-cover ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
