/**
 * 主包薄壳：AI 实现已下沉 subpackages/shared/utils/aiService.js
 * app / search 等通过 require.async 加载；shared 内组件请直接 require 分包路径。
 */
const AI_SERVICE_PKG = '../subpackages/shared/utils/aiService.js'

let _modPromise = null
function loadAiService() {
  if (!_modPromise) {
    _modPromise = require.async(AI_SERVICE_PKG)
  }
  return _modPromise
}

function warmAIChatEnabledAsync() {
  loadAiService()
    .then(function (m) { return m.warmAIChatEnabledAsync() })
    .catch(function () {})
}

function isAIChatEnabledSync() {
  // 未加载前默认 true，与原模块「失败放开」语义一致；加载后以真值为准
  return true
}

function isAIAvailable() {
  return !!(wx.cloud && typeof wx.cloud.extend === 'function')
}

async function fetchAIChatEnabled() {
  const m = await loadAiService()
  return m.fetchAIChatEnabled()
}

async function streamChat() {
  const m = await loadAiService()
  return m.streamChat.apply(m, arguments)
}

async function generateTextAdvanced() {
  const m = await loadAiService()
  return m.generateTextAdvanced.apply(m, arguments)
}

async function answerQuestion() {
  const m = await loadAiService()
  return m.answerQuestion.apply(m, arguments)
}

module.exports = {
  isAIAvailable,
  streamChat,
  QUICK_QUESTIONS: [],
  answerQuestion,
  generateTextAdvanced,
  fetchAIChatEnabled,
  isAIChatEnabledSync,
  warmAIChatEnabledAsync,
  loadAiService
}
