#!/usr/bin/env python3
"""Copy assets dayNN-*.png → campaign, erase AI brand/daymarks, composite horizontal logo."""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

import cv2
from rapidocr_onnxruntime import RapidOCR

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from composite_logo import DAY_THEME, composite_one  # noqa: E402
from replace_logo_inplace import detect_brand_region, erase_region  # noqa: E402

ASSETS = Path.home() / ".cursor" / "projects" / "c-Users-huyuz-Desktop-xcxtest-2" / "assets"
# also try workspace-relative cursor projects path from user_info
ALT_ASSETS = Path(r"C:\Users\huyuz\.cursor\projects\c-Users-huyuz-Desktop-xcxtest-2\assets")
CAMPAIGN = ROOT / "docs" / "xhs-watch-party-campaign"
OCR = RapidOCR()


def assets_dir() -> Path:
    if ALT_ASSETS.exists():
        return ALT_ASSETS
    return ASSETS


def clean(bgr):
    det = detect_brand_region(bgr)
    if det:
        x, y, w, h, _ = det
        bgr = erase_region(bgr, x, y, w, h)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    res, _ = OCR(rgb)
    for item in res or []:
        text = str(item[1]).replace(" ", "")
        if re.search(r"第\s*\d+\s*天|Day\s*\d+", text, re.I):
            poly = item[0]
            xs = [p[0] for p in poly]
            ys = [p[1] for p in poly]
            x0, y0, x1, y1 = int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))
            bgr = erase_region(bgr, max(0, x0 - 8), max(0, y0 - 8), x1 - x0 + 16, y1 - y0 + 16)
    return bgr


def finalize(day: int) -> None:
    src = assets_dir()
    dst = CAMPAIGN / f"day-{day:02d}"
    dst.mkdir(parents=True, exist_ok=True)
    mapping = [
        (f"day{day:02d}-01-cover.png", "01-cover.png"),
        (f"day{day:02d}-02-info.png", "02-info.png"),
        (f"day{day:02d}-03-merchant.png", "03-merchant.png"),
    ]
    color = DAY_THEME.get(day, "#1E293B")
    for a, b in mapping:
        ap, bp = src / a, dst / b
        if not ap.exists():
            print("missing", ap)
            continue
        if ap.stat().st_size == 0:
            print("empty", ap)
            continue
        shutil.copy2(ap, bp)
        img = cv2.imread(str(bp))
        if img is None:
            print("unreadable", ap)
            continue
        img = clean(img)
        cv2.imwrite(str(bp), img)
        composite_one(bp, color)
        print("ok", bp.relative_to(ROOT), color)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", type=int)
    ap.add_argument("--from", dest="from_day", type=int)
    ap.add_argument("--to", dest="to_day", type=int)
    args = ap.parse_args()
    if args.day:
        finalize(args.day)
    elif args.from_day and args.to_day:
        for d in range(args.from_day, args.to_day + 1):
            finalize(d)
    else:
        raise SystemExit("use --day N or --from A --to B")


if __name__ == "__main__":
    main()
