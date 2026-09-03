/**
 * 冒烟：商家「推荐给同行」入驻归属全链路（内存 mock tcb db）
 * 覆盖：分享链接 refMerchantId 归属 → 伪造 ref 不归属 → 场次表单 sessionId 归属
 *      → ref 优先于 sessionId → 已绑定微信拦截 → 手机号重复拦截
 * 运行：node scripts/_tmp_smoke_peer_referral.js
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

function findLeadByPhone(phone) {
  return (store['watch_party_merchant_leads'] || []).find((l) => l.phone === phone)
    || (store['watchPartyMerchantLeads'] || []).find((l) => l.phone === phone)
}

async function main() {
  await collection('global_config').add({ data: { _id: 'main', enableWatchParty: true } })

  console.log('── 准备：推荐商家 A（含挂靠场次） ──')
  const mA = await api.createMerchant({ name: '文昌火箭观礼严选', contactName: '阿严', contactPhone: '13900000001' }, admin)
  assert('创建商家A', mA.code === 0, mA)
  const merchantAId = mA.data.id || mA.data.merchantId || mA.data._id
  assert('商家A有 id', !!merchantAId, mA.data)

  const s = await api.createSession({
    code: 'wc01', title: '长七A观礼', missionId: 'll2-777', rocketName: 'Long March 7A',
    launchTime: new Date(Date.now() + 3600e3).toISOString(),
    merchantId: merchantAId
  }, admin)
  assert('创建挂靠场次', s.code === 0, s)
  const sid = s.data && s.data.id

  console.log('── 1. 商家分享链接归属（refMerchantId） ──')
  const apply1 = await api.applyMerchantLead({
    name: '龙楼观礼院子', contactName: '小龙', phone: '13800000010',
    location: '海南文昌', note: '', refMerchantId: merchantAId
  }, 'openid-peer-1')
  assert('分享落地自动入驻', apply1.code === 0 && apply1.data.autoApproved === true, apply1)
  const lead1 = findLeadByPhone('13800000010')
  assert('lead 归属推荐商家A', lead1 && lead1.referrerMerchantId === merchantAId, lead1)
  assert('lead 记录商家名', lead1 && lead1.referrerMerchantName === '文昌火箭观礼严选', lead1)
  assert('lead 来源 merchant_share', lead1 && lead1.referrerSource === 'merchant_share', lead1)
  const newM1 = (store['watch_party_merchants'] || []).find((m) => m.contactPhone === '13800000010')
  assert('新商家档案也带归属', newM1 && newM1.referrerMerchantId === merchantAId && newM1.referrerSource === 'merchant_share', newM1)

  console.log('── 2. 伪造 ref 不归属 ──')
  const apply2 = await api.applyMerchantLead({
    name: '假推荐观礼点', contactName: '小假', phone: '13800000011',
    refMerchantId: 'not-exist-merchant'
  }, 'openid-peer-2')
  assert('伪造 ref 仍可入驻', apply2.code === 0, apply2)
  const lead2 = findLeadByPhone('13800000011')
  assert('伪造 ref 无归属', lead2 && !lead2.referrerMerchantId && !lead2.referrerSource, lead2)

  console.log('── 3. 场次表单归属（sessionId，兼容原链路） ──')
  const apply3 = await api.applyMerchantLead({
    name: '场次页申请观礼点', contactName: '小场', phone: '13800000012',
    sessionId: sid
  }, 'openid-peer-3')
  assert('场次表单入驻', apply3.code === 0, apply3)
  const lead3 = findLeadByPhone('13800000012')
  assert('lead 归属场次挂靠商家A', lead3 && lead3.referrerMerchantId === merchantAId, lead3)
  assert('lead 来源 session', lead3 && lead3.referrerSource === 'session', lead3)

  console.log('── 4. ref 优先于 sessionId ──')
  const mB = await api.createMerchant({ name: '酒泉观礼站', contactName: '阿泉', contactPhone: '13900000002' }, admin)
  const merchantBId = mB.data.id || mB.data.merchantId || mB.data._id
  const apply4 = await api.applyMerchantLead({
    name: '双参数观礼点', contactName: '小双', phone: '13800000013',
    refMerchantId: merchantBId, sessionId: sid
  }, 'openid-peer-4')
  assert('双参数入驻', apply4.code === 0, apply4)
  const lead4 = findLeadByPhone('13800000013')
  assert('ref 优先（归属B非A）', lead4 && lead4.referrerMerchantId === merchantBId && lead4.referrerSource === 'merchant_share', lead4)

  console.log('── 5. 防滥用拦截 ──')
  const applyBound = await api.applyMerchantLead({
    name: '重复微信观礼点', contactName: '小重', phone: '13800000014',
    refMerchantId: merchantAId
  }, 'openid-peer-1')
  assert('已绑定微信被拦截', applyBound.code === 4002, applyBound)
  const applyDupPhone = await api.applyMerchantLead({
    name: '重复手机观礼点', contactName: '小复', phone: '13800000010',
    refMerchantId: merchantAId
  }, 'openid-peer-9')
  assert('重复手机号被拦截', applyDupPhone.code === 4002, applyDupPhone)

  console.log(failed ? `\n${failed} 项未通过 / ${passed + failed}` : `\n全部通过（${passed} 项）`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
