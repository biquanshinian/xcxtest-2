// 占位页：无业务入口，仅供分包配置与工具编译
// 打包锚点：demo-scripts.js 仅被主包 demo-engine.js require.async 引用，
// 无同分包同步引用时会被"过滤无依赖文件"剔出分包导致异步加载失败
require('./utils/demo-scripts.js')
Page({
  onLoad() {}
})
