---
name: admin-web-deploy
description: >-
  构建火星探索日志后台 admin-web 并推送到云开发静态托管，按需更新 adminGateway。
  当用户说「构建推送」「后台构建」「推送托管」「推静态托管」「更新后台」「部署后台」「推送云函数」时使用。
  不是小程序上传，也不是 git push。
---

# 后台构建推送

用户说「构建推送」= **Vite 出 dist → CloudBase 静态托管**；改了网关再更新 **adminGateway**。

`构建后台.bat` 只出 dist，**不会**上托管。

**禁止**自己拼 `tcb` 命令。在仓库根目录跑本技能脚本（不要并行开两份）。

```bash
node .cursor/skills/admin-web-deploy/scripts/deploy.js
```

常用参数：

| 参数 | 作用 |
| --- | --- |
| （无） | 构建 + 托管；`adminGateway` 有改动则一并更新 |
| `--fn` | 强制更新云函数 |
| `--no-fn` | 只托管，不更新云函数 |
| `--skip-build` | 已有 dist，只推送 |
| `--audit` | 先跑图文单测 + `scripts/_tmp_audit_tuwen_yewu.js` |

图文 / `tuwenYewu` / 订单复制等改动：先 `--audit`，通过再推。

## 环境（不要改）

- 环境 ID：`cloud1-9gdqgdt5bfaa20fb`
- 托管地址：`https://cloud1-9gdqgdt5bfaa20fb-1397421562.tcloudbaseapp.com`
- 后台 API：`https://cloud1-9gdqgdt5bfaa20fb-1397421562.ap-shanghai.app.tcloudbase.com/admin`

## 脚本已处理的坑（不要再踩）

1. **不是 git push**，也不是微信开发者工具上传小程序。未要求提交就不要 `git commit`。
2. PowerShell 不要用 `&&`；用脚本即可。
3. 两个 `tcb` **不要并行**（会各要一次登录，卡死）。
4. `tcb fn code update` 必须 `--json`，否则会停在 `Please select an action`。
5. **禁止**把 `cloudfunctions/adminGateway/node_modules` 打进去：COS 会 60 秒超时；ZIP 会超 1.5MB。脚本只拷源码到临时目录再传。
6. **禁止**把 `cloudbaserc.json` 留在仓库根目录。
7. 登录失效时脚本会打出授权链接；等用户在浏览器授权后 **再跑一遍同一条命令**，不要另开一套流程。
8. 根 `index.html` 只有入口 chunk。验收看本地 `dist/index.html` 的 `index-*.js` 是否已出现在托管页，不要在首页 HTML 里搜懒加载页面名。

## 改了什么才更云函数

这些情况更新 `adminGateway`（脚本看工作区 diff；**本轮改过网关就加 `--fn`**，已提交会漏）：

- `cloudfunctions/adminGateway/**`（尤其 `tuwenYewu.js`、`index.js`）
- 用户明确说推云函数

只改 `admin-web/src/**` 的 UI → 默认只托管。

## 回复用户

写清：审计是否跑过、构建是否成功、托管 URL、云函数更没更新。提醒强制刷新 / 无痕；CDN 可能要几分钟。
