/**
 * launch-skill — 小程序 AI「全球航天发射查询」SKILL 入口
 *
 * 运行在微信客户端为原子接口创建的独立 JS 环境（与小程序主环境隔离，
 * 不执行 app.js，也不能 require 主包 utils/），因此：
 *   1. 云开发需在此自行 init（与主程序同一环境 ID）
 *   2. 所有依赖代码均在本 SKILL 目录内自包含
 */
const getUpcomingLaunches = require('./apis/get-upcoming-launches.js')
const getRecentLaunches = require('./apis/get-recent-launches.js')
const getLaunchDetail = require('./apis/get-launch-detail.js')
const getGlobalLaunchStats = require('./apis/get-global-launch-stats.js')
const getAgencyInfo = require('./apis/get-agency-info.js')

const skill = wx.modelContext.createSkill('subpackages/agent-skills/launch-skill')

// ── 中间件：云环境初始化（仅首次）+ 统一错误兜底 ──
let cloudInited = false
skill.use(async (ctx, next) => {
  if (!cloudInited) {
    wx.cloud.init({ env: 'cloud1-9gdqgdt5bfaa20fb', traceUser: false })
    cloudInited = true
  }
  try {
    await next()
  } catch (err) {
    // 原子接口内部未捕获的异常统一转为 LLM 可理解的失败返回，避免整轮对话中断
    console.error('[launch-skill] ' + ctx.name + ' 执行异常:', err)
    throw new Error('原子接口 ' + ctx.name + ' 执行失败（' + ((err && err.message) || '未知错误') + '）。请告知用户服务暂时不可用，稍后重试；不要再以相同参数重复调用本接口。')
  }
})

skill.registerAPI('getUpcomingLaunches', getUpcomingLaunches)
skill.registerAPI('getRecentLaunches', getRecentLaunches)
skill.registerAPI('getLaunchDetail', getLaunchDetail)
skill.registerAPI('getGlobalLaunchStats', getGlobalLaunchStats)
skill.registerAPI('getAgencyInfo', getAgencyInfo)
