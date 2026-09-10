#!/usr/bin/env python3
"""
In-place logo replace for campaign posters.

- Keep the rest of the image unchanged
- Only erase + replace the existing brand logo/caption region
- If no brand mark / 「火星探索日志」caption found → skip
"""
from __future__ import annotations

import argparse
import csv
import re
import shutil
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from rapidocr_onnxruntime import RapidOCR

REPO = Path(__file__).resolve().parents[4]
LOGO_PATH = Path(__file__).resolve().parents[1] / "assets" / "mars-log-logo.png"
CAMPAIGN = REPO / "docs" / "xhs-watch-party-campaign"
BACKUP_ROOT = CAMPAIGN / "_logo_backup"
REPORT_PATH = CAMPAIGN / "_logo_replace_report.csv"

CAPTION = "火星探索日志 · 火箭观礼"
BRAND_RE = re.compile(r"火星探索日志|火箭观礼")

# 2x vs previous 2.8%–4%; horizontal lockup only
NEW_LOGO_MAX_RATIO = 0.08
NEW_LOGO_MIN_RATIO = 0.056

DAY_THEME: dict[int, str] = {
    1: "#1B3A6B",
    2: "#5C2E14",
    3: "#1F4D3A",
    4: "#1A3A4A",
    5: "#0F5C5C",
    6: "#9A3412",
    7: "#0B4F6C",
    8: "#7A1F2B",
    9: "#1B4B5A",
    10: "#1E293B",
    11: "#0E7490",
    12: "#3F3A1D",
    13: "#E8D5A3",
    14: "#1D4ED8",
    15: "#0F766E",
    16: "#166534",
    17: "#9A3412",
    18: "#334155",
    19: "#14532D",
    20: "#E7C56B",
    21: "#1E3A5F",
    22: "#0F766E",
    23: "#713F12",
    24: "#3F6212",
    25: "#1E3A8A",
    26: "#0F766E",
    27: "#334155",
    28: "#A16207",
    29: "#15803D",
    30: "#F5E6C8",
}

_OCR: RapidOCR | None = None


def ocr_engine() -> RapidOCR:
    global _OCR
    if _OCR is None:
        _OCR = RapidOCR()
    return _OCR


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def load_logo_rgba() -> Image.Image:
    im = Image.open(LOGO_PATH).convert("RGBA")
    px = im.load()
    w, h = im.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if (r + g + b) / 3 > 140 and a > 10:
                op[x, y] = (255, 255, 255, 255)
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def recolor(mask: Image.Image, color: str) -> Image.Image:
    r, g, b = hex_to_rgb(color)
    colored = Image.new("RGBA", mask.size, (r, g, b, 255))
    colored.putalpha(mask.split()[3])
    return colored


def poly_to_xyxy(poly) -> tuple[int, int, int, int]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))


