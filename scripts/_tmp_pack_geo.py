from PIL import Image, ImageDraw, ImageFont
import os
import shutil

src_dir = r"C:\Users\huyuz\.cursor\projects\c-Users-huyuz-Desktop-xcxtest-2\assets"
dst = r"C:\Users\huyuz\Desktop\xcxtest-2\docs\xhs-geo-storm-2026-09"
os.makedirs(dst, exist_ok=True)

names = [
    "01-cover.png",
    "02-what.png",
    "03-why.png",
    "04-scale.png",
    "05-aurora.png",
    "06-sat.png",
    "07-cme.png",
    "08-not.png",
    "09-watch.png",
    "10-track.png",
]


def to_34(im):
    im = im.convert("RGB")
    w, h = im.size
    target_w = int(round(h * 3 / 4))
    if target_w > w:
        pad = target_w - w
        bg = Image.new("RGB", (target_w, h), im.getpixel((2, 2)))
        bg.paste(im, (pad // 2, 0))
        return bg
    if target_w < w:
        extra = w - target_w
        return im.crop((extra // 2, 0, w - extra + extra // 2, h))
    return im


font_path = r"C:\Windows\Fonts\msyhbd.ttc"
title_font = ImageFont.truetype(font_path, 78)

for n in names:
    im = Image.open(os.path.join(src_dir, n))
    im = to_34(im)
    if n == "10-track.png":
        draw = ImageDraw.Draw(im)
        # original 1024 canvas was padded 64px each side
        x0, y0, x1, y1 = 64, 228, 64 + 1024, 372
        bg = (254, 250, 242)
        draw.rectangle([x0, y0, x1, y1], fill=bg)
        text = "火星探索日志"
        navy = (1, 36, 84)
        bbox = draw.textbbox((0, 0), text, font=title_font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        tx = (im.size[0] - tw) // 2
        ty = y0 + (y1 - y0 - th) // 2 - 8
        draw.text((tx, ty), text, font=title_font, fill=navy)
    out = os.path.join(dst, n)
    im.save(out, "PNG", optimize=True)
    print(n, im.size)

shutil.copyfile(os.path.join(dst, "01-cover.png"), os.path.join(dst, "cover.png"))
print("done", dst)
