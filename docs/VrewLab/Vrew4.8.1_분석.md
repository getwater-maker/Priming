# Vrew 4.8.1 설치본 분석 (Priming Lab 참고용)

- 대상: `C:\Users\Pink-Desktop\AppData\Local\Programs\vrew\Vrew.exe` — 제품 버전 **4.8.1.610** · 제작 VoyagerX, Inc. · 작성 2026-10-24 (KST)
- 방법: REA(`inspect_electron_fuses`·`analyze_javascript_application`) + 번들 소스 읽기/문자열 추출. **정적 분석만** — 앱을 실행하거나 서버를 호출하지 않았다.
- 한계(정직하게):
  - `analyze_javascript_application` 이 `main.js`(4.1MB) 에서 힙 부족으로 의미 그래프를 못 만들었다(패키지·파일 인벤토리·Electron 요약만 나옴). 그래서 main 의 내용은 **원문을 직접 읽고 grep** 한 결과다.
  - 렌더러(`index-*.js` 4.1MB · `vendor` 9.2MB · `scene` 2.4MB)는 난독화는 아니고 **minify** 상태다. 이 문서에 쓴 렌더러 내용은 일부 구간만 읽은 것 — 「확인함 / 추정」을 구분해 표시했다.
  - 서버(`*.vrew.ai`) 쪽 동작은 보이지 않는다. 엔드포인트 이름만 안다.
- 앞서 만든 [기능차이표](기능차이표.md)는 4.7.2 기준이다. 아래 §7 에 4.7.2→4.8.1 로 바뀐 점(확인된 것만)을 적었다.

---

## 1. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 플랫폼 | **Electron** 앱(Chromium 포함 `Vrew.exe` 225MB) · NSIS 설치 · 사용자 영역 설치(`%LOCALAPPDATA%\Programs\vrew`) |
| 구조 | main(`resources/app/out/main/main.js`, 단일 번들) + 렌더러(`resources/static/` — Vite 번들, React/Redux) |
| 코드 위치 | `resources/app` 은 **asar 가 아닌 평문 폴더**(Electron 퓨즈 `OnlyLoadAppFromAsar`·`EnableEmbeddedAsarIntegrityValidation` 둘 다 꺼짐) |
| 자체 npm 의존성 | `electron-window-state` · `fluent-ffmpeg` · `mime` · `mv` · `node-stream-zip` — 나머지(`archiver`·`electron-log`·`electron-updater`·`iconv-lite`·`luxon` 등)는 main 번들 안에 들어 있다 |
| 프로젝트 파일 | `.vrew` = **zip** · 안에 `project.json` + `media/` · 파일 버전 **17**(`CURRENT_VREW_FILE_VERSION`) |
| 템플릿 파일 | `.vrt`(프레임팩) · 안에 `template.json` · 버전 8 |
| 영상 처리 | 렌더러가 **프레임을 직접 그려(WebCodecs 인코더 워커) → H.264 스트림을 main 의 ffmpeg 에 파이프 → mux** — 아래 §4 |
| 서버 의존 | 로그인 필수 + AI 기능은 전부 `api-<stage>.vrew.ai`·`cloud-`·`project-<stage>.vrew.ai` 서버 호출 |

## 2. 설치 폴더 구조

```
vrew\
  Vrew.exe                  Electron 본체
  resources\
    app\                    ← 앱 코드(평문)
      package.json          name vrew · 4.8.1 · main out/main/main.js
      out\main\main.js      main 번들 4.1MB(라이브러리 + 앱 로직이 섞여 있음 · 앱 로직은 약 줄 60000~108000)
      build\                아이콘·NSIS 스크립트(vrew-win-extend-install.nsh)·appx 로고
      scripts\notarize.js   macOS 공증
    static\                 ← 렌더러 번들
      index.html · preload.js · legacy-storage.html · storage-migration.html
      assets\               번들 JS 19개 · 이미지 약 190장 · svg 1300 · mp4 28 · woff2 12 · wasm 1
      libav\                libav-vrew-*.mjs / .wasm (6MB) — 브라우저 안 ffmpeg(libav.js)
      worklet\volume-processor.js    AudioWorklet
      locales\{ko,en,ja,zh,es}\translation.json   5개 언어 UI 문자열(41~53만 자)
    dictionary\             Hunspell 사전 en/es/ko(맞춤법 검사)
    models\bodypix_mobilenet.*      TensorFlow.js BodyPix 모델(사람 분리·배경 제거 추정)
    nodehun\                Hunspell 네이티브 모듈(플랫폼별 .node)
    locker\locker-32/64.node       네이티브 모듈(정체 미확인 — 이름만 「locker」)
    app-update.yml          자동업데이트: provider s3 · 버킷 vrew-files.voyagerx.com (ap-northeast-2)
    elevate.exe             설치 시 권한 상승
```

