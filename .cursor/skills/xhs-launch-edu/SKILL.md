---
name: xhs-launch-edu
description: >-
  生成小红书「发射/火箭科普」图文：文案 + 6 张竖版 3:4 配图，软推「火星探索日志」。
  强制用 COS「火箭配置图」作 reference_image_paths 高还原外形。
  当用户说朱雀三号/长征/猎鹰等发射科普、即将发射图文、6 张小红书科普图、
  火箭外形按配置图、重出发射科普时使用。
---

# 小红书 · 发射科普图文（6 图）

产出目录：`docs/xhs-<rocket-slug>-YYYY-MM/`（例：`docs/xhs-zq3-y2-2026-08/`）  
标杆成稿：同目录下朱雀三号遥二那一套（用户认可的「生成得很好」模板）。

**不是**观礼招商投放（→ `xhs-watch-party-merchant`）；**不是**宝藏工具合集（→ `xiaohongshu-space-reco`）。

## 何时使用

- 某型火箭即将发射 / 复飞 / 回收验证，要发小红书科普
- 要 **6 张**竖版图 + 可粘贴正文，并软推火星探索日志
- 明确要求「外形按 COS 配置图」「参考火箭配置图」

## 硬性规则

### A. 火箭外形 = COS 配置图（强制）

桶：`mars-1397421562` · 基址：`https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/`  
Key：`火箭配置图/<Filename>` · 映射：`utils/util.js` → `ROCKET_IMAGE_MAP`  
别名表：`.cursor/skills/xhs-watch-party-merchant/scripts/fetch_rocket_ref.py`

出图前：

1. 解析型号 → COS 文件名（例：朱雀三号 → `ZhuQue-3.jpg`）
2. 下载到 `.cursor/skills/xhs-watch-party-merchant/assets/rocket-refs/<Filename>`（禁止仓库根 `assets/`，会打进主包）
3. **若原图 > ~2MB**：用 sharp 压成 `*-ref.jpg`（高约 1600、jpeg~85），否则 `GenerateImage` 易 400
4. 每张图 `GenerateImage` 必须带 `reference_image_paths: [本地参考图]`
5. 提示词写明：外形/比例/涂装/栅格舵/着陆腿/标识 **严格复刻该参考图**；禁止发明助推、换成长征粗箭、乱改涂装
6. **COS 文件名为准**定型号文案；禁止凭模型识图改名

朱雀三号要点（`ZhuQue-3.jpg`）：白头罩+小国旗、银箭身、竖排「朱雀」、白环「ZQ-3」、黑栅格舵、大红朱雀图腾、竖排 LANDSPACE、黑着陆腿收起。

### B. 小红书合规（软推）

文案 + 图内文字 **禁止**：

`微信` `小程序` `公众号` `浏览器` `官网` `下载` `私信` `加群` `外链`  
`如何找到` `搜一搜` `搜索栏` `绿色App` `网站` `App` `掌上应用`  
URL / 二维码 /「评论区扣1」

**允许**：只写「火星探索日志」+ 能做什么（倒计时、任务动态、相关通知、收藏任务）。  
**禁止**：教去哪打开、怎么搜。

### C. 事实口径

- 发射窗口写「公开航警 / 约 …」；**点火以官方最终公告为准**
- 回收/入轨写「验证 / 挑战」；成与败都是工程数据，勿打包票
- 参数用「约 / 公开资料量级，以官方为准」

## 六图结构（默认）

比例一律 **3:4**。浅色风：米白～浅雾蓝底、深藏青字、火星橙点缀；清新扁平+白卡片。

| 序 | 文件 | 内容 |
|----|------|------|
| 01 | `01-cover.png` | 封面：型号+任务钩子（遥二/首飞等）+ 整箭主视觉 |
| 02 | `02-what.png` | 它是什么：3 条关键属性卡 |
| 03 | `03-specs.png` | 白话参数（高度/发动机/运力等） |
| 04 | `04-mission.png` | 本场看什么（入轨 / 回收 / 载荷…） |
| 05 | `05-window.png` | 窗口与地点（带「以官方为准」） |
| 06 | `06-track.png` | 火星探索日志：只谈功能，配同外形火箭 |

每张提示词末尾追加禁令句：

```
严禁：如何找到、搜索、浏览器、微信、小程序、掌上应用、网站、App、绿色聊天、二维码、网址、http。
Rocket MUST match attached COS config reference exactly.
```

## 工作流

```
进度：
- [ ] 1. 锁定型号 + COS key；下载/压缩参考图
- [ ] 2. 核对公开窗口/任务目标（WebSearch）；写 note.md
- [ ] 3. GenerateImage ×6（均带 reference_image_paths）
- [ ] 4. 复制到产出目录；自检外形与合规
- [ ] 5. 交付：标题三选一 + 正文 + 话题 + 图路径
```

下载示例：

```bash
py -3 .cursor/skills/xhs-watch-party-merchant/scripts/fetch_rocket_ref.py --name "朱雀三号"
# 或手动：
# curl COS → .cursor/skills/xhs-watch-party-merchant/assets/rocket-refs/ZhuQue-3.jpg
# node -e "require('sharp')('.cursor/skills/xhs-watch-party-merchant/assets/rocket-refs/ZhuQue-3.jpg').resize({height:1600}).jpeg({quality:85}).toFile('.cursor/skills/xhs-watch-party-merchant/assets/rocket-refs/ZhuQue-3-ref.jpg')"
```

## 文案骨架

标题带数字或窗口日期 + 干货钩子。正文：

1. 一句说明「为什么值得看」
2. `>>` 列出 2～3 个观看维度
3. 窗口/地点 + 官方为准
4. 点名「火星探索日志」功能（无找法）
5. 邀请评论 + 3～6 个话题（`#型号 #发射商 #商业航天 #可回收火箭 #航天爱好者` 等）

## 交付检查

- [ ] 6 张图均使用 COS 参考；外形无串型号
- [ ] 无站外找法 / 平台类型词 / URL / 二维码
- [ ] 时间与任务表述留余地
- [ ] `note.md` + `01`～`06` 已落盘
