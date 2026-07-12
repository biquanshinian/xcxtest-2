# B 站图文动态发布 Agent

本机或 VPS 常驻进程：从云端 `bilibili_publish_queue` 领取任务，用 Playwright 模拟发 B 站动态。

## 准备

1. 在云开发环境变量配置 `BILI_AGENT_TOKEN`（≥16 位随机串），与本地一致。
2. 可选：`BILI_TOPIC_AI_BASE` / `BILI_TOPIC_AI_KEY` / `BILI_TOPIC_AI_MODEL`（话题 AI，不配则仅词库命中）。
3. 部署云函数：`adminGateway`、`publishBilibiliFromEvents`。

```bash
cd workers/bilibili-publisher
cp .env.example .env
# 编辑 .env
npm install
npx playwright install chromium
npm run login    # 浏览器扫码登录后回车
npm start        # 常驻轮询
# 或 npm run once
```

## Windows 开机自启（推荐，无黑窗口）

前提：已完成上面的 `.env`、`npm install`、`playwright install`、`npm run login`。

1. 双击 [`install-autostart.bat`](install-autostart.bat)（写入当前用户「启动」文件夹，**一般不需要管理员**）
2. 提示 `Run once now? [Y/N]` 时输入 `Y` 可立刻试跑
3. 之后每次**登录 Windows**会静默启动 Agent，日志在 `logs/agent.log`
4. 取消自启：双击 [`uninstall-autostart.bat`](uninstall-autostart.bat)

> 批处理使用英文提示，避免中文 Windows 下 UTF-8 乱码。不再依赖 `schtasks`（易 Access denied）。

相关文件：

| 文件 | 作用 |
|------|------|
| `start-agent.bat` | 启动并写日志，已运行则跳过 |
| `start-agent-hidden.vbs` | 隐藏控制台窗口调用 bat |
| `install-autostart.bat` | 写入用户「启动」文件夹（无需管理员） |
| `uninstall-autostart.bat` | 删除启动项（及旧版计划任务） |

说明：这是挂在**本机登录后**跑，电脑关机/休眠时不会发帖。若要 24 小时不占你这台电脑，需把同一套目录放到一直开机的 VPS/另一台机器上再装自启。

## 后台操作

1. 「全局配置」→ 打开 **B 站自动发文** 总开关（首次开启会锁定 `syncFromAt=现在`）。
2. 「B站话题词库」→ 导入种子词。
3. 事件更新 / 推文同步产生 `published` 内容后自动入队：
   - 推文同步 `syncSpaceXTweets` 成功发布后会立刻调用入队
   - 后台「发布」事件会立刻调用入队
   - `publishBilibiliFromEvents` 定时触发器每 5 分钟兜底扫库
4. 本 Agent 领取并发布；事件列表可看同步状态。
5. 全局配置可看「上次自动扫库」时间/来源，用于确认定时是否生效。

## 配图规则

- 配图来自事件文档 `mediaList` 中的**自有 COS** 直链（与小程序一致），不是外链、不是头像兜底。
- 每条事件单独发一条 B 站动态，不合并多条事件。
- Agent `npm run demo` 只测上传链路；真实图文请后台入队后 `npm run once`。

## 风控说明

- 默认间隔约 30 分钟 + 抖动，日限 8、时限 2。
- 触发频繁会冷却；登录失效/验证码会自动关总开关并退出进程。
- 自动化发动态属平台灰区，建议先小号试跑。

## 安全

- `.auth/` 与 `.env` 勿提交 git。
- Agent 使用独立 Token，不要把管理员密码放在常驻机上。
