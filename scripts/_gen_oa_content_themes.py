# -*- coding: utf-8 -*-
"""从 xiaohu-wechat-format themes 生成 adminGateway/oaContentThemes.js"""
import json
import pathlib

themes_dir = pathlib.Path(r"C:\Users\huyuz\.cursor\skills\xiaohu-wechat-format\themes")
wanted = [
    "newspaper",
    "magazine",
    "ink",
    "coffee-house",
    "bytedance",
    "github",
    "sspai",
    "midnight",
    "terracotta",
    "mint-fresh",
    "sunset-amber",
    "lavender-dream",
    "sports",
    "bauhaus",
    "chinese",
    "wechat-native",
    "minimal-gold",
    "focus-blue",
    "elegant-green",
    "bold-blue",
]

cats = {
    "newspaper": "深度长文",
    "magazine": "深度长文",
    "ink": "深度长文",
    "coffee-house": "深度长文",
    "bytedance": "科技产品",
    "github": "科技产品",
    "sspai": "科技产品",
    "midnight": "科技产品",
    "terracotta": "文艺随笔",
    "mint-fresh": "文艺随笔",
    "sunset-amber": "文艺随笔",
    "lavender-dream": "文艺随笔",
    "sports": "活力动态",
    "bauhaus": "活力动态",
    "chinese": "活力动态",
    "wechat-native": "活力动态",
    "minimal-gold": "模板布局",
    "focus-blue": "模板布局",
    "elegant-green": "模板布局",
    "bold-blue": "模板布局",
    "clean": "内置",
    "diary": "内置",
    "brief": "内置",
}


def style_to_css(d):
    if not isinstance(d, dict):
        return ""
    parts = []
    for k, v in d.items():
        if v is None or v == "":
            continue
        parts.append(f"{k.replace('_', '-')}:{v}")
    return ";".join(parts) + (";" if parts else "")


def compact_theme(data, tid):
    styles = data.get("styles") or {}
    colors = data.get("colors") or {}
    h1 = style_to_css(styles.get("h1") or {})
    h2 = style_to_css(styles.get("h2") or {})
    h3 = style_to_css(styles.get("h3") or {})
    p = style_to_css(styles.get("p") or {})
    q = style_to_css(styles.get("blockquote") or {})
    li = style_to_css(styles.get("li") or styles.get("p") or {})
    if "margin" not in li and "margin-bottom" not in li:
        li = ("margin:0 0 8px;" + li) if li else "margin:0 0 8px;line-height:1.7;font-size:15px;"
    # 无 h1 时回退 h2，保证 # 标题仍有样式
    if not h1:
        h1 = h2 or "margin:28px 0 14px;font-size:22px;font-weight:700;color:#1a1a1a;"
    return {
        "id": tid,
        "name": data.get("name") or tid,
        "category": cats.get(tid, "其他"),
        "accent": colors.get("accent") or colors.get("primary") or "#2f6bff",
        "h1": h1,
        "h2": h2 or "margin:28px 0 12px;font-size:18px;font-weight:700;color:#1a1a1a;",
        "h3": h3 or "margin:20px 0 10px;font-size:16px;font-weight:600;color:#333;",
        "p": p or "margin:0 0 14px;line-height:1.85;font-size:15px;color:#3a3a3a;",
        "quote": q
        or "margin:16px 0;padding:12px 14px;background:#f7f8fa;border-left:3px solid #c0c4cc;color:#606266;line-height:1.7;",
        "li": li,
    }


out = {}
meta = []
for tid in wanted:
    path = themes_dir / f"{tid}.json"
    if not path.exists():
        print("MISSING", tid)
        continue
    data = json.loads(path.read_text(encoding="utf-8"))
    t = compact_theme(data, tid)
    out[tid] = {
        "h1": t["h1"],
        "h2": t["h2"],
        "h3": t["h3"],
        "p": t["p"],
        "quote": t["quote"],
        "li": t["li"],
    }
    meta.append(
        {"id": tid, "name": t["name"], "category": t["category"], "accent": t["accent"]}
    )

