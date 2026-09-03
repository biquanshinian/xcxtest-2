/**
 * 示范单测：utils/api-booster-extract.js（零依赖纯函数）
 * 运行：node --test test/   或   npm test
 *
 * 覆盖高风险解析逻辑：发射商提取、可回收判定、缓存解包、超时包装、
 * 以及助推器/着陆信息提取与可回收推断兜底。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  extractBoosterInfoForList,
  extractBoosterInfoSimple,
  isRecoverable,
  extractLaunchAgency,
  unwrapCacheData,
  withTimeout
} = require('../utils/api-booster-extract.js')

test('extractLaunchAgency：优先取 launch_service_provider', () => {
  const out = extractLaunchAgency({
    launch_service_provider: { name: 'SpaceX', id: 121, abbrev: 'SpX' }
  })
  assert.equal(out.launchAgency, 'SpaceX')
  assert.equal(out.launchAgencyId, 121)
  assert.equal(out.launchAgencyAbbrev, 'SpX')
})

test('extractLaunchAgency：回退到 program.agencies', () => {
  const out = extractLaunchAgency({
    program: [{ agencies: [{ name: 'NASA', id: 44, abbrev: 'NASA' }] }]
  })
  assert.equal(out.launchAgency, '美国国家航空航天局')
  assert.equal(out.launchAgencyId, 44)
})

test('isRecoverable：有真实着陆信息且非推断 → true', () => {
  assert.equal(isRecoverable({ landingType: 'ASDS' }), true)
  assert.equal(isRecoverable({ landingLocation: 'OCISLY' }), true)
})

test('isRecoverable：推断回收 / 空对象 / null → false', () => {
  assert.equal(isRecoverable({ inferredRecovery: true, landingType: 'RTLS' }), false)
  assert.equal(isRecoverable({}), false)
  assert.equal(isRecoverable(null), false)
})

test('unwrapCacheData：解包嵌套 data.data.results', () => {
  const out = unwrapCacheData({ data: { data: { results: [1, 2] } } })
  assert.deepEqual(out, { results: [1, 2] })
})

test('unwrapCacheData：无包装时原样返回', () => {
  const out = unwrapCacheData({ results: [1] })
  assert.deepEqual(out, { results: [1] })
})

test('withTimeout：在超时前 resolve 透传结果', async () => {
  const out = await withTimeout(Promise.resolve(42), 1000)
  assert.equal(out, 42)
})

test('withTimeout：超时则 reject', async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 10, '超时了'),
    /超时了/
  )
})

test('extractBoosterInfoForList：从 launcher_stage 解析 ASDS 着陆', () => {
  const launch = {
    name: 'Starlink',
    rocket: {
      launcher_stage: [
        { serial_number: 'B1062', landing: { landing_location: { abbrev: 'OCISLY' } } }
      ]
    }
  }
  const info = extractBoosterInfoForList(launch, 'Falcon 9', 'img.png')
  assert.equal(info.serialNumber, 'B1062')
  assert.equal(info.landingType, 'ASDS')
  assert.equal(info.landingLocation, 'OCISLY')
  assert.equal(isRecoverable(info), true)
})

test('extractBoosterInfoSimple：可回收火箭名 → 推断 RTLS', () => {
  const info = extractBoosterInfoSimple({ rocket: {} }, 'Starship', 'img.png')
  assert.equal(info.landingType, 'RTLS')
  assert.equal(info.inferredRecovery, true)
  // 推断出来的回收不应被当作"已确认可回收"
  assert.equal(isRecoverable(info), false)
})

test('构型级 reusable：无 stage 数据也判定可回收（长十乙网系回收场景）', () => {
  const launch = {
    name: 'Long March 10B | Demo Flight',
    rocket: { configuration: { name: 'Long March 10B', reusable: true } }
  }
  const info = extractBoosterInfoForList(launch, 'Long March 10B', 'img.png')
  assert.equal(info.configReusable, true)
  assert.equal(isRecoverable(info), true)
})

test('构型级 reusable：本次任务明确不尝试着陆（landing.attempt=false）→ 不判定可回收', () => {
  const launch = {
    name: 'Expendable Falcon 9',
    rocket: {
      configuration: { name: 'Falcon 9', reusable: true },
      launcher_stage: [{ serial_number: 'B1058', landing: { attempt: false } }]
    }
  }
  const info = extractBoosterInfoForList(launch, 'Falcon 9', 'img.png')
  assert.notEqual(info && info.configReusable, true)
  assert.equal(isRecoverable(info), false)
})

const { extractRecoveryIcons, inferNetRecoveryFromLaunch, buildLandingIcon } = require('../utils/landing-icons.js')

test('网系回收：长十乙构型（reusable + 型号名）→ netRecovery 标记与图标', () => {
  const launch = {
    name: 'Long March 10B | Demo Flight',
    rocket: { configuration: { name: 'Long March 10B', full_name: 'Long March 10B', reusable: true } }
  }
  assert.equal(inferNetRecoveryFromLaunch(launch), true)
  const info = extractBoosterInfoForList(launch, 'Long March 10B', 'img.png')
  assert.equal(info.netRecovery, true)
  assert.ok(String(info.netRecoveryIcon).startsWith('data:image/svg+xml'))
  // 无 stage 数据时列表卡片兜底出网系回收图标（中性色）
  const icons = extractRecoveryIcons(launch, 'upcoming')
  assert.equal(icons.length, 1)
  assert.equal(icons[0].type, 'NET_CATCH')
  assert.equal(icons[0].status, 'neutral')
})

test('网系回收：非网系可复用火箭（描述/型号不匹配）→ 不出网系图标', () => {
  const launch = {
    name: 'Some Rocket | Mission',
    rocket: { configuration: { name: 'Some Rocket', reusable: true } }
  }
  assert.equal(inferNetRecoveryFromLaunch(launch), false)
  const icons = extractRecoveryIcons(launch, 'upcoming')
  assert.equal(icons.length, 0)
})

test('网系回收：LL2 将来给出结构化 Net 着陆类型 → 自动走结构化链路（含结果色）', () => {
  const launch = {
    name: 'Long March 10B | Flight 2',
    rocket: {
      configuration: { name: 'Long March 10B', reusable: true },
      launcher_stage: [{ serial_number: 'Y2', landing: { type: { abbrev: 'Net', name: 'Arrestor Net Barge' }, success: true } }]
    }
  }
  const icons = extractRecoveryIcons(launch, 'completed')
  assert.equal(icons.length, 1)
  assert.equal(icons[0].type, 'NET_CATCH')
  assert.equal(icons[0].status, 'success')
  // 成功 → 绿色填充
  assert.ok(icons[0].icon.includes('rgb(34,197,94)'))
})

test('buildLandingIcon：NET_CATCH 模板按状态着色', () => {
  assert.ok(buildLandingIcon('NET_CATCH', 'failure').includes('rgb(249,115,22)'))
  assert.ok(buildLandingIcon('NET_CATCH', 'neutral').includes('rgb(255,255,255)'))
})

test('LL2 着陆词表全集映射：10 种类型都有归一化结果且不误判', () => {
  const { normalizeLandingTypeShort } = require('../utils/landing-icons.js')
  assert.equal(normalizeLandingTypeShort('ASDS'), 'ASDS')
  assert.equal(normalizeLandingTypeShort('RTLS'), 'RTLS')
  assert.equal(normalizeLandingTypeShort('Ocean'), 'SPLASHDOWN')
  assert.equal(normalizeLandingTypeShort('EXP'), 'EXPENDED')
  assert.equal(normalizeLandingTypeShort('ATM'), 'EXPENDED')          // 再入烧毁
  assert.equal(normalizeLandingTypeShort('Destructive Reentry'), 'EXPENDED')
  assert.equal(normalizeLandingTypeShort('VL'), 'VL')                 // 垂直着陆
  assert.equal(normalizeLandingTypeShort('Vertical Landing'), 'VL')
  assert.equal(normalizeLandingTypeShort('HL'), 'HL')                 // 水平着陆
  assert.equal(normalizeLandingTypeShort('Horizontal Landing'), 'HL')
  assert.equal(normalizeLandingTypeShort('PCL'), 'RECOVERY')          // 伞降
  assert.equal(normalizeLandingTypeShort('Parachute Landing'), 'RECOVERY')
  assert.equal(normalizeLandingTypeShort('PFL'), 'RECOVERY')          // 翼伞
  assert.equal(normalizeLandingTypeShort('Parafoil Landing'), 'RECOVERY')
  // 直升机捕获不能被 CATCH 关键词误判成塔架捕获
  assert.equal(normalizeLandingTypeShort('HC'), 'HELICOPTER_CATCH')
  assert.equal(normalizeLandingTypeShort('Helicopter Catch'), 'HELICOPTER_CATCH')
  assert.equal(normalizeLandingTypeShort('Tower Catch'), 'TOWER_CATCH')
  // 有图标模板兜底：VL/HC/RECOVERY/HL 都能出图标
  assert.ok(buildLandingIcon('VL', 'success'))
  assert.ok(buildLandingIcon('HELICOPTER_CATCH', 'neutral'))
  assert.ok(buildLandingIcon('RECOVERY', 'success'))
  assert.ok(buildLandingIcon('HL', 'neutral'))
})

test('倒计时图标对齐：EXPENDED（一次性使用）→ 橙色 dataURI 图标', () => {
  const launch = {
    name: 'Falcon 9 Block 5 | MRV-1',
    rocket: {
      launcher_stage: [{
        serial_number: 'B1069',
        reused: true,
        landing: {
          attempt: false,
          success: null,
          description: 'The Falcon 9 booster B1069 will be expended during its 32nd mission.',
          landing_location: { id: 6, name: 'Atlantic Ocean', abbrev: 'ATL' },
          type: { id: 8, name: 'Expended', abbrev: 'EXP' }
        }
      }]
    }
  }
  const info = extractBoosterInfoForList(launch, 'Falcon 9', 'img.png')
  assert.equal(info.landingType, 'EXPENDED')
  assert.equal(info.landingLocation, 'ATL')
  // 倒计时区域要有图标（与详情页同源），且与详情页同为失败橙色
  assert.ok(String(info.landingTypeIcon).startsWith('data:image/svg+xml'))
  assert.ok(info.landingTypeIcon.includes('rgb(249,115,22)'))
  assert.equal(info.landingTypeIconStatus, 'failure')
})

test('倒计时图标对齐：SPLASHDOWN / HL 也有中性色图标', () => {
  const mk = (type) => ({
    rocket: {
      launcher_stage: [{
        serial_number: 'X1',
        landing: { type: { abbrev: type }, landing_location: { abbrev: 'PAC', name: 'Pacific Ocean' } }
      }]
    }
  })
  const sd = extractBoosterInfoForList(mk('SD'), 'Rocket', 'img.png')
  assert.equal(sd.landingType, 'SPLASHDOWN')
  assert.ok(sd.landingTypeIcon.includes('rgb(255,255,255)'))
  const hl = extractBoosterInfoForList(mk('HL'), 'Rocket', 'img.png')
  assert.equal(hl.landingType, 'HL')
  assert.ok(hl.landingTypeIcon.includes('rgb(255,255,255)'))
})

test('倒计时图标对齐：结构化 NET_CATCH → netRecoveryIcon 分支（保留 --net 放大样式）', () => {
  const launch = {
    rocket: {
      launcher_stage: [{
        serial_number: 'Y2',
        landing: { type: { abbrev: 'Net', name: 'Arrestor Net Barge' } }
      }]
    }
  }
  const info = extractBoosterInfoForList(launch, 'Long March 10B', 'img.png')
  assert.equal(info.landingType, 'NET_CATCH')
  assert.equal(info.netRecovery, true)
  assert.ok(String(info.netRecoveryIcon).startsWith('data:image/svg+xml'))
  // 不走通用 landingTypeIcon 分支，避免 WXML 双图标
  assert.equal(info.landingTypeIcon, undefined)
})

test('倒计时图标对齐：ASDS/RTLS 仍走 WXML 静态 SVG 兜底（不挂 dataURI）', () => {
  const launch = {
    rocket: {
      launcher_stage: [{ serial_number: 'B1062', landing: { landing_location: { abbrev: 'OCISLY' } } }]
    }
  }
  const info = extractBoosterInfoForList(launch, 'Falcon 9', 'img.png')
  assert.equal(info.landingType, 'ASDS')
  assert.equal(info.landingTypeIcon, undefined)
})

test('构型级 reusable：与真实着陆数据共存时不冲突', () => {
  const launch = {
    name: 'Starlink',
    rocket: {
      configuration: { name: 'Falcon 9', reusable: true },
      launcher_stage: [{ serial_number: 'B1062', landing: { landing_location: { abbrev: 'OCISLY' } } }]
    }
  }
  const info = extractBoosterInfoForList(launch, 'Falcon 9', 'img.png')
  assert.equal(info.landingType, 'ASDS')
  assert.equal(info.configReusable, true)
  assert.equal(isRecoverable(info), true)
})
