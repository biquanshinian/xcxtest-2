# -*- coding: utf-8 -*-
import json
import re
from collections import defaultdict

with open(r"c:\Users\huyuz\Desktop\xcxtest-2\_weanalysis_data.json", encoding="utf-8") as f:
    data = json.load(f)

def sheet_df(key, sheet_idx=0):
    item = data[key]
    if "error" in item:
        return None
    sheets = list(item["sheets"].values())
    if not sheets:
        return None
    s = sheets[sheet_idx]
    rows = s.get("full") or s.get("preview")
    return rows

def find_header_row(rows):
    for i, row in enumerate(rows[:15]):
        joined = " ".join(str(c) for c in row)
        if any(k in joined for k in ("日期", "时间", "页面", "异常", "失败", "类型", "指标")):
            return i
    return 0

def rows_to_dicts(rows):
    if not rows:
        return []
    hi = find_header_row(rows)
    headers = [str(h).strip() or f"col{j}" for j, h in enumerate(rows[hi])]
    out = []
    for row in rows[hi + 1 :]:
        if not any(str(c).strip() for c in row):
            continue
        d = {}
        for j, h in enumerate(headers):
            if j < len(row):
                d[h] = row[j]
        out.append(d)
    return out

summary = {}

for key in data:
    rows = sheet_df(key)
    if not rows:
        summary[key] = {"error": data[key].get("error", "no rows")}
        continue
    recs = rows_to_dicts(rows)
    summary[key] = {
        "row_count": len(recs),
        "headers": list(recs[0].keys()) if recs else [],
        "sample": recs[:5],
        "all": recs if len(recs) <= 80 else recs[:80],
    }

# numeric helpers
def to_float(v):
    if v is None or v == "":
        return None
    s = str(v).replace("%", "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None

# targeted extractions
report = {}

# 1 exception types
k1 = [k for k in data if "异常类型" in k][0]
r1 = rows_to_dicts(sheet_df(k1))
report["exception_types"] = r1

# 2 failure types
k2 = [k for k in data if "失败类型" in k][0]
report["failure_types"] = rows_to_dicts(sheet_df(k2))

# 3 network trend
k3 = [k for k in data if "网络请求" in k][0]
r3 = rows_to_dicts(sheet_df(k3))
report["network_trend"] = {"count": len(r3), "rows": r3[-10:], "first": r3[:3]}

# 4 memory
k4 = [k for k in data if "运行内存" in k][0]
r4 = rows_to_dicts(sheet_df(k4))
report["memory_trend"] = {"count": len(r4), "rows": r4[-10:], "first": r4[:3]}

# 5 runtime exceptions detail
k5 = [k for k in data if "运行异常" in k][0]
r5 = rows_to_dicts(sheet_df(k5))
report["runtime_exceptions"] = r5

# 6 perf user dist
k6 = [k for k in data if "用户分布" in k][0]
report["perf_user_dist"] = rows_to_dicts(sheet_df(k6))

# 7 visual perf
k7 = [k for k in data if "视觉体验" in k][0]
report["visual_perf"] = rows_to_dicts(sheet_df(k7))

# 8 perf detail
k8 = [k for k in data if "体验性能数据明细" in k][0]
r8 = rows_to_dicts(sheet_df(k8))
report["perf_detail"] = r8

# 9 white screen
k9 = [k for k in data if "白屏" in k][0]
r9 = rows_to_dicts(sheet_df(k9))
report["white_screen"] = r9

out = r"c:\Users\huyuz\Desktop\xcxtest-2\_weanalysis_summary.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print(out)
for section, items in report.items():
    if isinstance(items, list):
        print(f"\n=== {section} ({len(items)} rows) ===")
        for row in items[:8]:
            print(row)
    elif isinstance(items, dict):
        print(f"\n=== {section} ===")
        print(json.dumps(items, ensure_ascii=False, indent=2)[:3000])
