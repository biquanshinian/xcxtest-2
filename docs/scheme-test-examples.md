# 明文 URL Scheme 测试示例

AppID：`wxf98b58309019771b`  
官方说明：[获取 URL Scheme](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/url-scheme.html)

## 格式（必读）

```text
weixin://dl/business/?appid=APPID&path=PATH&query=QUERY&env_version=ENV
```

| 参数 | 说明 |
|------|------|
| `path` | **不得带 query**；须与公众平台「明文 Scheme 路径」白名单一致 |
| `query` | 单独参数，整段需 `encodeURIComponent`（如 `id=1&type=article` → `id%3D1%26type%3Darticle`） |
| `env_version` | `develop` 开发版 / `trial` 体验版 / `release` 正式版 |

路径白名单见 [`plaintext-scheme-paths.txt`](./plaintext-scheme-paths.txt)。

## 新闻 / 文章详情 `subpackages/news-extra/detail`

### 必填 query

| 键 | 必填 | 说明 |
|----|------|------|
| `id` | 是 | 与列表页 `navigator` 一致；手写稿为 `manual_` + 云库 `_id` |
| `type` | 是 | `article`（文章）或 `event`（航天事件） |

列表内跳转写法（对照用）：

```text
/subpackages/news-extra/detail?id={{item.id}}&type=article
/subpackages/news-extra/detail?id={{item.id}}&type=event
```

### 示例链接

**API 文章**（将 `ARTICLE_NUMERIC_ID` 换成事件页列表里该条目的 `id`）：

```text
weixin://dl/business/?appid=wxf98b58309019771b&path=subpackages/news-extra/detail&query=id%3DARTICLE_NUMERIC_ID%26type%3Darticle&env_version=trial
```

**手写稿**（`id` 形如 `manual_云文档_id`；`manual_` 与下划线无需再编码）：

```text
weixin://dl/business/?appid=wxf98b58309019771b&path=subpackages/news-extra/detail&query=id%3Dmanual_abc123def%26type%3Darticle&env_version=trial
```

**航天事件**：

```text
weixin://dl/business/?appid=wxf98b58309019771b&path=subpackages/news-extra/detail&query=id%3DEVENT_ID%26type%3Devent&env_version=trial
```

### 常见错误

| 错误写法 | 现象 |
|----------|------|
| `path=.../detail?id=1&type=article`（query 写在 path 里） | 可能能进页，但 `id`/`type` 不稳定或缺失 |
| 仅 `query=id%3Dxxx`，未带 `type` | 按 **event** 拉取，文章会失败 |
| `type=article` 但 `id` 为占位符或列表里没有的 id | 标题「文章详情」+「文章详情暂不可用」 |
| 使用 `articleId` 而不写 `id` | 代码已兼容 `articleId` → `id`，仍建议与列表一致用 `id` |

## 任务详情 `pages/mission-detail/mission-detail`

| 键 | 说明 |
|----|------|
| `id` | 发射任务 id |
| `type` | 可选：`upcoming`（默认）/ `completed` |

```text
weixin://dl/business/?appid=wxf98b58309019771b&path=pages/mission-detail/mission-detail&query=id%3DYOUR_LAUNCH_ID&env_version=trial
```

## 开发者工具快速验证（非真 Scheme）

编译模式 → 启动页面 `subpackages/news-extra/detail` → 启动参数：`id=真实id&type=article`

## 如何拿到真实 `id`

1. 打开小程序「事件」页，进入目标文章/事件详情（列表内点击）。
2. 开发者工具 → 调试器 → AppData / 或在 `detail.js` 临时 `console.log` 当前 `id`。
3. 分享卡片路径亦为：`/subpackages/news-extra/detail?id=...&type=article`。