def detect_brand_region(bgr: np.ndarray) -> tuple[int, int, int, int, str] | None:
    """
    Detect existing brand block via OCR for 火星探索日志 / 火箭观礼.
    Returns (x, y, w, h, detail) covering caption + icon area above/beside it.
    """
    H, W = bgr.shape[:2]
    # RapidOCR accepts ndarray (BGR/RGB); pass path-like via tempfile-less ndarray
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    result, _ = ocr_engine()(rgb)
    if not result:
        return None

    raw_hits = []
    for item in result:
        poly, text, score = item[0], str(item[1]), float(item[2])
        compact = text.replace(" ", "").replace("·", "").replace("•", "")
        if "火星探索日志" in compact or "火星探索" in compact:
            raw_hits.append((poly, text, score, "full"))
        elif "火箭观礼" in compact:
            # only keep as brand caption if near bottom (avoid title ribbons)
            _a, b, _c, d = poly_to_xyxy(poly)
            cy = (b + d) / 2
            if cy >= H * 0.72:
                raw_hits.append((poly, text, score, "short"))

    if not raw_hits:
        return None

    # Prefer full brand name hits; ignore title-like short hits when full exists
    full = [h for h in raw_hits if h[3] == "full"]
    hits = full if full else raw_hits

    x0 = y0 = 10**9
    x1 = y1 = 0
    texts = []
    for poly, text, _score, _kind in hits:
        a, b, c, d = poly_to_xyxy(poly)
        x0, y0 = min(x0, a), min(y0, b)
        x1, y1 = max(x1, c), max(y1, d)
        texts.append(text)

    # Always use the single best-scoring hit (avoid unioning distant title fragments)
    best = max(hits, key=lambda h: h[2])
    a, b, c, d = poly_to_xyxy(best[0])
    x0, y0, x1, y1 = a, b, c, d
    tw, th = max(1, x1 - x0), max(1, y1 - y0)
    texts = [best[1]]

    # Expand modestly for icon above / left of caption
    up = min(max(int(th * 2.0), int(W * 0.04)), int(H * 0.06))
    left = min(max(int(th * 1.4), int(W * 0.028)), int(W * 0.08))
    pad_x = min(max(int(tw * 0.1), 6), int(W * 0.04))
    pad_y = min(max(int(th * 0.3), 3), int(H * 0.02))
    rx0 = max(0, x0 - left)
    ry0 = max(0, y0 - up)
    rx1 = min(W, x1 + pad_x)
    ry1 = min(H, y1 + pad_y)

    # Hard clamp: never erase a huge slab of the poster
    max_w, max_h = int(W * 0.42), int(H * 0.10)
    rw, rh = rx1 - rx0, ry1 - ry0
    if rw > max_w or rh > max_h:
        cx = (x0 + x1) // 2
        cy = (y0 + y1) // 2
        rw = min(rw, max_w)
        rh = min(rh, max_h)
        rx0 = max(0, min(cx - rw // 2, W - rw))
        ry0 = max(0, min(cy - rh // 2, H - rh))
        rx1, ry1 = rx0 + rw, ry0 + rh

    return rx0, ry0, rx1 - rx0, ry1 - ry0, "+".join(texts)


def pick_color(bgr: np.ndarray, box: tuple[int, int, int, int], day: int | None) -> str:
    base = DAY_THEME.get(day or 0, "#1E293B")
    x, y, w, h = box
    H, W = bgr.shape[:2]
    # sample outside the box for background luminance
    y0 = max(0, y - 12)
    y1 = min(H, y + h + 12)
    x0 = max(0, x - 12)
    x1 = min(W, x + w + 12)
    ring = bgr[y0:y1, x0:x1]
    if ring.size == 0:
        return base
    # mask inner box as ignored by copying edges only
    lum = float(cv2.cvtColor(ring, cv2.COLOR_BGR2GRAY).mean())
    r, g, b = hex_to_rgb(base)
    if lum < 95 and (r + g + b) / 3 < 150:
        return "#F5E6C8"
    if lum > 190 and (r + g + b) / 3 > 190:
        return "#1E293B"
    return base


def find_font(size: int) -> ImageFont.ImageFont:
    for p in (
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
    ):
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size=size, index=0)
            except OSError:
                continue
    return ImageFont.load_default()


def erase_region(bgr: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    H, W = bgr.shape[:2]
    mask = np.zeros((H, W), np.uint8)
    mask[y : y + h, x : x + w] = 255
    mask = cv2.dilate(mask, np.ones((7, 7), np.uint8), iterations=1)
    return cv2.inpaint(bgr, mask, 5, cv2.INPAINT_TELEA)


def paste_logo(
    bgr: np.ndarray,
    region: tuple[int, int, int, int],
    mask_rgba: Image.Image,
    color: str,
) -> np.ndarray:
    H, W = bgr.shape[:2]
    rx, ry, rw, rh = region
    # Proportional mark; never stretch. Prefer 2x size band.
    target_w = int(np.clip(W * 0.07, W * NEW_LOGO_MIN_RATIO, W * NEW_LOGO_MAX_RATIO))
    target_h = max(1, int(mask_rgba.height * (target_w / mask_rgba.width)))
    logo = recolor(mask_rgba, color).resize((target_w, target_h), Image.Resampling.LANCZOS)

    font_size = max(11, int(target_h * 0.42))
    font = find_font(font_size)
    base = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)).convert("RGBA")
    draw = ImageDraw.Draw(base)
    tb = draw.textbbox((0, 0), CAPTION, font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    gap_x = max(4, int(W * 0.01))
    # HORIZONTAL only: logo left + caption right
    block_w = target_w + gap_x + tw
    block_h = max(target_h, th)

    x = rx + max(0, (rw - block_w) // 2)
    y = ry + max(0, (rh - block_h) // 2)
    x = max(2, min(x, W - block_w - 2))
    y = max(2, min(y, H - block_h - 2))

    ly = y + (block_h - target_h) // 2
    base.alpha_composite(logo, (x, ly))
    tx = x + target_w + gap_x
    ty = y + (block_h - th) // 2
    rgb = hex_to_rgb(color)
    draw.text((tx, ty), CAPTION, font=font, fill=(*rgb, 255))

    out = Image.new("RGB", base.size, (255, 255, 255))
    out.paste(base, mask=base.split()[3])
    return cv2.cvtColor(np.array(out), cv2.COLOR_RGB2BGR)


def day_from_path(p: Path) -> int | None:
    for part in p.parts:
        if part.startswith("day-") and len(part) >= 6:
            try:
                return int(part.split("-")[1])
            except ValueError:
                pass
    return None


def process_file(
    path: Path,
    mask_rgba: Image.Image,
    *,
    dry_run: bool,
    force_color: str | None,
) -> dict:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        return {"file": str(path), "status": "error", "detail": "unreadable"}

    det = detect_brand_region(bgr)
    if det is None:
        return {"file": str(path.relative_to(REPO)), "status": "skip", "detail": "no_logo"}

    x, y, w, h, texts = det
    day = day_from_path(path)
    color = force_color or pick_color(bgr, (x, y, w, h), day)

    if dry_run:
        return {
            "file": str(path.relative_to(REPO)),
            "status": "would_replace",
            "detail": f"box={x},{y},{w},{h} text={texts} color={color}",
        }

    bak = BACKUP_ROOT / path.relative_to(CAMPAIGN)
    bak.parent.mkdir(parents=True, exist_ok=True)
    if not bak.exists():
        shutil.copy2(path, bak)

    erased = erase_region(bgr, x, y, w, h)
    out = paste_logo(erased, (x, y, w, h), mask_rgba, color)
    cv2.imwrite(str(path), out)
    return {
        "file": str(path.relative_to(REPO)),
        "status": "replaced",
        "detail": f"box={x},{y},{w},{h} text={texts} color={color}",
    }


def iter_posters(day: int | None = None) -> list[Path]:
    files: list[Path] = []
    for d in sorted(CAMPAIGN.glob("day-*")):
        if not d.is_dir():
            continue
        n = day_from_path(d / "x")
        if day is not None and n != day:
            continue
        for name in ("01-cover.png", "02-info.png", "03-merchant.png", "02-rockets.png"):
            p = d / name
            if p.exists():
                files.append(p)
    return files


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--day", type=int)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--color", type=str)
    args = ap.parse_args()

    if not args.all and args.day is None:
        raise SystemExit("use --all or --day N")
    if not LOGO_PATH.exists():
        raise SystemExit(f"missing {LOGO_PATH}")

    mask = load_logo_rgba()
    files = iter_posters(args.day)
    color = args.color
    if color and not color.startswith("#"):
        color = "#" + color

    rows = []
    counts: dict[str, int] = {}
    for p in files:
        row = process_file(p, mask, dry_run=args.dry_run, force_color=color)
        rows.append(row)
        counts[row["status"]] = counts.get(row["status"], 0) + 1
        print(f'{row["status"]:14} {row["file"]}  {row["detail"]}')

    with REPORT_PATH.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["file", "status", "detail"])
        w.writeheader()
        w.writerows(rows)
    print("---")
    print(counts)
    print("report:", REPORT_PATH)
    if not args.dry_run:
        print("backups:", BACKUP_ROOT)


if __name__ == "__main__":
    main()
