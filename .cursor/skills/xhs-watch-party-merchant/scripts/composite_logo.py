#!/usr/bin/env python3
"""Composite official Mars Log logo onto campaign posters (small, no distortion, theme color)."""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[4]
LOGO_PATH = Path(__file__).resolve().parents[1] / "assets" / "mars-log-logo.png"
CAMPAIGN = REPO / "docs" / "xhs-watch-party-campaign"

# Day -> brand mark hex (single flat fill). Prefer dark on light themes, light on dark.
DAY_THEME: dict[int, str] = {
    1: "#1B3A6B",   # 文昌黄蓝 → 深蓝
    2: "#5C2E14",   # 酒泉沙橙 → 深棕
    3: "#1F4D3A",   # 西昌松绿 → 墨绿
    4: "#1A3A4A",   # 太原冰蓝 → 青灰
    5: "#0F5C5C",   # 酒泉朱雀青绿 → 深青
    6: "#B45309",   # 短场次橙 → 深橙（浅底）
    7: "#0B4F6C",   # 文昌海蓝 → 深蓝青
    8: "#7A1F2B",   # 西昌酒红
    9: "#1B4B5A",   # 太原雾蓝
    10: "#1E293B",  # 对比篇墨蓝
    11: "#0E7490",  # 海阳银青
    12: "#3F3A1D",  # 天舟土黄
    13: "#F5E6C8",  # 北斗夜蓝底 → 浅金
    14: "#1D4ED8",  # 长五B 白蓝红 → 蓝
    15: "#0F766E",  # 商发合集青绿
    16: "#166534",  # 周历奶油绿 → 深绿
    17: "#9A3412",  # 沙漠日落
    18: "#334155",  # 银灰蓝
    19: "#14532D",  # 西昌森绿
    20: "#E7C56B",  # 深蓝金底 → 浅金
    21: "#1E3A5F",  # 速配表
    22: "#0F766E",  # 海阳海射
    23: "#713F12",  # 科普土黄
    24: "#3F6212",  # 龙楼黄绿
    25: "#1E3A8A",  # 国发逻辑蓝
    26: "#0F766E",  # 商发逻辑青
    27: "#334155",  # 装备灰
    28: "#A16207",  # 合规黄
    29: "#15803D",  # 清单绿
    30: "#F5E6C8",  # 庆典重彩 → 浅金
    31: "#0E7490",  # 海阳捷龙
    32: "#1D4ED8",
    33: "#5C2E14",
    34: "#E8D5A3",
    35: "#334155",
    36: "#0F766E",
    37: "#0E7490",
    38: "#0B4F6C",
    39: "#9A3412",
    40: "#7A1F2B",
    41: "#1B4B5A",
    42: "#0F766E",
    43: "#E7C56B",
    44: "#B45309",
    45: "#3F3A1D",
    46: "#1F4D3A",
    47: "#1D4ED8",
    48: "#0F766E",
    49: "#0E7490",
    50: "#334155",
    51: "#3F6212",
    52: "#9A3412",
    53: "#14532D",
    54: "#1E3A5F",
    55: "#1E3A8A",
    56: "#0F766E",
    57: "#334155",
    58: "#A16207",
    59: "#15803D",
    60: "#F5E6C8",
    61: "#0F766E",  # 朱雀三号预热青绿
    62: "#1D4ED8",  # 长七甲→朱雀桥接蓝青
}

CAPTION = "火星探索日志 · 火箭观礼"
# 2x vs previous 3.5%; horizontal layout only (logo LEFT, caption RIGHT)
LOGO_WIDTH_RATIO = 0.07
MARGIN_X_RATIO = 0.028
MARGIN_Y_RATIO = 0.022
CAPTION_GAP_X_RATIO = 0.01  # horizontal gap between mark and text


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def load_logo_mask(path: Path) -> Image.Image:
    """Return RGBA logo: opaque where mark is (near-white), transparent elsewhere."""
    im = Image.open(path).convert("RGBA")
    pixels = im.load()
    w, h = im.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            # white mark on black (or any bright mark)
            lum = (r + g + b) / 3
            if lum > 140 and a > 10:
                op[x, y] = (255, 255, 255, 255)
            else:
                op[x, y] = (0, 0, 0, 0)
    # trim transparent borders
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    return out


