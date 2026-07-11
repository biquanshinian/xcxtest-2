/**
 * 原子接口公共工具：调用 apiProxy 云函数 + 构造标准返回
 */

/** 调用 apiProxy 的 agent* action，失败抛错由中间件兜底 */
async function callProxy(action, data) {
  const res = await wx.cloud.callFunction({
    name: 'apiProxy',
    data: Object.assign({ action }, data || {})
  })
  return (res && res.result) || {}
}

/** 文本内容块 */
function text(t) {
  return { type: 'text', text: t }
}

/**
 * 失败返回（isError=true 不渲染卡片）：
 * 按最佳实践三段式 —— 陈述事实 + 给出口 + 禁止重复动作
 */
function failResult(fact, exit, forbid) {
  const parts = [fact, exit]
  if (forbid) parts.push(forbid)
  return {
    isError: true,
    content: [text(parts.join(' '))]
  }
}

module.exports = { callProxy, text, failResult }
