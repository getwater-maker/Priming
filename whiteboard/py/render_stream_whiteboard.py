#!/usr/bin/env python3
"""
SRT 화이트보드 애니메이션 - 통합 렌더러 (영역 편성 + 연속 펜선)

선화 이미지 한 장 + 같은 이름의 annotation.json 을 화이트보드 손그림 애니메이션으로 렌더한다:
  - 편성: sequence/startMs 순서대로 영역을 하나씩 드러낸다.
    영역마다 그릴 수 있는 범위 = 사각형 region - (후속 영역 + protectedRegions).
    시작 전 영역은 마스크에 막혀 미리 드러나지 않는다 (마스크의 핵심 불변식).
  - 그리는 법: 각 영역이 자기 허용 마스크 안에서
    골격/격자 경로를 따라 연속으로 먹을 놓는다 (선 ink -> 채색 color). 펜끝이 실제 펜선을 따라간다.
    모든 영역이 같은 캔버스를 공유하고, 다 그린 영역은 캔버스에 남는다.

사각형으로 지워내는 방식과 다르다. 펜끝이 선을 따라 미끄러지며 먹을 놓는 이어진 펜선이다.
마지막 줄에 OUTPUT=<경로> 를 찍어 호출하는 쪽이 받아 쓰게 한다.

사용법:
  <ENV_PY> render_stream_whiteboard.py <이미지> <주석json> <출력mp4> [손이미지png]
  선택 인자는 --help 참고 (--ink-path / --color-fill / --pause / --total-ms 등).
  --total-ms 를 안 주면 주석의 sceneDurationMs 를 쓴다.
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

# 같은 폴더의 stream 렌더러 부품을 그대로 재사용
_SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPT_DIR))
import stream_render as sr  # noqa: E402

DEFAULT_HAND = _SCRIPT_DIR.parent / "assets" / "drawing-hand.png"


# ──────────────────────────────────────────────────────────────
# 영역 기하: 주석 캔버스 좌표를 출력 크기로 환산
# ──────────────────────────────────────────────────────────────
def _scaled_rect(region: dict, sx: float, sy: float, out_w: int, out_h: int) -> tuple[int, int, int, int]:
    x0 = int(round(region["x"] * sx))
    y0 = int(round(region["y"] * sy))
    x1 = int(round((region["x"] + region["width"]) * sx))
    y1 = int(round((region["y"] + region["height"]) * sy))
    x0 = max(0, min(out_w, x0))
    x1 = max(0, min(out_w, x1))
    y0 = max(0, min(out_h, y0))
    y1 = max(0, min(out_h, y1))
    return x0, y0, x1, y1


def _frame_progress_indices(n_steps: int, target_frames: int) -> list[int]:
    """펜끝 위치 n_steps 개를 target_frames 프레임에 고르게 배분한다."""
    if n_steps == 0 or target_frames <= 0:
        return []
    if target_frames == 1:
        return [n_steps - 1]
    return [round(f * (n_steps - 1) / (target_frames - 1)) for f in range(target_frames)]


# ──────────────────────────────────────────────────────────────
# 영역마다 연속 펜선을 그려 공유 캔버스에 쓴다
# ──────────────────────────────────────────────────────────────
class RegionStreamRenderer:
    """렌더 전체의 공유 상태를 들고, 영역마다 연속 펜선을 같은 캔버스에 그린다."""

    def __init__(self, image_bgr: np.ndarray, annotation: dict, cfg: sr.Config,
                 hand_png: Path | None, bare_tip: bool) -> None:
        self.cfg = cfg
        self.ann = annotation
        self.canvas_bgr = sr._hex_to_bgr(cfg.canvas_hex)

        # 출력 크기: 긴 변을 cap 으로 제한하고 grid_edge 의 짝수 배로 맞춘다 (인코딩이 짝수를 요구)
        h0, w0 = image_bgr.shape[:2]
        scale = cfg.cap_long_edge / max(h0, w0)
        align = cfg.grid_edge if cfg.grid_edge % 2 == 0 else cfg.grid_edge * 2
        w = max(align, (int(round(w0 * scale)) // align) * align)
        h = max(align, (int(round(h0 * scale)) // align) * align)
        self.out_w, self.out_h = w, h

        # 주석 캔버스 좌표 -> 출력 좌표 환산 비율
        cw = annotation["canvas"]["width"]
        ch = annotation["canvas"]["height"]
        self.sx = self.out_w / cw
        self.sy = self.out_h / ch

        self.color_img = cv2.resize(image_bgr, (self.out_w, self.out_h), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(self.color_img, cv2.COLOR_BGR2GRAY)
        self.thresh_map = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 10
        )
        self.grid_blocks = sr._to_grid_blocks(self.thresh_map, cfg.grid_edge)
        self.active_all = sr._active_mask(self.thresh_map, cfg.grid_edge, cfg.ink_threshold)
        self.ink_pixels = self.thresh_map < cfg.ink_threshold
        self.ink_paint = np.repeat(self.thresh_map[:, :, None], 3, axis=2).astype(np.float32)

        # 배경을 캔버스 바탕색으로 물들여 채색 단계와 선 단계의 배경을 맞춘다 (먹선은 안 건드림)
        if cfg.match_bg:
            self._match_original_background()

        # 공유 캔버스
        self.drawn = np.empty((self.out_h, self.out_w, 3), dtype=np.float32)
        self.drawn[...] = self.canvas_bgr.astype(np.float32)

        # 펜끝 오버레이
        self.tip: sr.TipOverlay | None = None
        if not bare_tip:
            hand_data = sr._load_hand(hand_png, cfg.target_hand_height) if hand_png else None
            ax, ay = cfg.tip_anchor_x, cfg.tip_anchor_y
            if hand_data is None:
                hand_data = sr._procedural_tip(cfg.target_hand_height)
                ax, ay = 0.5, 0.70
            self.tip = sr.TipOverlay(hand_data[0], hand_data[1], tip_anchor_x=ax, tip_anchor_y=ay)

    # 원본 네 귀퉁이를 떠서 배경색에 가까운 픽셀을 캔버스 바탕색으로 바꾼다
    def _match_original_background(self) -> None:
        img = self.color_img
        h, w = img.shape[:2]
        margin = max(3, min(h, w) // 50)
        samples = [img[:margin, :margin], img[:margin, -margin:],
                   img[-margin:, :margin], img[-margin:, -margin:]]
        bg = np.median(np.concatenate([s.reshape(-1, 3) for s in samples]), axis=0)
        diff = np.abs(img.astype(np.int16) - bg.astype(np.int16)).sum(axis=2)
        img[diff < self.cfg.match_bg_threshold] = self.canvas_bgr

    def _cell_center(self, cell: tuple[int, int]) -> tuple[int, int]:
        r, c = cell
        e = self.cfg.grid_edge
        return (c * e + e // 2, r * e + e // 2)

    def _snapshot_with_tip(self, px: int, py: int) -> np.ndarray:
        snap = self.drawn.astype(np.uint8)
        if self.tip is not None:
            self.tip.stamp(snap, px, py)
        return snap

    # -- 영역의 허용 마스크: 사각형 - 후속 영역 - protectedRegions --
    def _allowed_mask(self, element: dict, later_elements: list[dict]) -> np.ndarray:
        mask = np.zeros((self.out_h, self.out_w), dtype=bool)
        x0, y0, x1, y1 = _scaled_rect(element["region"], self.sx, self.sy, self.out_w, self.out_h)
        mask[y0:y1, x0:x1] = True
        for later in later_elements:
            lx0, ly0, lx1, ly1 = _scaled_rect(later["region"], self.sx, self.sy, self.out_w, self.out_h)
            mask[ly0:ly1, lx0:lx1] = False
        for prot in element.get("reveal", {}).get("protectedRegions", []):
            px0, py0, px1, py1 = _scaled_rect(prot, self.sx, self.sy, self.out_w, self.out_h)
            mask[py0:py1, px0:px1] = False
        return mask

    # -- 영역 안의 펜선 경로 --
    def _region_grid_path(self, allowed: np.ndarray) -> list[tuple[int, int]]:
        """격자 모드: 영역 안에서 먹이 있는 칸을 묶어 연속된 칸 경로로 잇는다."""
        allowed_u8 = allowed.astype(np.uint8)
        allowed_cell = sr._to_grid_blocks(allowed_u8, self.cfg.grid_edge).any(axis=(2, 3))
        active = self.active_all & allowed_cell
        if not active.any():
            return []
        streams = sr.cluster_ink_streams(active)
        return sr.flatten_streams(streams)

    def _region_skeleton_strokes(self, allowed: np.ndarray) -> list[list[tuple[int, int]]]:
        """골격 모드: 영역 안 먹선 세선화 + 8이웃 추적 + 재샘플링 평활."""
        cfg = self.cfg
        region_ink = self.ink_pixels & allowed
        if not region_ink.any():
            return []
        skel = sr._zhang_suen_skeleton(region_ink, max_iterations=160)
        raw = sr.trace_8connected(skel, min_points=cfg.skeleton_min_points)
        if not raw:
            return []
        spacing = cfg.skeleton_resample_spacing
        out: list[list[tuple[int, int]]] = []
        for stroke in raw:
            pts = [(float(x), float(y)) for x, y in stroke]
            pts = sr._resample_stroke_points(pts, spacing)
            pts = sr._chaikin_smooth(pts, iterations=1)
            pts = sr._resample_stroke_points(pts, spacing)
            if len(pts) >= 2 and sr._stroke_cumulative_length(pts)[-1] > 2.0:
                out.append([(int(round(x)), int(round(y))) for x, y in pts])
        return sr._order_skeleton_strokes(out)

    # -- 먹 놓기 (allowed 안으로 제한) --
    def _reveal_ink_segment(self, a: tuple[int, int], b: tuple[int, int], allowed: np.ndarray) -> None:
        seg = np.zeros((self.out_h, self.out_w), dtype=np.uint8)
        thick = max(1, self.cfg.ink_reveal_radius * 2 + 1)
        cv2.line(seg, a, b, 255, thickness=thick, lineType=cv2.LINE_AA)
        revealed = (seg > 0) & self.ink_pixels & allowed
        self.drawn[revealed] = self.ink_paint[revealed]

    def _ink_stamp_cell(self, cell: tuple[int, int], allowed: np.ndarray) -> None:
        r, c = cell
        e = self.cfg.grid_edge
        block = self.grid_blocks[r, c]
        allow_block = allowed[r * e:r * e + e, c * e:c * e + e]
        ink_region = (block < self.cfg.ink_threshold) & allow_block
        paint = np.repeat(block[:, :, None], 3, axis=2)
        target = self.drawn[r * e:r * e + e, c * e:c * e + e]
        target[ink_region] = paint[ink_region]

    def _color_stamp(self, px: int, py: int, disk: np.ndarray, allowed: np.ndarray) -> None:
        radius = self.cfg.brush_radius
        h, w = self.out_h, self.out_w
        y0, y1 = max(0, py - radius), min(h, py + radius + 1)
        x0, x1 = max(0, px - radius), min(w, px + radius + 1)
        if y1 <= y0 or x1 <= x0:
            return
        by0, by1 = y0 - (py - radius), disk.shape[0] - ((py + radius + 1) - y1)
        bx0, bx1 = x0 - (px - radius), disk.shape[1] - ((px + radius + 1) - x1)
        m = disk[by0:by1, bx0:bx1] * allowed[y0:y1, x0:x1]
        inv = 1.0 - m
        target = self.drawn[y0:y1, x0:x1]
        source = self.color_img[y0:y1, x0:x1].astype(np.float32)
        for ch in range(3):
            target[:, :, ch] = target[:, :, ch] * inv + source[:, :, ch] * m

    # -- 선 긋기 단계(골격 모드): 펜선을 따라 원본 먹선을 구간별로 드러낸다. 칸 채우기 없음 --
    def _lay_ink(self, writer, frames: int, samples: list[tuple[int, int]],
                 pen_lifts: set[int], allowed: np.ndarray) -> None:
        if frames <= 0:
            return
        n = len(samples)
        if n == 0:
            for _ in range(frames):
                writer.write(self._snapshot_with_tip(self.out_w // 2, self.out_h // 2))
            return
        idx_for_frame = _frame_progress_indices(n, frames)
        last: int | None = None
        for si in idx_for_frame:
            if last is None:
                self._reveal_ink_segment(samples[si], samples[si], allowed)
            else:
                for k in range(last + 1, si + 1):
                    if k in pen_lifts:
                        continue
                    self._reveal_ink_segment(samples[k - 1], samples[k], allowed)
            sx, sy = samples[si]
            writer.write(self._snapshot_with_tip(sx, sy))
            last = si

    # -- 채색 단계: brush 또는 contour-wipe. allowed 안으로 제한 --
    def _wash_brush(self, writer, frames: int, centers: list[tuple[int, int]], allowed: np.ndarray) -> None:
        if frames <= 0:
            return
        n = len(centers)
        if n == 0:
            for _ in range(frames):
                writer.write(self._snapshot_with_tip(self.out_w // 2, self.out_h // 2))
            return
        disk = sr._feathered_disk(self.cfg.brush_radius)
        idx_for_frame = _frame_progress_indices(n, frames)
        last: int | None = None
        for ci in idx_for_frame:
            if last is None:
                self._color_stamp(*centers[ci], disk, allowed)
            else:
                for k in range(last + 1, ci + 1):
                    self._color_stamp(*centers[k], disk, allowed)
            cx, cy = centers[ci]
            writer.write(self._snapshot_with_tip(cx, cy))
            last = ci

    def _wash_contour(self, writer, frames: int, allowed: np.ndarray) -> None:
        if frames <= 0:
            return
        cfg = self.cfg
        ys_all, xs_all = np.where(allowed)
        if ys_all.size == 0:
            return
        top, bottom = int(ys_all.min()), int(ys_all.max())
        left, right = int(xs_all.min()), int(xs_all.max())
        region_h = bottom - top + 1
        region_w = right - left + 1

        # 영역 안의 저항장 (먹선 팽창 + 블러 + 행별 아래쪽 감쇠)
        ink_u8 = ((self.ink_pixels & allowed)[top:bottom + 1, left:right + 1].astype(np.uint8)) * 255
        spread = int(np.clip(min(region_w, region_h) // 32, 3, 17))
        if spread % 2 == 0:
            spread = max(3, spread - 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (spread, spread))
        dilated = cv2.dilate(ink_u8, kernel, iterations=1)
        blur_r = max(1, int(round(min(region_w, region_h) / 220.0)))
        if blur_r % 2 == 0:
            blur_r += 1
        resistance = cv2.GaussianBlur(dilated, (blur_r, blur_r), 0).astype(np.float32)
        peak = float(resistance.max())
        resistance = resistance / peak if peak > 1e-6 else np.zeros_like(resistance)
        decay = cfg.wipe_decay
        for row in range(1, region_h):
            resistance[row] = np.maximum(resistance[row], resistance[row - 1] * decay)

        wave = sr._build_wipe_wave(region_w)
        delay_px = int(np.clip(region_h * cfg.wipe_delay_ratio, 12, 52))
        ys = np.arange(region_h, dtype=np.float32)[:, None]
        sweep = region_h + 2 * delay_px
        blocks = max(1, cfg.wipe_blocks)

        allowed_crop = allowed[top:bottom + 1, left:right + 1]
        color_crop = self.color_img[top:bottom + 1, left:right + 1].astype(np.float32)
        drawn_crop = self.drawn[top:bottom + 1, left:right + 1]

        for fi in range(frames):
            progress = 1.0 if frames == 1 else fi / (frames - 1)
            lead = sr._ease_in_out_sine(progress) * sweep - delay_px
            threshold = lead + wave[None, :] - resistance * delay_px
            reveal = (ys <= threshold) & allowed_crop
            drawn_crop[reveal] = color_crop[reveal]

            lane = sr._ease_in_out_sine((fi / blocks * 2.0) % 1.0)
            forward = (int(fi // blocks) % 2 == 0)
            cx = int(lane * region_w) if forward else int((1.0 - lane) * region_w)
            cx = max(0, min(region_w - 1, cx))
            col = np.where(reveal[:, cx])[0]
            cy = int(col[-1]) if col.size > 0 else 0
            writer.write(self._snapshot_with_tip(left + cx, top + cy))

        # 마무리: 영역 안 허용 픽셀이 전부 드러나게 한다
        drawn_crop[allowed_crop] = color_crop[allowed_crop]

    # -- 격자 경로 샘플 계획 (보간 + 펜 들기 + 칸 채우기 인덱스) --
    def _grid_plan(self, path: list[tuple[int, int]]):
        samples: list[tuple[int, int]] = []
        pen_lifts: set[int] = set()
        sample_cell: list[int] = []
        for idx, cell in enumerate(path):
            cx, cy = self._cell_center(cell)
            if idx == 0:
                samples.append((cx, cy))
                sample_cell.append(idx)
                continue
            prev_cell = path[idx - 1]
            prev = self._cell_center(prev_cell)
            if math.hypot(cell[0] - prev_cell[0], cell[1] - prev_cell[1]) > math.sqrt(2):
                pen_lifts.add(len(samples))
                samples.append((cx, cy))
                sample_cell.append(idx)
                continue
            steps = max(1, int(math.hypot(cx - prev[0], cy - prev[1]) / self.cfg.sample_step))
            for s in range(1, steps + 1):
                samples.append((int(prev[0] + (cx - prev[0]) * s / steps),
                                int(prev[1] + (cy - prev[1]) * s / steps)))
                sample_cell.append(idx)
        return samples, pen_lifts, sample_cell

    # -- 메인 렌더 --
    def render_to(self, raw_path: Path, total_ms: int) -> Path:
        cfg = self.cfg
        elements = sorted(self.ann["elements"], key=lambda e: e["reveal"]["startMs"])
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(raw_path), fourcc, cfg.fps, (self.out_w, self.out_h))
        if not writer.isOpened():
            raise RuntimeError("영상 파일을 열 수 없습니다")

        weight_sum = cfg.ink_weight + cfg.color_weight
        cur_ms = 0.0
        ms_per_frame = 1000.0 / cfg.fps

        def fill_static(until_ms: float) -> None:
            nonlocal cur_ms
            n = int(round((until_ms - cur_ms) / ms_per_frame))
            if n <= 0:
                return
            snap = self.drawn.astype(np.uint8)
            for _ in range(n):
                writer.write(snap)
            cur_ms += n * ms_per_frame

        try:
            for idx, element in enumerate(elements):
                # 영역 하나가 수십 초 걸린다. 진행 표시가 없으면 부르는 쪽에서 멈춘 것처럼 보인다.
                print(f"  영역 진행: {idx + 1}/{len(elements)}")
                reveal = element["reveal"]
                start_ms = reveal["startMs"]
                dur_ms = reveal["durationMs"]
                fill_static(start_ms)

                allowed = self._allowed_mask(element, elements[idx + 1:])
                ink_frames = max(1, round(dur_ms * cfg.ink_weight / weight_sum * cfg.fps / 1000))
                color_frames = max(1, round(dur_ms * cfg.color_weight / weight_sum * cfg.fps / 1000))

                if cfg.ink_path_mode == "skeleton":
                    strokes = self._region_skeleton_strokes(allowed)
                    if strokes:
                        samples, pen_lifts = [], set()
                        for si, stroke in enumerate(strokes):
                            if si > 0:
                                pen_lifts.add(len(samples))
                            samples.extend(stroke)
                        self._lay_ink(writer, ink_frames, samples, pen_lifts, allowed)
                        centers = samples
                    else:
                        path = self._region_grid_path(allowed)
                        samples, pen_lifts, _ = self._grid_plan(path) if path else ([], set(), [])
                        self._lay_ink(writer, ink_frames, samples, pen_lifts, allowed)
                        centers = [self._cell_center(c) for c in path]
                else:
                    path = self._region_grid_path(allowed)
                    if path:
                        samples, pen_lifts, sample_cell = self._grid_plan(path)
                        # 칸 채우기: 펜끝이 나아가며 칸을 채운다 (글자·큰 덩어리를 꽉 차게)
                        self._lay_ink_grid(writer, ink_frames, samples, pen_lifts, sample_cell, path, allowed)
                        centers = [self._cell_center(c) for c in path]
                    else:
                        self._lay_ink(writer, ink_frames, [], set(), allowed)
                        centers = []

                cur_ms += ink_frames * ms_per_frame

                if cfg.color_fill == "contour-wipe":
                    self._wash_contour(writer, color_frames, allowed)
                else:
                    self._wash_brush(writer, color_frames, centers, allowed)
                cur_ms += color_frames * ms_per_frame

            # 바라보기: total_ms 까지 채우고, 끝에 완성 원본을 최소 0.5초 남긴다
            gaze_until = max(total_ms, cur_ms + 500)
            # 마지막 프레임은 완성된 원본 (바라보기)
            self.drawn[...] = self.color_img.astype(np.float32)
            fill_static(gaze_until)
        finally:
            writer.release()
        return raw_path

    # 격자 선 긋기 전용: 칸 채우기 포함. 펜끝과 먹 드러내기를 동기화
    def _lay_ink_grid(self, writer, frames: int, samples, pen_lifts, sample_cell, path, allowed) -> None:
        if frames <= 0:
            return
        n = len(samples)
        if n == 0:
            for _ in range(frames):
                writer.write(self._snapshot_with_tip(self.out_w // 2, self.out_h // 2))
            return
        idx_for_frame = _frame_progress_indices(n, frames)
        cells_done = 0
        last: int | None = None
        for si in idx_for_frame:
            if last is None:
                self._reveal_ink_segment(samples[si], samples[si], allowed)
            else:
                for k in range(last + 1, si + 1):
                    if k in pen_lifts:
                        continue
                    self._reveal_ink_segment(samples[k - 1], samples[k], allowed)
            target_cell = sample_cell[si]
            while cells_done <= target_cell and cells_done < len(path):
                self._ink_stamp_cell(path[cells_done], allowed)
                cells_done += 1
            sx, sy = samples[si]
            writer.write(self._snapshot_with_tip(sx, sy))
            last = si
        while cells_done < len(path):
            self._ink_stamp_cell(path[cells_done], allowed)
            cells_done += 1


def _parse_args(argv=None):
    p = argparse.ArgumentParser(description="SRT 화이트보드 애니메이션 통합 렌더러 (영역 편성 + 연속 펜선)")
    p.add_argument("image", help="선화 이미지 경로")
    p.add_argument("annotation", help="같은 이름의 annotation.json 경로")
    p.add_argument("output", help="출력 MP4 경로")
    p.add_argument("hand", nargs="?", default=str(DEFAULT_HAND), help="손 이미지 PNG (기본 내장)")
    p.add_argument("--total-ms", type=int, default=None, help="총 길이(ms). 생략하면 주석의 sceneDurationMs 사용")
    p.add_argument("--bare-tip", action="store_true", help="펜끝/손 오버레이 없이")
    p.add_argument("--ink-path", default="grid", choices=["grid", "skeleton"],
                   help="펜선 경로: grid 격자(기본); skeleton 골격 추적")
    p.add_argument("--color-fill", default="contour-wipe", choices=["contour-wipe", "brush"],
                   help="채색: contour-wipe 윤곽 스캔(기본); brush 궤적 따라 칠하기")
    p.add_argument("--pause", default="heavy", choices=["heavy", "auto", "light", "off"],
                   help="선 긋기 멈춤 리듬 (영역별 화법에서는 영향 적음)")
    p.add_argument("--fps", type=int, default=None)
    p.add_argument("--grid-edge", type=int, default=None)
    p.add_argument("--brush-radius", type=int, default=None)
    p.add_argument("--cap-long-edge", type=int, default=None,
                   help="출력 긴변 픽셀 상한. ★해상도가 아니라 '긴 쪽 변' 상한입니다 (기본 1920)")
    return p.parse_args(argv)


def _build_cfg(args) -> sr.Config:
    kw: dict = {}
    if args.fps is not None:
        kw["fps"] = args.fps
    if args.grid_edge is not None:
        kw["grid_edge"] = args.grid_edge
    if args.brush_radius is not None:
        kw["brush_radius"] = args.brush_radius
    if args.cap_long_edge is not None:
        kw["cap_long_edge"] = args.cap_long_edge
    kw["ink_path_mode"] = args.ink_path
    kw["color_fill"] = args.color_fill
    kw["pause_mode"] = args.pause
    return sr.Config(**kw)


def main(argv=None) -> int:
    args = _parse_args(argv)
    cfg = _build_cfg(args)

    print("=" * 56)
    print("SRT 화이트보드 애니메이션 렌더러 (영역 편성 + 연속 펜선)")
    print("=" * 56)

    image_bgr = sr._imread_any(args.image)
    if image_bgr is None:
        print(f"[err] 이미지를 읽을 수 없습니다: {args.image}")
        return 1
    try:
        annotation = json.loads(Path(args.annotation).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"[err] 주석 파일을 읽을 수 없습니다: {e}")
        return 1
    if not annotation.get("elements"):
        print("[err] 주석에 elements 가 없습니다")
        return 1

    total_ms = args.total_ms if args.total_ms is not None else annotation.get("sceneDurationMs")
    if not total_ms:
        last = max(e["reveal"]["startMs"] + e["reveal"]["durationMs"] for e in annotation["elements"])
        total_ms = last + 1000

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path = out_path.with_name(out_path.stem + "_raw.mp4")

    hand_png = Path(args.hand) if args.hand else None
    renderer = RegionStreamRenderer(image_bgr, annotation, cfg, hand_png, args.bare_tip)
    print(f"  입력: {args.image}")
    print(f"  출력 크기: {renderer.out_w}x{renderer.out_h}, 프레임레이트: {cfg.fps}")
    print(f"  영역 수: {len(annotation['elements'])}, 총 길이: {total_ms}ms, "
          f"펜선: {cfg.ink_path_mode}, 채색: {cfg.color_fill}")

    renderer.render_to(raw_path, total_ms)
    final = sr.transcode_h264(raw_path, out_path)

    size_mb = final.stat().st_size / (1024 * 1024)
    print(f"\n최종 영상: {final}  ({size_mb:.2f} MB)")
    print("=" * 56)
    print(f"OUTPUT={final}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
