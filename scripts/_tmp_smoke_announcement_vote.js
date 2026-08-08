/**
 * 公告投票全链路桩测试（不触碰真实云资源）：
 * A) 云函数 adminGateway 公开投票接口：首投 / 重复投 / 无效选项 / 未开始 / 已截止 / 无投票公告
 * B) 小程序端 index-live-settle 投票 VM 与点击处理（wx.cloud.callFunction 直连桩云函数 = 真端到端）
 * C) 资源审计：统计整个流程的 DB 读写次数
 */
const path = require('path')

let FAIL = 0
function check(name, cond, extra) {
  if (cond) console.log('  OK  ', name)
  else { console.log('  FAIL', name, extra !== undefined ? '=> ' + JSON.stringify(extra) : ''); FAIL++ }
}

// ---------- wx-server-sdk 桩 ----------
const INC = '__stub_inc__'
const store = new Map() // collection -> Map(_id -> doc)
const dbOps = { read: 0, write: 0 }
function col(name) {
  if (!store.has(name)) store.set(name, new Map())
  return store.get(name)
}
const clone = (o) => JSON.parse(JSON.stringify(o))
function applyUpdate(doc, data) {
  Object.keys(data).forEach((k) => {
    const segs = k.split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s))
    let t = doc
    for (let i = 0; i < segs.length - 1; i++) t = t[segs[i]]
    const last = segs[segs.length - 1]
    const v = data[k]
    if (v && typeof v === 'object' && v[INC] !== undefined) t[last] = (Number(t[last]) || 0) + v[INC]
    else t[last] = v
  })
}
const commandStub = new Proxy({ inc: (n) => ({ [INC]: n }) }, {
  get(t, p) { return t[p] || ((...args) => ({ __cmd: p, args })) }
})
function chain(name) {
  const c = {
    where: () => c, orderBy: () => c, limit: () => c, skip: () => c, field: () => c,
    get: async () => { dbOps.read++; return { data: [] } },
    count: async () => { dbOps.read++; return { total: col(name).size } },
    update: async () => { dbOps.write++; return { stats: { updated: 0 } } },
    remove: async () => { dbOps.write++; return {} }
  }
  return c
}
const dbStub = {
  command: commandStub,
  serverDate: () => new Date(),
  createCollection: async () => ({}),
  collection(name) {
    return {
      ...chain(name),
      add: async ({ data }) => {
        dbOps.write++
        const id = data._id || 'auto_' + Math.random().toString(36).slice(2)
        if (col(name).has(id)) throw new Error('document with _id ' + id + ' already exists')
        col(name).set(id, clone({ ...data, _id: id }))
        return { _id: id }
      },
      doc: (id) => ({
        get: async () => {
          dbOps.read++
          if (!col(name).has(id)) throw new Error('document not exists')
          return { data: clone(col(name).get(id)) }
        },
        update: async ({ data }) => {
          dbOps.write++
          const doc = col(name).get(id)
          if (!doc) throw new Error('document not exists')
          applyUpdate(doc, data)
          return { stats: { updated: 1 } }
        },
        set: async ({ data }) => { dbOps.write++; col(name).set(id, clone({ ...data, _id: id })); return {} },
        remove: async () => { dbOps.write++; col(name).delete(id); return {} }
      })
    }
  }
}
let currentOpenid = 'user_A'
const cloudStub = {
  DYNAMIC_CURRENT_ENV: 'stub-env',
  init() {},
  database: () => dbStub,
  getWXContext: () => ({ OPENID: currentOpenid, UNIONID: '' }),
  callFunction: async () => ({ result: null }),
  uploadFile: async () => ({}),
  getTempFileURL: async () => ({ fileList: [] })
}
process.env.TOKEN_SECRET = 'stub-token-secret-for-local-smoke-test-only-0000'
const gatewayDir = path.resolve(__dirname, '../cloudfunctions/adminGateway')
const sdkPath = require.resolve('wx-server-sdk', { paths: [gatewayDir] })
require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: cloudStub }

const gateway = require(path.join(gatewayDir, 'index.js'))
const callGateway = (evt) => gateway.main(evt, {})

