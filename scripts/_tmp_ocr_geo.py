from rapidocr_onnxruntime import RapidOCR
from PIL import Image
import os

ocr = RapidOCR()
p = r"C:\Users\huyuz\.cursor\projects\c-Users-huyuz-Desktop-xcxtest-2\assets"
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
for n in names:
    fp = os.path.join(p, n)
    result, _ = ocr(fp)
    print("====", n, Image.open(fp).size, "====")
    if not result:
        print("(no text)")
        continue
    for row in result:
        txt = row[1] if len(row) > 1 else row
        score = row[2] if len(row) > 2 else ""
        print(txt, score)
    print()
