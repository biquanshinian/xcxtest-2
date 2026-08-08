/**
 * 观礼服务云端逻辑冒烟测试（内存 mock tcb db）
 * 覆盖：建场次 → 预约/重复预约 → 扫码解锁 → 现场奖品（开关/发射成功/扫码三重门槛）
 *      → 次数耗尽 → 分享加抽 → 库存扣减与防超发 → 商家门控 → 通行证 → 全局开关
 * 运行：node scripts/_tmp_smoke_watch_party.js
 */
const { createWatchPartyApi } = require('../cloudfunctions/adminGateway/watchParty.js')

// ── 极简 tcb db mock ──
const CMD = {
  neq: (v) => ({ __cmd: 'neq', v }),
  lt: (v) => ({ __cmd: 'lt', v }),
  gt: (v) => ({ __cmd: 'gt', v }),
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
    }
    // tcb 语义：查询数组字段等于标量 = 数组包含（staffOpenids: openid）
    if (Array.isArray(actual)) return actual.indexOf(expect) >= 0
    return actual === expect
  })
}

function applyUpdate(doc, data) {
  Object.keys(data).forEach((k) => {
    const v = data[k]
    // 支持 tcb 点路径更新（如 'stats.channel.poster1'）
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
  // runTransaction：内存 mock 顺序执行即可（draw 事务失败路径都在写库前抛错）
  db: { collection, runTransaction: async (fn) => fn({ collection }) },
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
  // 过审总闸：global_config.main.enableWatchParty（failClosed，需先种开关）
  await collection('global_config').add({ data: { _id: 'main', enableWatchParty: true } })

  console.log('── 场次 ──')
  const created = await api.createSession({
    code: 'wc01', title: '长八观礼专场', missionId: 'll2-123', rocketName: '长征八号',
    launchTime: new Date(Date.now() + 3600e3).toISOString(), lat: 19.6, lng: 110.9,
    capacity: 2, parkingSpots: [{ name: 'P1', lat: 19.5, lng: 110.8, walkMinutes: 10 }],
    sciencePoints: ['长八可复用', '文昌发射场'],
    passEnabled: true, passHours: 12
  }, admin)
  assert('创建场次', created.code === 0, created)
  const sid = created.data.id

  const dupCode = await api.createSession({ code: 'wc01', title: '另一场' }, admin)
  assert('短码重复被拒', dupCode.code === 4002, dupCode)

  const cfg = await api.getPublicConfig()
  assert('公开配置返回场次', cfg.code === 0 && cfg.data && cfg.data.sessionId === sid, cfg)

  const byCode = await api.getPublicSession({ code: 'WC01' })
  assert('按短码查场次（大小写不敏感）', byCode.code === 0 && byCode.data.sessionId === sid)

  console.log('── 预约 ──')
  const r1 = await api.reserve({ sessionId: sid, name: '张三', phone: '13800000001', headcount: 3 }, 'user-a')
  assert('用户A预约成功', r1.code === 0, r1)
  const rDup = await api.reserve({ sessionId: sid, name: '张三', phone: '13800000001' }, 'user-a')
  assert('重复预约被拒', rDup.code === 4002, rDup)
  const rBadPhone = await api.reserve({ sessionId: sid, name: '李四', phone: '123' }, 'user-b')
  assert('手机号校验', rBadPhone.code === 4001, rBadPhone)
  await api.reserve({ sessionId: sid, name: '李四', phone: '13800000002' }, 'user-b')
  const rFull = await api.reserve({ sessionId: sid, name: '王五', phone: '13800000003' }, 'user-c')
  assert('容量满被拒', rFull.code === 4003, rFull)

  const mine = await api.getMyReservation('user-a', { sessionId: sid })
  assert('查我的预约', mine.code === 0 && mine.data && mine.data.name === '张三')

  await api.cancelReservation({ sessionId: sid }, 'user-b')
  const rAfterCancel = await api.reserve({ sessionId: sid, name: '王五', phone: '13800000003' }, 'user-c')
  assert('取消后腾出容量', rAfterCancel.code === 0, rAfterCancel)

  console.log('── 现场奖品（三重门槛：开关 → 发射成功 → 扫码资格） ──')
  const scan = await api.scanCheckIn({ code: 'wc01', channel: 'poster1' }, 'user-a')
  assert('扫码解锁1次', scan.code === 0 && scan.data.total === 1 && scan.data.remaining === 1, scan)
  const scan2 = await api.scanCheckIn({ sessionId: sid, channel: 'poster2' }, 'user-a')
  assert('重复扫码幂等', scan2.code === 0 && scan2.data.total === 1)

  const drawClosed = await api.draw({ sessionId: sid }, 'user-a')
  assert('未开启现场抽奖不能抽', drawClosed.code === 4031, drawClosed)

  // updateSession 为整单替换语义（后台编辑表单提交完整字段），测试也提交完整 body
  const sessionDoc = (await api.getPublicSession({ sessionId: sid })).data
  const baseBody = {
    code: 'wc01', title: sessionDoc.title, missionId: sessionDoc.missionId,
    rocketName: sessionDoc.rocketName, launchTime: sessionDoc.launchTime,
    lat: sessionDoc.lat, lng: sessionDoc.lng, capacity: sessionDoc.capacity,
    parkingSpots: sessionDoc.parkingSpots, sciencePoints: sessionDoc.sciencePoints,
    passEnabled: true, passHours: 12
  }
  // 3 件奖品：无价值 / 限量珍稀 / 限量大奖（对应客户端卡面 N / SR / SSR 分档）
  const PRIZES = [
    { id: 'p-sticker', name: '航天纪念贴纸', image: 'https://cdn.example.com/p1.png', stock: 60 },
    { id: 'p-model', name: '长八模型摆件', image: 'https://cdn.example.com/p2.png', stock: 1, valueYuan: 99 },
    { id: 'p-scope', name: '观星望远镜', image: 'https://cdn.example.com/p3.png', stock: 1, valueYuan: 299 }
  ]
  const enablePrize = await api.updateSession(sid, { ...baseBody, prizeDrawEnabled: true, prizes: PRIZES }, admin)
  assert('开启现场抽奖并挂3件奖品', enablePrize.code === 0, enablePrize)
  const sessPrized = (await api.getPublicSession({ sessionId: sid })).data
  assert('公开场次含奖品与库存',
    sessPrized.prizeDrawEnabled === true && sessPrized.prizes.length === 3 &&
    sessPrized.prizes.reduce((s, p) => s + p.remaining, 0) === 62,
    sessPrized.prizes)

  const drawBeforeSuccess = await api.draw({ sessionId: sid }, 'user-a')
  assert('发射成功前不能抽', drawBeforeSuccess.code === 4032, drawBeforeSuccess)

  const lightUp = await api.updateSession(sid, {
    ...baseBody, prizeDrawEnabled: true, prizes: PRIZES, successUnlockedAt: Date.now()
  }, admin)
  assert('点亮发射成功', lightUp.code === 0, lightUp)

  const noQuota = await api.draw({ sessionId: sid }, 'user-zero')
  assert('未扫码不能抽', noQuota.code === 4011, noQuota)

  const d1 = await api.draw({ sessionId: sid }, 'user-a')
  assert('第一抽成功', d1.code === 0 && d1.data.card && d1.data.card.serialNo === 1, d1)
  assert('抽中奖品字段齐全（凭证/名称/图片）',
    !!d1.data.drawId && !!d1.data.prize.name && !!d1.data.prize.image, d1.data)

  const d2 = await api.draw({ sessionId: sid }, 'user-a')
  assert('次数耗尽被拒', d2.code === 4012, d2)

  const bonus = await api.shareBonus({ sessionId: sid }, 'user-a')
  assert('分享加抽', bonus.code === 0 && bonus.data.granted && bonus.data.remaining === 1, bonus)
  const bonus2 = await api.shareBonus({ sessionId: sid }, 'user-a')
  assert('分享加抽只给一次', bonus2.code === 0 && !bonus2.data.granted, bonus2)

  const d3 = await api.draw({ sessionId: sid }, 'user-a')
  assert('分享后第二抽成功', d3.code === 0, d3)

  // 第三位现场用户（供走单统计 scanUsers / 大屏 drawCount 场景）
  await api.scanCheckIn({ code: 'wc01', channel: 'site' }, 'user-b2')
  const dB2 = await api.draw({ sessionId: sid }, 'user-b2')
  assert('多用户可各自抽取', dB2.code === 0, dB2)

  const sessAfterDraws = (await api.getPublicSession({ sessionId: sid })).data
  assert('库存按抽取扣减（62→59）',
    sessAfterDraws.prizes.reduce((s, p) => s + p.remaining, 0) === 59,
    sessAfterDraws.prizes)

  console.log('── 奖品防超发 ──')
  const oneShot = await api.createSession({
    code: 'wc09', title: '单件奖品场', launchTime: new Date(Date.now() + 3600e3).toISOString(),
    prizeDrawEnabled: true, successUnlockedAt: Date.now(),
    prizes: [{ id: 'p-only', name: '唯一大奖', image: 'https://cdn.example.com/only.png', stock: 1, valueYuan: 299 }]
  }, admin)
  assert('单件奖品场创建', oneShot.code === 0, oneShot)
  const osid = oneShot.data.id
  await api.scanCheckIn({ code: 'wc09', channel: 'site' }, 'user-s1')
  await api.scanCheckIn({ code: 'wc09', channel: 'site' }, 'user-s2')
  const os1 = await api.draw({ sessionId: osid }, 'user-s1')
  assert('唯一奖品被抽走（限量 1/1）', os1.code === 0 && os1.data.prize.serialNo === 1 && os1.data.prize.stock === 1, os1)
  const os2 = await api.draw({ sessionId: osid }, 'user-s2')
  assert('库存归零后拒抽（防超发）', os2.code === 4041, os2)
  // 收尾下线临时场次：无商家场次会被公开入口兜底选中，影响「商家暂停后入口隐藏」断言
  await api.deleteSession(osid, admin)

  console.log('── 卡册 / 大屏 / 统计 ──')
  const album = await api.getMyCards('user-a')
  assert('我的卡册2张', album.code === 0 && album.data.length === 2, album.data && album.data.length)

  const screen = await api.getScreenData({ code: 'wc01' })
  assert('大屏数据', screen.code === 0 && screen.data.sciencePoints.length === 2 && screen.data.drawCount >= 2, screen)

  const stats = await api.getStats(admin, { sessionId: sid })
  assert('统计：预约数', stats.code === 0 && stats.data.reservations === 2, stats)
  assert('统计：渠道分布含 poster1', stats.data.channelCount.poster1 === 1, stats.data.channelCount)

  const checkInTargetId = (await api.listReservations(admin, { sessionId: sid })).data.list[0]._id
  const checkIn = await api.checkInReservation(checkInTargetId, admin)
  assert('核销预约', checkIn.code === 0)
  const checkInAgain = await api.checkInReservation(checkInTargetId, admin)
  const statsAfterRecheck = await api.getStats(admin, { sessionId: sid })
  assert('重复核销幂等（计数不翻倍）', checkInAgain.code === 0 && statsAfterRecheck.data.checkedIn === 1, statsAfterRecheck.data)

  console.log('── 合作商家门控 ──')
  const mCreated = await api.createMerchant({
    name: '龙楼观礼楼', contactName: '陈老板', contactPhone: '13900000001',
    address: '文昌市龙楼镇航天大道1号', lat: 19.61, lng: 110.95, note: '五五分成'
  }, admin)
  assert('商家入驻', mCreated.code === 0, mCreated)
  const mid = mCreated.data.id

  const fullSession = (await api.getPublicSession({ sessionId: sid })).data
  const sessionBody = {
    code: 'wc01', title: fullSession.title, missionId: fullSession.missionId,
    rocketName: fullSession.rocketName, launchTime: fullSession.launchTime,
    lat: fullSession.lat, lng: fullSession.lng, capacity: fullSession.capacity,
    parkingSpots: fullSession.parkingSpots, sciencePoints: fullSession.sciencePoints,
    passEnabled: true, passHours: 12,
    successUnlockedAt: Date.now()
  }
  const attach = await api.updateSession(sid, { ...sessionBody, merchantId: mid }, admin)
  assert('场次挂靠商家', attach.code === 0, attach)
  const badAttach = await api.updateSession(sid, { ...sessionBody, merchantId: 'no-such-merchant' }, admin)
  assert('挂靠不存在商家被拒', badAttach.code === 4001, badAttach)

  const cfgWithMerchant = await api.getPublicConfig()
  assert('挂靠后入口正常且带商家名', cfgWithMerchant.code === 0 && cfgWithMerchant.data && cfgWithMerchant.data.merchantName === '龙楼观礼楼', cfgWithMerchant)

  const merchantRow = (await api.listMerchants(admin, {})).data.list.find((m) => m._id === mid)
  const pause = await api.updateMerchant(mid, { ...merchantRow, status: 'paused' }, admin)
  assert('暂停商家', pause.code === 0, pause)
  const cfgPaused = await api.getPublicConfig()
  assert('商家暂停后入口隐藏', cfgPaused.code === 0 && cfgPaused.data === null, cfgPaused)
  const scanPaused = await api.scanCheckIn({ sessionId: sid }, 'user-new-1')
  assert('商家暂停后扫码被拒', scanPaused.code === 4040, scanPaused)
  const reservePaused = await api.reserve({ sessionId: sid, name: '赵六', phone: '13800000006' }, 'user-new-1')
  assert('商家暂停后预约被拒', reservePaused.code === 4040, reservePaused)
  const screenPaused = await api.getScreenData({ code: 'wc01' })
  assert('商家暂停后大屏下线', screenPaused.code === 4040, screenPaused)

  const resume = await api.updateMerchant(mid, { ...merchantRow, status: 'active' }, admin)
  assert('恢复商家', resume.code === 0)
  const cfgResumed = await api.getPublicConfig()
  assert('恢复后入口重现', cfgResumed.code === 0 && cfgResumed.data && cfgResumed.data.sessionId === sid, cfgResumed)

  const delBlocked = await api.deleteMerchant(mid, admin)
  assert('名下有场次时禁止删除商家', delBlocked.code === 4002, delBlocked)

  console.log('── 观礼通行证 ──')
  const HOUR = 3600e3
  const scanPass = await api.scanCheckIn({ code: 'wc01', channel: 'site' }, 'user-pass-1')
  assert('扫码发通行证（默认12h）',
    scanPass.code === 0 && scanPass.data.pass &&
    scanPass.data.pass.expiresAt > Date.now() + 11.5 * HOUR &&
    scanPass.data.pass.expiresAt < Date.now() + 12.5 * HOUR,
    scanPass.data && scanPass.data.pass)
  const scanPassAgain = await api.scanCheckIn({ code: 'wc01' }, 'user-pass-1')
  assert('重复扫码通行证幂等（不重复续期）',
    scanPassAgain.code === 0 && scanPassAgain.data.pass &&
    scanPassAgain.data.pass.expiresAt === scanPass.data.pass.expiresAt,
    scanPassAgain.data && scanPassAgain.data.pass)

  await api.createSession({
    code: 'wc02', title: '关闭通行证的场次', passEnabled: false,
    launchTime: new Date(Date.now() + HOUR).toISOString()
  }, admin)
  const scanNoPass = await api.scanCheckIn({ code: 'wc02' }, 'user-pass-2')
  assert('场次关闭通行证则不发证', scanNoPass.code === 0 && scanNoPass.data.pass === null, scanNoPass.data && scanNoPass.data.pass)

  await api.createSession({
    code: 'wc03', title: '远期场次（发证窗口外）', passEnabled: true,
    launchTime: new Date(Date.now() + 100 * HOUR).toISOString()
  }, admin)
  const scanOutWindow = await api.scanCheckIn({ code: 'wc03' }, 'user-pass-3')
  assert('发射前后48h窗口外不发证（抽卡资格照常）',
    scanOutWindow.code === 0 && scanOutWindow.data.pass === null && scanOutWindow.data.total === 1,
    scanOutWindow.data)

  await api.createSession({
    code: 'wc04', title: '超长时长场次', passEnabled: true, passHours: 100,
    launchTime: new Date(Date.now() + HOUR).toISOString()
  }, admin)
  const scanCapped = await api.scanCheckIn({ code: 'wc04' }, 'user-pass-4')
  assert('通行证时长封顶48h',
    scanCapped.code === 0 && scanCapped.data.pass &&
    scanCapped.data.pass.expiresAt > Date.now() + 47.5 * HOUR &&
    scanCapped.data.pass.expiresAt < Date.now() + 48.5 * HOUR,
    scanCapped.data && scanCapped.data.pass)

  const defaultOff = await api.createSession({
    code: 'wc05', title: '默认关闭通行证',
    launchTime: new Date(Date.now() + HOUR).toISOString()
  }, admin)
  assert('新建场次默认关闭通行证', defaultOff.code === 0)
  const scanDefaultOff = await api.scanCheckIn({ code: 'wc05' }, 'user-pass-5')
  assert('默认关闭则扫码不发证', scanDefaultOff.code === 0 && scanDefaultOff.data.pass === null, scanDefaultOff.data)

  const statsPass = await api.getStats(admin, { sessionId: sid })
  assert('统计：通行证发放数', statsPass.code === 0 && statsPass.data.passGranted >= 1, statsPass.data && statsPass.data.passGranted)

  console.log('── 商家走单统计 ──')
  const mStats = await api.getMerchantStats(mid, admin)
  assert('走单统计返回', mStats.code === 0 && mStats.data.merchant.name === '龙楼观礼楼', mStats)
  assert('走单统计只含名下场次', mStats.data.totals.sessions === 1 && mStats.data.sessions[0].sessionId === sid,
    mStats.data && mStats.data.totals)
  const mRow = mStats.data.sessions[0]
  assert('走单统计：到场扫码计数', mRow.scanUsers >= 3 && mStats.data.totals.scanUsers === mRow.scanUsers, mRow)
  assert('走单统计：预约/核销/抽卡', mRow.reservations === 2 && mRow.checkedIn === 1 && mRow.draws >= 2, mRow)
  assert('走单统计：渠道分布含铺码点位', mStats.data.channelCount.poster1 === 1, mStats.data.channelCount)
  const mStatsMissing = await api.getMerchantStats('no-such-merchant', admin)
  assert('走单统计：商家不存在被拒', mStatsMissing.code === 4004, mStatsMissing)

  console.log('── 同行商家申请（提交即自动入驻） ──')
  const badLead = await api.applyMerchantLead({ name: '隔壁民宿', contactName: '王老板', phone: '123', sessionId: sid }, 'peer-1')
  assert('申请手机号校验', badLead.code === 4001, badLead)

  const lead1 = await api.applyMerchantLead({
    name: '隔壁民宿观景台', contactName: '王老板', phone: '13700000001',
    location: '龙楼镇淇水湾', note: '6楼天台，视野开阔', sessionId: sid
  }, 'peer-1')
  assert('提交即自动入驻（返回商家编号）',
    lead1.code === 0 && lead1.data.autoApproved && lead1.data.merchantId && /^[A-Z0-9]{8}$/.test(lead1.data.merchantCode || ''),
    lead1)

  const peerMe = await api.merchantMe('peer-1')
  assert('申请人微信已自动绑定并可进商家中心',
    peerMe.code === 0 && peerMe.data.merchant.name === '隔壁民宿观景台' && peerMe.data.merchant.merchantCode === lead1.data.merchantCode,
    peerMe)

  const leadDupOpenid = await api.applyMerchantLead({ name: '再提一次', contactName: '王老板', phone: '13700000009', sessionId: sid }, 'peer-1')
  assert('已绑定商家的微信重复申请被拒', leadDupOpenid.code === 4002, leadDupOpenid)
  const leadDupPhone = await api.applyMerchantLead({ name: '换个号来', contactName: '王老板', phone: '13700000001', sessionId: sid }, 'peer-2')
  assert('已入驻手机号重复申请被拒', leadDupPhone.code === 4002, leadDupPhone)

  const leadList = await api.listMerchantLeads(admin, { status: 'approved' })
  assert('申请记录状态为已通过', leadList.code === 0 && leadList.data.total === 1, leadList.data)
  const leadRow = leadList.data.list[0]
  assert('推荐归属自动记录', leadRow.referrerMerchantId === mid && leadRow.referrerMerchantName === '龙楼观礼楼', leadRow)
  assert('申请记录关联新商家', leadRow.merchantId === lead1.data.merchantId, leadRow)

  const newMerchant = (await api.listMerchants(admin, {})).data.list.find((m) => m._id === lead1.data.merchantId)
  assert('新商家带推荐来源且已激活', !!newMerchant && newMerchant.referrerMerchantId === mid && newMerchant.status === 'active', newMerchant)

  console.log('── 全局开关 ──')
  const cfgBefore = await api.getGlobalConfig(admin)
  assert('默认全局开启', cfgBefore.code === 0 && cfgBefore.data.enabled === true, cfgBefore)

  const shutDown = await api.updateGlobalConfig({ enabled: false, closedNotice: '本观礼点合作已结束，感谢支持' }, admin)
  assert('一键关停', shutDown.code === 0, shutDown)
  const cfgOff = await api.getPublicConfig()
  assert('关停后入口隐藏', cfgOff.code === 0 && cfgOff.data === null, cfgOff)
  const sessionOff = await api.getPublicSession({ sessionId: sid })
  assert('关停后场次详情 4030 且带自定义文案', sessionOff.code === 4030 && /合作已结束/.test(sessionOff.message), sessionOff)
  const drawOff = await api.draw({ sessionId: sid }, 'user-a')
  assert('关停后抽卡被拒', drawOff.code === 4030, drawOff)
  const screenOff = await api.getScreenData({ code: 'wc01' })
  assert('关停后大屏下线', screenOff.code === 4030, screenOff)
  const applyOff = await api.applyMerchantLead({ name: '想入驻', contactName: '李老板', phone: '13700000002' }, 'peer-3')
  assert('关停后合作申请也关闭', applyOff.code === 4030, applyOff)
  const albumOff = await api.getMyCards('user-a')
  assert('关停后用户卡册仍可查看', albumOff.code === 0 && albumOff.data.length === 2, albumOff)
  const myReserveOff = await api.getMyReservation('user-a', { sessionId: sid })
  assert('关停后仍可查自己的预约', myReserveOff.code === 0)

  const reopen = await api.updateGlobalConfig({ enabled: true, closedNotice: '' }, admin)
  assert('重新开启', reopen.code === 0)
  const cfgOn = await api.getPublicConfig()
  assert('开启后入口恢复', cfgOn.code === 0 && cfgOn.data && cfgOn.data.sessionId === sid, cfgOn)

  console.log('── 商家固定编号 ──')
  const merchantsAll = (await api.listMerchants(admin, {})).data.list
  const mainMerchant = merchantsAll.find((m) => m._id === mid)
  assert('入驻自动生成商家编号', !!mainMerchant.merchantCode && mainMerchant.merchantCode.length >= 8, mainMerchant.merchantCode)
  const codeKeep = await api.ensureMerchantCode(mid, {}, admin)
  assert('已有编号不重复生成', codeKeep.code === 0 && codeKeep.data.merchantCode === mainMerchant.merchantCode)
  const codeRegen = await api.ensureMerchantCode(mid, { regenerate: true }, admin)
  assert('可重新生成编号', codeRegen.code === 0 && codeRegen.data.merchantCode !== mainMerchant.merchantCode, codeRegen)
  const mainCode = codeRegen.data.merchantCode

  console.log('── 商家自助（小程序端） ──')
  const bindBad = await api.merchantBind({ code: 'NOSUCH99' }, 'boss-1')
  assert('错误编号绑定被拒', bindBad.code === 4040, bindBad)
  const bind1 = await api.merchantBind({ code: mainCode.toLowerCase() }, 'boss-1')
  assert('凭编号绑定成功（大小写不敏感）', bind1.code === 0 && bind1.data.merchantId === mid, bind1)
  const bind1Again = await api.merchantBind({ code: mainCode }, 'boss-1')
  assert('重复绑定幂等', bind1Again.code === 0 && bind1Again.data.merchantId === mid)

  const meBeforeCreate = await api.merchantMe('boss-1')
  assert('商家中心返回名下场次', meBeforeCreate.code === 0 && meBeforeCreate.data.sessions.length === 1, meBeforeCreate.data && meBeforeCreate.data.sessions.length)

  const meUnbound = await api.merchantMe('stranger-1')
  assert('未绑定用户查商家中心返回 4011', meUnbound.code === 4011, meUnbound)

  const mCreate = await api.merchantCreateSession({
    title: '长征十二号观礼专场',
    missionId: 'll2-777',
    missionName: '卫星互联网组网',
    rocketName: '长征十二号',
    launchTime: new Date(Date.now() + 48 * 3600e3).toISOString(),
    sciencePoints: ['长十二有多高？|全长约 62 米'],
    scienceImages: ['cloud://env.bucket/watch_party/science/demo.jpg', 'javascript:bad', 'https://cdn.example.com/cfg.png'],
    cardIds: [],
    capacity: 50
  }, 'boss-1')
  assert('商家自建场次成功（短码自动生成）', mCreate.code === 0 && /^m[a-z0-9]{5}$/.test(mCreate.data.code), mCreate)
  const mSid = mCreate.data.id

  const meAfterCreate = await api.merchantMe('boss-1')
  const mySession = meAfterCreate.data.sessions.find((s) => s.sessionId === mSid)
  assert('新场次归属本商家并带模板地址', !!mySession && mySession.address === '文昌市龙楼镇航天大道1号', mySession && mySession.address)
  assert('非法配置图被过滤', mySession.scienceImages.length === 2, mySession.scienceImages)

  const publicNew = await api.getPublicSession({ sessionId: mSid })
  assert('商家自建场次对用户可见且带商家名', publicNew.code === 0 && publicNew.data.merchantName === '龙楼观礼楼', publicNew)

  const strangerCreate = await api.merchantCreateSession({ title: '越权场次' }, 'stranger-1')
  assert('未绑定用户不能建场次', strangerCreate.code === 4011, strangerCreate)

  // 第二个商家（推荐入驻转来的）绑定后不能改别家场次
  const otherMerchant = merchantsAll.find((m) => m._id !== mid)
  const otherCode = (await api.ensureMerchantCode(otherMerchant._id, {}, admin)).data.merchantCode
  await api.merchantBind({ code: otherCode }, 'boss-2')
  const crossUpdate = await api.merchantUpdateSession(mSid, { title: '篡改标题' }, 'boss-2')
  assert('不能编辑别家场次', crossUpdate.code === 4040, crossUpdate)
  const bindTwice = await api.merchantBind({ code: mainCode }, 'boss-2')
  assert('一个微信只能绑一个商家', bindTwice.code === 4002, bindTwice)

  const mUpdate = await api.merchantUpdateSession(mSid, {
    title: '长征十二号观礼专场（升级）',
    missionId: 'll2-777',
    missionName: '卫星互联网组网',
    rocketName: '长征十二号',
    launchTime: new Date(Date.now() + 48 * 3600e3).toISOString(),
    sciencePoints: ['长十二有多高？|全长约 62 米'],
    scienceImages: ['https://cdn.example.com/cfg.png'],
    cardIds: [],
    capacity: 80,
    status: 'open',
    enabled: true
  }, 'boss-1')
  assert('商家编辑自己场次成功', mUpdate.code === 0, mUpdate)
  const afterUpdate = (await api.merchantMe('boss-1')).data.sessions.find((s) => s.sessionId === mSid)
  assert('编辑后短码不变', afterUpdate.code === mCreate.data.code, afterUpdate.code)
  assert('编辑生效（标题/容量）', afterUpdate.title.indexOf('升级') >= 0 && afterUpdate.capacity === 80)

  console.log('── 商家配奖品 + 点亮发射成功 ──')
  // 旧纪念卡卡池已下线：接口保留为空壳，避免旧客户端报错
  const legacyCards = await api.merchantListCards('boss-1', { sessionId: mSid })
  assert('旧卡池接口返回空壳（deprecated）',
    legacyCards.code === 0 && legacyCards.data.deprecated === true && legacyCards.data.list.length === 0,
    legacyCards)

  const mPrizeUpd = await api.merchantUpdateSession(mSid, {
    title: afterUpdate.title, rocketName: afterUpdate.rocketName, launchTime: afterUpdate.launchTime,
    sciencePoints: afterUpdate.sciencePoints, scienceImages: afterUpdate.scienceImages,
    capacity: afterUpdate.capacity, status: 'open', enabled: true,
    prizeDrawEnabled: true,
    prizes: [{ id: 'mp-1', name: '观礼纪念徽章', image: 'https://cdn.example.com/badge.png', stock: 5, valueYuan: 30 }]
  }, 'boss-1')
  assert('商家配奖品并开启现场抽奖', mPrizeUpd.code === 0, mPrizeUpd)

  const crossUnlock = await api.merchantUnlockSessionSuccess(mSid, 'boss-2')
  assert('别家商家不能点亮发射成功', crossUnlock.code === 4040, crossUnlock)
  const unlock1 = await api.merchantUnlockSessionSuccess(mSid, 'boss-1')
  assert('商家点亮发射成功', unlock1.code === 0 && unlock1.data.already === false, unlock1)
  const unlock2 = await api.merchantUnlockSessionSuccess(mSid, 'boss-1')
  assert('重复点亮幂等', unlock2.code === 0 && unlock2.data.already === true, unlock2)

  await api.scanCheckIn({ code: afterUpdate.code, channel: 'screen' }, 'user-pick-1')
  const pickedDraw = await api.draw({ sessionId: mSid }, 'user-pick-1')
  assert('用户扫码后抽中商家配置的奖品',
    pickedDraw.code === 0 && pickedDraw.data.prize.name === '观礼纪念徽章' && pickedDraw.data.prize.serialNo === 1,
    pickedDraw)

  console.log('── 多场次 / 双群码 / 现场照片视频 / 短链 / 配置图锁定 ──')
  const mCreate2 = await api.merchantCreateSession({
    title: '八月第二场观礼', rocketName: '长征八号',
    launchTime: new Date(Date.now() + 72 * 3600e3).toISOString()
  }, 'boss-1')
  assert('同商家可创建多场次', mCreate2.code === 0, mCreate2)

  // 已有 3 场（sid + mSid + mCreate2），补到 10 场后再建应被拒
  let limitHit = null
  for (let i = 0; i < 8; i++) {
    limitHit = await api.merchantCreateSession({ title: `批量场次${i}` }, 'boss-1')
  }
  assert('超过 10 场被拒', limitHit && limitHit.code === 4002, limitHit)

  const richUpdate = await api.merchantUpdateSession(mSid, {
    title: afterUpdate.title, missionId: 'll2-777', missionName: '卫星互联网组网',
    rocketName: '手动改的名字', rocketImageName: '长征十二号',
    launchTime: afterUpdate.launchTime, capacity: 80, status: 'open', enabled: true,
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
  assert('新字段保存成功', richUpdate.code === 0, richUpdate)

  const pubRich = (await api.getPublicSession({ sessionId: mSid })).data
  assert('群码最多保留 2 张', pubRich.wechatGroupQrs.length === 2, pubRich.wechatGroupQrs)
  assert('旧字段兼容取第一张', pubRich.wechatGroupQr === 'cloud://env.bucket/watch_party/wechat_qr/qr1.png', pubRich.wechatGroupQr)
  assert('现场照片截断到 8 张且过滤非法地址', pubRich.sitePhotos.length === 8, pubRich.sitePhotos)
  assert('现场视频与封面透出', !!pubRich.siteVideo && !!pubRich.siteVideoPoster, pubRich)
  assert('小程序短链原样保留', pubRich.vehicleBookingUrl === '#小程序://车辆预约/AbCdEf123', pubRich.vehicleBookingUrl)
  assert('配置图匹配名锁定（改火箭名不影响）', pubRich.rocketImageName === '长征十二号' && pubRich.rocketName === '手动改的名字', pubRich)

  // 部分更新（不带新字段）不应清空已保存内容
  await api.merchantUpdateSession(mSid, {
    title: '只改标题', missionId: 'll2-777', missionName: '卫星互联网组网',
    rocketName: '手动改的名字', launchTime: afterUpdate.launchTime,
    capacity: 80, status: 'open', enabled: true
  }, 'boss-1')
  const pubKeep = (await api.getPublicSession({ sessionId: mSid })).data
  assert('未提交字段保持不变',
    pubKeep.sitePhotos.length === 8 && pubKeep.wechatGroupQrs.length === 2
    && pubKeep.siteVideo && pubKeep.rocketImageName === '长征十二号'
    && pubKeep.vehicleBookingUrl === '#小程序://车辆预约/AbCdEf123',
    pubKeep)

  console.log('── 任务显示名（第一个入驻商家可改） ──')
  const mn0 = await api.merchantGetMissionName({ missionId: 'll2-777' }, 'boss-1')
  assert('该任务下最早商家有命名权', mn0.code === 0 && mn0.data.editable === true, mn0)
  const mnSet = await api.merchantSetMissionDisplayName({ missionId: 'll2-777', displayName: '卫星互联网低轨六组' }, 'boss-1')
  assert('设置任务显示名', mnSet.code === 0, mnSet)
  const pubNamed = (await api.getPublicSession({ sessionId: mSid })).data
  assert('公开详情带任务显示名', pubNamed.missionDisplayName === '卫星互联网低轨六组', pubNamed.missionDisplayName)
  const meNamed = (await api.merchantMe('boss-1')).data.sessions.find((s) => s.sessionId === mSid)
  assert('商家中心带显示名与命名权标记',
    meNamed.missionDisplayName === '卫星互联网低轨六组' && meNamed.missionNameEditable === true, meNamed)
  const mnDeny = await api.merchantSetMissionDisplayName({ missionId: 'll2-777', displayName: '越权改名' }, 'peer-1')
  assert('非该任务下最早商家改名被拒', mnDeny.code === 4030, mnDeny)
  const mnPeerView = await api.merchantGetMissionName({ missionId: 'll2-777' }, 'peer-1')
  assert('其他商家可见显示名但不可改',
    mnPeerView.code === 0 && mnPeerView.data.displayName === '卫星互联网低轨六组' && mnPeerView.data.editable === false,
    mnPeerView)
  const mnClear = await api.merchantSetMissionDisplayName({ missionId: 'll2-777', displayName: '' }, 'boss-1')
  assert('留空可清除显示名', mnClear.code === 0 && mnClear.data.displayName === '', mnClear)

  console.log('── 商家解绑 / 删场次 ──')
  const mDelCross = await api.merchantDeleteSession(mSid, 'boss-2')
  assert('不能删别家场次', mDelCross.code === 4040, mDelCross)
  const mDel = await api.merchantDeleteSession(mSid, 'boss-1')
  assert('商家删除自己场次', mDel.code === 0, mDel)
  await api.merchantUnbind('boss-1')
  const meAfterUnbind = await api.merchantMe('boss-1')
  assert('解绑后无法再进商家中心', meAfterUnbind.code === 4011, meAfterUnbind)

  console.log('── 后台即将发射列表（LL2 缓存） ──')
  const sortedParams = JSON.stringify({
    format: 'json', hide_recent_previous: true, limit: 100, mode: 'detailed', offset: 0, ordering: 'net'
  })
  await collection('space_devs_cache').add({
    data: {
      _id: `api_cache_/launches/upcoming/_${sortedParams}_slim_v6`,
      updatedAt: Date.now(),
      data: {
        results: [
          {
            id: 'uuid-cz8', name: '长征八号 | 卫星互联网低轨01组',
            net: new Date(Date.now() + 96 * 3600e3).toISOString(),
            mission: { name: '卫星互联网低轨01组' },
            rocket: { configuration: { name: '长征八号' } },
            status: { name: 'Go', abbrev: 'Go' },
            pad: { name: '文昌商业发射场一号工位' }
          },
          {
            id: 'uuid-old', name: '过期任务 | 已发射',
            net: new Date(Date.now() - 10 * 3600e3).toISOString(),
            rocket: { configuration: { name: '猎鹰九号' } }
          }
        ]
      }
    }
  })
  const upcoming = await api.listUpcomingLaunchesAdmin(admin)
  assert('即将发射列表返回未来任务', upcoming.code === 0 && upcoming.data.list.length === 1, upcoming.data)
  const row = upcoming.data.list[0]
  assert('列表字段齐全（id/任务/火箭/时间）',
    row.missionId === 'uuid-cz8' && row.missionName === '卫星互联网低轨01组' && row.rocketName === '长征八号' && !!row.launchTime,
    row)

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('测试异常:', e)
  process.exit(1)
})
