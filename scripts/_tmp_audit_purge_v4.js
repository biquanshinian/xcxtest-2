/**
 * 用内存 mock 跑 sendLaunchReminder 的 purgePushJunk，验证：
 * 1) 过期台账真的被删、剩余量如实回报
 * 2) 冷却中的 failed 行不被删（否则下个 tick 会重打微信 API）
 * 3) 默认（idle 路径）不做全表垃圾顺扫，读操作次数是常数级
 * 4) push_history 过期明细被清
 */
const path = require('path')
const Module = require('module')

let opStats = { get: 0, count: 0, remove: 0, bulkRemove: 0, add: 0, update: 0 }

function makeStore() {
  const now = Date.now()
  const DAY = 86400000
  const ledger = []
  let seq = 0
  const id = () => 'id' + String(++seq).padStart(6, '0')
  // 3000 条 5 天前的成功台账（主要垃圾）
  for (let i = 0; i < 3000; i++) {
    ledger.push({ _id: id(), status: 'ok', error: '', sentAt: now - 5 * DAY, oaOpenid: 'o' + i })
  }
  // 500 条今天的成功台账（去重窗口内，必须留）
  for (let i = 0; i < 500; i++) {
    ledger.push({ _id: id(), status: 'ok', error: '', sentAt: now - 3600 * 1000, oaOpenid: 'o' + i })
  }
  // 10 条冷却中的瞬时失败（10 分钟前，retryCount 1）：必须留
  for (let i = 0; i < 10; i++) {
    ledger.push({
      _id: id(),
      status: 'failed',
      error: '服务号模板消息失败: -1 system error',
      retryCount: 1,
      sentAt: now - 10 * 60 * 1000,
      oaOpenid: 'cool' + i
    })
  }
  // 5 条 43101 拒收（永久，可删并标记用户）
  for (let i = 0; i < 5; i++) {
    ledger.push({
      _id: id(),
      status: 'final',
      error: 'errcode 43101 user refuse to accept the msg',
      sentAt: now - 2 * 3600 * 1000,
      oaOpenid: 'refuse' + i
    })
  }
  const push_history = []
  for (let i = 0; i < 1200; i++) {
    push_history.push({ _id: 'h' + i, type: 'auto_detail', createdAt: now - 10 * DAY })
  }
  for (let i = 0; i < 30; i++) {
    push_history.push({ _id: 'hf' + i, type: 'auto', createdAt: now - 3600 * 1000 })
  }
  return { oa_push_ledger: ledger, push_history, users: [], launch_subscriptions: [], launch_data: [] }
}

const CMD = Symbol('cmd')
const cmd = (op, val) => ({ [CMD]: op, val })
const _ = {
  lt: (v) => cmd('lt', v),
  gt: (v) => cmd('gt', v),
  lte: (v) => cmd('lte', v),
  gte: (v) => cmd('gte', v),
  eq: (v) => cmd('eq', v),
  neq: (v) => cmd('neq', v),
  in: (v) => cmd('in', v),
  nin: (v) => cmd('nin', v),
  exists: (v) => cmd('exists', v),
  and: (v) => cmd('and', v),
  or: (v) => cmd('or', v),
  inc: (v) => cmd('inc', v),
  set: (v) => cmd('set', v),
  remove: () => cmd('unset', null)
}
// 支持链式 _.gte(x).and(_.lte(y))
function attachChain(c) {
  c.and = (other) => {
    const merged = cmd('allOf', [c, other])
    attachChain(merged)
    return merged
  }
  return c
}
for (const k of ['lt', 'gt', 'lte', 'gte', 'eq', 'neq']) {
  const orig = _[k]
  _[k] = (v) => attachChain(orig(v))
}

function matchCmd(c, value) {
  const op = c[CMD]
  switch (op) {
    case 'lt': return Number(value) < Number(c.val)
    case 'gt': return String(value) > String(c.val) || Number(value) > Number(c.val)
    case 'lte': return Number(value) <= Number(c.val)
    case 'gte': return Number(value) >= Number(c.val)
    case 'eq': return value === c.val
    case 'neq': return value !== c.val
    case 'in': return (c.val || []).indexOf(value) >= 0
    case 'nin': return (c.val || []).indexOf(value) < 0
    case 'exists': return c.val ? value !== undefined : value === undefined
    case 'allOf': return c.val.every((sub) => matchCmd(sub, value))
    default: throw new Error('mock: unsupported field op ' + String(op))
  }
}

