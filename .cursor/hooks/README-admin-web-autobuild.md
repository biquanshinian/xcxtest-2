# admin-web 自动构建

## Agent / Tab 改完自动 build
项目已配置 Cursor Hooks（[`.cursor/hooks.json`](../hooks.json)）：
- 编辑 `admin-web/**` → 打 dirty 标记
- Agent 本轮结束（`stop`）→ 若有标记则执行 `npm run build`，产出 `admin-web/dist`

日志：`.cursor/hooks/admin-web-autobuild.log`  
需工作区为 **Trusted**，Hooks 才会执行。可在 Cursor → Hooks 输出通道查看。

## 本地持续监听（改文件立刻重建）
双击仓库根目录 [`监听构建后台.bat`](../../监听构建后台.bat)，或：

```bash
cd admin-web
npm run build:watch
```

## 手动单次构建
双击 [`构建后台.bat`](../../构建后台.bat)，或 `npm run build`（脚本支持 `--nopause`）。
