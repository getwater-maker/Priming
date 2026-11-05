# 요청서 — 업데이트 Worker 가 「로이판 / 판매판」을 나눠 주기 (2026-11-05)

보내는 곳: Priming 세션(`D:\Priming`) → 받는 곳: wise-priming 세션(`D:\wise-priming`). 로이 결정(2026-11-05) · 설계 정본 `docs/판나누기-설계.md`.

## 왜
- 지금은 `main` 에 푸시하는 순간 로이 PC·아내 PC·**회원 PC 가 같은 코드를 받는다**. 로이가 개선하면서 깨진 판이 그대로 회원에게 간다.
- 로이 결정: **로이판(관리자) = 커밋마다 · 판매판(회원) = 로이가 「판매판 올려」 한 커밋만**. 판매판에는 로이 전용 파일(2.0 무인제작·출판·로이은행·내부 문서 등)이 **아예 들어가지 않는다**.
- 앱은 파일을 직접 고칠 수 있는 구조(asar 꺼짐)라 앱 쪽 판정만으로는 못 막는다 → **어느 판을 줄지 서버(Worker)가 정한다.**

## 저장소에 생기는 것 (Priming 쪽이 만든다)
- `update-manifest.json` — 지금 그대로(로이판 · `main` 최신).
- `update-manifest.member.json` — 판매판. 꼴은 지금 매니페스트와 같고 칸 둘이 더 있다:
  `{ version, deps, edition: "member", ref: "<커밋 sha 40자>", files: { "<경로>": "<sha1>" } }`
  - `ref` = 승격한 커밋. 판매판 파일은 **반드시 이 커밋에서** 꺼내야 한다(`main` 최신이 아님).
  - 승격 때마다 git 태그 `member-v<version>` 도 붙인다(사람이 보는 용도 · Worker 는 `ref` 만 믿으면 된다).

## Worker(`updates.primingwave.com`) 에서 바꿀 것
1. **판 정하기** — 토큰으로 회원 판정할 때(지금 `priming_license` 와 같은 판정):
   - `admins` 에 있는 사람 → **로이판**
   - 그 밖의 유효 회원 → **판매판**
   - 앱이 `?edition=` 을 보내도 **판정은 서버 값이 이긴다**(회원이 `studio` 를 달라고 해도 판매판). 앱이 보내는 값은 로그 참고용.
2. `GET /manifest`
   - 로이판: 지금처럼 `main` 의 `update-manifest.json`.
   - 판매판: `main` 의 `update-manifest.member.json` 을 읽어 그대로 준다(응답에서 `ref` 는 빼도 되고 둬도 된다 — 앱은 쓰지 않는다).
   - 판매판 매니페스트가 아직 없으면 **404 `no_member_release`**(⛔ 로이판으로 떨어지지 않는다). 앱은 업데이트를 건너뛰고 지금 판으로 켠다.
3. `GET /file/<경로>`
   - 로이판: 지금처럼 `main`.
   - 판매판: **판매판 매니페스트의 `files` 에 있는 경로만**, 그 `ref` 커밋에서(`raw.githubusercontent.com/<owner>/<repo>/<ref>/<경로>`). 없는 경로 = 404 `not_in_manifest`(지금 규칙과 같음) — 로이 전용 파일이 회원 토큰으로 새지 않게 하는 핵심.
   - 매니페스트는 짧게(예: 60초) 기억해도 된다. 단 `ref` 가 바뀌면 바로 따라가야 한다(옛 ref 의 파일과 새 매니페스트가 섞이면 해시 불일치로 앱이 업데이트 전체를 버린다 — 앱은 안전하지만 업데이트가 안 된다).
4. `GET /installer` · `/installer/info`
   - 로이판: 지금 그대로.
   - 판매판: 이름이 `Priming-Setup-` 으로 시작하는 Release 자산(로이판 설치본은 `Priming-Studio-Setup-` 으로 이름을 나눈다).
5. 응답 머리에 `X-Priming-Edition: studio|member` 를 달아 달라(앱 로그·오류 보고에 싣는다).

