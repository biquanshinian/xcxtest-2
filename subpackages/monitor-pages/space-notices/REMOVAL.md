# SPACE_NOTICES_FEATURE — 移除指南

关闭（不删代码）：

1. `utils/space-notices-feature.js` → `CODE_ENABLED = false`
2. 或云库 `global_config.main.enableSpaceNotices = false`

删除整功能（搜 `SPACE_NOTICES_FEATURE`）：

- [ ] `utils/space-notices-feature.js`
- [ ] `cloudfunctions/spaceNotices/` 整目录
- [ ] `subpackages/monitor-pages/space-notices/` 整目录（含 utils/api-space-notices.js、utils/notam-meta.js）
- [ ] `utils/routes.js` 中 `SPACE_NOTICE_LIST` / `SPACE_NOTICE_MAP`
- [ ] `app.json` monitor-pages 里 `space-notices/entry-list`、`space-notices/notice-map`
- [ ] `pages/monitor/monitor.js` / `monitor.wxml` 入口相关
- [ ] 可选：`scripts/_tmp_space_notices_parser_smoke.js`
- [ ] 可选：云库集合 `space_notice_entry`、`space_notice`
