# Priming — 규칙과 지도

> 이 폴더에서 여는 모든 세션에 통째로 실리는 문서다. **지금 유효한 규칙·금지선·구조만** 둔다.
> 경위·실측 수치·버전별 기록은 [`docs/작업노트/`](docs/작업노트/) 에 **원문 그대로** 있다(2026-09-26 슬림화 전 CLAUDE.md 전체 = 557,605자).

## 0. 이 문서에 무엇을 두나

| 둔다 (여기) | 옮긴다 (docs/작업노트/<월>.md) |
|---|---|
| 지금 규칙 · 🔴 금지선 · ⛔ 로이 확정 결정 | 원인 추적 과정 · 실측 표 · 전후 비교 |
| 모듈 지도 · 폴더·설정 위치 · 서버 포트 | 버전별 변경 내역 · 검증 단언 개수 |
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
  - 설치본 버전 확인: `%LOCALAPPDATA%\Programs\priming\resources\app\package.json`. 발행 직후 「안 된다」면 먼저 이걸 본다(CDN 이 옛 매니페스트를 준 적 있음 — 한 번 더 재시작).
- 로그: `~/.shots-maker/logs/YYYY-MM-DD.log`(KST · 7일 보관 · 화면 줄은 `[화면]` 접두). 로그창 「📁 파일」. 엔진(Flow 등) 로그도 파일로 후킹돼 있다.

## 3. 모듈 지도

| 영역 | 파일 |
|---|---|
| IPC·오케스트레이션·큐·게이트·레인 | `main.js`(권위 상태 `S`) · `preload.js` |
| 파싱 | `core/parsers/longform-parser.js` · `core/sentence-splitter.js`(🔑 문장 규칙 정본, `MATCH_PATTERNS`) · `core/group-builder.js` · `core/project-model.js` |
| 공용 파이프라인 | `core/pipeline.js`(parseScript·toDTO·fillTts·buildProjectVrew·retryFs·buildImagePrompt) |
| 대본 편집·보기 | `core/script-edit.js`(문장 범위 치환) · `core/script-reader.js`(대본 보기·A4 PDF) · `core/group-merge.js` · `core/visual-span.js`(그림 범위·레이어) · `core/visual-look.js` · `core/overlay-layers.js`(삽입·로고) |
| 자막 | `core/caption-splitter.js`(🔑 줄 나누기 **유일한 구현** — 렌더러 `renderer/src/lib/captions.js` 는 re-export) · `core/caption-format.js`(서식 모델) · `core/caption-ass.js` · `core/caption-anim*.js` · `core/font-store.js` |
| TTS | `tts/tts-manager.js`(싱글톤) · `tts/providers/omnivoice-provider.js` · `tts/text-pronouncer.js`(🔑 `processForTTS` = TTS 텍스트 가공 유일한 문) · `tts/preset-store.js`(채널) · `core/tts-cache.js` · `core/audio-normalize.js` · `tts/asr-client.js`(STT) |
| 이미지 | `core/comfy-image.js` · `core/comfy-models.js`(모델 자동 대체) · `core/comfy-perf.js` · `genspark-engine.js` · `flow-engine.js`(⚠ CRLF 파일) · `core/image-rotation.js` · `core/style-store.js` · `core/media-cache.js` |
| 비디오 | `core/comfy-video.js` · `grok-engine.js` · `core/grok-api.js` · `flow-engine.js`(Veo) · `genspark-engine.js`(비디오) · `core/video-fit.js` · `core/upscaler.js` |
| 출력 | `vrew/vrew-builder.js`(.vrew) · `core/vrew-render.js`(.vrew → MP4) · `core/whiteboard-*.js` + `whiteboard/`(벤더링) · `core/premiere-xml.js` · `core/youtube-upload.js`·`yt-packaging.js`·`yt-chapters.js` |
| 리모션 | `core/tsv-tts.js` · `core/tsv-images.js` · `core/audio-trim.js` · `renderer/src/RemotionView.jsx` |
| 출판 | `core/book/*`(parser·html-builder·pdf-builder·epub-builder·spine-calc·isbn-barcode) · `renderer/src/BookView.jsx` |
| 받기·STT | `core/media-download.js`(yt-dlp) · `core/merge-assets.js`(통합본 이어받기) · `core/vrew-audio.js`(Vrew 음성 가져오기) |
| 화면 | `renderer/src/App.jsx`(헤더·리본·모달) · `Workspace.jsx`(① 영상 ② 클립 ③ 설정 3칸 · 🔑 `buildProjLines` = 줄 번호 정본) · `CaptionFormat.jsx` · `ScriptReader.jsx` |

## 4. 폴더 · 설정 위치

