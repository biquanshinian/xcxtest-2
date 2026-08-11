/**
 * 观礼商家列表（C 端）
 * - 有 missionId：展示该发射任务下全部可预约商家，用户点选后再进详情
 * - 无 missionId：展示当前开放的观礼场次（我的/冷启动）；
 *   多个发射任务同时开放时按任务分组展示，并提供任务筛选标签
 */
const pageBase = require('../../utils/page-base.js')
const watchParty = require('./utils/api.js')
const { getRocketImage } = require('../../utils/util.js')
const rocketArtUtil = require('../../utils/rocket-config-art.js')
const { guardWatchPartyPage } = require('../../utils/watch-party-feature.js')
const { rocketNameZh } = require('./utils/rocket-name-zh.js')

function resolveRocketImage(session) {
  // 优先用商家自动获取任务时锁定的 rocketImageName：手动改火箭名不换配置图
  const lockName = session && session.rocketImageName ? String(session.rocketImageName).trim() : ''
  const name = lockName || (session && session.rocketName ? String(session.rocketName).trim() : '')
  return name ? (getRocketImage(name) || '') : ''
}

function serviceLabels(services) {
  if (!Array.isArray(services)) return []
  return services.map((s) => {
    if (!s) return ''
    if (typeof s === 'string') return s
    return s.label || s.name || s.id || ''
  }).filter(Boolean).slice(0, 4)
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function formatLaunchTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 预约截止时刻：优先云端 reserveCloseAt，旧数据兜底发射前 30 分钟（与云端对齐） */
function reserveCloseAtOf(session) {
  const server = Number(session && session.reserveCloseAt) || 0
  if (server > 0) return server
  const t = session && session.launchTime ? Date.parse(session.launchTime) : NaN
  if (!t || isNaN(t)) return 0
  return t - 30 * 60 * 1000
}

/** 预约状态三态：预约中 / 预约截止（发射前30分钟）/ 停止预约（商家手动关） */
function reserveStatusOf(session) {
  if (session && session.status !== 'open') return { statusType: 'off', statusLabel: '停止预约' }
  const closeAt = reserveCloseAtOf(session)
  if (closeAt > 0 && Date.now() >= closeAt) return { statusType: 'closed', statusLabel: '预约截止' }
  return { statusType: 'open', statusLabel: '预约中' }
}

/** 任务分组键：优先 missionId；老数据缺 id 时退化到 火箭+任务名，避免不同任务并进一组 */
function missionKeyOf(row) {
  const mid = row && row.missionId ? String(row.missionId).trim() : ''
  if (mid) return 'm:' + mid
  const name = [
    row && row.rocketName ? String(row.rocketName).trim() : '',
    row && row.missionName ? String(row.missionName).trim() : ''
  ].filter(Boolean).join('|')
  return name ? 'n:' + name : 'none'
}

/**
 * 分组/页头标题：只显示火箭中文名（任务名不上屏，英文任务名尤其不出现）。
 * 无火箭名时兜底商家自定义中文任务名，再兜底占位文案。
 */
function missionTitleOf(row) {
  const rocket = row && row.rocketName ? String(row.rocketName).trim() : ''
  if (rocket) return rocketNameZh(rocket)
  const zhMission = row && row.missionDisplayName ? String(row.missionDisplayName).trim() : ''
  return zhMission || '未关联发射任务'
}

/** 按发射任务分组；发射窗口临近的任务靠前，无窗口的殿后（组内保持接口顺序） */
function buildMissionGroups(sessions) {
  const map = Object.create(null)
  const groups = []
  ;(sessions || []).forEach((row) => {
    if (!row) return
    const key = missionKeyOf(row)
    let group = map[key]
    if (!group) {
      group = { key, title: missionTitleOf(row), launchTimeText: '', launchTs: 0, sessions: [] }
      map[key] = group
      groups.push(group)
    }
    const ts = row.launchTime ? Date.parse(row.launchTime) : NaN
    if (ts && !isNaN(ts) && (!group.launchTs || ts < group.launchTs)) {
      group.launchTs = ts
      if (row.launchTimeText) group.launchTimeText = row.launchTimeText
    }
    if (!group.launchTimeText && row.launchTimeText) group.launchTimeText = row.launchTimeText
    group.sessions.push(row)
  })
  // 日期短文案（8月10日）：同名火箭多任务时用于筛选标签消歧
  groups.forEach((g) => {
    g.dateText = String(g.launchTimeText || '').split(' ')[0] || ''
  })
  groups.sort((a, b) => {
    const ta = groupSortTs(a)
    const tb = groupSortTs(b)
    if (ta !== tb) return ta < tb ? -1 : 1
    return String(a.title).localeCompare(String(b.title), 'zh')
  })
  return groups
}

function groupSortTs(group) {
  return group && group.launchTs ? group.launchTs : Number.MAX_SAFE_INTEGER
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/index/index',

  data: {
    loading: true,
    error: '',
    missionId: '',
    missionTitle: '',
    sessions: [],
    groups: [],
    multiMission: false,
    missionFilters: [],
    activeMissionKey: ''
  },

  onLoad(options) {
    this.initUiShell()
    try {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] })
    } catch (e) {}
    this._options = options || {}
    this._missionId = String((options && options.missionId) || '').trim()
    this._channel = String((options && options.channel) || '').trim() || 'list'
    this.setData({ missionId: this._missionId })
    guardWatchPartyPage(this).then((ok) => {
      if (!ok || this._unloaded) return
      this.loadList()
    })
  },

  onUnload() {
    this._unloaded = true
  },

  onShow() {
    if (typeof this.syncTheme === 'function') this.syncTheme()
    rocketArtUtil.applyRocketConfigArtIfNeeded(this)
  },

  refreshRocketConfigArt() {
    const sessions = this.data.sessions
    if (!Array.isArray(sessions) || !sessions.length) return
    let mutated = false
    const next = sessions.map((row) => {
      if (!row) return row
      const img = resolveRocketImage(row)
      if (img === row.rocketImage) return row
      mutated = true
      return Object.assign({}, row, { rocketImage: img })
    })
    if (mutated) this._safeSetData({ sessions: next, groups: buildMissionGroups(next) })
  },

  /** 多任务时点任务标签筛选商家；key 为空表示「全部」 */
  onMissionFilterTap(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset
      ? String(e.currentTarget.dataset.key || '')
      : ''
    if (key === this.data.activeMissionKey) return
    this.setData({ activeMissionKey: key })
  },

  _safeSetData(patch) {
    if (this._unloaded) return
    this.setData(patch)
  },

  onRetry() {
    this.loadList()
  },

  loadList() {
    this.setData({ loading: true, error: '' })
    const params = {}
    if (this._missionId) params.missionId = this._missionId
    watchParty.fetchPublicSessions(params).then((res) => {
      if (this._unloaded) return
      const raw = (res && Array.isArray(res.list)) ? res.list : []
      const sessions = raw.map((s) => {
        const row = Object.assign({}, s, reserveStatusOf(s))
        row.rocketImage = resolveRocketImage(row)
        row.services = serviceLabels(row.services)
        row.launchTimeText = formatLaunchTime(row.launchTime)
        return row
      })
      const groups = buildMissionGroups(sessions)
      const multiMission = groups.length > 1
      // 单任务才展示页头标题（火箭中文名）；多任务混排时改为分组 + 筛选
      const missionTitle = groups.length === 1 ? groups[0].title : ''
      // 同名火箭多任务时，筛选标签追加发射日期消歧
      const titleDup = Object.create(null)
      groups.forEach((g) => { titleDup[g.title] = (titleDup[g.title] || 0) + 1 })
      const missionFilters = multiMission
        ? groups.map((g) => ({
            key: g.key,
            label: titleDup[g.title] > 1 && g.dateText ? g.title + ' · ' + g.dateText : g.title,
            count: g.sessions.length
          }))
        : []
      // 刷新后若原筛选任务仍在则保留，否则回到「全部」
      const prevKey = this.data.activeMissionKey
      const activeMissionKey = multiMission && prevKey && groups.some((g) => g.key === prevKey)
        ? prevKey
        : ''
      this._safeSetData({
        loading: false,
        sessions,
        groups,
        multiMission,
        missionFilters,
        activeMissionKey,
        missionTitle,
        // 多任务列表不锚定单一任务：分享/展示只在明确单任务时带 missionId
        missionId: this._missionId || (multiMission ? '' : (res && res.missionId) || '')
      })
    }).catch((err) => {
      this._safeSetData({
        loading: false,
        error: (err && err.message) || '加载失败，请重试'
      })
    })
  },

  onSelect(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : ''
    if (!id) return
    wx.navigateTo({
      url: '/subpackages/watch-party/watch-party?sessionId=' +
        encodeURIComponent(id) +
        '&channel=' + encodeURIComponent(this._channel || 'list')
    })
  },

  onGoMerchant() {
    wx.navigateTo({ url: '/subpackages/watch-party/merchant' })
  },

  /** 顾客可分享商家列表（带 missionId 精确落地本任务的商家选择页） */
  onShareAppMessage() {
    const missionTitle = String(this.data.missionTitle || '').trim()
    const mid = String(this.data.missionId || this._missionId || '').trim()
    const path = mid
      ? '/subpackages/watch-party/merchant-list?missionId=' + encodeURIComponent(mid) + '&channel=share'
      : '/subpackages/watch-party/merchant-list?channel=share'
    return {
      title: missionTitle
        ? missionTitle + '｜现场观礼商家任选，免费预约'
        : '火箭发射现场观礼，多家商家免费预约',
      path
    }
  },

  onShareTimeline() {
    const missionTitle = String(this.data.missionTitle || '').trim()
    const mid = String(this.data.missionId || this._missionId || '').trim()
    return {
      title: missionTitle
        ? missionTitle + '｜现场观礼商家任选，免费预约'
        : '火箭发射现场观礼，多家商家免费预约',
      query: mid
        ? 'missionId=' + encodeURIComponent(mid) + '&channel=timeline'
        : 'channel=timeline'
    }
  }
})