// ---------- 种子数据 ----------
const NOW = Date.now()
const mkVote = (over) => ({
  enabled: true,
  question: '你最期待哪次发射？',
  intro: '介绍文案',
  image: '',
  options: [
    { id: 'optA', label: '星舰 IFT-12', image: 'https://cos.example/a.png', count: 0 },
    { id: 'optB', label: '猎鹰重型', image: '', count: 0 }
  ],
  startTime: 0,
  endTime: 0,
  resultNote: '',
  totalVotes: 0,
  ...over
})
col('system_announcements').set('ann_open', { _id: 'ann_open', title: '公告1', active: true, vote: mkVote() })
col('system_announcements').set('ann_future', { _id: 'ann_future', title: '公告2', active: true, vote: mkVote({ startTime: NOW + 86400000 }) })
col('system_announcements').set('ann_ended', {
  _id: 'ann_ended', title: '公告3', active: true,
  vote: mkVote({
    endTime: NOW - 1000, resultNote: '感谢参与，A 选项胜出',
    options: [
      { id: 'optA', label: 'A', image: '', count: 7 },
      { id: 'optB', label: 'B', image: '', count: 3 }
    ],
    totalVotes: 10
  })
})
col('system_announcements').set('ann_novote', { _id: 'ann_novote', title: '纯文本公告', active: true })

async function testGateway() {
  console.log('== A) 云函数公开投票接口 ==')

  // GET 未投票：不泄露票数
  let r = await callGateway({ path: '/announcement-vote/ann_open', method: 'GET' })
  check('GET 进行中未投票 code=0', r && r.code === 0, r)
  check('GET 未投票 status=open / revealed=false', r.data.status === 'open' && r.data.revealed === false, r.data)
  check('GET 未投票隐藏票数 totalVotes=0', r.data.totalVotes === 0 && r.data.options.every((o) => o.count === 0))

  // 首投
  r = await callGateway({ path: '/announcement-vote', method: 'POST', body: { announcementId: 'ann_open', optionId: 'optA' } })
  check('首投成功 myChoice=optA', r.code === 0 && r.data.myChoice === 'optA', r)
  check('首投后 revealed 且 optA=1 total=1', r.data.revealed === true && r.data.options[0].count === 1 && r.data.totalVotes === 1, r.data)

  // 重复投（同人换选项）：不改结果
  r = await callGateway({ path: '/announcement-vote', method: 'POST', body: { announcementId: 'ann_open', optionId: 'optB' } })
  check('重复投保持原选择 optA', r.code === 0 && r.data.myChoice === 'optA', r && r.data)
  check('重复投票数不变 total=1', r.data.totalVotes === 1 && r.data.options[1].count === 0, r.data)

  // 换用户投另一项
  currentOpenid = 'user_B'
  r = await callGateway({ path: '/announcement-vote', method: 'POST', body: { announcementId: 'ann_open', optionId: 'optB' } })
  check('用户B 投 optB 成功 total=2', r.code === 0 && r.data.myChoice === 'optB' && r.data.totalVotes === 2, r && r.data)

  // 数据库落库核对
  const doc = col('system_announcements').get('ann_open')
  check('DB 主文档计数 optA=1 optB=1 total=2',
    doc.vote.options[0].count === 1 && doc.vote.options[1].count === 1 && doc.vote.totalVotes === 2, doc.vote)
  const recs = col('announcement_vote_records')
  check('投票记录 2 条且 _id 确定性', recs.size === 2 && recs.has('ann_ann_open_user_A') && recs.has('ann_ann_open_user_B'), [...recs.keys()])

  // 无效选项
  currentOpenid = 'user_C'
  r = await callGateway({ path: '/announcement-vote', method: 'POST', body: { announcementId: 'ann_open', optionId: 'nope' } })
  check('无效选项 4001', r.code === 4001, r)

  // 未开始
  r = await callGateway({ path: '/announcement-vote', method: 'POST', body: { announcementId: 'ann_future', optionId: 'optA' } })
  check('未开始投票 4003', r.code === 4003, r)
  r = await callGateway({ path: '/announcement-vote/ann_future', method: 'GET' })
  check('未开始 GET status=notStarted 且隐藏公示语', r.data.status === 'notStarted' && r.data.resultNote === '', r.data)

  // 已截止：公示
  r = await callGateway({ path: '/announcement-vote', method: 'POST', body: { announcementId: 'ann_ended', optionId: 'optA' } })
  check('已截止投票 4003', r.code === 4003, r)
  r = await callGateway({ path: '/announcement-vote/ann_ended', method: 'GET' })
  check('到期公示 revealed + resultNote + 票数', r.data.status === 'ended' && r.data.revealed === true && r.data.resultNote === '感谢参与，A 选项胜出' && r.data.totalVotes === 10, r.data)

  // 无投票公告
  r = await callGateway({ path: '/announcement-vote/ann_novote', method: 'GET' })
  check('无投票公告 4040', r.code === 4040, r)
}

