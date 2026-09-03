/**
 * 观礼新特性冒烟（内存 mock tcb db）
 * 覆盖：商家多场次、任务显示名（第一个入驻商家可改）、现场照片/视频、
 *       双微信群码（兼容旧单字段）、车辆预约小程序短链、配置图锁定、入驻申请自动通过
 * 运行：node scripts/_tmp_smoke_wp_new_features.js
 */
const { createWatchPartyApi } = require('../cloudfunctions/adminGateway/watchParty.js')

const CMD = {
  neq: (v) => ({ __cmd: 'neq', v }),
  lt: (v) => ({ __cmd: 'lt', v }),
  gt: (v) => ({ __cmd: 'gt', v }),
  in: (arr) => ({ __cmd: 'in', arr }),
  inc: (v) => ({ __cmd: 'inc', v }),
  or: (arr) => ({ __cmd: 'or', arr }),
  addToSet: (v) => ({ __cmd: 'addToSet', v }),
  pull: (v) => ({ __cmd: 'pull', v })
}

const store = {}
let autoId = 1

function matchCond(doc, cond) {
  if (cond && cond.__cmd === 'or') return cond.arr.some((c) => matchCond(doc, c))
  return Object.keys(cond).every((k) => {
    const expect = cond[k]
    const actual = doc[k]
    if (expect && typeof expect === 'object' && expect.__cmd) {
      if (expect.__cmd === 'neq') return actual !== expect.v
      if (expect.__cmd === 'lt') return actual < expect.v
      if (expect.__cmd === 'gt') return actual > expect.v
      if (expect.__cmd === 'in') return expect.arr.indexOf(actual) >= 0
    }
    if (Array.isArray(actual)) return actual.indexOf(expect) >= 0
    return actual === expect
  })
}

function applyUpdate(doc, data) {
  Object.keys(data).forEach((k) => {
    const v = data[k]
    const parts = k.split('.')
    let obj = doc
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {}
      obj = obj[parts[i]]
    }
    const last = parts[parts.length - 1]
    if (v && typeof v === 'object' && v.__cmd === 'inc') {
      obj[last] = (Number(obj[last]) || 0) + v.v
    } else if (v && typeof v === 'object' && v.__cmd === 'addToSet') {
      if (!Array.isArray(obj[last])) obj[last] = []
      if (obj[last].indexOf(v.v) < 0) obj[last].push(v.v)
    } else if (v && typeof v === 'object' && v.__cmd === 'pull') {
      if (Array.isArray(obj[last])) obj[last] = obj[last].filter((x) => x !== v.v)
    } else {
      obj[last] = v
    }
  })
}

function collection(name) {
  if (!store[name]) store[name] = []
  const docs = store[name]

  function makeQuery(cond) {
    let _skip = 0
    let _limit = Infinity
    const q = {
      where: (c) => makeQuery(c),
      orderBy: () => q,
      skip: (n) => { _skip = n; return q },
      limit: (n) => { _limit = n; return q },
      field: () => q,
      get: async () => ({ data: docs.filter((d) => matchCond(d, cond)).slice(_skip, _skip + _limit).map((d) => ({ ...d })) }),
      count: async () => ({ total: docs.filter((d) => matchCond(d, cond)).length }),
      update: async ({ data }) => {
        const hits = docs.filter((d) => matchCond(d, cond))
        hits.forEach((d) => applyUpdate(d, data))
        return { stats: { updated: hits.length } }
      }
    }
    return q
  }

  return {
    where: (cond) => makeQuery(cond),
    orderBy: () => makeQuery({}),
    limit: (n) => makeQuery({}).limit(n),
    count: async () => ({ total: docs.length }),
    get: async () => ({ data: docs.map((d) => ({ ...d })) }),
    add: async ({ data }) => {
      const _id = data._id || `auto_${autoId++}`
      if (docs.some((d) => d._id === _id)) throw new Error('duplicate _id')
      docs.push({ ...data, _id })
      return { _id }
    },
    doc: (id) => ({
      get: async () => {
        const d = docs.find((x) => x._id === id)
        if (!d) throw new Error('not found')
        return { data: { ...d } }
      },
      update: async ({ data }) => {
        const d = docs.find((x) => x._id === id)
        if (!d) return { stats: { updated: 0 } }
        applyUpdate(d, data)
        return { stats: { updated: 1 } }
      },
      remove: async () => {
        const i = docs.findIndex((x) => x._id === id)
        if (i >= 0) docs.splice(i, 1)
        return {}
      }
    })
  }
}

