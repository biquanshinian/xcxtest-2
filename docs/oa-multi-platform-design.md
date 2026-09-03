# 内容中台多平台发布设计（微信 / 小红书）

> 替代已下线的「B 站自动发文」。核心：**一文进草稿箱 → 运营选择平台与形态 → 预览/编辑 → 选择性发布**。

## 1. 产品原则

1. **不再自动外发**：任何平台都不做无人值守群发；B 站自动动态已移除。
2. **一文多平台**：同一选题/同一素材，拆成各平台「变体」，共享源素材与审核记录。
3. **平台路线不同**：微信走长文 HTML；小红书走竖版种草图文（非公众号排版）。
4. **运营可控**：后台必须能预览 + 编辑；发布按钮分平台、可只发一端。
5. **暗色后台 + 亮色预览**：预览区做「阅读态反色隔离」（白底模拟真实 App），不是 CSS `filter: invert`。

## 2. 信息架构（后台）

侧栏「公众号内容」升级为 **「内容中台」**（权限仍用 `oa_content`）：

| 菜单 | 作用 |
|------|------|
| 流水线 | 选题 / 洗稿生成 / 成品导入（不洗稿） |
| 草稿箱 | **多平台工作台**（默认页） |
| 提示词 / 策略 | 可按 `channel: wechat \| xhs` 分策略 |
| 资产库 | 对标账号、爆文、标题（可共用） |
| 发稿设置 | 品牌、微信凭证、小程序 CTA；后续加小红书导出规范 |

### 草稿箱布局（推荐）

```
┌ 列表：标题 | 来源 | 平台状态徽章(微信/小红书) | 操作 ─┐
└────────────────────────────────────────────────────┘
编辑弹窗（宽屏）：
┌ 元信息：发稿号 / 标题 / 摘要 / 封面 ───────────────┐
├ Tab【源稿】【微信】【小红书】                     │
│  源稿：Markdown 共用素材                           │
│  微信：主题芯片 + 左 MD / 右「白底公众号预览」      │
│  小红书：标题/正文/话题/置顶评 + 「竖版 3:4 手机框」│
├ 底栏：转存配图 | 推微信 | 导出小红书包 | 保存      │
└────────────────────────────────────────────────────┘
```

平台状态徽章示例：`微信·草稿` / `微信·已推` / `小红书·可导出` / `未生成变体`。

## 3. 数据模型

在 `oa_drafts` 上扩展（不破坏现有微信字段）：

```js
{
  // 现有：title, markdown, html, themeId, coverUrl, imageUrls, wxMediaId, status, ...

  platforms: ['wechat', 'xhs'],          // 运营勾选要发的端
  variants: {
    wechat: {
      title, digest, markdown, html, themeId,
      status: 'draft|ready|pushed|published|failed',
      wxMediaId, wxPublishId, imagesReady
    },
    xhs: {
      title,            // ≤20 字推荐
      body,             // 口语种草，短段
      topics: [],       // 话题 8–15
      pinnedComment,    // 置顶评论
      images: [],       // 有序竖图 URL（3:4）
      coverIndex: 0,
      status: 'draft|ready|exported|failed',
      exportPackageUrl  // 可选：COS 上的 zip
    }
  },
  // 兼容期：顶层微信字段与 variants.wechat 双写，逐步收敛
}
```

## 4. 平台路线

### 4.1 微信公众号（已有）

- 形态：长文 + 主题 HTML + 小程序 CTA  
- 动作：转存配图 → 推微信草稿箱 → 确认发稿  
- 预览：白底 `.preview-frame`（已实现）

### 4.2 小红书种草图文（新建）

**规格（对齐现有 skill / 投放文档）：**

- 画幅：竖版 **3:4**，通常 3～9 张  
- 结构：封面钩子 → 信息/对比 → 产品/场景 → CTA（站内，禁站外导流话术）  
- 文案：口语、短句、话题标签；标题候选 2～3 个  
- 合规：不写第三方平台引流；观礼类注意场站×火箭对齐  