function matchDoc(doc, where) {
  if (!where) return true
  if (where[CMD]) {
    const op = where[CMD]
    if (op === 'and') return where.val.every((w) => matchDoc(doc, w))
    if (op === 'or') return where.val.some((w) => matchDoc(doc, w))
    throw new Error('mock: unsupported top op ' + String(op))
  }
  return Object.keys(where).every((k) => {
    const cond = where[k]
    if (cond && typeof cond === 'object' && cond[CMD]) return matchCmd(cond, doc[k])
    return doc[k] === cond
  })
}

function makeDb(store) {
  function collection(name) {
    if (!store[name]) store[name] = []
    const rows = () => store[name]
    function query(where, order, lim) {
      return {
        where: (w) => query(where ? cmd('and', [where, w]) : w, order, lim),
        orderBy: (f, dir) => query(where, (order || []).concat([[f, dir]]), lim),
        limit: (n) => query(where, order, n),
        field: () => query(where, order, lim),
        async get() {
          opStats.get++
          let out = rows().filter((d) => matchDoc(d, where))
          for (const [f, dir] of (order || []).slice().reverse()) {
            out.sort((a, b) => {
              const x = a[f], y = b[f]
              const r = x < y ? -1 : x > y ? 1 : 0
              return dir === 'desc' ? -r : r
            })
          }
          if (lim != null) out = out.slice(0, lim)
          return { data: out.map((d) => Object.assign({}, d)) }
        },
        async count() {
          opStats.count++
          return { total: rows().filter((d) => matchDoc(d, where)).length }
        },
        async remove() {
          opStats.bulkRemove++
          const keep = []
          let removed = 0
          // 云开发批量删单次有上限，用 1000 模拟
          for (const d of rows()) {
            if (removed < 1000 && matchDoc(d, where)) { removed++; continue }
            keep.push(d)
          }
          store[name] = keep
          return { stats: { removed } }
        },
        async update() {
          opStats.update++
          return { stats: { updated: 0 } }
        }
      }
    }
    return Object.assign(query(null, null, null), {
      doc: (docId) => ({
        async remove() {
          opStats.remove++
          const before = rows().length
          store[name] = rows().filter((d) => d._id !== docId)
          return { stats: { removed: before - rows().length } }
        },
        async get() {
          opStats.get++
          const d = rows().find((r) => r._id === docId)
          if (!d) throw new Error('document.get document not exists')
          return { data: Object.assign({}, d) }
        },
        async update() { opStats.update++; return { stats: { updated: 1 } } },
        async set() { opStats.update++; return { stats: {} } }
      }),
      async set() { opStats.update++; return { stats: {} } },
      async add({ data }) {
        opStats.add++
        const d = Object.assign({ _id: 'new' + Math.random().toString(36).slice(2) }, data)
        rows().push(d)
        return { _id: d._id }
      }
    })
  }
  return {
    collection,
    command: _,
    serverDate: () => new Date(),
    RegExp: () => ({}),
    async createCollection() { return {} }
  }
}

const store = makeStore()
const db = makeDb(store)
const mockSdk = {
  init() {},
  database: () => db,
  DYNAMIC_CURRENT_ENV: 'test',
  getWXContext: () => ({ OPENID: 'test', APPID: 'test' }),
  async callFunction() { return { result: {} } },
  openapi: {},
  CLOUD_ID: 'x'
}

const axiosStub = function () { throw new Error('mock: axios 不应在 purge 路径被调用') }
axiosStub.get = axiosStub
axiosStub.post = axiosStub
axiosStub.create = () => axiosStub
axiosStub.defaults = { headers: { common: {} } }

const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return mockSdk
  if (request === 'axios') return axiosStub
  return origLoad.apply(this, arguments)
}

const fnPath = path.join(__dirname, '..', 'cloudfunctions', 'sendLaunchReminder', 'index.js')
const fn = require(fnPath)

function ledgerCount(pred) {
  return store.oa_push_ledger.filter(pred).length
}