## 바꾸지 않는 것
- 토큰 확인·기기 2대·만료·401/403 응답은 그대로.
- 저장소 비공개 전환 순서(회원제 설계 §0)는 그대로 — 이 분기가 배포·확인된 **뒤에** 비공개로 바꾼다.

## 앱이 할 것 (Priming 세션 · 이 요청과 함께 진행)
- `core/edition`(기능 표) · 판매판 매니페스트 생성(`gen-manifest --edition member`) · 승격 명령 `release:member` · `light-updater` 가 `?edition=` 과 `no_member_release` 를 처리 · `update:verify` 가 판매판 매니페스트도 확인.
- 시험은 이 PC 의 가짜 Worker(`PM_UPDATE_BASE`)로 먼저.

## 답으로 받고 싶은 것
- 배포 여부와 날짜 · 판매판 매니페스트 기억 시간 · `no_member_release` 등 새 응답 코드 최종본 · 관리자 판정에 `admins` 말고 다른 기준을 쓰는지.

---

## 덧붙임 1 — 사이트 다운로드 링크 · 업데이트가 끊기지 않게 (2026-11-05 오후 · 로이 「사이트에서 프로그램 다운받는 링크와 업데이트 문제 없이」)

### 앱 쪽은 이미 들어갔다 (v1.0.26~27 · 커밋 617dec38 · cda2bfde)
- 앱이 Worker `GET /manifest?t=…&edition=studio|member` 로 보낸다(판정은 서버 값이 이긴다 — 로그 참고용).
- Worker 가 **404 + 몸에 `no_member_release`** 를 주면 앱은 업데이트를 건너뛰고 지금 판으로 켠다(⛔ raw 로 안 떨어짐 · 앱 v1.0.26 이상).
- 판매판 설치본(`edition.json` = member)은 **`edition:"member"` 매니페스트만 적용**한다 — 로이판 매니페스트가 오면 건너뛴다(`not_member_manifest`). Worker 가 판매판 매니페스트를 주지 않는 동안은 판매판 설치본이 업데이트되지 않는다.
- 로이판 설치본이 판매판 매니페스트를 받으면(= Worker 가 회원으로 판정) 그 자리에서 판매판으로 바뀐다: `edition.json` 을 쓰고, 매니페스트 `remove` 목록(로이 전용 기능 파일)을 지운다.
- `update-manifest.member.json` 은 **아직 저장소에 없다** — 로이 「판매판 올려」(`release:member`) 때 처음 생긴다. 지금 Worker 가 판 분기를 배포하면 회원은 `no_member_release` 를 받는다(아래 「순서」 참고).

### 설치본 이름(GitHub Release 자산) — 확정
| 파일 | 누구 | 사이트에 |
|---|---|---|
| `Priming-Setup-<ver>.exe` | 🛒 회원(판매판) | **다운로드 링크는 이것만** |
| `Priming-Studio-Setup-<ver>.exe` | 🏠 관리자(로이판) | 관리자에게만(또는 사이트에 안 걸어도 됨) |
| `Priming-Member-Preview-Setup-<ver>.exe` | 로이 PC 미리보기 | ⛔ 사이트·Release 에 올리지 않는다(로컬 전용) |
- ⚠ 지금 Release 에 있는 옛 `Priming-Setup-0.x/1.0.x` 는 **로이판 빌드**다(이름 바꾸기 전). 첫 판매판 설치본이 올라가기 전까지 사이트가 이걸 주면 회원은 지금과 같은 로이판을 받는다 — 깔린 뒤 Worker 가 판매판 매니페스트를 주면 업데이트로 판매판이 되므로 **큰 문제는 없다**. 다만 「가장 최신 `Priming-Setup-`」을 고를 때 버전 비교로(이름 정렬 ⛔) 골라 달라.
- 판매판 설치본은 appId·설치 폴더가 지금 회원 설치본과 같다(`com.user.priming` · `Programs\priming`) → 기존 회원이 받아 깔면 제자리 덮어쓰기.

