# whiteboard — 출처와 동기화

이 폴더는 **`D:\화이트보드`(로이 소유 한국어판)의 사본**이다. 그쪽이 상류이고 여기는 벤더링본이다.
한국어판 자체는 [geeklee/srt-whiteboard-animation](https://github.com/geeklee/srt-whiteboard-animation)(MIT)에서
갈라져 나왔고, 무엇을 왜 고쳤는지는 상류의 `PATCHES.md` 에 있다. `LICENSE` 는 MIT 고지 유지 의무 때문에 함께 둔다.

## 왜 벤더링했나

`D:\화이트보드` 는 저장소 밖이라 **라이트 업데이트로 배포되지 않는다**(`D:\TTS_Model\omnivoice`·`qwen-design` 과 같은 처지).
그대로 두면 이 기능은 **메인 PC 전용**이 된다. 파이썬 6개 + 손 이미지 + 편집기가 100KB 남짓이라 저장소에 넣는 편이 싸다.

## 구조 — 폴더 이름을 바꾼 이유가 있다

```
whiteboard/
  py/          ← 상류의 scripts/*.py
  assets/      ← drawing-hand.png · preview.html
  examples/    ← 주석 형식 참조용 JSON 1개 (mp4·png 는 안 가져옴)
  priming/     ← 🔵 **우리 것** — 상류 동기화 대상이 아니다 (아래)
  .venv/       ← 앱이 각 PC 에서 만든다 (git·매니페스트 제외)
```

🔵 **`priming/` 만 우리가 쓰고 고친다.** 나머지(`py/` · `assets/` · `examples/` · `LICENSE`)는
상류 사본이라 **여기서 고치지 않는다.** 같은 `.venv` 를 쓰므로 opencv·numpy·Pillow 를 그대로 쓸 수 있다.
- `draft_regions.py` — 선화에서 **영역 초안**(OpenCV 연결요소 → 균형 분할 → 경계 상자).
  성공 계약은 `REGIONS=<json>`, 실패는 `[err] ` 접두 — 상류와 같은 규약을 따른다.

🔴 **`py/` 를 `scripts/` 로 두면 안 된다.** `scripts/gen-manifest.js` 의 `EXCLUDE_DIR_NAMES` 가
**폴더 이름만 보고** 거르기 때문에, `whiteboard/scripts/` 는 매니페스트에서 **조용히 빠지고**
다른 PC 에 파이썬이 안 내려간다. 앱은 멀쩡히 도는데 아내 PC 에서만 실패하는 종류의 사고다.

🔴 **`.venv` 는 `EXCLUDE_DIR_NAMES` 에 넣어 뒀다.** 안 막으면 수백 MB 가 매니페스트에 섞여
GitHub 에 올라가고 **모든 PC 가 그걸 받는다.** 지우지 말 것.

⚠ 파이썬 파일의 상대 경로는 **두 단계 위**(`Path(__file__).parent.parent`)를 스킬 루트로 본다
(`DEFAULT_HAND` · `VENV_ROOT`). `py/` 와 `assets/` 가 **형제**여야 하므로 이 배치를 바꾸지 말 것.

## 상류에서 다시 당겨올 때

`D:\화이트보드` 에서 고치고 `PATCHES.md` 에 기록한 뒤 여기로 복사한다. **반대 방향으로 고치지 않는다** —
여기서 고치면 상류와 갈라지고 근거가 두 군데로 흩어진다.

복사 대상: `scripts/*.py → py/` · `assets/{drawing-hand.png,preview.html}` · `LICENSE`.
⚠ `examples/*.mp4`·`*.png` 는 가져오지 않는다(용량). SKILL.md·README.md 는 상류에서 읽는다.
