# Priming — 규칙과 지도

> 이 폴더에서 여는 모든 세션에 통째로 실리는 문서다. **지금 유효한 규칙·금지선·구조만** 둔다.
> 경위·실측 수치·버전별 기록은 [`docs/작업노트/`](docs/작업노트/) 에 **원문 그대로** 있다(2026-09-26 슬림화 전 CLAUDE.md 전체 = 557,605자).

## 0. 이 문서에 무엇을 두나

| 둔다 (여기) | 옮긴다 (docs/작업노트/<월>.md) |
|---|---|
| 지금 규칙 · 🔴 금지선 · ⛔ 로이 확정 결정 | 원인 추적 과정 · 실측 표 · 전후 비교 |
| 모듈 지도 · 폴더·설정 위치 · 서버 포트 | 버전별 변경 내역 · 검증 단언 개수 |
| 기능별 ⛔/🔴 요약 + `docs/규칙/` 링크 | 그 기능의 상세 규칙 원문 → [`docs/규칙/`](docs/규칙/)(TTS·자막·대본편집·채널설정·출판·다국어·클립화면·비디오엔진·유튜브업로드·나노바나나 — 고치기 전에 읽는다) |
| 기능별 「지금 동작」 한 줄 + 작업노트 링크 | 폐기된 기능의 옛 설명(쇼츠·플리·ACE-Step) |

**기록 규칙(2026-09-26 로이 확정)**: 코드를 고치면 경위는 `docs/작업노트/YYYY-MM.md` 맨 위에 절을 추가하고(형식: `## 제목 (YYYY-MM-DD, v0.x.y)`),
여기에는 **새로 생긴 규칙·금지선이 있을 때만 한 줄**을 해당 절에 더한다. 이 문서는 4만 자 안쪽을 유지한다.
작업노트 목차: [2026-09](docs/작업노트/2026-09.md) · [2026-08](docs/작업노트/2026-08.md) · [2026-07](docs/작업노트/2026-07.md) · [2026-06](docs/작업노트/2026-06.md) · [초기(날짜 없는 절)](docs/작업노트/초기.md)

---

## 1. 프로젝트 한 줄

**롱폼(16:9) 대본(.md) → TTS·이미지·(선택)비디오 → Vrew 4.0.1 `.vrew` / 유튜브 MP4 / 화이트보드 MP4** 를 만드는 Electron 앱 + **출판(POD) PDF·ePub** + **리모션(TSV → 음성·그림)**.
- 모드: **롱폼 · 🎬 리모션 · 📖 출판** 셋. 쇼츠·플리·ACE-Step 생성은 2026-08-22 **제거**(옛 기록은 작업노트 — 따라 하지 말 것). 🎵 배경음악은 「내 음악 파일」 방식으로만 있다.
- PC: **메인 PC**(RTX 3060 12GB · OmniVoice·ComfyUI 서버 보유) + **아내 PC**(GPU 없음 · 원격으로 메인 PC 서버 사용). 주소는 IP 대신 컴퓨터 이름 `DESKTOP-CBQLOLJ`(DHCP 로 IP 가 바뀐 사고가 있다) 또는 Tailscale `desktop-cbqlolj`.
- 사용자(로이)는 비전문가. 설정 파일을 손으로 만지게 하지 말고 앱 UI 로 해결한다.

## 2. 실행 · 발행 · 버전

- 실행: `npm start`(= vite build + electron). 엔트리 `bootstrap.js` → `light-updater.applyUpdates()` → `main.js`.
- **발행 = 수정 → 테스트 → `npm run update:publish`(vite build + 매니페스트) → git add(소스·테스트·`renderer/dist`·`update-manifest.json`·package.json·CLAUDE.md·작업노트) → commit → push.** 각 PC 는 앱 재시작 때 바뀐 파일만 받는다(asar 비활성, raw.githubusercontent, 저장소 `getwater-maker/Priming`, CDN 캐시 ~5분).
  - 🔴 **빌드가 커밋보다 먼저** — `renderer/dist` 와 매니페스트가 함께 올라가야 다른 PC 가 받는다.
  - 🔴 **`package.json` dependencies 가 바뀌면 라이트 업데이트가 막힌다**(매니페스트 `deps` 해시) → 설치본 재배포(`npm run dist`) 필요. ⛔ **npm 의존성을 쉽게 늘리지 않는다**(아내 PC 재설치가 따라온다). 형태소 분석기 등도 같은 이유로 안 쓴다.
  - 🔴 **버전은 앞으로만** — 고치기 전에 `package.json` 을 먼저 읽는다(다른 세션이 낡은 값으로 0.3.25→0.2.99 역행시킨 사고). `gen-manifest` 가 역행을 막는다(`ALLOW_VERSION_DOWNGRADE=1` 로만 우회).
  - 매니페스트 제외: 폴더 **이름**이 `scripts`·`.venv`·`qwen-design` 등인 곳 전체, `assets/fonts/book/`, **git 무시 파일**(`git check-ignore`). 🔴 배포할 파이썬은 `scripts/` 라는 이름 폴더에 두지 말 것(조용히 빠진다). 해시는 LF 정규화 기준.
  - 🔴 **`assets/fonts/book/` 는 매니페스트에서 제외되지만 `NotoSerifKR-`·`HanjaSerif-` 로 시작하는 글꼴은 예외로 배포한다**(안 그러면 설치본에 글꼴 파일이 없어 한자가 고딕으로 튄다 · R15). 새 동봉 글꼴은 `BUNDLED_FACES` 에 올리고 이 예외 접두사도 함께 본다(`test:book` font-ship).
  - 설치본 버전 확인: `%LOCALAPPDATA%\Programs\priming\resources\app\package.json`. 발행 직후 「안 된다」면 먼저 이걸 본다(CDN 이 옛 매니페스트를 준 적 있음 — 한 번 더 재시작).
- 로그: `~/.shots-maker/logs/YYYY-MM-DD.log`(KST · 7일 보관 · 화면 줄은 `[화면]` 접두). 로그창 「📁 파일」. 엔진(Flow 등) 로그도 파일로 후킹돼 있다.

- 🔴 **문서(CLAUDE.md·작업노트·docs)만 고친 커밋도 푸시 전에 `npm run update:manifest` 로 매니페스트를 다시 만들어 같은 커밋에 넣는다**(매니페스트에 든 파일의 해시가 서버와 어긋나면 업데이터가 「파일 1개를 못받았습니다」로 전 PC 업데이트를 막는다 · 2026-10-07 작업노트 문서만 고친 커밋 사고) — 푸시 뒤 `update:verify --all` 로 확인.
- 🚑 **발행 뒤 `npm run update:verify` 가 「안전」을 찍기 전에는 「앱 다시 켜면 반영」이라고 안내하지 않는다**(2026-10-06 — raw 서버가 이미 있던 파일을 약 5분 옛 내용으로 보여 줘 그 사이 켠 PC 의 화면이 백지가 됐다). 업데이터(`light-updater.js`)는 **전부 받아 해시 확인 → 그 뒤에만 교체**(하나라도 못 받으면 아무것도 안 바꿈 · 옛 asset 은 교체가 끝난 뒤에만 정리) — 파일마다 받는 대로 교체하는 방식으로 되돌리지 말 것(`test:updater` 가 잡는다). 🔴 **매니페스트 파일은 전부 커밋돼 있어야 한다**(하나라도 404 면 모든 PC 업데이트가 막힌다 · v0.7.19 .exe 사고) — `update:verify` 가 저장소에 없는 매니페스트 파일을 ❌ 로 잡는다 · 설치·압축 파일은 `gen-manifest` 가 뺀다.

## 3. 모듈 지도

