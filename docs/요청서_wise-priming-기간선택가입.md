# 요청서 — Priming 가입할 때 기간 고르기 → 입금 → 관리자 「승인」 한 번 (2026-11-05)

> 보내는 곳: Priming 세션(`D:\Priming`) → 받는 곳: wise-priming 세션(`D:\wise-priming`) · 로이 결정 2026-11-05(오후)
> **이 요청서가 같은 날 오전의 [`요청서_wise-priming-기간결제.md`](요청서_wise-priming-기간결제.md)를 대신한다.** 서버 설계의 뼈대(기간을 여는 함수 하나 · 신청 순간 값 복사 · 카드는 자리만)는 그대로 가져오고, 바뀐 점은 셋이다:
> ① 기간 고르기와 입금 안내를 **사이트가 아니라 앱 안**에서 한다(사이트 신청 화면은 선택) ② 기간은 **1·3·6·12개월 네 가지 고정**, 금액만 관리자가 정한다 ③ **가입 코드는 앱에 남는다**(「코드가 있으신가요?」로 접어 둠 · 이벤트·무료 체험용 · `priming_redeem_code` 그대로).
> 앞 요청 [`요청서_wise-priming-앱가입.md`](요청서_wise-priming-앱가입.md)(DB 035)는 그대로 쓴다.

## 왜

- 지금은 「가입 → 로이가 코드 만들기 → 메일 → 회원이 코드 입력」 — 로이: 너무 복잡하다.
- 원하는 것: **회원은 가입할 때 기간을 고르고 → 앱이 보여 준 계좌로 입금 → 관리자가 사이트에서 「승인」 한 번 → 앱이 곧바로 열린다.**

## 회원 흐름 (앱)

1. 앱 로그인 화면 「회원가입」 — 이메일 · 비밀번호 + **기간 고르기(1·3·6·12개월, 금액은 서버 값 그대로 표시)**. 구글로 들어온 사람은 로그인 직후 같은 고르기 화면이 나온다.
2. 가입(세션 생김) 직후 앱이 `priming_apply(p_months)` 를 부른다 → 신청서 `pending`.
   - 이메일 확인이 켜져 있어 세션이 없으면, 앱이 고른 기간을 기억했다가 첫 로그인 뒤에 신청한다.
3. 앱은 **「승인 대기」 화면** — 기간 · 금액 · **계좌(은행·번호·예금주)** · **입금자명 규칙** · 「다시 확인」 단추 · 30초마다 자동 확인 · 「기간 바꾸기」.
   - 이 값은 전부 `priming_application_mine()` 로 받는다. ⛔ 앱·저장소에 계좌번호·금액을 적지 않는다.
4. 관리자가 승인하면 다음 확인 때 `priming_license` 가 `ok:true` → 앱이 바로 열린다.
5. 거절되면 앱에 「승인되지 않았습니다 — (관리자 메모)」 + 다시 고르기.

## 서버에 만들어 줄 것

### 테이블 (이름은 서버 세션이 정해도 된다 — 아래 RPC 응답 꼴만 지켜 달라)

- `app_plans(months int primary key check (months in (1,3,6,12)), price_krw int, points int default 100, tier text default 'lite', on_sale boolean default false, updated_at)`
  - 네 줄을 미리 넣는다(`on_sale=false`). 관리자 화면에서 금액·크레딧·판매 여부를 고친다. **금액은 여기에만** 있다.
  - 일수 = `months * 30`? 또는 달력 개월(`make_interval(months => n)`)? → **달력 개월을 권한다**(회원이 「3개월」이라 읽는 그대로). 서버가 정해 회신.
- `app_billing(id = 1 한 줄, bank_name, account_no, holder, depositor_rule text, updated_at)` — 관리자 화면에서 고친다. 입금자명 규칙 기본 문구 제안: 「가입 이메일 @ 앞부분」(강의와 같게 · 강제하지 않는다).
- `app_applications(id bigserial, user_id, months, price_krw, points, tier, method text default 'bank' check (method in ('bank','card')), status text check (status in ('pending','approved','rejected','canceled')), depositor text, created_at, decided_at, decided_by, admin_note, pg_tid)`
  - **신청 순간의 기간·금액·크레딧을 복사**해 둔다(나중에 금액을 바꿔도 이미 한 신청은 그대로).
  - 한 사람에 `pending` 은 하나만(부분 유일 인덱스) — 다시 신청하면 그 행의 기간·금액을 고쳐 쓴다.

### 기간을 여는 함수는 하나 (🔴 중요)

- 내부 함수 예) `_priming_grant(p_uid, p_interval interval, p_points int, p_tier text, p_note text)` — 지금 `priming_redeem_code` 안의 「enrollments 만들기 / 유효하면 만료일 뒤로 연장 / 제한 없음 회원은 그대로 / `_priming_points_credit`」를 **여기로 옮기고**, 코드 사용 · 관리자 승인 · (나중) 카드 승인 세 곳이 이것만 부른다. ⛔ 기간 계산을 세 곳에 따로 쓰지 말 것.

### RPC — 앱이 부르는 것 (토큰 + 공개 키 · security definer)

