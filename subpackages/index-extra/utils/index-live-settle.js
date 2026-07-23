/**
 * subpackages/index-extra/utils/index-live-settle.js
 * 首页「发射结算 / 实况状态 / 视频号直播 / 低频加载」逻辑（从 pages/index/index.js 拆出）：
 * - 结算流水线：到期任务落历史、静默结算 NET 已过任务、延期(NET 后移)修正、重过滤即将发射
 * - T-0 实况：LL2 状态确认(_checkLiveLaunchStatus)、updates 终态推断、复查定时器编排
 * - 视频号直播：状态探测/轮询/头像点击进直播（channels-live 分包模块跨分包 require.async）
 * - 低频 loader：封路通知、系统公告、SpaceX 官网统计、media_assets 火箭图回灌
 *
 * 主包 index.js 通过 require.async + attachTo 委托加载（与 index-carousel 等模式一致）；
 * 首页在 preloadRule 中预下载 index-extra 分包。所有主包调用点均为语句式（无同步返回值依赖），
 * 首次调用最多延后一次分包加载的时间，且这些路径本就是异步补偿/用户点击触发。
 *
 * 跨边界共享的实例属性（均挂在 page 实例上，attach 后可直接读写）：
 * _statusRecheckTimer / _launchStatusPolling / _lastExpiredRoundAt
 * / _lastExpiredRoundAt（主包 _onCountdownExpired、onHide、_clearLiveStatusPolling 也读写）；
 * _channelsLivePollTimer（主包 _clearCountdownChannelsLivePoll 清理）。
 */
