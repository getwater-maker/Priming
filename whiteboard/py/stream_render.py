#!/usr/bin/env python3
"""
연속 펜선 애니메이션 - 단일 이미지 렌더 진입점

컬러 이미지 한 장을 '펜끝이 이어진 궤적을 미끄러지며 먹을 놓는' 화이트보드 애니메이션으로 렌더한다.
전체는 세 단계로 나뉜다:
  선 긋기(ink)   펜끝이 먹줄기를 따라 검은 선화를 깐다
  채색(color)    같은 궤적을 되돌아오며 원래 색을 되살린다
  바라보기(gaze) 펜을 뗀 뒤 머물며 완성된 원본을 보여준다

칸칸이 툭툭 나타나는 방식과 다르다. 이 렌더러는 그리는 순서를 펜끝의 이동 경로로 보고,
이웃한 낙점 사이를 보간해 먹붓이 펜끝을 따라 이어서 먹을 놓는다. 그래서 펜선이 끊기지 않는다.
"""
from __future__ import annotations

import argparse
import datetime
import math
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import cv2
import numpy as np

# ──────────────────────────────────────────────────────────────
# 자원 위치
# ──────────────────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
_ASSETS_DIR = _SCRIPT_DIR.parent / "assets"
DEFAULT_HAND_PNG = _ASSETS_DIR / "drawing-hand.png"


def _imread_any(path: str | Path, flags: int = cv2.IMREAD_COLOR) -> np.ndarray | None:
    """
    이미지를 읽는다. 한글·공백 등 비 ASCII 문자가 든 윈도우 경로도 처리한다.
    np.fromfile 로 바이트를 먼저 읽고 cv2.imdecode 로 디코딩해
    cv2.imread 의 비 ASCII 경로 문제를 피한다.
    """
    raw = np.fromfile(str(path), dtype=np.uint8)
    if raw.size == 0:
        return None
    return cv2.imdecode(raw, flags)


# ──────────────────────────────────────────────────────────────
# 렌더 파라미터 모음
# ──────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Config:
    fps: int = 60                  # 높은 프레임레이트라야 펜끝 이동이 실제 필기에 가깝다
    grid_edge: int = 10            # 격자가 작을수록 선화가 드러날 때 덩어리 느낌이 준다
    sample_step: int = 2           # 펜끝 궤적의 픽셀 샘플 간격
    cap_long_edge: int = 1920      # 입력 이미지 '긴 쪽 변' 상한 (해상도가 아님). 원본 기본값은 1080
    brush_radius: int = 40         # 채색 단계의 원형 먹붓 반지름
    ink_weight: int = 2            # 선 긋기 단계 비중: 펜선을 볼 시간을 더 준다
    color_weight: int = 1          # 채색 단계 비중
    gaze_seconds: float = 3.0      # 바라보기 단계 기준 초
    ink_threshold: int = 10        # 적응 임계 결과가 이 값보다 낮으면 '먹'으로 본다
    ink_reveal_radius: int = 4     # 펜끝이 궤적 한 구간에서 선화를 드러낼 반지름
    target_hand_height: int = 493  # 손 이미지를 줄인 뒤 목표 높이 (1080p 기준으로 맞춤)
    # 손 이미지 안에서 펜끝의 정규화 좌표(0..1). 낙점이 이미지의 어느 픽셀에 맞춰질지 정한다.
    # 내장 drawing-hand.png 는 잘라낸 뒤 펜끝이 왼쪽 위에 오므로 앵커를 (0, 0) 으로 둔다.
    # 이건 실제로 먹이 닿는 지점이지 손 이미지의 바깥 테두리가 아니다.
    tip_anchor_x: float = 0.0
    tip_anchor_y: float = 0.0
    canvas_hex: str = "#F6F1E3"    # 캔버스 바탕색
    match_bg: bool = True          # 원본 배경을 캔버스 바탕색으로 물들여 선 긋기와 채색의 배경을 맞춘다
    match_bg_threshold: int = 28   # 원본 배경색과의 차이가 이보다 작으면 배경으로 본다 (BGR 3채널 합)
    steps_per_frame: int = 4       # 프레임당 나아갈 낙점 수 기준
    # -- contour-wipe 채색 모드 전용 --
    color_fill: str = "contour-wipe"  # 채색 방식: "contour-wipe" 윤곽을 인식해 위에서 아래로 스캔(기본) | "brush" 궤적 따라 칠하기
    wipe_decay: float = 0.86       # 저항장이 행마다 아래로 감쇠하는 계수 (반감기 약 4.6px)
    wipe_delay_ratio: float = 0.04  # 윤곽에서 전선이 깎이는 픽셀 비율 (×h, [12,52] 로 제한)
    wipe_blocks: int = 18          # 펜끝이 좌우로 왕복하는 횟수
    # -- 선 긋기 단계의 자동 멈춤 ('붓 바꾸며 숨 돌리는' 리듬을 흉내) --
    # pause_mode: "heavy" 뚜렷한 멈춤(기본) | "auto" 내용 밀도에 따라 자동 | "off" 멈춤 없음 | "light" 조금
    pause_mode: str = "heavy"
    pause_ratio_heavy: float = 0.03   # 저밀도(느린 리듬) 멈춤 비율: 약 3% 프레임을 멈춤에 쓴다
    pause_ratio_light: float = 0.008  # 중밀도 멈춤 비율: 약 0.8%
    # 밀도 구간 기준: '칸당 프레임 수'(frames_per_cell) 로 길이가 내용 대비 여유로운지 잰다.
    # >= heavy_fpc 여유가 많음 -> heavy (멈춤 많이) | >= light_fpc 적당 -> light |
    # < light_fpc 내용이 빽빽하고 시간이 빠듯 -> 멈추지 않는다.
    pause_heavy_fpc: float = 0.7
    pause_light_fpc: float = 0.4
    # -- 펜선 경로 모드 --
    # ink_path_mode: "grid" 격자 중심 보간(기본) | "skeleton" 골격 단위 픽셀 추적
    ink_path_mode: str = "grid"
    skeleton_min_points: int = 8        # 골격 획의 최소 점 개수 (조각 걸러내기)
    skeleton_resample_spacing: float = 2.5  # 골격 재샘플링 간격 (픽셀)


# ──────────────────────────────────────────────────────────────
# 작은 도구
# ──────────────────────────────────────────────────────────────
def _hex_to_bgr(hex_color: str) -> np.ndarray:
    digits = hex_color.lstrip("#")
    if len(digits) != 6:
        raise ValueError(f"잘못된 색상값: {hex_color}")
    r = int(digits[0:2], 16)
    g = int(digits[2:4], 16)
    b = int(digits[4:6], 16)
    return np.array([b, g, r], dtype=np.uint8)


def _bounding_box(mask: np.ndarray) -> tuple[tuple[int, int], tuple[int, int]]:
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return (0, 0), (0, 0)
    return (int(xs.min()), int(ys.min())), (int(xs.max()), int(ys.max()))


# ──────────────────────────────────────────────────────────────
# 먹선 격자 분할
# ──────────────────────────────────────────────────────────────
def _to_grid_blocks(image: np.ndarray, edge: int) -> np.ndarray:
    """HxW(xC) 이미지를 (행수, 열수, edge, edge[, C]) 블록 뷰로 자른다."""
    image = np.ascontiguousarray(image)
    h, w = image.shape[:2]
    if h % edge or w % edge:
        raise ValueError(f"이미지 크기 {w}x{h} 는 {edge} 의 배수여야 합니다")
    rows, cols = h // edge, w // edge
    if image.ndim == 2:
        return image.reshape(rows, edge, cols, edge).transpose(0, 2, 1, 3)
    return image.reshape(rows, edge, cols, edge, image.shape[2]).transpose(0, 2, 1, 3, 4)


def _active_mask(threshold_map: np.ndarray, edge: int, threshold: int) -> np.ndarray:
    """어느 칸에 먹이 있는가: 블록 안에 임계 미만 픽셀이 하나라도 있으면 참."""
    blocks = _to_grid_blocks(threshold_map, edge)
    return np.any(blocks < threshold, axis=(2, 3))


# ──────────────────────────────────────────────────────────────
# 먹줄기 묶기 + 밀도 기울기 따라 걷기
# ──────────────────────────────────────────────────────────────
def _label_components(active: np.ndarray) -> tuple[np.ndarray, int]:
    """먹선 격자에 8연결 연결요소 라벨링을 한다. (라벨맵, 요소 수) 반환."""
    n, labels = cv2.connectedComponents(active.astype(np.uint8), connectivity=8)
    return labels, n - 1  # 배경 라벨 0 은 뺀다


def _component_cells(labels: np.ndarray, label: int) -> list[tuple[int, int]]:
    coords = np.argwhere(labels == label)
    return [(int(r), int(c)) for r, c in coords]


def _merge_small_components(
    components: list[list[tuple[int, int]]],
    merge_threshold: int,
) -> list[list[tuple[int, int]]]:
    """
    작은 연결요소(칸 수 <= merge_threshold)를 공간상 가장 가까운 큰 요소에 합친다.
    1~2칸짜리 조각이 큰 덩어리 사이에 끼어 '한 덩이를 다 못 그리고 건너뛰는' 걸 막는다.
    합칠 큰 요소가 없으면 그대로 둔다 (먹을 버리지 않는다).
    """
    if not components:
        return components
    big = [c for c in components if len(c) > merge_threshold]
    small = [c for c in components if len(c) <= merge_threshold]
    if not small or not big:
        return components

    # 큰 영역마다 무게중심을 미리 구한다
    centroids = []
    for cells in big:
        rs = [c[0] for c in cells]
        cs = [c[1] for c in cells]
        centroids.append((sum(rs) / len(rs), sum(cs) / len(cs)))

    # 작은 조각을 가장 가까운 큰 영역에 합친다
    merged = [list(cells) for cells in big]  # 복사본. 뒤에 덧붙일 수 있게
    for cells in small:
        rs = [c[0] for c in cells]
        cs = [c[1] for c in cells]
        cr = sum(rs) / len(rs)
        cc = sum(cs) / len(cs)
        best = min(
            range(len(big)),
            key=lambda i: (centroids[i][0] - cr) ** 2 + (centroids[i][1] - cc) ** 2,
        )
        merged[best].extend(cells)
    return merged