// ---------- 小程序端模块（真端到端：wx.cloud.callFunction 直连桩云函数） ----------
async function testClient() {
  console.log('== B) 小程序端投票 VM 与点击流 ==')
  const storage = {}
  const toasts = []
  global.wx = new Proxy({
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => { storage[k] = v },
    showToast: (o) => toasts.push(o && o.title),
    cloud: {
      callFunction: ({ name, data }) => {
        if (name !== 'adminGateway') return Promise.reject(new Error('unexpected fn ' + name))
        return callGateway(data).then((result) => ({ result }))
      }
    }
  }, { get: (t, p) => (p in t ? t[p] : () => ({})) })
  global.getApp = () => ({ globalData: {} })
  global.getCurrentPages = () => []
  require.async = (p) => Promise.resolve(require(p))

  const mod = require(path.resolve(__dirname, '../subpackages/index-extra/utils/index-live-settle.js'))
  const page = {
    data: { missionSwipeOpenWxkey: '', announcementBanner: null, announcementDialogVisible: false, announcementVote: null },
    setData(d) { Object.assign(this.data, d) },
    closeMissionSwipeCells() {}
  }
  mod.attachTo(page)

  // 打开弹窗：零云调用渲染（用 ann_open 当前 DB 数据模拟直读结果）
  const dbDoc = col('system_announcements').get('ann_open')
  page.data.announcementBanner = { id: 'ann_open', title: '公告1', content: '内容', type: 'info', active: true, vote: clone(dbDoc.vote) }
  const readsBefore = dbOps.read
  page.openAnnouncementDetail()
  check('打开弹窗 0 次 DB/云调用', dbOps.read === readsBefore)
  let vm = page.data.announcementVote
  check('VM 渲染 open 且隐藏票数', vm && vm.status === 'open' && vm.revealed === false && vm.totalVotes === 0, vm)
  check('VM 选项带图', vm.options[0].image === 'https://cos.example/a.png')

  // 点击投票（user_D）
  currentOpenid = 'user_D'
  page.onAnnouncementVoteTap({ currentTarget: { dataset: { optionId: 'optB' } } })
  await new Promise((res) => setTimeout(res, 50))
  vm = page.data.announcementVote
  check('点击后 myChoice=optB 且展示票数', vm.myChoice === 'optB' && vm.revealed === true && vm.totalVotes === 3, vm)
  check('本地存储写入选择', storage.announcementVoteChoices && storage.announcementVoteChoices.ann_open === 'optB', storage)
  check('百分比正确 optB=67%', vm.options[1].percent === 67, vm.options)
  check('投票成功 toast', toasts.indexOf('投票成功') >= 0, toasts)

  // 已投后重开弹窗：仍零云调用，本地缓存直接亮结果
  const reads2 = dbOps.read
  page.data.announcementBanner.vote = clone(col('system_announcements').get('ann_open').vote)
  page.openAnnouncementDetail()
  check('重开弹窗 0 次 DB/云调用', dbOps.read === reads2)
  vm = page.data.announcementVote
  check('重开后本地缓存亮出我的选择', vm.myChoice === 'optB' && vm.revealed === true, vm)

  // 已投后再点：静默忽略，不发请求
  const writes = dbOps.write
  page.onAnnouncementVoteTap({ currentTarget: { dataset: { optionId: 'optA' } } })
  await new Promise((res) => setTimeout(res, 30))
  check('已投后再点不发请求', dbOps.write === writes)

  // 未开始的投票点击：只 toast
  page.data.announcementBanner = { id: 'ann_future', vote: clone(col('system_announcements').get('ann_future').vote) }
  page.openAnnouncementDetail()
  check('未开始 VM timeText 提示开始时间', page.data.announcementVote.status === 'notStarted' && /开始/.test(page.data.announcementVote.timeText), page.data.announcementVote.timeText)
  page.onAnnouncementVoteTap({ currentTarget: { dataset: { optionId: 'optA' } } })
  await new Promise((res) => setTimeout(res, 30))
  check('未开始点击仅提示', toasts.indexOf('投票还未开始') >= 0, toasts)

  // 到期公告：直接公示
  page.data.announcementBanner = { id: 'ann_ended', vote: clone(col('system_announcements').get('ann_ended').vote) }
  page.openAnnouncementDetail()
  vm = page.data.announcementVote
  check('到期弹窗直接公示 70/30', vm.status === 'ended' && vm.revealed === true && vm.options[0].percent === 70 && vm.resultNote === '感谢参与，A 选项胜出', vm)
}

async function main() {
  await testGateway()
  const opsA = { ...dbOps }
  console.log('  · 接口段 DB 消耗: 读', opsA.read, '写', opsA.write)
  await testClient()
  console.log('  · 全程 DB 消耗: 读', dbOps.read, '写', dbOps.write)
  console.log(FAIL ? `\n✗ ${FAIL} 项失败` : '\n✓ ALL GREEN')
  process.exit(FAIL ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