def recolor_logo(mask: Image.Image, color: str) -> Image.Image:
    r, g, b = hex_to_rgb(color)
    colored = Image.new("RGBA", mask.size, (r, g, b, 255))
    alpha = mask.split()[3]
    colored.putalpha(alpha)
    return colored


def find_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\msyhbd.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
    ]
    for p in candidates:
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size=size, index=0)
            except OSError:
                continue
    return ImageFont.load_default()


def composite_one(poster_path: Path, color: str, out_path: Path | None = None) -> Path:
    base = Image.open(poster_path).convert("RGBA")
    W, H = base.size
    logo_w = max(24, int(W * LOGO_WIDTH_RATIO))
    mask = load_logo_mask(LOGO_PATH)
    # proportional scale — never stretch
    scale = logo_w / mask.width
    logo_h = max(1, int(mask.height * scale))
    logo = recolor_logo(mask, color).resize((logo_w, logo_h), Image.Resampling.LANCZOS)

    # caption roughly matching logo height (horizontal lockup)
    font_size = max(11, int(logo_h * 0.42))
    font = find_font(font_size)
    draw = ImageDraw.Draw(base)
    bbox = draw.textbbox((0, 0), CAPTION, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    gap_x = max(4, int(W * CAPTION_GAP_X_RATIO))
    block_w = logo_w + gap_x + tw
    block_h = max(logo_h, th)
    x = W - int(W * MARGIN_X_RATIO) - block_w
    y = H - int(H * MARGIN_Y_RATIO) - block_h

    # HORIZONTAL only: logo left, caption right, vertically centered
    lx = x
    ly = y + (block_h - logo_h) // 2
    base.alpha_composite(logo, (lx, ly))
    tx = x + logo_w + gap_x
    ty = y + (block_h - th) // 2
    rgb = hex_to_rgb(color)
    draw.text((tx, ty), CAPTION, font=font, fill=(*rgb, 255))

    out = out_path or poster_path
    rgb_out = Image.new("RGB", base.size, (255, 255, 255))
    rgb_out.paste(base, mask=base.split()[3])
    rgb_out.save(out, "PNG", optimize=True)
    return out


def day_dir(n: int) -> Path:
    return CAMPAIGN / f"day-{n:02d}"


def poster_files(n: int) -> list[Path]:
    d = day_dir(n)
    names = ["01-cover.png", "02-info.png", "03-merchant.png", "02-rockets.png"]
    return [d / name for name in names if (d / name).exists()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", type=int, help="Single day number")
    ap.add_argument("--all", action="store_true", help="Days 1-60 that exist on disk")
    ap.add_argument("--color", type=str, help="Override #RRGGBB")
    ap.add_argument("--from-assets", action="store_true", help="Also process cursor assets dayXX-*.png into campaign")
    args = ap.parse_args()

    if not LOGO_PATH.exists():
        raise SystemExit(f"logo missing: {LOGO_PATH}")

    if args.all:
        days = [n for n in range(1, 99) if day_dir(n).exists()]
    elif args.day:
        days = [args.day]
    else:
        days = []
    if not days:
        raise SystemExit("use --day N or --all")

    for n in days:
        color = args.color or DAY_THEME.get(n, "#1E293B")
        if args.color and not re.fullmatch(r"#?[0-9A-Fa-f]{6}", args.color):
            raise SystemExit("bad --color")
        if args.color and not args.color.startswith("#"):
            color = "#" + args.color
        files = poster_files(n)
        if not files:
            print(f"day-{n:02d}: no posters")
            continue
        for f in files:
            composite_one(f, color)
            print(f"ok {f.relative_to(REPO)} <- {color}")


if __name__ == "__main__":
    main()
