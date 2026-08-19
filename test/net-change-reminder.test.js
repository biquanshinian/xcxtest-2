/**
 * 改期弹窗扫描：与服务号 launch_data.previousNet / 48h 近窗对齐
 * 运行：node --test test/net-change-reminder.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const store = {}
global.wx = {
  getStorageSync(key) {
    return store[key]
  },
  setStorage({ key, data }) {
    store[key] = data
  }
}

const {
  overlayServerNetChanges,
  scanAndPickTodayReminder,
  markEventShown,
  isEventShown,
  resetNetChangeReminderStorageForTest,
  NET_CHANGE_NEAR_WINDOW_MS
} = require('../subpackages/shared/utils/net-change-reminder.js')
const {
  pickAnnouncableNetChanges,
  isWithinOaNearWindow
} = require('../cloudfunctions/ll2Query/recent-net-changes.js')

const NOW = Date.parse('2026-08-19T08:00:00+08:00')
const OLD_NET = '2026-08-19T10:00:00+08:00'
const NEW_NET = '2026-08-19T14:00:00+08:00'
const FAR_OLD = '2026-09-10T10:00:00+08:00'
const FAR_NEW = '2026-09-12T10:00:00+08:00'

function mission(overrides) {
  return Object.assign(
    {
      id: 'launch-1',
      launchTime: NEW_NET,
      missionName: '第 2 次试飞',
      rocketName: '朱雀三号',
      statusId: 1,
      netPrecision: 'Minute'
    },
    overrides
  )
}

function resetAll() {
  Object.keys(store).forEach((k) => {
    delete store[k]
  })
  resetNetChangeReminderStorageForTest()
}

test('服务端 previousNet：首次见到也出弹窗（不必等本地基线）', () => {
  resetAll()
  const list = overlayServerNetChanges(
    [mission({ launchTime: OLD_NET })],
    [{ id: 'launch-1', launchTime: NEW_NET, previousNet: OLD_NET, statusId: 1, netPrecision: 'Minute' }]
  )
  assert.equal(list[0].launchTime, NEW_NET, '权威新时间覆盖过期列表')
  assert.equal(list[0].previousNet, OLD_NET)
  const payloads = scanAndPickTodayReminder(list, { nowMs: NOW })
  assert.equal(payloads.length, 1)
  assert.equal(payloads[0].oldNet, OLD_NET)
  assert.equal(payloads[0].newNet, NEW_NET)
  assert.equal(payloads[0].changeKind, 'delay')
})

test('列表缺失该任务时仍能用 launch_data 行补一条 stub 弹出', () => {
  resetAll()
  const list = overlayServerNetChanges(
    [],
    [
      {
        id: 'launch-2',
        launchTime: NEW_NET,
        previousNet: OLD_NET,
        missionName: 'Starlink',
        rocketNameZh: '猎鹰9号',
        statusId: 1,
        netPrecision: 'Second'
      }
    ]
  )
  const payloads = scanAndPickTodayReminder(list, { nowMs: NOW })
  assert.equal(payloads.length, 1)
  assert.equal(payloads[0].missionId, 'launch-2')
  assert.match(payloads[0].rocketName, /猎鹰/)
})

test('无服务端行时：首次只记不弹，再次变动才弹', () => {
  resetAll()
  const first = scanAndPickTodayReminder([mission({ launchTime: OLD_NET })], { nowMs: NOW })
  assert.equal(first.length, 0, '首次只建基线')
  const second = scanAndPickTodayReminder([mission({ launchTime: NEW_NET })], { nowMs: NOW })
  assert.equal(second.length, 1)
  assert.equal(second[0].oldNet, OLD_NET)
})

test('已展示过的同一指纹不再弹', () => {
  resetAll()
  const list = overlayServerNetChanges(
    [mission()],
    [{ id: 'launch-1', launchTime: NEW_NET, previousNet: OLD_NET, statusId: 1, netPrecision: 'Minute' }]
  )
  const payloads = scanAndPickTodayReminder(list, { nowMs: NOW })
  assert.equal(payloads.length, 1)
  markEventShown(payloads[0], NOW)
  assert.equal(isEventShown(payloads[0], NOW), true)
  const again = scanAndPickTodayReminder(list, { nowMs: NOW })
  assert.equal(again.length, 0)
})

test('远期改期（原/新都在 48h 外）不弹，与服务号近窗一致', () => {
  resetAll()
  const list = overlayServerNetChanges(
    [mission({ id: 'far', launchTime: FAR_NEW })],
    [{ id: 'far', launchTime: FAR_NEW, previousNet: FAR_OLD, statusId: 1, netPrecision: 'Minute' }]
  )
  const payloads = scanAndPickTodayReminder(list, { nowMs: NOW })
  assert.equal(payloads.length, 0)
  assert.equal(isWithinOaNearWindow(FAR_OLD, FAR_NEW, NOW), false)
  assert.ok(FAR_NEW && Date.parse(FAR_NEW) - NOW > NET_CHANGE_NEAR_WINDOW_MS)
})

test('TBD / 粗精度新时间不弹', () => {
  resetAll()
  const tbd = scanAndPickTodayReminder(
    overlayServerNetChanges(
      [mission({ statusId: 2 })],
      [{ id: 'launch-1', launchTime: NEW_NET, previousNet: OLD_NET, statusId: 2, netPrecision: 'Minute' }]
    ),
    { nowMs: NOW }
  )
  assert.equal(tbd.length, 0)
  const coarse = scanAndPickTodayReminder(
    overlayServerNetChanges(
      [mission({ id: 'c', netPrecision: 'Month' })],
      [{ id: 'c', launchTime: NEW_NET, previousNet: OLD_NET, statusId: 1, netPrecision: 'Month' }]
    ),
    { nowMs: NOW }
  )
  assert.equal(coarse.length, 0)
})

test('列表 NET 已比 launch_data 新：不回写成库内旧时间，仍用 previousNet 出弹窗', () => {
  resetAll()
  const liveNet = '2026-08-19T16:30:00+08:00'
  const list = overlayServerNetChanges(
    [mission({ launchTime: liveNet, statusId: 1 })],
    [{ id: 'launch-1', launchTime: NEW_NET, previousNet: OLD_NET, statusId: 2, netPrecision: 'Month' }]
  )
  assert.equal(list[0].launchTime, liveNet, '保留列表实况 NET')
  assert.equal(list[0].statusId, 1, '不覆盖列表状态')
  assert.equal(list[0].netPrecision, 'Minute', '不覆盖列表精度')
  const payloads = scanAndPickTodayReminder(list, { nowMs: NOW })
  assert.equal(payloads.length, 1)
  assert.equal(payloads[0].oldNet, OLD_NET)
  assert.equal(payloads[0].newNet, liveNet)
})

test('pickAnnouncableNetChanges：已清 pending 仍保留 previousNet 的行可挑出', () => {
  const rows = pickAnnouncableNetChanges(
    [
      {
        _id: 'launch-1',
        launchTime: NEW_NET,
        previousNet: OLD_NET,
        netChangePending: false,
        statusId: 1,
        netPrecision: 'Minute'
      },
      {
        _id: 'far',
        launchTime: FAR_NEW,
        previousNet: FAR_OLD,
        statusId: 1,
        netPrecision: 'Minute'
      }
    ],
    NOW
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'launch-1')
  assert.equal(rows[0].previousNet, OLD_NET)
})
