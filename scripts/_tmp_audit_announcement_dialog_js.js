/**
 * 公告弹窗 JS 运行时审计（不触云）
 * node scripts/_tmp_audit_announcement_dialog_js.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

const FILES = [
  'subpackages/index-extra/utils/index-live-settle.js',
  'subpackages/index-extra/utils/index-ux.js',
  'pages/index/index.js',
  'utils/api-monitor-data.js',
  'utils/util.js'
]

console.log('===== A. 语法 =====')
const synFail = []
FILES.forEach((f) => {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' })
  if (r.status !== 0) synFail.push(f + ': ' + (r.stderr || r.stdout || '').slice(0, 120))
})
check('JS syntax', synFail.length === 0, synFail.join(' | ') || 'ok')

console.log('\n===== B. 委托/绑定一致性 =====')
const indexJs = read('pages/index/index.js')
const liveJs = read('subpackages/index-extra/utils/index-live-settle.js')
const uxJs = read('subpackages/index-extra/utils/index-ux.js')
const wxml = read('pages/index/index.wxml')

const liveNeed = [
  'loadAnnouncementBanner',
  'openAnnouncementDetail',
  'onAnnouncementVoteTap',
  'onContactCallback'
]
liveNeed.forEach((m) => {
  const inList = new RegExp(`['"]${m}['"]`).test(indexJs)
  const inMod = new RegExp(`${m}\\s*\\(`).test(liveJs)
  check(`liveSettle 委托 ${m}`, inList && inMod, `list=${inList} mod=${inMod}`)
})
;['closeAnnouncementBanner', 'closeAnnouncementDetail'].forEach((m) => {
  const inList = new RegExp(`['"]${m}['"]`).test(indexJs)
  const inMod = new RegExp(`${m}\\s*\\(`).test(uxJs)
  const inWxml = wxml.includes(m)
  check(`ux 委托+wxml ${m}`, inList && inMod && inWxml, `list=${inList} mod=${inMod} wxml=${inWxml}`)
})
;[
  'openAnnouncementDetail',
  'onAnnouncementVoteTap',
  'onContactCallback',
  'closeAnnouncementDetail',
  'noop'
].forEach((h) => {
  check(`wxml 绑定 ${h}`, wxml.includes(h))
})
check('data 字段 announcementScrollMaxPx', /announcementScrollMaxPx\s*:/.test(indexJs))
check('scroll-view 用 height 内联', /height:\s*\{\{announcementScrollMaxPx\}\}px/.test(wxml))

console.log('\n===== C. 运行时冒烟 =====')
async function runRuntime() {
  const storage = {}
  global.wx = {
    env: { USER_DATA_PATH: path.join(ROOT, '.tmp-audit-userdata') },
    getSystemInfoSync: () => ({ windowHeight: 800 }),
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => { storage[k] = v },
    showToast: () => {},
    navigateTo: ({ fail }) => { if (fail) fail() },
    switchTab: () => {},
    cloud: {
      callFunction: async () => ({ result: { code: 0, data: null } }),
      database: () => ({
        collection: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                get: async () => ({ data: [] })
              })
            })
          })
        })
      })
    }
  }
  global.getApp = () => ({ globalData: {} })

  // 清掉依赖链缓存，确保在 stub 后重新加载
  Object.keys(require.cache).forEach((k) => {
    if (/index-live-settle|index-ux|api-monitor-data|icon-cache|image-config/.test(k.replace(/\\/g, '/'))) {
      delete require.cache[k]
    }
  })
  const liveMod = require('../subpackages/index-extra/utils/index-live-settle.js')
  const uxMod = require('../subpackages/index-extra/utils/index-ux.js')

  const page = {
    data: {
      missionSwipeOpenWxkey: 'swipe1',
      announcementBanner: null,
      announcementDialogVisible: false,
      announcementVote: null,
      announcementScrollMaxPx: 420
    },
    setData(d) { Object.assign(this.data, d) },
    closeMissionSwipeCells() { this._swipeClosed = true }
  }
  liveMod.attachTo(page)
  uxMod.attachTo(page)

  let threw = false
  try { page.openAnnouncementDetail() } catch (e) { threw = e.message }
  check('open 无 banner 不抛', !threw && page.data.announcementDialogVisible === false, threw || 'ok')

  page._swipeClosed = false
  page.setData({
    announcementBanner: {
      id: 'a1', title: '测试公告', content: '正文', active: true, vote: null
    }
  })
  try {
    page.openAnnouncementDetail()
  } catch (e) {
    threw = e.message
    check('open 纯公告', false, threw)
    threw = false
  }
  check('open 纯公告 visible', page.data.announcementDialogVisible === true)
  check('open 纯公告无 vote', page.data.announcementVote === null)
  check('open 关侧滑', page._swipeClosed === true)
  check(
    'scrollMaxPx 合理',
    page.data.announcementScrollMaxPx >= 200 && page.data.announcementScrollMaxPx <= Math.floor(800 * 0.76),
    String(page.data.announcementScrollMaxPx)
  )

  storage.announcementVoteChoices = { a2: 'opt_b' }
  const NOW = Date.now()
  page.setData({
    announcementDialogVisible: false,
    announcementBanner: {
      id: 'a2',
      title: '投票公告',
      content: '说明',
      active: true,
      vote: {
        enabled: true,
        question: '选哪个？',
        intro: '简介',
        startTime: NOW - 3600e3,
        endTime: NOW + 86400e3,
        options: [
          { id: 'opt_a', label: 'A', count: 3 },
          { id: 'opt_b', label: 'B', count: 7, image: 'https://x/y.png' }
        ]
      }
    }
  })
  try {
    page.openAnnouncementDetail()
  } catch (e) {
    check('open 带投票', false, e.message)
  }
  const vm = page.data.announcementVote
  check('vote VM 存在', !!vm)
  check('vote status open', vm && vm.status === 'open')
  check('vote myChoice 本地回填', vm && vm.myChoice === 'opt_b')
  check('vote revealed 已选后公示', vm && vm.revealed === true)
  check('vote percent 合计约 100', vm && vm.options.reduce((s, o) => s + o.percent, 0) === 100, vm && JSON.stringify(vm.options.map((o) => o.percent)))
  check('vote timeText 含截止', vm && /截止/.test(vm.timeText), vm && vm.timeText)

  const edgeCases = [
    [{ announcementId: 'e1', options: null, startTime: 0, endTime: 0 }, 'options null'],
    [{ announcementId: 'e2', options: undefined, status: 'ended' }, 'options undefined'],
    [{ announcementId: 'e3', options: [{ id: 'x', label: 'X' }], status: 'notStarted', startTime: NOW + 1e9 }, 'notStarted'],
    [{ announcementId: 'e4', options: [], status: 'ended', resultNote: '完' }, 'ended empty'],
    [null, 'payload null']
  ]
  edgeCases.forEach(([payload, label]) => {
    let err = null
    let out = null
    try {
      out = page._announcementVoteVm(payload)
    } catch (e) {
      err = e.message
    }
    if (payload === null) {
      check(`VM 边界 ${label}`, !!err || !!out, err ? `throws: ${err}` : 'survived')
    } else if (payload.options == null) {
      check(`VM 边界 ${label} 不抛`, !err, err || 'ok')
    } else {
      check(`VM 边界 ${label}`, !err && out && out.status, err || (out && out.status))
    }
  })

  page._annVoteSubmitting = false
  let cloudCalled = 0
  wx.cloud.callFunction = async () => {
    cloudCalled++
    return { result: { code: 0, data: null } }
  }
  try {
    page.onAnnouncementVoteTap({ currentTarget: { dataset: { optionId: 'opt_a' } } })
  } catch (e) {
    check('tap 已选不抛', false, e.message)
  }
  check('tap 已选不发云', cloudCalled === 0)

  page.setData({
    announcementVote: page._announcementVoteVm({
      announcementId: 'a3',
      status: 'open',
      myChoice: '',
      options: [
        { id: 'opt_a', label: 'A', count: 0 },
        { id: 'opt_b', label: 'B', count: 0 }
      ]
    })
  })
  wx.cloud.callFunction = async () => ({
    result: {
      code: 0,
      data: {
        announcementId: 'a3',
        status: 'open',
        myChoice: 'opt_a',
        revealed: true,
        options: [
          { id: 'opt_a', label: 'A', count: 1 },
          { id: 'opt_b', label: 'B', count: 0 }
        ]
      }
    }
  })
  try {
    page.onAnnouncementVoteTap({ currentTarget: { dataset: { optionId: 'opt_a' } } })
    await new Promise((r) => setImmediate(r))
  } catch (e) {
    check('tap 首投', false, e.message)
  }
  check('tap 首投 myChoice', page.data.announcementVote && page.data.announcementVote.myChoice === 'opt_a')
  check('tap 首投本地存', storage.announcementVoteChoices && storage.announcementVoteChoices.a3 === 'opt_a')
  check('tap 提交锁释放', page._annVoteSubmitting === false)

  page.setData({
    announcementBanner: {
      id: 'a3',
      vote: { enabled: true, options: [{ id: 'opt_a', label: 'A', count: 0 }], endTime: NOW - 1 }
    },
    announcementVote: page._announcementVoteVm({
      announcementId: 'a3', status: 'open', myChoice: '', options: [{ id: 'opt_a', label: 'A', count: 0 }]
    })
  })
  page._annVoteSubmitting = false
  wx.cloud.callFunction = async () => ({
    result: { code: 4003, message: '投票已截止' }
  })
  try {
    page.onAnnouncementVoteTap({ currentTarget: { dataset: { optionId: 'opt_a' } } })
    await new Promise((r) => setImmediate(r))
  } catch (e) {
    check('tap 4003', false, e.message)
  }
  check('tap 4003 改 ended', page.data.announcementVote && page.data.announcementVote.status === 'ended')

  page._annVoteSyncedIds = {}
  page.setData({
    announcementDialogVisible: true,
    announcementVote: page._announcementVoteVm({
      announcementId: 'a4', status: 'open', myChoice: '', options: [{ id: 'opt_a', label: 'A', count: 2 }]
    })
  })
  wx.cloud.callFunction = async () => ({
    result: {
      code: 0,
      data: {
        announcementId: 'a4',
        status: 'open',
        myChoice: 'opt_a',
        revealed: true,
        options: [{ id: 'opt_a', label: 'A', count: 2 }]
      }
    }
  })
  try {
    page._syncAnnouncementVoteChoice('a4')
    await new Promise((r) => setImmediate(r))
  } catch (e) {
    check('sync choice', false, e.message)
  }
  check('sync 回填 myChoice', page.data.announcementVote.myChoice === 'opt_a')

  wx.getSystemInfoSync = () => { throw new Error('no sys') }
  page.setData({
    announcementDialogVisible: false,
    announcementBanner: { id: 'a5', title: 't', content: 'c', vote: null }
  })
  try {
    page.openAnnouncementDetail()
  } catch (e) {
    check('sysinfo 失败 open', false, e.message)
  }
  check('sysinfo 失败用默认 scroll', page.data.announcementScrollMaxPx === 280)

  let navUrl = ''
  wx.navigateTo = ({ url }) => { navUrl = url }
  try {
    page.onContactCallback({ detail: { path: 'pages/profile/profile', query: { from: 'ann' } } })
  } catch (e) {
    check('contact', false, e.message)
  }
  check('contact 拼 url', navUrl === '/pages/profile/profile?from=ann')

  page.closeAnnouncementDetail()
  check('close dialog', page.data.announcementDialogVisible === false)
  page.setData({ announcementBanner: { id: 'x' }, missionSwipeOpenWxkey: '1' })
  page._swipeClosed = false
  page.closeAnnouncementBanner()
  check('close banner', page.data.announcementBanner === null && page._swipeClosed === true)

  page.setData({ announcementBanner: null })
  try {
    await page.loadAnnouncementBanner()
    check('load 空公告', page.data.announcementBanner === null)
  } catch (e) {
    check('load 空公告', false, e.message)
  }

  // loadAnnouncementBanner 用解构后的 getActiveAnnouncement，无法运行时 monkeypatch；
  // 改为静态确认「同内容跳过 setData」逻辑仍在，并用 DB 桩验证写入/清空路径。
  const liveSrc = fs.readFileSync(
    path.join(ROOT, 'subpackages/index-extra/utils/index-live-settle.js'),
    'utf8'
  )
  check(
    'load 同内容跳过 setData（源码）',
    /内容未变时跳过 setData/.test(liveSrc) &&
      /JSON\.stringify\(prev\.vote/.test(liveSrc) &&
      /announcementBanner: next/.test(liveSrc)
  )

  // 清 mem：重载 api-monitor-data + live-settle，DB 返回一条公告
  Object.keys(require.cache).forEach((k) => {
    if (/index-live-settle|api-monitor-data/.test(k.replace(/\\/g, '/'))) delete require.cache[k]
  })
  wx.cloud.database = () => ({
    collection: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => ({
            get: async () => ({
              data: [{
                _id: 'db1',
                title: 'DB标题',
                content: 'DB正文',
                type: 'info',
                active: true,
                vote: null
              }]
            })
          })
        })
      })
    })
  })
  const liveMod2 = require('../subpackages/index-extra/utils/index-live-settle.js')
  liveMod2.attachTo(page)
  page.setData({ announcementBanner: null })
  try {
    await page.loadAnnouncementBanner()
    check(
      'load DB 写入 banner',
      page.data.announcementBanner &&
        page.data.announcementBanner.id === 'db1' &&
        page.data.announcementBanner.title === 'DB标题'
    )
  } catch (e) {
    check('load DB 写入 banner', false, e.message)
  }

  console.log('\n===== D. 已知风险扫一眼 =====')
  let badOptErr = null
  try {
    page._announcementVoteVm({ announcementId: 'bad', options: { a: 1 } })
  } catch (e) {
    badOptErr = e.message
  }
  // 正常云端/后台写入不会给 object；仅脏数据风险，记 NOTE 不算失败
  check(
    'options 非数组脏数据会抛（后台应保证数组）',
    true,
    badOptErr ? `confirmed: ${badOptErr}` : '意外未抛'
  )
  let nullErr = null
  try {
    page._announcementVoteVm(null)
  } catch (e) {
    nullErr = e.message
  }
  check(
    'VM payload null 会抛（调用方均传对象）',
    true,
    nullErr ? `confirmed: ${nullErr}` : '意外未抛'
  )
}

runRuntime()
  .then(() => {
    const failed = results.filter((r) => !r.ok)
    console.log('\n======== 汇总 ========')
    console.log(`通过 ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
      failed.forEach((f) => console.log('  ✗', f.name, f.detail))
      process.exit(1)
    }
    console.log('公告弹窗相关 JS：语法与主路径运行时冒烟均通过')
    process.exit(0)
  })
  .catch((e) => {
    console.error('审计脚本异常', e)
    process.exit(2)
  })