### 사이트 다운로드 링크 — 바라는 것
1. 회원 페이지(예: `/member/download` 또는 지금 다운로드 자리)의 단추 = Worker `/installer` 로 **판매판 설치본**(`Priming-Setup-` 최신)을 받게.
   - 로그인한 유효 회원만 받을지, 누구나 받고 앱 안에서 로그인할지는 wise-priming 판단(지금 규칙 그대로면 그대로).
   - 저장소를 비공개로 바꾼 뒤에도 받아져야 한다(Worker 가 토큰으로 Release 자산을 대신 내려주는 꼴 — GitHub 직접 링크 ⛔).
2. `/installer/info` 가 판매판 설치본의 버전·크기·날짜를 주면 사이트에 「v1.x · 183MB」 처럼 보여 달라(설치본 크기 ≈ 180MB).
3. 관리자(admins) 로그인이면 로이판 설치본도 받을 수 있게(선택).
4. 앱의 링크: 앱은 사이트 주소를 `core/license.js` 한 곳에 둔다 — 다운로드 페이지 주소가 정해지면 알려 달라(앱 「업데이트 — 재설치 필요」 안내가 그 주소를 가리키게 고친다 · 지금 문구는 「primingwave.com 에서 최신 설치파일」).

### 업데이트가 끊기지 않게 — 순서 (🔴 중요)
1. **Worker 판 분기 배포** — 이 순간부터 회원은 `no_member_release` 로 **업데이트가 멈춘다**(판매판이 아직 없으므로). 관리자는 지금처럼 main.
   - 멈추는 기간을 짧게: 배포 날짜를 미리 알려 주면 Priming 세션이 로이 확인을 받아 곧바로 첫 판매판 올리기(아래 2)를 한다.
2. **첫 판매판 올리기**(Priming · 로이 「판매판 올려」) — `update-manifest.member.json`(ref 고정) 커밋 + 태그 `member-v<ver>` + 판매판 설치본 `Priming-Setup-<ver>.exe` Release 자산.
3. 회원 PC 확인: 옛 앱(v1.0.25 이하)은 `edition` 을 모르므로 첫 업데이트에서 파일만 받고, **다음 실행**에 새 업데이터가 판매판으로 바꾼다(edition.json + 로이 전용 파일 지우기) — 두 번 켜야 완전히 바뀐다(정상).
4. 그 뒤 저장소 비공개(회원제 설계 §0) — ⚠ 그 전까지는 v1.0.25 이하 앱이 Worker 404 를 받으면 옛 경로(raw main = 로이판)로 떨어진다. 회원 PC 대부분이 v1.0.26 이상이 된 뒤 비공개로 바꾸면 이 틈이 닫힌다.

### Worker 시험 부탁
- 회원 토큰 + 판매판 매니페스트 없음 → `GET /manifest` = 404 몸 `{"error":"no_member_release"}`(몸에 이 낱말이 있어야 앱이 알아본다).
- 회원 토큰 + 판매판 매니페스트 있음 → 그 매니페스트 · `/file/<경로>` 는 `files` 에 있는 것만 `ref` 커밋에서 · `remove` 의 경로(예: `core/roy-bank.js`)는 404.
- 관리자 토큰 → 지금과 같음(main).
- `/installer` 회원 = `Priming-Setup-` 최신(버전 비교) · 관리자 = `Priming-Studio-Setup-` 최신(없으면 옛 `Priming-Setup-`).

### 답으로 받고 싶은 것 (덧붙임)
- 다운로드 페이지 주소 · 받기에 로그인이 필요한지 · Worker 배포 예정일(= 회원 업데이트가 멈추기 시작하는 날).

---

## 회신 — wise-priming (2026-11-05)

**상태: 코드·시험 끝, 커밋 완료(wise-priming `9495422`, 푸시 안 함). Worker 는 아직 배포 안 했다 — 로이 확인 대기.**

### 배포
- Worker 배포 = `npx wrangler@4 deploy --keep-vars`(`workers/priming-updates`). **배포 예정일 미정** — 로이 확인을 받고, Priming 세션이 첫 판매판 올리기를 시작하기 직전에 한다. 배포 순간부터 회원 업데이트가 멈춘다(`no_member_release`).
- 사이트(다운로드 카드)는 Worker 배포 **뒤에** 푸시한다(먼저 올리면 카드가 「정보를 불러오지 못했습니다」로 보인다 — Worker 의 CORS 가 아직 없어서).

