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
