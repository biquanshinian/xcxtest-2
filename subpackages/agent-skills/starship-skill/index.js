/**
 * starship-skill — 小程序 AI「星舰进度追踪」SKILL 入口
 *
 * 运行在隔离 JS 环境（不执行 app.js、不能 require 主包代码），
 * 云开发自行 init，依赖代码在本目录内自包含。
 */
const getStarshipStatus = require('./apis/get-starship-status.js')
const getStarshipUpdates = require('./apis/get-starship-updates.js')
const getStarshipNextFlight = require('./apis/get-starship-next-flight.js')
const getRoadClosures = require('./apis/get-road-closures.js')

const skill = wx.modelContext.createSkill('subpackages/agent-skills/starship-skill')

let cloudInited = false
skill.use(async (ctx, next) => {
  if (!cloudInited) {
    wx.cloud.init({ env: 'cloud1-9gdqgdt5bfaa20fb', traceUser: false })
    cloudInited = true
  }
  try {
    await next()
  } catch (err) {
    console.error('[starship-skill] ' + ctx.name + ' 执行异常:', err)
    throw new Error('原子接口 ' + ctx.name + ' 执行失败（' + ((err && err.message) || '未知错误') + '）。请告知用户服务暂时不可用，稍后重试；不要再以相同参数重复调用本接口。')
  }
})

skill.registerAPI('getStarshipStatus', getStarshipStatus)
skill.registerAPI('getStarshipUpdates', getStarshipUpdates)
skill.registerAPI('getStarshipNextFlight', getStarshipNextFlight)
skill.registerAPI('getRoadClosures', getRoadClosures)
