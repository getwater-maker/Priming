"""draft_regions.py — 선화 PNG 에서 **영역 초안**을 뽑는다. (Priming 소유 · 상류 동기화 대상 아님)

먹선 덩어리를 OpenCV 연결요소로 찾아 읽는 순서(위→아래, 왼→오른)로 정렬한 뒤,
요청한 개수 k 로 묶어 각 묶음의 경계 상자를 낸다.

⚠ 이건 **초안**이다. "이 자막 문장이 그림의 어느 덩어리인가"는 그림을 보고 자막을 읽어야 나오는
   의미 판단이라 자동화되지 않는다. 최종 순서·경계는 사람이 `assets/preview.html` 에서 고친다.

⚠ 영역 안에 먹선이 없으면 렌더가 그릴 게 없다(원본에서는 죽던 자리다). 그래서 **먹이 있는 자리만**
   묶는다 — 빈 여백을 영역으로 내지 않는다.

출력: stdout 마지막 줄에 `REGIONS=<json>` — 성공 계약. 실패는 `[err] ` 접두.
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np

MIN_AREA_RATIO = 0.00015   # 이보다 작은 덩어리는 잡티로 본다 (전체 픽셀 대비)
DILATE_RATIO = 0.012       # 가까운 획을 한 덩어리로 붙이는 정도 (긴 변 대비)
PAD_RATIO = 0.012          # 경계 상자 여유 (긴 변 대비)


def _ink_mask(bgr: np.ndarray) -> np.ndarray:
    """먹(어두운 선) 마스크. 종이색이 미색이라 단순 이진화로 충분하다."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    # Otsu 로 자동 임계 — 종이색·선색이 워크플로마다 조금씩 달라도 따라간다
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    return mask


def _components(mask: np.ndarray, w: int, h: int):
    """가까운 획을 붙인 뒤 연결요소를 뽑는다 → [(x, y, w, h, area, cx, cy)]"""
    k = max(3, int(max(w, h) * DILATE_RATIO) | 1)          # 홀수 커널
    glued = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)), iterations=1)
    n, _, stats, cents = cv2.connectedComponentsWithStats(glued, connectivity=8)
    min_area = max(1.0, w * h * MIN_AREA_RATIO)
    out = []
    for i in range(1, n):                                   # 0 은 배경
        x, y, cw, ch, area = stats[i]
        if area < min_area:
            continue
        # 붙이기 전 실제 먹 픽셀 수 — 팽창으로 부풀린 값이 아니라 진짜 그릴 양
        ink = int(np.count_nonzero(mask[y:y + ch, x:x + cw]))
        if ink <= 0:
            continue
        out.append((int(x), int(y), int(cw), int(ch), ink, float(cents[i][0]), float(cents[i][1])))
    return out