def _bounds(cells: Sequence[tuple[int, int]]) -> tuple[int, int, int, int]:
    rows = [row for row, _ in cells]
    cols = [col for _, col in cells]
    return min(rows), min(cols), max(rows), max(cols)


def _split_bridge_connected_component(
    cells: list[tuple[int, int]],
    min_side_cells: int = 20,
) -> list[list[tuple[int, int]]]:
    """Split a very wide component when it is connected only by a thin bridge.

    A baseline, arrow, or stray outline can join separate objects into one
    connected component.  Drawing that component with one nearest-neighbour
    walk makes the pen alternate between those objects.  Valleys in the
    vertical ink projection are reliable weak-bridge signals at grid scale.
    """
    if len(cells) < min_side_cells * 2:
        return [cells]

    min_row, min_col, max_row, max_col = _bounds(cells)
    height = max_row - min_row + 1
    width = max_col - min_col + 1
    if width < 16 or height < 10:
        return [cells]

    counts = {col: 0 for col in range(min_col, max_col + 1)}
    for _, col in cells:
        counts[col] += 1
    valley_limit = max(3, int(np.ceil(height * 0.30)))
    edge_guard = 4
    valleys: list[tuple[int, int]] = []
    start: int | None = None
    for col in range(min_col, max_col + 2):
        low = col <= max_col and counts[col] <= valley_limit
        if low and start is None:
            start = col
        elif not low and start is not None:
            end = col - 1
            if (
                end - start + 1 >= 2
                and start > min_col + edge_guard
                and end < max_col - edge_guard
            ):
                valleys.append((start, end))
            start = None
    if not valleys:
        return [cells]

    # Prefer the broadest empty corridor.  It is much less likely to be an
    # internal detail of a character than a one-column dip.
    start, end = max(valleys, key=lambda band: (band[1] - band[0], -band[0]))
    cut = (start + end) // 2
    left = [cell for cell in cells if cell[1] <= cut]
    right = [cell for cell in cells if cell[1] > cut]
    if len(left) < min_side_cells or len(right) < min_side_cells:
        return [cells]
    return (
        _split_bridge_connected_component(left, min_side_cells)
        + _split_bridge_connected_component(right, min_side_cells)
    )


def _split_bridge_connected_components(
    components: list[list[tuple[int, int]]],
) -> list[list[tuple[int, int]]]:
    return [
        piece
        for cells in components
        for piece in _split_bridge_connected_component(cells)
    ]


def _boxes_touch(
    first: tuple[int, int, int, int],
    second: tuple[int, int, int, int],
    margin: int = 2,
) -> bool:
    """Whether two component boxes belong to the same visual region."""
    a_top, a_left, a_bottom, a_right = first
    b_top, b_left, b_bottom, b_right = second
    return not (
        a_right + margin < b_left
        or b_right + margin < a_left
        or a_bottom + margin < b_top
        or b_bottom + margin < a_top
    )


def _group_adjacent_stroke_groups(
    groups: list[tuple[str, list[tuple[int, int]]]],
) -> list[list[tuple[str, list[tuple[int, int]]]]]:
    """Keep overlapping label parts and outline pieces in one draw region."""
    regions: list[list[tuple[str, list[tuple[int, int]]]]] = []
    boxes: list[tuple[int, int, int, int]] = []
    for group in groups:
        group_box = _bounds(group[1])
        touching = [index for index, box in enumerate(boxes) if _boxes_touch(group_box, box)]
        if not touching:
            regions.append([group])
            boxes.append(group_box)
            continue
        target = touching[0]
        regions[target].append(group)
        top, left, bottom, right = boxes[target]
        boxes[target] = (
            min(top, group_box[0]), min(left, group_box[1]),
            max(bottom, group_box[2]), max(right, group_box[3]),
        )
        # Merge any regions newly bridged by the expanded box.
        for index in reversed(touching[1:]):
            regions[target].extend(regions.pop(index))
            other = boxes.pop(index)
            top, left, bottom, right = boxes[target]
            boxes[target] = (
                min(top, other[0]), min(left, other[1]),
                max(bottom, other[2]), max(right, other[3]),
            )
    return regions


def classify_stroke_groups(
    active: np.ndarray,
) -> list[tuple[str, list[tuple[int, int]]]]:
    """Classify connected ink regions as a main subject, text, or local contour."""
    labels, count = _label_components(active)
    components = [
        _component_cells(labels, label)
        for label in range(1, count + 1)
    ]
    components = [cells for cells in components if cells]
    if not components:
        return []

    # A long ground line may connect a mountain, a character, and a crowd.
    # Split that weak connection before any region ordering is decided.
    components = _split_bridge_connected_components(components)

    # 작은 조각을 가까운 큰 영역에 합쳐, 조각이 큰 덩어리의 연속 그리기를 끊지 않게 한다
    total_cells = sum(len(c) for c in components)
    merge_threshold = max(3, int(total_cells * 0.005))
    components = _merge_small_components(components, merge_threshold)

    subject_index = max(range(len(components)), key=lambda index: len(components[index]))
    groups: list[tuple[str, list[tuple[int, int]], tuple[int, int, int]]] = []
    for index, cells in enumerate(components):
        min_row, min_col, max_row, max_col = _bounds(cells)
        height = max_row - min_row + 1
        width = max_col - min_col + 1
        density = len(cells) / (height * width)
        if index == subject_index:
            kind, rank = "subject", 0
        elif height >= 2 and width / height >= 2.2 and density >= 0.5:
            kind, rank = "text", 1
        else:
            kind, rank = "contour", 2
        groups.append((kind, cells, (rank, min_row, min_col)))

    groups.sort(key=lambda group: group[2])
    return [(kind, cells) for kind, cells, _ in groups]


def _density_seed(cells: Sequence[tuple[int, int]], radius: int = 2) -> tuple[int, int]:
    """이웃이 가장 빽빽한 칸을 시작점으로 고른다. 먹이 가장 진한 데서 붓을 대는 것을 흉내."""
    cell_set = set(cells)
    best = cells[0]
    best_score = -1
    for (r, c) in cells:
        score = sum(
            1
            for dr in range(-radius, radius + 1)
            for dc in range(-radius, radius + 1)
            if (r + dr, c + dc) in cell_set
        )
        if score > best_score:
            best_score = score
            best = (r, c)
    return best


def _gradient_walk(cells: Sequence[tuple[int, int]]) -> list[tuple[int, int]]:
    """
    밀도 기울기를 따라가는 그리디 워크: 밀도가 가장 높은 씨앗 칸에서 출발해, 매 걸음
    '아직 안 간 이웃 중 국소 밀도가 가장 높고 진행 방향과 각도가 가장 작은' 칸을 고른다.
    그래서 '먹을 최대한 따라가고 덜 되돌아오는' 이어진 펜선이 된다.
    갈 이웃이 없으면 전체에서 가장 가까운 미방문 칸으로 건너뛴다.
    """
    if not cells:
        return []

    cell_set = set(cells)
    seed = _density_seed(cells)
    visited: set[tuple[int, int]] = {seed}
    path: list[tuple[int, int]] = [seed]
    current = seed
    prev_dir = (0, 0)

    while len(visited) < len(cells):
        neighbors = [
            (r, c)
            for dr in (-1, 0, 1)
            for dc in (-1, 0, 1)
            if (dr or dc)
            and (r := current[0] + dr, c := current[1] + dc) in cell_set
            and (r, c) not in visited
        ]
        if neighbors:
            def cost(cell: tuple[int, int]) -> tuple:
                # 이웃이 많을수록 좋고(음수로 최소화), 방향 변화가 작을수록 좋고, 마지막은 위치로 안정 정렬
                local = sum(
                    1
                    for dr in (-1, 0, 1)
                    for dc in (-1, 0, 1)
                    if (cell[0] + dr, cell[1] + dc) in cell_set
                    and (cell[0] + dr, cell[1] + dc) not in visited
                )
                step = (cell[0] - current[0], cell[1] - current[1])
                turn = (step[0] - prev_dir[0]) ** 2 + (step[1] - prev_dir[1]) ** 2
                return (-local, turn, cell[0], cell[1])

            nxt = min(neighbors, key=cost)
        else:
            # 펜 들기: 가장 가까운 미방문 칸으로 건너뛴다
            unvisited = [cell for cell in cells if cell not in visited]
            nxt = min(
                unvisited,
                key=lambda cell: (
                    (cell[0] - current[0]) ** 2 + (cell[1] - current[1]) ** 2,
                    cell[0],
                    cell[1],
                ),
            )

        prev_dir = (nxt[0] - current[0], nxt[1] - current[1])
        path.append(nxt)
        visited.add(nxt)
        current = nxt

    return path


def _nearest_neighbor_order(
    cells: Sequence[tuple[int, int]], seed: tuple[int, int]
) -> list[tuple[int, int]]:
    """seed 에서 출발해 매 걸음 가장 가까운 미방문 칸으로 가며 이어진 펜선을 만든다."""
    if not cells:
        return []
    remaining = list(cells)
    ordered: list[tuple[int, int]] = []
    current = seed if seed in remaining else remaining[0]
    while remaining:
        ordered.append(current)
        remaining.remove(current)
        if not remaining:
            break
        current = min(
            remaining,
            key=lambda cell: (cell[0] - ordered[-1][0]) ** 2
            + (cell[1] - ordered[-1][1]) ** 2,
        )
    return ordered


def _text_scan_order(
    cells: Sequence[tuple[int, int]], segment_cols: int = 4
) -> list[tuple[int, int]]:
    """
    글자 영역 전용 화법: 가로로 구간을 쓸며 글씨 쓰는 걸 흉내 낸다.
    칸을 열 기준으로 몇 구간(구간당 segment_cols 열)으로 나누고, 구간은 왼쪽에서 오른쪽으로 간다.
    구간 안에서는 최근접 이웃으로 먹을 따라 이어서 걷는다(행 단위 스캔이 아니라).
    그래야 '한 덩이를 덜 칠하고 다음 구간 위에서 다시 시작하는' 되돌아오는 느낌이 안 난다.
    """
    if not cells:
        return []
    if segment_cols < 1:
        segment_cols = 1
    left_col = min(col for _, col in cells)
    # '시작 열 // segment_cols' 로 묶고, 번호가 작은(왼쪽) 묶음부터 그린다
    buckets: dict[int, list[tuple[int, int]]] = {}
    for cell in cells:
        bucket_key = (cell[1] - left_col) // segment_cols
        buckets.setdefault(bucket_key, []).append(cell)

    ordered: list[tuple[int, int]] = []
    prev_tail: tuple[int, int] | None = None
    for key in sorted(buckets):
        seg_cells = buckets[key]
        # 구간 시작점은 앞 구간 출구에 가깝게 잡아 구간 사이 펜 들기를 줄인다
        if prev_tail is not None:
            seed = min(
                seg_cells,
                key=lambda cell: (cell[0] - prev_tail[0]) ** 2
                + (cell[1] - prev_tail[1]) ** 2,
            )
        else:
            seed = min(seg_cells, key=lambda cell: (cell[0], cell[1]))
        seg_order = _nearest_neighbor_order(seg_cells, seed)
        ordered.extend(seg_order)
        prev_tail = seg_order[-1]
    return ordered


