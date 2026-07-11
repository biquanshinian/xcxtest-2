# 主包体积与依赖规则（防回归）

## 硬性限制（微信）

| 规则 | 说明 |
|------|------|
| 主包 ≤ 1.5MB | 代码质量扫描上限 1536KB |
| 目标 ≤ 1.4MB | 留 ~100KB 编译余量 |
| 主包 **禁止** `require()` 分包 JS | 会编译失败或扫描报错 |
| 主包页面 **可以** `usingComponents` + `componentPlaceholder` 引用分包组件 | Tab 页标准做法 |
| 分包 **可以** `require()` 主包 `utils/` | 单向依赖 |
| Tab 页必须在 `app.json` 的 `pages` 数组 | 不可挪到分包 |

## 主包应保留的 utils（Tab / app.js 同步依赖）

以下模块被五个 Tab 页、`app.js` 或主包 `components/` **顶层 sync require**，必须留在 `utils/`：

- `landing-icons.js` — `api-launch-list.js` / 首页列表
- `aiService.js` — `app.js`、`components/nasa-float`
- `checkin.js` / `space-quiz.js` — 我的 Tab、`app.js`
- `api-news.js` — 事件 Tab
- 以及 `api-*`、`index-*`、`membership`、`routes` 等核心链

**不要**把这些完整实现挪到分包后在主包留空壳——主包不能 `require` 分包回引。

## 应放在分包的 utils（仅分包组件/页面使用）

| 文件 | 位置 |
|------|------|
| `http-request.js` | `subpackages/shared/utils/`（nasa-data、space-explore、monitor-pages 分包 HTTP 封装） |
| `demo-scripts.js` | `subpackages/shared/utils/`（`demo-engine.js` 通过 `require.async` 加载） |
| `index-calendar-page.js` | `subpackages/index-extra/utils/`（首页发射日历 Tab，`require.async` 委托） |
| `channels-live.js` | `subpackages/shared/utils/` |
| `channels-live-config-cache.js` | `subpackages/shared/utils/` |
| `official-account-scene.js` | `subpackages/shared/utils/` |
| `artemis-arow.js` | `subpackages/monitor-pages/utils/` |
| `starbase-weather.js` | `subpackages/monitor-pages/utils/` |

监控 Tab 通过 `require.async('../../subpackages/monitor-pages/utils/...')` 加载 Artemis/天气，**不要**在主包 sync require。

## 分包组件 placeholder 清单

每个使用 `subpackages/shared` 组件的 **Tab 页** json 必须有对应 `componentPlaceholder`：

- `pages/index/index.json` — morning-briefing, ai-chat, demo-overlay, share-guide, official-account-bar, official-account-publish-panel
- `pages/monitor/monitor.json` — ai-chat, demo-overlay, share-guide, channels-live-panel
- `pages/progress/progress.json` — ai-chat, demo-overlay, share-guide
- `pages/news/news.json` — ai-chat, demo-overlay, share-guide
- `pages/profile/profile.json` — milestone-egg, morning-briefing, ai-chat, demo-overlay

## 体积自检

```bash
node scripts/_analyze_size_node.js
node scripts/_verify_main_package.js
```

`packOptions.ignore` 与 `scripts/_analyze_size_node.js` 的 ignore 列表需保持一致。

## 常见回归

1. **Unused JS**：主包 `utils/` 存在仅被分包引用的文件 → 移到分包并删主包副本
2. **Cross-subpackage sync require**：主包 `require('subpackages/...')` → 改用 `require.async` 或把消费者挪到分包
3. **JSON BOM**：保存 UTF-8 无 BOM；用 `_verify_main_package.js` 检查
4. **错误相对路径**：`utils/` 内互相引用用 `./foo.js`，不要用 `../../../utils/`
5. **7 个 Tab 依赖 utils 来回搬**：checkin/aiService 等必须在主包；分包用 re-export 或 `require('../../../utils/...')` 读主包

## 2026-06-09 一次性修复摘要

- 移出主包：`channels-live*`、`official-account-scene`、`artemis-arow`、`starbase-weather`（约 32KB 源码）
- 监控页 Artemis/天气改为 `require.async` 分包加载
- 修复 `checkin.js` / `space-quiz.js` 错误 `../../../utils/` 路径

## 2026-06-09 二次修复（Unused JS + 主包仍超限）

### http-request.js

- **问题**：微信扫描报 `utils/http-request.js` 在主包但主包 Tab 未引用（仅分包 nasa-data / space-explore / monitor-pages 使用）
- **处理**：整文件迁至 `subpackages/shared/utils/http-request.js`，更新 5 处引用，删除主包 `utils/http-request.js`
- **与 api-request.js 关系**：无重复；`api-request.js` 仍留主包供 Tab 页 API 模块使用

### 主包进一步瘦身（约 43KB）

| 改动 | 约节省 |
|------|--------|
| 首页发射日历逻辑 → `subpackages/index-extra/utils/index-calendar-page.js` + `require.async` 委托 | ~32KB（index.js 162→131KB） |
| `demo-scripts.js` → 分包 + `demo-engine` 异步加载 | ~7KB |
| 日历专用 helper 从 `index-mission-services/state.js` 迁入日历分包 | ~3KB |
| 删除主包 `utils/http-request.js` | ~4KB |

主包 Tab 页 **禁止** sync `require` 分包路径；日历通过 `delegateCalendar()` + `require.async` 加载，首次进入日历 Tab 或预加载时 attach。

## 2026-06-09 三次修复（编译后主包仍 >1.5MB，源码仅 1276KB）

### 根因：代码加固（code_obfuscation_config.json）膨胀主包

- **现象**：源码主包 ~1276KB，但微信扫描「主包大小」仍超 1.5MB。源码 < 编译，反常。
- **定位**：`code_obfuscation_config.json` 开启加固，且把 **主包文件** 列入加固名单：`app.js`、`pages/monitor/monitor.js`（61KB）、`utils/config.js`、`utils/cos-url.js`。代码加固（字符串数组化、控制流平坦化、僵尸代码注入）**只会放大**编译产物（常见 1.5–4 倍），是编译后主包超限的主因。
- **额外问题**：名单含已失效路径——`utils/api.js`(已 ignore)、`utils/starlink-pass.js`、`utils/starlink-renderer.js`、`utils/aiSearch.js`、`pages/search/aiService.js`（文件已移入分包或不存在）。
- **处理**：重写 `code_obfuscation_config.json`，**仅保留分包敏感算法文件**加固（maps / AR / starlink，均在 `subpackages/`，不计入主包）。主包文件一律不加固。
- **依赖链/文件结构零改动**：未移动任何文件、未改任何 `require`/`require.async`，因此不会引入主包→分包同步引用，五个 Tab 与 require.async 链全部不受影响。

### 验证结论（本次）

- `node scripts/_reach.js`（一次性脚本，已删）：从 app.js + 5 Tab + 主包 components 出发，主包 52 个 utils **全部可达**，无「未引用 utils」可外移。
- npm 大库 `satellite.js`(512KB)、`pinyin-pro`(907KB) 均在分包（`monitor-pages/libs`、`pages/search/miniprogram_npm`），不计入主包。
- 主包图片仅 57.7KB（最大 `nasa-logo.png` 17.8KB，nasa-float 组件使用），无大图可压。
- 故本次**不做有风险的源码外移**，仅去除主包加固即可显著降低编译后体积。

### 防回归

> **禁止把主包文件加入 `code_obfuscation_config.json`。** 加固只增不减体积。仅分包内敏感算法（轨道/地图/AR）可加固。
