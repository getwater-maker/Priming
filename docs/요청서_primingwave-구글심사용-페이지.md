# 요청서 → D:\wise-priming 세션 (primingwave.com)

> 2026-10-18 · 보내는 곳: Priming 세션 · 받는 곳: **wise-priming 폴더에서 연 세션** (사이트 코드는 그 폴더 세션이 고친다)
> 🎯 목적: 구글 **OAuth 앱 인증 + YouTube API 심사**를 통과하려면 앱의 홈페이지·개인정보 방침이 **본인 소유 도메인(primingwave.com)** 에 있어야 한다. 지금 쓰는 `sites.google.com/view/priming-app` 은 구글 도메인이라 소유 증명이 안 돼 심사가 막힌다.

## 1. 구글이 사이트에서 확인하는 것 (심사관이 직접 열어 본다)

1. **앱 홈페이지**(로그인 없이 열린다): Priming 앱이 무엇인지, **YouTube 연동 기능**(영상 업로드·썸네일·재생목록·예약)이 있다는 설명. → 기존 `/priming` 이 로그인 없이 열리면 거기에 「YouTube 연동」 절을 더한다.
2. **개인정보 방침**(로그인 없이): 지금 `/privacy` 는 사이트·앱 회원 정보만 다룬다. **YouTube API 관련 문구가 하나도 없다.** 아래 §2 절을 추가한다(한국어 + 영어 둘 다 권장 — 심사관은 영어를 읽는다).
3. 홈페이지 첫 화면에서 방침으로 가는 링크가 보일 것(지금 푸터에 있다 — 그대로 둔다).
4. 방침 주소는 안정적이어야 한다: 예) `https://www.primingwave.com/privacy` (또는 전용 `/privacy#youtube`). **GCP 에 넣을 주소를 알려 달라**.

## 2. `/privacy` 에 추가할 절 (영어 원문 — 한국어 번역 함께)

**Priming desktop app – YouTube API Services**

Priming (the desktop application) uses YouTube API Services. By using Priming you agree to be bound by the YouTube Terms of Service (https://www.youtube.com/t/terms). Google's Privacy Policy applies to data handled by Google: http://www.google.com/policies/privacy

- **Permissions requested** — youtube.upload: upload the user's own video and set title, description, tags, synthetic-content disclosure and an optional scheduled publish time. youtube.readonly: show the connected channel name, list the user's own playlists, check for duplicate titles before uploading. youtube.force-ssl: only to set a thumbnail on the video just uploaded and add it to a playlist the user chose. Priming never reads comments, subscribers, analytics or any other person's data.
- **How it is used** — only to upload the user's own video to the user's own channel and confirm the result. Not sold, not shared, not used for advertising.
- **Storage** — the Google authorization token is stored only on the user's PC, encrypted with the OS secure storage. It is never sent to us or any server.
- **Error reports (optional)** — if the user leaves error reporting on or sends a problem report, a short app log (up to 200 lines) is sent to us. Before sending, the app removes every value it received from YouTube — the connected channel's name, uploaded video titles, playlist names and video IDs — as well as API keys and e-mail addresses. YouTube API data therefore never reaches our servers. Reports are deleted after 30 days, and error reporting can be turned off in the app's settings.
- **Deletion and revocation** — disconnecting a channel in the app (Settings → Channel connection) deletes the stored token. Access can also be revoked at https://security.google.com/settings/security/permissions
- **Google API Services User Data Policy** — Priming's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.

(한국어: 위 내용을 같은 순서로 번역해 같은 절에 둔다.)

## 3. 확인·결정이 필요한 것

- ✅ **결정 완료(Claude 판단 · 2026-10-18)**: 앱이 로그를 보내기 전에 유튜브에서 받은 값(채널 이름·영상 제목·재생목록 이름·영상 ID)을 지운다 — Priming v0.9.69 `core/log-scrub` 로 구현·배포. 그래서 위 「Error reports」 문단(「YouTube 데이터는 우리에게 오지 않는다」)이 **사실**이다. 이 문단은 v0.9.69 가 설치된 PC 부터 사실이므로 방침을 올리는 시점에 앱 배포가 끝나 있어야 한다.
- 방침 사업자 표기(언니네정원 · 개인정보 책임자 한득수 · blogpostingm@gmail.com)와 GCP 개발자 연락처(adonairoy2026@gmail.com)가 다르다 → 심사관이 물으면 「같은 운영자」임을 설명해야 한다(로이가 알려 줄 것).
- 정식 오픈일 전이라 `/privacy` 가 「시행일: 정식 오픈일」 상태다. 심사용으로 **지금 공개돼 있어야** 하므로 YouTube 절은 **오픈 전에도 바로 보이게** 한다.

## 4. 끝났다는 기준

`https://www.primingwave.com/privacy` 를 로그아웃 상태로 열었을 때 §2 절이 보이고, 앱 홈페이지가 YouTube 연동을 설명한다. 주소 두 개를 Priming 세션에 알린다 → GCP 브랜딩에 입력한다.