| 영역 | 파일 | 먼저 읽을 규칙 |
|---|---|---|
| IPC·오케스트레이션·큐·게이트·레인 | `main.js`(권위 상태 `S`) · `preload.js` | 고치는 함수의 기능으로 ↓ 아래 줄 |
| 파싱 | `core/parsers/longform-parser.js` · `core/sentence-splitter.js`(🔑 문장 규칙 정본, `MATCH_PATTERNS`) · `core/group-builder.js` · `core/project-model.js` | [대본편집](docs/규칙/대본편집.md) · ja/vi 는 [다국어](docs/규칙/다국어.md) |
| 공용 파이프라인 | `core/pipeline.js`(parseScript·toDTO·fillTts·buildProjectVrew·retryFs·buildImagePrompt) | fillTts → [TTS](docs/규칙/TTS.md) · 그 밖 → [대본편집](docs/규칙/대본편집.md) |
| 대본 편집·보기 | `core/script-edit.js`(문장 범위 치환) · `core/script-reader.js`(대본 보기·A4 PDF) · `core/group-merge.js` · `core/visual-span.js`(그림 범위·레이어) · `core/visual-look.js` · `core/overlay-layers.js`(삽입·로고) | [대본편집](docs/규칙/대본편집.md) |
| 자막 | `core/caption-splitter.js`(🔑 줄 나누기 **유일한 구현** — 렌더러 `renderer/src/lib/captions.js` 는 re-export) · `core/caption-format.js`(서식 모델) · `core/caption-ass.js` · `core/caption-anim*.js` · `core/font-store.js` | [자막](docs/규칙/자막.md) |
| TTS | `tts/tts-manager.js`(싱글톤) · `tts/providers/omnivoice-provider.js` · `tts/text-pronouncer.js`(🔑 `processForTTS` = TTS 텍스트 가공 유일한 문) · `tts/preset-store.js`(채널) · `core/tts-cache.js` · `core/audio-normalize.js` · `tts/asr-client.js`(STT) | [TTS](docs/규칙/TTS.md) · 채널·목소리 분류 → [채널설정](docs/규칙/채널설정.md) · ja/vi → [다국어](docs/규칙/다국어.md) |
| 이미지 | `core/comfy-image.js` · `core/comfy-models.js`(모델 자동 대체) · `core/comfy-perf.js` · `genspark-engine.js` · `flow-engine.js`(⚠ CRLF 파일) · `core/image-rotation.js` · `core/style-store.js` · `core/media-cache.js` | Gemini → [나노바나나](docs/규칙/나노바나나.md) · 스타일 → [채널설정](docs/규칙/채널설정.md) |
| 비디오 | `core/comfy-video.js` · `grok-engine.js` · `core/grok-api.js` · `flow-engine.js`(Veo) · `genspark-engine.js`(비디오) · `core/video-fit.js` · `core/upscaler.js` | [비디오엔진](docs/규칙/비디오엔진.md) |
| 출력 | `vrew/vrew-builder.js`(.vrew) · `core/vrew-render.js`(.vrew → MP4) · `core/whiteboard-*.js` + `whiteboard/`(벤더링) · `core/premiere-xml.js` · `core/youtube-upload.js`·`yt-packaging.js`·`yt-chapters.js` | youtube-*·yt-* → [유튜브업로드](docs/규칙/유튜브업로드.md) |
| 리모션 | `core/tsv-tts.js` · `core/tsv-images.js` · `core/audio-trim.js` · `renderer/src/RemotionView.jsx` | [출판](docs/규칙/출판.md) |
| 출판 | `core/book/*`(parser·html-builder·pdf-builder·epub-builder·spine-calc·isbn-barcode) · `renderer/src/BookView.jsx` | [출판](docs/규칙/출판.md) |
| 받기·STT | `core/media-download.js`(yt-dlp) · `core/merge-assets.js`(통합본 이어받기) · `core/vrew-audio.js`(Vrew 음성 가져오기) | — |
| 화면 | `renderer/src/App.jsx`(헤더·리본·모달) · `Workspace.jsx`(① 영상 ② 클립 ③ 설정 3칸 · 🔑 `buildProjLines` = 줄 번호 정본) · `CaptionFormat.jsx` · `ScriptReader.jsx` | ② 클립·그룹 칸·막대 → [클립화면](docs/규칙/클립화면.md) · ⚙ 설정·채널 편집 → [채널설정](docs/규칙/채널설정.md) · CaptionFormat → [자막](docs/규칙/자막.md) |

> 🔎 **`main.js`·`App.jsx` 는 기능이 섞여 있다 — 고치는 함수·IPC 이름으로 규칙 문서를 고른다**: `runYtUpload`·`enqueueYtUpload` → 유튜브업로드 · `runGeminiBatchImages`·`gemini*` → 나노바나나 · `book-*`·`remotion-*` → 출판 · `_editSentences`·`merge-*`·`split*`·`delete/copy/paste-clips`·`undo*`·`roy*` → 대본편집 · `tts*`·`voice*`·`*-ref-*`·`qwen-design*` → TTS · `cap*` → 자막 · `get/save-preset*`·`api-key-*`·`*-style*` → 채널설정 · `video-build`·`flow*`·`grok*` → 비디오엔진. 어느 것에도 안 맞으면 이 문서의 해당 절만으로 판단한다.

## 4. 폴더 · 설정 위치