const api = createWatchPartyApi({
  db: { collection },
  _: CMD,
  ok: (data) => ({ code: 0, data }),
  fail: (code, message) => ({ code, message }),
  now: () => Date.now(),
  writeOpLog: async () => {},
  cloud: {},
  checkPerm: () => null
})

const admin = { username: 'tester', role: 'super_admin' }
let passed = 0
let failed = 0

function assert(name, cond, extra) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}`, extra != null ? JSON.stringify(extra) : '')
  }
}

async function main() {
  // 过审总闸（failClosed）
  await collection('global_config').add({ data: { _id: 'main', enableWatchParty: true } })

  console.log('── 入驻申请：提交即自动通过 ──')
  const badLead = await api.applyMerchantLead({ name: '龙楼观礼楼', contactName: '陈老板', phone: '123' }, 'boss-1')
  assert('手机号校验', badLead.code === 4001, badLead)

  const lead1 = await api.applyMerchantLead({
    name: '龙楼观礼楼', contactName: '陈老板', phone: '13900000001', location: '文昌龙楼镇'
  }, 'boss-1')
  assert('提交即自动入驻（带商家编号）',
    lead1.code === 0 && lead1.data.autoApproved && lead1.data.merchantId && /^[A-Z0-9]{8}$/.test(lead1.data.merchantCode || ''),
    lead1)
  const midA = lead1.data.merchantId

  const me1 = await api.merchantMe('boss-1')
  assert('申请人微信已自动绑定进商家中心',
    me1.code === 0 && me1.data.merchant.name === '龙楼观礼楼' && me1.data.merchant.merchantCode === lead1.data.merchantCode,
    me1)

  const dupOpenid = await api.applyMerchantLead({ name: '再来一个', contactName: '陈老板', phone: '13900000002' }, 'boss-1')
  assert('已绑定微信重复申请被拒', dupOpenid.code === 4002, dupOpenid)
  const dupPhone = await api.applyMerchantLead({ name: '换微信来', contactName: '陈老板', phone: '13900000001' }, 'boss-x')
  assert('已入驻手机号重复申请被拒', dupPhone.code === 4002, dupPhone)

  const leads = await api.listMerchantLeads(admin, { status: 'approved' })
  assert('申请记录直接是已通过状态', leads.code === 0 && leads.data.total === 1 && leads.data.list[0].merchantId === midA, leads.data)

  console.log('── 商家多场次 ──')
  const s1 = await api.merchantCreateSession({
    title: '八月第一场', missionId: 'll2-100', missionName: 'Satellite Internet Group 06',
    rocketName: '长征八号', rocketImageName: '长征八号',
    launchTime: new Date(Date.now() + 24 * 3600e3).toISOString()
  }, 'boss-1')
  assert('建第 1 场', s1.code === 0, s1)
  const s2 = await api.merchantCreateSession({
    title: '八月第二场', missionId: 'll2-200', rocketName: '长征十二号',
    launchTime: new Date(Date.now() + 72 * 3600e3).toISOString()
  }, 'boss-1')
  assert('同商家可建第 2 场', s2.code === 0, s2)

  let limitHit = null
  for (let i = 0; i < 9; i++) {
    limitHit = await api.merchantCreateSession({ title: `批量场次${i}` }, 'boss-1')
  }
  assert('第 11 场被拒（上限 10）', limitHit && limitHit.code === 4002, limitHit)
  const meMulti = await api.merchantMe('boss-1')
  assert('商家中心返回 10 场', meMulti.code === 0 && meMulti.data.sessions.length === 10, meMulti.data && meMulti.data.sessions.length)

  console.log('── 新字段：照片/视频/双群码/短链/配置图锁定 ──')
  const sid1 = s1.data.id
  const upd = await api.merchantUpdateSession(sid1, {
    title: '八月第一场', missionId: 'll2-100', missionName: 'Satellite Internet Group 06',
    rocketName: '手动改的火箭名', rocketImageName: '长征八号',
    launchTime: new Date(Date.now() + 24 * 3600e3).toISOString(),
    status: 'open', enabled: true,
    wechatGroupQrs: [
      'cloud://env.bucket/watch_party/wechat_qr/qr1.png',
      'cloud://env.bucket/watch_party/wechat_qr/qr2.png',
      'cloud://env.bucket/watch_party/wechat_qr/qr3.png'
    ],
    sitePhotos: Array.from({ length: 10 }, (_, i) => `cloud://env.bucket/watch_party/site_photos/p${i}.jpg`).concat(['javascript:bad']),
    siteVideo: 'cloud://env.bucket/watch_party/site_video/v.mp4',
    siteVideoPoster: 'cloud://env.bucket/watch_party/site_video/v.jpg',
    vehicleBookingUrl: '#小程序://车辆预约/AbCdEf123'
  }, 'boss-1')
  assert('新字段保存', upd.code === 0, upd)

  const pub1 = (await api.getPublicSession({ sessionId: sid1 })).data
  assert('群码最多 2 张', pub1.wechatGroupQrs.length === 2, pub1.wechatGroupQrs)
  assert('旧字段兼容取第一张', pub1.wechatGroupQr === 'cloud://env.bucket/watch_party/wechat_qr/qr1.png', pub1.wechatGroupQr)
  assert('现场照片截断到 8 张并过滤非法地址', pub1.sitePhotos.length === 8, pub1.sitePhotos.length)
  assert('视频与封面透出', !!pub1.siteVideo && !!pub1.siteVideoPoster, { v: pub1.siteVideo, p: pub1.siteVideoPoster })
  assert('小程序短链原样保留', pub1.vehicleBookingUrl === '#小程序://车辆预约/AbCdEf123', pub1.vehicleBookingUrl)
  assert('配置图匹配名锁定（火箭名手改不影响）',
    pub1.rocketImageName === '长征八号' && pub1.rocketName === '手动改的火箭名', pub1)

  // 部分更新（不带新字段）不清空
  await api.merchantUpdateSession(sid1, {
    title: '只改标题', missionId: 'll2-100', missionName: 'Satellite Internet Group 06',
    rocketName: '手动改的火箭名',
    launchTime: new Date(Date.now() + 24 * 3600e3).toISOString(),
    status: 'open', enabled: true
  }, 'boss-1')
  const pubKeep = (await api.getPublicSession({ sessionId: sid1 })).data
  assert('未提交字段保持不变',
    pubKeep.sitePhotos.length === 8 && pubKeep.wechatGroupQrs.length === 2
    && !!pubKeep.siteVideo && pubKeep.rocketImageName === '长征八号'
    && pubKeep.vehicleBookingUrl === '#小程序://车辆预约/AbCdEf123',
    pubKeep)

  // 旧数据兼容：库里只有单字段 wechatGroupQr 时数组视图并入
  await collection('watch_party_sessions').doc(sid1).update({
    data: { wechatGroupQrs: [], wechatGroupQr: 'cloud://env.bucket/legacy_qr.png' }
  })
  const pubLegacy = (await api.getPublicSession({ sessionId: sid1 })).data
  assert('旧单字段群码兼容为数组', pubLegacy.wechatGroupQrs.length === 1 && pubLegacy.wechatGroupQrs[0] === 'cloud://env.bucket/legacy_qr.png', pubLegacy.wechatGroupQrs)

  console.log('── 任务显示名 ──')
  const mn0 = await api.merchantGetMissionName({ missionId: 'll2-100' }, 'boss-1')
  assert('第一个入驻商家有命名权', mn0.code === 0 && mn0.data.editable === true, mn0)
  const mnSet = await api.merchantSetMissionDisplayName({ missionId: 'll2-100', displayName: '卫星互联网低轨06组' }, 'boss-1')
  assert('设置任务显示名', mnSet.code === 0, mnSet)

  const pubNamed = (await api.getPublicSession({ sessionId: sid1 })).data
  assert('公开详情带显示名', pubNamed.missionDisplayName === '卫星互联网低轨06组', pubNamed.missionDisplayName)
  const listNamed = await api.listPublicSessions({ missionId: 'll2-100' })
  assert('公开列表带显示名',
    listNamed.code === 0 && listNamed.data.missionDisplayName === '卫星互联网低轨06组'
    && listNamed.data.list[0].missionDisplayName === '卫星互联网低轨06组',
    listNamed.data)
  const meNamed = (await api.merchantMe('boss-1')).data.sessions.find((s) => s.sessionId === sid1)
  assert('商家中心带显示名与命名权', meNamed.missionDisplayName === '卫星互联网低轨06组' && meNamed.missionNameEditable === true, meNamed)

  // 第二个商家（后入驻）在同任务下建场次 → 无命名权
  const lead2 = await api.applyMerchantLead({
    name: '淇水湾民宿', contactName: '王老板', phone: '13900000003'
  }, 'boss-2')
  assert('第二商家自动入驻', lead2.code === 0 && lead2.data.autoApproved, lead2)
  const s2b = await api.merchantCreateSession({
    title: '淇水湾观礼', missionId: 'll2-100', missionName: 'Satellite Internet Group 06',
    rocketName: '长征八号',
    launchTime: new Date(Date.now() + 24 * 3600e3).toISOString()
  }, 'boss-2')
  assert('第二商家同任务建场次', s2b.code === 0, s2b)
  const mnPeer = await api.merchantGetMissionName({ missionId: 'll2-100' }, 'boss-2')
  assert('第二商家可见显示名但不可改',
    mnPeer.code === 0 && mnPeer.data.displayName === '卫星互联网低轨06组' && mnPeer.data.editable === false,
    mnPeer)
  const mnDeny = await api.merchantSetMissionDisplayName({ missionId: 'll2-100', displayName: '越权改名' }, 'boss-2')
  assert('第二商家改名被拒', mnDeny.code === 4030, mnDeny)

  const mnClear = await api.merchantSetMissionDisplayName({ missionId: 'll2-100', displayName: '' }, 'boss-1')
  assert('第一商家留空清除显示名', mnClear.code === 0 && mnClear.data.displayName === '', mnClear)
  const pubCleared = (await api.getPublicSession({ sessionId: sid1 })).data
  assert('清除后公开详情不再带显示名', !pubCleared.missionDisplayName, pubCleared.missionDisplayName)

  console.log('── 车辆预约短链校验 ──')
  const badLink = await api.merchantUpdateSession(sid1, {
    title: '只改短链', missionId: 'll2-100', rocketName: '长征八号',
    launchTime: new Date(Date.now() + 24 * 3600e3).toISOString(),
    status: 'open', enabled: true,
    vehicleBookingUrl: 'javascript:alert(1)'
  }, 'boss-1')
  const pubBadLink = (await api.getPublicSession({ sessionId: sid1 })).data
  assert('非法链接被清空', badLink.code === 0 && pubBadLink.vehicleBookingUrl === '', pubBadLink.vehicleBookingUrl)

  console.log('── 亮点角标 / 联系电话 / 预约核销码 ──')
  const pubPhone = (await api.getPublicSession({ sessionId: sid1 })).data
  assert('联系电话创建时兜底商家入驻手机号', pubPhone.contactPhone === '13900000001', pubPhone.contactPhone)
  assert('亮点角标默认空（客户端用默认文案）', pubPhone.heroBadge === '', pubPhone.heroBadge)

  await api.merchantUpdateSession(sid1, {
    title: '只改角标', missionId: 'll2-100', rocketName: '长征八号',
    launchTime: new Date(Date.now() + 24 * 3600e3).toISOString(),
    status: 'open', enabled: true,
    heroBadge: '楼顶正对工位 · 直线约1.2km',
    contactPhone: '0898-6355 888x8'
  }, 'boss-1')
  const pubBadge = (await api.getPublicSession({ sessionId: sid1 })).data
  assert('亮点角标保存并透出', pubBadge.heroBadge === '楼顶正对工位 · 直线约1.2km', pubBadge.heroBadge)
  assert('联系电话清洗非法字符', pubBadge.contactPhone === '0898-63558888', pubBadge.contactPhone)

  const rsv = await api.reserve({ sessionId: sid1, name: '小明', phone: '13800000001', headcount: 3 }, 'cust-1')
  assert('顾客预约成功', rsv.code === 0 && !!rsv.data.reservationId, rsv)
  const mine = (await api.getMyReservation('cust-1', { sessionId: sid1 })).data
  assert('我的预约带核销码', !!mine && /^[A-Z0-9]{1,6}$/.test(mine.checkinCode || ''), mine)
  const walkList = await api.merchantListReservations('boss-1', { sessionId: sid1 })
  assert('商家名单带同一核销码',
    walkList.code === 0 && walkList.data.list.length === 1 && walkList.data.list[0].checkinCode === mine.checkinCode,
    walkList.data && walkList.data.list)

  console.log('── 商家自助改入驻资料 ──')
  const meBefore = (await api.merchantMe('boss-1')).data.merchant
  assert('商家中心返回入驻联系信息',
    meBefore.contactName === '陈老板' && meBefore.contactPhone === '13900000001',
    meBefore)
  const profBad = await api.merchantUpdateProfile({ name: '' }, 'boss-1')
  assert('名称必填', profBad.code === 4001, profBad)
  const profDup = await api.merchantUpdateProfile({ name: '龙楼观礼楼', contactPhone: '13900000003' }, 'boss-1')
  assert('改成其他商家手机号被拒', profDup.code === 4002, profDup)
  const prof = await api.merchantUpdateProfile({
    name: '龙楼观礼楼·旗舰店', contactName: '陈总', contactPhone: '13900001111', address: '文昌市龙楼镇滨海路 8 号'
  }, 'boss-1')
  assert('更新入驻资料成功', prof.code === 0 && prof.data.name === '龙楼观礼楼·旗舰店', prof)
  const meAfter = (await api.merchantMe('boss-1')).data.merchant
  assert('商家中心回读新资料',
    meAfter.name === '龙楼观礼楼·旗舰店' && meAfter.contactName === '陈总' &&
      meAfter.contactPhone === '13900001111' && meAfter.address === '文昌市龙楼镇滨海路 8 号',
    meAfter)
  const pubRenamed = (await api.getPublicSession({ sessionId: sid1 })).data
  assert('改名同步到已有场次（顾客页商家名）', pubRenamed.merchantName === '龙楼观礼楼·旗舰店', pubRenamed.merchantName)

  console.log('── 预约截止（发射前30分钟）与同商家多场次 ──')
  const s2bId = s2b.data.id
  const nearLaunch = await api.merchantCreateSession({
    title: '临窗加场', missionId: 'll2-300', missionName: 'Near Window',
    rocketName: '长征八号',
    launchTime: new Date(Date.now() + 20 * 60e3).toISOString()
  }, 'boss-2')
  assert('临近发射场次可创建', nearLaunch.code === 0, nearLaunch)
  const nearId = nearLaunch.data.id
  const nearPub = (await api.getPublicSession({ sessionId: nearId })).data
  assert('详情带 reserveCloseAt = 发射-30min',
    nearPub.reserveCloseAt === Date.parse(nearPub.launchTime) - 30 * 60e3,
    nearPub.reserveCloseAt)
  const lateRsv = await api.reserve({ sessionId: nearId, name: '小迟', phone: '13800000002', headcount: 1 }, 'cust-2')
  assert('T-30 内预约被云端拒绝', lateRsv.code === 4002 && /截止/.test(lateRsv.message || ''), lateRsv)
  const okRsv = await api.reserve({ sessionId: s2bId, name: '小早', phone: '13800000003', headcount: 2 }, 'cust-3')
  assert('远窗口场次仍可预约', okRsv.code === 0, okRsv)
  const others1 = (await api.getPublicSession({ sessionId: sid1 })).data.merchantOtherSessions
  assert('详情返回同商家其他场次（10 场 → 9 条，不含自身）',
    Array.isArray(others1) && others1.length === 9 && !others1.some((s) => s.sessionId === sid1),
    others1 && others1.length)
  const others2b = (await api.getPublicSession({ sessionId: s2bId })).data.merchantOtherSessions
  assert('第二商家详情带另一场（含状态与截止时间）',
    others2b.length === 1 && others2b[0].sessionId === nearId && others2b[0].status === 'open' && others2b[0].reserveCloseAt > 0,
    others2b)
  const othersTbd = others1.filter((s) => !s.launchTime)
  assert('待定场次不自动截止（reserveCloseAt=0）',
    othersTbd.length > 0 && othersTbd.every((s) => s.reserveCloseAt === 0),
    othersTbd.length)

  console.log('── 商家奖品库（多场次一键导入模板）──')
  const presetBad = await api.merchantSavePrizePresets({ prizes: [{ name: '无图奖品', image: 'ftp://bad' }] }, 'boss-1')
  assert('全部非法项被拒（提示补名称照片）', presetBad.code === 4001, presetBad)
  const presetSave = await api.merchantSavePrizePresets({
    prizes: [
      { name: '火箭模型', image: 'cloud://env.bucket/watch_party/prizes/a.png', stock: 3, valueYuan: 99 },
      { name: '  ', image: 'cloud://env.bucket/watch_party/prizes/skip.png' },
      { name: '贴纸', image: 'https://cdn.example.com/sticker.png', stock: 0, valueYuan: '' }
    ]
  }, 'boss-1')
  assert('保存奖品库（无名项过滤、stock 兜底 1）', presetSave.code === 0 && presetSave.data.count === 2, presetSave)
  const mePreset = (await api.merchantMe('boss-1')).data.merchant
  assert('商家中心带出奖品库（不含库存运行时字段）',
    mePreset.prizePresets.length === 2 &&
      mePreset.prizePresets[0].name === '火箭模型' && mePreset.prizePresets[0].stock === 3 &&
      mePreset.prizePresets[0].valueYuan === 99 && mePreset.prizePresets[0].remaining === undefined &&
      mePreset.prizePresets[0].id === undefined &&
      mePreset.prizePresets[1].stock === 1 && mePreset.prizePresets[1].valueYuan === null,
    mePreset.prizePresets)
  const many = Array.from({ length: 25 }, (_, i) => ({ name: `奖品${i}`, image: 'cloud://env.bucket/p.png' }))
  const presetMany = await api.merchantSavePrizePresets({ prizes: many }, 'boss-1')
  assert('超量截断到 20 件', presetMany.code === 0 && presetMany.data.count === 20, presetMany.data && presetMany.data.count)
  const presetClear = await api.merchantSavePrizePresets({ prizes: [] }, 'boss-1')
  assert('传空数组 = 清空奖品库', presetClear.code === 0 && presetClear.data.count === 0, presetClear)
  const meCleared = (await api.merchantMe('boss-1')).data.merchant
  assert('清空后回读为空数组', Array.isArray(meCleared.prizePresets) && meCleared.prizePresets.length === 0, meCleared.prizePresets)

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('测试异常:', e)
  process.exit(1)
})
