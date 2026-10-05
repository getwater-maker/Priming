# 🎙 참조음성 만들기 CLI — 세션(Claude Code)용 공식 입구

> 채널사업부 요청(2026-10-05 · 「세션이 참조음성을 만들고 검증할 때 OmniVoice 키에 막히지 않게」) · 로이 「B 안」 확정 · v0.6.99
> 앱 보이스디자인 창과 **같은 함수**(`core/ref-voice` · `wav-slice` · `tts-backcheck` · `qwen-design` · `asr-client`)를 쓴다 → 앱·세션 판정이 어긋나지 않는다.
> 🔒 **키는 이 도구가 읽거나 출력하지 않는다** — 서버 호출 모듈이 앱의 키 저장소에서 안에서 읽는다(앱이 합성할 때와 같다). 서버(api.py)·보안 설정은 바꾸지 않았다(A 안 = 로컬 면제는 하지 않음).

## 어디서 실행하나
- **설치된 앱 폴더**(앱을 한 번 다시 켜면 라이트 업데이트로 들어온다 · node_modules 가 있다):
  `node "%LOCALAPPDATA%\Programs\priming\resources\app\tools\ref-voice.js" …`
- 또는 저장소(`git pull` 뒤): `node D:\Priming\tools\ref-voice.js …`
- 서버 주소는 앱 설정(⚙ 설정 → 🖧 TTS 서버)을 그대로 쓴다. 메인 PC 기준: 보이스디자인 9893 · OmniVoice 9881.
- ⚠ GPU 를 쓴다(보이스디자인 · OmniVoice · Whisper) — 앱에서 만들기(TTS·로컬 이미지)를 돌리는 중이면 끝난 뒤에.

## 쓰는 법
```
# 만들기(테이크 4개 → 가장 좋은 것 → 새 문장 3개 역대조) — 등록은 하지 않는다
node tools/ref-voice.js --lang ja --name JA_수면_남1 --instruct "<목소리 설명(영어 권장)>"

# 만들고 라이브러리에 등록(이 PC ~/.flow-app/ref-audio + 서버 공용 라이브러리) → 등록한 이름(ref_name)으로 역대조
node tools/ref-voice.js --lang ja --name JA_수면_남1 --instruct "…" --takes 4 --register

# 이미 등록한 목소리를 새 문장으로 역대조만(오늘 막혔던 단계)
node tools/ref-voice.js --lang ja --verify-only JA_수면_남1
```
| 옵션 | 한국어 별칭 | 뜻 |
|---|---|---|
| `--lang ko\|ja\|vi` | `--언어` | ja·ko = 보이스디자인(Qwen3 9893) · vi = OmniVoice 목소리 설명(Qwen3 은 베트남어 미지원) |
| `--name` | `--이름` | 등록 이름(파일명) |
| `--instruct` | `--설명` | 목소리 설명 |
| `--text` | `--문장` | 참조문(없으면 앱 기본 예문 — `core/ref-voice SAMPLE_TEXT`) |
| `--takes N` | `--테이크` | 테이크 수(기본 4 · 최대 10) |
| `--min 0.9` | `--최소` | 테이크 통과 일치율(기본 0.9) |
| `--register` | `--등록` | 등록까지(서버에 같은 이름이 있거나 목록을 못 읽으면 멈춤 · `--overwrite` 로만) |
| `--verify "a\|b\|c"` | `--검증` | 역대조 문장(없으면 언어별 기본 3개) |
| `--verify-only <이름>` | `--검증만` | 등록된 목소리 역대조만 |
| `--out <폴더>` | `--출력` | 결과 폴더(기본 `~/.flow-app/ref-design/<이름>/`) |

## 순서(앱 보이스디자인 창과 같다)
1. 테이크 n개 생성 → `take<N>_full.wav`
2. 자르기 = `cutRange`(외국어 = 문장 사이 쉼 · 한국어 = 앞 무음·끝 감쇠) → `take<N>.wav`
3. 판정 = **통째 테이크 받아쓰기 vs 원문**(`textMatchRatio` — 앱 창의 일치율과 같은 값) · 잘라낸 구간 받아쓰기로 참조텍스트를 잘린 데에 맞춤(`refTextForCut`)
4. 가장 좋은 테이크 → `<이름>.wav` + `<이름>.txt`(참조텍스트) · `--register` 면 등록
5. 새 문장 3개 합성(등록했으면 `ref_name` · 아니면 잘라낸 파일) → 역대조(`tts-backcheck.checkAudio` · 기준 ja 85% · vi 90% · ko 85%) → `verify<N>.wav`
6. 결과표 `<이름>_결과.tsv`(UTF-8 BOM · 엑셀) · 끝 코드 0 = 통과 · 1 = 미달·실패 · 2 = 사용법

## 함정
- 일본어 예문·검증문은 **「昔々」로 시작하지 않는다** — Qwen3 ja 가 자주 잘못 읽고(85~95%), 가나 「むかしむかし」로 쓰면 받아쓰기(Whisper)가 「昔々」로 적어 맞게 읽어도 점수가 깎인다(표기 차이). 昔話/むかしばなし · 子供/子ども · 一つ/ひとつ 처럼 **표기가 갈리는 낱말은 검증문에 넣지 않는다**.
- 실측(2026-10-05 · 이 PC): ja 테이크 2개 100% · 새 문장 3/3 100% · `--verify-only JA_남성_중년` 3/3 · 키는 출력·결과표 어디에도 없음(자동 대조).