| RPC | 누가 | 돌려줌 |
|---|---|---|
| `priming_plans()` | **anon 도 가능**(가입 전 화면에 금액을 보여야 한다) | `{ ok:true, plans:[{ months, price_krw, on_sale }] }` — 판매 중인 것만 줘도 된다 |
| `priming_apply(p_months int)` | 로그인 회원 | `{ ok:true, application:{…아래 꼴} }` · 실패 `{ ok:false, reason }` — `no_login` · `bad_months` · `not_on_sale` · `already_member`(제한 없음 회원·관리자) · `rate_limited`(선택) |
| `priming_application_mine()` | 로그인 회원 | `{ ok:true, application: null 또는 {…}, bank: {bank_name, account_no, holder} 또는 null, depositor_rule }` — **`bank` 는 상태가 `pending` 일 때만** 싣는다 |

`application` 꼴: `{ id, months, price_krw, status:'pending'|'approved'|'rejected'|'canceled', depositor, created_at, decided_at, admin_note }` — `application_mine` 은 **가장 최근 한 건**.

- 이미 유효한 회원이 다시 신청 = **연장 신청**으로 받아 달라(만료가 다가온 회원이 앱 「👤 계정」에서 연장할 자리 — 앱은 이번엔 만료·회원 아님 화면에서만 부른다).

### RPC — 관리자 화면

- `admin_priming_applications_list(p_status text default null, p_limit int default 300)` — 신청 시각(KST 표시) · 이메일 · 기간 · 금액 · 입금자명 · 상태.
- `admin_priming_application_approve(p_id)` — 관리자만 · **`pending` 일 때만** · 행 잠금으로 두 번 눌러도 기간이 두 번 붙지 않게 → `_priming_grant` → `approved`.
- `admin_priming_application_reject(p_id, p_note)` — 입금이 확인되지 않음 등 · 메모는 회원 앱에 그대로 보인다.
- `admin_priming_application_cancel(p_id, p_note)` — 회원이 취소를 원함 · 잘못된 신청(`pending` 만).
- `admin_priming_plans_save(...)` · `admin_priming_billing_save(...)` — 기간별 금액·크레딧·판매 여부 · 계좌·예금주·입금자명 규칙.

### 관리자 화면 「Priming 앱」 탭

- **「이용 신청」**(가입 코드 탭 옆): 목록 + 줄마다 **「승인」**(확인창 한 번 — 「입금을 확인했습니까? 이메일 · N개월 · 금액」) · 「거절」(메모) · 「취소」(메모). 위에 대기 건수 배지.
- **「요금·계좌」**: 1·3·6·12개월 금액 · 크레딧 · 판매 켬/끔 · 은행·계좌·예금주·입금자명 규칙.
- 7일 지난 `pending` 은 「기한 지남」으로 **보이게만**(자동 삭제·자동 거절 안 함 — 늦은 입금도 그대로 승인할 수 있게).

## 결정해 달라는 두 가지 — Priming 쪽 제안

1. **`priming_license` 의 `not_member` 응답에 대기 신청을 실을까?** → **싣지 않는 쪽을 제안한다.** 앱은 `not_member`/`expired` 일 때만 `priming_application_mine()` 을 따로 부른다. 까닭: `priming_license` 는 1분마다 불리는 가벼운 판정이라 계좌 정보를 섞지 않는 게 낫고, 새 RPC 가 없을 때(404)를 앱이 깔끔하게 알아챌 수 있다(→ 예전 「가입 코드」 화면으로 떨어진다).
2. **기본 무상 크레딧(100)은 언제?** → **승인 시점**에 `app_plans.points`(기본 100)만큼 `_priming_grant` 가 넣는 쪽을 제안한다. 가입만으로 주면 공짜 계정을 여러 개 만들어 받을 수 있다. 가입 코드는 지금처럼 코드에 적힌 크레딧.

## 카드(나중) — 자리만

- 같은 `app_applications` 행에 `method='card'`. 결제 대행사 승인 알림(웹훅) 경로 하나 → 서명 검증 → 금액이 신청서와 같은지 → `approved` + `_priming_grant`(관리자 승인과 같은 길). 앱은 바뀌지 않는다(「다시 확인」이 곧바로 열린다). 대행사는 로이가 정한 뒤 따로 요청한다.

## 앱이 한 것 (Priming v1.0.32 · 서버보다 먼저 배포해도 안전)

- `core/license`: `plans()` · `apply(months)` · `applicationMine()` — 새 RPC 가 **404 면 `unavailable`** 로 보고, 로그인 화면은 **예전 「가입 코드」 흐름 그대로**(코드 칸이 펼쳐져 있음) 보여 준다.
- 로그인 화면: 가입 폼에 기간 고르기(서버 금액) · 「코드가 있으신가요?」 접기 · 승인 대기 화면(계좌·금액·입금자명 규칙 · 다시 확인 · 30초 자동 확인 · 기간 바꾸기) · 거절 안내.
- 시험: 이 PC 안 가짜 서버(`PM_LICENSE_API`)로 `test:license`.

## 회신해 달라

- 마이그레이션 파일 이름(로이가 SQL Editor 에서 실행) · RPC 이름·응답 꼴 최종본(위와 다르면) · 개월 계산 방식(달력 개월 / 30일) · `priming_plans` 를 anon 이 부를 수 있는지 · 관리자 화면 주소.
- 배포 순서: **앱이 먼저 나가도 깨지지 않는다**(404 → 옛 코드 흐름). 서버 SQL 실행 + 관리자 화면에 금액·계좌를 넣고 `on_sale` 을 켜는 순간 앱 화면이 새 흐름으로 바뀐다.
