/**
 * 任务详情页统计：发给云函数的火箭型号名必须是 LL2 的 configuration.name（英文）。
 * 页面上的 mission.rocketName 已被 applyContentLangToMission 换成中文，
 * 直接上报会让云端精确过滤 / 维度缓存全部落空，累计发射与本年发射就成了「—」。
 */

const test = require('node:test')
const assert = require('node:assert')

const { resolveMissionRocketQueryName } = require('../utils/launch-stats-cloud.js')

test('优先用 _langPack 里的英文型号名', () => {
  const name = resolveMissionRocketQueryName({
    rocketName: '猎鹰9号',
    _langPack: { rocketNameEn: 'Falcon 9', rocketNameZh: '猎鹰9号' }
  })
  assert.equal(name, 'Falcon 9')
})

test('无 _langPack 时跳过中文展示名，取 configuration 快照', () => {
  const name = resolveMissionRocketQueryName({
    rocketName: '长征二号丁',
    rocketConfiguration: { name: 'Long March 2D', nameZh: '长征二号丁' }
  })
  assert.equal(name, 'Long March 2D')
})

test('configuration 只有 full_name 时也能用（云端会归一化 Block 后缀）', () => {
  const name = resolveMissionRocketQueryName({
    rocketName: '猎鹰9号',
    rocketConfiguration: { name: '', full_name: 'Falcon 9 Block 5' }
  })
  assert.equal(name, 'Falcon 9 Block 5')
})

test('「未知火箭」不作为查询名', () => {
  assert.equal(resolveMissionRocketQueryName({ rocketName: '未知火箭' }), '')
  assert.equal(
    resolveMissionRocketQueryName({
      rocketName: '未知火箭',
      _langPack: { rocketNameEn: '未知火箭' },
      rocketConfiguration: { name: 'Electron' }
    }),
    'Electron'
  )
})

test('全是中文时仍原样上报，交给云端按 id 回查', () => {
  assert.equal(resolveMissionRocketQueryName({ rocketName: '猎鹰9号' }), '猎鹰9号')
  assert.equal(resolveMissionRocketQueryName({}), '')
  assert.equal(resolveMissionRocketQueryName(null), '')
})

const { pickRocketYearFromBreakdown } = require('../utils/launch-stats-cloud.js')
const {
  resolveRocketAttemptHints,
  applyClientRocketFallback
} = require('../pages/mission-detail/utils/mission-launch-stats.js')

test('待发任务用构型累计 +1 作为型号累计（含本次）', () => {
  const hints = resolveRocketAttemptHints({
    launchTime: '2099-01-01T00:00:00Z',
    rocketConfiguration: { name: 'Falcon 9', total_launch_count: 610 }
  })
  assert.equal(hints.total, 611)
})

test('已发射任务不把构型累计再 +1', () => {
  const hints = resolveRocketAttemptHints({
    launchTime: '2020-01-01T00:00:00Z',
    rocketLaunchAttemptCount: 610
  })
  assert.equal(hints.total, 610)
})

test('云端缺型号计数时用构型累计回填', () => {
  const filled = applyClientRocketFallback(
    { rocketTotal: null, rocketYear: null, providerTotal: 720 },
    {
      launchTime: '2099-01-01T00:00:00Z',
      rocketConfiguration: { name: 'Falcon 9', total_launch_count: 610 }
    }
  )
  assert.equal(filled.rocketTotal, 611)
  assert.equal(filled.providerTotal, 720)
})

test('本年发射可从全球排行 byRocket 回填，待发含本次', () => {
  const year = pickRocketYearFromBreakdown(
    { byRocket: [{ name: 'Falcon 9', total: 100 }] },
    {
      launchTime: '2099-08-20T15:00:00Z',
      _langPack: { rocketNameEn: 'Falcon 9' }
    }
  )
  assert.equal(year, 101)
})

test('byRocket 的 Falcon 9 Block 5 能对上 Falcon 9', () => {
  const year = pickRocketYearFromBreakdown(
    { byRocket: [{ name: 'Falcon 9 Block 5', total: 88 }] },
    {
      launchTime: '2020-01-01T00:00:00Z',
      rocketConfiguration: { name: 'Falcon 9' }
    }
  )
  assert.equal(year, 88)
})
