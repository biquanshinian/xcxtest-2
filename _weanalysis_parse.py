# -*- coding: utf-8 -*-
"""Parse WeChat WeAnalysis exported xlsx files."""
import json
import os
import sys

try:
    import pandas as pd
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas", "openpyxl", "-q"])
    import pandas as pd

FILES = [
    r"c:\Users\huyuz\Desktop\(20260511-20260517)异常类型分布_500000002.xlsx",
    r"c:\Users\huyuz\Desktop\(20260511-20260517)失败类型分布_500000003.xlsx",
    r"c:\Users\huyuz\Desktop\(20260331-20260517)网络请求趋势_500000005.xlsx",
    r"c:\Users\huyuz\Desktop\(20260331-20260517)运行内存趋势_500000006.xlsx",
    r"c:\Users\huyuz\Desktop\(20260331-20260517)运行异常 数据明细表格_500000007.xlsx",
    r"c:\Users\huyuz\Desktop\(20260517-20260517)运行体验性能用户分布_500000008.xlsx",
    r"c:\Users\huyuz\Desktop\(20260517-20260517)视觉体验性能_500000009.xlsx",
    r"c:\Users\huyuz\Desktop\(20260331-20260517)体验性能数据明细_500000010.xlsx",
    r"c:\Users\huyuz\Desktop\(20260331-20260517)页面白屏 数据明细表格_500000011.xlsx",
]

def read_xlsx(path):
    if not os.path.exists(path):
        return {"error": f"not found: {path}"}
    xl = pd.ExcelFile(path)
    out = {"path": path, "basename": os.path.basename(path), "sheets": {}}
    for sn in xl.sheet_names:
        df = pd.read_excel(path, sheet_name=sn, header=None)
        out["sheets"][sn] = {
            "shape": list(df.shape),
            "preview": df.head(30).fillna("").astype(str).values.tolist(),
            "full": df.fillna("").astype(str).values.tolist() if df.shape[0] <= 200 else None,
        }
    return out

def main():
    result = {}
    for f in FILES:
        key = os.path.basename(f)
        print(f"Reading {key}...", file=sys.stderr)
        result[key] = read_xlsx(f)
    out_path = r"c:\Users\huyuz\Desktop\xcxtest-2\_weanalysis_data.json"
    with open(out_path, "w", encoding="utf-8") as fp:
        json.dump(result, fp, ensure_ascii=False, indent=2)
    print(out_path)

if __name__ == "__main__":
    main()
