/**
 * 结算/直播共用判定：首页、结算分包、任务详情同一套，避免「飞行中(6) 能否落库」分叉。
 */
const config = require('./config.js')
const { isTerminalStatusId } = require('./api-request.js')

function getLiveFinderUserNameFromConfig() {
  const cfg = (config && config.channelsLive) || {}
  return String(cfg.finderUserName || '').trim()
}

/** 可落历史并切下一个：终态(3/4/7/9) 或飞行中(6) */
function isSettleableLiveStatusId(id) {
  const n = id != null ? Number(id) : 0
  return isTerminalStatusId(n) || n === 6
}

module.exports = {
  getLiveFinderUserNameFromConfig,
  isSettleableLiveStatusId
}
