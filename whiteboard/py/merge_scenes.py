#!/usr/bin/env python3
"""
여러 장면 병합: 각 장면의 화이트보드 애니메이션 MP4 를 순서대로 이어 붙여 한 편으로 만든다.

시스템 ffmpeg 무손실 병합(-c copy, 재인코딩 없음)을 우선 쓴다. 조각마다 크기·코덱이 다르거나
ffmpeg 이 없으면 PyAV 로 다시 인코딩하고 첫 조각 크기에 맞춰 여백을 채운다. 개별 조각은 남긴다.

사용법:
  <ENV_PY> merge_scenes.py --inputs a.mp4 b.mp4 c.mp4 --output final.mp4
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def _ffmpeg_concat_copy(inputs: list[Path], output: Path) -> bool:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        return False
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        for p in inputs:
            f.write(f"file '{p.resolve().as_posix()}'\n")
        list_path = Path(f.name)
    try:
        res = subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
             "-i", str(list_path), "-c", "copy", str(output)],
            capture_output=True, text=True,
        )
        if res.returncode == 0:
            print(f"  ffmpeg 무손실 병합 완료: {output}")
            return True
        print(f"  [warn] ffmpeg -c copy 실패, 재인코딩으로 재시도: {res.stderr.strip()[:200]}")
        res = subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
             "-i", str(list_path), "-c:v", "libx264", "-crf", "20",
             "-pix_fmt", "yuv420p", "-vf", "scale='trunc(iw/2)*2':'trunc(ih/2)*2'", str(output)],
            capture_output=True, text=True,
        )
        if res.returncode == 0:
            print(f"  ffmpeg 재인코딩 병합 완료: {output}")
            return True
        print(f"  [warn] ffmpeg 재인코딩도 실패: {res.stderr.strip()[:200]}")
        return False
    finally:
        list_path.unlink(missing_ok=True)


def _pyav_concat(inputs: list[Path], output: Path) -> bool:
    try:
        import av
    except ImportError:
        return False
    import numpy as np  # noqa: F401
    first = av.open(str(inputs[0]))
    vs = first.streams.video[0]
    w, h = vs.codec_context.width, vs.codec_context.height
    rate = vs.average_rate
    first.close()

    out = av.open(str(output), mode="w")
    ostream = out.add_stream("h264", rate=rate)
    ostream.width, ostream.height = w, h
    ostream.pix_fmt = "yuv420p"
    ostream.options = {"crf": "24", "preset": "medium"}
    for p in inputs:
        cont = av.open(str(p))
        for frame in cont.decode(video=0):
            if frame.width != w or frame.height != h:
                frame = frame.reformat(width=w, height=h)
            for pkt in ostream.encode(frame):
                out.mux(pkt)
        cont.close()
    for pkt in ostream.encode(None):
        out.mux(pkt)
    out.close()
    print(f"  PyAV 병합 완료: {output}")
    return True


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="화이트보드 애니메이션 MP4 를 순서대로 병합")
    p.add_argument("--inputs", nargs="+", required=True, help="재생 순서대로 나열한 MP4 목록")
    p.add_argument("--output", required=True, help="병합 결과를 저장할 경로")
    args = p.parse_args(argv)

    inputs = [Path(x) for x in args.inputs]
    missing = [str(x) for x in inputs if not x.exists()]
    if missing:
        print(f"[err] 입력 파일이 없습니다: {', '.join(missing)}", file=sys.stderr)
        return 1
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    if _ffmpeg_concat_copy(inputs, output) or _pyav_concat(inputs, output):
        print(f"OUTPUT={output.resolve()}")
        return 0
    print("[err] 병합 실패: ffmpeg 도 없고 PyAV 도 쓸 수 없습니다", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