- 출력: `<채널 출력폴더>/<대본이름>/` 아래 **`media-N`(그림·영상 `NN.png`·`NN.mp4`·`NN_1080.mp4`) · `tts-N`(`<문장번호>.wav/mp3`) · `subtitles-N`** + 루트 `.vrew`. 롱폼은 N=1(`shortsNum`·`shortsDirs` 이름은 옛 쇼츠 잔재 — ⛔ 바꾸지 말 것, 스냅샷·IPC 키다).
- `~/.shots-maker/` 앱 상태(logs · tts-cache · electron userData · anti-detect) · `~/.priming-maker/` 설정(projects/*.smproj.json = **작업본, ⛔ 지우지 말 것** · comfy-*-config · *-accounts · image-rotation · youtube-auth · workspace.json) · `~/.flow-app/` TTS 채널·참조음성·스타일(`tts-presets.json`·`styles.json`·`channel-styles.json`).
- 작업본(.smproj) 키 = **대본 파일명**(경로 아님). 대본을 옮겨도 이름이 같으면 이어받는다.
- ⛔ **시작은 빈 화면**(로이 2026-06-22 — 큐 자동 복원 안 함). 지난 큐는 `workspace.last.json`(대본이 있을 때만 씀 · 빈 큐로 덮지 않음) → 큐 자리 「♻ 지난 큐 다시 열기」. 🔀 **헤더 채널을 바꾸면 롱폼 큐를 비운다**(v0.7.37 · 로이 — 같은 채널 재선택·작업 중(`_awake.n`)·큐 순차 제작 중에는 안 비움 · 비우기 전 last 갱신 → ♻ 로 되살림 · `clear-longform-queue` · `test:chqueue`).
- 🛡 **E2E(`PM_UI_SMOKE=1`)의 큐 파일(workspace·last·saves)은 `%TEMP%\priming-smoke-workspace` 로 간다**(`workspaceDir()` · v0.6.59 — 새 E2E 는 반드시 `PM_UI_SMOKE` 를 켤 것). 🧪 **E2E 의 Electron 저장 공간(userData·localStorage)은 `%TEMP%priming-smoke-electron`**(bootstrap.js · v0.6.81) → **로이 앱을 켜 둔 채로 E2E 를 돌릴 수 있다**. ⚠ `~/.flow-app`(채널 목록 등)·`~/.priming-maker` 설정 파일은 여전히 같이 쓴다 — 임시 채널(`__…`)·임시 출력폴더를 쓰고 지운다.

## 5. 외부 서버 (메인 PC)

| 서버 | 주소 | 핵심 규칙 |
|---|---|---|
| **OmniVoice TTS·STT** | `:9881` · `D:\TTS_Model\omnivoice\`(자족형: env·hf·data·api.py) | 예약작업 `OmniVoice_Backend`(SYSTEM) → **`pythonw.exe -s start_server.pyw`**. 🔴 `-s` 없으면 사용자 site-packages 의 omnivoice 0.1.5 가 끼어 500. 🔴 pythonw 는 stdout 이 무효 → 런처가 파일 로그로 돌린다. api.py 는 저장소 밖(라이트 업데이트 안 됨) — 고치면 **관리자 권한으로 예약작업 재시작**. `X-API-Key` 필요(`tts/secret-store` 'omnivoice'.apiKey). `/busy` · `/languages`(646개) · `/ref-voices`(+ `deleted`) · `/save-ref-voice` · `/ref-voice-audio`(원본) · `/delete-ref-voice`(휴지통 `REF_LIB/_trash`) · `/voice-faces`·`/voice-face`·`/save-voice-face`(얼굴 공유 · `data/voice-faces`) · `/styles`(rev 잠금) · `/dict` · `/asr-upload`(whisper-large-v3-turbo). |
| 참조음성 라이브러리 | `D:\TTS_Model\ref-audio`(서버 공용 · 🗂 **서버가 있는 PC 는 앱도 이 폴더 하나를 그대로 쓴다** — `core/ref-voice.REF_DIR`/`isServerHost` · v0.7.35 · 아내 PC 만 `~/.flow-app/ref-audio` → 업로드 · ⛔ 시험·E2E 는 `PRIMING_REF_DIR` 없이 저장 경로를 부르지 말 것 — 진짜 라이브러리에 쓰인다) | 채널 값 `srv:<이름>` → 합성 때 이름만 보낸다(아내 PC 에 wav 불필요). 없는 이름·빈 참조텍스트는 **400**(조용히 Auto 목소리 금지). 앱 시작 4초 뒤 로컬 전용 wav 를 서버로 동기화(실패=null, 빈 목록과 구분). ⛔ 이름이 다른 동일 내용은 지우지 않는다(채널이 이름으로 가리킨다). |
| **ComfyUI 로컬** | `:8188` · 런처 `comfy/comfy-server.pyw` | 시작프로그램 「ComfyUI 서버 (Priming 이미지용).lnk」 → `<install>\ComfyUI\.venv\Scripts\pythonw.exe`(🔴 standalone-env 아님 — torch 없음). `--listen 0.0.0.0 --enable-manager --disable-auto-launch` + 모델 yaml. 설치 경로는 `%APPDATA%\Comfy Desktop\installations.json` 에서 찾는다. 웹 UI = 바로가기 「ComfyUI (웹)」(`comfy-open.pyw`), 「ComfyUI 서버 재시작」. ⛔ **Comfy Desktop 창으로 인스턴스를 열지 말 것**(서버 두 벌 → RAM 부족으로 장당 17배 느려진 사고 · 127.0.0.1 바인딩이라 아내 PC 원격도 죽는다). 생성 뒤 `/free` 로 VRAM 반납. |
| ComfyUI 클라우드 | `cloud.comfy.org` | `/api` 접두 + `X-API-Key`. 로컬노드 워크플로만(= 구독 GPU 시간). ⛔ **파트너 API 노드 워크플로 금지**(영상당 추가 과금). |
| 보이스디자인(Qwen) | `:9893` · `qwen-design/` | 지연 로딩 + 유휴 자동 해제. 앱은 서버를 죽이지 않고 `/release` 만. 바로가기로 pythonw 직접 실행(bat 금지 — 검은 창). |
| 방화벽 | Private 프로필 인바운드 9881·8188·9893 | Wi-Fi 가 Public 으로 바뀌면 LAN 이 막힌다(앱 문제 아님). 방화벽·네트워크 설정은 로이가 직접. |

## 6. 만들기 파이프라인 규칙

- 「⚡ 만들기」 = `runMakeAllCore`: 1 TTS → 2 이미지 → 3 비디오 → 4 출력(.vrew / 유튜브 MP4 / 화이트보드). 완성 버튼은 이것 하나(💾 .vrew·MP4 굽기·✏ 렌더 버튼은 없앴다 — IPC 는 남김).
- **병렬**: 로컬 GPU 를 쓰는 작업끼리는 겹치지 않는다. 레인 `_LANES = {tts, image, localGpu, upscale, flowBrowser, gensparkBrowser, whiteboard}` · `_runOnLanes`. TTS 는 항상 `localGpu`, 로컬 ComfyUI 이미지·비디오도 `localGpu`, 클라우드는 안 잡는다. 🔴 make-all 내부에서 `enqueue*Job` 을 다시 부르면 자기 자신을 기다려 교착 — 래퍼는 수동 버튼 경로에만. 남의 PC 가 쓰는 GPU 는 `awaitForeignComfyIdle`·`awaitForeignTtsIdle`(fail-open · 상한 10분).
- **게이트(빠진 채로 내보내지 않는다)**: `missingTtsNums`(파일 실재 + 크기 — 헤더만 44바이트 WAV 도 누락) · `missingVisualGroups`(imagePrompt 있는데 그림·영상 없음 · `imageStale` 포함) · `sweepBadVisuals`(검정·노이즈·색깨짐 + **그림 비율이 프로젝트 비율과 다름** 재검사, `.vrew` 직전 — 틀린 비율은 비우고 재생성). 막히면 팝업으로 어느 그룹인지 알린다. 두 경로(export-vrew · make-all 4단계) 모두.
- **출력 방식** `outMode`: 전체 / 🎤 음성만(`withoutVisuals` — 빌드 중에만 그림 참조를 비움, 파일은 안 지움) / 🖼 화면만(`withSilentTts` — 무음은 임시폴더, tts-N 오염 금지). 판정은 `gateVisual`/`gateTts`/`buildForMode` 한 곳.
- **큐(여러 대본) 설정 우선순위** — 헤더(공통)가 이기는 것과 항목이 이기는 것이 다르다:
  - 헤더 우선: 이미지·비디오 **도구**, 이미지 **스타일**, 출력 방식, 완성물 종류, Genspark 비디오 모델, 자막 서식.
  - 항목 우선(없으면 헤더 폴백): **채널**(없으면 헤더 채널 — ⛔ 기본 채널로 조용히 떨어지지 않게), 배속, AI 고지.
  - **영상 범위 = 대본마다 자기 범위**(`_itemRange`: 저장값 → 그 대본 도입부 끝 → G1). ⛔ 「미지정 = 전체 그룹」 금지(47개 영상 비용 사고). 큐 전체에 같은 범위는 ③ 비디오 「모두 적용」(`apply-range-all` — 누를 때만 · 확인창)으로만.
  - 대본을 열 때 헤더 채널을 그 항목에 박는다(`addItem` 은 settings **병합**). 🔴 모드·엔진 값 **정규화 함수가 선택을 조용히 되돌린 사고가 여러 번** 있었다 — 값을 추가하면 정규화하는 곳(App.jsx 2~4곳 + main run-batch)을 전부 grep.
- 🎬 **영상 만들 그룹 = 범위(N~M) 또는 방식(`vidSel`: 도입부 전체·도입부 홀수·도입부 1번+짝수(항상 1번 포함) · **직접 입력 `list:1,2,5,7` = 적은 번호 그대로**, 빈 입력 = 0개 · 헤더에 N~M 칸은 없다 · 기본 = 도입부 전체 · 우선순위 대본 > 채널 > 도입부 · 옛 vidFrom/vidTo 는 읽지 않는다)**(v0.6.60 · `core/video-select` 한 곳 · 채널 `vidSel` 이 헤더 기본값). 영상 대상을 세는 새 경로는 `rangeNums`/`matcher` 를 거칠 것(범위 직접 비교 금지).
- 🔒 **제작 경로(`runMakeAllBody`·`export-vrew`)는 시작 때 `runCtx = {parsed, scriptPath, outRoot}` 를 고정하고 이름·업로드 제목·배경음악에 넘긴다**(v0.6.98 — 제작 중 큐에서 다른 대본을 클릭하면 `S.*` 가 그 대본으로 바뀐다 · 1009 내용이 `[역사_1007]` 이름·제목으로 구워져 업로드된 사고). 고정 뒤 `S.scriptPath/parsed/outRoot` 읽기 금지 · `vrewBaseName`·`ytMetaFor` 는 ctx 와 함께(`test:runctx`).
- 중단: `S.abort` 는 main, 렌더러 큐 루프는 `queueAbortRef`. 새 작업 시작 시 반드시 `S.abort = false`. 중단 시 생성 중 표시(`clearGeneratingStatus`) 정리, 폴더·.vrew 자동 열기 안 함.
- ⏸ **「이번 편까지만」**(헤더, 큐 작업 중에만 보임 · v0.5.107): 만들던 대본은 끝까지 마치고 다음 대본부터 안 시작. main `_stopAfterItem` 은 **`S.abort` 와 별개 플래그**(합치면 「끝까지」가 「바로 멈춤」이 된다) — run-batch 시작·끝에서 풀고, 검사는 다음 대본 시작 **전**. `test:stopafter`.
- ⏭ **4단계 .vrew 는 입력 지문이 같고 파일이 기록 그대로면 건너뛴다**(v0.5.108 · `core/build-fingerprint` · 기록 `<출력>/.priming-build/`). `buildProjectVrew` 가 읽는 입력을 늘리면 **`P.vrewInputsOf` 에도 넣을 것**(빠뜨리면 바뀐 설정이 반영 안 된 채 건너뛴다 · `test:buildfp`). 판정은 fail-closed(실패 = 새로 만든다).
- ⬆ **⚡ 만들기가 MP4 를 다시 굽지 않고 넘어가도(「입력이 그대로」·「같은 이름 MP4 건너뛰기」) 자동 업로드 채널이면 업로드 관문으로 보낸다**(v0.6.97 · `uploadExisting` → `maybeAutoUpload` → `runYtUpload` 중복 관문 · `test:makeupload`) — 새로 「건너뛰는」 출구를 만들면 여기도 부를 것.
- 📂 **MP4 모드에서 저장 폴더에 같은 이름 MP4 가 있으면 `askMp4Exists` 로 묻는다**(v0.6.1 · 기본 건너뛰기 · 60초 무응답 = 건너뛰기 · 지문이 같으면 묻지 않음). 새 출력 경로를 만들면 같은 관문을 거칠 것.
- 📊 **진행 팝업**(v0.6.44): 셈은 `core/make-progress` 한 곳(메모리 필드만 — fs 금지), 끝은 `runMakeAllCore` finally 한 곳. 새 단계를 만들면 `_mk.begin/end` 를 달 것. 진행 팝업(만들기·MP4·업로드)은 **한 자리에 겹치고**(zIndex 뒤 단계가 위) 끝나면(실패 포함) 3초 뒤 닫힌다 — 🔴 타이머는 **팝업마다 따로**(`useAutoCloseProg` · 한 효과에 묶으면 1초마다 갱신되는 팝업이 남의 타이머를 지운다 · `test:progclose`).
- 작업 중 절전 차단 `withAwake`(참조 카운트). 완료 후 탐색기를 자동으로 열지 않는다(.vrew 만 연다).
- 🌙 모니터 끄기 감시(v0.5.102): 켜짐은 **전원 기록(566)의 새 RecordId**로 본다(입력 시각 API 는 137초 HID 켜짐을 못 본다 — 실측). **사람 = 키보드(31) 또는 커서 이동일 때만**, 그 밖은 다시 끈다(이유를 못 읽어도 사람으로 치지 않는다) · 8시간·최대 400회. 이 PC 는 끈 지 ~137초에 HID 보고로 켜지고 윈도우 화면 꺼짐 180초 순환(DP 모니터·커서 이동 아님).
- 헤더 버전 표시는 앞 「0.」을 뺀다(`v6.22`) — package.json 은 0.x.y 그대로. 🔢 **패치가 100 을 넘기기 전에 마이너를 올린다**(0.6.0 부터 · 헤더가 패치를 두 자리까지만 보여 5.113 이 5.11 로 잘렸다).
- 🌐 **롱폼/출판은 「세계」가 따로다**(v0.5.103 · `core/world-ctx.js`): `S.parsed·scriptPath·outRoot·preset·mode` 는 **호출이 시작된 세계**의 칸을 읽는다(AsyncLocalStorage). 새 IPC 는 기본이 **롱폼**, `book-*`·`open-book-*` 는 출판, 큐·모드·폴더처럼 화면을 따를 것만 `VIEW_FOLLOW_CHANNELS` 에 넣는다(렌더러가 여러 번 나눠 부르는 제작 루프는 `__world` 를 명시). 화면으로 DTO 를 밀 땐 `pushDtoUpdate`(보는 세계만 보냄)를 쓰고, 렌더러 `setDto` 는 다른 세계 DTO 를 버린다. ⛔ `S.mode = …` 를 세계 전환 용도로 새로 쓰지 말 것(열기 핸들러는 `WORLD.setView`). `npm run test:world`.
- 🔴 **`pushDtoUpdate`(전체 DTO 생성·전송)를 await 없는 반복 안에서 부르지 않는다** — 몰아서 끝에 한 번, 또는 1초 간격(`TTS_PROGRESS_GAP_MS`). 통합본 3,534문장 건너뛰기에서 응답없음(v0.5.84).
- 🔴 **메인 프로세스에서 동기 자식 프로세스(`execFileSync`) 금지** — 이미지 검사로 앱이 54초 얼었다. 검사는 비동기 + 결과 기억(`_visMemo`) + 동시 4개.
- G: 는 구글드라이브 스트리밍 — 순간 언마운트(16초)가 실제로 있었다. 쓰기·mkdir 은 `P.retryFs`(비동기 1·2·4·8·15초). ENOENT 도 일시 장애로 본다(쓰기 경로에서만).
- 밖에서 .md 가 바뀌면 1.5초 stat 감시로 자동 다시 읽기(`checkExternalScriptChange` — 작업 중엔 미룸, 🔴 비동기 판정 사이 대본이 바뀌었는지 `same()` 을 네 번 확인). 작업본 이어받기 판정은 **문장 시퀀스 비교 + `hashVer` 가 찍힌 해시만 신뢰**(savedAt 금지).

## 7. 기능별 규칙

### TTS
> 🔊 **TTS·목소리·음성 파일을 고치기 전에 [`docs/규칙/TTS.md`](docs/규칙/TTS.md) 를 먼저 읽는다**(목소리 우선순위·두 PC 공유·유료 엔진·요금·캐시 키·빈 음성·숫자 읽기 — 2026-10-09 원문 그대로 옮김).
- ⛔ 속도를 위해 `num_step` 등 품질 설정을 깎는 제안 금지(32) · ⛔ **리미터·압축 금지**(「지지지」 — 정규화는 피크 여유만큼) · 합성은 언제나 정속(배속은 ffmpeg `atempo`) · 결과가 이상하면 엔진보다 **참조음성부터** 의심.
- 🔑 TTS 텍스트 가공은 `processForTTS` 한 곳(⛔ 다른 곳에 가공 추가 금지) · 캐시 키 = 실제 합성 문자열 + 목소리·시드·배속·정규화·무음 — 설정을 더하면 캐시 키에 넣을지 판단 · 엔진 해석·요금은 `tts/tts-engines.js` 한 곳(새 TTS 입구는 preset 을 넘기고 `scriptVoicePreset` 을 거칠 것) · 채널은 `resolvePreset`(낡은 `S.preset` 금지).
- 🔴 TTS 는 직렬 큐 `enqueueTtsJob` · 빈 음성(헤더만)·무음 음성은 시드를 갈아 다시 만들고 게이트가 막는다 · 문장 사이 쉼은 음성 파일의 `apad`(⛔ vrew 에 빈 클립 금지) · 테스트의 정상 음성 픽스처는 소리가 든 WAV.

### 이미지
- 🆕 **Qwen-Image 2.1 Turbo (로컬)** = ComfyUI 워크플로 `comfy/image_qwen21_turbo.json`(v0.7.83 · 프롬프트는 `TextEncodeQwenImage21.prompt` · 1344x768 약 18초 · 서버 ComfyUI ≥0.39 + 모델 3개 필요 · 시험·비교 근거는 작업노트 2026-10). 인물 묘사 충실도는 Krea2 가 낫다 — 이 엔진으로 바꿀 때 인물 일관성을 눈으로 확인할 것.
- 엔진: **Flow(구독) · Genspark(구독) · ComfyUI(☁/🖥 × 워크플로) · 나노바나나(유료 API)**. **Flow 와 Genspark 는 완전히 분리 — 고른 엔진 하나만 돌고 서로 이어받지 않는다**(로이 2026-10-02 · 옛 「이어받기 끄기 없음」 확정을 뒤집음 · `image-rotation.activeOrder` 한 곳). 한도면 미생성으로 두고 게이트가 막는다.
- 🧥 **노출 방지 = 인물이 나오는 장면엔 `POS_MODEST`(옷차림 **긍정** 서술 — 부정문 금지) 자동**(v0.6.96 · `buildImagePrompt` 한 곳 · 사람 없는 장면엔 붙이지 않는다 — 사람을 그려 넣는다 · 판정 `PERSON_RE`) · ✍ 자동 작성 요청·대본 작성 가이드도 「옷차림 명시(필수)」. ⚠ 리모션 TSV 그림은 프롬프트를 가공하지 않으므로 해당 없음.
- 🎨 **화풍 = 헤더 스타일 목록의 「📜 대본스타일」(`__script__`)을 고른 때만 대본 `> 🎨 화풍: <id>` 를 쓴다**(v0.7.38 — 옛 「대본 > 헤더」 우선은 폐기 · 대본에 줄이 없으면 만들기 전 `runStyleId` 팝업 · `effStyleId` 한 곳 — 이미지 입구를 새로 만들면 반드시 거칠 것(렌더러는 `runStyleId`) · 캐시 키도 같은 값). id 로 찾는다(같은 이름 둘 있음) · 모르는 id = 경고 + 채널.
- 프롬프트 = `<스타일>, <대본 프롬프트>, …` 부정 절은 **맨 끝으로 모으고 중복 제거**(`normalizePromptNegations`) + 긍정 억제 표현. **항상 마침표로 끝낸다**(Krea2 CLIP 토큰 경계 버그 회피). 재시도·🔄 는 프롬프트 변형 단계를 번갈아 적용.
- 🔴 Krea2 Turbo 는 cfg=1 + negative ZeroOut → **네거티브 프롬프트는 무효**. 글자·잡물은 positive 긍정 서술로, 또는 대본에서 글자 있는 사물을 묘사하지 않는다.
- 이상 판정(`visualStats` rgb24 한 번 호출): 검정 = 평균밝기<10 · 노이즈 = 거칠기≥9 **AND** 구조≤12 · 색깨짐 = 형광 화소≥2.5% **AND** 색거칠기≥5(상수 `BAD_*`, main.js). 🔴 **사람이 첨부한 그림은 판정 제외**(`_userAttached` — `_visKey` 경로+mtime+크기) · 🔴 **`_inDir(media-N)` 밖 파일은 지우지 않는다**(첨부는 원본 경로를 가리킨다). 캐시에서 꺼낸 것도 검사하고 이상하면 캐시 항목까지 삭제.
- ComfyUI: 워크플로 번들(`comfy/*.json`, API 포맷)은 `_ensureBundled` 가 매번 등록·경로 복구. **모델 파일명 불일치는 자동 대체**(`comfy-models`: 정밀도 토큰만 뗀 이름이 같을 때만 — ⛔ turbo·distilled 같은 정체성이 바뀌는 대체 금지). 로컬 3060 은 fp8 에뮬레이션이라 int8/convrot 판으로 자동 교체. 이미지 동시 **클라우드 2 · 로컬 1**(상한 코드 고정 — 3 이상은 검정 유발). 이미지 출력에 안 이어진 가지(LLM 프롬프트 확장)는 걷어낸다. 채널 `imgEngine` 은 bare `comfy`(절대경로 고정 금지). 서버에 모델이 있는지는 로더 하나만 보지 말고 UNET·CLIP·VAE·LoRA·Checkpoint 옵션을 전부 본다(클라우드는 `/api/object_info` 통째 · 9.5MB 라 생성 경로에선 쓰지 않는다).
- `✕` 로 지운 그림은 `imageCleared`(스냅샷 저장) → 캐시에서 되살리지 않는다. 🔄 재생성은 영상이 있어도 이미지만 본다(`imgDone(g, force)`). 대상 0개면 그렇게 로그.
- 🔎 **무료 스톡(Pexels·Pixabay) = 검색은 `core/free-stock` 한 곳 · 넣기는 main `stock-attach` 한 곳**(v0.7.67) — 받은 파일은 `<출력>/_stock/`(media-N 밖 · 번호 이름 금지) · 사람이 고른 자산 표시 · 출처는 `스톡_출처.txt` · 키는 ⚙ API 키(secret-store `pexels`·`pixabay`) · ⛔ E2E 는 `global.__stockKeysTest` + 가짜 fetch 로(진짜 키·API 금지 · `test:stock`).
- 👤 **인물 일관성 = 나노바나나 즉시 생성 전용**(v0.6.94 · `core/char-refs` 한 곳): 대본 앵커 줄 인물 카드 → `<출력>/characters/<이름>.png` 시트 → 장면마다 이름-그림 쌍 참조 + 「나이·옷은 장면대로」 지시. ⛔ Krea2·Flow 에 붙이지 않는다(로이 실험 2026-10-05 — klein 참조·얼굴 보정 모두 기각, Krea2 + 카드 글 반복 유지). 카드 형식을 늘리면 `parseCards` 와 `test:charrefs` 에.
- 🌙 **나노바나나 2.1 = `gemini`(즉시 · 인물 참조) · `gemini-batch`(배치 · 반값 · 참조 불가)** — 배치 흐름·job 이어받기·429 분류 상세는 [`docs/규칙/나노바나나.md`](docs/규칙/나노바나나.md)(고치기 전에 읽는다) · 엔진 값을 더하면 `runRotatingImages`·헤더/채널 드롭다운 두 곳·`settingsTabForEngine` 함께 · 🛑 하루·무료·충전 한도면 재시도 없이 멈춘다(새 Gemini 입구도 `classify429` 규칙을 탈 것 · `test:g429`).
- Genspark 한도 메시지의 재설정 시각을 파싱해 계정 쿨다운(침묵 정체 3연속 = 추정 30분). 배지 = 리본 capbar 맨 앞.

### 비디오
- 엔진(🔴 Grok 구독·API 는 v0.7.38 에 목록에서 뺐다 — 옛 저장값은 「없음」으로 읽는다): **☁ ComfyUI LTX2.5(주력 · 1920x1088 직접 생성 → 업스케일 생략)** · ☁/🖥 MiniMax H3 레퍼런스 · 🖥 LTX2.3 · Grok(브라우저) · Grok API · Flow·Veo · Genspark · 없음. 드롭다운은 **헤더 + 채널편집 두 곳**(엔진 추가 시 둘 다).
- 대상 = 영상 범위 안에서 **이미지 있고 영상 없는** 그룹(이어받기). 직전에 `autoRelinkVideos`(폴더에 남은 `NN_1080.mp4`/`NN.mp4` 다시 잇기, `videoCleared` 는 제외).
- 업스케일은 해상도를 재서 목표 이상이면 생략, **못 재면 건너뛴다(fail-closed)**, `upscale` 전용 레인, auto 모드는 한 영상 5분 넘으면 ffmpeg 로 강등.
- 영상이 TTS 보다 짧으면 `video-fit`(≤1.3배 느리게 / 넘으면 반복+크로스페이드, 결과는 캐시 폴더 · 원본 불변). 🔴 **맞출 길이가 90초 넘으면 파일을 늘리지 않고 Vrew 반복 재생**(`endBehavior:'loop'`) — 18분짜리를 구워 Vrew 가 응답없음이 된 사고.
- 엔진별 노드·셀렉터·판정(LTX·MiniMax · Flow·Veo · Grok · Genspark)은 [`docs/규칙/비디오엔진.md`](docs/규칙/비디오엔진.md) — **엔진 코드를 고치기 전에 읽는다**. ⛔ Flow 동시 생성 안 함 · 첨부 실패면 그 컷을 만들지 않는다(크레딧 낭비 금지) · 🔴 Grok 본편 판정 = post UUID(사이드바의 남의 영상 금지) · ⛔ MiniMax 용 `<Picture 1>` 태그를 대본에 쓰게 하지 않는다.

### .vrew · MP4
- 🔴 캔버스 비율은 **web/shape 오버레이 트랙의 x좌표계**로 인식된다(미디어·자막은 스케일 안 함). 제목 web 트랙에 `assetEffectInfo` 금지(내보내기 실패).
- 자막 위치는 클립별 `captions[].style` 이 지배. 배경음악 = files `BGM` + tracks `type:'bgm'` + asset + **전 clip 링크**(넷 다 있어야 들린다). 트랙 zIndex = `stackRanks`(늘려 끌어온 그림이 위층).
- **유튜브 MP4 = `.vrew` 를 읽어 굽는다**(`core/vrew-render.js`). ⛔ 앱 모델에서 렌더 규칙을 다시 계산하지 않는다(두 벌이 된다). 보정값(글자 ×0.72 · 여백 공식)·함정(zoompan 좌표 · mp3 선언 길이 맞춤 · web 트랙 · 폭 1.008 미반영)은 작업노트 2026-09 「Vrew 없이 유튜브 MP4」. 인코딩 `-bf 0` + maxrate(켄번스 떨림), ⛔ `-aac_coder fast` 금지(음질). 투명 PNG 는 `yuva420p`. 소리 없는 영상은 `hasAudioStream` 으로 거른다. 새 트랙 종류가 생기면 렌더러도 그려야 한다.
- 📥 Vrew 음성 가져오기(`core/vrew-audio.js`): .vrew 는 **읽기만**. 음성 경로 = `clip.words[].assetIds → assets → tracks.mediaId → zip media/<mediaId>.*`(⚠ `files[].name` 은 사람용 이름 · `clip.assetIds` 엔 음성이 없다) · 자막은 `words` 우선(captions 는 남의 문장일 수 있다) · 문장부호 무시 매칭 · 한 문장 = clip 여러 개면 이어붙인다 · 게이트는 **쓴 clip 비율 80%**(일부만 만든 .vrew 는 통과).
- 🔴 **ffmpeg 에 SRT 를 물리면 384x288 좌표계로 3.75배 커진다** → 자막은 PlayRes 를 영상 해상도로 박은 ASS 로. 테스트는 1080 이상에서 화소로 잰다.
- 🏷 **로고 넣기/빼기 = 대본마다 `pr.logoOver{on, path?}`(삽입 리본 「큐 전체: …」 = 롱폼 큐 모두 · 채널 설정 불변 · v0.6.86)** — 실제로 얹을 로고는 `overlay-layers.effLogo(채널, pr)` 한 곳(빌드·지문·① 칸 같은 규칙) · `logoOptsOf` 는 꺼져 있어도 그림·크기를 돌려준다.
- 🏷 **채널 로고 자리 = 대본마다 `logoSide`(↗/↖) 또는 ① 칸에서 끌어 옮긴 `logoPos{x,y}`(이기는 쪽 · v0.6.85)** — 좌표 계산은 `overlay-layers.logoBox(pos)` 한 곳(.vrew 트랙 → MP4 는 .vrew 를 읽는다) · ↗/↖ 를 고르거나 기본 자리 14px 안에 놓으면 `logoPos` 를 푼다 · 작업본·되돌리기·빌드 지문(`vrewInputsOf` 의 `inp.logo.pos`)에 실려 있다.
- 📍 **채널 로고 기본 자리 = 채널 `logoX`·`logoY`(%)** — 자리 우선순위 = 대본이 끌어 옮긴 자리 > 대본 ↖ > 채널 기본 자리 > 오른쪽 위, 판정은 `overlay-layers.posOfLogo` 한 곳(.vrew·MP4·① 칸 · v0.7.71).
- 🎞 **화면 연출(켄번스 구간 · 디졸브 · 오버레이 모션 — 삼국지 R1~R3)은 [`docs/규칙/화면연출.md`](docs/규칙/화면연출.md)** — 고치기 전에 읽는다 · 전부 opt-in(기본값이면 예전 결과와 같다).
- 🏷 AI 고지 = 채널 `aiNotice{text, unit:time|clip, fromSec/toSec, fromClip/toClip}`(끝 0 = 끝까지) → `aiNoticeTiming` 한 곳(**core/visual-look** · v0.6.88 에 main 에서 옮김 · ① 칸 미리보기는 같은 규칙의 `aiNoticeOn` — MP4 와 같은 자리·크기) · 🏷 **AI 고지 모양 = 채널 `aiNotice.fmt`(자막과 같은 서식 키)·`pos{x,y}`** — 기본·해석은 `CF.aiNoticeFmt/aiNoticePos` 한 곳(① 칸 · .vrew) · **안 고친 고지(`aiNoticeEdited` 거짓)는 .vrew 를 예전과 한 글자도 다르지 않게** · MP4 는 상자 값이 `rgba(…)`(고친 고지)일 때만 글꼴·굵게·기울임·상자를 따른다 · ① 칸에서 고치는 채널 AI 고지는 `set-ai-notice` 로만 저장한다(되돌리기 상태에 채널 값 `st.preset` 이 실린다 — 채널 설정을 바꾸는 새 ① 칸 편집도 이 방식으로) · 대본 🏷 문장 범위가 이긴다 · 켜기는 작업바 토글.
- 유튜브 업로드 상세(연결·한도·중복 관문·챕터)는 [`docs/규칙/유튜브업로드.md`](docs/규칙/유튜브업로드.md) — 고치기 전에 읽는다. ⛔ 분석용 `adonairoy` 프로젝트 토큰·`client_secret_*.json` 원본을 쓰거나 저장소에 넣지 않는다 · 🛡 새 업로드 경로는 반드시 `enqueueYtUpload`(중복 관문 `runYtUpload` 우회 금지) · 공용 연결 PC 하루 상한 30편 · API 한도 하루 100편.
- 화이트보드 MP4: 장면 = 그룹(결정론 · 분할은 문장 경계), 주석은 있으면 건너뛰고 그림 지문(`imageSig`)이 바뀌면 영역 재추출, 굶는 영역은 배정 순서로 해결(`findStarved`), 음성은 장면 실측 길이에 맞춰 얹고, 완성물만 다운로드 폴더로. 벤더링 `whiteboard/` 는 여기서 고치지 않는다(상류 `D:\화이트보드` → PATCHES.md). 화풍 이미지 단계는 미완(후처리 우선). 장면 길이 = 그 장면 문장 TTS 합(A/V 싱크) · 영역 하나 2.5초 이상 · 화이트보드로 낼 대본은 H3 당 문장 6개 안팎(25~30초) · 앱 이미지 스타일(스케치 등)은 화이트보드와 충돌한다.

### 자막
> 📝 **자막을 고치기 전에 [`docs/규칙/자막.md`](docs/규칙/자막.md) 를 먼저 읽는다**(줄 나누기 DP · Claude 끊어 읽기 · 적용 범위 · 재생 막대 · 서식 조각·위치 · 글꼴 — 2026-10-09 원문 그대로 옮김).
- 🔑 줄 나누기는 `core/caption-splitter` **유일한 구현**(새로 부르는 곳은 끊어 읽기 marks 를 넘길 것 · `test:capmarks`) · 「모든 자막」 서식은 읽는 곳마다 `CF.withAll(capAll, capSpans, len)` · ⛔ 끊어 읽기에 haiku 금지 · ⛔ E2E 는 가짜 claude 없이 부르지 않는다 · 채널 편집 창에 새 값은 **읽기·저장 두 곳 다**(안 실으면 저장 때 지워진다).
- 🔴 **`core/*.js` 는 렌더러 번들에 들어간다 — CJS 런타임 참조(`require.main` 류 자기검사) 금지**(앱 화면이 백지가 된 사고).

### 🌏 다국어 (일본어·베트남어)
> 일본어·베트남어(참조음성·역대조·루비·글꼴)를 건드리기 전에 [`docs/규칙/다국어.md`](docs/규칙/다국어.md) 를 읽는다.
- 🔴 새 규칙은 **ja/cjk/vi 일 때만**(`core/lang.js` `detectLang` 한 곳) — ⛔ 한국어 경로를 바꾸지 않는다(바꾸면 `test:lang` [7]).
- 🔴 **참조음성은 어느 언어든(한국어 포함) 낱말 도중에 끝나면 안 된다** — 쉼에서 끊고 참조텍스트를 그 구간에 맞춘다(`cutRange`·`refTextForCut` — 안 그러면 끝 글자가 새 문장 앞에 샌다).

### 대본 · 편집 · 보기
> ✏ **대본 파싱·문장 편집·합치기/나누기·🟥 경험 표시·되돌리기·작업본을 고치기 전에 [`docs/규칙/대본편집.md`](docs/규칙/대본편집.md) 를 먼저 읽는다**(2026-10-09 원문 그대로 옮김 · 대본 형식 정본은 `docs/대본-작성-가이드.md`).
- ⛔ 「이미지 줄이 없으면 앞 그림」 식 암묵 규칙 금지 · .md 는 **그 범위만 치환 + 검증 재파싱 뒤에만** 쓴다 · 문장을 고치는 새 경로는 이력 `record` 를 거치고 끝에 `syncSnapshotNow()` · 🔴 화자가 바뀐 문장은 음성을 물려받지 않는다.
- ⛔ **분할·합치기에서 프롬프트·그림·음성을 비우지 않는다**(빈 그림·빈 음성 금지 — 이어 붙이기·쉼에서 자르기·visSpan) · 지우는 파일은 `.priming-undo/` 로 옮긴다 · 작업본 스냅샷은 지우지 말고 격리 · 통합본은 자산을 **복사**(⛔ 원본 참조 · ⛔ .vrew 자르기·합치기).
- 🟥 경험·🟨 해석 표시 문법은 채널사업부 화자 규약과 공유(바꾸면 알릴 것) · ⛔ E2E 는 `PM_ROY_BANK_DIR`·`PM_ROY_HOME` 없이 은행을 쓰지 않는다(로이의 진짜 은행) · 맞춤법 검사 ⛔ haiku·자동 저장마다 호출 · 대본 글자 수를 제목 줄에 적지 않는다.
- 🧩 **② 클립 칸·그룹 칸·클립 도구 막대의 화면 규칙**(막대 메뉴·숨김·스크롤 · 도입부 노랑 · AI 고지 팝업 · 체크박스 · 그룹 칸 · 재생 멈춤 · Home/End)은 [`docs/규칙/클립화면.md`](docs/규칙/클립화면.md) — **그 화면을 고치기 전에 읽는다**. 🔴 「막대가 안 보인다」는 코드가 지워졌다는 뜻이 아닐 수 있다(먼저 `test:cliptb`·`test:cliptbscroll` 로 재현) · E2E 는 `renderer/dist` 를 읽는다 — 화면 코드를 고치면 `npm run build:renderer` 뒤에 돌린다.

### 채널 · 스타일 · 공유
> ⚙ **채널 프리셋·채널 편집 창·⚙ 설정 팝업·API 키·이미지 스타일·목소리 분류·계정을 고치기 전에 [`docs/규칙/채널설정.md`](docs/규칙/채널설정.md) 를 먼저 읽는다**(2026-10-09 원문 그대로 옮김).
- 🔒 자격증명은 `safeStorage` 암호화(평문 저장 거부 · 렌더러로 비밀번호를 돌려주지 않는다) · API 키 원문을 로그·메시지에 싣지 않는다 · 키 검증은 `core/api-key-check.js` 한 곳(**읽기 전용·무료 GET 만** — 새 유료 키도 여기에) · 자동 로그인은 1회 시도 후 CAPTCHA/2FA 면 사람에게.
- 새 설정 칸은 ⚙ 설정 탭(ComfyUI · Flow · API 키 · 유튜브)에, 설명글은 `<Hint>` 로 · 채널 편집 「자막·분할」 탭은 스크롤 없이 한 화면 · ⛔ 채널 이름 유사도 자동 매칭 금지 · 채널 목록은 파일 순서 그대로(`srv:` 참조음성은 정규화에서 지우지 않는다) · 목소리 분류는 `tts/voice-tags.js` 한 곳(서버 공유).
- 🔄 **앱 안 업데이트 단추(헤더 ⟳) = 시작 때와 같은 `light-updater.applyUpdates` 한 곳**(v0.7.9) — 작업 중(`_awake.n`)·개발 실행·새 버전 아님이면 적용하지 않고, 파일을 바꾼 뒤에만 다시 시작한다. 업데이트 방식을 바꾸면 시작 경로와 단추 경로를 함께 본다(`test:update`). 앱 이름 클릭은 고정 주소(`open-tube-site`) 하나만 연다.

### 브라우저 자동화 공통
- 크롬 실행 실패 = 프로필 정리(`core/chrome-profile.cleanProfile` — 락 + `exit_type`) 후 1회 재시도 → 번들 Chromium → 사람 말 오류. 번들 설치는 ⚙ 계정 「⬇ 브라우저 설치」(⛔ `npx playwright install` 은 버전이 달라 소용없다).
- 접속 대기는 `load` + 준비 신호 폴링(⛔ `networkidle` 금지 — SPA 는 닿지 않는다). 셀렉터를 못 찾으면 화면 상태를 덤프(`[DUMP …]`)해 로그로 — 다음 수정의 근거.
- 다운로드는 새 탭(about:blank)을 남긴다 → 전송이 끝난 뒤 `_closeBlankTabs`. ⛔ 앱 밖에서 같은 프로필을 열지 말 것. ⛔ 모더레이션을 우회하지 않는다(순환이 정답).

### STT · 받기
- STT 입력은 **mp3·wav·flac 만 직접**, 그 밖은 `transcribeLong` 입구에서 mp3 변환(화이트리스트 — ⛔ 확증 없이 넓히지 말 것). 청크 0.3초 미만 꼬리는 버린다.
- 📥 대본다운(yt-dlp): 60일 넘은 판이면 최신 exe 자동 설치(구판은 오디오 403) · `--no-playlist` · `--windows-filenames`(⛔ `--restrict-filenames` 금지 — 한글 제목 삭제) · 자막 우선(원본 언어 `-orig`, 번역 자막 금지, 롤업 중복 제거) · 비메오는 로그인 요구면 플레이어 주소로 재시도 · 받기와 전사를 겹치되 전사는 한 번에 하나 · 채널 전체는 편수 확인 · .txt 머리말(1줄 주소 · 2줄 제목 · 빈 줄).
- 🎵 mp3 추출은 ID3v2.3(스마트폰 한글 태그).
- 📥 **받기·전사·mp3 추출은 제작과 중단 플래그·GPU 를 따로**(v0.5.104): 자기 플래그 `_dlAbort`(받기 패널 ⏹ = `dl-abort`), ⛔ 이 핸들러들에 `S.abort` 를 다시 쓰지 말 것 · 전사만 `localGpu` 레인(TTS 와 직렬). 헤더 버전은 `shortVer`(v5.10).

### 리모션 · 출판
> 📖 **출판·리모션 코드를 고치기 전에 [`docs/규칙/출판.md`](docs/규칙/출판.md) 를 먼저 읽는다**(조판·판권·표지·ePub·부크크 등록 자동 입력 규칙 전부 — 2026-10-09 이 문서에서 원문 그대로 옮김).
- ⛔ 부크크 자동 입력은 **입력·파일 첨부까지만** — 저장·5단계 「도서제출」·유통 신청·최종 입점 클릭 금지(테스트가 소스로 검사) · 판매 등록·ISBN·최종 제출은 로이 몫 · 종이책+전자책 한 번에 **등록**은 없다(항상 종이책 먼저).
- ⛔ 부크크 글꼴은 이 PC 의 `_공통\부크크자료\글꼴` 에서 읽기만(`assets/fonts/book` 복사·동봉 금지) · 그 밖의 글꼴도 로이 승인 없이 동봉하지 않는다.
- 규격(용지·책등·날개)은 main `bookSpec()` 한 곳 · 출력 폴더는 `bookOutRoot` 한 곳 · 원고 메타 문법(`날개`·`[앞날개]` 등)을 바꾸면 출판 세션에 알린다 · 리모션은 전용 TTS 캐시(⛔ 공용 캐시 — 롱폼 타이밍이 깨진다).

## 8. 코딩 함정 (이 환경에서 실제로 밟은 것)

- 🔴 **미정의 식별자는 빌드·단위테스트가 못 잡는다**(`imgEngine`·`onPickImgEngine`·`label`·`failCount` 사고). main.js 를 고치면 **`npm run test:makeall`(무음 E2E, 20초)** 을 반드시 돌린다. 함수 블록을 지울 땐 아래 어디까지 지워지는지 눈으로 확인.
- 🔴 **셸이 역슬래시·백틱을 먹는다**(heredoc·`node -e` 에서 `\b`→0x08, `\n`→줄바꿈, `'\0'` NUL). 백슬래시가 든 코드는 **Write/Edit 도구**로, 편집 뒤 제어문자 검사. 한글 파일명 비교는 node 로(PowerShell 5.1 은 ANSI 로 읽는다).
- 줄끝: `.gitattributes` `* text=auto eol=lf` → 커밋 blob 은 LF. `flow-engine.js` 작업 사본은 CRLF 유지(테스트가 단언 · `git stash pop` 후 LF 로 바뀌면 되돌린다). 원문을 `\n` 으로 자르는 테스트는 먼저 정규화. ⛔ `grep -c $'\r'` 로 재지 말 것(Git Bash 에서 글자 r 을 센다).
- ⚡ **목록(Cards)은 그룹마다 `MemoCut` — 열쇠(`cutKey`)가 같으면 다시 그리지 않는다**(v0.5.95). 그룹 모양에 새 값을 쓰면 **`cutKey` 에 넣을 것**(안 넣으면 바뀌어도 화면이 그대로) · 그룹 안 처리기는 **안정 래퍼 `_S`·`_E` 로만**(옛 렌더의 함수·상태를 쓰지 않게) · 줄 번호·순번은 누르는 순간 DOM(효과가 고쳐 둔 `data-ln`·`data-ord`)에서. 응답으로 DTO 를 돌려주는 명령은 `pushDtoUpdate` 대신 `dtoByReply`(같은 DTO 두 번 = 두 번 다시 그리기). `test:editspeed` 가 다시 그린 그룹 수를 센다.
- React: ⛔ `setState` 직후 그 state 를 읽지 않는다(값을 직접 넘긴다) · 한 번 만든 클로저(`onended` 등)에서 state 읽지 않는다 · ⛔ 제어 checkbox/radio 의 click 에서 `preventDefault` 금지 · 편집면(contentEditable)은 React 가 다시 그리지 않게 고정 · 한글 조합 중(`isComposing`)엔 저장·Enter 처리 안 함 · 서식 막대는 mousedown 을 막아 초점을 지킨다.
- 비동기 재생·루프는 **번호표**(`playGenRef` 식)로 「내가 아직 현재 작업인가」를 확인한다 — 멈춘 옛 재생의 await 가 깨어나 새 재생을 닫은 사고. 대본 전환 전 밀린 자동저장을 먼저 쓴다(`syncActiveToS` → `flushAutoSave`).
- 목록에 `<video>` 를 수백 개 두지 않는다(Chromium 플레이어 한도 ≈75 — 썸네일은 `video-frame` 한 장 이미지). 렌더 예외는 `ErrorBoundary` + `window.onerror` 가 로그창(`🐞 화면 오류`)에 남긴다.
- Electron `findInPage(text, {findNext})` 의 findNext 는 「새 세션을 시작하는가」다(true = 새 검색). 타이핑은 디바운스. 🔴 **검색창 자기 글자도 일치로 잡혀 입력창을 선택·포커스를 가져간다** — 결과마다 자기 일치 건너뛰기 + 포커스·캐럿 복구 + 개수 −1(App.jsx `onFindResult`, `test:find`).
- Electron: 모달 대화상자는 부모 창을 앞으로 끌어온 뒤 연다(숨으면 입력 전체가 잠긴다 — 10초 넘게 잠기면 자동 해제 + 🩹 로그) · `media://` 는 **자르기 → 디코드** 순(경로의 `#`) · 스트리밍 응답(동기 읽기 금지) · 클립보드는 main 에서 읽는다 · `app.getVersion()` 은 라이트 업데이트 전 값이라 디스크의 package.json 을 읽는다.
- pythonw 로 띄우는 서버는 파일 로그 필수(stdout 무효 → 조용히 죽음). bat 에서 `start` 금지, bat 은 ASCII 만(cmd 는 CP949 로 읽는다). 백그라운드 상시 실행은 바로가기 대상을 pythonw 로 직접.
- ffmpeg 필터에 경로를 넣지 않는다(드라이브 콜론·한글) — cwd 를 작업폴더로 두고 ASCII 파일명만. ffmpeg 필터 기본값은 `-h filter=<이름>` 으로 확인(alimiter auto level 사고).
- `readImageSize` 는 `{w, h}` 를 돌려준다(`width` 로 읽어 검증이 통째로 죽은 사고). 번호를 한꺼번에 바꿀 땐 **두 단계**(전부 임시 이름으로 비킨 뒤 제 번호로) — 「높은 번호부터」는 번호가 늘 때만 맞고, 줄어드는 합치기에선 이웃 그림을 치운다(아내 PC 그림 전부 소실, v0.5.85). 휴지통 `.priming-undo` 는 7일 보관(통째로 지우지 않는다). 줄 인덱스로 블록을 자를 땐 시작·끝을 둘 다 단언한다.
- 🔒 **그림·영상·음성을 새로 쓰는 자리는 전부 `P.claimPath`** 를 거친다(번호 이름은 합치기·나누기 뒤 이웃 것일 수 있다 — 자기 파일이 아니면 `NN_2` 로 비켜 쓴다). 번호로 다시 잇는 곳은 `_usedByOther` 로 남의 파일을 거른다. 새 쓰기 자리를 만들면 `test:isolation` [3] 이 잡는다. 📥 엔진 다운로드는 %TEMP% 가 아니라 `<대본 폴더>/_받기`(못 옮긴 파일은 지우지 않는다).
- 🔴 **`git worktree remove` 는 node_modules 를 junction/symlink 로 이은 작업트리에 쓰지 않는다** — 링크를 따라가 원본을 지운다(2026-10-01 · 작업노트 2026-10). 비교 실행이 필요하면 링크를 `rmdir` 로 먼저 끊거나 `git stash` 로.
- 「같은 일을 하는 코드가 여러 곳」이 이 저장소의 단골 사고다 — 정규화·저장 경로·성공 후처리·드롭다운·판정 함수를 **한 곳으로 모으고**, 추가할 땐 grep 으로 개수를 세는 테스트를 둔다. 설정을 추가했으면 **그 값을 읽는 곳이 있는지** grep(「문장무음」은 읽는 코드가 0이었다).
- 판정은 fail-closed(내보내기 게이트·업스케일 측정)와 fail-open(진단·경고·서버 대기)을 구분해 정한다. 조용히 틀리는 쪽보다 막고 알리는 쪽을 택한다.

## 9. 테스트

- 원칙: **원문 함수를 뽑아 실행**(복사본 금지) · A/B 역검증(고치기 전 코드로 되돌리면 실패하는지) · 판정력 검증(틀린 입력이 실제로 다르게 나오는지 — 헛단언 방지) · 실측 가능한 것은 실측(ffmpeg 화소·volumedetect·ASR).
- 필수 회귀: main.js 수정 → `test:makeall` · 화면 수정 → `test:workspace` · 자막 → `test:caption`·`test:capfmt` · TTS → `test:tts` · ComfyUI → `test:comfy` · 출력 → `test:mp4`·`test:vrewaudio`.
- 스크립트 목록은 `package.json`(test:* 40여 개). 알려진 기존 실패: `img-rotate-resume`(27/34 — v0.3.84 부터, 원인 미확정) · `remotion-ui.smoke` 채널편집 대기 타임아웃 · `comfy-video-minimax` 의 「기본 활성」 단언(로이 PC 설정을 읽음).
- 🔴 E2E 는 큐 파일(PM_UI_SMOKE → TEMP)·Electron 저장 공간(→ TEMP)을 로이 앱과 나눴다. 채널 목록 파일(`~/.flow-app/tts-presets.json`)은 같이 쓰므로 전후 백업·비교를 권한다(v0.5.79 사고 계열). 헤더에 버튼을 더하면 **대본을 연 상태**의 1366px 한 줄을 본다(`test:workspace`).
- 버튼·라벨을 고치면 그 라벨·title 로 찾는 테스트를 함께 grep 한다(완전 일치 선택자가 조용히 깨진 사고 여러 번). 화면 배치 검증은 `elementFromPoint` 로 **실제로 눌리는지**까지 본다.
- E2E 는 Playwright `_electron` · `app.evaluate` 로 `dialog.showOpenDialog` 를 스텁해 실제 파일을 연다. E2E 는 상태를 바꾸는 블록을 뒤에 둔다.

## 10. 로이 확정 결정 (⛔ 다시 꺼내지 말 것)

- 모드는 롱폼/리모션/출판. 쇼츠·플리·ACE-Step 생성 제거(2026-08-22). 내부 이름(`shortsNum`·`shortsDirs`·`~/.shots-maker`)은 유지.
- Flow 동시 생성 안 함(2026-08-29). Flow/Genspark 이어받기 **폐기**(2026-10-02 — 완전 분리). 모델 파일명 `krea2Int4Convrot…` 바꾸지 않음(int4 는 로컬 전용).
- 비디오 로컬 항목 유지(여유 있을 때 MiniMax turbo4). 기본 비디오 = ☁ LTX2.5. LTX2.5 t2v 도입 안 함(파트너 과금·대본 비호환).
- TTS = OmniVoice 유지(CosyVoice3 A/B 기각 · 3~4배 느림). 품질 설정 축소 금지.
- 그룹 영상 음소거 유지(내레이션과 겹침) — 삽입 영상만 소리.
- 레인 분리(같은 모드 안 대본 간 동시 진행) 안 함 — 모드(롱폼/출판) 안에선 `S.parsed` 슬롯 1개라 대본이 섞인다. **모드끼리는 분리됨**(v0.5.103 세계 분리 — 제작 중에도 출판 탭 자유).
- 사람이 첨부한 그림은 기계 판정으로 지우지 않는다.
- 🖼 그룹 그림 범위 선은 문장 단위(➕ 삽입만 클립 단위).
- 로컬 이미지 주력 = **Krea2 + 인물 카드 글 반복 유지 · Qwen-Image-2.1 은 도입 안 함**(2026-10-07 — 속도 Krea2 약 17초 대 Qwen 52초·참조 90초 · 인물 시트 참조는 klein 때처럼 옷·시선이 샌다 · 작업노트 2026-10).
- 프로그램(Priming) ↔ 콘텐츠(아도나이로이) 역할 분리(2026-09-26) — 콘텐츠·채널 기획은 아도나이로이 세션, 코드는 이 저장소 세션.

## 11. 진행 중 · 실물 미검증

- 🌏 일본어·베트남어(v0.5.76~78): 참조음성 4개 등록·역대조 검증 완료. 원어민 청취 검수 · Vrew 에서 일본어 자막 표시 · 5천 클립 .vrew 를 Vrew 로 여는 것은 실물 확인 대기. 루비 문장을 앱에서 고치면 읽기(ttsText)가 사라진다(대본에서 고칠 것). 콘텐츠 판단은 아도나이로이 「다음 작업」 세션.
- Vrew 실물 확인 대기: 줄별 자막 서식·효과, 일부 clip 에만 건 bgm 트랙, 배경음악(업데이트 후).
- 화이트보드 3단계(화풍 이미지) 미착수 · 확인 그림 일부 실패 원인 미확정.
- Flow 비디오 새 UI 의 진행률·다운로드 메뉴 실물 미검증(첨부까지 확인).
- 큐의 대본별 영상 범위(v0.5.73) 실사용 확인 — 로그 `🎬 영상 범위 G1~G3 (도입부 기본)`.
