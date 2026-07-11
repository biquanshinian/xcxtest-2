/**
 * 兼容旧路径：转发到主包 utils，避免历史 require.async 引用失效
 */
module.exports = require('../../../utils/channels-live-fallback-cache.js')