- 「ffmpeg」 본체는 **설치본에 없다.** 처음 실행할 때 `https://vrew-files.voyagerx.com/ffmpeg/{gpl_vgx|lgpl}/…` 에서 받아 `userData` 에 둔다(GPL 4.3.2/4.4 · LGPL 4.4.2). `font_list` 도 같은 방식으로 받는 별도 실행 파일(시스템 글꼴 목록용).
- 렌더러에 `libav`(WASM)가 따로 있으므로 **미리보기·일부 인코딩은 브라우저 쪽**, 마지막 mux/변환·STT용 추출 등은 main ffmpeg 가 한다.

## 3. Electron 보안 상태 (확인함)

퓨즈(REA `inspect_electron_fuses`, 근거 `ev_f4bb8d72…`):

| 퓨즈 | 상태 |
|---|---|
| RunAsNode | 켜짐 |
| EnableCookieEncryption | **꺼짐** |
| EnableNodeOptionsEnvironmentVariable | 켜짐 |
| EnableNodeCliInspectArguments | 켜짐 |
| EnableEmbeddedAsarIntegrityValidation | 꺼짐 |
| OnlyLoadAppFromAsar | 꺼짐 |
| GrantFileProtocolExtraPrivileges | 켜짐 |

의미: 코드가 평문이고 무결성 검사가 없어 **읽기·디버깅이 쉽다**(우리 목적엔 유리). 반대로 Lab 에서 Vrew 를 「검증용 기준 프로그램」으로 쓸 때는 **설치본을 수정하지 말 것**(자동업데이트가 덮어쓰고, 서명 문제도 생긴다).

preload(`static/preload.js`)는 렌더러에 딱 세 가지만 노출한다: `window.api = { desktop:true, ipc:{send,on}, fs:{getFilePath(files)} }`. 즉 렌더러↔main 은 **채널 이름 문자열 기반 IPC 하나**로만 통한다. 로컬 파일은 커스텀 프로토콜 `vrew-file://`(호스트 2종 · Range 요청 지원 · `Content-Security-Policy: sandbox`)로 읽는다.

## 4. 렌더링·내보내기 파이프라인 (확인함 + 일부 추정)

- 렌더러 워커(`assets/`): `renderer.audio.worker` · `mixer.audio` · `processor.audio.tempo` · `encoder.worker` · `encoder.audio.worker` · `decoder.worker` · `mediaSourceAudioReader.worker` · `mediaHandlerWorker` — **프레임·오디오를 브라우저 쪽에서 합성하고 인코딩**한다(추정: WebCodecs).
- main 쪽 IPC(`export.*`): `spawnMuxer`(ffmpeg 시작) → `pushToMuxer`(H.264 조각을 stdin 으로) → `closeMuxer` → `muxMedia`(영상+음성 합치기).
  - 확인한 mux 인자(main.js `_getFFmpegMuxingArgs`): 입력 `-f h264 -r <fps>` 를 **stdin** 으로, 출력 `-c copy -framerate <fps>`. 즉 **재인코딩 없이 컨테이너만 씌운다.**
  - 버퍼: 1920×1080×3 바이트 × 5장.
- 그 밖 ffmpeg IPC: `ffmpegRunEncoding` · `ffmpegRunExtractAudio` · `ffprobeRun`/`ffprobeRunInfo` · `getShotBoundaryInfo`(장면 경계 감지 — 정규식 `pts_time:` 로 파싱) · `phaseReverseInfo`(위상 반전 검사) · `splitMedia` · `get_available_encoder`.
- **하드웨어 인코더 폴백**: 오류 정규식에 `h264_nvenc/amf/qsv/videotoolbox` 가 있다 → 하드웨어 인코딩을 시도하고 실패하면 소프트웨어로 되돌린다. `lut3d`(`.cube` 색 보정) 필터 지원. 오류 분류 정규식이 많다(디스크 가득·메모리 부족·`moov atom not found`·켄번스 패딩 오류 `Padded dimensions cannot be smaller…` 등) — **오류를 정규식으로 분류해 사람 말 오류코드로 바꾸는 방식**이다.
- 지원 GPU 제외 목록: GeForce MX110~MX450·GT 1030·830M/945M 류는 하드웨어 인코딩에서 뺀다.

