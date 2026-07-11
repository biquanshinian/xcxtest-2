// utils/single-page.js
// 单页面权限检查工具函数

/**
 * 判断错误是否为权限拒绝错误
 * @param {Object} error 错误对象
 * @returns {Boolean} 是否为权限拒绝错误
 */
function isPermissionDenied(error) {
  if (!error) return false
  const errMsg = String(error.errMsg || error.message || '')
  return errMsg.includes('permission') || errMsg.includes('auth') || errMsg.includes('denied')
}

/**
 * 获取权限拒绝的提示消息
 * @returns {String} 提示消息
 */
function getPermissionDeniedMessage() {
  return '暂无权限访问该数据，请联系管理员'
}

module.exports = {
  isPermissionDenied,
  getPermissionDeniedMessage
}
