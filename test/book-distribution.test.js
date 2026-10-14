'use strict';
// 📊 유통 현황(2026-10-14) — core/book/retail-status.js + 부크크 화면 읽기는 읽기 전용
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.PRIMING_DIST_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dist-')), 'd.json');
const RS = require('../core/book/retail-status');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗ ' + m); } };

// 로이 스크린샷(2026-10-14 bookRetail) 글자 배열
const CARD = `확인중
스콘 서점 판매 및 유통신청
도서정보
저자정보
도서번호
642281
표지
삼국지 2
구분
전자도서
카테고리
고전 문학
저자명
나관중 지음, 로이 옮김
신청
2026.10.13
최종
2026.10.13
도서가 정상적으로 부크크 서점 입점 승인되어, 스콘 외부유통 판매신청이 정상적으로 제출되었습니다.
심사일까지 신청일로부터 최장 4주 이내 소요될 수 있습니다.
제출취소`;
const it = RS.parseCard(CARD);
ok(it && it.no === '642281' && it.title === '삼국지 2' && it.type === '전자도서' && it.category === '고전 문학', '도서번호·도서명·구분·카테고리');
ok(it.status === '확인중' && it.kind === 'progress' && it.retailer === '스콘', '상태·유통처(스콘)');
ok(it.applied === '2026.10.13' && it.final === '2026.10.13' && /입점 승인되어/.test(it.message) && !/제출취소/.test(it.message), '신청·최종일 · 안내문(제출취소 버튼 글자 제외)');
ok(it.author === '나관중 지음, 로이 옮김', '저자명');
ok(RS.parseCard('아무 글') === null, '도서번호 없으면 카드가 아니다');
const rej = RS.parseCard(CARD.replace('확인중', '반려').replace('스콘', '교보문고').replace('642281', '5'));
ok(rej.kind === 'rejected' && rej.retailer === '교보문고', '반려 · 다른 유통처');
const items = RS.parseCards([{ text: CARD, links: [{ href: 'https://bookk.co.kr/x', text: 'a' }, { href: 'javascript:void(0)', text: 'b' }] }, { text: CARD }, { text: '없음' }]);
ok(items.length === 1 && items[0].links.length === 1, '같은 카드 중복 제거 · 링크는 http(s) 만');
ok(RS.isMine(it, ['삼국지 2 : 도원결의']) && RS.isMine(it, ['삼국지 2']) && !RS.isMine(it, ['삼국지 20 : 어쩌고']) && !RS.isMine(it, ['삼국지 1']), '도서명 맞춤(「삼국지 2 : …」 ↔ 「삼국지 2」 · 20권과 안 섞임)');
const sm = RS.summarize([{ kind: 'done' }, { kind: 'progress' }, { kind: 'rejected' }, { kind: 'rejected' }]);
ok(sm.done === 1 && sm.progress === 1 && sm.rejected === 2 && sm.total === 4, '요약');

// 저장 · 수동 기록
RS.saveItems(items, '2026-10-14T00:00:00.000Z');
ok(RS.load().items.length === 1 && RS.load().fetchedAt.startsWith('2026-10-14'), '저장·읽기');
RS.setManual('001_삼국지_제2권', 'kdp', { state: 'trying', note: '반려 사유' });
RS.setManual('001_삼국지_제2권', 'kdp', { link: 'https://www.amazon.com/dp/X' });
const m = RS.load().manual['001_삼국지_제2권'].kdp;
ok(m.state === 'trying' && m.link === 'https://www.amazon.com/dp/X' && m.note === '반려 사유', '수동 상태·링크·메모(부분 갱신)');
let threw = 0; for (const f of [() => RS.setManual('k', 'kdp', { state: '???' }), () => RS.setManual('k', 'kdp', { link: 'javascript:1' }), () => RS.setManual('k', 'x', {})]) { try { f(); } catch (_) { threw++; } }
ok(threw === 3, '잘못된 상태·링크·유통처는 거부');
ok(RS.load().items.length === 1, '수동 기록이 읽어 온 항목을 지우지 않는다');

// 🔴 읽기 전용 — 부크크 화면 읽기 함수는 클릭·입력·제출을 하지 않는다
const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'book', 'register-browser.js'), 'utf8');
const body = src.slice(src.indexOf('async function readBookkRetail'), src.indexOf('module.exports'));
ok(body.length > 500 && !/\.click\(|\.fill\(|\.check\(|\.selectOption\(|\.type\(|\.press\(|dispatchEvent|\.submit\(/.test(body.replace(/_clickNaverLogin\(page, log\)/g, '')), '유통 현황 읽기는 아무것도 누르지 않는다(로그인 화면의 네이버 버튼만 예외 — 기존 함수)');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
ok(/ipcMain\.handle\('book-distribution-refresh'/.test(main) && /_bookRegBusy = true/.test(main.slice(main.indexOf("'book-distribution-refresh'"), main.indexOf("'book-distribution-manual'"))), '새로고침은 등록 도우미 크롬과 동시에 돌지 않는다');

console.log(`book-distribution: ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
