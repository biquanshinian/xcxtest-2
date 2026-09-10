"""Pack rocket-scale-app with root-only POSIX zip names."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent / "rocket-scale-app"
OUT = Path(__file__).resolve().parent / "rocket-scale.zip"


def main():
    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in sorted(ROOT.iterdir()):
            if not item.is_file():
                continue
            if item.suffix.lower() not in (".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".woff", ".woff2", ".json"):
                continue
            if item.name in ("publish-form.json", "icon-512.png"):
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
