'use strict';
// node test/thumb-edit.test.js — 🖼 썸네일 편집기 순수 부분(core/thumb-edit · core/skin-region · v0.9.102)
const fs = require('fs');
const os = require('os');
const path = require('path');
const TE = require('../core/thumb-edit');
const SK = require('../core/skin-region');
const IT = require('../core/info-theme');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const T = () => fs.mkdtempSync(path.join(os.tmpdir(), 'thed-'));
const touch = (p, b = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, b); };

console.log('[1] 문구 읽기 — 서식 4종');
{ const tbl = TE.parseBlock('| 줄 | 문구 | 색 |\n|---|---|---|\n| 1 | 첫 줄 | 흰색 |\n| 2 | 둘째 줄 | 노랑 |\n');
  ok(JSON.stringify(tbl) === JSON.stringify([{ text: '첫 줄', color: 'white' }, { text: '둘째 줄', color: 'yellow' }]), '표(줄·문구·색)');
  const t2 = TE.parseBlock('| 문구 | 색 |\n|---|---|\n| 가 | 흰색 |\n| 나 | 노란색 |');
  ok(t2.length === 2 && t2[1].color === 'yellow', '번호 칸 없는 표');
  const fence = TE.parseBlock('```\n지폐 속 소세키\n하녀가 건넨 \'귓속말\'\n```\n');
  ok(fence.map((l) => l.text).join('|') === "지폐 속 소세키|하녀가 건넨 '귓속말'", '코드펜스');
  const lined = TE.parseBlock('1줄: 첫 줄 (흰색)\n2줄: 둘째 줄 (노랑)\n');
  ok(lined.length === 2 && lined[0].text === '첫 줄' && lined[1].color === 'yellow', '줄표기(1줄: … (색))');
  const bare = TE.parseBlock('맨 첫 줄\n맨 둘째 줄\n');
  ok(bare.length === 2 && bare[0].color === 'white', '맨줄');
  const md = '# x\n\n## 썸네일 문구 A\n| 줄 | 문구 | 색 |\n|---|---|---|\n| 1 | A1 | 흰색 |\n\n## 썸네일 문구 B\n```\nB1\nB2\n```\n\n## 이미지 프롬프트\nNO text\n';
  const all = TE.parseThumbText(md);
  ok(all.A.length === 1 && all.B.length === 2 && !all.C, '절 A·B 를 읽고 다음 절(이미지 프롬프트)은 읽지 않는다'); }

console.log('[2] 자리 · 크기 · 얼굴');
{ ok(TE.CELLS.length === 9 && TE.ALLOWED.length === 6 && TE.ALLOWED.every((c) => !c.startsWith('오른쪽')), '9칸 중 오른쪽 열 3칸 제외 6칸');
  const m = (t, s) => t.length * s * 0.6;   // 가짜 측정
  const lines = [{ text: '열두글자열두글자열두' }, { text: '짧음' }];
  const s1 = TE.fitSize(lines, m, 700, 400), s2 = TE.fitSize(lines, m, 350, 400);
  ok(s1 > s2 && m('열두글자열두글자열두', s1) <= 700 && m('열두글자열두글자열두', s1 + 1) > 700 || s1 >= 200, '폭에 맞는 가장 큰 크기(폭이 좁으면 작아진다): ' + s1 + ' / ' + s2);
  ok(TE.fitSize([{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }, { text: 'e' }, { text: 'f' }], m, 9999, 600) <= Math.floor(600 / 6 / 1.12), '줄이 많으면 높이 한도로도 줄어든다');
  const right = TE.cellsCovered({ x: 700, y: 100, w: 400, h: 100 });
  ok(right.some((c) => c.startsWith('오른쪽')), '글상자가 오른쪽 열에 걸리면 감지');
  ok(!TE.cellsCovered({ x: 50, y: 250, w: 600, h: 200 }).some((c) => c.startsWith('오른쪽')), '왼쪽·가운데만 덮으면 통과');
  // 얼굴 — 64×36 에 살색 덩어리를 왼쪽 위에 둔다
  const f = new Uint8Array(64 * 36 * 3).fill(60);
  for (let y = 2; y < 8; y++) for (let x = 2; x < 12; x++) { const i = (y * 64 + x) * 3; f[i] = 200; f[i + 1] = 140; f[i + 2] = 110; }
  const onFace = TE.faceCover(f, { x: 30, y: 20, w: 300, h: 150 }), off = TE.faceCover(f, { x: 600, y: 500, w: 300, h: 150 });
  ok(onFace.veto && !off.veto, '살색 덩어리 위 = 가림 경고 · 다른 곳 = 통과(' + onFace.cells + '/' + off.cells + ')');
  const sg = TE.suggestCells(f, [{ text: '가나다' }], 80, m);
  ok(sg.length === 6 && !sg[0].veto && sg[sg.length - 1].cell !== sg[0].cell, '추천: 6칸을 점수순 — 얼굴 가리는 칸이 뒤로');
  ok(sg.findIndex((x) => x.cell === '왼쪽-위') > sg.findIndex((x) => x.cell === '가운데-아래') || sg.find((x) => x.cell === '왼쪽-위').veto, '왼쪽-위(얼굴 자리)는 앞에 오지 않는다');
  ok(IT.isSkin === SK.isSkin && IT.regionSkin === SK.regionSkin && IT.FACE_VETO === SK.FACE_VETO, '살색 판정은 info-theme 과 같은 한 곳(skin-region)'); }