def _order_stream_by_kind(
    kind: str, cells: list[tuple[int, int]]
) -> list[tuple[int, int]]:
    """영역 종류에 따라 화법을 고른다: 글자는 가로 구간 스캔, 주체·윤곽은 밀도 워크."""
    if kind == "text":
        return _text_scan_order(cells)
    return _gradient_walk(cells)


def _chain_region_paths(
    groups: list[tuple[str, list[tuple[int, int]]]],
) -> list[tuple[int, int]]:
    """Finish every component in one visual region before leaving it."""
    paths = [_order_stream_by_kind(kind, cells) for kind, cells in groups]
    remaining = [path for path in paths if path]
    ordered: list[tuple[int, int]] = []
    tail: tuple[int, int] | None = None
    while remaining:
        if tail is None:
            pick_index = 0  # groups retain subject/text/contour priority.
        else:
            pick_index = min(
                range(len(remaining)),
                key=lambda index: min(
                    (remaining[index][0][0] - tail[0]) ** 2
                    + (remaining[index][0][1] - tail[1]) ** 2,
                    (remaining[index][-1][0] - tail[0]) ** 2
                    + (remaining[index][-1][1] - tail[1]) ** 2,
                ),
            )
        path = remaining.pop(pick_index)
        if tail is not None and len(path) > 1:
            head_distance = (path[0][0] - tail[0]) ** 2 + (path[0][1] - tail[1]) ** 2
            end_distance = (path[-1][0] - tail[0]) ** 2 + (path[-1][1] - tail[1]) ** 2
            if end_distance < head_distance:
                path.reverse()
        ordered.extend(path)
        tail = path[-1]
    return ordered


def cluster_ink_streams(active: np.ndarray) -> list[list[tuple[int, int]]]:
    """
    먹선 격자를 의미별로 묶어 먹줄기를 만든다: 주체(subject) -> 글자(text) -> 국소 윤곽(contour).
    줄기마다 종류에 맞는 화법을 쓴다 (글자는 구간 스캔, 나머지는 밀도 워크).
    줄기끼리는 '출구에서 입구까지 가장 가까운' 순으로 잇고, 필요하면 줄기를 통째로 뒤집어 펜 들기를 줄인다.
    이미 순서대로 이어진 여러 펜선 흐름을 반환한다.
    """
    if not active.any():
        return []
    groups = classify_stroke_groups(active)
    # A stream is now a complete visual region, not merely one connected
    # component.  Thus a label's border, its characters, and its arrow cannot
    # be interrupted by a different object that happens to be closer.
    regions = _group_adjacent_stroke_groups(groups)
    streams = [_chain_region_paths(region) for region in regions]
    streams = [s for s in streams if s]
    if not streams:
        return []

    # 잇기: 주체(첫 줄기)로 시작하고, 다음부터는 입구가 현재 출구에 가장 가까운 줄기를 고른다.
    # 필요하면 그 줄기를 통째로 뒤집어 시작점이 앞 줄기 출구에 더 가깝게 만든다.
    ordered: list[list[tuple[int, int]]] = []
    remaining = list(streams)
    tail: tuple[int, int] | None = None
    while remaining:
        if tail is None:
            pick_idx = 0  # classify 가 주체를 이미 맨 앞에 놓았다
        else:
            def dist_to_tail(stream: list[tuple[int, int]]) -> int:
                head = stream[0]
                return (head[0] - tail[0]) ** 2 + (head[1] - tail[1]) ** 2
            pick_idx = min(range(len(remaining)), key=lambda i: dist_to_tail(remaining[i]))
        pick = remaining.pop(pick_idx)
        # 뒤집기 판단: 현재 끝이 pick 의 종점에 더 가까우면 뒤집는다
        if tail is not None and len(pick) > 1:
            head = pick[0]
            end = pick[-1]
            d_end = (end[0] - tail[0]) ** 2 + (end[1] - tail[1]) ** 2
            d_head = (head[0] - tail[0]) ** 2 + (head[1] - tail[1]) ** 2
            if d_end < d_head:
                pick = pick[::-1]
        ordered.append(pick)
        tail = pick[-1]
    return ordered


def flatten_streams(streams: list[list[tuple[int, int]]]) -> list[tuple[int, int]]:
    return [cell for stream in streams for cell in stream]


# ──────────────────────────────────────────────────────────────
# 펜끝 / 손 오버레이
# ──────────────────────────────────────────────────────────────
def _load_hand(path: Path, target_h: int) -> tuple[np.ndarray, np.ndarray] | None:
    """
    손 이미지를 읽어 목표 높이에 맞춰 비율대로 줄인다.
    알파 채널을 마스크로 우선 쓰고, 알파가 없으면 '흰색에 가까우면 배경' 검출로 되돌린다.
    (손 BGR, 정규화 마스크[0..1]) 를 반환하고, 실패하면 None.
    """
    if not path.exists():
        return None
    raw = _imread_any(path, cv2.IMREAD_UNCHANGED)
    if raw is None:
        return None

    if raw.ndim == 3 and raw.shape[2] == 4:
        hand = raw[:, :, :3]
        mask = raw[:, :, 3]
    else:
        hand = raw
        gray = cv2.cvtColor(hand, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, 250, 255, cv2.THRESH_BINARY_INV)

    # 유효 영역으로 자른다
    (x0, y0), (x1, y1) = _bounding_box(mask)
    if x1 <= x0 or y1 <= y0:
        return None
    hand = hand[y0:y1 + 1, x0:x1 + 1]
    mask = mask[y0:y1 + 1, x0:x1 + 1]

    scale = target_h / hand.shape[0]
    new_w = max(1, int(round(hand.shape[1] * scale)))
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR
    hand = cv2.resize(hand, (new_w, target_h), interpolation=interp)
    mask = cv2.resize(mask, (new_w, target_h), interpolation=interp)
    mask = mask.astype(np.float32) / 255.0

    # 마스크 밖은 검게 둬서 이후 마스크 합성이 쉽게 한다
    hand[mask <= 0] = 0
    return hand, mask


