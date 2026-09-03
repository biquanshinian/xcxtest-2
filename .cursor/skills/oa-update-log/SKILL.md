---
name: oa-update-log
description: >-
  为「火星探索日志」撰写公众号成品文（更新日志 / 产品使用技巧连载 / 商家教程），配专属图并导入后台草稿箱（不洗稿）。
  当用户说「写更新日志」「产品更新推文」「导入公众号草稿」「产品使用技巧」「功能技巧连载」「写 N 篇技巧并导入」「商家入驻教程」「观礼商家入驻说明」「按 gallery 重做」「重新设计导入」时使用。
---

# 公众号成品 → 草稿箱（更新日志 / 产品技巧 / 商家教程）

面向运营：写完稿 + **专属配图** → **必须入库**「内容中台 → 草稿箱」→ 运营选主题 / 预览 → 自行「推微信」。

**禁止**流水线「手动素材洗稿」；成品用 `POST /oa-content/drafts/import`。

排版与结构对标本地 gallery：`wechat-format/.../article/gallery.html`（主题预览页）；成稿结构对齐同目录 `article.md` 写法。

## 文风（必须遵守）

**记住了：面向客户说明功能即可；不能写内部话术；不要写什么专业词语。**

1. 只写用户能看见、能点开、能用到的功能。
2. 禁止内部话术 / 实现细节（LL2、云函数、COS、白名单、过审开关、后台配置、API、token、部署等）。
3. 禁止堆专业词；改成白话。
4. 禁止空话；每段说清点哪、能干什么。
5. 简体中文、口语、短句；品牌「火星探索日志」。

## 配图（强制 · 禁止默认封面）

**记住了：还要配生成图；禁止使用默认封面图。**

1. 每篇必须有 **本篇专属封面**（本地文件，如 `cover.jpg`），文首 Markdown：`![封面](cover.jpg)`。
2. **禁止**依赖发稿号/系统默认封面、品牌 `defaultCoverUrl`、占位图、重复套用同一张「通用封面」充数。
3. 技巧连载：**一篇一图（至少封面）**；更新日志：封面 + 1～3 张文内配图（如 `illus-*.jpg`）。
4. 出图方式：可用生图工具 / 封面技能；风格偏太空产品说明、干净、可读，避免乱字水印。
5. 导入时必须把封面上传 COS，并写入 `coverUrl` + `imageMap`；无封面 **不得导入**。

## 稿件类型

### A. 更新日志

- 目录：`docs/wechat-oa/YYYY-MM-update/`
- 结构（对标 gallery 成稿）：`# 标题` → 封面图 → 开场 → `##` 分点 → 怎么体验 → 结尾。

### B. 产品使用技巧连载

- 目录：`docs/wechat-oa/product-tips-YYYY-MM/NN-短名/article.md` + `cover.jpg`
- 每篇一个功能；标题口语；约 350～700 字。
- 结构：封面 → 场景一句话 → 在小程序怎么找 → 两三点用法 → 收尾（搜「火星探索日志」）。
- 批量：`node .cursor/skills/oa-update-log/scripts/import-to-drafts.js docs/wechat-oa/product-tips-YYYY-MM --batch`

### C. 商家入驻简单教程

- 目录：`docs/wechat-oa/merchant-onboarding-YYYY-MM/article.md` + `cover.jpg`
- 写给商家：准备什么 → 小程序申请 → 通过后做什么；白话、无内部菜单黑话。

## 强制收尾

写完 + 配图后同一轮必须导入：

```bash
node scripts/ops-admin-login.js   # token 过期时
node .cursor/skills/oa-update-log/scripts/import-to-drafts.js <目录> [--batch]
```

- `gallery.html` 只是主题预览，**不会**自动入库。
- 最终回复含：入库篇数、是否已带专属封面；**不要**默认推微信官方草稿箱。
