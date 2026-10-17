# YouTube API 심사(감사) 신청 서류 초안

> 작성 2026-10-18. 목적: `priming-upload` 프로젝트의 「미심사 → 업로드 영상 비공개 강제」를 풀어 **공개·예약 업로드**(`publishAt`)를 가능하게 한다.
> 🔴 **로이가 직접 할 일**: 구글 양식 제출은 로이 몫이다(Claude 는 제출하지 않는다). 아래는 붙여넣을 답변과 촬영 시나리오다.
> ⚠ 양식의 실제 칸 이름·순서는 구글이 바꿀 수 있다 — 칸 이름이 다르면 가장 가까운 답을 골라 쓴다. 아래 사실(범위·동작)은 현재 코드 기준이다.

## 0. 제출 전에 확인할 것 (한국어)

1. **신청 위치**: 구글 「YouTube API Services – Audit and Quota Extension Form」(검색어: `YouTube API Services Audit and Quota Extension Form`). 이 양식 하나가 「감사(Compliance Audit)」와 「할당량 확대」를 겸한다. 로그인은 **프로젝트 소유 계정(adonairoy2026@gmail.com)** 으로.
2. **프로젝트 번호**: GCP 콘솔 → `priming-upload` → 프로젝트 번호(숫자 12자리 안팎). 양식이 요구한다. (클라이언트 ID 앞자리 `932586314031` 과 같은 숫자 — 콘솔에서 눈으로 확인할 것.)
3. **OAuth 동의 화면**이 「프로덕션」이고 개인정보처리방침·홈페이지 주소(`https://sites.google.com/view/priming-app`)가 열리는지 먼저 확인. 방침에 아래 내용이 **글자로** 들어 있어야 통과가 쉽다:
   - 유튜브 API 서비스를 쓴다 + **YouTube Terms of Service(https://www.youtube.com/t/terms)** 에 동의한다는 문장
   - **Google Privacy Policy(http://www.google.com/policies/privacy)** 링크
   - 토큰은 사용자 PC 에만 암호화 저장, 우리 서버로 보내지 않음
   - 사용자가 언제든 연결 해제 가능 + **https://security.google.com/settings/security/permissions** 에서 권한 취소 가능
4. **스크린캐스트**: 아래 §3 시나리오대로 3~5분, 영어 자막(또는 화면 글자)로. 유튜브 「일부 공개」로 올려 링크를 양식에 붙인다.
5. 결과는 보통 **수 주** 걸리고, 추가 질문 메일이 온다. 메일은 영어로 오니 오면 이 대화에 붙여 주면 답을 만든다.
6. 승인되면 코드 쪽 작업(예약 `publishAt` 추가)이 남는다 — 심사 통과 **전에도** 코드는 넣어 둘 수 있지만, 통과 전엔 구글이 비공개로 강제하므로 효과가 없다.

## 1. 양식에 붙여넣을 영어 답변

### 1-1. 앱 한 줄 소개 (Describe your API client / application)

> Priming is a Windows desktop application (Electron) that helps a small team of independent YouTube creators produce narrated long-form videos from a text script. After a video file is rendered locally, Priming lets the channel owner upload it to **their own YouTube channel** with a title, description, tags and chapters, and optionally set a thumbnail, add it to one of their playlists, and **schedule its publication time**. Priming has no server side: all OAuth tokens and videos stay on the user's own computer.

### 1-2. API 사용 방식 (How does your application use YouTube API Services?)

> Priming uses the YouTube Data API v3 only on behalf of the authenticated channel owner, and only for that owner's own channel:
>
> 1. `videos.insert` (resumable upload) — uploads the owner's rendered video with title, description, tags, default language, the "altered or synthetic content" declaration (`status.containsSyntheticMedia`) and, when the owner chooses a schedule, `status.privacyStatus=private` + `status.publishAt` (or `public` when the owner chooses immediate publication).
> 2. `thumbnails.set` — sets the owner's chosen thumbnail on the video just uploaded.
> 3. `playlistItems.insert` / `playlistItems.list` — adds the uploaded video to a playlist the owner picked, then re-reads the playlist to confirm the item is really there.
> 4. `playlists.list`, `channels.list`, `playlistItems.list` (uploads playlist) — read-only; used to show which channel is connected, to let the owner choose a playlist, and to warn about a **duplicate title** before uploading (to prevent accidentally uploading the same video twice).
>
> The application never reads, stores or displays any other user's data, never accesses comments, subscribers, analytics or private data of anyone but the connected owner, and does not use the API for advertising, data resale or any purpose other than publishing the owner's own videos.

### 1-3. 요청 범위와 이유 (Scopes and justification)

> - `https://www.googleapis.com/auth/youtube.upload` — required for `videos.insert`. This is the core function of the app.
> - `https://www.googleapis.com/auth/youtube.readonly` — required to identify the connected channel, list the owner's playlists for selection, and check for duplicate titles in the owner's uploads list before uploading.
> - `https://www.googleapis.com/auth/youtube.force-ssl` — required for `thumbnails.set` and `playlistItems.insert`, which Google does not allow with `youtube.upload` alone.
>
> We request only these three scopes. We do not request any scope for comments, analytics or account management.

### 1-4. 데이터 보관과 보호 (How do you store and protect user data?)

> - OAuth refresh/access tokens are stored only on the user's own PC, encrypted with the operating system's secure storage (Electron `safeStorage`, backed by Windows DPAPI). They are never sent to any server operated by us and never exposed to the user interface layer.
> - Priming does not operate a backend that receives YouTube data. Video files, titles and descriptions are created by the owner and are uploaded directly from the owner's PC to YouTube.
> - Diagnostic logs are scrubbed before they leave the PC (tokens, keys, and e-mail addresses are removed).
> - The only YouTube API data kept locally is: the connected channel's ID and title, the IDs of videos the app itself uploaded (to prevent duplicates and to show a link), and the owner's chosen playlist ID. It is not shared with third parties.
> - The user can disconnect at any time from Settings → Channel connection, which deletes the stored token, and can revoke access at https://security.google.com/settings/security/permissions. We follow the 30-day refresh and deletion rules of the YouTube API Services Developer Policies.

### 1-5. 사용자 수·남용 방지 (Users, quota, abuse prevention)

> Priming is used by the operator and a very small number of family/team members (fewer than 10 PCs). Each PC is capped by the app at 30 uploads per day, and every upload passes through a duplicate-upload gate (same file, same title in the local history, or same title already in the channel's uploads list). The default API quota for `videos.insert` is sufficient for our scale; we are not requesting a quota increase, only the compliance audit so that videos uploaded through the API are no longer locked to private.

### 1-6. 왜 필요한가 (Why do you need the restriction lifted?)

> Our users publish one video per day on a fixed schedule. Because videos uploaded by an unaudited API project are locked to private, the owner must open YouTube Studio and change every video's visibility and schedule by hand, which defeats the purpose of the app. After the audit we will set `status.publishAt` (scheduled publication) on the video at upload time, so the owner's own chosen release time is respected.

### 1-7. 정책 준수 진술 (Compliance statements)

> We have read and comply with the YouTube API Services Terms of Service and Developer Policies. Our application: (a) displays the YouTube branding link and the Terms of Service / Google Privacy Policy links in its privacy policy at https://sites.google.com/view/priming-app, (b) does not scrape or download YouTube content through the API, (c) does not modify, mislead or hide the "altered or synthetic content" disclosure — it **sets it to "yes"** for AI-generated narration and imagery, and (d) uploads only videos that the authenticated owner created.

## 2. 사실 점검표 (⚠ 이 중 하나라도 사실이 아니면 답변을 고친다)

| 답변에 쓴 말 | 근거(코드·문서) | 확인할 사람 |
|---|---|---|
| 범위 3개 | 규칙 문서 「업로드 마무리」 — `youtube.force-ssl` 추가(v0.9.33) | Claude 확인함 |
| 토큰 safeStorage 암호화·렌더러로 안 줌 | CLAUDE.md §7 채널 · 공유 | Claude 확인함(규칙 문서 기준) |
| PC 하루 30편 상한 | `DEFAULT_DAILY_CAP` | Claude 확인함 |
| 중복 관문 | `runYtUpload`·`YT.checkDuplicate` | Claude 확인함 |
| 방침 페이지에 위 문장이 있다 | ❓ | **로이가 사이트를 열어 확인** |
| 프로젝트 번호·동의 화면 「프로덕션」 | ❓ | **로이가 GCP 콘솔에서 확인** |
| `publishAt` 코드 | ❌ 아직 없음 | 아래 §4 — 심사 중 구현 가능 |
| 「사용자 10대 미만」 | 로이 PC·아내 PC 기준 | 로이 확인 |

> 답변 1-2 ~ 1-6 의 「publishAt」 설명은 **앱에 그 기능이 있어야** 심사관이 화면에서 확인한다. 촬영 전에 §4 구현을 먼저 하는 편이 안전하다(심사관이 스크린캐스트에 없는 기능을 물을 수 있다).

## 3. 스크린캐스트 시나리오 (3~5분 · 영어 자막/화면 글자)

> 규칙: **실제 앱 화면**으로, 데모용 채널(홍보자료 규칙: 로이 본 채널 아님)을 연결해 촬영한다. 구글이 요구하는 것: ① 동의(OAuth) 화면 전체 흐름 ② 각 범위가 쓰이는 기능 ③ 우리 방침 링크 위치.

| 시간 | 화면 | 자막(영어) |
|---|---|---|
| 0:00 | 앱 첫 화면 | "Priming – desktop app for narrated YouTube videos. Runs only on the user's PC." |
| 0:15 | ⚙ 설정 → 📺 채널 연결 → 「채널 연결」 클릭 | "The user clicks Connect channel." |
| 0:25 | 브라우저에 구글 동의 화면(앱 이름·범위 3개가 보이게 **멈춤 3초**) | "Google OAuth consent screen. The app requests: upload videos, view channel info, and manage playlists/thumbnails of the user's own channel." |
| 0:45 | 허용 → 앱에 「연결됨 · 채널 이름」 표시 | "Connected. The token is stored encrypted on this PC only." |
| 1:00 | 방침 링크(앱 안 또는 브라우저로 `priming-app` 사이트) 보여 줌 | "Privacy policy with YouTube ToS and Google Privacy Policy links, and revocation instructions." |
| 1:20 | 대본이 이미 렌더된 MP4 선택, 업로드 창(제목·설명·챕터·태그) | "The owner prepares title, description, chapters and tags." |
| 1:50 | **예약 시각 고르기**(날짜·시각) → 업로드 시작, 진행률 | "The owner chooses a scheduled publish time. The app calls videos.insert with status.publishAt." |
| 2:30 | 같은 제목 한 번 더 업로드 시도 → 「중복」 경고 | "Duplicate-upload gate (uses the owner's own uploads list, read-only)." |
| 2:50 | 썸네일 A 지정 · 재생목록 선택 → 완료 표(확인표) | "thumbnails.set and playlistItems.insert; the app re-reads the playlist to confirm." |
| 3:20 | YouTube Studio 를 열어 방금 올린 영상이 **예약됨(Scheduled)** 으로 보이는 화면 | "The video appears in YouTube Studio as scheduled for the owner's chosen time." |
| 3:40 | 앱 설정 → 「연결 해제」 → 토큰 삭제 안내 + 구글 권한 페이지(`security.google.com/settings/security/permissions`) 보여 줌 | "The user can disconnect any time and revoke access in the Google account settings." |

**촬영 팁**
- 화면 녹화 = Windows `Win+G` 게임바 또는 OBS. 해상도 1080p, 마우스 포인터 보이게.
- 동의 화면은 **앱 이름·범위가 읽히게** 확대해서 잠시 멈춘다.
- 개인 정보(이메일·API 키 칸)는 가린다.
- 올릴 때 유튜브 「일부 공개」, 제목 `Priming – YouTube API compliance demo`.
- ⚠ 예약 업로드 장면(1:50·3:20)은 **§4 구현이 끝나야** 촬영 가능하다. 구현 전에 찍으면 「설명한 기능이 없다」고 반려될 수 있다.

## 4. 이 서류와 짝이 되는 코드 일(아직 안 함)

- `core/youtube-upload.js` `uploadVideo` 의 `status` — 예약 시 `{privacyStatus:'private', publishAt:'<ISO8601 UTC>'}`, 즉시 공개 시 `public`. `publishAt` 은 **UTC ISO** 로 보낸다(화면·로그는 KST 표시 · 전역 규칙).
- 업로드 창에 「예약」 칸(채널 편집의 기본값 + 대본마다 덮어쓰기 · 하루 1편 간격 자동 배정은 로이 의견 후).
- 심사 **통과 전**에는 구글이 비공개로 강제하므로 `publishAt` 을 보내도 공개 전환이 안 될 수 있다 → 앱은 통과 여부를 모르니, 결과 영상의 `privacyStatus`/`publishAt` 을 다시 읽어(`videos.list`) 「예약이 적용됐다/안 됐다」를 확인표에 적는다(조용히 틀리지 않게).
- 문서 규칙 갱신: `docs/규칙/유튜브업로드.md` 에 한 줄 + 대본 작성 가이드 영향 없음.
