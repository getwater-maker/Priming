import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


# 라벨이 한국어라 한글을 담은 폰트가 필요하다.
# 원본은 "C:/Windows/Fonts/msyh.ttc"(Microsoft YaHei = 간체 중국어) 하드코딩이었는데,
# 그 폰트에는 한글 글리프가 없어 라벨이 전부 두부(□□□)로 나온다.
# 또 경로가 하드코딩이라 그 폰트가 없는 PC 에서는 예외로 확인 그림 자체가 안 나왔다.
# → 후보를 순회하고, 어느 것도 못 찾으면 기본 폰트로라도 그린다.
#   (라벨이 작아지는 것보다 확인 그림이 통째로 사라지는 쪽이 나쁘다)
_FONT_CANDIDATES = [
    "C:/Windows/Fonts/malgun.ttf",   # 맑은 고딕 — 한국어 Windows 기본
    "C:/Windows/Fonts/NanumGothic.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "C:/Windows/Fonts/msyh.ttc",     # 원본값 — 한글 미포함이라 최후 폴백
]


def _load_font(size: int):
    for candidate in _FONT_CANDIDATES:
        if not Path(candidate).exists():
            continue
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size)
    except TypeError:      # Pillow 10.1 미만은 size 를 안 받는다
        return ImageFont.load_default()


def main(image_path: str, annotation_path: str, output_path: str) -> None:
    image = Image.open(image_path).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = _load_font(28)
    small_font = _load_font(18)
    colors = [(38, 103, 255, 225), (255, 105, 92, 225), (41, 167, 102, 225), (181, 100, 255, 225)]

    data = json.loads(Path(annotation_path).read_text(encoding="utf-8"))
    for index, element in enumerate(data["elements"], start=1):
        region = element["region"]
        x, y = region["x"], region["y"]
        right, bottom = x + region["width"], y + region["height"]
        color = colors[(index - 1) % len(colors)]
        fill = (*color[:3], 24)
        draw.rounded_rectangle((x, y, right, bottom), radius=12, outline=color, width=4, fill=fill)
        draw.ellipse((x + 8, y + 8, x + 44, y + 44), fill=color)
        draw.text((x + 19, y + 8), str(index), anchor="ma", font=small_font, fill="white")
        label = f"{index}. {element['label']}  {element['reveal']['direction']}"
        draw.rounded_rectangle((x + 52, y + 8, min(right - 8, x + 52 + len(label) * 19), y + 46), radius=6, fill=(255, 255, 255, 225))
        draw.text((x + 60, y + 12), label, font=small_font, fill=color)
        start = tuple(element["handPath"]["start"])
        end = tuple(element["handPath"]["end"])
        draw.line((start, end), fill=color, width=4)
        draw.polygon((end, (end[0] - 13, end[1] - 7), (end[0] - 13, end[1] + 7)), fill=color)

    result = Image.alpha_composite(image, overlay).convert("RGB")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    result.save(output_path, quality=95)


if __name__ == "__main__":
    main(*sys.argv[1:4])