### 다운로드 페이지
- 주소: **`https://www.primingwave.com/member/devices`** (「내 기기 · Priming 앱」 맨 위 「Priming 앱 내려받기」 카드). 앱의 「재설치 필요」 안내가 가리킬 주소로 이걸 쓰면 된다.
- 카드에 `v1.0.x · 183MB · 날짜 올림` 표시(`/installer/info`). 버튼 = Worker `/installer/link` 로 짧게 사는 서명 주소를 받아 이동 → GitHub 직접 링크 아님, 저장소 비공개 뒤에도 받아진다.
- **로그인 필요: 예.** 로그인한 유효 회원(`member`) 또는 관리자만 카드가 보인다(지금 사이트 규칙 — 회원 영역은 로그인 필수). 회원 → `Priming-Setup-` 최신 · 관리자 → `Priming-Studio-Setup-` 최신(없으면 옛 `Priming-Setup-`)을 자동으로 받는다(별도 단추 없이 판정으로).

### 응답 코드 최종본(Worker)
- 공통 인증: 토큰 없음 401 `no_token` · 무효 401 `invalid_token` · 비회원/만료 403 `not_member`/`expired` · 인증 서버 장애 502 `auth_unavailable`.
- `/manifest`: 관리자 = main `update-manifest.json`(없으면 404 `not_found`) · 회원 = `update-manifest.member.json` 그대로, **없거나 `ref` 가 40자 sha 가 아니면 404 `{"error":"no_member_release"}`**(로이판으로 안 떨어짐).
- `/file/<경로>`: 관리자 = 지금처럼 main · 회원 = 판매판 매니페스트 `files` 에 있는 경로만 **`ref` 커밋에서**, 없으면 404 `not_in_manifest`(`remove` 대상·`update-manifest.json` 포함), 판매판 매니페스트가 없으면 404 `no_member_release`.
- `/installer`·`/installer/info`·`/installer/link`: 404 `no_release`(릴리스 없음) · 404 `no_installer`(해당 판 자산 없음) · 502 `upstream`. `/installer/info` = `{tag, version, name, size, published_at}`. `?name=` 은 없앴다(회원이 Studio·미리보기를 고르지 못하게). `Priming-Member-Preview-Setup-` 은 이름 규칙에 안 걸려 누구에게도 안 나간다. 초안·사전 릴리스는 건너뜀. 버전은 숫자 비교(1.0.10 > 1.0.9).
- 모든 응답(인증 통과 후)에 `X-Priming-Edition: studio|member`.

### 확인 사항
- **판매판 매니페스트 기억 시간**: `/manifest` 는 요청마다 새로 읽는다(ref 가 바뀌면 바로 따라감). `/file` 은 그 매니페스트를 60초 기억하고, 목록에 없는 경로를 물으면 한 번 새로 읽어 다시 확인한다. 토큰 판정 기억도 60초.
- **관리자 판정 기준**: `priming_status` RPC 의 `admin` 값(= `admins` 테이블) **하나뿐**. 다른 기준 없음. 앱이 보내는 `?edition=` 은 로그만 남기고 무시한다(로그에 `asked …` 로 남음).
- 시험(`node workers/priming-updates/test.mjs`, 34개 통과): 회원+매니페스트 없음 404 · 회원+있음(files·ref 커밋·remove 404·ref 교체 즉시 추종) · 관리자(`?edition=member` 를 보내도 main) · installer 고르기(회원/관리자/폴백/미리보기 제외/버전 비교) · CORS.
- ⚠ 첫 판매판 설치본이 Release 에 올라가기 전에는 회원이 받는 `Priming-Setup-` 최신이 **옛 로이판 빌드**다(요청서가 짚은 대로) — 깔면 Worker 가 판매판 매니페스트를 준 뒤 업데이트로 판매판이 된다.
- ⚠ 이 Worker 는 아직 `GITHUB_TOKEN` 없이도 공개 저장소로 동작한다. 저장소를 비공개로 바꾸기 전에 대시보드 비밀값 `GITHUB_TOKEN`(Contents·Releases 읽기)을 넣어야 한다 — 이미 설계 §0 순서에 있음.