**发布动作（现实约束）：**

- 官方开放发笔记 API 不稳定/不可用时，**Phase 1：导出发布包**  
  - `note.md` + `01.jpg…`（3:4）+ 话题清单  
  - 运营用官方 App / 创作者工具粘贴上传  
- Phase 2：若拿到可靠开放能力或自建 RPA，再接 `push-xhs`（与微信同级按钮）

**从微信稿生成 XHS 变体：**

- `POST /oa-content/drafts/:id/derive-xhs`  
  - 输入：源 markdown + 图  
  - 输出：短标题、种草正文、话题、建议切图位（可人工改）  
  - **不自动发布**

### 4.3（可选）未来其它平台

统一挂在 `variants.<platform>` + `platforms[]`，预览组件按平台注册（白底长文 / 竖版手机 / …）。

## 5. API 草图

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/oa-content/drafts/import` | 成品入库（已有，不洗稿） |
| POST | `/oa-content/preview` | 微信主题预览（已有） |
| POST | `/oa-content/preview-xhs` | 返回结构化笔记 + 图序，供手机框渲染 |
| PUT | `/oa-content/drafts/:id` | 允许写 `variants.*` / `platforms` |
| POST | `/oa-content/drafts/:id/derive-xhs` | 从源稿生成小红书变体 |
| POST | `/oa-content/drafts/:id/export-xhs` | 打包竖图 + note 到 COS |
| POST | `/oa-content/drafts/:id/push` | 仅微信（现有） |

## 6. 预览「反色」规范（后台 UI）

后台全局为暗色（`--cx-*` / `html.dark`）。**预览区禁止继承暗色正文色。**

| 预览类型 | 容器 | 说明 |
|----------|------|------|
| 微信 | 白底 `#fff`，字色 `#222`，圆角卡片 | 模拟公众号阅读 |
| 小红书 | 浅灰画布 + 白色手机框 + 3:4 幻灯 | 模拟 App 笔记 |
| 编辑区 | 仍用暗色表单控件 | 与预览对比清晰 |

实现要点：

- 预览根节点强制 `color-scheme: light; background:#fff; color:#222`  
- 图片仍走 `proxyOaImage` 破防盗链  
- 不要用整页 `filter: invert()`  

## 7. 与写作技能的衔接

- `oa-update-log`：更新日志 → **import 微信成品** → 运营可选 derive 小红书短版  
- `xhs-watch-party-merchant`：观礼种草仍可独立出图；成熟后「导入为 xhs variant」挂到同一草稿  

## 8. 落地分期

| 期 | 内容 |
|----|------|
| **P0（本次）** | 拆除 B 站自动发文全链路；保留直播观看 |
| **P1（已实现）** | 草稿箱 Tab：源稿 / 微信 / 小红书；`variants.xhs` 存盘；竖版预览 + 导出包；侧栏「内容中台」 |
| **P2** | derive-xhs 提示词增强；策略按 channel |
| **P3** | 若有开放接口再接自动发笔记；状态机与微信对称 |

## 9. 运维收尾（B 站下线后）

自动化入口（部署 `adminGateway` 后）：

1. 冷启动自动跑 `bilibiliDecommission`（幂等）  
2. `POST /replay-agent/decommission-bilibili`（Bearer `REPLAY_AGENT_TOKEN`）  
3. `POST /ops/decommission-bilibili-publish`（管理员 + `global_config`）  

动作：禁用并标记 `global_config/bilibili_auto_publish`；清空 `bilibili_publish_queue` / topic 集合；尝试 SCF 删触发器与函数。  
线上 `publishBilibiliFromEvents` 已删除；集合与 `global_config/bilibili_auto_publish` 已由 `bilibiliDecommission` 收尾。  
复跑：`node scripts/ops-decommission-bilibili.js [--force]`。  
`BILI_AGENT_TOKEN` 仅当 replay-agent 仍依赖回退时暂留。
