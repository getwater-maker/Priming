# 요청서 — 구글 한 번 로그인(사이트·앱 공통) + 프라이밍·강의 교차 노출 (2026-10-23)

보내는 곳: Priming 세션(`D:\Priming`) → 받는 곳: wise-priming 세션(`D:\wise-priming`). 로이 결정(2026-10-23).

## 목표
- 판매 상품 둘: **① Priming 앱 ② 사이트의 강의**. 어느 쪽으로 가입했든 **같은 계정**이고, 앱에서는 강의를, 사이트에서는 Priming 을 **아직 안 가진 사람에게만** 보여 업셀이 되게 한다.
- 로그인이 최우선: **「구글로 계속하기」 버튼 하나로 가입과 로그인이 한 번에**, 로그아웃 전까지 유지. 사이트와 앱 모두.

## 앱이 하는 방식 (이미 만드는 중 — 서버 설정만 필요)
앱은 **브라우저 로그인 + 이 PC 로컬 주소로 돌아오기(PKCE)** 를 쓴다.
1. 앱이 `127.0.0.1:<포트>` 에 잠깐 서버를 열고 기본 브라우저로 `{SUPABASE}/auth/v1/authorize?provider=google&redirect_to=http://127.0.0.1:<포트>/cb&code_challenge=…&code_challenge_method=s256` 를 연다.
2. 구글 승인 뒤 Supabase 가 `http://127.0.0.1:<포트>/cb?code=…` 로 돌려보내고, 앱이 `POST /auth/v1/token?grant_type=pkce`(`auth_code`·`code_verifier`)로 세션을 받는다. 이후는 지금 이메일 로그인과 같다(암호화 저장 · refresh 로 자동 연장 · 로그아웃 전까지 유지).

## 서버에서 해 줄 것
1. **Supabase → Authentication → URL Configuration → Redirect URLs 에 추가** (앱은 아래 10개 포트 중 비어 있는 첫 포트를 쓴다 — 와일드카드가 확실히 먹으면 `http://127.0.0.1:*/**` 하나여도 됨, 먹는지 알려 달라):
   `http://127.0.0.1:53682/cb` … `http://127.0.0.1:53691/cb`
2. **구글 로그인이 사이트에서 이미 켜져 있는지 확인**(구글 Cloud OAuth 클라이언트의 「승인된 리디렉션 URI」는 Supabase 콜백 `…supabase.co/auth/v1/callback` 하나면 충분 — 앱 주소를 구글 쪽에 넣을 필요 없음).
3. **구글 가입자의 약관 동의**: 앱은 구글로 처음 들어온 직후 `accept_consents` 를 한 번 부른다(이메일 가입과 같음) — 앱 화면에 「계속하면 약관·개인정보 처리방침에 동의」 문구를 보인다. 사이트 `ConsentGate` 와 충돌이 없는지만 확인 부탁.
4. **RPC `priming_products()`** — 로그인 토큰으로 호출, 이 회원이 **무엇을 갖고 있는지**(앱 업셀용):
   ```
   { ok:true,
     priming: { owned:bool, expires_at:timestamptz|null },           -- priming-app 이용 중인지
     courses: [ { slug, title, owned:bool, url, summary? , expires_at? } ... ] }  -- 판매 중인 강의(공개 목록) + 이 회원이 수강 중인지
   ```
   - `url` 은 `https://www.primingwave.com/...` 만(앱이 그 호스트만 연다).
   - 판매 중이 아닌 강의는 제외 · 목록이 길면 앞 5개(앱이 3개까지 보여 줌).
   - 실패 시 `{ok:false}`. 앱은 이 RPC 가 없으면(404) 그냥 안내를 숨긴다.
5. **사이트 화면**: 로그인 회원 중 `priming.owned=false` 인 사람에게 Priming 앱 소개·가입 코드 안내 블록(마이페이지·강의 수강 화면·「내 기기」 등 자연스러운 자리) — 이미 쓰는 회원에게는 숨김. 반대로 앱 회원이 사이트에 오면 미수강 강의 노출.
6. **사이트 로그인 화면**: 「구글로 계속하기」를 맨 위 큰 버튼으로(이미 있으면 그대로) — 앱과 같은 계정임을 한 줄로 알려 준다(「앱과 같은 계정으로 로그인됩니다」).

## 답으로 받고 싶은 것
- Redirect URL 와일드카드 가능 여부 · 사이트 구글 로그인 활성 확인 · `priming_products` 최종 응답 꼴 · 마이그레이션 파일 이름(로이가 SQL Editor 에서 실행).
