/**
 * 原子接口公共工具（station-skill 自包含副本，隔离环境不能跨 skill 复用）
 */

async function callProxy(action, data) {
  const res = await wx.cloud.callFunction({
    name: 'apiProxy',
    data: Object.assign({ action }, data || {})
  })
  return (res && res.result) || {}
}

function text(t) {
  return { type: 'text', text: t }
}

function failResult(fact, exit, forbid) {
  const parts = [fact, exit]
  if (forbid) parts.push(forbid)
  return {
    isError: true,
    content: [text(parts.join(' '))]
  }
}

module.exports = { callProxy, text, failResult }
