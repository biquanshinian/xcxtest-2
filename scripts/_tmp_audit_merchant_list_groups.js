/* 临时校验：merchant-list 按任务分组/排序 + 火箭名中文适配（vm 加载真实页面文件） */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const rocketNameZhMod = require(path.join(__dirname, '../subpackages/watch-party/utils/rocket-name-zh.js'))

const src = fs.readFileSync(path.join(__dirname, '../subpackages/watch-party/merchant-list.js'), 'utf8')
const sandbox = {
  require: (p) => {
    const s = String(p)
    if (s.indexOf('rocket-name-zh') >= 0) return rocketNameZhMod
    if (s.indexOf('util.js') >= 0) return { getRocketImage: () => '' }
    return {}
  },
  Page: () => {},
  module: { exports: {} },
  console,
  wx: {}
}
vm.createContext(sandbox)
vm.runInContext(src, sandbox)

const { buildMissionGroups, missionKeyOf, missionTitleOf } = sandbox
const { rocketNameZh } = rocketNameZhMod
let failed = 0
function check(name, cond) {
  if (!cond) { failed++; console.log('FAIL', name) } else { console.log('ok  ', name) }
}

// ── 火箭名中文适配 ──
check('Long March 7A → 长征七号改', rocketNameZh('Long March 7A') === '长征七号改')
check('Long March 2D → 长征二号丁', rocketNameZh('Long March 2D') === '长征二号丁')
check('Long March 2C → 长征二号丙', rocketNameZh('Long March 2C') === '长征二号丙')
check('Long March 2F → 长征二号F', rocketNameZh('Long March 2F') === '长征二号F')
check('Long March 3B/E → 长征三号乙改', rocketNameZh('Long March 3B/E') === '长征三号乙改')
check('Long March 5B → 长征五号B', rocketNameZh('Long March 5B') === '长征五号B')
check('Long March 6A → 长征六号改', rocketNameZh('Long March 6A') === '长征六号改')
check('Long March 8A → 长征八号甲', rocketNameZh('Long March 8A') === '长征八号甲')
check('Long March 11H → 长征十一号海射型', rocketNameZh('Long March 11H') === '长征十一号海射型')
check('Long March 12 → 长征十二号', rocketNameZh('Long March 12') === '长征十二号')
check('CZ-7A 别名同样命中', rocketNameZh('CZ-7A') === '长征七号改')
check('ZhuQue-3 → 朱雀三号', rocketNameZh('ZhuQue-3') === '朱雀三号')
check('ZhuQue-2E → 朱雀二号改', rocketNameZh('ZhuQue-2E') === '朱雀二号改')
check('Ceres-1 → 谷神星一号', rocketNameZh('Ceres-1') === '谷神星一号')
check('Gravity-1 → 引力一号', rocketNameZh('Gravity-1') === '引力一号')
check('Kuaizhou-1A → 快舟一号甲', rocketNameZh('Kuaizhou-1A') === '快舟一号甲')
check('Smart Dragon 3 → 捷龙三号', rocketNameZh('Smart Dragon 3') === '捷龙三号')
check('Kinetica 1 → 力箭一号', rocketNameZh('Kinetica 1') === '力箭一号')
check('Hyperbola-1 → 双曲线一号', rocketNameZh('Hyperbola-1') === '双曲线一号')
check('Tianlong-3 → 天龙三号', rocketNameZh('Tianlong-3') === '天龙三号')
// 国外火箭不做中文适配（观礼只发生在境内），一律原样显示
check('Falcon 9 Block 5 原样返回', rocketNameZh('Falcon 9 Block 5') === 'Falcon 9 Block 5')
check('Falcon Heavy 原样返回', rocketNameZh('Falcon Heavy') === 'Falcon Heavy')
check('Starship V3 Flight 12 原样返回', rocketNameZh('Starship V3 Flight 12') === 'Starship V3 Flight 12')
check('Electron 原样返回', rocketNameZh('Electron') === 'Electron')
check('已是中文原样返回', rocketNameZh('朱雀三号') === '朱雀三号')
check('未识别名原样返回', rocketNameZh('Vega C') === 'Vega C')
check('空值返回空串', rocketNameZh('') === '')