def _procedural_tip(target_h: int) -> tuple[np.ndarray, np.ndarray]:
    """
    대체 펜끝: 마커를 코드로 그린다 (펜대 그라데이션 + 둥근 촉 + 그림자).
    외부 이미지에 기대지 않으므로 소재가 없어도 그려진다.
    """
    w = max(1, int(target_h * 0.34))
    h = target_h
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    # 그림자: 살짝 어긋난 어두운 띠를 부드럽게 해 바닥에 깐다
    shadow = np.zeros((h, w), dtype=np.uint8)
    cv2.rectangle(shadow, (3, int(h * 0.06)), (w - 2, int(h * 0.62)), 90, thickness=-1)
    shadow = cv2.GaussianBlur(shadow, (15, 15), 0)
    rgba[:, :, 3] = shadow

    # 펜대: 밝은 데서 어두운 데로 세로 그라데이션
    for y in range(h):
        t = y / max(1, h - 1)
        shade = int(220 - 130 * t)
        rgba[y, :, 0:3] = (shade, shade, shade + 10)
    cv2.rectangle(rgba, (4, int(h * 0.04)), (w - 4, int(h * 0.58)), (0, 0, 0), thickness=1)

    # 둥근 펜촉 (따뜻한 색으로 잉크를 흉내)
    tip_cy = int(h * 0.70)
    cv2.circle(rgba, (w // 2, tip_cy), max(3, w // 4), (70, 90, 230), thickness=-1)

    # 둥근 촉 + 펜대 외곽으로 알파 마스크를 합성
    body_mask = np.zeros((h, w), dtype=np.uint8)
    cv2.rectangle(body_mask, (3, int(h * 0.04)), (w - 3, tip_cy), 255, thickness=-1)
    cv2.circle(body_mask, (w // 2, tip_cy), max(3, w // 4), 255, thickness=-1)
    body_mask = cv2.GaussianBlur(body_mask, (7, 7), 0)

    hand = rgba[:, :, :3]
    mask = np.maximum(rgba[:, :, 3], body_mask).astype(np.float32) / 255.0
    hand[mask <= 0] = 0
    return hand, mask


class TipOverlay:
    """펜끝/손을 캔버스에 얹는다. 지정한 펜끝 앵커를 낙점에 맞추고 알파로 합성."""

    def __init__(
        self,
        hand: np.ndarray,
        mask: np.ndarray,
        tip_anchor_x: float = 0.0,
        tip_anchor_y: float = 0.0,
    ) -> None:
        self.hand = hand
        self.mask = mask
        self.h, self.w = hand.shape[:2]
        self.mask_inv = 1.0 - mask
        # 손 이미지 안 펜끝의 픽셀 좌표 (낙점을 여기에 맞춘다)
        # Map normalized anchors exactly onto the source image's pixel range.
        self.tip_px = int(round((self.w - 1) * np.clip(tip_anchor_x, 0.0, 1.0)))
        self.tip_py = int(round((self.h - 1) * np.clip(tip_anchor_y, 0.0, 1.0)))

    def stamp(self, canvas: np.ndarray, x: int, y: int) -> np.ndarray:
        """손 이미지의 펜끝 앵커를 캔버스 좌표 (x, y) (= 낙점) 에 맞춘다."""
        # 이미지 왼쪽 위 = 낙점 - 펜끝 오프셋
        anchor_x = x - self.tip_px
        anchor_y = y - self.tip_py
        h_canvas, w_canvas = canvas.shape[:2]

        x0 = max(0, anchor_x)
        y0 = max(0, anchor_y)
        x1 = min(w_canvas, anchor_x + self.w)
        y1 = min(h_canvas, anchor_y + self.h)
        if x1 <= x0 or y1 <= y0:
            return canvas

        sx0 = x0 - anchor_x
        sy0 = y0 - anchor_y
        sx1 = sx0 + (x1 - x0)
        sy1 = sy0 + (y1 - y0)

        region = canvas[y0:y1, x0:x1]
        hand_region = self.hand[sy0:sy1, sx0:sx1]
        mask_region = self.mask[sy0:sy1, sx0:sx1]
        inv_region = self.mask_inv[sy0:sy1, sx0:sx1]

        for c in range(3):
            region[:, :, c] = (
                region[:, :, c] * inv_region + hand_region[:, :, c] * mask_region
            )
        canvas[y0:y1, x0:x1] = region
        return canvas


# ──────────────────────────────────────────────────────────────
# 먹붓
# ──────────────────────────────────────────────────────────────
def _feathered_disk(radius: int) -> np.ndarray:
    """반지름 r, 가장자리를 가우시안으로 부드럽게 한 원형 마스크. 값 범위 0..1."""
    y, x = np.ogrid[-radius:radius + 1, -radius:radius + 1]
    dist = np.sqrt(x * x + y * y).astype(np.float32)
    return np.clip(1.0 - (dist - radius * 0.75) / (radius * 0.25), 0.0, 1.0)


# ──────────────────────────────────────────────────────────────
# contour-wipe 채색 도구
# ──────────────────────────────────────────────────────────────
def _ease_in_out_sine(t: float | np.ndarray) -> float | np.ndarray:
    """사인 이징: 시작·끝은 느리고 중간이 빠르다. 스칼라나 배열을 받아 같은 모양으로 반환."""
    return -(np.cos(np.pi * t) - 1.0) / 2.0


def _build_wipe_wave(width: int) -> np.ndarray:
    """
    두 주파수의 사인파 경계를 미리 계산해, 드러나는 전선이 직선이 아니라 물결지게 한다.
    (W,) float32 배열을 반환한다. 값 범위는 대략 [-1.35, 1.35].
    """
    wave_px1 = max(24.0, width / 20.0)
    wave_px2 = max(8.0, width / 72.0)
    xs = np.arange(width, dtype=np.float32)
    return np.sin(xs / wave_px1) + 0.35 * np.sin(xs / wave_px2 + 1.7)


# ──────────────────────────────────────────────────────────────
# 골격 단위 획 추적 (whiteboard-video-engine preprocess.py 에서 이식)
# Zhang-Suen 세선화 -> 8이웃 최직선 추적 -> 픽셀 단위 순서 있는 획
# ──────────────────────────────────────────────────────────────
_SKEL_NEIGHBORS_8 = [
    (-1, -1), (0, -1), (1, -1),
    (-1, 0),           (1, 0),
    (-1, 1),  (0, 1),  (1, 1),
]


def _zhang_suen_skeleton(mask: np.ndarray, max_iterations: int = 160) -> np.ndarray:
    """
    Zhang-Suen 2단 반복 세선화로 이진 전경 마스크를 1픽셀 폭 골격으로 만든다.
    입력: bool/uint8 2차원 배열 (True/1 = 전경 펜선).
    출력: bool 골격 맵. 같은 모양.
    """
    img = np.pad(mask.astype(np.uint8), 1, mode="constant")
    for _ in range(max_iterations):
        changed = False
        for step in (0, 1):
            p2, p3, p4 = img[:-2, 1:-1], img[:-2, 2:], img[1:-1, 2:]
            p5, p6, p7 = img[2:, 2:], img[2:, 1:-1], img[2:, :-2]
            p8, p9 = img[1:-1, :-2], img[:-2, :-2]
            center = img[1:-1, 1:-1]
            neighbors = [p2, p3, p4, p5, p6, p7, p8, p9]
            # 0->1 전이 횟수 (시계 방향으로 돌며)
            transitions = sum(
                (neighbors[i] == 0) & (neighbors[(i + 1) % 8] == 1) for i in range(8)
            )
            count = sum(neighbors)
            if step == 0:
                marker = (
                    (center == 1) & (count >= 2) & (count <= 6)
                    & (transitions == 1)
                    & ((p2 * p4 * p6) == 0) & ((p4 * p6 * p8) == 0)
                )
            else:
                marker = (
                    (center == 1) & (count >= 2) & (count <= 6)
                    & (transitions == 1)
                    & ((p2 * p4 * p8) == 0) & ((p2 * p6 * p8) == 0)
                )
            if np.any(marker):
                center[marker] = 0
                changed = True
        if not changed:
            break
    return img[1:-1, 1:-1].astype(bool)


def _skel_neighbors(skel: np.ndarray, point: tuple[int, int]) -> list[tuple[int, int]]:
    """
    골격점 point 의 유효한 8이웃을 반환한다.
    핵심: 대각 이웃과 현재 점 사이에 직교 다리가 이미 있으면 그 대각 이웃은 건너뛴다.
    T자·십자 교차에서 삼각형 조각 획이 생기는 걸 막으면서, 진짜 대각 중심선은 남긴다.
    """
    x, y = point
    h, w = skel.shape
    result: list[tuple[int, int]] = []
    for dx, dy in _SKEL_NEIGHBORS_8:
        nx, ny = x + dx, y + dy
        if not (0 <= nx < w and 0 <= ny < h and skel[ny, nx]):
            continue
        if dx != 0 and dy != 0 and (skel[y, nx] or skel[ny, x]):
            continue  # 직교 다리로 이미 연결됨. 중복 대각은 건너뛴다
        result.append((nx, ny))
    return result


def _edge_key(a: tuple[int, int], b: tuple[int, int]) -> tuple[tuple[int, int], tuple[int, int]]:
    """무방향 간선 정규화: (A,B) 와 (B,A) 를 같은 key 로 만든다."""
    return (a, b) if a <= b else (b, a)


def _choose_next(
    prev: tuple[int, int],
    cur: tuple[int, int],
    candidates: list[tuple[int, int]],
    visited_edges: set,
) -> tuple[int, int] | None:
    """
    교차점에서는 '가장 곧은 미방문 간선'을 골라 계속 간다.
    현재 진행 방향과 후보 방향의 코사인 유사도로 '곧음'을 재고 최대값을 고른다.
    """
    fresh = [p for p in candidates if _edge_key(cur, p) not in visited_edges and p != prev]
    if not fresh:
        return None
    vx, vy = cur[0] - prev[0], cur[1] - prev[1]
    vlen = math.hypot(vx, vy)
    return max(
        fresh,
        key=lambda p: (
            (vx * (p[0] - cur[0]) + vy * (p[1] - cur[1]))
            / (vlen * math.hypot(p[0] - cur[0], p[1] - cur[1]) or 1.0)
        ),
    )


def trace_8connected(skel: np.ndarray, min_points: int = 8) -> list[list[tuple[int, int]]]:
    """
    1픽셀 골격을 순서 있는 획 목록으로 추적한다.

    - 시작점 우선순위: 차수 1 인 끝점 -> 차수 2 초과인 교차점 -> 나머지
    - 교차점에서는 가장 곧은 미방문 간선으로 계속 간다 (가지마다 짧게 끊지 않는다)
    - 방문 표시는 무방향 간선 집합으로 한다 (픽셀은 재사용 가능, 간선은 재통과 불가)
    - 막다른 곳(새 간선 없음)에서 멈추고, 남은 가지는 다음 시작점이 맡는다
    - 길이가 min_points 미만인 조각은 버린다

    list[list[(x,y)]] 를 반환한다. 각각은 획 방향을 따르는 순서 있는 픽셀 좌표.
    """
    ys, xs = np.nonzero(skel)
    points = [(int(x), int(y)) for x, y in zip(xs, ys)]
    if not points:
        return []
    degrees = {p: len(_skel_neighbors(skel, p)) for p in points}
    starts = (
        [p for p in points if degrees[p] == 1]
        + [p for p in points if degrees[p] > 2]
        + points
    )
    visited_edges: set = set()
    strokes: list[list[tuple[int, int]]] = []
    for start in starts:
        for nb in _skel_neighbors(skel, start):
            edge = _edge_key(start, nb)
            if edge in visited_edges:
                continue
            path = [start]
            prev, cur = start, nb
            visited_edges.add(edge)
            while True:
                path.append(cur)
                next_pt = _choose_next(prev, cur, _skel_neighbors(skel, cur), visited_edges)
                if next_pt is None:
                    break
                visited_edges.add(_edge_key(cur, next_pt))
                prev, cur = cur, next_pt
            if len(path) >= min_points:
                strokes.append(path)
    return strokes


# -- 골격 획 후처리 (재샘플링 + 평활 + 정렬) --
def _stroke_cumulative_length(points: list[tuple[float, float]]) -> list[float]:
    """점마다의 누적 호 길이 [0, d01, d012, ...]."""
    cum = [0.0]
    for a, b in zip(points, points[1:]):
        cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    return cum


def _resample_stroke_points(
    points: list[tuple[float, float]], spacing: float
) -> list[tuple[float, float]]:
    """호 길이를 따라 spacing 간격으로 다시 샘플링해 픽셀 계단을 없앤다."""
    if len(points) < 2:
        return list(points)
    cum = _stroke_cumulative_length(points)
    total = cum[-1]
    if total < spacing:
        return [points[0], points[-1]]
    n = max(2, int(round(total / spacing)))
    result: list[tuple[float, float]] = []
    for i in range(n + 1):
        target = total * i / n
        # 이분 탐색으로 위치 찾기
        lo, hi = 0, len(cum) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if cum[mid] < target:
                lo = mid + 1
            else:
                hi = mid
        if lo == 0:
            result.append(points[0])
            continue
        seg_start = cum[lo - 1]
        seg_len = cum[lo] - seg_start
        t = (target - seg_start) / seg_len if seg_len > 0 else 0.0
        ax, ay = points[lo - 1]
        bx, by = points[lo]
        result.append((ax + (bx - ax) * t, ay + (by - ay) * t))
    return result


def _chaikin_smooth(
    points: list[tuple[float, float]], iterations: int = 1
) -> list[tuple[float, float]]:
    """Chaikin 모서리 깎기 평활: 각 구간을 0.25/0.75 두 점으로 바꾸고 시작·끝점은 남긴다."""
    pts = list(points)
    for _ in range(iterations):
        if len(pts) < 3:
            break
        smoothed = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            smoothed.append((a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25))
            smoothed.append((a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75))
        smoothed.append(pts[-1])
        pts = smoothed
    return pts


def _order_skeleton_strokes(strokes: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    """
    획 정렬: 위에서 아래로, 왼쪽에서 오른쪽으로. 긴 획이 먼저.
    order_strokes 의 간이판 - 바운딩박스 왼쪽 위 + 음수 길이로 사전식 정렬.
    """
    def sort_key(s):
        if not s:
            return (0, 0, 0, 0)
        xs = [p[0] for p in s]
        ys = [p[1] for p in s]
        length = _stroke_cumulative_length(s)[-1]
        return (min(ys) // 12, min(xs), min(ys), -length)
    return sorted(strokes, key=sort_key)


# ──────────────────────────────────────────────────────────────
# 길이 / 단계 나누기
# ──────────────────────────────────────────────────────────────
@dataclass
class PhasePlan:
    ink_frames: int
    color_frames: int
    gaze_frames: int
    ratio_label: str


def plan_phases(total_ms: int, cfg: Config) -> PhasePlan:
    """
    총 길이를 선 긋기 / 채색 / 바라보기 세 단계로 나눈다.
    바라보기 단계에 기준 초를 먼저 떼어두고, 남은 길이를 비중대로 선 긋기와 채색에 나눈다.
    나머지가 비중 합으로 딱 안 나뉘면 그 나머지는 바라보기 단계에 준다 (오차 손실 방지).
    """
    weight_sum = cfg.ink_weight + cfg.color_weight
    gaze_ms = int(cfg.gaze_seconds * 1000)
    anim_ms = total_ms - gaze_ms
    remainder = anim_ms % weight_sum
    if remainder:
        anim_ms -= remainder
        gaze_ms += remainder

    ink_frames = round(anim_ms * cfg.ink_weight / weight_sum * cfg.fps / 1000)
    color_frames = round(anim_ms * cfg.color_weight / weight_sum * cfg.fps / 1000)
    gaze_frames = round(gaze_ms * cfg.fps / 1000)
    if ink_frames <= 0 and color_frames <= 0:
        ink_frames = color_frames = 0
    return PhasePlan(ink_frames, color_frames, gaze_frames, f"{cfg.ink_weight}:{cfg.color_weight}")


# ──────────────────────────────────────────────────────────────
# 렌더러 본체
# ──────────────────────────────────────────────────────────────
class StreamBoardRenderer:
    """한 번의 렌더에 필요한 모든 상태를 들고 있다. 메서드는 인스턴스에 붙는다."""

    def __init__(
        self,
        image_bgr: np.ndarray,
        cfg: Config,
        hand_png: Path | None,
        bare_tip: bool,
    ) -> None:
        self.cfg = cfg
        self.canvas_bgr = _hex_to_bgr(cfg.canvas_hex)

        # 출력 크기 계산: 긴 변을 cap 으로 제한하고 grid_edge 의 짝수 배로 맞춘다 (인코딩이 짝수를 요구)
        h0, w0 = image_bgr.shape[:2]
        scale = cfg.cap_long_edge / max(h0, w0)
        w = int(round(w0 * scale))
        h = int(round(h0 * scale))
        align = cfg.grid_edge if cfg.grid_edge % 2 == 0 else cfg.grid_edge * 2
        w = (w // align) * align
        h = (h // align) * align
        self.out_w = max(align, w)
        self.out_h = max(align, h)

        self.color_img = cv2.resize(image_bgr, (self.out_w, self.out_h), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(self.color_img, cv2.COLOR_BGR2GRAY)
        self.thresh_map = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 10
        )
        self.active = _active_mask(self.thresh_map, cfg.grid_edge, cfg.ink_threshold)
        self.grid_blocks = _to_grid_blocks(self.thresh_map, cfg.grid_edge)
        self.ink_pixels = self.thresh_map < cfg.ink_threshold
        self.ink_paint = np.repeat(self.thresh_map[:, :, None], 3, axis=2).astype(np.float32)

        # 원본 배경을 캔버스 바탕색으로 물들인다 (color_img 만 영향. ink_pixels / ink_paint 는 안 건드림).
        # 그래야 채색·바라보기 단계 배경이 선 긋기 단계와 같아 배경색이 갑자기 튀지 않는다.
        # ink_pixels 계산 뒤에 두므로 선화 품질에는 전혀 영향이 없다.
        if cfg.match_bg:
            self._match_original_background()

        # 칸 공간 묶기 (grid 모드의 펜선 경로 + contour-wipe 저항장에 여전히 필요)
        self.ink_streams = cluster_ink_streams(self.active)

        # 펜선 경로: ink_path_mode 에 따라 grid(칸 중심 보간) 또는 skeleton(골격 추적) 선택
        if cfg.ink_path_mode == "skeleton":
            self.skeleton_strokes = self._build_skeleton_path()
            if self.skeleton_strokes:
                self.stroke_path = [pt for stroke in self.skeleton_strokes for pt in stroke]
            else:
                # 골격 추적에 획이 없으면 칸 중심 경로로 실제로 되돌린다 (빈 path 를 남기지 않는다)
                self.stroke_path = flatten_streams(self.ink_streams)
        else:
            self.skeleton_strokes = []
            self.stroke_path = flatten_streams(self.ink_streams)

        # 캔버스 (실수 버퍼라 먹붓 누적 합성이 쉽다)
        self.drawn = np.zeros((self.out_h, self.out_w, 3), dtype=np.float32)
        self.drawn[...] = self.canvas_bgr.astype(np.float32)

        # 펜끝 오버레이
        self.tip: TipOverlay | None = None
        if not bare_tip:
            hand_data = _load_hand(hand_png, cfg.target_hand_height) if hand_png else None
            tip_anchor_x = cfg.tip_anchor_x
            tip_anchor_y = cfg.tip_anchor_y
            if hand_data is None:
                hand_data = _procedural_tip(cfg.target_hand_height)
                tip_anchor_x = 0.5
                tip_anchor_y = 0.70
            self.tip = TipOverlay(
                hand_data[0], hand_data[1],
                tip_anchor_x=tip_anchor_x,
                tip_anchor_y=tip_anchor_y,
            )

    # -- 원본 배경을 캔버스 바탕색으로 물들인다 (color_img 만. 선화 먹선은 안 건드림) --
    def _match_original_background(self) -> None:
        """
        원본 네 귀퉁이를 배경색 기준으로 삼아, 차이가 임계 미만인 픽셀을 canvas_hex 로 바꾼다.
        채색·바라보기 단계 배경을 선 긋기 단계와 맞춰 배경색이 갑자기 튀지 않게 한다.
        유채색 내용(배경과 차이가 큰 부분)은 원래 색 그대로 남는다.
        """
        img = self.color_img
        h, w = img.shape[:2]
        margin = max(3, min(h, w) // 50)
        samples = [
            img[:margin, :margin], img[:margin, -margin:],
            img[-margin:, :margin], img[-margin:, -margin:],
        ]
        bg_color = np.median(np.concatenate([s.reshape(-1, 3) for s in samples]), axis=0)
        diff = np.abs(img.astype(np.int16) - bg_color.astype(np.int16)).sum(axis=2)
        bg_mask = diff < self.cfg.match_bg_threshold
        img[bg_mask] = self.canvas_bgr

    # -- 펜선 중심점 (픽셀 좌표) --
    def _cell_center(self, cell: tuple[int, int]) -> tuple[int, int]:
        r, c = cell
        e = self.cfg.grid_edge
        return (c * e + e // 2, r * e + e // 2)  # (x, y)

    # -- 골격 단위 펜선 경로 (Zhang-Suen 세선화 + 8이웃 최직선 추적) --
    def _build_skeleton_path(self) -> list[list[tuple[int, int]]]:
        """
        골격 추적으로 픽셀 단위 순서 있는 획을 만들어 칸 중심 보간을 대체한다.
        펜끝이 진짜 골격을 따라가므로 칸 중심보다 원본 선에 더 밀착한다.
        교차점에서는 가장 곧은 간선으로 계속 가서 삼각형 조각 획을 피한다.
        """
        cfg = self.cfg
        skel = _zhang_suen_skeleton(self.ink_pixels, max_iterations=160)
        raw_strokes = trace_8connected(skel, min_points=cfg.skeleton_min_points)
        if not raw_strokes:
            print("  [warn] 골격 추적에 획이 없어 격자 경로로 되돌립니다")
            return []

        spacing = cfg.skeleton_resample_spacing
        processed: list[list[tuple[int, int]]] = []
        for stroke in raw_strokes:
            pts = [(float(x), float(y)) for x, y in stroke]
            pts = _resample_stroke_points(pts, spacing)
            pts = _chaikin_smooth(pts, iterations=1)
            pts = _resample_stroke_points(pts, spacing)
            if len(pts) >= 2 and _stroke_cumulative_length(pts)[-1] > 2.0:
                processed.append([(int(round(x)), int(round(y))) for x, y in pts])

        processed = _order_skeleton_strokes(processed)
        total_pts = sum(len(s) for s in processed)
        print(f"  골격 추적: {len(processed)} 개 획, {total_pts} 개 샘플점")
        return processed

    # -- contour-wipe 저항장 (지연 생성. 채색 단계 내내 재사용) --
    def _build_resistance_field(self) -> np.ndarray:
        """
        선화 먹선으로 '저항장'을 만든다. 윤곽에서 저항이 약 1이고, 아래로 갈수록 decay 로 지수 감쇠한다.
        드러나는 전선이 높은 저항을 만나면 픽셀만큼 깎여 '윤곽에 먼저 걸렸다가 천천히 넘어간다'.

        저항장은 내내 고정이고 채색 진행과 무관하므로 한 번만 계산해 self._resistance 에 캐시한다.
        """
        if getattr(self, "_resistance", None) is not None:
            return self._resistance

        h, w = self.out_h, self.out_w
        cfg = self.cfg

        # 1) 먹선 이진 맵 (uint8 0/255)
        ink_u8 = (self.ink_pixels.astype(np.uint8)) * 255

        # 2) 팽창: 원형 구조요소로 윤곽을 굵혀 막는 띠를 만든다
        spread = int(np.clip(min(w, h) // 64, 3, 17))
        if spread % 2 == 0:  # 구조요소 반지름은 양의 홀수여야 한다
            spread = max(3, spread - 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (spread, spread))
        dilated = cv2.dilate(ink_u8, kernel, iterations=1)

        # 3) 가우시안 블러: 딱딱한 경계를 그라데이션 띠로 (반지름은 양의 홀수)
        blur_r = max(1, int(round(min(w, h) / 220.0)))
        if blur_r % 2 == 0:
            blur_r += 1
        resistance = cv2.GaussianBlur(dilated, (blur_r, blur_r), 0).astype(np.float32)

        # 4) [0,1] 로 정규화
        peak = float(resistance.max())
        if peak > 1e-6:
            resistance /= peak
        else:
            # 먹선이 없으면(전부 흰 그림) 저항장이 0이라 contour-wipe 가 직선 스캔이 된다
            resistance = np.zeros((h, w), dtype=np.float32)

        # 5) 행마다 아래로 decay 를 전파: 윤곽마다 아래쪽으로 지수 감쇠 그림자를 드리운다
        decay = cfg.wipe_decay
        for row in range(1, h):
            resistance[row] = np.maximum(resistance[row], resistance[row - 1] * decay)

        self._resistance = resistance
        return resistance

    # -- 낙점에 '먹점'을 찍는다: 선 긋기 단계는 임계 맵, 채색 단계는 원래 색 --
    def _reveal_ink_segment(
        self, start: tuple[int, int], end: tuple[int, int]
    ) -> None:
        """Reveal only the original line-art pixels touched by one pen movement."""
        segment = np.zeros((self.out_h, self.out_w), dtype=np.uint8)
        thickness = max(1, self.cfg.ink_reveal_radius * 2 + 1)
        cv2.line(segment, start, end, 255, thickness=thickness, lineType=cv2.LINE_AA)
        revealed = (segment > 0) & self.ink_pixels
        self.drawn[revealed] = self.ink_paint[revealed]

    def _ink_stamp(self, cell: tuple[int, int]) -> None:
        r, c = cell
        e = self.cfg.grid_edge
        block = self.grid_blocks[r, c]
        ink_region = block < self.cfg.ink_threshold
        # 임계 맵은 1채널이라 3채널 캔버스로 복제한다
        paint = np.repeat(block[:, :, None], 3, axis=2)
        target = self.drawn[r * e:r * e + e, c * e:c * e + e]
        target[ink_region] = paint[ink_region]

    def _color_stamp(self, px: int, py: int, disk: np.ndarray) -> None:
        radius = self.cfg.brush_radius
        h, w = self.out_h, self.out_w
        y0, y1 = max(0, py - radius), min(h, py + radius + 1)
        x0, x1 = max(0, px - radius), min(w, px + radius + 1)
        if y1 <= y0 or x1 <= x0:
            return
        by0, by1 = y0 - (py - radius), disk.shape[0] - ((py + radius + 1) - y1)
        bx0, bx1 = x0 - (px - radius), disk.shape[1] - ((px + radius + 1) - x1)
        m = disk[by0:by1, bx0:bx1]
        inv = 1.0 - m
        target = self.drawn[y0:y1, x0:x1]
        source = self.color_img[y0:y1, x0:x1].astype(np.float32)
        for ch in range(3):
            target[:, :, ch] = target[:, :, ch] * inv + source[:, :, ch] * m

    # -- 현재 캔버스 스냅샷(펜끝 포함)을 여러 프레임으로 쓴다 --
    def _snapshot_with_tip(self, px: int, py: int) -> np.ndarray:
        snap = self.drawn.astype(np.uint8)  # astype 이 새 배열을 주므로 copy 가 필요 없다
        if self.tip is not None:
            self.tip.stamp(snap, px, py)
        return snap

    def _build_stroke_samples(
        self, path: list[tuple[int, int]]
    ) -> tuple[list[tuple[int, int]], set[int], list[int]]:
        """
        펜선 꺾은선을 보간해 이어진 펜끝 픽셀 좌표 목록으로 만든다.
        이웃한 칸 중심 사이를 sample_step 픽셀 간격으로 고르게 샘플링해 매끄러운 궤적을 만든다.

        반환 (samples, pen_lifts, sample_cell_index):
          samples         - 펜끝 픽셀 좌표 목록
          pen_lifts       - '펜 들기' 샘플점 인덱스 집합 (이웃하지 않은 칸으로 건너뛰는 지점)
          sample_cell_index - 샘플점마다 속한 cell 의 path 내 인덱스.
                              '먹 드러나는 진행'과 '펜끝 위치'를 정확히 맞추는 데 쓴다.
        """
        samples: list[tuple[int, int]] = []
        pen_lifts: set[int] = set()
        sample_cell_index: list[int] = []
        for idx, cell in enumerate(path):
            cx, cy = self._cell_center(cell)
            if idx == 0:
                samples.append((cx, cy))
                sample_cell_index.append(idx)
                continue
            prev_cell = path[idx - 1]
            prev = self._cell_center(prev_cell)
            cell_distance = math.hypot(cell[0] - prev_cell[0], cell[1] - prev_cell[1])
            if cell_distance > math.sqrt(2):
                pen_lifts.add(len(samples))
                samples.append((cx, cy))
                sample_cell_index.append(idx)
                continue
            steps = max(
                1, int(math.hypot(cx - prev[0], cy - prev[1]) / self.cfg.sample_step)
            )
            for s in range(1, steps + 1):
                samples.append(
                    (int(prev[0] + (cx - prev[0]) * s / steps),
                     int(prev[1] + (cy - prev[1]) * s / steps))
                )
                sample_cell_index.append(idx)
        return samples, pen_lifts, sample_cell_index

    def _frame_progress_indices(self, n_steps: int, target_frames: int) -> list[int]:
        """
        펜끝 위치 n_steps 개와 목표 프레임 target_frames 개가 주어지면,
        프레임마다 취할 펜끝 위치 인덱스를 반환한다 (고르게 배분, 궤적 전체를 덮는다).
        target_frames <= n_steps 면 다운샘플링, 크면 반복 샘플링이다.
        target_frames <= 0 이면(총 길이가 바라보기 단계 이하라 이 단계에 프레임이 없을 때) 빈 값을 주고 프레임을 만들지 않는다.
        """
        if n_steps == 0 or target_frames <= 0:
            return []
        if target_frames == 1:
            return [n_steps - 1]
        return [
            round(f * (n_steps - 1) / (target_frames - 1))
            for f in range(target_frames)
        ]

    def _pause_frame_indices(
        self, target_frames: int, n_cells: int
    ) -> set[int]:
        """
        자동 멈춤: 내용 밀도로 구간을 나눠 멈춤 비율을 정하고, 멈춤 프레임을 시간축에 고르게 뿌린다.
        '정지시킬(앞 프레임 진행을 되풀이할)' 프레임 인덱스 집합을 반환한다.

        구간 기준은 '칸당 프레임 수' frames_per_cell = target_frames / n_cells 이다.
        프레임이 칸보다 훨씬 많으면(값이 큼) 길이에 여유가 있다는 뜻 -> 붓 바꾸는 숨을 흉내 내 많이 멈춘다.
        프레임이 칸보다 적으면(값이 작음) 내용이 빽빽하고 시간이 빠듯하다는 뜻 -> 멈추지 않는다.

        pause_mode 로 강제할 수 있다: "off" 없음, "light"/"heavy" 고정, "auto" 자동.
        """
        mode = self.cfg.pause_mode
        if mode == "off" or target_frames < 8 or n_cells <= 0:
            return set()

        if mode == "light":
            ratio = self.cfg.pause_ratio_light
        elif mode == "heavy":
            ratio = self.cfg.pause_ratio_heavy
        else:  # auto: '칸당 프레임 수'로 자동 판정
            fpc = target_frames / n_cells
            if fpc >= self.cfg.pause_heavy_fpc:
                ratio = self.cfg.pause_ratio_heavy
            elif fpc >= self.cfg.pause_light_fpc:
                ratio = self.cfg.pause_ratio_light
            else:
                return set()  # 내용이 빽빽하다: 빠른 리듬, 멈춤 없음

        # 멈춤 프레임 수는 최소 0. target_frames-2 로 잘라 첫·끝 프레임에서는 안 멈추게 한다
        pause_count = min(
            max(0, int(round(target_frames * ratio))),
            max(0, target_frames - 2),
        )
        if pause_count <= 0:
            return set()

        # 등분 삽입: target_frames 를 pause_count+1 등분해 멈춤을 안쪽 분점에 둔다
        # 첫·끝은 쓰지 않아(분자가 1부터) 시작과 끝이 끊기지 않게 한다
        return {
            max(1, min(target_frames - 2,
                       round((idx + 1) * target_frames / (pause_count + 1))))
            for idx in range(pause_count)
        }

    # -- 선 긋기 단계: stroke_path 를 따라 선화를 깔고, 펜끝 이동과 먹 드러내기를 정확히 맞춘다 --
    def lay_down_ink(self, writer: cv2.VideoWriter, target_frames: int) -> None:
        """선 긋기 진입점: ink_path_mode 에 따라 골격 추적 또는 격자 경로로 보낸다."""
        if self.cfg.ink_path_mode == "skeleton" and self.skeleton_strokes:
            return self._lay_down_ink_skeleton(writer, target_frames)
        return self._lay_down_ink_grid(writer, target_frames)

    # -- grid 모드: 격자 중심 보간 경로를 따라 먹을 드러낸다 --
    def _lay_down_ink_grid(self, writer: cv2.VideoWriter, target_frames: int) -> None:
        path = self.stroke_path
        n = len(path)
        if n == 0:
            print("  먹선이 없어 선 긋기를 건너뜁니다")
            for _ in range(target_frames):
                writer.write(self._snapshot_with_tip(self.out_w // 2, self.out_h // 2))
            return

        samples, pen_lifts, sample_cell_index = self._build_stroke_samples(path)
        sample_idx_for_frame = self._frame_progress_indices(len(samples), target_frames)

        # 자동 멈춤: 밀도로 '정지 프레임'을 고른다 (펜끝도 안 움직이고 먹도 안 나아간다).
        # 사람이 쓸 때의 붓 바꾸기·숨 고르기 리듬을 흉내 낸다.
        pause_frames = self._pause_frame_indices(target_frames, n)
        if pause_frames:
            print(f"  자동 멈춤: {len(pause_frames)} 프레임 정지 (모드={self.cfg.pause_mode})")

        written = 0
        cells_revealed = 0  # 통째로 드러난 칸 수 (증분. 펜끝 진행을 정확히 따라간다)
        last_sample_idx: int | None = None
        for fi, si in enumerate(sample_idx_for_frame):
            # 멈춤 프레임: 앞 프레임의 펜끝 위치와 진행을 그대로 쓰고, 먹은 안 드러내고 스냅샷만 한 장 쓴다
            if fi in pause_frames and last_sample_idx is not None:
                sx, sy = samples[last_sample_idx]
                writer.write(self._snapshot_with_tip(sx, sy))
                written += 1
                if (fi + 1) % max(1, target_frames // 10) == 0:
                    print(f"  선 긋기 진행: {int((fi + 1) / target_frames * 100)}%")
                continue

            # 펜끝을 따라 드러낸다 (펜선의 흐르는 느낌 유지)
            if last_sample_idx is None:
                self._reveal_ink_segment(samples[si], samples[si])
            else:
                for sample_idx in range(last_sample_idx + 1, si + 1):
                    if sample_idx in pen_lifts:
                        continue
                    self._reveal_ink_segment(
                        samples[sample_idx - 1], samples[sample_idx]
                    )

            # 통째 드러내기: '지금 펜끝이 있는 cell' 까지만 드러내 펜끝과 그림을 맞추고 글자가 온전하게 한다.
            # sample_cell_index[si] 가 이 프레임 펜끝이 속한 칸 인덱스다. 거기까지 드러낸다.
            target_cell = sample_cell_index[si]
            while cells_revealed <= target_cell and cells_revealed < n:
                self._ink_stamp(path[cells_revealed])
                cells_revealed += 1

            sx, sy = samples[si]
            writer.write(self._snapshot_with_tip(sx, sy))
            written += 1
            last_sample_idx = si
            if (fi + 1) % max(1, target_frames // 10) == 0:
                print(f"  선 긋기 진행: {int((fi + 1) / target_frames * 100)}%")

        # 마무리 보정: 모든 칸의 먹이 다 드러나게 하고 프레임 수를 채운다
        while cells_revealed < n:
            self._ink_stamp(path[cells_revealed])
            cells_revealed += 1
        last = samples[-1]
        while written < target_frames:
            writer.write(self._snapshot_with_tip(*last))
            written += 1
        print(f"  선 긋기 완료: {n}칸, {written}프레임")

    # -- skeleton 모드: 골격 픽셀 경로를 따라 먹을 드러낸다 (펜끝이 진짜 골격을 간다) --
    def _lay_down_ink_skeleton(self, writer: cv2.VideoWriter, target_frames: int) -> None:
        """
        골격 모드 선 긋기: 펜끝이 골격 픽셀을 따라 미끄러지며 _reveal_ink_segment 로 원본 먹을 드러낸다.
        통째 드러내기(_ink_stamp)는 안 한다. 골격이 이미 픽셀 단위라 칸을 온전히 채울 필요가 없다.
        획이 바뀌는 지점은 펜 들기(pen_lifts)로 표시하고 보간을 건너뛴다.
        """
        strokes = self.skeleton_strokes
        if not strokes:
            return self._lay_down_ink_grid(writer, target_frames)

        # 여러 획을 이어진 샘플점 목록으로 펴고, 획이 바뀌는 곳은 펜 들기로 표시
        samples: list[tuple[int, int]] = []
        pen_lifts: set[int] = set()
        for si, stroke in enumerate(strokes):
            if si > 0:
                pen_lifts.add(len(samples))  # 획 사이 펜 들기
            samples.extend(stroke)

        n = len(samples)
        if n == 0:
            print("  골격 획이 없어 선 긋기를 건너뜁니다")
            for _ in range(target_frames):
                writer.write(self._snapshot_with_tip(self.out_w // 2, self.out_h // 2))
            return

        sample_idx_for_frame = self._frame_progress_indices(n, target_frames)

        # 자동 멈춤 (칸 수가 아니라 획 수로 밀도를 판정)
        pause_frames = self._pause_frame_indices(target_frames, len(strokes))
        if pause_frames:
            print(f"  자동 멈춤: {len(pause_frames)} 프레임 정지 (모드={self.cfg.pause_mode})")

        written = 0
        last_sample_idx: int | None = None
        report_step = max(1, target_frames // 10)
        for fi, si in enumerate(sample_idx_for_frame):
            # 멈춤 프레임: 펜끝 정지
            if fi in pause_frames and last_sample_idx is not None:
                sx, sy = samples[last_sample_idx]
                writer.write(self._snapshot_with_tip(sx, sy))
                written += 1
                if (fi + 1) % report_step == 0:
                    print(f"  선 긋기 진행: {int((fi + 1) / target_frames * 100)}%")
                continue

            # 골격을 따라 드러내기: 앞 프레임 샘플점부터 이번 프레임 샘플점까지 구간별로 원본 먹을 드러낸다
            if last_sample_idx is None:
                self._reveal_ink_segment(samples[si], samples[si])
            else:
                for idx in range(last_sample_idx + 1, si + 1):
                    if idx in pen_lifts:
                        continue
                    self._reveal_ink_segment(samples[idx - 1], samples[idx])

            sx, sy = samples[si]
            writer.write(self._snapshot_with_tip(sx, sy))
            written += 1
            last_sample_idx = si
            if (fi + 1) % report_step == 0:
                print(f"  선 긋기 진행: {int((fi + 1) / target_frames * 100)}%")

        # 마무리 보정: 프레임 수를 채운다
        last = samples[-1]
        while written < target_frames:
            writer.write(self._snapshot_with_tip(*last))
            written += 1
        print(f"  선 긋기 완료(골격): {n} 샘플점, {written}프레임")

    # -- 채색 진입점: color_fill 에 따라 해당 방식으로 보낸다 --
    def wash_color(self, writer: cv2.VideoWriter, target_frames: int) -> None:
        if self.cfg.color_fill == "contour-wipe":
            return self.wash_color_contour(writer, target_frames)
        return self.wash_color_brush(writer, target_frames)

    # -- brush: 획 궤적을 따라 원형 먹붓으로 원래 색을 칠한다 --
    def wash_color_brush(self, writer: cv2.VideoWriter, target_frames: int) -> None:
        path = self.stroke_path
        n = len(path)
        disk = _feathered_disk(self.cfg.brush_radius)
        if n == 0:
            print("  먹선이 없어 채색을 건너뜁니다")
            gaze = self.color_img
            for _ in range(target_frames):
                writer.write(gaze)
            return

        centers = [self._cell_center(cell) for cell in path]
        cell_idx_for_frame = self._frame_progress_indices(n, target_frames)

        written = 0
        last_cell_idx: int | None = None
        for fi, ci in enumerate(cell_idx_for_frame):
            # 이 프레임 진행만큼 채색: 앞 프레임 칸부터 지금 칸까지 마저 칠해
            # 다운샘플링으로 건너뛸 수 있는 중간 칸까지 칠해 원래 색이 끊기지 않게 한다.
            if last_cell_idx is None:
                self._color_stamp(*centers[ci], disk)
            else:
                for cell_idx in range(last_cell_idx + 1, ci + 1):
                    self._color_stamp(*centers[cell_idx], disk)

            cx, cy = centers[ci]
            writer.write(self._snapshot_with_tip(cx, cy))
            written += 1
            last_cell_idx = ci
            if (fi + 1) % max(1, target_frames // 10) == 0:
                print(f"  채색 진행: {int((fi + 1) / target_frames * 100)}%")

        # 마무리 보정
        last = centers[-1]
        while written < target_frames:
            writer.write(self._snapshot_with_tip(*last))
            written += 1
        print(f"  채색 완료: {n}칸, {written}프레임")

    # -- contour-wipe: 윤곽을 인식해 위에서 아래로 스캔하며 채색 --
    def wash_color_contour(self, writer: cv2.VideoWriter, target_frames: int) -> None:
        """
        색을 획 궤적을 따라 칠하지 않고, 전체를 위에서 아래로 한 번 쓸며 전선을 내린다.
        전선이 윤곽을 만나면 먼저 걸리고(저항 약 1, delay_px 만큼 깎임), 아래쪽 감쇠 그림자를 따라 천천히 넘어간다.
        그래서 '색이 선을 따라 번지는' 느낌이 난다. 펜끝은 좌우로 왕복하며 손이 칠하는 것처럼 보이게 한다.
        """
        cfg = self.cfg
        h, w = self.out_h, self.out_w

        if target_frames <= 0:
            print("  채색 프레임이 없어 윤곽 스캔을 건너뜁니다")
            return

        # 한 번만 미리 계산: 저항장, 물결 경계, 깎을 픽셀 수, 행 좌표 격자
        resistance = self._build_resistance_field()
        wave = _build_wipe_wave(w)
        delay_px = int(np.clip(h * cfg.wipe_delay_ratio, 12, 52))
        blocks = max(1, cfg.wipe_blocks)
        ys = np.arange(h, dtype=np.float32)[:, None]   # (H,1). 프레임마다 재사용

        # self.drawn 을 '선화를 다 그린' 상태로 되돌린다 (brush 가 lay_down_ink 뒤에 이어지듯 여기도 이어진다)
        # color_img 가 드러낼 목표다
        color_src = self.color_img.astype(np.float32)

        print(f"  contour-wipe: {w}x{h}, delay_px={delay_px}, 왕복 횟수={blocks}")

        written = 0
        # 전선이 -delay_px 에서 h+delay_px 까지 쓸며 전체를 덮는다
        sweep = h + 2 * delay_px
        report_step = max(1, target_frames // 10)

        for fi in range(target_frames):
            # 전체 진행 (사인 이징 적용): 0 -> 1
            if target_frames == 1:
                progress = 1.0
            else:
                progress = fi / (target_frames - 1)
            lead = _ease_in_out_sine(progress) * sweep - delay_px

            # 드러낼 마스크: y <= lead + wave[x] - resistance[y,x]*delay_px
            threshold = lead + wave[None, :] - resistance * delay_px  # (H,W)
            reveal = ys <= threshold                        # (H,W) bool

            # 원래 색을 drawn 버퍼에 드러낸다
            self.drawn[reveal] = color_src[reveal]

            # 펜끝 좌우 이동: blocks 번 왕복. 홀수 번째는 역방향
            lane = (fi / blocks * 2.0) % 1.0               # 한 번 왕복의 정규화 진행 0..1
            lane = _ease_in_out_sine(lane)
            forward = (int(fi // blocks) % 2 == 0)         # 짝수 번째는 정방향, 홀수 번째는 역방향
            cursor_x = int(lane * w) if forward else int((1.0 - lane) * w)
            cursor_x = max(0, min(w - 1, cursor_x))

            # 커서 y = 지금 열에서 이미 드러난 픽셀의 가장 아래 행
            col_revealed = np.where(reveal[:, cursor_x])[0]
            cursor_y = int(col_revealed[-1]) if col_revealed.size > 0 else 0

            writer.write(self._snapshot_with_tip(cursor_x, cursor_y))
            written += 1
            if (fi + 1) % report_step == 0:
                print(f"  채색 진행(윤곽 스캔): {int((fi + 1) / target_frames * 100)}%")

        # 마무리 보정: 그림 전체가 드러나게 한다 (마지막 프레임 진행이 1이면 lead 가 h+delay_px 라 이론상 전부 덮인다)
        full_reveal = np.ones((h, w), dtype=bool)
        self.drawn[full_reveal] = color_src[full_reveal]
        last = self._snapshot_with_tip(w // 2, h - 1)
        while written < target_frames:
            writer.write(last)
            written += 1
        print(f"  contour-wipe 완료: {written}프레임")

    def render_to(self, raw_path: Path, total_ms: int) -> Path:
        cfg = self.cfg
        plan = plan_phases(total_ms, cfg)
        ink_cells = len(self.stroke_path)

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(raw_path), fourcc, cfg.fps, (self.out_w, self.out_h))

        print(f"  먹줄기: {len(self.ink_streams)} 개, 먹선 격자: {ink_cells}")
        print(
f"  길이: {total_ms}ms -> 선 긋기 {plan.ink_frames}f / "
f"채색 {plan.color_frames}f / 바라보기 {plan.gaze_frames}f (비중 {plan.ratio_label})"
        )

        started = time.time()
        self.lay_down_ink(writer, plan.ink_frames)
        self.wash_color(writer, plan.color_frames)
        # 바라보기: 완성된 원본
        gaze_img = self.color_img
        for _ in range(plan.gaze_frames):
            writer.write(gaze_img)
        writer.release()
        print(f"  렌더 시간: {time.time() - started:.1f}s")
        return raw_path


# ──────────────────────────────────────────────────────────────
# 변환 (시스템 ffmpeg 우선, PyAV 차선. 둘 다 없으면 mp4v 유지)
# ──────────────────────────────────────────────────────────────
def transcode_h264(src: Path, dst: Path) -> Path:
    """
    mp4v 원본 영상을 H.264(yuv420p)로 변환해 플레이어 호환성을 높인다.

    우선순위:
      1. 시스템 ffmpeg 프로세스 (인코딩 효율이 가장 좋고 용량이 작다. CRF=20)
      2. PyAV (pip 만으로 설치. 시스템 ffmpeg 불필요. 효율이 조금 떨어져 CRF=28 로 용량을 잡는다)
      3. 둘 다 없으면 mp4v 원본 코덱을 유지하고 경고한다
    """
    # 경로1: 시스템 ffmpeg (권장. 용량이 가장 작다)
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is not None:
        cmd = [
            ffmpeg, "-y", "-loglevel", "error",
            "-i", str(src),
            "-c:v", "libx264",
            "-crf", "20",
            "-pix_fmt", "yuv420p",
            str(dst),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            src.unlink(missing_ok=True)
            print(f"  H.264 변환 완료(ffmpeg): {dst}")
            return dst
        print(f"  [warn] ffmpeg 변환 실패: {res.stderr.strip()}")

    # 경로2: PyAV (차선. pip 만으로 설치)
    try:
        return _transcode_with_pyav(src, dst)
    except ImportError:
        pass
    except Exception as e:
        print(f"  [warn] PyAV 변환 실패: {e}")

    # 경로3: 둘 다 없으면 mp4v 유지
    print(f"  [warn] ffmpeg 과 PyAV 를 못 찾아 mp4v 원본 코덱으로 둡니다: {src}")
    print(f"         둘 중 하나만 깔면 H.264 로 나옵니다: pip install av  또는  시스템 ffmpeg 설치")
    return src


def _transcode_with_pyav(src: Path, dst: Path) -> Path:
    """
    PyAV 로 파이썬 안에서 H.264 변환을 한다. PyAV 가 없으면 ImportError.
    PyAV 내장 libx264 는 시스템 ffmpeg 보다 효율이 낮아(같은 CRF 에서 용량이 몇 배),
    CRF=28 로 용량과 화질을 맞춘다.
    """
    import av
    input_container = av.open(str(src), mode="r")
    in_stream = input_container.streams.video[0]
    width = in_stream.codec_context.width
    height = in_stream.codec_context.height
    fps = in_stream.average_rate

    output_container = av.open(str(dst), mode="w")
    out_stream = output_container.add_stream("h264", rate=fps)
    out_stream.width = width
    out_stream.height = height
    out_stream.pix_fmt = "yuv420p"
    out_stream.options = {"crf": "28", "preset": "medium"}

    for frame in input_container.decode(video=0):
        packet = out_stream.encode(frame)
        if packet:
            output_container.mux(packet)
    # flush
    packet = out_stream.encode(None)
    if packet:
        output_container.mux(packet)

    output_container.close()
    input_container.close()
    src.unlink(missing_ok=True)
    print(f"  H.264 변환 완료(PyAV): {dst}")
    return dst


# ──────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────
def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="이미지 한 장을 연속 펜선 화이트보드 애니메이션 영상으로 렌더"
    )
    p.add_argument("image", help="입력 이미지 경로 (PNG/JPG/JPEG/BMP/TIFF)")
    p.add_argument("--out-dir", default="./out", help="출력 폴더 (기본: ./out)")
    p.add_argument("--total-ms", type=int, default=10000, help="영상 총 길이(밀리초, 기본 10000)")
    p.add_argument("--bare-tip", action="store_true", help="펜끝/손 오버레이 없이")
    p.add_argument(
        "--pen-image", default=str(DEFAULT_HAND_PNG),
        help="펜끝/손 이미지 경로 (기본: 내장 drawing-hand.png)",
    )
    p.add_argument("--fps", type=int, default=None, help="기본 프레임레이트 덮어쓰기")
    p.add_argument("--grid-edge", type=int, default=None, help="기본 격자 한 변 덮어쓰기")
    p.add_argument("--brush-radius", type=int, default=None, help="기본 먹붓 반지름 덮어쓰기")
    p.add_argument(
        "--color-fill", default="contour-wipe", choices=["brush", "contour-wipe"],
        help="채색 방식: contour-wipe 윤곽을 인식해 위에서 아래로 스캔(기본); brush 획 궤적 따라 칠하기",
    )
    p.add_argument(
        "--wipe-decay", type=float, default=None,
        help="contour-wipe: 저항장 행별 감쇠 계수 (기본 0.86, 작을수록 윤곽을 빨리 넘음)",
    )
    p.add_argument(
        "--wipe-delay-ratio", type=float, default=None,
        help="contour-wipe: 윤곽에서 전선이 깎이는 비율×h (기본 0.04, 클수록 윤곽에 오래 머묾)",
    )
    p.add_argument(
        "--wipe-blocks", type=int, default=None,
        help="contour-wipe: 펜끝이 좌우로 왕복하는 횟수 (기본 18)",
    )
    p.add_argument(
        "--pause", default="heavy", choices=["auto", "off", "light", "heavy"],
        help="선 긋기 멈춤 리듬: heavy 뚜렷함(기본); auto 밀도별 자동; off 없음; light 적게",
    )
    p.add_argument(
        "--ink-path", default="grid", choices=["grid", "skeleton"],
        help="선 긋기 경로: grid 격자 중심 보간(기본); skeleton 골격 단위 픽셀 추적(선에 더 밀착)",
    )
    return p.parse_args(argv)


def _build_cfg(args: argparse.Namespace) -> Config:
    kw: dict = {}
    if args.fps is not None:
        kw["fps"] = args.fps
    if args.grid_edge is not None:
        kw["grid_edge"] = args.grid_edge
    if args.brush_radius is not None:
        kw["brush_radius"] = args.brush_radius
    if args.color_fill is not None:
        kw["color_fill"] = args.color_fill
    if args.wipe_decay is not None:
        kw["wipe_decay"] = args.wipe_decay
    if args.wipe_delay_ratio is not None:
        kw["wipe_delay_ratio"] = args.wipe_delay_ratio
    if args.wipe_blocks is not None:
        kw["wipe_blocks"] = args.wipe_blocks
    if args.pause is not None:
        kw["pause_mode"] = args.pause
    if args.ink_path is not None:
        kw["ink_path_mode"] = args.ink_path
    return Config(**kw)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    cfg = _build_cfg(args)

    print("=" * 56)
    print("연속 펜선 애니메이션 렌더러")
    print("=" * 56)

    image_bgr = _imread_any(args.image)
    if image_bgr is None:
        print(f"[err] 이미지를 읽을 수 없습니다: {args.image}")
        return 1

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    raw_path = out_dir / f"stream_{ts}.mp4"
    h264_path = out_dir / f"stream_{ts}_h264.mp4"

    pen_png = Path(args.pen_image) if args.pen_image else None
    renderer = StreamBoardRenderer(image_bgr, cfg, pen_png, args.bare_tip)
    print(f"  입력: {args.image}")
    print(f"  출력 크기: {renderer.out_w}x{renderer.out_h}, 프레임레이트: {cfg.fps}")

    renderer.render_to(raw_path, args.total_ms)
    final = transcode_h264(raw_path, h264_path)

    size_mb = final.stat().st_size / (1024 * 1024)
    print(f"\n최종 영상: {final}")
    print(f"  파일 크기: {size_mb:.2f} MB")
    print("=" * 56)
    print("완료")
    # 마지막 줄에 최종 경로를 찍어 호출하는 쪽이 받아 쓰게 한다
    print(f"OUTPUT={final}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
