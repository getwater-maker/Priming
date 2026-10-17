'use strict';
// node test/log-scrub.test.js — 🔐 밖으로 보내는 로그에서 비밀·개인정보 지우기(core/log-scrub · v0.9.26)
const { scrub } = require('../core/log-scrub');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const gone = (input, secret, m) => { const out = scrub(input); ok(!out.includes(secret), m + ' → ' + out); };

console.log('[1] 키·토큰');
gone('Claude 키 sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx 로 호출', 'AbCdEfGhIjKlMnOp', 'Claude 키');
gone('gemini key=AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStU', 'AIzaSyA1b2C3', 'Gemini 키');
gone('hf_AbCdEfGhIjKlMnOpQrStUvWxYz 로그인', 'hf_AbCdEf', 'HF 토큰');
gone('키 sb_secret_AbCdEfGhIjKlMnOp12345 실림', 'sb_secret_AbCd', 'Supabase 비밀 키');
gone('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123 토큰', 'ghp_AbCd', 'GitHub 토큰');
gone('Authorization: Bearer abcDEF123.ghiJKL456-xyz', 'abcDEF123', 'Bearer 헤더');
gone('X-API-Key: s3cr3tvalue99', 's3cr3tvalue99', 'X-API-Key 헤더');
gone('password=hunter2pass 로 로그인', 'hunter2pass', 'password=');
gone('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U 끝', 'dozjgNryP4J3', 'JWT');
gone('무명 키 Zx9QwErTy7UiOpAsDfGh1JkLzXcVbNm2QwErTy 실패', 'Zx9QwErTy7UiOpAsDfGh1', '이름 없는 긴 키');

console.log('[2] 개인정보');
gone('계정 dabarchurch@getwater.kr 로 연결', 'dabarchurch@getwater.kr', '이메일');
gone('연락처 010-1234-5678', '1234-5678', '휴대폰');
gone('C:\\Users\\Pink-Desktop\\.priming-maker\\logs', 'Pink-Desktop', '윈도우 사용자 폴더');
gone('C:/Users/홍길동/Downloads/a.mp3', '홍길동', '슬래시 꼴 사용자 폴더');

console.log('[3] 남겨야 할 것(판정력 — 지나치게 지우지 않는다)');
const keep = (s, m) => ok(scrub(s) === s, m + ' → ' + scrub(s));
keep('✗ 실패: [고전_1019] 노생거 사원 1부 — G12 이미지 생성 실패', '대본 이름·그룹 번호');
keep('D:\\## 아도나이로이\\99_썸네일\\01_고전이야기 열기', '작업 폴더 경로');
keep('⚡ 전체 제작 완료 (TTS 12.3s · 이미지 45.6s)', '숫자 시간');
keep('v0.9.26 시작 · 문장 480개', '버전·개수');
keep('1577-1000 으로 전화', '대표번호(휴대폰 꼴 아님)');
console.log('[4] 🎬 YouTube 에서 받은 값(채널 이름·영상 제목·재생목록)은 지운다 — 그 밖 줄은 그대로');
const yt = (s, gone_, m) => { const r = scrub(s); ok(!r.includes(gone_), m + ' → ' + r); };
yt('⬆ 유튜브 업로드 시작 — 「언니네 채널」 · 비공개 · 제목 「노생거 사원 1부」', '언니네 채널', '연결 채널 이름');
yt('⬆ 유튜브 업로드 시작 — 「언니네 채널」 · 비공개 · 제목 「노생거 사원 1부」', '노생거 사원 1부', '영상 제목');
yt('✅ 유튜브 업로드 완료 — 비공개 · https://youtu.be/AbCdEfGhIjK (12초)', 'AbCdEfGhIjK', '영상 주소 ID');
yt('   고정댓글·A/B·종료화면은 Studio 에서: https://studio.youtube.com/video/AbCdEfGhIjK/edit', 'AbCdEfGhIjK', 'Studio 주소 ID');
yt('⏳ 유튜브 업로드 대기 — 앞에 2건 (노생거 사원 2부)', '노생거 사원 2부', '대기 줄의 제목');
yt('✅ 유튜브 채널 연결됨 — 언니네 채널', '언니네 채널', '채널 연결 줄');
yt('   ⚠ 재생목록 — 이 채널에 「없는 목록」 재생목록이 없습니다 (있는 목록: 노생거 사원 · 작가와 고전)', '작가와 고전', '재생목록 이름 목록');
yt('🧷 업로드 마무리 — 「노생거 사원 1부」 · 앱 처리 2', '노생거 사원 1부', '마무리 제목');
yt('⏭ 유튜브 업로드 건너뜀 — 「노생거 사원 1부」: 같은 제목 → https://youtu.be/AbCdEfGhIjK', '노생거 사원 1부', '중복 건너뜀 줄');
ok(/업로드 시작/.test(scrub('⬆ 유튜브 업로드 시작 — 「x」')) && /^   ✅ 썸네일 A/.test(scrub('   ✅ 썸네일 A — [서재_1024] 썸네일_A.png')), '판정력: 유튜브 줄의 흐름은 남고, 유튜브 아닌 줄은 안 건드린다');
keep('✗ 실패: 「노생거 사원」 이미지 생성 실패', '유튜브 아닌 줄의 「」 는 그대로');

ok(scrub(null) === '' && scrub(undefined) === '', 'null·undefined → 빈 글');
const s1 = scrub('C:\\Users\\Pink-Desktop\\x');
ok(s1 === '~\\x', '사용자 폴더는 ~ 로 바뀌고 뒤 경로는 남는다: ' + s1);

console.log(`\n${fail ? '❌' : '✅'} log-scrub — ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