> Priming 과의 차이: Priming 은 **`.vrew` 를 읽어 ffmpeg 필터그래프로 굽는다**(`core/vrew-render`). Vrew 는 **렌더러 캔버스에서 프레임을 그려 인코딩한다.** 그래서 두 결과의 자막 위치·켄번스·글꼴 두께가 완전히 같지는 않다 — CLAUDE.md 의 보정값(×0.72 등)이 그 차이를 메우는 장치다.

## 5. 프로젝트 파일(`.vrew`) — 우리에게 가장 중요한 부분

### 확인한 사실
- 확장자 `.vrew` = zip. 안에 `project.json`(`PROJECT_FILE_IN_ARCHIVE`) 과 `media/`(`MEDIA_FOLDER_IN_ARCHIVE`). 클라우드 프로젝트는 `sources` 경로 사용.
- **현재 파일 버전 = 17**(4.8.1). 4.7.2 도 17 이었다(기능차이표 #8 의 「4.7.2(내부 17)」과 일치). Priming 빌더는 **16** 으로 만든다(`vrew-template.json`) — 아직 17 로 올리지 않았고, 4.8.1 에서도 16 → 17 자동 마이그레이션으로 열릴 가능성이 높으나 **실제로 열어 보지 않았다.**
- 자동 저장: `.vrew~`(작업 중) → 백업 `.vrew`/`.vrew.bak` · 임시 `.vrew~.tmpN` · 최소 20개·7일 보관(`MINIMUM_AUTOSAVE_BACKUP_NUM=20`, `…DURATION_SEC=7d`). **쓰기는 임시파일 → 이동(`safeWriteFile`)** 방식.
- 파일 잠금 IPC(`fs.lockFile`/`releaseFile`) — 같은 프로젝트를 두 창에서 못 열게 한다.
- 최근 프로젝트 목록: `userData\localProjectHistory.json`(JSON 배열).
- 프로젝트가 참조하는 미디어는 **캐시 폴더**(`vrew-asset_*`·`vdrop-asset_*`)로 복사/해시(CRC32) 관리 — `fs.getFileCrc32`, `getSameSizeFile`, `getAlreadyExistMediaid`(같은 파일 중복 등록 방지).

### 렌더러 상태에서 확인한 프로젝트 모델 키 (redux 초기 상태 · `index-*.js`)
`globalClips` · `globalCursor` · `globalCaptionStyle` · `globalVideoTransform` · `trackEntries` · `assetEntries` · `translateInfo` · `ttsStates` · `ttsClipInfosMap` · `overdubInfosMap` · `projectAudioLanguage` · `audioLanguagesMap` · `soundEffectTimelineRanges` · `assetTimelineRanges` · `captionDisplayMode` · `showOriginal`.
트랙 항목 필드: `sourceIn` · `sourceOut` · `loop` · `playbackRate` · `volume` · `role`(`main` 등). 자막 효과 필드: `assetEffectInfo`.

→ **「클립 = 문장」 + 「트랙(영상·오디오) 항목은 source in/out 으로 원본 구간을 가리킨다」** 구조다. 이게 기능차이표 #8 의 「`vrew-render` 가 단어 `sourceIn` 을 무시」 문제의 뿌리다 — Vrew 에서 단어를 지우면 오디오 트랙이 `sourceIn/Out` 으로 잘려 나가므로, `.vrew` 를 읽는 쪽이 이 값을 따르지 않으면 음성이 어긋난다.

### 아직 모르는 것(다음에 확인)
- `project.json` 의 **정확한 JSON 스키마**(필드별 타입·필수 여부). → 가장 확실한 방법은 **Vrew 4.8.1 로 짧은 프로젝트를 저장해 `project.json` 을 직접 열어 보는 것**(앱 실행 필요). `lab-vrew-compare.js` 가 이 비교를 위해 이미 있다(4.7.2 저장본 대기 중이었음).
- 버전 16 → 17 에서 무엇이 바뀌었는지(마이그레이션 함수는 렌더러 번들 어딘가에 있을 것 — 이번엔 위치를 못 찾았다).

## 6. 기능 지도 (렌더러·로케일에서 확인된 것)

서버 엔드포인트 이름(렌더러 `index-*.js` 에서 추출 — 이름만 확인, 요청·응답 본문 형식은 일부만 읽음):

| 기능 | 엔드포인트(일부) | 비고 |
|---|---|---|
| 자동 장면 나누기 | `/auto-split-scenes` | POST `{rid, language, projectContext, targetSceneIds}` → 2초 간격으로 최대 30회 폴링해 `splitSceneResult` 수신(비동기 작업형) |
| AI 스타일 자막 | `/generate-ai-stylized-caption` · `/modify-…` · `/get-…-job-result` · `/list-…-assets` · `/get-…-pricing` | 유료·자산 즐겨찾기까지 있음 |
| AI 캐릭터 | `/generate-character-from-text` · `/generate-character-prompt-suggestions` · `/convert-character-style` · `/save-generated-character` · `/process-uploaded-character-image` · `/upload-character-image-signed-url` | 캐릭터 스튜디오 |
| 립싱크용 이미지 | `/generate-lip-open-image` · `/generate-lip-closed-image` | 입 열림/닫힘 이미지 2장으로 말하는 캐릭터 구성(추정) |
| 오디오 노이즈 제거 | `/start-denoise-audio` · `/get-denoise-upload-url` · `/get-denoise-download-url` · `/update-denoise-quota` | 엔진 = Resemble Enhance(로케일 `about.denoise_engine`) |
| Vrew 에이전트(챗) | `/agent/api/chat` · `…/chat/sessions` · `…/chat/attachments` · `/agent/api/memory` · `/agent/api/postprocess` | 기능 키 `vrew_agent` |
| 클라우드 프로젝트 | `/request-upload-v3` · `/upload-urls` · `/download-urls` · `/copy-cloud-project-for-feedback` | 서명 URL 로 업·다운 |
| 로그·분석·피드백 | `/analytics-v2` · `/uploadFeedback` · `/requestUploadLog` | |

기능 안내(announcement) 키에서 보이는 최신 기능: `ai_stylized_caption` · `vrew_agent` · `ai_video_models_v2` · **`typecast_tts`**(Typecast 음성 합성 연동) — 5개 언어(ko/en/ja/zh/es) 안내 이미지가 있다.

사용 엔진(로케일 `about.*` 크레딧): Claude · Gemini(글/이미지 판단) · **Dichotomous Image Segmentation**(배경 제거) · **Resemble Enhance**(노이즈 제거) · STT 계보로 **Zeroth Project(openslr.org/40) · KALDI** 가 오픈소스 목록에 올라 있다(한국어 음성 인식 학습 데이터/도구 — **Vrew 의 STT 서버 쪽 구성은 이 파일만으로는 확정 못 한다**).

main 쪽 부가 기능: 맞춤법(`spellCheck.*` — Hunspell) · 시스템 글꼴 목록(`init_font_list`) · FCPX 버전 조회(`electron.getFcpxVersion` → **FCPXML 내보내기 지원**을 시사) · 화면/장치 캡처(`mediaStream.getDisplaySources`) · `.cube` 색 보정 LUT → PNG 변환(`fs.cubeToPng`) · 프록시 파일 관리(`initializeProxy`·`cleanupProxyFiles` — 편집용 저화질 사본) · 딥링크 `vrew://signUp · oauthSignIn · openModal`.

## 7. 4.7.2 → 4.8.1 (확인된 것만)

이번엔 두 버전의 번들을 나란히 비교하지 않았다. 다음만 **확인**했다:
- 파일 버전은 17 그대로 → `.vrew` 포맷 자체는 이 구간에서 안 바뀐 것으로 보인다.
- 4.8.1 에 **Typecast TTS·AI 스타일 자막·Vrew 에이전트·AI 영상 모델 v2** 안내가 있다(어느 것이 4.8.x 에서 새로 생겼는지는 4.7.2 번들이 없어 판별 불가).
- 정확한 변경 목록이 필요하면 4.7.2 설치본/번들을 받아 `compare_application_versions`(REA)로 비교한다 — 지금 PC 에는 4.7.2 가 남아 있지 않다.

## 8. Priming Lab 에 주는 시사점 (판단 — 내 해석)

1. **P0 — `.vrew` 버전 올리기 검증.** 4.8.1 은 파일 버전 17 이다. Priming 빌더(16)가 만든 파일을 4.8.1 로 열고 → 저장 → 다시 열기 왕복을 해 본다. 그러면 `lab-vrew-compare.js` 에 「4.8.1 저장본」을 먹여 `project.json` 키 차이를 자동으로 뽑을 수 있다. (사실: 도구는 이미 있음 / 판단: 이 비교가 현재 가장 값어치가 큼.)
2. **단어 삭제 = 트랙 `sourceIn/sourceOut` 구조.** Lab 의 `delete-words`(새 `<번호>_d<지문>.wav` 를 만드는 방식)와 Vrew 방식(원본 오디오를 두고 구간만 자름)은 **다르다.** Vrew 파일을 읽는 코드(`vrew-audio`·`vrew-render`)가 `sourceIn/Out` 을 존중하도록 하는 것이 호환의 핵심이다. 반대로 Priming 이 만든 `.vrew` 를 Vrew 에서 열었을 때 단어 삭제가 잘 동작하려면 `words[]`·트랙 구간 필드를 Vrew 와 같은 규칙으로 채워야 한다 — **스키마 확인 필요**(§5).
3. **미리보기=출력 문제는 Vrew 도 똑같이 갖고 있다** — 렌더러 캔버스(미리보기)와 main(mux)이 같은 프레임 스트림을 쓰므로 Vrew 는 구조적으로 일치한다. Priming 은 두 경로(React 미리보기 vs ffmpeg 필터)라서 `core/ken-burns`·`core/caption-geom` 처럼 「한 곳 규칙」으로 맞추는 현재 방향이 옳다.
4. **파일 쓰기·백업 패턴은 Priming Lab 이 이미 같은 방향**(임시 → rename · 세대 백업). Vrew 는 `.vrew~` 자동저장 + `.bak` 20개/7일 — Lab `core/gen-backup` 의 보존 정책을 정할 때 참고할 수 있는 선례.
5. **하드웨어 인코더 폴백 + 오류 정규식 분류**는 Priming MP4 굽기(`vrew-render`)에도 쓸 만한 아이디어: nvenc 실패 정규식 3종과 「`moov atom not found`·`Invalid data found`」 분류. (현재 Priming 은 `libx264 -bf 0` 고정이라 판단 필요 — 로이 결정 사항.)
6. **서버 기능은 가져올 수 없다**(로그인·유료·서버 비공개). 자동 장면 나누기·AI 캐릭터·립싱크·노이즈 제거는 Priming 쪽에서 **우리 방식(kie·Claude·로컬)으로 따로 구현**해야 한다. 노이즈 제거는 엔진 이름이 공개돼 있다(Resemble Enhance, 오픈소스).
7. **설치본 수정·재배포 금지.** 이 분석은 읽기 전용이며, Vrew 는 상용 프로그램이므로 코드를 복사해 오는 일 없이 **관찰한 동작·파일 형식만** 참고한다(자체 호환 목적의 형식 읽기·쓰기는 Priming 이 이미 하고 있는 범위).

## 9. 아직 안 한 것 (이어서 할 수 있는 일)

| 질문 | 방법 | 비용 |
|---|---|---|
| `project.json` 정확한 스키마 | Vrew 4.8.1 로 샘플 저장 → `lab-vrew-compare.js` | 앱 실행 필요 · 가장 값어치 큼 |
| 16→17 마이그레이션 내용 | 렌더러 번들에서 `version:17` 주변 함수 읽기(번들 4.1MB, grep 으로 29곳 단서 있음) | 정적 · 중간 |
| STT 요청·응답(단어 타임스탬프 형식) | `/transcript` 호출부와 응답 파서 읽기 | 정적 · 중간 — Lab `word-align` 과 비교 가치 있음 |
| 자막 효과 `assetEffectInfo` 구조 | 렌더러 읽기 | 정적 |
| main.js 의미 그래프 | `max_heap_mb` 올려 재시도(기본 1024MB 에서 힙 부족) | REA 재실행 |
| 4.7.2 ↔ 4.8.1 변경 목록 | 4.7.2 번들 확보 후 `compare_application_versions` | 구버전 파일 필요 |

## 10. 근거 표

| 결론 | 근거 |
|---|---|
| 퓨즈 상태 | REA `inspect_electron_fuses` — 증거 `ev_f4bb8d725f3eea9bee5f243d4df8945e19adc1ee19ede3a1e005b5123a4a776a` (관찰) |
| 앱 구조·의존성 | `resources/app/package.json`, 폴더 목록, REA 요약 `ev_f2950f836bfb4709271322eecfbb3229812e779faabacdf330b86844bfc88dc1`(Electron 창 2·IPC 핸들러 143·리터럴 채널 133 — 단, main 의미 분석은 부분 실패) |
| 파일 버전·확장자·자동저장 상수 | `main.js` 17720–17770줄 (관찰) |
| mux 인자·IPC 목록 | `main.js` 86137–86370줄, 정규식 추출한 `ipc("…")` 목록 (관찰) |
| 서버 URL·ffmpeg 다운로드 | `main.js` 80247–80285줄 (관찰) |
| 엔드포인트·프로젝트 키 | 렌더러 `index-DQ24K5GK.js` 문자열 추출 (관찰 — 일부 본문만 읽음) |
| 「Vrew STT 구성」·「립싱크 방식」 | 이름/로케일에서 **추정** — 확정 아님 |
