/**
 * station-skill — 小程序 AI「空间站动态」SKILL 入口
 * 隔离 JS 环境：云开发自行 init，代码自包含。
 */
const getSpaceStations = require('./apis/get-space-stations.js')
const getStationCrew = require('./apis/get-station-crew.js')

const skill = wx.modelContext.createSkill('subpackages/agent-skills/station-skill')

let cloudInited = false
skill.use(async (ctx, next) => {
  if (!cloudInited) {
    wx.cloud.init({ env: 'cloud1-9gdqgdt5bfaa20fb', traceUser: false })
    cloudInited = true
  }
  try {
    await next()
  } catch (err) {
    console.error('[station-skill] ' + ctx.name + ' 执行异常:', err)
    throw new Error('原子接口 ' + ctx.name + ' 执行失败（' + ((err && err.message) || '未知错误') + '）。请告知用户服务暂时不可用，稍后重试；不要再以相同参数重复调用本接口。')
  }
})

skill.registerAPI('getSpaceStations', getSpaceStations)
skill.registerAPI('getStationCrew', getStationCrew)