const { getRoadClosureNotice } = require('../../../utils/api-road-closure.js')
const { getActiveAnnouncement } = require('../../../utils/api-monitor-data.js')
const {
  getSpaceXLaunchStats,
  fetchLiveLaunchStatuses,
  fetchLl2LaunchUpdates,
  resolveLaunchStatuses
} = require('../../../utils/api-app-services.js')
const { inferTerminalStatusFromUpdates, buildSettledRowFromUpdates } = require('./ll2-updates-outcome.js')
const { computeLaunchDelayInfo } = require('./launch-delay.js')
const { getStatusCategory, getStatusBadgeText, isTerminalStatusId } = require('../../../utils/api-request.js')
const { isLiveEntryAllowed } = require('../../../utils/feature-flags.js')
const { resolveRoadClosureStatus } = require('../../../utils/progress-road-closure.js')
const {
  filterExpiredMissions,
  getStatusTextZh
} = require('../../../utils/index-page-helpers.js')
const {
  formatDate,
  resolveMissionRocketImage,
  shouldReplaceRocketImage
} = require('../../../utils/util.js')
const {
  formatHomeLaunchTimeParts,
  buildCurrentLaunchPanelState,
  collectPastNetUpcomingHeads,
  buildUpcomingLaunchEmptyState
} = require('../../../utils/index-launch-state.js')
const windowMachine = require('../../../utils/countdown-window-machine.js')
const { attachMissionDetailMeta } = require('../../../utils/index-mission-nav.js')
const { buildMissionListSetData } = require('../../../utils/index-mission-services.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const config = require('../../../utils/config.js')

/** 视频号 finderUserName（与主包 index.js 同名函数保持一致） */
function getLiveFinderUserNameFromConfig() {
  const cfg = (config && config.channelsLive) || {}
  return String(cfg.finderUserName || '').trim()
}

// 复查节奏统一由 utils/countdown-window-machine.js 决策；此处仅留兜底默认值
const LIVE_STATUS_RECHECK_MS = 5 * 60 * 1000
/** 窗口后未决慢探间隔（与状态机 POST_WINDOW_RECHECK_MS 对齐） */
const LIVE_STATUS_UNRESOLVED_RECHECK_MS = windowMachine.POST_WINDOW_RECHECK_MS
const LL2_UPDATES_MEM_TTL_MS = 5 * 60 * 1000
const ROAD_CLOSURE_REFRESH_TTL = 5 * 60 * 1000
const SPACEX_STATS_REFRESH_TTL = 10 * 60 * 1000

/** 可落历史并切下一个：终态(3/4/7/9) 或飞行中(6)（与主包 index.js 同名函数保持一致） */
function isSettleableLiveStatusId(id) {
  const n = id != null ? Number(id) : 0
  return isTerminalStatusId(n) || n === 6
}

/** 视频号直播（分包懒加载，与详情页同源） */
const CHANNELS_LIVE_PATH = '../../shared/utils/channels-live.js'
const CHANNELS_LIVE_POLL_LIVE_MS = 75 * 1000
const CHANNELS_LIVE_POLL_IDLE_MS = 4 * 60 * 1000
/** 点击圆图进直播前的过渡动画时长（与 CSS cd-live-enter 对齐） */
const CHANNELS_LIVE_ENTER_MS = 220
let _channelsLiveMod = null
let _channelsLiveLoadPromise = null

function loadChannelsLiveModule() {
  if (_channelsLiveMod) return Promise.resolve(_channelsLiveMod)
  if (_channelsLiveLoadPromise) return _channelsLiveLoadPromise
  _channelsLiveLoadPromise = require
    .async(CHANNELS_LIVE_PATH)
    .then((mod) => {
      _channelsLiveMod = mod
      return mod
    })
    .catch((err) => {
      _channelsLiveLoadPromise = null
      throw err
    })
    .finally(() => {
      if (_channelsLiveMod) _channelsLiveLoadPromise = null
    })
  return _channelsLiveLoadPromise
}

const methods = {
  /**
   * 倒计时若正停在「已可落库」任务上：同一拍切走并写入历史，不给人闪一下的机会。
   */
  _scrubKnownSettleableCountdown() {
    const ld = this.data.launchData
    const curId = ld && ld.id != null ? String(ld.id) : ''
    if (!curId || !this._isKnownSettleableId(curId)) return

    const peeled = this._peelKnownSettleableFromUpcoming(this.data.upcomingMissions || [])
    const next = this._resolveCountdownPanelMission(peeled.upcoming, Date.now()).panelMission
    const patch = {
      upcomingMissions: peeled.upcoming
    }
    if (peeled.completedAdds.length) {
      const addIds = new Set(peeled.completedAdds.map((c) => String(c.id)))
      patch.completedMissions = peeled.completedAdds.concat(
        (this.data.completedMissions || []).filter((m) => m && m.id != null && !addIds.has(String(m.id)))
      )
    }
    this.applyUpcomingAgencyFilterToPatch(patch)
    if (next) {
      Object.assign(
        patch,
        buildCurrentLaunchPanelState({
          mission: next,
          formatDate,
          getStatusTextZh,
          subscribedIdSet: this._getPageSubscribedIdSet()
        })
      )
    } else {
      Object.assign(
        patch,
        buildUpcomingLaunchEmptyState({
          message: '暂无即将发射的任务',
          upcomingListState: {}
        })
      )
    }
    this.setData(patch, () => {
      try {
        this.scheduleUpcomingAgencyChipsOverflowHint()
      } catch (e) {}
      if (next) {
        try {
          this.applyLaunchSwitchEffects(next)
        } catch (e2) {}
        try {
          this.updateCountdown()
        } catch (e3) {}
      } else {
        try {
          this.resetVoteData()
        } catch (e4) {}
      }
      try {
        this._syncCountdownOverlapSideCard()
      } catch (eSide) {}
      if (patch.completedMissions) {
        try {
          this.updateMissionListView('completed', patch.completedMissions)
        } catch (e5) {}
      }
    })
  },

  /** 用当前 settled 再滤一遍即将发射；若倒计时仍是已落库任务则同拍切走 */
  _refilterUpcomingAgainstSettled() {
    const list = this.data.upcomingMissions || []
    const peeled = this._peelKnownSettleableFromUpcoming(list)
    const filtered = peeled.upcoming
    const curId = this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
    const curSettleable = curId && this._isKnownSettleableId(curId)
    if (filtered.length === list.length && !peeled.completedAdds.length && !curSettleable) return

    const patch = { upcomingMissions: filtered }
    if (peeled.completedAdds.length) {
      const addIds = new Set(peeled.completedAdds.map((c) => String(c.id)))
      patch.completedMissions = peeled.completedAdds.concat(
        (this.data.completedMissions || []).filter((m) => m && m.id != null && !addIds.has(String(m.id)))
      )
    }
    this.applyUpcomingAgencyFilterToPatch(patch)

    if (curSettleable || (curId && !filtered.some((m) => m && String(m.id) === curId))) {
      const next = this._resolveCountdownPanelMission(filtered, Date.now()).panelMission
      if (next) {
        Object.assign(
          patch,
          buildCurrentLaunchPanelState({
            mission: next,
            formatDate,
            getStatusTextZh,
            subscribedIdSet: this._getPageSubscribedIdSet()
          })
        )
      } else {
        Object.assign(
          patch,
          buildUpcomingLaunchEmptyState({
            message: '暂无即将发射的任务',
            upcomingListState: {}
          })
        )
      }
    }

    this.setData(patch, () => {
      try {
        this.scheduleUpcomingAgencyChipsOverflowHint()
      } catch (e) {}
      if (patch.launchData && patch.launchData.id) {
        try {
          this.applyLaunchSwitchEffects(patch.launchData)
        } catch (e2) {}
        try {
          this.updateCountdown()
        } catch (e3) {}
      }
      try {
        this._syncCountdownOverlapSideCard()
      } catch (eSide) {}
      if (patch.completedMissions) {
        try {
          this.updateMissionListView('completed', patch.completedMissions)
        } catch (e4) {}
      }
    })
  },

  // ========== 倒计时卡片推迟徽标 ==========
  /**
   * 拉取当前任务的 LL2 updates 并计算推迟徽标文案。
   * - 任务切换（launchId 变化）时先清空徽标再拉取；
   * - 同一任务 + 同一 NET 重复触发（如快速包→完整包两阶段首屏）直接跳过；
   * - 本地缓存 30 分钟（key 带 launchId），命中且 NET 未变时不打云函数；
   * - 无数据 / 无推迟 / 请求失败时徽标置空。
   */
  refreshLaunchDelayInfo(launchId, launchTime) {
    const id = String(launchId || '')
    const net = String(launchTime || '')

    // 任务切换：先清空旧徽标，避免残留上一个任务的推迟信息
    if (this._launchDelayRenderedId !== id && this.data.launchDelayText) {
      this.setData({ launchDelayText: '' })
    }
    if (!id || !net) {
      this._launchDelayRenderedId = ''
      this._launchDelayLoadedKey = ''
      return
    }

    // 同一任务同一 NET 已加载或正在加载：跳过（NET 改期后 key 变化会重新计算）
    const loadKey = id + '|' + net
    if (this._launchDelayLoadedKey === loadKey) return
    this._launchDelayLoadedKey = loadKey

    const DELAY_CACHE_TTL_MS = 30 * 60 * 1000
    const cacheKey = '_launch_delay_' + id

    // 先查本地缓存：30 分钟内且 NET 未变直接复用，不打云函数
    try {
      const cached = wx.getStorageSync(cacheKey)
      if (cached && cached.net === net && Date.now() - (cached.ts || 0) < DELAY_CACHE_TTL_MS) {
        this._launchDelayRenderedId = id
        this.setData({ launchDelayText: cached.text || '' })
        return
      }
    } catch (e) {}

    // 与终态旁路共用内存 updates（5 分钟）
    const mem = this._ll2UpdatesMem
    if (
      mem &&
      mem.id === id &&
      Array.isArray(mem.list) &&
      mem.limit >= 15 &&
      Date.now() - (mem.at || 0) < LL2_UPDATES_MEM_TTL_MS
    ) {
      const info = computeLaunchDelayInfo(mem.list, net)
      try {
        wx.setStorageSync(cacheKey, { net: net, text: info.text, ts: Date.now() })
      } catch (e) {}
      this._launchDelayRenderedId = id
      this.setData({ launchDelayText: info.text })
      return
    }

    // 优先读云库 updates_{uuid}（6h 拆分 / 热路径缓存），命中则 0 云函数、0 LL2
    this._tryLaunchDelayFromUpdatesCache(id, net, loadKey, cacheKey)
  },

  /**
   * 先读 launch_timeline_cache/updates_{id}；冷缓存命中则直接算徽标，否则再调 ll2Query。
   */
  _tryLaunchDelayFromUpdatesCache(id, net, loadKey, cacheKey) {
    const applyList = (list) => {
      if (this._launchDelayLoadedKey !== loadKey) return
      const safeList = Array.isArray(list) ? list : []
      this._ll2UpdatesMem = {
        id,
        list: safeList,
        limit: Math.max(15, safeList.length),
        at: Date.now(),
        outcome: inferTerminalStatusFromUpdates(safeList)
      }
      const info = computeLaunchDelayInfo(safeList, net)
      try {
        wx.setStorageSync(cacheKey, { net: net, text: info.text, ts: Date.now() })
      } catch (e) {}
      this._launchDelayRenderedId = id
      this.setData({ launchDelayText: info.text })
    }

    const fallbackFetch = () => {
      fetchLl2LaunchUpdates(id, 30)
        .then((res) => {
          if (this._launchDelayLoadedKey !== loadKey) return
          applyList((res && res.list) || [])
        })
        .catch(() => {
          if (this._launchDelayLoadedKey !== loadKey) return
          this._launchDelayLoadedKey = ''
          this._launchDelayRenderedId = id
          if (this.data.launchDelayText) this.setData({ launchDelayText: '' })
        })
    }

    if (!wx.cloud || typeof wx.cloud.database !== 'function') {
      fallbackFetch()
      return
    }

    const UPDATES_COLD_TTL_MS = 48 * 60 * 60 * 1000
    wx.cloud
      .database()
      .collection('launch_timeline_cache')
      .doc('updates_' + id)
      .get()
      .then((cacheRes) => {
        const cached = cacheRes && cacheRes.data
        const list = cached && Array.isArray(cached.data) ? cached.data : null
        const age = cached && cached.updatedAtMs ? Date.now() - cached.updatedAtMs : Infinity
        if (list && list.length && age < UPDATES_COLD_TTL_MS) {
          applyList(list)
          return
        }
        fallbackFetch()
      })
      .catch(() => fallbackFetch())
  },

  /** 对 upcoming 头部已过 NET 且尚未可落库的任务：后台探针，不抢先改「就绪」文案 */
  _kickQuietSettlePastNetUpcoming(upcomingList, now) {
    const past = collectPastNetUpcomingHeads(upcomingList, now != null ? now : Date.now(), 3)
    if (!past.length) return
    if (!this._quietSettlingIds) this._quietSettlingIds = new Set()
    for (let i = 0; i < past.length; i++) {
      const mission = past[i]
      if (!mission || mission.id == null) continue
      const id = String(mission.id)
      if (this._isKnownSettleableId(id)) continue
      if (this._quietSettlingIds.has(id)) continue
      this._quietSettlingIds.add(id)
      this._quietSettlePastNetMission(mission)
        .catch(() => {})
        .finally(() => {
          if (this._quietSettlingIds) this._quietSettlingIds.delete(id)
        })
    }
  },

  async _quietSettlePastNetMission(mission) {
    if (!mission || mission.id == null) return
    const id = String(mission.id)
    // 探针过程中若已可落库（详情/其它路径写入），同拍 scrub，勿再闪
    if (this._isKnownSettleableId(id)) {
      try {
        this._scrubKnownSettleableCountdown()
      } catch (e) {}
      return
    }
    let row = await this._lookupRecentSettledRow(id)
    let sid = row && row.status && row.status.id != null ? Number(row.status.id) : 0
    if (!isSettleableLiveStatusId(sid)) {
      try {
        const rows = await resolveLaunchStatuses([id])
        if (Array.isArray(rows) && rows.length) {
          this._upsertResolvedIntoSettledCache(rows)
          const hit = rows.find((r) => r && String(r.id) === id) || rows[0]
          if (hit && hit.status) {
            row = {
              id,
              name: hit.name || mission.name || '',
              net: hit.net || mission.launchTime || '',
              status: hit.status
            }
            sid = hit.status.id != null ? Number(hit.status.id) : 0
          }
        }
      } catch (e) {}
    }
    if (!row || !row.status || !isSettleableLiveStatusId(sid)) {
      // 未决但 resolve 已带回改期后的 NET（hold/scrub 推迟场景）：
      // 立刻回写列表卡片，不用等下一轮小时探针才看到新时间
      try {
        this._applyQuietPostponedNet(mission, row)
      } catch (e) {}
      return
    }
    // 刚探测到可落库：写入内存后同拍 scrub，倒计时不经过「先显示再消失」
    this._upsertResolvedIntoSettledCache([
      {
        id,
        name: row.name || mission.name || '',
        net: row.net || mission.launchTime || '',
        status: row.status
      }
    ])
    try {
      this._scrubKnownSettleableCountdown()
    } catch (e2) {}
  },

  /**
   * quiet-settle 探到「过点但改期」（resolve 返回的 NET 在 1 分钟以后）：
   * 就地回写列表卡片时间/状态并重排；若倒计时面板正停在该任务、或停在
   * 比新 NET 更晚的未来任务上，同拍换到正确任务。面板若停在其它「过点
   * 确认中」任务上则不动它（不打断该任务的 settle 流程）。
   */
  _applyQuietPostponedNet(mission, row) {
    if (!row || !row.net || row.id == null) return false
    const id = String(row.id)
    const netMs = new Date(row.net).getTime()
    if (!Number.isFinite(netMs) || netMs - Date.now() <= 60 * 1000) return false
    const prevMs = mission && mission.launchTime ? new Date(mission.launchTime).getTime() : 0
    if (Number.isFinite(prevMs) && prevMs === netMs) return false

    // 写入权威状态记录：本会话后续投影不再回退到旧时间。
    // 注意必须带真实 status 对象才能吸收：normalizeStatus 对空 status 会
    // 错误地把观测对象的 name（任务名）当状态名（launch-status-store 的既有行为）
    if (row.status && row.status.id != null) {
      this._absorbLaunchStateObservations(
        [{ id, name: row.name || '', net: row.net, status: row.status, observedAtMs: Date.now() }],
        'resolve'
      )
    }

    const ld = this.data.launchData
    const curId = ld && ld.id != null ? String(ld.id) : ''
    // 面板正停在该任务：走既有改期路径（重置 30 分钟兜底窗口 + 重建面板）
    if (curId && curId === id) {
      this._applyPostponedNet({ ...row, id })
      return true
    }

    const missions = (this.data.upcomingMissions || []).slice()
    const idx = missions.findIndex((m) => m && String(m.id) === id)
    if (idx < 0) return false
    const updated = {
      ...missions[idx],
      launchTime: row.net,
      formattedTime: formatDate(row.net, 'MM月DD日 HH:mm')
    }
    if (row.status && row.status.name) {
      updated.status = getStatusTextZh(row.status)
      updated.statusId = row.status.id != null ? Number(row.status.id) : updated.statusId
      updated.statusAbbrev = row.status.abbrev || updated.statusAbbrev
      updated.statusCategory = getStatusCategory(row.status)
      updated.statusBadgeText = getStatusBadgeText(row.status, updated.statusCategory)
    }
    missions[idx] = updated
    missions.sort((a, b) => new Date((a && a.launchTime) || 0) - new Date((b && b.launchTime) || 0))

    const patch = { upcomingMissions: missions }
    this.applyUpcomingAgencyFilterToPatch(patch)

    // 面板停在未来任务、而改期后本任务更早 → 面板应换成本任务；
    // 面板停在过点确认中的任务上 → 禁止裸切，保持不动
    const curMs = ld && ld.launchTime ? new Date(ld.launchTime).getTime() : 0
    const panelOnFuture = Number.isFinite(curMs) && curMs > Date.now()
    const shouldSwitchPanel = !curId || (panelOnFuture && netMs < curMs)
    if (shouldSwitchPanel) {
      Object.assign(
        patch,
        buildCurrentLaunchPanelState({
          mission: updated,
          formatDate,
          getStatusTextZh,
          subscribedIdSet: this._getPageSubscribedIdSet()
        })
      )
    }
    this.setData(patch, () => {
      try {
        this.scheduleUpcomingAgencyChipsOverflowHint()
      } catch (e) {}
      if (shouldSwitchPanel) {
        try {
          this.applyLaunchSwitchEffects(updated)
        } catch (e2) {}
        try {
          this.updateCountdown()
        } catch (e3) {}
      }
    })
    return true
  },

  /**
   * 仅当终态或飞行中：把卡片落到历史发射头部并切下一个。
   * 若只有飞行中：落历史前先 resolve 一次，尽量直接写成 Deployed/Success，避免历史长期「飞行中」。
   * 未决禁止从即将发射移除 / 禁止切下一个。
   */
  async _settleExpiredLaunch(row) {
    if (this._statusRecheckTimer) {
      clearTimeout(this._statusRecheckTimer)
      this._statusRecheckTimer = null
    }
    this._launchStatusPolling = false

    const ld = this.data.launchData
    const currentId = ld && ld.id != null ? String(ld.id) : ''
    const mission =
      (this.data.upcomingMissions || []).find((m) => m && String(m.id) === currentId) ||
      // 列表已 peel 但面板仍停在该任务时，用面板字段拼一张可落库卡
      (ld && currentId
        ? {
            id: currentId,
            name: ld.missionName || ld.name || '',
            launchTime: ld.launchTime || '',
            rocketName: ld.rocketName || '',
            launchAgency: ld.launchAgency || '',
            launchSite: ld.launchSite || '',
            rocketImage: ld.rocketImage || ld.image || '',
            image: ld.rocketImage || ld.image || '',
            statusId: ld.statusId,
            statusCategory: ld.statusCategory
          }
        : null)
    let settleRow = row
    let statusId = settleRow && settleRow.status && settleRow.status.id != null ? Number(settleRow.status.id) : 0
    const canSettle = !!(settleRow && settleRow.status && mission && isSettleableLiveStatusId(statusId))

    if (canSettle) {
      // 先写入 settleable 证据，供 scrub / 窗口挂住误挡后的 updateCountdown 自愈
      try {
        this._upsertResolvedIntoSettledCache([
          {
            id: currentId,
            name: settleRow.name || mission.name || '',
            net: settleRow.net || mission.launchTime || '',
            status: settleRow.status
          }
        ])
      } catch (e0) {}
      // 飞行中 → 落历史前抢一次终态（mode=list，比进详情早）
      if (statusId === 6 && currentId) {
        try {
          const rows = await resolveLaunchStatuses([currentId])
          if (Array.isArray(rows) && rows.length) {
            this._upsertResolvedIntoSettledCache(rows)
            const hit = rows.find((r) => r && String(r.id) === currentId) || rows[0]
            const nextSid = hit && hit.status && hit.status.id != null ? Number(hit.status.id) : 0
            if (hit && hit.status && isTerminalStatusId(nextSid)) {
              settleRow = {
                ...(settleRow || {}),
                id: currentId,
                name: hit.name || (settleRow && settleRow.name) || '',
                net: hit.net || (settleRow && settleRow.net) || '',
                status: hit.status
              }
              statusId = nextSid
            }
          }
        } catch (e) {}
      }
      try {
        this._moveMissionToCompleted(mission, settleRow, { resolveInflight: statusId === 6 })
      } catch (e) {
        console.error('[LiveStatus] 落历史发射失败:', e)
      }
      // force：setData 未回写前列表里仍是旧「就绪」，窗口挂住不能挡落库切下一个
      this._switchingCountdown = true
      this.switchToNextUpcomingMission({ force: true })

      const after = this.data.launchData
      if (after && String(after.id != null ? after.id : '') === currentId && this._settleReloadedForId !== currentId) {
        this._settleReloadedForId = currentId
        this._refreshUpcomingAfterSettle().catch(() => {})
      }
      return
    }

    if (!currentId) return
    this._launchStatusPolling = true
    let liveText = '待确认'
    let liveCategory = 'pending'
    if (settleRow && settleRow.status) {
      liveCategory = getStatusCategory(settleRow.status)
      liveText = getStatusBadgeText(settleRow.status, liveCategory)
    }
    this._applyLiveStatusPanel(currentId, liveText, liveCategory)
    this._armLiveStatusRecheck(currentId, LIVE_STATUS_UNRESOLVED_RECHECK_MS)
  },

  /** settle 后轻量刷新即将发射列表，避免整页 loadInitialData */
  async _refreshUpcomingAfterSettle() {
    try {
      const { res, list } = await this.fetchMissionList('upcoming', 50, 0)
      if (!Array.isArray(list) || !list.length) return
      // 权威状态投影：刚 settle 的任务在云端 upcoming 缓存里可能仍残留旧 Go 行，
      // 先吸收观测再投影，剔除已落库任务、覆盖脏状态字段
      this._absorbLaunchStateObservations(list, 'list')
      const fetchedIds = new Set(list.map((m) => m && String(m.id)))
      const cleanList = this._projectAuthoritativeLaunchState(
        list,
        this.data.completedMissions,
        Date.now()
      ).upcoming.filter((m) => m && fetchedIds.has(String(m.id)))
      const first = cleanList[0]
      if (!first) return
      // 若当前面板已切到新任务且仍在列表中，只更新列表不重建面板
      const curId = this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
      const stillCurrent = curId && cleanList.some((m) => m && String(m.id) === curId)
      if (stillCurrent) {
        const patch = { ...buildMissionListSetData('upcoming', cleanList, res, filterExpiredMissions) }
        this.applyUpcomingAgencyFilterToPatch(patch)
        this.setData(patch, () => this.scheduleUpcomingAgencyChipsOverflowHint())
        return
      }
      this.applyInitialUpcomingLaunchState(first, cleanList, res)
    } catch (e) {}
  },

  /**
   * 把当前任务卡片转成历史发射形态：从即将发射移除，插入历史发射头部，并同步日历。
   * @param {{ resolveInflight?: boolean }} options 若仍是飞行中，setData 后继续 resolve 升级角标
   */
  _moveMissionToCompleted(mission, row, options) {
    const statusObj = row.status || {}
    const category = getStatusCategory(statusObj)
    const statusZh = getStatusBadgeText(statusObj, category)
    const resolveInflight = !!(options && options.resolveInflight)

    const completedItem = attachMissionDetailMeta(
      {
        ...mission,
        status: statusZh,
        statusId: statusObj.id != null ? Number(statusObj.id) : mission.statusId,
        statusAbbrev: statusObj.abbrev || '',
        statusCategory: category,
        statusBadgeText: statusZh,
        success: category === 'success' || category === 'deployed',
        isPartialFailure: category === 'partial',
        isFailure: category === 'failure' || category === 'partial',
        missionDescription: mission.missionDescription || '',
        isExpired: false,
        _optimisticSettled: true
      },
      { id: mission.id, detailType: 'completed' }
    )

    const midStr = String(mission.id)
    this._rememberSessionCompleted(completedItem)
    const nextUpcoming = (this.data.upcomingMissions || []).filter((m) => m && String(m.id) !== midStr)
    const nextCompleted = [
      completedItem,
      ...(this.data.completedMissions || []).filter((m) => m && String(m.id) !== midStr)
    ]

    const patch = { upcomingMissions: nextUpcoming, completedMissions: nextCompleted }
    this.applyUpcomingAgencyFilterToPatch(patch)
    this.setData(patch, () => {
      try {
        this.updateMissionListView('completed', nextCompleted)
      } catch (e) {}
      try {
        this.hydrateCalendarFromLoadedMissionLists()
      } catch (e) {}
      this.scheduleUpcomingAgencyChipsOverflowHint()
      if (!resolveInflight) return
      // 落历史时仍是飞行中：立刻再 resolve，把角标升到终态（不必等用户进详情）
      this._reconcileInflightHistoryStatuses(nextCompleted)
        .then((merged) => {
          if (!Array.isArray(merged)) return
          const head = merged[0]
          if (!head || String(head.id) !== midStr) return
          if (!isTerminalStatusId(head.statusId)) return
          this.setData(
            {
              ...buildMissionListSetData(
                'completed',
                merged,
                {
                  nextOffset: this.data.completedMissionsOffset,
                  hasMore: this.data.completedMissionsHasMore
                },
                filterExpiredMissions
              )
            },
            () => {
              try {
                this.updateMissionListView('completed', merged)
              } catch (e2) {}
            }
          )
        })
        .catch(() => {})
    })
  },

  /** NET 已推后：更新当前任务发射时间与列表卡片，倒计时自然恢复 */
  _applyPostponedNet(row) {
    if (this._statusRecheckTimer) {
      clearTimeout(this._statusRecheckTimer)
      this._statusRecheckTimer = null
    }
    this._launchStatusPolling = false
    // 放开节流：新 T-0 到点后状态机按新 NET 重新推导
    this._lastExpiredRoundAt = 0

    const currentId = String(row.id)
    const missions = (this.data.upcomingMissions || []).slice()
    const idx = missions.findIndex((m) => m && String(m.id) === currentId)

    if (idx >= 0) {
      const mission = { ...missions[idx], launchTime: row.net }
      mission.formattedTime = formatDate(row.net, 'MM月DD日 HH:mm')
      if (row.status && row.status.name) {
        mission.status = getStatusTextZh(row.status)
        mission.statusId = row.status.id != null ? Number(row.status.id) : mission.statusId
        mission.statusAbbrev = row.status.abbrev || mission.statusAbbrev
        mission.statusCategory = getStatusCategory(row.status)
        mission.statusBadgeText = getStatusBadgeText(row.status, mission.statusCategory)
      }
      missions[idx] = mission
      // NET 变化可能影响顺序，按时间重排
      missions.sort((a, b) => new Date((a && a.launchTime) || 0) - new Date((b && b.launchTime) || 0))

      const patch = { upcomingMissions: missions }
      this.applyUpcomingAgencyFilterToPatch(patch)
      this.setData(patch, () => this.scheduleUpcomingAgencyChipsOverflowHint())

      // 用改期后的任务重建倒计时面板
      this.setData(
        buildCurrentLaunchPanelState({
          mission,
          formatDate,
          getStatusTextZh,
          subscribedIdSet: this._getPageSubscribedIdSet()
        })
      )
    } else {
      // 列表中找不到（边缘情况）：直接改面板时间
      const timeParts = formatHomeLaunchTimeParts(row.net, formatDate)
      this.setData({
        'launchData.launchTime': row.net,
        formattedLaunchTime: timeParts.full,
        formattedLaunchDate: timeParts.date,
        formattedLaunchWeekTime: timeParts.weekTime,
        'launchData.statusTextZh': row.status ? getStatusTextZh(row.status) : '计划中',
        'launchData.statusCategory': row.status ? getStatusCategory(row.status) : 'pending'
      })
    }
    this.updateCountdown()
    // NET 改期后重新计算推迟徽标（loadKey 含 NET，改期后必然重新拉取）
    this.refreshLaunchDelayInfo(currentId, row.net)
  },

  /**
   * 窗口期主探针：按 id 直查权威状态（resolveLaunchStatuses，云端 launch_status
   * 缓存 + 受控 LL2）——任务被 hide_recent 移出 upcoming 列表后仍查得到，
   * 不受 upcoming 缓存残留旧 Go 影响。live 列表探针降为辅助（顺带修其它任务
   * NET/状态），LL2 updates 社媒记录作终态旁路。
   */
  async _checkLiveLaunchStatus(currentId) {
    // 1) 主探针：按 id 直查
    let primary = null
    try {
      const resolved = await resolveLaunchStatuses([currentId])
      if (Array.isArray(resolved) && resolved.length) {
        this._upsertResolvedIntoSettledCache(resolved)
        // 仅吸收带有效 status 的行：无 status 的行经 normalizeStatus 兜底
        // 会把任务名误写成状态名，污染权威记录
        this._absorbLaunchStateObservations(
          resolved
            .filter((r) => r && r.id != null && r.status && r.status.id != null)
            .map((r) => ({ ...r, source: 'resolve', observedAtMs: r.observedAtMs || Date.now() })),
          'resolve'
        )
        primary = resolved.find((r) => r && String(r.id) === currentId) || null
      }
    } catch (e) {
      primary = null
    }

    // 期间任务已被切换（用户操作/整页刷新）：终止本轮，新任务到点会重新开始
    let ld = this.data.launchData
    if (!ld || String(ld.id != null ? ld.id : '') !== currentId) {
      this._launchStatusPolling = false
      return
    }

    if (primary && primary.status) {
      const primarySid = primary.status.id != null ? Number(primary.status.id) : 0
      // 终态(3/4/7/9) 或飞行中(6) → 落历史并切换
      if (isSettleableLiveStatusId(primarySid)) {
        this._settleExpiredLaunch({
          id: currentId,
          name: primary.name || ld.missionName || '',
          net: primary.net || ld.launchTime || '',
          status: primary.status
        })
        return
      }
      // NET 已推后（新时间在 1 分钟以后）→ 更新发射时间，倒计时自然恢复
      const primaryNetMs = primary.net ? new Date(primary.net).getTime() : 0
      if (primaryNetMs && primaryNetMs - Date.now() > 60 * 1000) {
        this._applyPostponedNet({ ...primary, id: currentId })
        return
      }
    }

    // 2) 辅助探针：live 列表（顺带把前几条任务的 NET/状态 patch 进列表）
    let row = null
    try {
      let rows = await fetchLiveLaunchStatuses()
      // 失败：短抖动后重试 1 次，避免与云端 30s fail memo 连击
      if (!rows) {
        await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 600)))
        rows = await fetchLiveLaunchStatuses()
      }
      if (rows) {
        this._patchUpcomingListLiveStatuses(rows)
        row = rows.find((r) => r && String(r.id) === currentId) || null
      }
    } catch (e) {
      row = null
    }

    ld = this.data.launchData
    if (!ld || String(ld.id != null ? ld.id : '') !== currentId) {
      this._launchStatusPolling = false
      return
    }

    if (row && row.status) {
      // 终态/飞行中证据不分主辅：即使 resolve 缓存仍是旧 Go，live 行的终态也立即落库
      const rowSid = Number(row.status.id) || 0
      if (isSettleableLiveStatusId(rowSid)) {
        this._settleExpiredLaunch(row)
        return
      }
      // 改期 NET 以主探针为权威，仅当主探针缺席时才用 live 行的
      if (!(primary && primary.status)) {
        const rowNetMs = row.net ? new Date(row.net).getTime() : 0
        if (rowNetMs && rowNetMs - Date.now() > 60 * 1000) {
          this._applyPostponedNet(row)
          return
        }
      }
    }

    // 3) 主/辅都未决：recent_settled 兜底 + Updates「Launch success.」等社媒旁路
    if (!primary && !row) {
      const settledRow = await this._lookupRecentSettledRow(currentId)
      if (settledRow && settledRow.status) {
        this._settleExpiredLaunch(settledRow)
        return
      }
    }
    const fromUpdates = await this._trySettleFromLl2Updates(currentId, primary || row)
    if (fromUpdates) return

    // 4) 推迟 / 就绪 / 待确认 等 → 显示实况并按窗口期节奏复查（与角标同源）
    const liveSource = (primary && primary.status && primary) || (row && row.status && row) || null
    let liveText = '待定'
    let liveCategory = 'pending'
    if (liveSource) {
      liveCategory = getStatusCategory(liveSource.status)
      liveText = getStatusBadgeText(liveSource.status, liveCategory)
    }
    this._scheduleStatusRecheck(currentId, liveText, liveCategory)
  },

  /**
   * 拉 LL2 /updates/（与推迟徽标共用内存缓存），从「Launch success.」等推断终态。
   */
  async _fetchLl2UpdatesCached(launchId, minLimit) {
    const id = String(launchId || '').trim()
    if (!id) return null
    const need = Math.max(15, Number(minLimit) || 15)
    const now = Date.now()
    const mem = this._ll2UpdatesMem
    if (
      mem &&
      mem.id === id &&
      Array.isArray(mem.list) &&
      mem.limit >= need &&
      now - (mem.at || 0) < LL2_UPDATES_MEM_TTL_MS
    ) {
      return mem
    }
    try {
      const res = await fetchLl2LaunchUpdates(id, need)
      const list = res && Array.isArray(res.list) ? res.list : []
      const packed = {
        id,
        list,
        limit: need,
        at: now,
        outcome: (res && res.outcome) || inferTerminalStatusFromUpdates(list)
      }
      this._ll2UpdatesMem = packed
      return packed
    } catch (e) {
      return null
    }
  },

  /**
   * 拉 LL2 /updates/，从「Launch success.」/ liftoff 等推断可 settle 状态。
   * 云函数有 5–10 分钟缓存；仅在 status 未决时调用，避免浪费额度。
   */
  async _fetchTerminalFromLl2Updates(currentId) {
    const id = String(currentId || '').trim()
    if (!id) return null
    const now = Date.now()
    if (this._updatesOutcomeAt && this._updatesOutcomeId === id && now - this._updatesOutcomeAt < 3 * 60 * 1000) {
      return this._updatesOutcomeRow || null
    }
    try {
      const packed = await this._fetchLl2UpdatesCached(id, 15)
      const list = packed && Array.isArray(packed.list) ? packed.list : []
      const outcome = (packed && packed.outcome) || inferTerminalStatusFromUpdates(list)
      const ld = this.data.launchData || {}
      const row = outcome
        ? buildSettledRowFromUpdates(id, ld.missionName || ld.name || '', ld.launchTime || '', outcome)
        : null
      this._updatesOutcomeId = id
      this._updatesOutcomeAt = now
      this._updatesOutcomeRow = row
      return row
    } catch (e) {
      this._updatesOutcomeId = id
      this._updatesOutcomeAt = now
      this._updatesOutcomeRow = null
      return null
    }
  },

  /**
   * 若 Updates 能确认终态则落历史并返回 true。
   * @param {string} currentId
   * @param {object} [baseRow] 可选：保留 live 行的 net 等字段
   */
  async _trySettleFromLl2Updates(currentId, baseRow) {
    const fromUpdates = await this._fetchTerminalFromLl2Updates(currentId)
    if (!fromUpdates || !fromUpdates.status) return false
    const ld = this.data.launchData
    if (!ld || String(ld.id != null ? ld.id : '') !== String(currentId)) return false
    const merged = {
      ...fromUpdates,
      net: (baseRow && baseRow.net) || fromUpdates.net || ld.launchTime || '',
      name: fromUpdates.name || (baseRow && baseRow.name) || ld.missionName || ''
    }
    this._settleExpiredLaunch(merged)
    return true
  },

  /**
   * 显示实况文案并按窗口期状态机安排复查：
   * 窗口内 3m；窗口（+宽限）过后 bestEffort（无结果则 15m 慢探，不裸切）；
   * NET 已推回未来（改期恢复倒计时）则停止轮询。
   */
  _scheduleStatusRecheck(currentId, liveText, liveCategory) {
    const ld = this.data.launchData
    const record =
      this._launchRecordsById && currentId != null
        ? this._launchRecordsById.get(String(currentId)) || null
        : null
    const probe = windowMachine.nextProbeAction(ld, record, Date.now())

    if (probe.action === 'settle' || probe.action === 'bestEffort') {
      this._settleExpiredLaunchWithBestEffort(currentId)
      return
    }
    if (probe.action === 'none') {
      const netMs = windowMachine.getEffectiveNetMs(ld, record)
      if (Number.isFinite(netMs) && netMs > Date.now()) {
        // 改期后 NET 回到未来：倒计时自然恢复，无需再轮询
        this._launchStatusPolling = false
        return
      }
      // 有效 NET 缺失/非法：保持默认间隔复查，避免 tick 每 30s 重入造成探针空转
      this._applyLiveStatusPanel(currentId, liveText, liveCategory)
      this._armLiveStatusRecheck(currentId, LIVE_STATUS_RECHECK_MS)
      return
    }
    this._applyLiveStatusPanel(currentId, liveText, liveCategory)
    this._armLiveStatusRecheck(currentId, probe.delayMs || LIVE_STATUS_RECHECK_MS)
  },

  /** 把实况文案写回当前倒计时面板（仅当仍是同一任务） */
  _applyLiveStatusPanel(currentId, liveText, liveCategory) {
    const ld = this.data.launchData
    if (!ld || String(ld.id != null ? ld.id : '') !== String(currentId)) return
    const patch = {}
    if (liveText && ld.statusTextZh !== liveText) patch['launchData.statusTextZh'] = liveText
    if (liveCategory && ld.statusCategory !== liveCategory) patch['launchData.statusCategory'] = liveCategory
    if (Object.keys(patch).length) this.setData(patch)
  },

  /** 安排下一次 live 状态复查 */
  _armLiveStatusRecheck(currentId, delayMs) {
    if (this._statusRecheckTimer) clearTimeout(this._statusRecheckTimer)
    this._statusRecheckTimer = setTimeout(
      () => {
        this._statusRecheckTimer = null
        this._checkLiveLaunchStatus(currentId)
      },
      Math.max(1000, Number(delayMs) || LIVE_STATUS_RECHECK_MS)
    )
  },

  /**
   * 超时 bestEffort：recent_settled → Updates 社媒记录 → 可 settle 则落历史；
   * 否则保持当前任务并拉长间隔继续复查（禁止裸切）。
   */
  async _settleExpiredLaunchWithBestEffort(currentId) {
    let row = await this._lookupRecentSettledRow(currentId)
    if (!row) {
      row = await this._fetchTerminalFromLl2Updates(currentId)
    }
    await this._settleExpiredLaunch(row)
  },

  /** 把同一次返回的前 5 行实况（状态 + NET）patch 进即将发射源列表，再一次 filter 同步 displayed */
  _patchUpcomingListLiveStatuses(rows) {
    if (!Array.isArray(rows) || !rows.length) return
    this._absorbLaunchStateObservations(
      rows.map((row) => ({
        ...row,
        source: 'live',
        observedAtMs: row.observedAtMs || Date.now()
      })),
      'live'
    )
    const projected = this._projectAuthoritativeLaunchState(this.data.upcomingMissions, this.data.completedMissions)
    const completed = this._mergeRecentSettledIntoCompletedList(
      projected.completed,
      Array.from(this._launchRecordsById.values())
    )
    const patch = {
      upcomingMissions: filterExpiredMissions(projected.upcoming),
      completedMissions: completed
    }
    this.applyUpcomingAgencyFilterToPatch(patch, patch.upcomingMissions)
    this.setData(patch, () => {
      this.updateMissionListView('completed', completed)
      if (this.data.launchData && this._isKnownSettleableId(this.data.launchData.id)) {
        this._scrubKnownSettleableCountdown()
      }
    })
  },

  /**
   * 倒计时圆图直播态：拉取视频号状态，驱动红边涟漪 +「直播中」标签
   * @param {{ schedule?: boolean }} options schedule=true 时按开播/未开播间隔续轮询
   */
  refreshCountdownChannelsLive(options = {}) {
    const schedule = !!(options && options.schedule)
    if (this._channelsLiveInfoPromise) {
      return this._channelsLiveInfoPromise.then(() => {
        if (schedule && this.data.enableLiveEntry) this._scheduleCountdownChannelsLivePoll()
      })
    }

    this._channelsLiveInfoPromise = isLiveEntryAllowed()
      .catch(() => false)
      .then((allowed) => {
        if (this.data.enableLiveEntry !== !!allowed) {
          this.setData({ enableLiveEntry: !!allowed })
        }
        if (!allowed) {
          // 过审关闭直播入口：不探测视频号、不续轮询，并收回已亮起的直播态
          this._clearCountdownChannelsLivePoll()
          if (this.data.isChannelsLive || this.data.isEnteringLive) {
            this.setData({ isChannelsLive: false, isEnteringLive: false })
          }
          return null
        }
        return loadChannelsLiveModule()
          .then((live) => live.fetchChannelsLiveInfo().then((payload) => payload))
          .then((payload) => {
            const status = payload.status || 0
            const feedId = payload.feedId || ''
            const isLive = Number(status) === 2
            const finder = getLiveFinderUserNameFromConfig()
            const patch = {}
            if (this.data.isChannelsLive !== isLive) patch.isChannelsLive = isLive
            if (this.data.channelsLiveStatus !== status) patch.channelsLiveStatus = status
            if (this.data.channelsLiveFeedId !== feedId) patch.channelsLiveFeedId = feedId
            if (finder && this.data.liveFinderUserName !== finder) patch.liveFinderUserName = finder
            if (!isLive && this.data.channelsLiveAnimPaused) patch.channelsLiveAnimPaused = false
            if (!isLive && this.data.isEnteringLive) patch.isEnteringLive = false
            if (Object.keys(patch).length) this.setData(patch)
          })
          .catch(() => {
            // 探测失败静默：保持未直播态，不打断倒计时
            if (this.data.isChannelsLive || this.data.isEnteringLive) {
              this.setData({
                isChannelsLive: false,
                isEnteringLive: false
              })
            }
          })
      })
      .finally(() => {
        this._channelsLiveInfoPromise = null
        if (schedule && this.data.enableLiveEntry) this._scheduleCountdownChannelsLivePoll()
      })

    return this._channelsLiveInfoPromise
  },

  _scheduleCountdownChannelsLivePoll() {
    this._clearCountdownChannelsLivePoll()
    const delay = this.data.isChannelsLive ? CHANNELS_LIVE_POLL_LIVE_MS : CHANNELS_LIVE_POLL_IDLE_MS
    this._channelsLivePollTimer = setTimeout(() => {
      this._channelsLivePollTimer = null
      this.refreshCountdownChannelsLive({ schedule: true })
    }, delay)
  },

  /**
   * 点击圆图/直播标签：
   * 直播中 → 先播压缩放过渡，再 openChannelsLive；
   * 未直播 → 进任务详情。
   */
  onCountdownLiveAvatarTap() {
    if (!this.data.enableLiveEntry || !this.data.isChannelsLive) {
      const id = this.data.launchData && this.data.launchData.id
      if (!id) return
      this.viewMissionDetail({ currentTarget: { dataset: { id } } })
      return
    }
    if (this._openingCountdownLive || this.data.isEnteringLive) return

    this._openingCountdownLive = true
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {}
    this.setData({ isEnteringLive: true })

    const self = this
    this._clearCountdownLiveEnterTimer()
    this._channelsLiveEnterTimer = setTimeout(() => {
      self._channelsLiveEnterTimer = null
      self._openCountdownChannelsLive()
    }, CHANNELS_LIVE_ENTER_MS)
  },

  /**
   * 过渡动画结束后打开视频号直播间；取消/失败时复位进入态。
   */
  _openCountdownChannelsLive() {
    const self = this
    const finish = () => {
      self._openingCountdownLive = false
      if (self.data.isEnteringLive) {
        self.setData({ isEnteringLive: false })
      }
    }

    const openWithPayload = (feedId, finderUserName) => {
      if (!feedId) {
        wx.showToast({ title: '暂无直播信息', icon: 'none' })
        finish()
        return
      }
      loadChannelsLiveModule()
        .then((live) =>
          live.openChannelsLive({
            finderUserName: finderUserName || self.data.liveFinderUserName,
            feedId
          })
        )
        .then(() => {
          // 成功调起后稍后再清，避免确认框弹出瞬间圆图弹回
          setTimeout(finish, 400)
        })
        .catch(() => {
          finish()
        })
    }

    if (this.data.channelsLiveFeedId) {
      openWithPayload(this.data.channelsLiveFeedId, this.data.liveFinderUserName)
      return
    }

    this.refreshCountdownChannelsLive()
      .then(() => {
        openWithPayload(self.data.channelsLiveFeedId, self.data.liveFinderUserName)
      })
      .catch(() => {
        finish()
      })
  },

  async loadRoadClosureNotice(options = {}) {
    const safeOptions = options || {}
    const forceRefresh = !!safeOptions.forceRefresh

    return this.runTimedManagedPageRequest({
      forceRefresh,
      strategy: 'simple',
      hasData: !!this.data.roadClosureNotice,
      lastLoadedAt: this._roadClosureNoticeLoadedAt,
      ttlMs: ROAD_CLOSURE_REFRESH_TTL,
      getCachedValue: () => this.data.roadClosureNotice,
      promiseKey: '_loadRoadClosureNoticePromise',
      requestFactory: async () => {
        try {
          const data = await getRoadClosureNotice()

          if (resolveRoadClosureStatus(data) === 'active') {
            let timeRange = data.timeRange || ''
            if (!timeRange && data.startTime && data.endTime) {
              const s = formatDate(data.startTime, 'MM月DD日 HH:mm')
              const e = formatDate(data.endTime, 'MM月DD日 HH:mm')
              timeRange = `${s} - ${e}`
            }
            const sourceMap = { manual: '管理员', spacedevs: 'SpaceDevs', starbase_gov: 'Starbase.gov', legacy: '' }
            const schedule = data.beachClosureSchedule || []
            const msgText =
              schedule.length > 0
                ? (data.beachStatus || data.message || '封路通知') + ' | ' + schedule[0]
                : data.message || '星舰基地道路封路通知'
            const nextNotice = {
              isActive: true,
              message: msgText,
              timeRange,
              sourceLabel: sourceMap[data.source] || data.source || ''
            }
            this._roadClosureNoticeLoadedAt = Date.now()
            const prev = this.data.roadClosureNotice
            // 内容未变时跳过 setData，避免横幅跑马灯动画被重置产生跳动
            if (
              !prev ||
              prev.message !== nextNotice.message ||
              prev.timeRange !== nextNotice.timeRange ||
              prev.sourceLabel !== nextNotice.sourceLabel
            ) {
              this.setData({ roadClosureNotice: nextNotice })
            }
            return nextNotice
          }

          this._roadClosureNoticeLoadedAt = Date.now()
          if (this.data.roadClosureNotice) {
            this.setData({ roadClosureNotice: null })
          }
          return null
        } catch (e) {
          return null
        }
      }
    })
  },

  openRoadClosureDetail() {
    navigateTo(ROUTES.ROAD_CLOSURE_DETAIL)
  },

  // 加载 SpaceX 官网发射统计
  async loadSpaceXStats(options = {}) {
    const safeOptions = options || {}
    const forceRefresh = !!safeOptions.forceRefresh

    return this.runTimedManagedPageRequest({
      forceRefresh,
      strategy: 'simple',
      hasData: !!this.data.spacexStats,
      lastLoadedAt: this._spacexStatsLoadedAt,
      ttlMs: SPACEX_STATS_REFRESH_TTL,
      getCachedValue: () => this.data.spacexStats,
      promiseKey: '_loadSpaceXStatsPromise',
      requestFactory: async () => {
        this.setData({ spacexStatsLoading: true })
        try {
          const data = await getSpaceXLaunchStats()
          if (data && data.isActive) {
            const sourceMap = { manual: '管理员', spacex_official: 'SpaceX官网' }
            const nextStats = {
              totalLaunches: data.totalLaunches || 0,
              totalLandings: data.totalLandings || 0,
              totalReflights: data.totalReflights || 0,
              upcoming: (data.upcoming || []).slice(0, 10),
              recentCompleted: (data.recentCompleted || []).slice(0, 5),
              sourceLabel: sourceMap[data.source] || data.source || 'SpaceX',
              syncedAt: data.syncedAt || data.updatedAt
            }
            this._spacexStatsLoadedAt = Date.now()
            this.setData({
              spacexStats: nextStats,
              spacexStatsLoading: false
            })
            return nextStats
          }

          this._spacexStatsLoadedAt = Date.now()
          this.setData({ spacexStats: null, spacexStatsLoading: false })
          return null
        } catch (e) {
          console.error('[SpaceXStats] load error:', e)
          this.setData({ spacexStatsLoading: false })
          return null
        }
      }
    })
  },

  async loadAnnouncementBanner() {
    try {
      const data = await getActiveAnnouncement()
      const prev = this.data.announcementBanner
      const next = data || null
      // 内容未变时跳过 setData，避免公告跑马灯动画被重置
      if (
        (!prev && !next) ||
        (prev && next && prev.active === next.active && prev.title === next.title && prev.content === next.content)
      ) {
        return
      }
      this.setData({ announcementBanner: next })
    } catch (e) {
      if (this.data.announcementBanner) {
        this.setData({ announcementBanner: null })
      }
    }
  },

  openAnnouncementDetail() {
    if (this.data.missionSwipeOpenWxkey) this.closeMissionSwipeCells()
    if (this.data.announcementBanner) {
      this.setData({ announcementDialogVisible: true })
    }
  },

  /** 客服会话回调：用户在会话中点击小程序卡片返回时，按卡片指定路径跳转（与 profile 页同款） */
  onContactCallback(e) {
    var detail = (e && e.detail) || {}
    var path = String(detail.path || '')
    if (!path) return
    var query = detail.query || {}
    var qs = Object.keys(query)
      .map(function (k) {
        return k + '=' + encodeURIComponent(query[k])
      })
      .join('&')
    var url = (path.charAt(0) === '/' ? path : '/' + path) + (qs ? '?' + qs : '')
    wx.navigateTo({
      url: url,
      fail: function () {
        // tabBar 页面无法 navigateTo，退回 switchTab
        wx.switchTab({ url: url.split('?')[0], fail: function () {} })
      }
    })
  },

  /**
   * DB media_assets 加载完成后，重算列表 + 倒计时区火箭图（三处同源）。
   * 允许 default → 正确图升级；禁止正确图 → default 降级（二次刷新 fuzzy miss 时）。
   */
  _refreshRocketImagesFromMediaMap() {
    const resolveOne = (m) => {
      if (!m || !m.rocketName) return null
      return resolveMissionRocketImage(m.rocketImage || m.image || '', m.rocketName, m.rocketConfiguration, true)
    }
    const refreshList = (listKey) => {
      const arr = this.data[listKey]
      if (!Array.isArray(arr) || !arr.length) return null
      let mutated = false
      const next = arr.map((m) => {
        if (!m || !m.rocketName) return m
        const rebuilt = resolveOne(m)
        if (!shouldReplaceRocketImage(m.rocketImage || m.image, rebuilt)) return m
        mutated = true
        return { ...m, rocketImage: rebuilt, image: rebuilt }
      })
      return mutated ? next : null
    }
    const patch = {}
    const upNext = refreshList('upcomingMissions')
    if (upNext) patch.upcomingMissions = upNext
    const dispNext = refreshList('displayedUpcomingMissions')
    if (dispNext) patch.displayedUpcomingMissions = dispNext
    const cpNext = refreshList('completedMissions')
    if (cpNext) patch.completedMissions = cpNext
    const calNext = refreshList('calendarAllMissions')
    if (calNext) patch.calendarAllMissions = calNext

    // 倒计时区与列表同 id 任务强制对齐（同样禁止降级）
    const ld = this.data.launchData
    if (ld && ld.id && ld.rocketName) {
      const curLd = ld.rocketImage || ld.image || ''
      const rebuiltLd = resolveOne(ld)
      if (shouldReplaceRocketImage(curLd, rebuiltLd)) {
        patch['launchData.image'] = rebuiltLd
        patch['launchData.rocketImage'] = rebuiltLd
      } else if (upNext) {
        const row = upNext.find((m) => m && String(m.id) === String(ld.id))
        if (row && shouldReplaceRocketImage(curLd, row.rocketImage)) {
          patch['launchData.image'] = row.rocketImage
          patch['launchData.rocketImage'] = row.rocketImage
        }
      }
    }

    if (Object.keys(patch).length) {
      this.setData(patch, () => {
        try {
          if (patch.upcomingMissions) this.updateMissionListView('upcoming', patch.upcomingMissions)
          if (patch.completedMissions) this.updateMissionListView('completed', patch.completedMissions)
          if (patch.calendarAllMissions) {
            this.updateCalendarDerivedState({
              sourceMissions: patch.calendarAllMissions,
              allMissions: patch.calendarAllMissions,
              keepExpanded: true
            })
          }
        } catch (e) {}
        try {
          this.syncLaunchPanelRocketImageWithUpcomingList()
        } catch (e) {}
        // 简报若已用 default 固化，随 media map 刷新重建，与卡片/倒计时同源
        try {
          const briefingComp = this.selectComponent('#morningBriefing')
          if (briefingComp && typeof briefingComp._loadBriefing === 'function') {
            briefingComp._loadBriefing()
          }
        } catch (e2) {}
      })
      try {
        const top = patch.upcomingMissions || patch.completedMissions || patch.calendarAllMissions
        this._preloadVisibleRocketImages(top, 8)
      } catch (e) {}
    } else {
      try {
        this.syncLaunchPanelRocketImageWithUpcomingList()
      } catch (e) {}
    }
  },
}

module.exports = {
  methods,
  attachTo(page) {
    Object.keys(methods).forEach((name) => {
      page[name] = methods[name].bind(page)
    })
    page.__liveSettleAttached = true
  }
}