legacy = {
    "clean": {
        "h1": "margin:28px 0 14px;font-size:22px;font-weight:700;color:#1a1a1a;border-left:4px solid #2f6bff;padding-left:12px;",
        "h2": "margin:28px 0 12px;font-size:18px;font-weight:700;color:#1a1a1a;border-left:4px solid #2f6bff;padding-left:10px;",
        "h3": "margin:20px 0 10px;font-size:16px;font-weight:600;color:#333;",
        "p": "margin:0 0 14px;line-height:1.85;font-size:15px;color:#3a3a3a;letter-spacing:0.02em;",
        "quote": "margin:16px 0;padding:12px 14px;background:#f7f8fa;border-left:3px solid #c0c4cc;color:#606266;line-height:1.7;",
        "li": "margin:0 0 8px;line-height:1.7;font-size:15px;color:#3a3a3a;",
    },
    "diary": {
        "h1": "margin:28px 0 14px;font-size:22px;font-weight:700;color:#1f2a44;text-align:center;",
        "h2": "margin:28px 0 12px;font-size:18px;font-weight:700;color:#1f2a44;text-align:center;",
        "h3": "margin:20px 0 10px;font-size:16px;font-weight:600;color:#334155;",
        "p": "margin:0 0 16px;line-height:1.9;font-size:15px;color:#334155;",
        "quote": "margin:16px 0;padding:14px;background:#f0f4ff;border-radius:8px;color:#475569;line-height:1.75;",
        "li": "margin:0 0 8px;line-height:1.75;font-size:15px;color:#334155;",
    },
    "brief": {
        "h1": "margin:22px 0 12px;font-size:20px;font-weight:700;color:#111;border-bottom:2px solid #111;padding-bottom:8px;",
        "h2": "margin:22px 0 10px;font-size:17px;font-weight:700;color:#111;border-bottom:1px solid #eee;padding-bottom:6px;",
        "h3": "margin:16px 0 8px;font-size:15px;font-weight:600;color:#222;",
        "p": "margin:0 0 12px;line-height:1.75;font-size:15px;color:#333;",
        "quote": "margin:12px 0;padding:10px 12px;background:#fafafa;color:#666;line-height:1.6;",
        "li": "margin:0 0 6px;line-height:1.65;font-size:15px;color:#333;",
    },
}
legacy_meta = [
    {"id": "clean", "name": "Clean", "category": "内置", "accent": "#2f6bff"},
    {"id": "diary", "name": "日记", "category": "内置", "accent": "#334155"},
    {"id": "brief", "name": "简报", "category": "内置", "accent": "#111111"},
]
for k, v in legacy.items():
    out[k] = v
meta = legacy_meta + meta

seen = set()
meta2 = []
for m in meta:
    if m["id"] in seen:
        continue
    seen.add(m["id"])
    meta2.append(m)

dest = pathlib.Path(
    r"C:\Users\huyuz\Desktop\xcxtest-2\cloudfunctions\adminGateway\oaContentThemes.js"
)
js = "// AUTO-GENERATED from xiaohu-wechat-format themes — regenerate via scripts/_gen_oa_content_themes.py\n"
js += "const THEME_META = " + json.dumps(meta2, ensure_ascii=False, indent=2) + ";\n\n"
js += "const THEMES = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n\n"
js += "function listThemeMeta() { return THEME_META.slice() }\n"
js += "function resolveThemeId(id) {\n"
js += "  const k = String(id || '').trim()\n"
js += "  return THEMES[k] ? k : 'clean'\n"
js += "}\n"
js += "module.exports = { THEMES, THEME_META, listThemeMeta, resolveThemeId }\n"
dest.write_text(js, encoding="utf-8")
print("wrote", dest, "themes", len(out), "meta", len(meta2))
