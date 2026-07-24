# replay-fetcher — 发射回放/集锦下载 Agent

本机/VPS 常驻进程：轮询 adminGateway 领取任务，用 **yt-dlp** 下载后经预签 URL 直传 COS，
回写 `mission_replays` 集合供小程序「观看回放」卡片使用（仅会员）。

两类任务（队列 `kind` 字段区分）：

| kind | 内容 | 触发条件 | 体积 |
| --- | --- | --- | --- |
| `clip` | 指定博主 **SciNews** 的 2~3 分钟发射集锦（YouTube，覆盖全部发射商） | 该发射无 SpaceX 官方推文集锦时自动入队（默认开，`replayClipAgentEnabled=false` 关） | ≤480p 约 10~25MB/段 |
| `full` | 完整直播回放（官方源优先） | `replayAgentEnabled=true` 才入队（默认关 = 长视频只给外链） | 2h 直播约 400~600MB |

云端扫描与小程序「已完成任务」列表同源（LL2 previous 全发射商），按 launchId 一一对应。

集锦匹配规则（服务端下发 `clipSearch` 线索；Agent 侧 `clip-match.js` 做模糊归一化）：
- 日期必须命中：SciNews 标题或简介固定含 UTC 日期（如 "…, 14 July 2026" / "on 16 July 2026"）。
- 任务段关键词（starlink / spacesail / ms-29…）必须至少命中一个（标题或简介）；
  带数字的特征编号（10-45 / t1tl-e / ms-29 / 火箭型号 10b）存在时必须命中，是同日多发的硬区分。
- **分隔符模糊**：两侧去 `-`/`_`/`/`/空白后再比子串，因此
  `Tianlian-2-06` ↔ `TianLian-2 06`、`Starlink 10-45` ↔ `Starlink 10 45` 都能中。
- 火箭段关键词（falcon / long march…）只加分不作准入；`3B/E` 会展开为 `3b`/`3be`；
  尾缀罗马数字自动扩展变体（Vikram-I ↔ Vikram-1）。
- 对不上宁可不下，避免张冠李戴；没找到视频（可能还没发布）按 2h/4h/6h… 退避重试，最多 6 次。

COS 存储生命周期：`发射回放/` 前缀 30 天自动删除（`POST /replay-agent/ensure-lifecycle` 幂等设置）；
apiProxy 侧发射超 29 天即停发 COS 链接，两边配合不会出现 404。

## 链路

```
syncSpaceDevsData(小时级) → replay_fetch_queue（kind=clip 自动 / kind=full 手动开启）
        ↓ claim
replay-fetcher (本机, yt-dlp ≤480p) → COS 发射回放/集锦/{launchId}.mp4 或 发射回放/{launchId}.mp4
        ↓ complete
mission_replays（合并写 agentClips / videoUrl）→ apiProxy missionReplay → 任务详情页回放卡片
```

## 前置依赖

1. Node ≥ 18.13（内置 fetch + duplex stream）
2. [yt-dlp](https://github.com/yt-dlp/yt-dlp)（`winget install yt-dlp` 或 `pip install -U yt-dlp`）
3. 可选 ffprobe（ffmpeg 套件）：读取时长/分辨率回写，未安装不影响主流程
4. 能访问 YouTube / X 的网络（或配置 `REPLAY_PROXY`）

## 配置

```bash
cp .env.example .env   # 填 REPLAY_ADMIN_API_BASE / REPLAY_AGENT_TOKEN
```

云函数侧需在 adminGateway 环境变量中配置 `REPLAY_AGENT_TOKEN`（≥16 位；
不配置则回退共用 `BILI_AGENT_TOKEN`）。

## 运行

```bash
node src/index.js
```

- 无任务时每 `REPLAY_POLL_MS`（默认 10 分钟）轮询一次；有任务时连续处理。
- 下载失败自动换下一视频源（官方 X 直播 → Spaceflight Now → The Space Devs 转播）；
  全部失败上报 fail，服务端计数 3 次后终态 failed。
- 「压缩」策略 = 只下 ≤480p 源（`REPLAY_MAX_HEIGHT`），不做本地转码，最省 CPU 与 COS 存储。
  2 小时级直播回放 480p 约 400~600MB；星链常规任务回放（~20 分钟）约 80~150MB。

## 管理

- 后台接口：`GET /mission-replays`（队列+成品概览）、`DELETE /mission-replays/:launchId`（删 COS 文件与记录，可重抓）。
- 集锦任务开关：`global_config.main.replayClipAgentEnabled = false` 停止 SciNews 集锦入队（默认开启）。
- 完整回放开关：`global_config.main.replayAgentEnabled = true` 才产生完整回放下载任务（默认关闭）。
- 云端扫描总闸：`global_config.main.replayFetchEnabled = false` 连集锦/外链文档也停止刷新。
- 前端展示开关：`global_config.main.enableMissionReplay`（一键过审会关闭）。
