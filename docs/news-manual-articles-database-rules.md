# `news_articles` 小程序读权限说明

小程序在「航天事件」列表中会 **优先通过云函数 `userDataGateway`**（`action: getNewsManualForApp`）在**服务端**读取 `global_config` 与 `news_articles`，再在端上合并 Spaceflight News API 数据；仅在云函数不可用时回退为客户端直连数据库（受安全规则限制）。

请在微信云开发控制台 **部署云函数**：

- **`userDataGateway`**：必须部署（手写稿列表/详情服务端读取）；
- **`adminGateway`**：后台保存手写开关与镜像 `main.newsManualArticlesEnabled` 时需为最新。

**数据库安全规则：** 部署 `userDataGateway` 后列表以云函数读库为主，**一般不必**再为小程序开放 `news_articles` / `global_config`；未部署云函数时的直连兜底仍受规则影响。

`news_manual_config` 与可选的 **`main.newsManualArticlesEnabled`** 由管理端保存；云函数会读取 `news_manual_config.enabled`，并兼容 `main` 上的镜像字段。

**部署 `adminGateway` 新版本后**（可选）：在后台再保存一次手写开关，可把 `newsManualArticlesEnabled` 写入 `global_config/main`。

## 发布后列表里暂时看不到？

1. **必须点到「航天事件」**：默认子页是「即将发生」，手写稿只合并在「航天事件」里。
2. **总开关**：控制台中 `global_config` 的 `news_manual_config.enabled` 应为 `true`（后台保存开关即可）。
3. **文章已发布**：草稿（发布=否）不会在客户端 `where({ published: true })` 中出现。
4. **下拉刷新**：若仍怀疑缓存，请在新闻页切到「航天事件」后**下拉刷新**；当前逻辑在切换至「航天事件」时会清掉该 tab 的旧本地缓存并重拉云端。
5. **云函数**：若列表仍无手写稿，请确认已上传部署 **`userDataGateway`**，并在手机端真机调试查看 `callFunction getNewsManualForApp` 是否报错（如未找到函数、环境不一致）。
6. **关于时间**：`publishedAt` 仅用于展示排序与格式化，**不会因日期为未来而过滤**手写稿。