- 출력: `<채널 출력폴더>/<대본이름>/` 아래 **`media-N`(그림·영상 `NN.png`·`NN.mp4`·`NN_1080.mp4`) · `tts-N`(`<문장번호>.wav/mp3`) · `subtitles-N`** + 루트 `.vrew`. 롱폼은 N=1(`shortsNum`·`shortsDirs` 이름은 옛 쇼츠 잔재 — ⛔ 바꾸지 말 것, 스냅샷·IPC 키다).
- `~/.shots-maker/` 앱 상태(logs · tts-cache · electron userData · anti-detect) · `~/.priming-maker/` 설정(projects/*.smproj.json = **작업본, ⛔ 지우지 말 것** · comfy-*-config · *-accounts · image-rotation · youtube-auth · workspace.json) · `~/.flow-app/` TTS 채널·참조음성·스타일(`tts-presets.json`·`styles.json`·`channel-styles.json`).
- 작업본(.smproj) 키 = **대본 파일명**(경로 아님). 대본을 옮겨도 이름이 같으면 이어받는다.
- 🔑 **테스트는 로이 앱과 같은 userData·localStorage 를 쓴다** — 보기 설정·채널·workspace 를 바꾸는 E2E 는 적어 두고 끝날 때 되돌린다. 임시 채널·임시 출력폴더를 쓰고 지운다.

## 5. 외부 서버 (메인 PC)

| 서버 | 주소 | 핵심 규칙 |
|---|---|---|
| **OmniVoice TTS·STT** | `:9881` · `D:\TTS_Model\omnivoice\`(자족형: env·hf·data·api.py) | 예약작업 `OmniVoice_Backend`(SYSTEM) → **`pythonw.exe -s start_server.pyw`**. 🔴 `-s` 없으면 사용자 site-packages 의 omnivoice 0.1.5 가 끼어 500. 🔴 pythonw 는 stdout 이 무효 → 런처가 파일 로그로 돌린다. api.py 는 저장소 밖(라이트 업데이트 안 됨) — 고치면 **관리자 권한으로 예약작업 재시작**. `X-API-Key` 필요(`tts/secret-store` 'omnivoice'.apiKey). `/busy` · `/languages`(646개) · `/ref-voices` · `/save-ref-voice` · `/styles`(rev 잠금) · `/dict` · `/asr-upload`(whisper-large-v3-turbo). |
| 참조음성 라이브러리 | `D:\TTS_Model\ref-audio`(서버 공용) | 채널 값 `srv:<이름>` → 합성 때 이름만 보낸다(아내 PC 에 wav 불필요). 없는 이름·빈 참조텍스트는 **400**(조용히 Auto 목소리 금지). 앱 시작 4초 뒤 로컬 전용 wav 를 서버로 동기화(실패=null, 빈 목록과 구분). ⛔ 이름이 다른 동일 내용은 지우지 않는다(채널이 이름으로 가리킨다). |
| **ComfyUI 로컬** | `:8188` · 런처 `comfy/comfy-server.pyw` | 시작프로그램 「ComfyUI 서버 (Priming 이미지용).lnk」 → `<install>\ComfyUI\.venv\Scripts\pythonw.exe`(🔴 standalone-env 아님 — torch 없음). `--listen 0.0.0.0 --enable-manager --disable-auto-launch` + 모델 yaml. 설치 경로는 `%APPDATA%\Comfy Desktop\installations.json` 에서 찾는다. 웹 UI = 바로가기 「ComfyUI (웹)」(`comfy-open.pyw`), 「ComfyUI 서버 재시작」. ⛔ **Comfy Desktop 창으로 인스턴스를 열지 말 것**(서버 두 벌 → RAM 부족으로 장당 17배 느려진 사고 · 127.0.0.1 바인딩이라 아내 PC 원격도 죽는다). 생성 뒤 `/free` 로 VRAM 반납. |
| ComfyUI 클라우드 | `cloud.comfy.org` | `/api` 접두 + `X-API-Key`. 로컬노드 워크플로만(= 구독 GPU 시간). ⛔ **파트너 API 노드 워크플로 금지**(영상당 추가 과금). |
| 보이스디자인(Qwen) | `:9893` · `qwen-design/` | 지연 로딩 + 유휴 자동 해제. 앱은 서버를 죽이지 않고 `/release` 만. 바로가기로 pythonw 직접 실행(bat 금지 — 검은 창). |
| 방화벽 | Private 프로필 인바운드 9881·8188·9893 | Wi-Fi 가 Public 으로 바뀌면 LAN 이 막힌다(앱 문제 아님). 방화벽·네트워크 설정은 로이가 직접. |

## 6. 만들기 파이프라인 규칙

- 「⚡ 만들기」 = `runMakeAllCore`: 1 TTS → 2 이미지 → 3 비디오 → 4 출력(.vrew / 유튜브 MP4 / 화이트보드). 완성 버튼은 이것 하나(💾 .vrew·MP4 굽기·✏ 렌더 버튼은 없앴다 — IPC 는 남김).
- **병렬**: 로컬 GPU 를 쓰는 작업끼리는 겹치지 않는다. 레인 `_LANES = {tts, image, localGpu, upscale, flowBrowser, gensparkBrowser, whiteboard}` · `_runOnLanes`. TTS 는 항상 `localGpu`, 로컬 ComfyUI 이미지·비디오도 `localGpu`, 클라우드는 안 잡는다. 🔴 make-all 내부에서 `enqueue*Job` 을 다시 부르면 자기 자신을 기다려 교착 — 래퍼는 수동 버튼 경로에만. 남의 PC 가 쓰는 GPU 는 `awaitForeignComfyIdle`·`awaitForeignTtsIdle`(fail-open · 상한 10분).
- **게이트(빠진 채로 내보내지 않는다)**: `missingTtsNums`(파일 실재 + 크기 — 헤더만 44바이트 WAV 도 누락) · `missingVisualGroups`(imagePrompt 있는데 그림·영상 없음 · `imageStale` 포함) · `sweepBadVisuals`(검정·노이즈·색깨짐 재검사, `.vrew` 직전). 막히면 팝업으로 어느 그룹인지 알린다. 두 경로(export-vrew · make-all 4단계) 모두.
- **출력 방식** `outMode`: 전체 / 🎤 음성만(`withoutVisuals` — 빌드 중에만 그림 참조를 비움, 파일은 안 지움) / 🖼 화면만(`withSilentTts` — 무음은 임시폴더, tts-N 오염 금지). 판정은 `gateVisual`/`gateTts`/`buildForMode` 한 곳.
- **큐(여러 대본) 설정 우선순위** — 헤더(공통)가 이기는 것과 항목이 이기는 것이 다르다:
  - 헤더 우선: 이미지·비디오 **도구**, 이미지 **스타일**, 출력 방식, 완성물 종류, Genspark 비디오 모델, 자막 서식.
  - 항목 우선(없으면 헤더 폴백): **채널**(없으면 헤더 채널 — ⛔ 기본 채널로 조용히 떨어지지 않게), 배속, AI 고지.
  - **영상 범위 = 대본마다 자기 범위**(`_itemRange`: 저장값 → 그 대본 도입부 끝 → G1). ⛔ 「미지정 = 전체 그룹」 금지(47개 영상 비용 사고).
  - 대본을 열 때 헤더 채널을 그 항목에 박는다(`addItem` 은 settings **병합**). 🔴 모드·엔진 값 **정규화 함수가 선택을 조용히 되돌린 사고가 여러 번** 있었다 — 값을 추가하면 정규화하는 곳(App.jsx 2~4곳 + main run-batch)을 전부 grep.
- 중단: `S.abort` 는 main, 렌더러 큐 루프는 `queueAbortRef`. 새 작업 시작 시 반드시 `S.abort = false`. 중단 시 생성 중 표시(`clearGeneratingStatus`) 정리, 폴더·.vrew 자동 열기 안 함.
- 작업 중 절전 차단 `withAwake`(참조 카운트). 완료 후 탐색기를 자동으로 열지 않는다(.vrew 만 연다).
- 🔴 **메인 프로세스에서 동기 자식 프로세스(`execFileSync`) 금지** — 이미지 검사로 앱이 54초 얼었다. 검사는 비동기 + 결과 기억(`_visMemo`) + 동시 4개.
- G: 는 구글드라이브 스트리밍 — 순간 언마운트(16초)가 실제로 있었다. 쓰기·mkdir 은 `P.retryFs`(비동기 1·2·4·8·15초). ENOENT 도 일시 장애로 본다(쓰기 경로에서만).
- 밖에서 .md 가 바뀌면 1.5초 stat 감시로 자동 다시 읽기(`checkExternalScriptChange` — 작업 중엔 미룸, 🔴 비동기 판정 사이 대본이 바뀌었는지 `same()` 을 네 번 확인). 작업본 이어받기 판정은 **문장 시퀀스 비교 + `hashVer` 가 찍힌 해시만 신뢰**(savedAt 금지).

## 7. 기능별 규칙

### TTS
- 합성은 **언제나 정속**, 배속은 ffmpeg `atempo`(OmniVoice `speed` 는 느린 방향으로 듣지 않는다). 채널 배속 정본은 `speedLong`(옛 `speed` 필드는 방치값).
- 필터 순서 **배속 → 증폭 → 문장 뒤 무음(`apad`, 채널 「문장무음」)**. ⛔ **리미터·압축 금지**(84Hz 저음 주기보다 짧은 어택이 파형을 찌그러뜨려 「지지지」) — 음량 정규화는 피크 여유만큼만 올린다(목표 -15dB). 음량이 부족하면 **참조음성을 크게 녹음**.
- ⛔ 속도를 위해 `num_step` 등 품질 설정을 깎는 제안 금지(32 유지).
- 🔑 **참조음성이 결과의 거의 전부를 정한다** — 억양 폭·음량·숨·끝맺음·발화 속도가 1:1 로 복제된다. 결과가 이상하면 엔진보다 참조음성부터. 숨 제거는 `scripts/breath.py --lead-ms 20` 또는 발화 덩어리만 재조립.
- 캐시 키 = **`processText`(실제 합성될 문자열)** + 목소리(`rn`)·시드·배속·정규화 목표·무음(0 이면 필드 생략 = 기존 캐시 보존). 설정을 추가하면 캐시 키에 넣을지 판단(안 넣으면 옛 음성이 되살아난다).
- 🔴 빈 음성(헤더만) 방지 3겹: provider `measureWav` → `assertRealAudio`(재시도 루프 **안**) → 게이트 크기 검사 + 캐시에 넣지 않음. 빈 음성이면 **시드를 무작위로 갈아** 최대 6회(±1 은 소용없다).
- 문장 하나 실패는 그 문장만 건너뛴다(연속 5회면 대본 중단). 오류는 사람 말로(`This operation was aborted` → 「60초 안에 응답 없음」).
- 채널 해석은 `resolvePreset(presetName)`(🔴 낡은 전역 `S.preset` 이 이기던 사고). 1단계 로그 `voiceLabel`: 채널·목소리·시드·배속. 🎤 그룹 재변환은 **채널 시드 고정**(Shift+클릭만 새 시드). 목소리가 이상하면 **서버 로그의 seed 를 채널 시드와 대조**.
- 숫자는 대본에 **아라비아 숫자로 쓴다**(모델이 문맥으로 읽는다). 예외: 횟수 `번`·`자`·`편`·수량 `강` 은 한글(「세 번」). `~` 는 「에서」로 바꾼다. 발음사전은 `processForTTS` 한 곳에서만 적용(⛔ 가공을 다른 곳에 추가 금지). 발음 판정은 **ASR 전사 + 틀린 판 판정력 검증** 또는 로이 청취 — ⛔ **길이 비교로 판정하지 말 것**.
- 화자: 줄 맨 앞 `[이름] 대사`(그 줄만) → 채널 `speakers[{name, voice}]`. 대괄호만 있는 줄은 섹션.
- TTS 는 직렬 큐 `enqueueTtsJob`(싱글톤 매니저를 동시에 건드리면 provider 가 사라진다).
- 문장 사이 쉼은 **음성 파일에 `apad`** 로 넣는다(`ttsDurationSec` 한 곳이 타임라인·챕터·SRT 의 근거). ⛔ vrew 에 빈 클립을 끼우지 않는다.
- 참조음성 자르기(보이스디자인 ✂)는 「소리가 아직 살아 있는 마지막 순간」에서 끊는다 — 가장 조용한 지점은 곧 없애려던 끝 감쇠다. 자르면 참조텍스트도 함께 고친다.
- 발음사전 md 는 「좌측 헤더가 `표기` 로 끝나고 우측에 `읽기` 가 있는 표」만 읽는다(숫자 빈도표·약어표를 긁으면 대본이 부서진다). 한 글자 치환은 버린다.

### 이미지
- 엔진: **Flow(구독) · Genspark(구독) · ComfyUI(☁/🖥 × 워크플로) · 나노바나나(유료 API)**. Flow/Genspark 는 「시작점」이고 한도면 서로 이어받는다(`runRotatingImages` 라운드 반복 — 쿨다운이 풀린 엔진으로 같은 대본 도중에도 복귀, ⛔ 기다리지는 않는다). 로이 확정 — 이어받기 끄기 없음.
- 프롬프트 = `<스타일>, <대본 프롬프트>, …` 부정 절은 **맨 끝으로 모으고 중복 제거**(`normalizePromptNegations`) + 긍정 억제 표현. **항상 마침표로 끝낸다**(Krea2 CLIP 토큰 경계 버그 회피). 재시도·🔄 는 프롬프트 변형 단계를 번갈아 적용.
- 🔴 Krea2 Turbo 는 cfg=1 + negative ZeroOut → **네거티브 프롬프트는 무효**. 글자·잡물은 positive 긍정 서술로, 또는 대본에서 글자 있는 사물을 묘사하지 않는다.
- 이상 판정(`visualStats` rgb24 한 번 호출): 검정 = 평균밝기<10 · 노이즈 = 거칠기≥9 **AND** 구조≤12 · 색깨짐 = 형광 화소≥2.5% **AND** 색거칠기≥5(상수 `BAD_*`, main.js). 🔴 **사람이 첨부한 그림은 판정 제외**(`_userAttached` — `_visKey` 경로+mtime+크기) · 🔴 **`_inDir(media-N)` 밖 파일은 지우지 않는다**(첨부는 원본 경로를 가리킨다). 캐시에서 꺼낸 것도 검사하고 이상하면 캐시 항목까지 삭제.
- ComfyUI: 워크플로 번들(`comfy/*.json`, API 포맷)은 `_ensureBundled` 가 매번 등록·경로 복구. **모델 파일명 불일치는 자동 대체**(`comfy-models`: 정밀도 토큰만 뗀 이름이 같을 때만 — ⛔ turbo·distilled 같은 정체성이 바뀌는 대체 금지). 로컬 3060 은 fp8 에뮬레이션이라 int8/convrot 판으로 자동 교체. 이미지 동시 **클라우드 2 · 로컬 1**(상한 코드 고정 — 3 이상은 검정 유발). 이미지 출력에 안 이어진 가지(LLM 프롬프트 확장)는 걷어낸다. 채널 `imgEngine` 은 bare `comfy`(절대경로 고정 금지). 서버에 모델이 있는지는 로더 하나만 보지 말고 UNET·CLIP·VAE·LoRA·Checkpoint 옵션을 전부 본다(클라우드는 `/api/object_info` 통째 · 9.5MB 라 생성 경로에선 쓰지 않는다).
- `✕` 로 지운 그림은 `imageCleared`(스냅샷 저장) → 캐시에서 되살리지 않는다. 🔄 재생성은 영상이 있어도 이미지만 본다(`imgDone(g, force)`). 대상 0개면 그렇게 로그.
- Genspark 한도 메시지의 재설정 시각을 파싱해 계정 쿨다운(침묵 정체 3연속 = 추정 30분). 배지 = 리본 capbar 맨 앞.

### 비디오
- 엔진: **☁ ComfyUI LTX2.5(주력 · 1920x1088 직접 생성 → 업스케일 생략)** · ☁/🖥 MiniMax H3 레퍼런스 · 🖥 LTX2.3 · Grok(브라우저) · Grok API · Flow·Veo · Genspark · 없음. 드롭다운은 **헤더 + 채널편집 두 곳**(엔진 추가 시 둘 다).
- 대상 = 영상 범위 안에서 **이미지 있고 영상 없는** 그룹(이어받기). 직전에 `autoRelinkVideos`(폴더에 남은 `NN_1080.mp4`/`NN.mp4` 다시 잇기, `videoCleared` 는 제외).
- 업스케일은 해상도를 재서 목표 이상이면 생략, **못 재면 건너뛴다(fail-closed)**, `upscale` 전용 레인, auto 모드는 한 영상 5분 넘으면 ffmpeg 로 강등.
- 영상이 TTS 보다 짧으면 `video-fit`(≤1.3배 느리게 / 넘으면 반복+크로스페이드, 결과는 캐시 폴더 · 원본 불변). 🔴 **맞출 길이가 90초 넘으면 파일을 늘리지 않고 Vrew 반복 재생**(`endBehavior:'loop'`) — 18분짜리를 구워 Vrew 가 응답없음이 된 사고.
- LTX: Prompt Enhance(Gemma) 노드를 자동 OFF(실사화 방지). 해상도·길이·프롬프트는 제목 기반 탐지로 주입. MiniMax H3 는 i2v 가 아니다 — `<Picture 1>` 접두사를 엔진이 붙이고(⛔ 대본에 태그 쓰게 하지 말 것), 해상도는 0.98MP 격자, turbo 4스텝(스텝이 많을수록 원본 이탈), 대본 `🎬 영상:` 은 서술형으로. 로컬 i2v 는 3060 에서 LTX2.5(22B)가 못 돈다(모델도 없음) — 로컬은 MiniMax turbo4 전용(편당 약 47분), 수동 🎬 버튼도 `localGpu` 레인을 잡는다.
- Flow·Veo: 설정 팝업 실측 셀렉터(작업노트 2026-09 「Flow 새 UI」 표). 모델은 드롭다운 현재 라벨을 읽어 비교(정확 일치). 첨부 실패·재시도 재첨부 실패면 **그 컷을 만들지 않는다**(원본과 무관한 영상에 크레딧 낭비 금지). 결과는 제출 전후 `/edit/<uuid>`(새 UI 는 타일) 비교로 **방금 만든 것만**, 1080p 다운로드(잠긴 계정은 720p+로컬 업스케일). 크레딧 소진 = 6시간 휴식(`_exhaustReason` 을 `send()` 에서 기록). ⛔ **Flow 동시 생성 안 함**(로이 확정 — anti-detect·매칭 위험). Flow 브라우저는 `flowBrowser` 레인, 쓰는 중이면 `closeFlowEng` 가 닫지 않는다. 구독 없는 계정 = 소개 페이지 → `flowNoAccess` 12시간 휴식.
- Grok(브라우저): aria-label 앵커 셀렉터. 🔴 **본편 판정 = post UUID 가 video src 에 있고 사이드바 버튼 밖**(사이드바 완성 영상을 집으면 남의 영상이 .vrew 에 실린다) · 오디오 토글 끔. 한도 쿨다운 기록. 약관 게이트(tos-gate)는 UI 변경이 아니다(`explainNoChipBar`).
- Genspark 비디오: 모델별 `imgRef` — 참조 이미지를 안 받는 모델(Omni Flash 등)은 만들지 않는다. 길이는 페이지의 min/max 로 clamp. 안내 배너를 한도로 오인하지 않게 비디오 전용 판정, 포인트 소진 = 6시간.

### .vrew · MP4
- 🔴 캔버스 비율은 **web/shape 오버레이 트랙의 x좌표계**로 인식된다(미디어·자막은 스케일 안 함). 제목 web 트랙에 `assetEffectInfo` 금지(내보내기 실패).
- 자막 위치는 클립별 `captions[].style` 이 지배. 배경음악 = files `BGM` + tracks `type:'bgm'` + asset + **전 clip 링크**(넷 다 있어야 들린다). 트랙 zIndex = `stackRanks`(늘려 끌어온 그림이 위층).
- **유튜브 MP4 = `.vrew` 를 읽어 굽는다**(`core/vrew-render.js`). ⛔ 앱 모델에서 렌더 규칙을 다시 계산하지 않는다(두 벌이 된다). 보정값(글자 ×0.72 · 여백 공식)·함정(zoompan 좌표 · mp3 선언 길이 맞춤 · web 트랙 · 폭 1.008 미반영)은 작업노트 2026-09 「Vrew 없이 유튜브 MP4」. 인코딩 `-bf 0` + maxrate(켄번스 떨림), ⛔ `-aac_coder fast` 금지(음질). 투명 PNG 는 `yuva420p`. 소리 없는 영상은 `hasAudioStream` 으로 거른다. 새 트랙 종류가 생기면 렌더러도 그려야 한다.
- 📥 Vrew 음성 가져오기(`core/vrew-audio.js`): .vrew 는 **읽기만**. 음성 경로 = `clip.words[].assetIds → assets → tracks.mediaId → zip media/<mediaId>.*`(⚠ `files[].name` 은 사람용 이름 · `clip.assetIds` 엔 음성이 없다) · 자막은 `words` 우선(captions 는 남의 문장일 수 있다) · 문장부호 무시 매칭 · 한 문장 = clip 여러 개면 이어붙인다 · 게이트는 **쓴 clip 비율 80%**(일부만 만든 .vrew 는 통과).
- 🔴 **ffmpeg 에 SRT 를 물리면 384x288 좌표계로 3.75배 커진다** → 자막은 PlayRes 를 영상 해상도로 박은 ASS 로. 테스트는 1080 이상에서 화소로 잰다.
- 유튜브 업로드: 전용 GCP 프로젝트 `priming-upload`(youtube.upload+readonly). ⛔ 분석용 `adonairoy` 프로젝트 토큰 사용 금지. 비공개 + `containsSyntheticMedia` + ko(⚠ 언어 고정 — 다국어 시 분기 필요). 제목·설명·태그는 아도나이로이 패키징 파일. 챕터는 `core/yt-chapters.js` 하나(⏱ 창과 공유), 업로드 전 MP4 실측 길이와 대조. ⚠ client_secret 을 저장소에 넣지 말 것.
- 화이트보드 MP4: 장면 = 그룹(결정론 · 분할은 문장 경계), 주석은 있으면 건너뛰고 그림 지문(`imageSig`)이 바뀌면 영역 재추출, 굶는 영역은 배정 순서로 해결(`findStarved`), 음성은 장면 실측 길이에 맞춰 얹고, 완성물만 다운로드 폴더로. 벤더링 `whiteboard/` 는 여기서 고치지 않는다(상류 `D:\화이트보드` → PATCHES.md). 화풍 이미지 단계는 미완(후처리 우선). 장면 길이 = 그 장면 문장 TTS 합(A/V 싱크) · 영역 하나 2.5초 이상 · 화이트보드로 낼 대본은 H3 당 문장 6개 안팎(25~30초) · 앱 이미지 스타일(스케치 등)은 화이트보드와 충돌한다.

### 자막
- 줄 나누기 = 어절 단위 DP(`caption-splitter`) — 금지 경계(의존명사로 시작·관형사로 끝·보조용언·부정부사·수사+단위) · 감점(관형절·부사) · 하한(`minCharsFor`) · 쉼표/접속부사는 선호. 오탐 회귀를 반드시 함께 박는다(목록에 없는 형태는 로이 신고 → 규칙 추가).
- 🔴 **`core/*.js` 는 렌더러 번들에 들어간다 — CJS 런타임 참조(`require.main` 류 자기검사) 금지**(앱 화면이 백지가 된 사고).
- 서식: 채널 기본(`capLong`) + 조각 `s.capSpans`(문장 글자 위치 — 줄 번호 아님) + 줄별 위치 `posH/posV/posX/posY`(`FMT_DEFAULT` 에 넣지 않는다). 문장을 고치면 `remapSpans`. 한 문장 안 줄 나눔 = `s.capBreaks`. 채널 편집 창에 값을 **읽기·저장 두 곳 다** 실을 것(안 실으면 저장 때 지워진다 — 이 저장소 단골 사고).
- 글꼴: Vrew 이름 = typographic family + `-Vrew_` + weight. woff2 는 Node 로 ttf 변환(libass 가 못 연다). 한글 없는 글꼴은 목록에서 뺀다(⚠ 일본어 지원 시 분기 필요).

### 🌏 다국어 (일본어·베트남어)
- 언어 판별은 `core/lang.js` 한 곳(`detectLang`: 한글 한 글자라도 있으면 ko). 새 규칙(문장 분리·일본어 글자 단위 자막·외국어 글자 세기·TTS 언어·범위 표기·일본어 글꼴)은 **ja/cjk/vi 일 때만** — ⛔ 한국어 경로를 바꾸지 않는다. 바꿀 땐 `test:lang` [7](옛 커밋 모듈과 기존 대본 전체 대조, 다름 0)을 돌린다.
- 🎨 베트남어 참조음성은 **보이스디자인 창 → 언어 Tiếng Việt** 로 만든다(OmniVoice 목소리 설명 · 성별·나이·음높이만 받는다 · 생성 뒤 받아쓰기 % 표시). ⛔ 보이스디자인(Qwen3)은 베트남어 미지원(500).
- 🔎 **역대조 게이트**(`core/tts-backcheck.js` · ja/vi 문장만): 합성 직후 받아쓰기해 원문과 대조(베트남어 음절 · 일본어 글자) → 미달(vi 90% · ja 85%)이면 다른 시드로 최대 2번 → 결과표 `<출력>/역대조_보고.tsv`. Whisper 는 짧은 조각에서 유튜브 문구를 지어낸다 → **0.5초 무음을 덧대고** 받아쓴다 · 알려진 환각은 「확인 불가」(다시 만들지 않는다). 받아쓰기가 안 돼도 합성은 성공.
- 🇯🇵 아오조라문고 표기: 루비 `漢字《かんじ》`·`｜본문《よみ》` → 자막 = 본문 · 낭독 = 읽기(`s.ttsText`) · `［＃…］`·見出し·범례·底本 꼬리 제거 — **일본어 문단에서만**(한국어 대본의 《사기》·｜ 는 그대로).
- 🔴 외국어 참조음성은 **끝을 문장 사이 쉼에서 자르고**(`suggestPauseRange` — 낱말 한가운데를 베면 남은 글자 「ました」가 새 문장 앞에 샌다) **참조텍스트를 잘라낸 구간에 맞춘다**(`refTextForCut`: 받아쓰기와 맞는 원문 문장 앞부분 표기 · 안 맞으면 받아쓰기). 저장 경로가 자동으로 한다. 실측: 원문 그대로 0/20 → 쉼 자르기 20/20.
- 등록된 외국어 참조음성: `VI_남성_중년`·`VI_여성_청년`(OmniVoice 목소리 설명) · `JA_남성_중년`·`JA_여성_청년`(보이스디자인 Japanese) — 전부 새 문장 역대조로 검증 후 등록.
- 🔴 베트남어는 **원어민 참조음성(또는 목소리 설명)** 이 필수 — 한국어 목소리는 language=vi 를 줘도 한국어처럼 읽는다(0~1/3). 일본어 자막 기본 글꼴 = `Noto Sans JP-Vrew_700`(앱 동봉 · Vrew 의 ja 기본값과 같다).

### 대본 · 편집 · 보기
- 대본 형식: `docs/대본-작성-가이드.md`(정본). 메타 `> 🖼️ 이미지:` · `> 🎬 영상:` · `> 🖼️ 이미지: 이어서`(앞 그룹과 합치기) · `> 📝` 메모(낭독 제외) · `> 📥 자산출처:`(통합본). ⛔ 「이미지 줄이 없으면 앞 그림」 식 암묵 규칙 금지(✍ 프롬프트 자동 작성 대상이다).
- 문장 편집(화면·대본 보기 공통 `edit-sentences`): .md 는 **그 범위만 치환**, 파싱본은 제자리 수정, **검증 재파싱 후에만** 쓴다, 마스킹(헤더·`>`·주석)을 가로지르는 문장은 거부, 고친 문장 음성만 비운다(그림은 유지). 키: Enter 줄 나누기 · Ctrl+Enter 문장 나누기 · 맨앞 Backspace/맨끝 Del 합치기(그룹 경계도 넘는다) · Esc 취소.
- 되돌리기 `UNDO`(40단계): 그룹·문장 복제 + .md 전문 + 그림 신원. 지우는 파일은 `<출력>/.priming-undo/` 로 옮긴다. 텍스트 칸 안에서는 그 칸의 되돌리기.
- 그림 범위 = `g.visSpan`(문장 id) — 그룹 경계를 안 바꾸고 레이어로 이어 깐다. 삽입(➕) = `pr.overlays`(문장 id + 글자 위치 `sc/ec` → 클립 단위, 판정 `clipIn` 한 곳).
- 대본 글자 수는 **대본 보기가 볼 때마다 센다**(제목 옆 「/ N 자」 · 아도나이로이 `대본검사 --자수` 와 같은 값). ⛔ 대본 파일 제목 줄에 적지 않는다 — 누가 적어도 `stripCharCountTail` 이 제목·업로드에서 벗긴다(v0.5.74~75).
- 파서만 만드는 파생값(`readerNotes` 등)은 **작업본 복원 경로에서도 .md 로 다시 채운다**(대본이 안 바뀌면 재파싱이 없어 빈 채로 나온다).
- 작업본 스냅샷 정리는 **대본 파일명** 기준(경로로 세면 옮긴 대본을 죽은 것으로 오판) · .md 를 하나도 못 찾으면 아무것도 안 한다(G: 순간 소실) · 지우지 말고 격리.
- 통합본: 소스 자산을 **복사**(원본 참조 금지 — sweep 이 지운다) + 길이 주입 + 전방 커서 매칭 + 매칭률 95% 게이트. ⛔ .vrew 를 자르거나 합치지 않는다.

### 채널 · 스타일 · 공유
- 채널 프리셋: `tts/preset-store.js`(파일 순서가 곧 표시 순서 — 기본 채널을 위로 끌어올리지 않는다). `srv:` 참조음성은 정규화에서 지우지 않는다. 비면 `<select>` 가 첫 항목을 조용히 가리키므로 「— 선택 안 됨 —」 placeholder.
- 이미지 스타일 = 서버 `/styles`(rev 낙관적 잠금, 첫 동기화는 합치기, dirty 표시로 push 실패분 보존). 기본 28개는 최초 1회 씨앗, 전부 수정·삭제 가능(지우면 안 되살아난다).
- 채널 화풍 내보내기 `~/.flow-app/channel-styles.json`(아도나이로이 대시보드 8765 계약 — prompt 는 `getPrompt()` 그대로, KST, `short` 필드 유지). ⛔ 채널 이름 유사도 자동 매칭 금지.
- 계정(Genspark·Flow·Grok) = 브라우저 프로필. 자격증명은 `safeStorage` 암호화(평문 저장 거부) · 렌더러로 비밀번호를 돌려주지 않는다 · 자동입력은 1회 시도 후 CAPTCHA/2FA 면 사람에게. 일일 한도 0 = 무제한(쿨다운은 존중). Flow 한도 판정은 UI 값 하나(`_perProfileCap`), 카운트는 누적 복사 수.

### 브라우저 자동화 공통
- 크롬 실행 실패 = 프로필 정리(`core/chrome-profile.cleanProfile` — 락 + `exit_type`) 후 1회 재시도 → 번들 Chromium → 사람 말 오류. 번들 설치는 ⚙ 계정 「⬇ 브라우저 설치」(⛔ `npx playwright install` 은 버전이 달라 소용없다).
- 접속 대기는 `load` + 준비 신호 폴링(⛔ `networkidle` 금지 — SPA 는 닿지 않는다). 셀렉터를 못 찾으면 화면 상태를 덤프(`[DUMP …]`)해 로그로 — 다음 수정의 근거.
- 다운로드는 새 탭(about:blank)을 남긴다 → 전송이 끝난 뒤 `_closeBlankTabs`. ⛔ 앱 밖에서 같은 프로필을 열지 말 것. ⛔ 모더레이션을 우회하지 않는다(순환이 정답).

### STT · 받기
- STT 입력은 **mp3·wav·flac 만 직접**, 그 밖은 `transcribeLong` 입구에서 mp3 변환(화이트리스트 — ⛔ 확증 없이 넓히지 말 것). 청크 0.3초 미만 꼬리는 버린다.
- 📥 대본다운(yt-dlp): 60일 넘은 판이면 최신 exe 자동 설치(구판은 오디오 403) · `--no-playlist` · `--windows-filenames`(⛔ `--restrict-filenames` 금지 — 한글 제목 삭제) · 자막 우선(원본 언어 `-orig`, 번역 자막 금지, 롤업 중복 제거) · 비메오는 로그인 요구면 플레이어 주소로 재시도 · 받기와 전사를 겹치되 전사는 한 번에 하나 · 채널 전체는 편수 확인 · .txt 머리말(1줄 주소 · 2줄 제목 · 빈 줄).
- 🎵 mp3 추출은 ID3v2.3(스마트폰 한글 태그).

### 리모션 · 출판
- 리모션: 파일명은 TSV 가 정한다(확장자로 wav/mp3) · 전용 캐시(⛔ 공용 TTS 캐시 사용 금지 — 롱폼 타이밍이 깨진다) · 시드 고정 · 무음 트림은 무손실 PCM 절단(pad 40ms) · 발음사전은 채널에 저장(`dictPath`, 편집 창 읽기·저장 둘 다) · 그림 TSV 는 헤더 판별이 「첫 칸이 이미지 확장자인가」, 앞 숫자로 강과 짝.
- 출판: 원고 규약은 `docs/출판-원고-가이드.md`. 조판 = vivliostyle(자식 프로세스) · 폰트는 정적 TTF(가변·CFF 는 Type3 로 구워진다) · 미리보기는 iframe 격리 + 조판마다 새 파일명(⛔ URL 에 쿼리·해시 금지 — 목차 쪽번호 ??) · 조판 옵션은 PDF·ePub 공통 함수 · 원고(BookModel)는 불변 · 판권 러닝헤드는 문자열 비우기로 억제.

## 8. 코딩 함정 (이 환경에서 실제로 밟은 것)

- 🔴 **미정의 식별자는 빌드·단위테스트가 못 잡는다**(`imgEngine`·`onPickImgEngine`·`label`·`failCount` 사고). main.js 를 고치면 **`npm run test:makeall`(무음 E2E, 20초)** 을 반드시 돌린다. 함수 블록을 지울 땐 아래 어디까지 지워지는지 눈으로 확인.
- 🔴 **셸이 역슬래시·백틱을 먹는다**(heredoc·`node -e` 에서 `\b`→0x08, `\n`→줄바꿈, `'\0'` NUL). 백슬래시가 든 코드는 **Write/Edit 도구**로, 편집 뒤 제어문자 검사. 한글 파일명 비교는 node 로(PowerShell 5.1 은 ANSI 로 읽는다).
- 줄끝: `.gitattributes` `* text=auto eol=lf` → 커밋 blob 은 LF. `flow-engine.js` 작업 사본은 CRLF 유지(테스트가 단언 · `git stash pop` 후 LF 로 바뀌면 되돌린다). 원문을 `\n` 으로 자르는 테스트는 먼저 정규화. ⛔ `grep -c $'\r'` 로 재지 말 것(Git Bash 에서 글자 r 을 센다).
- React: ⛔ `setState` 직후 그 state 를 읽지 않는다(값을 직접 넘긴다) · 한 번 만든 클로저(`onended` 등)에서 state 읽지 않는다 · ⛔ 제어 checkbox/radio 의 click 에서 `preventDefault` 금지 · 편집면(contentEditable)은 React 가 다시 그리지 않게 고정 · 한글 조합 중(`isComposing`)엔 저장·Enter 처리 안 함 · 서식 막대는 mousedown 을 막아 초점을 지킨다.
- 비동기 재생·루프는 **번호표**(`playGenRef` 식)로 「내가 아직 현재 작업인가」를 확인한다 — 멈춘 옛 재생의 await 가 깨어나 새 재생을 닫은 사고. 대본 전환 전 밀린 자동저장을 먼저 쓴다(`syncActiveToS` → `flushAutoSave`).
- 목록에 `<video>` 를 수백 개 두지 않는다(Chromium 플레이어 한도 ≈75 — 썸네일은 `video-frame` 한 장 이미지). 렌더 예외는 `ErrorBoundary` + `window.onerror` 가 로그창(`🐞 화면 오류`)에 남긴다.
- Electron `findInPage(text, {findNext})` 의 findNext 는 「새 세션을 시작하는가」다(true = 새 검색). 타이핑은 디바운스.
- Electron: 모달 대화상자는 부모 창을 앞으로 끌어온 뒤 연다(숨으면 입력 전체가 잠긴다 — 10초 넘게 잠기면 자동 해제 + 🩹 로그) · `media://` 는 **자르기 → 디코드** 순(경로의 `#`) · 스트리밍 응답(동기 읽기 금지) · 클립보드는 main 에서 읽는다 · `app.getVersion()` 은 라이트 업데이트 전 값이라 디스크의 package.json 을 읽는다.
- pythonw 로 띄우는 서버는 파일 로그 필수(stdout 무효 → 조용히 죽음). bat 에서 `start` 금지, bat 은 ASCII 만(cmd 는 CP949 로 읽는다). 백그라운드 상시 실행은 바로가기 대상을 pythonw 로 직접.
- ffmpeg 필터에 경로를 넣지 않는다(드라이브 콜론·한글) — cwd 를 작업폴더로 두고 ASCII 파일명만. ffmpeg 필터 기본값은 `-h filter=<이름>` 으로 확인(alimiter auto level 사고).
- `readImageSize` 는 `{w, h}` 를 돌려준다(`width` 로 읽어 검증이 통째로 죽은 사고). 번호를 한꺼번에 바꿀 땐 **높은 번호부터** 치환(② → ③ 을 먼저 하면 겹친다). 줄 인덱스로 블록을 자를 땐 시작·끝을 둘 다 단언한다.
- 「같은 일을 하는 코드가 여러 곳」이 이 저장소의 단골 사고다 — 정규화·저장 경로·성공 후처리·드롭다운·판정 함수를 **한 곳으로 모으고**, 추가할 땐 grep 으로 개수를 세는 테스트를 둔다. 설정을 추가했으면 **그 값을 읽는 곳이 있는지** grep(「문장무음」은 읽는 코드가 0이었다).
- 판정은 fail-closed(내보내기 게이트·업스케일 측정)와 fail-open(진단·경고·서버 대기)을 구분해 정한다. 조용히 틀리는 쪽보다 막고 알리는 쪽을 택한다.

## 9. 테스트

- 원칙: **원문 함수를 뽑아 실행**(복사본 금지) · A/B 역검증(고치기 전 코드로 되돌리면 실패하는지) · 판정력 검증(틀린 입력이 실제로 다르게 나오는지 — 헛단언 방지) · 실측 가능한 것은 실측(ffmpeg 화소·volumedetect·ASR).
- 필수 회귀: main.js 수정 → `test:makeall` · 화면 수정 → `test:workspace` · 자막 → `test:caption`·`test:capfmt` · TTS → `test:tts` · ComfyUI → `test:comfy` · 출력 → `test:mp4`·`test:vrewaudio`.
- 스크립트 목록은 `package.json`(test:* 40여 개). 알려진 기존 실패: `img-rotate-resume`(27/34 — v0.3.84 부터, 원인 미확정) · `remotion-ui.smoke` 채널편집 대기 타임아웃 · `comfy-video-minimax` 의 「기본 활성」 단언(로이 PC 설정을 읽음).
- 버튼·라벨을 고치면 그 라벨·title 로 찾는 테스트를 함께 grep 한다(완전 일치 선택자가 조용히 깨진 사고 여러 번). 화면 배치 검증은 `elementFromPoint` 로 **실제로 눌리는지**까지 본다.
- E2E 는 Playwright `_electron` · `app.evaluate` 로 `dialog.showOpenDialog` 를 스텁해 실제 파일을 연다. E2E 는 상태를 바꾸는 블록을 뒤에 둔다.

## 10. 로이 확정 결정 (⛔ 다시 꺼내지 말 것)

- 모드는 롱폼/리모션/출판. 쇼츠·플리·ACE-Step 생성 제거(2026-08-22). 내부 이름(`shortsNum`·`shortsDirs`·`~/.shots-maker`)은 유지.
- Flow 동시 생성 안 함(2026-08-29). Flow/Genspark 이어받기 유지. 모델 파일명 `krea2Int4Convrot…` 바꾸지 않음(int4 는 로컬 전용).
- 비디오 로컬 항목 유지(여유 있을 때 MiniMax turbo4). 기본 비디오 = ☁ LTX2.5. LTX2.5 t2v 도입 안 함(파트너 과금·대본 비호환).
- TTS = OmniVoice 유지(CosyVoice3 A/B 기각 · 3~4배 느림). 품질 설정 축소 금지.
- 그룹 영상 음소거 유지(내레이션과 겹침) — 삽입 영상만 소리.
- 레인 분리(대본 간 동시 진행) 안 함 — `S.parsed` 전역 슬롯 1개라 대본이 섞인다.
- 사람이 첨부한 그림은 기계 판정으로 지우지 않는다.
- 🖼 그룹 그림 범위 선은 문장 단위(➕ 삽입만 클립 단위).
- 프로그램(Priming) ↔ 콘텐츠(아도나이로이) 역할 분리(2026-09-26) — 콘텐츠·채널 기획은 아도나이로이 세션, 코드는 이 저장소 세션.

## 11. 진행 중 · 실물 미검증

- 🌏 일본어·베트남어(v0.5.76~78): 참조음성 4개 등록·역대조 검증 완료. 원어민 청취 검수 · Vrew 에서 일본어 자막 표시 · 5천 클립 .vrew 를 Vrew 로 여는 것은 실물 확인 대기. 루비 문장을 앱에서 고치면 읽기(ttsText)가 사라진다(대본에서 고칠 것). 콘텐츠 판단은 아도나이로이 「다음 작업」 세션.
- Vrew 실물 확인 대기: 줄별 자막 서식·효과, 일부 clip 에만 건 bgm 트랙, 배경음악(업데이트 후).
- 화이트보드 3단계(화풍 이미지) 미착수 · 확인 그림 일부 실패 원인 미확정.
- Flow 비디오 새 UI 의 진행률·다운로드 메뉴 실물 미검증(첨부까지 확인).
- 큐의 대본별 영상 범위(v0.5.73) 실사용 확인 — 로그 `🎬 영상 범위 G1~G3 (도입부 기본)`.
