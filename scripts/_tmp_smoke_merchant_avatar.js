/**
 * 冒烟：商家头像全链路（内存 mock tcb db）
 * 覆盖：入驻后默认无头像 → 商家保存头像（cloud fileID）→ merchantMe 回带
 *      → 顾客选商家列表 merchantAvatar 同步 → 非法地址拦截 → 未绑定微信拦截 → 移除头像
 * 运行：node scripts/_tmp_smoke_merchant_avatar.js
 */
const { createWatchPartyApi } = require('../cloudfunctions/adminGateway/watchParty.js')

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

const AVATAR = 'cloud://prod-env.7072-bucket/watch_party/merchant_avatar/1723100000_ab12cd.jpg'

async function main() {
  await collection('global_config').add({ data: { _id: 'main', enableWatchParty: true } })

  console.log('── 准备：入驻商家（自动绑定 openid-m1）+ 挂靠场次 ──')
  const apply = await api.applyMerchantLead({
    name: '文昌观礼小院', contactName: '阿文', phone: '13800000001'
  }, 'openid-m1')
  assert('自动入驻成功', apply.code === 0 && apply.data.autoApproved === true, apply)

  const me0 = await api.merchantMe('openid-m1')
  assert('商家中心可读', me0.code === 0, me0)
  const merchantId = me0.data.merchant.merchantId
  assert('默认无头像', me0.data.merchant.avatar === '', me0.data.merchant)

  const s = await api.createSession({
    code: 'wc01', title: '长七A观礼', missionId: 'll2-777', rocketName: 'Long March 7A',
    launchTime: new Date(Date.now() + 3600e3).toISOString(),
    merchantId, enabled: true
  }, admin)
  assert('创建挂靠场次', s.code === 0, s)

  console.log('── 1. 保存头像（cloud fileID） ──')
  const up = await api.merchantUpdateAvatar({ avatar: AVATAR }, 'openid-m1')
  assert('保存成功', up.code === 0 && up.data.avatar === AVATAR, up)
  const me1 = await api.merchantMe('openid-m1')
  assert('merchantMe 回带头像', me1.code === 0 && me1.data.merchant.avatar === AVATAR, me1.data && me1.data.merchant)

  console.log('── 2. 顾客选商家列表带 merchantAvatar ──')
  const list1 = await api.listPublicSessions({ missionId: 'll2-777' })
  assert('列表非空', list1.code === 0 && list1.data.list.length === 1, list1)
  assert('卡片带商家头像', list1.data.list[0].merchantAvatar === AVATAR, list1.data.list[0])

  console.log('── 3. 非法地址 / 未绑定微信拦截 ──')
  const bad = await api.merchantUpdateAvatar({ avatar: 'javascript:alert(1)' }, 'openid-m1')
  assert('非法地址被拦截', bad.code === 4001, bad)
  const me2 = await api.merchantMe('openid-m1')
  assert('拦截后头像未变', me2.data.merchant.avatar === AVATAR, me2.data && me2.data.merchant)
  const stranger = await api.merchantUpdateAvatar({ avatar: AVATAR }, 'openid-nobody')
  assert('未绑定微信被拒', stranger.code === 4010 || stranger.code === 4011, stranger)

  console.log('── 4. 移除头像并同步列表 ──')
  const rm = await api.merchantUpdateAvatar({ avatar: '' }, 'openid-m1')
  assert('移除成功', rm.code === 0 && rm.data.avatar === '', rm)
  const me3 = await api.merchantMe('openid-m1')
  assert('merchantMe 头像清空', me3.data.merchant.avatar === '', me3.data && me3.data.merchant)
  const list2 = await api.listPublicSessions({ missionId: 'll2-777' })
  assert('列表头像同步清空（缓存已失效）', list2.code === 0 && list2.data.list[0].merchantAvatar === '', list2.data && list2.data.list && list2.data.list[0])

  console.log(failed ? `\n${failed} 项未通过 / ${passed + failed}` : `\n全部通过（${passed} 项）`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
