---
name: xhs-watch-party-merchant
description: >-
  生成「火星探索日志 · 火箭观礼」小红书商家入驻种草图文（竖版 3:4）。
  在用户提到火箭观礼投放、发射场商家入驻、国发/商发小红书、观礼连发、
  重出观礼海报、31-60天投放时使用。强制：场站×火箭对齐、火箭高还原、Logo 横向小标。
---

# 火箭观礼 · 小红书商家投放

产出：`docs/xhs-watch-party-campaign/day-XX/`  
每日：`01-cover` → `02-info` → `03-merchant` + `note.md`  
矩阵：[`PLAN.md`](../../../docs/xhs-watch-party-campaign/PLAN.md) · 场站表：[`site-rocket-map.md`](site-rocket-map.md)

## 硬性规则

### A. 品牌 Logo

文件：[`assets/mars-log-logo.png`](assets/mars-log-logo.png)（X 圆角条 + 中央凹边四角星）

#### 排版与尺寸（新图 + 替换均适用）

1. **禁止 Logo 与文字上下排版**（标在上、字在下 / 字在上、标在下都不行）
2. **必须横向**：左侧官方标 + 右侧旁注「火星探索日志 · 火箭观礼」，**同一水平基线对齐**
3. **尺寸**：Logo 宽 = 画幅宽的 **5.6%–8%**（相对旧版 2.8%–4% **放大一倍**）；旁注字号随标缩放，仍保持角标气质、勿占主视觉
4. **禁止变形**：只等比缩放官方 PNG；禁止拉伸/透视/3D/改几何
5. **随主题变色**：整枚标单色填充（浅底用深色标，深底用白/浅金标）

#### A1. 已有海报纠错（原图其它像素不动）

```bash
py -3 .cursor/skills/xhs-watch-party-merchant/scripts/replace_logo_inplace.py --all
# --day N | --dry-run
```

- 有「火星探索日志」品牌区 → 原位替换；**检测不到 → skip 不改**
- 备份：`_logo_backup/` · 报告：`_logo_replace_report.csv`

#### A2. 新出图

1. AI **不要画** Logo / 天数水印 / 小红书标；右下留空  
2. 贴标：`py -3 .cursor/skills/xhs-watch-party-merchant/scripts/composite_logo.py --day N`  
3. **禁止对已合成图重复跑** composite（会叠层）

### B. 场站 × 火箭（出图前必查）

见 [`site-rocket-map.md`](site-rocket-map.md)。**标题 / 胶带 / 正文 / 图内地名必须同一场站。**

| 场站 | 可写火箭 | 禁止误绑 |
|------|----------|----------|
| 文昌 | 长征五/五B/七/七改/八/八甲 | 朱雀、谷神星海射、引力一号、捷龙三号 |
| 酒泉 | 长二F/神舟/天舟/长二丁；朱雀、快舟、力箭、谷神星**陆射**、双曲线 | 海射型号 |
| 西昌 | 长三乙、长二丙、北斗 | 海射、极轨长六当主叙事 |
| 太原 | 长四、长六/六甲 | 北斗主场、海射 |
| 海阳东方航天港 | 谷神星一号**海射**、引力一号、捷龙三号、长十一海射 | 写成文昌/海南龙楼 |

出图前自检清单：

- [ ] 场站名一致（含 note）
- [ ] 火箭型号只属于该场站常见列表
- [ ] 国发/商发标签正确
- [ ] 海射地理写山东海阳/东方航天港

### C. 火箭视觉：必须对齐 COS「火箭配置图」

桶：`mars-1397421562`（广州）  
基址：`https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/`  
Key 前缀：`火箭配置图/`（映射见仓库 `utils/util.js` → `ROCKET_IMAGE_MAP`）

**出图前强制流程：**

1. 按当日火箭查 `ROCKET_IMAGE_MAP`（或中文别名 → 英文 stem，如捷龙三号→`Jielong-3.jpg`）
2. 下载到本地：  
   `assets/rocket-refs/<Filename>`  
   URL：`{baseUrl}{encodeURI('火箭配置图/<Filename>')}`
3. `GenerateImage` **必须**把该文件放入 `reference_image_paths`
4. 提示词写明：火箭外形/比例/涂装/有无助推 **严格复刻该 COS 参考图**，禁止发明捆绑助推或换成长征粗箭
5. **COS 文件名为准**：`ROCKET_IMAGE_MAP` / 桶内 key 对应哪一型就写哪一型（如 `Jielong-3.jpg`→捷龙三号）。禁止凭肉眼/模型识图擅自改型号文案
6. 辅助脚本：`scripts/fetch_rocket_ref.py --name "捷龙三号"`（或 `--key Jielong-3.jpg`）

常用 key：`Jielong-3.jpg` / `Ceres-1S.jpg` / `Ceres-1.webp` / `Gravity1.webp` / `ZhuQue-3.jpg` / `Kinetica-1_Rocket.webp` / `Long March 2D.jpg` 等。

**小红书写实海报例外**：COS `Long March 7A.png` 为机娘风，**禁止**作写实参考；长七甲写实改用 `CZ-7A_YG-45.jpg`。出图提示词须写明 `NO anime / NO mecha-girl`。

### D. 图面禁忌

- **不要写天数**（禁止「第N天」「Day N」角标）
- 不写微信/小程序/URL/二维码/小红书 Logo
- 国发红蓝金、商发青绿银橙（可微调，勿紫底套路）

### E. 合规文案

`note.md`：评论区留场站+业态；线上免费预约；收费线下合规。

## 工作流（31–60 同）

```
进度：
- [ ] 1. 查 PLAN + site-rocket-map，锁定场站/属性/火箭
- [ ] 2. 写 note.md
- [ ] 3. 生成 3 张 3:4（无 Logo、无天数；火箭高还原）
- [ ] 4. composite_logo.py 横向贴标（5.6%–8% 宽）
- [ ] 5. 自检：场站对齐 + 型号外观 + Logo 横向
```

**批量规则**：先做单日样张给用户看，确认后再批量 31–60。

### 出图提示词必含

```
Site+rocket MUST match: 【场站】×【火箭】【国发|商发】.
Rocket appearance: high fidelity to 【型号】 — 【外形要点】.
Do NOT draw day numbers, brand logos, Xiaohongshu marks, QR, WeChat, URL.
Leave a clean empty bottom-right margin for later branding.
```

## 系列投放

- Day 01–30、31–60 矩阵：`docs/xhs-watch-party-campaign/PLAN.md`
- 改场站/火箭：同步 PLAN + note，并重出当日 3 图