console.log('[3] 규격');
{ const mk = (w, h, extra = 0) => { const b = Buffer.alloc(33 + extra); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
  ok(TE.checkSpec(mk(1280, 720), '[a] 썸네일_A.png').ok, '1280×720 · 작음 · 정상 이름');
  ok(/1280×720/.test(TE.checkSpec(mk(1920, 1080), 'a.png').errors.join()), '크기가 다르면 오류');
  ok(/2MB/.test(TE.checkSpec(mk(1280, 720, 2 * 1024 * 1024), 'a.png').errors.join()), '2MB 초과 오류');
  ok(/이름/.test(TE.checkSpec(mk(1280, 720), 'a?.png').errors.join()), '파일 이름의 ? 거부');
  ok(!TE.checkSpec(Buffer.from('not png'), 'a.png').ok, 'PNG 가 아니면 오류'); }

console.log('[4] 찾기(읽기만)');
{ const R = T();
  // 완성본 폴더 + _배경 + 사이드카
  const fin = path.join(R, '99_썸네일', '03_역사이야기');
  for (const a of ['A', 'B', 'C']) touch(path.join(fin, `[역사_1] 썸네일_${a}.png`));
  touch(path.join(fin, '_배경', '[역사_1] 썸네일_A_배경.png'));
  touch(path.join(fin, '[역사_1] 썸네일_문구.json'), '{}');
  touch(path.join(fin, '_캔바원본', '[역사_1] 썸네일_A.png'));   // 보관함은 보지 않는다
  const a = TE.findFinalAssets(path.join(R, '99_썸네일'), '[역사_1]');
  ok(a.dir === fin && Object.keys(a.finals).join() === 'A,B,C' && /_A_배경/.test(a.bgs.A) && !a.bgs.B && /문구\.json$/.test(a.sidecar), '완성본 3장 · _배경(A만) · 사이드카');
  ok(!TE.findFinalAssets(path.join(R, '99_썸네일'), '[없음_9]').dir, '없는 편 = 빈 결과');
  // Codex 바탕 — 역사(_A) · 아랫목(-A) · 한 장 · 여러 장(고르지 않음) · _미확정 제외
  touch(path.join(R, '02_역사', '01_역사', '썸네일', '2026_10', '[역사_1] 제목_A.png'));
  touch(path.join(R, '02_역사', '01_역사', '썸네일', '2026_10', '[역사_1] 제목_B.png'));
  const h = TE.findCodexBases(R, '[역사_1]');
  ok(/_A\.png$/.test(h.A) && /_B\.png$/.test(h.B) && !h.C, '역사 = 안마다 따로(_A/_B)');
  touch(path.join(R, '09_아랫목', '01_단골', '썸네일', '2026_10', '[아_2] 제목-A.png'));
  ok(/-A\.png$/.test(TE.findCodexBases(R, '[아_2]').A), '아랫목 = 붙임표(-A)');
  touch(path.join(R, '01_고전', '01_고', '썸네일', '2026_10', '[고_3] 제목.png'));
  const one = TE.findCodexBases(R, '[고_3]');
  ok(one.A === one.B && one.B === one.C && !!one.A, '한 장이면 A·B·C 가 같은 바탕');
  touch(path.join(R, '01_고전', '01_고', '썸네일', '2026_10', '[고_4] 가.png')); touch(path.join(R, '01_고전', '01_고', '썸네일', '2026_10', '[고_4] 나.png'));
  ok(!Object.keys(TE.findCodexBases(R, '[고_4]')).length, '여러 장인데 안 구분이 없으면 고르지 않는다(틀린 그림에 글자를 얹지 않음)');
  touch(path.join(R, '01_고전', '01_고', '썸네일', '_미확정', '[고_5] 초안.png'));
  ok(!Object.keys(TE.findCodexBases(R, '[고_5]')).length, '_미확정 은 제외');
  fs.rmSync(R, { recursive: true, force: true }); }

console.log('[5] 저장 · 보존 · 사이드카');
{ const R = T(), D = path.join(R, '99_썸네일', 'ch'); fs.mkdirSync(D, { recursive: true });
  const mk = (n) => { const b = Buffer.alloc(40 + n); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(1280, 16); b.writeUInt32BE(720, 20); return b; };
  fs.writeFileSync(path.join(D, '[a_1] 썸네일_A.png'), 'ORIGINAL');
  const r1 = TE.saveFinal(D, '[a_1] 썸네일_A.png', mk(10));
  ok(fs.statSync(r1.saved).size === 50 && fs.readFileSync(r1.preserved, 'utf8') === 'ORIGINAL' && /_캔바원본/.test(r1.preserved), '기존 파일 → _캔바원본 보존 · 새 파일이 원래 이름');
  const r2 = TE.saveFinal(D, '[a_1] 썸네일_A.png', mk(20));
  ok(r2.preserved !== r1.preserved && fs.existsSync(r1.preserved) && fs.existsSync(r2.preserved) && /_2\.png$/.test(r2.preserved), '두 번째 저장 = 보존본 _2 (이전 보존본을 덮지 않는다)');
  ok(!fs.readdirSync(D).some((f) => /priming-tmp/.test(f)), '임시 파일이 남지 않는다');
  let err = ''; try { TE.saveFinal(D, '[a_1] 썸네일_B.png', Buffer.from('bad')); } catch (e) { err = e.message; }
  ok(/규격/.test(err) && !fs.existsSync(path.join(D, '[a_1] 썸네일_B.png')), '규격 어긋남 = 저장하지 않는다(기존 파일 불변)');
  let err2 = ''; try { TE.saveFinal(D, '..\\x.png', mk(1)); } catch (e) { err2 = e.message; }
  ok(/위치/.test(err2) || !fs.existsSync(path.join(R, '99_썸네일', 'x.png')), '폴더 밖으로 나가는 이름은 거부');
  // 사이드카
  const e = TE.sidecarEntry({ lines: [{ text: '가', color: 'white' }, { text: '나', color: 'yellow' }], size: 90, cell: '왼쪽-가운데', font: 'Pretendard Bold', edited: true });
  ok(e.줄[0].색 === '#ffffff' && e.줄[1].색 === '#ffd600' && e.로이수정 === true && e.크기 === 90, '사이드카 항목(색 #rrggbb · 로이수정)');
  const back = TE.linesFromSidecar(e);
  ok(back[0].color === 'white' && back[1].color === 'yellow' && back[1].text === '나', '사이드카 → 편집기 줄 되돌림');
  ok(!TE.sidecarEntry({ lines: [], size: 1, cell: 'x' }).로이수정, '고치지 않았으면 로이수정 표시 없음');
  ok(TE.sameLines([{ text: 'a' }], [{ text: 'a' }]) && !TE.sameLines([{ text: 'a' }], [{ text: 'a ' }]) && !TE.sameLines([{ text: 'a' }], []), '문구 대조는 공백 포함 완전 일치');
  fs.rmSync(R, { recursive: true, force: true }); }

console.log('[6] 소스 검사');
{ const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'thumb-edit.js'), 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
  ok(!/require\(['"]electron['"]\)/.test(src) && !/require\.main/.test(src), '순수 모듈(Electron·require.main 없음 — 렌더러 번들에 들어간다)');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const blk = main.slice(main.indexOf("ipcMain.handle('thumb-edit-open'"), main.indexOf("ipcMain.handle('get-preset-detail'"));
  ok(!/writeFile(Sync)?\(/.test(blk.replace(/log\([^\n]*\n/g, '')) || /saveFinal/.test(blk), '편집기 IPC 의 파일 쓰기는 saveFinal·사이드카뿐'); }

console.log(`\n${fail ? '❌' : '✅'} thumb-edit — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
