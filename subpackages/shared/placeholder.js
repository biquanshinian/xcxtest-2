// 占位页：无业务入口，仅供分包配置与工具编译
// 打包锚点：demo-engine / demo-scripts 仅被主包薄壳 require.async 引用，
// 无同分包同步引用时会被"过滤无依赖文件"剔出分包导致异步加载失败
require('./utils/demo-engine.js')
require('./utils/demo-scripts.js')
Page({
  onLoad() {}
})