def _reading_order(comps, h: int):
    """읽는 순서 — 세로로 띠를 나눠 위에서 아래로, 같은 띠 안에서는 왼쪽에서 오른쪽."""
    band = max(1.0, h * 0.18)
    return sorted(comps, key=lambda c: (int(c[6] // band), c[5]))


def _group(comps, k: int):
    """읽는 순서를 지키며 먹의 양이 **고르게** k 묶음으로.

    ⚠ 단순 그리디(목표를 넘으면 끊기)는 큰 덩어리 하나가 묶음을 통째로 차지해
       나머지가 부스러기가 된다(실측: 75993 / 2760 / 1357). 그래서 **최대 묶음을 최소화**하는
       고전적 선형 분할을 쓴다 — 순서를 지키면서 균형이 잡히고 결정론적이다.
       (이 저장소의 자막 줄바꿈이 쓰는 균형 DP 와 같은 발상.)
    """
    n = len(comps)
    if k >= n:
        return [[c] for c in comps]
    inks = [c[4] for c in comps]

    def fits(cap: float) -> bool:
        used, cur = 1, 0
        for v in inks:
            if cur + v > cap and cur > 0:
                used += 1
                cur = 0
                if used > k:
                    return False
            cur += v
        return used <= k

    lo, hi = max(inks), sum(inks)          # 상한을 한 덩어리보다 작게 잡을 수는 없다
    while lo < hi:
        mid = (lo + hi) // 2
        if fits(mid):
            hi = mid
        else:
            lo = mid + 1

    groups, cur = [], []
    cur_ink = 0
    for c in comps:
        if cur and cur_ink + c[4] > lo:
            groups.append(cur)
            cur, cur_ink = [], 0
        cur.append(c)
        cur_ink += c[4]
    if cur:
        groups.append(cur)
    return groups


def _box(group, w: int, h: int):
    x0 = min(c[0] for c in group)
    y0 = min(c[1] for c in group)
    x1 = max(c[0] + c[2] for c in group)
    y1 = max(c[1] + c[3] for c in group)
    pad = int(max(w, h) * PAD_RATIO)
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
    x1 = min(w, x1 + pad); y1 = min(h, y1 + pad)
    return {"x": x0, "y": y0, "width": max(1, x1 - x0), "height": max(1, y1 - y0)}


def _direction(box):
    """넓으면 가로로, 높으면 세로로 그린다 — 펜이 자연스럽게 지나간다."""
    return "left_to_right" if box["width"] >= box["height"] else "top_to_bottom"


def _ink_of(mask, box) -> int:
    return int(np.count_nonzero(mask[box["y"]:box["y"] + box["height"], box["x"]:box["x"] + box["width"]]))


def _split_box(mask, box):
    """상자 하나를 **먹의 중앙**에서 둘로. 기하학적 절반이 아니라 먹 분포로 자르는 이유는
    한쪽이 텅 비면 그 영역에서 렌더가 그릴 게 없기 때문이다."""
    sub = mask[box["y"]:box["y"] + box["height"], box["x"]:box["x"] + box["width"]]
    horizontal = box["width"] >= box["height"]
    proj = (sub > 0).sum(axis=0 if horizontal else 1).astype(np.int64)
    total = int(proj.sum())
    if total <= 0:
        return None
    cum = np.cumsum(proj)
    cut = int(np.searchsorted(cum, total / 2.0))
    span = box["width"] if horizontal else box["height"]
    cut = max(1, min(span - 1, cut))
    if horizontal:
        a = {"x": box["x"], "y": box["y"], "width": cut, "height": box["height"]}
        b = {"x": box["x"] + cut, "y": box["y"], "width": span - cut, "height": box["height"]}
    else:
        a = {"x": box["x"], "y": box["y"], "width": box["width"], "height": cut}
        b = {"x": box["x"], "y": box["y"] + cut, "width": box["width"], "height": span - cut}
    if _ink_of(mask, a) <= 0 or _ink_of(mask, b) <= 0:
        return None                      # 한쪽이 비면 쪼개지 않는다
    return a, b


def _ensure_count(mask, boxes, k: int):
    """연결요소가 k 개보다 적으면 — 큰 덩어리 하나가 그림을 지배하는 경우다(실측: 가운데 구조가
    통째로 한 덩어리). 먹이 가장 많은 상자를 갈라 요청 개수를 채운다. 못 가르면 그대로 둔다."""
    out = [dict(b) for b in boxes]
    guard = 0
    while len(out) < k and guard < k * 4:
        guard += 1
        inks = [_ink_of(mask, b) for b in out]
        i = int(np.argmax(inks))
        pair = _split_box(mask, out[i])
        if pair is None:
            break
        out[i:i + 1] = [pair[0], pair[1]]
    return out


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) < 2:
        print("[err] 사용법: draft_regions.py <이미지> <영역수>")
        return 2
    image_path, k_raw = argv[0], argv[1]
    try:
        k = max(1, int(k_raw))
    except ValueError:
        print(f"[err] 영역 수가 숫자가 아닙니다: {k_raw}")
        return 2

    p = Path(image_path)
    if not p.exists():
        print(f"[err] 이미지를 찾을 수 없습니다: {image_path}")
        return 1
    bgr = cv2.imdecode(np.fromfile(str(p), dtype=np.uint8), cv2.IMREAD_COLOR)   # 한글 경로 대응
    if bgr is None:
        print(f"[err] 이미지를 읽을 수 없습니다: {image_path}")
        return 1

    h, w = bgr.shape[:2]
    comps = _components(_ink_mask(bgr), w, h)
    if not comps:
        print("[err] 먹선 덩어리를 찾지 못했습니다 — 선화가 아니거나 배경과 대비가 없습니다")
        return 1

    mask = _ink_mask(bgr)
    groups = _group(_reading_order(comps, h), k)
    boxes = _ensure_count(mask, [_box(g, w, h) for g in groups], k)
    regions = [{
        "sequence": i + 1,
        "region": box,
        "direction": _direction(box),
        "inkPixels": _ink_of(mask, box),
    } for i, box in enumerate(boxes)]

    print(f"  덩어리 {len(comps)}개 → 영역 {len(regions)}개 (요청 {k})")
    print("REGIONS=" + json.dumps({"canvas": {"width": w, "height": h}, "regions": regions}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
