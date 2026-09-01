#!/usr/bin/env python3
"""
SRT 파싱 + 장면 분할안

.srt 를 구조화된 자막 줄로 파싱하고, '장면당 25~35초 낭독' 기준에 따라 자막을
장면으로 묶는다. 장면마다 시작·끝 시각과 총 길이(→ sceneDurationMs), 본문을 낸다.

용도: srt-whiteboard-animation 작업 흐름 1단계의 입력 근거 —
이야기 사건을 읽어내고, 그림 전략을 세우고, 그림마다 sceneDurationMs 를 정한다.

사용법:
  python parse_srt.py <자막.srt> [--target-sec 30] [--min-sec 25] [--max-sec 35]

출력: JSON(stdout). 필드:
  cues    자막 한 줄마다: {index, startMs, endMs, durMs, text}
  scenes  권장 장면 수: {sceneIndex, startMs, endMs, sceneDurationMs, cueRange, text}
stderr 에는 사람이 읽을 요약을 찍는다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

_TIME = re.compile(r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})")


def _to_ms(h: str, m: str, s: str, ms: str) -> int:
    return ((int(h) * 60 + int(m)) * 60 + int(s)) * 1000 + int(ms.ljust(3, "0"))


def parse_srt(text: str) -> list[dict]:
    """SRT 본문을 자막 줄 목록으로 파싱한다. 여분의 빈 줄·BOM·밀리초 구분자(쉼표/점)를 허용."""
    text = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n\s*\n", text.strip())
    cues: list[dict] = []
    for block in blocks:
        lines = [ln for ln in block.split("\n") if ln.strip() != ""]
        if not lines:
            continue
        # 시간축이 있는 줄 찾기
        time_line_idx = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if time_line_idx is None:
            continue
        times = _TIME.findall(lines[time_line_idx])
        if len(times) < 2:
            continue
        start = _to_ms(*times[0])
        end = _to_ms(*times[1])
        body = " ".join(lines[time_line_idx + 1:]).strip()
        cues.append({
            "index": len(cues) + 1,
            "startMs": start,
            "endMs": end,
            "durMs": max(0, end - start),
            "text": body,
        })
    return cues


def group_scenes(cues: list[dict], target_sec: float, min_sec: float, max_sec: float) -> list[dict]:
    """
    목표 길이에 맞춰 연속된 자막을 장면으로 묶는다. target 근처에 이르면 끊되,
    min 보다 짧지 않고 max 보다 길지 않게 한다 (max 를 넘으면 강제로 끊는다).
    """
    scenes: list[dict] = []
    bucket: list[dict] = []
    target_ms, min_ms, max_ms = target_sec * 1000, min_sec * 1000, max_sec * 1000

    def flush() -> None:
        if not bucket:
            return
        start = bucket[0]["startMs"]
        end = bucket[-1]["endMs"]
        scenes.append({
            "sceneIndex": len(scenes) + 1,
            "startMs": start,
            "endMs": end,
            "sceneDurationMs": max(0, end - start),
            "cueRange": [bucket[0]["index"], bucket[-1]["index"]],
            "text": " ".join(c["text"] for c in bucket).strip(),
        })
        bucket.clear()

    for cue in cues:
        # 이 줄을 지금 장면에 넣으면 max 를 넘길 때, 먼저 끊는다 (너무 긴 장면 방지)
        if bucket:
            span_with = cue["endMs"] - bucket[0]["startMs"]
            if span_with > max_ms:
                flush()
        bucket.append(cue)
        span = bucket[-1]["endMs"] - bucket[0]["startMs"]
        # 목표에 도달했고 min 보다 짧지 않으면 끊는다
        if span >= target_ms and span >= min_ms:
            flush()
    flush()
    return scenes


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="SRT 파싱 + 장면 분할안")
    p.add_argument("srt", help="자막 파일 경로 (.srt)")
    p.add_argument("--target-sec", type=float, default=30.0, help="장면당 목표 낭독 초 (기본 30)")
    p.add_argument("--min-sec", type=float, default=25.0, help="장면당 최소 초 (기본 25)")
    p.add_argument("--max-sec", type=float, default=35.0, help="장면당 최대 초 (기본 35)")
    args = p.parse_args(argv)

    try:
        raw = Path(args.srt).read_text(encoding="utf-8-sig")
    except OSError as e:
        print(f"[err] 자막을 읽을 수 없습니다: {e}", file=sys.stderr)
        return 1

    cues = parse_srt(raw)
    if not cues:
        print("[err] 자막을 하나도 못 읽었습니다. SRT 형식을 확인하세요", file=sys.stderr)
        return 1
    scenes = group_scenes(cues, args.target_sec, args.min_sec, args.max_sec)

    total_ms = cues[-1]["endMs"] - cues[0]["startMs"]
    print(f"자막 줄: {len(cues)}  총 길이: {total_ms/1000:.1f}s  권장 장면 수: {len(scenes)}", file=sys.stderr)
    for s in scenes:
        print(f"  장면{s['sceneIndex']:>2}  {s['startMs']/1000:6.1f}-{s['endMs']/1000:6.1f}s "
              f"({s['sceneDurationMs']/1000:4.1f}s, 자막{s['cueRange'][0]}-{s['cueRange'][1]}): "
              f"{s['text'][:40]}", file=sys.stderr)

    json.dump({"cues": cues, "scenes": scenes}, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
