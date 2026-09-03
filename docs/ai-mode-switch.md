# 小程序 AI 开发模式 · 一键切换说明

> 微信小程序 AI 开发模式目前处于**内测阶段**，官方不建议把相关配置合入正式版。
> 因此本项目约定：**调试时加回配置，提审前摘除配置**。
> 代码文件（SKILL、云函数）常驻仓库不用动，切换的只有 `app.json` 里的两段 JSON。

---

## 一、涉及哪些东西

| 资产 | 位置 | 提审时是否保留 |
|------|------|----------------|
| 4 个 SKILL 实现（原子接口 + 卡片组件） | `subpackages/agent-skills/` | ✅ 保留（已在 project.config.json `packOptions.ignore` 中忽略；注意：未注册的 subpackages 目录会被算进**主包**，所以必须靠 ignore 排除） |
| 云端数据后端（12 个 `agent*` action） | `cloudfunctions/apiProxy/agent-actions.js` | ✅ 保留（云函数侧无需切换） |
| 全局提示词 / 页面元数据 | `agent-config/AGENTS.md`、`agent-config/page-meta.json` | ✅ 保留 |
| **app.json 的 `agent-skills` 分包声明** | `app.json` → `subPackages` 数组 | ❌ 提审前删除 |
| **app.json 的顶层 `agent` 字段** | `app.json` 顶层 | ❌ 提审前删除 |
| 配置备份（切换的唯一数据源） | `agent-config/app-json-agent-snippet.json` | ✅ 保留，勿删 |

## 二、开启（调试 AI 模式时）

打开 `agent-config/app-json-agent-snippet.json`，把两段配置复制回 `app.json`：

1. **分包**：把 `agentSkillsSubPackage` 这一项加进 `subPackages` 数组（任意位置即可）：

```json
{
  "root": "subpackages/agent-skills",
  "name": "agent-skills",
  "independent": true,
  "pages": []
}
```

2. **agent 字段**：把备份文件里的 `agent` 对象整个复制到 `app.json` 顶层（与 `subPackages`、`preloadRule` 同级）。

2.5 **移除打包忽略**：把 `project.config.json` → `packOptions.ignore` 里 `"subpackages/agent-skills/**"` 这一条临时删掉（提审关闭时再加回来），否则分包内容会被忽略掉。

3. 开发者工具：编译模式切到「**小程序 AI 编译**」，调试基础库 ≥ 3.16.2，重新编译。

4. 验证：对话框问「下次火箭发射任务」，应命中 `launch-tracker` 并返回具体任务和北京时间；
   也可试「B1067 飞了几次」「星舰下次试飞是什么时候」「天宫上现在有谁」。

> 若原子接口报错拿不到数据，先确认 `apiProxy` 云函数为最新部署（需包含 `agent-actions.js`）。

## 三、关闭（提审正式版前）

在 `app.json` 里删掉上面加的两段：

1. `subPackages` 数组里 `"root": "subpackages/agent-skills"` 这一项；
2. 顶层的 `"agent": { ... }` 整个字段。

删完用开发者工具重新编译确认无报错即可提审。
`agent-config/app-json-agent-snippet.json` 是备份源，**不要删**，下次调试直接从它复制。

## 四、给 AI 助手的一句话指令

让 Cursor / Coding Agent 帮忙切换时，直接说：

- 开启：「按 `docs/ai-mode-switch.md` 把 AI 开发模式配置加回 app.json」
- 关闭：「按 `docs/ai-mode-switch.md` 把 AI 开发模式配置从 app.json 摘除，我要提审」

---

*相关文档：`docs/wechat-ai-capability.md`（能力全景与接入背景）*