// ── 场景 1：截图案例——两个不同任务的商家混在一个列表 ──
const mixed = [
  { sessionId: 's1', missionId: 'A', rocketName: 'Long March 7A', missionName: 'Unknown Payload', launchTime: '2026-08-10T20:00:00+08:00', launchTimeText: '8月10日 20:00' },
  { sessionId: 's2', missionId: 'B', rocketName: 'ZhuQue-3', missionName: 'ZhuQue-3 Test Flight', missionDisplayName: '测试朱雀三号', launchTime: '2026-08-11T07:45:00+08:00', launchTimeText: '8月11日 07:45' }
]
const g1 = buildMissionGroups(mixed)
check('混排拆成 2 组', g1.length === 2)
check('发射窗口早的任务在前', g1[0].key === 'm:A' && g1[1].key === 'm:B')
check('组标题 = 火箭中文名（不带任务名）', g1[0].title === '长征七号改')
check('朱雀组标题也是中文火箭名', g1[1].title === '朱雀三号')
check('组内商家归属正确', g1[0].sessions.length === 1 && g1[0].sessions[0].sessionId === 's1')
check('组发射窗口文案', g1[0].launchTimeText === '8月10日 20:00')
check('组日期短文案', g1[0].dateText === '8月10日')

// ── 场景 2：同任务多商家 → 单组（单任务入口行为不变） ──
const single = [
  { sessionId: 's1', missionId: 'A', rocketName: 'Long March 7A', missionName: 'X', launchTime: '2026-08-10T20:00:00+08:00' },
  { sessionId: 's2', missionId: 'A', rocketName: 'Long March 7A', missionName: 'X', launchTime: '2026-08-10T20:00:00+08:00' }
]
const g2 = buildMissionGroups(single)
check('同任务两商家 → 1 组', g2.length === 1 && g2[0].sessions.length === 2)
check('单组标题为中文火箭名', g2[0].title === '长征七号改')

// ── 场景 3：老数据无 missionId → 按 火箭+任务名 兜底分组 ──
const legacy = [
  { sessionId: 's1', rocketName: 'R1', missionName: 'M1' },
  { sessionId: 's2', rocketName: 'R1', missionName: 'M1' },
  { sessionId: 's3', rocketName: 'R2', missionName: 'M2', launchTime: '2026-08-09T08:00:00+08:00' }
]
const g3 = buildMissionGroups(legacy)
check('无 id 按名字分组', g3.length === 2)
check('有发射时间的组排前，无时间殿后', g3[0].key === 'n:R2|M2')
check('missionKey 兜底格式', missionKeyOf(legacy[0]) === 'n:R1|M1')

// ── 场景 4：无任务信息 / 无火箭名的兜底 ──
const none = [{ sessionId: 's1' }]
const g4 = buildMissionGroups(none)
check('无任务信息归 none 组', g4.length === 1 && g4[0].key === 'none')
check('none 组标题兜底', g4[0].title === '未关联发射任务')
check('无火箭名但有商家中文任务名 → 用中文任务名', missionTitleOf({ missionDisplayName: '神舟二十一号' }) === '神舟二十一号')
check('missionTitleOf 空对象兜底', missionTitleOf({}) === '未关联发射任务')

// ── 场景 5：无效 launchTime 不炸 ──
const bad = [
  { sessionId: 's1', missionId: 'A', rocketName: 'R', missionName: 'M', launchTime: 'not-a-date' },
  { sessionId: 's2', missionId: 'B', rocketName: 'R2', missionName: 'M2', launchTime: '2026-08-12T00:00:00+08:00' }
]
const g5 = buildMissionGroups(bad)
check('无效时间的组殿后', g5.length === 2 && g5[0].key === 'm:B')

// ── 场景 6：同型火箭两个任务 → 组不合并，标题相同靠日期消歧 ──
const sameRocket = [
  { sessionId: 's1', missionId: 'A', rocketName: 'Long March 7A', launchTime: '2026-08-10T20:00:00+08:00', launchTimeText: '8月10日 20:00' },
  { sessionId: 's2', missionId: 'B', rocketName: 'Long March 7A', launchTime: '2026-08-20T09:00:00+08:00', launchTimeText: '8月20日 09:00' }
]
const g6 = buildMissionGroups(sameRocket)
check('同型火箭不同任务仍分 2 组', g6.length === 2)
check('两组标题相同（中文）', g6[0].title === '长征七号改' && g6[1].title === '长征七号改')
check('日期短文案可用于消歧', g6[0].dateText === '8月10日' && g6[1].dateText === '8月20日')

console.log(failed ? `\n${failed} 项未通过` : '\n全部通过')
process.exit(failed ? 1 : 0)