;(async () => {
  const DAY = 86400000
  const now = Date.now()
  const before = {
    ledger: store.oa_push_ledger.length,
    aged: ledgerCount((d) => d.sentAt < now - 2 * DAY),
    cooling: ledgerCount((d) => d.status === 'failed'),
    history: store.push_history.length
  }
  console.log('初始:', before)

  // —— 1) idle 路径：小批量、不开 junk 扫描 ——
  opStats = { get: 0, count: 0, remove: 0, bulkRemove: 0, add: 0, update: 0 }
  const r1 = await fn.main({ action: 'purgePushJunk', maxRemove: 400, keepDays: 2 })
  console.log('\n[idle 档 maxRemove=400]')
  console.log('  removedAged=%d removedHistory=%d remainingAged=%s done=%s mode=%s',
    r1.removedAged, r1.removedHistory, r1.remainingAged, r1.done, r1.mode)
  const idleOps = Object.assign({}, opStats)
  console.log('  ops=', idleOps)
  console.log('  message=', r1.message)

  // —— 2) 反复跑到清空 ——
  let rounds = 1
  let last = r1
  while (!last.done && rounds < 12) {
    last = await fn.main({ action: 'purgePushJunk', maxRemove: 2000, keepDays: 2 })
    rounds++
  }
  // 过期台账清完后，再跑一次垃圾扫描（凌晨定时就是这个组合）
  const rj = await fn.main({ action: 'purgePushJunk', maxRemove: 500, keepDays: 2 })
  console.log('\n[junk 扫描] removedJunk=%d refusedMarked=%d scanned=%d skippedFreshOk=%d',
    rj.removedJunk, rj.refusedMarked, rj.scanned, rj.skippedFreshOk)

  const after = {
    ledger: store.oa_push_ledger.length,
    aged: ledgerCount((d) => d.sentAt < now - 2 * DAY),
    cooling: ledgerCount((d) => d.status === 'failed'),
    freshOk: ledgerCount((d) => d.status === 'ok' && d.sentAt >= now - 2 * DAY),
    refuseLeft: ledgerCount((d) => /43101/.test(String(d.error || ''))),
    history: store.push_history.length
  }
  console.log('\n[跑 %d 轮后] %j', rounds, after)
  console.log('  最后一轮 done=%s remainingAged=%s', last.done, last.remainingAged)

  // —— 3) dryRun 不应改动数据、且不重复计数 ——
  const snapshot = store.oa_push_ledger.length
  const rd = await fn.main({ action: 'purgePushJunk', dryRun: true, maxRemove: 100, keepDays: 1 })
  console.log('\n[dryRun keepDays=1] removedAged=%d remainingAged=%s 数据未变=%s',
    rd.removedAged, rd.remainingAged, store.oa_push_ledger.length === snapshot)

  // —— 4) 空跑 tick：定时器每 10 分钟都会走这条路，开销必须是常数级 ——
  // 造一个「缓存代际未变」的现场，等价于生产上绝大多数 tick
  store.space_devs_cache = [
    {
      _id: 'api_cache_/launches/upcoming/_{"format":"json","hide_recent_previous":true,"limit":100,"mode":"detailed","offset":0,"ordering":"net"}_slim_v6',
      data: { results: [], count: 0 },
      updatedAtMs: now - 3600 * 1000
    }
  ]
  store.launch_data = [
    { _id: '_sync_meta', signature: '', lastSyncAtMs: now - 60000, total: 0 }
  ]
  opStats = { get: 0, count: 0, remove: 0, bulkRemove: 0, add: 0, update: 0 }
  const tick = await fn.main({})
  const tickOps = Object.assign({}, opStats)
  console.log('\n[空跑 tick] idleSkip=%s', tick.idleSkip)
  console.log('  ops=', tickOps)
  const tickReads = tickOps.get + tickOps.count
  const tickWrites = tickOps.add + tickOps.update + tickOps.remove + tickOps.bulkRemove

  const checks = [
    ['空跑 tick 命中 idle 早退', tick.idleSkip === true],
    ['空跑 tick 读操作 < 30 次', tickReads < 30],
    ['空跑 tick 写操作 < 10 次', tickWrites < 10],
    ['过期台账清空', after.aged === 0],
    ['去重窗口内的 ok 保留', after.freshOk === 500],
    ['冷却中的 failed 未被删', after.cooling === 10],
    ['43101 拒收行已清', after.refuseLeft === 0],
    ['push_history 过期已清', after.history === 30],
    ['idle 档读操作 < 20 次', idleOps.get + idleOps.count < 20],
    ['dryRun 不改数据', store.oa_push_ledger.length === snapshot],
    ['dryRun 计数不超实际', rd.removedAged <= 100]
  ]
  console.log('\n=== 结论 ===')
  let ok = true
  for (const [name, pass] of checks) {
    if (!pass) ok = false
    console.log((pass ? '  绿灯  ' : '  红灯  ') + name)
  }
  console.log(ok ? '\n全部通过' : '\n有未通过项')
  process.exit(ok ? 0 : 1)
})().catch((e) => {
  console.error('运行失败:', e && e.stack ? e.stack : e)
  process.exit(2)
})
