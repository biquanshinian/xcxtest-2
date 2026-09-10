"""Pack the mini-tool zip with root-only POSIX entry names.

PowerShell Compress-Archive writes Windows backslashes (assets\\data.js),
which Xiaohongshu rejects. Always pack with this script.
"""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent / "app"
OUT = Path(__file__).resolve().parent / "rocket-watch-guide.zip"


def main():
    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in sorted(ROOT.iterdir()):
            if not item.is_file():
                continue
            name = item.name
            if ".." in name or name.startswith("/") or "\\" in name:
                raise SystemExit("unsafe name: %s" % name)
            zf.write(item, arcname=name)
    print("wrote", OUT, OUT.stat().st_size, "bytes")
    with zipfile.ZipFile(OUT) as zf:
        for info in zf.infolist():
            print(" ", info.filename)


if __name__ == "__main__":
    main()
