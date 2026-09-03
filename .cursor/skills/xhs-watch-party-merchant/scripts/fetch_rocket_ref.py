#!/usr/bin/env python3
"""Download rocket config art from Tencent COS for poster reference."""
from __future__ import annotations

import argparse
import urllib.parse
import urllib.request
from pathlib import Path

COS_BASE = "https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/"
PREFIX = "火箭配置图/"
OUT_DIR = Path(__file__).resolve().parents[1] / "assets" / "rocket-refs"

# Mirrors utils/util.js ROCKET_IMAGE_MAP (Chinese + common aliases)
NAME_TO_FILE = {
    "捷龙三号": "Jielong-3.jpg",
    "捷龙": "Jielong-3.jpg",
    "jielong-3": "Jielong-3.jpg",
    "smart dragon 3": "Jielong-3.jpg",
    "谷神星一号海射": "Ceres-1S.jpg",
    "谷神星一号海射型": "Ceres-1S.jpg",
    "ceres-1s": "Ceres-1S.jpg",
    "谷神星一号": "Ceres-1.webp",
    "ceres-1": "Ceres-1.webp",
    "引力一号": "Gravity1.webp",
    "gravity 1": "Gravity1.webp",
    "gravity1": "Gravity1.webp",
    "朱雀三号": "ZhuQue-3.jpg",
    "zhuque-3": "ZhuQue-3.jpg",
    "朱雀二号改": "ZhuQue-2E.jpg",
    "力箭一号": "Kinetica-1_Rocket.webp",
    "kinetica-1": "Kinetica-1_Rocket.webp",
    "快舟十一号": "Kuaizhou_11.jpg",
    "长征七号改": "Long March 7A.png",
    "长征七改": "Long March 7A.png",
    "long march 7a": "Long March 7A.png",
    "长征八号甲": "Long March 8A CZ-8A_SatNet_LEO-14.jpg",
    "长征六号甲": "Long-March-6A-CZ-6A_SatNet_LEO_Group_05.jpg",
    "长征二号丁": "Long March 2D.jpg",
    "长征二号f": "Long March 2F.jpg",
    "长征十一号海射": "Long March 11H.jpg",
    "双曲线一号": "Hyperbola-1.webp",
}


def resolve_filename(name: str | None, key: str | None) -> str:
    if key:
        return key.split("/")[-1]
    if not name:
        raise SystemExit("need --name or --key")
    k = name.strip().lower().replace("号", "号")
    # try exact then lower
    for cand in (name.strip(), name.strip().lower(), k):
        if cand in NAME_TO_FILE:
            return NAME_TO_FILE[cand]
        if cand.lower() in {a.lower(): b for a, b in NAME_TO_FILE.items()}:
            return {a.lower(): b for a, b in NAME_TO_FILE.items()}[cand.lower()]
    raise SystemExit(f"unknown rocket name: {name!r}; pass --key Filename.ext")


def download(filename: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cos_key = PREFIX + filename
    url = COS_BASE + urllib.parse.quote(cos_key, safe="/")
    out = OUT_DIR / filename
    print("GET", url)
    urllib.request.urlretrieve(url, out)
    print("OK", out, out.stat().st_size, "bytes")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", help="中文/英文火箭名")
    ap.add_argument("--key", help="COS 文件名，如 Jielong-3.jpg")
    args = ap.parse_args()
    fn = resolve_filename(args.name, args.key)
    download(fn)


if __name__ == "__main__":
    main()
