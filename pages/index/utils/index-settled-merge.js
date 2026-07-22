/**
 * pages/index/utils/index-settled-merge.js
 * 「结算 → 历史列表」合并域（从 pages/index/index.js 原样拆出，主包内同步加载）：
 * - recent_settled 内存缓存 / 本地持久化 / 冷启动 hydrate
 * - 终态角标覆盖、缺卡补插、占位卡修复、飞行中状态解析（reconcile）
 * - 历史列表加载成功编排、详情页终态回写
 *
 * index.js 通过 `...settledMergeMethods` 展开进 Page，方法内 this 即页面实例。
 *
 * ── 实例属性契约（本模块拥有读写权） ──
 *   _recentSettledCache / _recentSettledCacheAt     recent_settled 内存缓存及时间戳
 *   _recentSettledCloudFetchAt                      最近一次云端拉取时间（60s 内 force 降级读内存）
 *   _recentSettledFetchInflight                     在途去重 promise
 *   _recentSettledPersistAt / _recentSettledHydrating / _recentSettledHydratePromise
 *                                                   本地持久化节流与 hydrate 状态
 *   _completedStateGeneration                       历史列表应用代际（防旧请求覆盖新状态）
 *   _statusResolveInflight                          飞行中解析在途 id 集合
 *   _fullMissionCardStash                           流经首页的完整任务卡按 id 囤存（结算瘦卡修复素材）
 *
 * ── 依赖页面其它域提供的方法（保留在 index.js / 其它模块） ──
 *   _absorbLaunchStateObservations / _projectAuthoritativeLaunchState（权威状态域）
 *   _isKnownSettleableId / _scrubKnownSettleableCountdown / switchToNextUpcomingMission（倒计时域）
 *   applyUpcomingAgencyFilterToPatch / updateMissionListView /
 *   scheduleUpcomingAgencyChipsOverflowHint / _preloadVisibleRocketImages（列表域）
 *   hydrateCalendarFromLoadedMissionLists（日历分包委托）
 */
const {
  fetchLaunchStatusSnapshot,
  fetchRecentSettledLaunches,
  resolveLaunchStatuses
} = require('../../../utils/api-app-services.js')
const {
  getStatusCategory,
  getStatusBadgeText,
  isTerminalStatusId,
  getCountryDisplay
} = require('../../../utils/api-request.js')
const { isSettledStatusId } = require('../../../utils/launch-status-store.js')
const { formatDate, resolveMissionRocketImage } = require('../../../utils/util.js')
const { buildMissionListSetData } = require('../../../utils/index-mission-services.js')
const { filterExpiredMissions } = require('../../../utils/index-page-helpers.js')
const { attachMissionDetailMeta } = require('../../../utils/index-mission-nav.js')

const RECENT_SETTLED_MEM_TTL_MS = 10 * 60 * 1000
/** 无完整列表卡时，仅补插「刚结束」终态，避免 getRecent(40) 把旧记录刷成历史瘦卡 */
const SETTLED_PLACEHOLDER_NET_MAX_AGE_MS = 48 * 60 * 60 * 1000
/** recent_settled 本地持久化：冷启动先用上次会话快照过滤，免等云函数冷启动 */
const RECENT_SETTLED_PERSIST_KEY = '_recent_settled_persist_v1'
const RECENT_SETTLED_PERSIST_MIN_WRITE_GAP_MS = 5 * 1000

/** 可落历史并切下一个：终态(3/4/7/9) 或飞行中(6) */
function isSettleableLiveStatusId(id) {
  const n = id != null ? Number(id) : 0
  return isTerminalStatusId(n) || n === 6
}

const methods = {
  /**
   * 合并云端 recent_settled 到内存：空数组不冲掉已有终态；会话终态优先保留。
   * 解决：云读空窗 / setData 竞态后历史卡消失、即将发射又冒出就绪。
   */
  _absorbRecentSettled(incoming) {
    if (!Array.isArray(incoming)) {
      return Array.isArray(this._recentSettledCache) ? this._recentSettledCache : null
    }
    this._absorbLaunchStateObservations(incoming, 'live')
    const merged = Array.from(this._launchRecordsById.values())
      .filter((entry) => entry && isSettledStatusId(entry.status && entry.status.id))
      .sort((a, b) => (Number(b.observedAtMs) || 0) - (Number(a.observedAtMs) || 0))
      .slice(0, 40)
    this._recentSettledCache = merged
    this._recentSettledCacheAt = Date.now()
    this._persistRecentSettledSnapshot(merged)
    return merged
  },

  /** recent_settled 快照异步落盘（节流）：下次冷启动免等云函数即可过滤已落库任务 */
  _persistRecentSettledSnapshot(rows) {
    // hydrate 回灌时不能把旧数据重新盖上新时间戳落盘（否则过期快照被误判为新鲜）
    if (this._recentSettledHydrating) return
    if (!Array.isArray(rows) || !rows.length) return
    const now = Date.now()
    if (this._recentSettledPersistAt && now - this._recentSettledPersistAt < RECENT_SETTLED_PERSIST_MIN_WRITE_GAP_MS) {
      return
    }
    this._recentSettledPersistAt = now
    try {
      wx.setStorage({ key: RECENT_SETTLED_PERSIST_KEY, data: { rows, at: now }, fail: () => {} })
    } catch (e) {}
  },

  /**
   * 冷启动 hydrate：读上次会话持久化的 recent_settled 快照进内存。
   * _recentSettledCacheAt 用落盘时间而非当前时间：快照过期语义不变，
   * 云端强制刷新（onShow / loadInitialData 并行拉取）照常进行。
   */
  _hydrateRecentSettledFromStorage() {
    if (this._recentSettledHydratePromise) return this._recentSettledHydratePromise
    this._recentSettledHydratePromise = new Promise((resolve) => {
      try {
        wx.getStorage({
          key: RECENT_SETTLED_PERSIST_KEY,
          success: (res) => {
            try {
              const data = res && res.data
              const rows = data && Array.isArray(data.rows) ? data.rows : []
              const at = data && Number(data.at)
              // 内存已有云端数据（hydrate 迟到）时不用旧快照盖时间戳
              const memFresh = Array.isArray(this._recentSettledCache) && this._recentSettledCache.length
              if (rows.length && !memFresh) {
                this._recentSettledHydrating = true
                try {
                  this._absorbRecentSettled(rows)
                } finally {
                  this._recentSettledHydrating = false
                }
                if (Number.isFinite(at) && at > 0) this._recentSettledCacheAt = at
              } else if (rows.length && memFresh) {
                // 仅合并观测（持久化行保留原 observedAtMs，云端新数据在冲突时胜出）
                this._absorbLaunchStateObservations(rows, 'live')
              }
            } catch (e) {}
            resolve()
          },
          fail: () => resolve()
        })
      } catch (e2) {
        resolve()
      }
    })
    return this._recentSettledHydratePromise
  },

  /** 同步记住本会话已落库卡（不依赖 setData 时序，防 previous 刷新盖掉） */
  _rememberSessionCompleted(item) {
    if (!item || item.id == null) return
    const sid = item.statusId != null ? Number(item.statusId) : 0
    if (!isSettleableLiveStatusId(sid) || (!item._fromRecentSettled && !item._launchStateRevision)) return
    this._absorbLaunchStateObservations(
      [
        {
          id: String(item.id),
          name: item.name || '',
          net: item.launchTime || '',
          status: {
            id: sid,
            name: item.statusBadgeText || item.status || '',
            abbrev: item.statusAbbrev || ''
          },
          observedAtMs: Date.now(),
          source: 'live'
        }
      ],
      'live'
    )
  },

  handleCompletedMissionLoadSuccess(list, res) {
    this._completedStateGeneration = (this._completedStateGeneration || 0) + 1
    const generation = this._completedStateGeneration
    const apply = async (settled) => {
      if (generation !== this._completedStateGeneration) return
      this._absorbRecentSettled(settled)
      let base = Array.isArray(list) ? list : []
      this._stashFullMissionCards(base)
      this._absorbLaunchStateObservations(base, 'list')
      const projection = this._projectAuthoritativeLaunchState(
        this.data.upcomingMissions || [],
        // 同 id 时让本次 previous 接口返回的完整卡片覆盖旧的状态瘦卡，
        // 否则 countryDisplay / boosterInfo / recoveryIcons 会永久丢失。
        (this.data.completedMissions || []).concat(base)
      )
      base = projection.completed
      let merged = this._mergeRecentSettledIntoCompletedList(base, this._recentSettledCache)
      merged = await this._reconcileInflightHistoryStatuses(merged)
      if (generation !== this._completedStateGeneration) return
      const peeledUp = projection.upcoming
      const patch = {
        ...buildMissionListSetData('completed', merged, res, filterExpiredMissions)
      }
      if (peeledUp.length !== (this.data.upcomingMissions || []).length) {
        patch.upcomingMissions = peeledUp
        this.applyUpcomingAgencyFilterToPatch(patch, peeledUp)
      }
      this.setData(patch, () => {
        this.updateMissionListView('completed', merged)
        try {
          this.hydrateCalendarFromLoadedMissionLists()
        } catch (e) {}
        try {
          var briefingComp = this.selectComponent('#morningBriefing')
          if (briefingComp && typeof briefingComp._loadBriefing === 'function') {
            briefingComp._loadBriefing()
          }
        } catch (e2) {}
        if (patch.upcomingMissions) {
          const curId = this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
          if (curId && this._isKnownSettleableId(curId)) {
            try {
              this._scrubKnownSettleableCountdown()
            } catch (e3) {}
          }
        }
      })
      this._preloadVisibleRocketImages(merged, 5)
    }

    Promise.all([
      fetchLaunchStatusSnapshot(
        (Array.isArray(list) ? list : []).map((mission) => mission && mission.id).filter(Boolean)
      ),
      // 复用 recent_settled 内存缓存（10 分钟 TTL + 60s 云拉降级），
      // 避免历史列表加载与 loadInitialData/onShow 各自再打一次 ll2Query
      this._ensureRecentSettledCache(false)
    ])
      .then(([byId, recent]) => {
        const merged = []
        const seen = new Set()
        ;[byId, recent].forEach((rows) => {
          if (!Array.isArray(rows)) return
          rows.forEach((row) => {
            if (!row || row.id == null || seen.has(String(row.id))) return
            seen.add(String(row.id))
            merged.push(row)
          })
        })
        return apply(merged)
      })
      .catch(() => apply(null))
  },

  /** 列表字段是否为占位（即将发射瘦卡 / 终态占位常见） */
  _isPlaceholderMissionField(v) {
    const s = String(v == null ? '' : v).trim()
    if (!s) return true
    return /^(未知|未知火箭|未知地点|未知任务|未知载荷|待定|TBD|N\/A|-|—)$/i.test(s)
  },

  /** 终态占位卡或缺图/占位文案：需要用 settled.name 再拼一版 */
  _needsSettledCardRepair(item) {
    if (!item) return false
    if (item._fromRecentSettled || item._optimisticSettled) {
      if (this._isPlaceholderMissionField(item.rocketName)) return true
      if (this._isPlaceholderMissionField(item.padLocation)) return true
      if (this._isPlaceholderMissionField(item.countryDisplay)) return true
      if (!item.rocketImage && !item.image) return true
      if (item.missionName && String(item.missionName).indexOf('|') >= 0) return true
      if (!item.missionName && item.name && String(item.name).indexOf('|') >= 0) return true
    }
    return this._isPlaceholderMissionField(item.rocketName)
  },

  /**
   * 结算瘦卡修复素材：缓存流经首页的完整任务卡（含 countryDisplay/padLocation/图）。
   * 结算发生时即将发射列表里同 id 卡可能已被剔除，这里按 id 兜底取用。
   */
  _stashFullMissionCards(list) {
    if (!Array.isArray(list) || !list.length) return
    if (!this._fullMissionCardStash) this._fullMissionCardStash = new Map()
    const stash = this._fullMissionCardStash
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (!m || m.id == null) continue
      // 瘦卡本身不入库，否则会拿占位修占位
      if (m._fromRecentSettled || m._optimisticSettled) continue
      if (this._isPlaceholderMissionField(m.rocketName)) continue
      if (
        this._isPlaceholderMissionField(m.countryDisplay) &&
        this._isPlaceholderMissionField(m.padLocation)
      ) {
        continue
      }
      const idStr = String(m.id)
      if (stash.has(idStr)) stash.delete(idStr)
      stash.set(idStr, m)
    }
    // Map 按插入序淘汰最旧的，防止长会话无限增长
    while (stash.size > 120) {
      stash.delete(stash.keys().next().value)
    }
  },

  _getStashedFullMissionCard(id) {
    if (id == null || !this._fullMissionCardStash) return null
    return this._fullMissionCardStash.get(String(id)) || null
  },

  /** 从 recent_settled 行拼一张可点进详情的历史卡片（previous 缓存尚未入库时用） */
  _buildCompletedItemFromSettled(entry, baseMission) {
    const statusObj = (entry && entry.status) || {}
    const category = getStatusCategory(statusObj)
    const badge = getStatusBadgeText(statusObj, category)
    const stashed = this._getStashedFullMissionCard(entry && entry.id)
    const name = (entry && entry.name) || (baseMission && baseMission.name) || (stashed && stashed.name) || ''
    const parts = String(name)
      .split('|')
      .map((s) => String(s || '').trim())
      .filter(Boolean)
    const parsedRocket = parts[0] || ''
    const parsedMission = parts[1] || ''
    // base 可能来自即将发射瘦卡，字段已是「未知火箭/未知地点」等占位；占位不能压过 name 解析出的真实型号
    const isPlaceholder = (v) => this._isPlaceholderMissionField(v)
    const pick = (preferred, fallback) => {
      if (!isPlaceholder(preferred)) return preferred
      if (!isPlaceholder(fallback)) return fallback
      // 两边都是占位：返回空，避免把「未知火箭」永久写回
      return ''
    }
    const baseRocket = pick(baseMission && baseMission.rocketName, stashed && stashed.rocketName)
    const baseMissionName = pick(baseMission && baseMission.missionName, stashed && stashed.missionName)
    // missionName 若误存成「火箭 | 任务」整串，改用解析后的任务名
    const rocketName = pick(baseRocket, parsedRocket) || parsedRocket
    const missionName = (!isPlaceholder(baseMissionName) && String(baseMissionName).indexOf('|') < 0)
      ? baseMissionName
      : (parsedMission || '')
    const launchTime =
      (entry && entry.net) ||
      (baseMission && baseMission.launchTime) ||
      (stashed && stashed.launchTime) ||
      ''
    const sid = statusObj.id != null ? Number(statusObj.id) : null
    const baseImg =
      (baseMission && (baseMission.rocketImage || baseMission.image)) ||
      (stashed && (stashed.rocketImage || stashed.image)) ||
      ''
    const rocketImage = resolveMissionRocketImage(
      baseImg,
      rocketName,
      (baseMission && baseMission.rocketConfiguration) || (stashed && stashed.rocketConfiguration),
      true
    )
    const card = attachMissionDetailMeta(
      {
        ...(stashed || {}),
        ...(baseMission || {}),
        id: entry.id,
        name,
        missionName: missionName || name,
        rocketName: rocketName || '未知火箭',
        padLocation: pick(baseMission && baseMission.padLocation, stashed && stashed.padLocation),
        // 结算行没有 pad/服务商，最后用「火箭 | 任务」文本推断国家（如 Gravity-1 → 中国）
        countryDisplay:
          pick(baseMission && baseMission.countryDisplay, stashed && stashed.countryDisplay) ||
          getCountryDisplay(null, null, { name }),
        launchSite: pick(baseMission && baseMission.launchSite, stashed && stashed.launchSite),
        rocketImage,
        image: rocketImage,
        launchTime,
        formattedTime: launchTime
          ? formatDate(launchTime, 'MM月DD日 HH:mm')
          : (baseMission && baseMission.formattedTime) ||
            (stashed && stashed.formattedTime) ||
            '时间未知',
        status: badge,
        statusId: sid,
        statusAbbrev: statusObj.abbrev || (baseMission && baseMission.statusAbbrev) || '',
        statusCategory: category,
        statusBadgeText: badge,
        success: category === 'success' || category === 'deployed',
        isPartialFailure: category === 'partial',
        isFailure: category === 'failure' || category === 'partial',
        missionDescription:
          (baseMission && baseMission.missionDescription) ||
          (stashed && stashed.missionDescription) ||
          '',
        isExpired: false,
        _optimisticSettled: true,
        _fromRecentSettled: true
      },
      { id: entry.id, detailType: 'completed' }
    )
    // base/stash 可能是带卡片倒计时的即将发射卡；历史卡与其共用模板，
    // 冻结的非过期 cardCountdown 会在历史卡上渲染出静止倒计时
    delete card.showRocketCountdown
    delete card.cardCountdown
    return card
  },

  /**
   * recent_settled → 历史列表：终态覆盖角标；缺失 id 补插头部（解决 previous 未入库就刷新消失）。
   * 禁止用飞行中覆盖已有终态。
   */
  _mergeRecentSettledIntoCompletedList(list, settledOverride) {
    const settled = Array.isArray(settledOverride)
      ? settledOverride
      : Array.isArray(this._recentSettledCache)
        ? this._recentSettledCache
        : null
    const baseList = Array.isArray(list) ? list : []
    if (!settled || !settled.length) return baseList

    const byId = new Map()
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i]
      if (s && s.id && s.status) byId.set(String(s.id), s)
    }
    if (!byId.size) return baseList

    let changed = false
    const presentIds = new Set()
    const next = baseList.map((item) => {
      if (!item || item.id == null) return item
      const idStr = String(item.id)
      presentIds.add(idStr)
      const hit = byId.get(idStr)
      if (!hit || !hit.status) return item
      const sid = hit.status.id != null ? Number(hit.status.id) : 0
      const hitNetMs = hit.net ? new Date(hit.net).getTime() : 0
      if (isSettledStatusId(sid) && Number.isFinite(hitNetMs) && hitNetMs > Date.now()) return item
      const prevSid = item.statusId != null ? Number(item.statusId) : 0
      // 只接受终态或飞行中；终态不可被飞行中降级
      if (!isTerminalStatusId(sid) && sid !== 6) return item
      if (isTerminalStatusId(prevSid) && !isTerminalStatusId(sid)) return item
      const needsRepair = this._needsSettledCardRepair(item)
      // 已落库的瘦占位卡：状态相同也要重建，否则「未知火箭」会一直粘在列表上
      if (needsRepair) {
        changed = true
        const repaired = this._buildCompletedItemFromSettled(hit, item)
        this._rememberSessionCompleted(repaired)
        return repaired
      }
      const category = getStatusCategory(hit.status)
      const badge = getStatusBadgeText(hit.status, category)
      if (item.statusCategory === category && item.statusBadgeText === badge && prevSid === sid) return item
      changed = true
      return {
        ...item,
        status: badge,
        statusId: sid || item.statusId,
        statusAbbrev: hit.status.abbrev || item.statusAbbrev || '',
        statusCategory: category,
        statusBadgeText: badge,
        success: category === 'success' || category === 'deployed',
        isPartialFailure: category === 'partial',
        isFailure: category === 'failure' || category === 'partial',
        launchTime: hit.net || item.launchTime,
        formattedTime: hit.net ? formatDate(hit.net, 'MM月DD日 HH:mm') : item.formattedTime
      }
    })

    // previous 没有、但 settled 已有 → 补插到头部
    const inserts = []
    const nowMs = Date.now()
    const sorted = settled.slice().sort((a, b) => (Number(b.settledAtMs) || Number(b.observedAtMs) || 0) - (Number(a.settledAtMs) || Number(a.observedAtMs) || 0))
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i]
      if (!s || s.id == null || !s.status) continue
      const idStr = String(s.id)
      if (presentIds.has(idStr)) continue
      const sid = s.status.id != null ? Number(s.status.id) : 0
      if (!isTerminalStatusId(sid) && sid !== 6) continue
      const settledNetMs = s.net ? new Date(s.net).getTime() : 0
      if (isSettledStatusId(sid) && Number.isFinite(settledNetMs) && settledNetMs > nowMs) continue
      const base =
        (this.data.upcomingMissions || []).find((m) => m && String(m.id) === idStr) ||
        (this.data.completedMissions || []).find((m) => m && String(m.id) === idStr) ||
        null
      // 飞行中必须复用完整卡（peel 路径会带 base）；无 base 时禁止凭空插飞行中瘦卡。
      // 无 base 的终态占位仅限 NET 在 48h 内，防止 getRecent(40) 把旧终态刷进历史首页。
      if (!base) {
        if (!isTerminalStatusId(sid)) continue
        if (!Number.isFinite(settledNetMs) || settledNetMs < nowMs - SETTLED_PLACEHOLDER_NET_MAX_AGE_MS) continue
      }
      const card = this._buildCompletedItemFromSettled(s, base)
      this._rememberSessionCompleted(card)
      inserts.push(card)
      presentIds.add(idStr)
      changed = true
    }
    if (!changed) return baseList
    return inserts.length ? inserts.concat(next) : next
  },

  /**
   * 可落历史 id（终态 + 飞行中）：recent_settled + 本机会话历史卡。
   * 用于从即将发射剔除，避免「详情已部署 / 列表仍就绪」。
   */
  _collectSettleableSettledIdSet() {
    const ids = new Set()
    if (this._launchRecordsById && this._launchRecordsById.size) {
      this._launchRecordsById.forEach((record, id) => {
        const sid = record && record.status && record.status.id
        if (isSettledStatusId(sid)) ids.add(String(id))
      })
    }
    return ids
  },

  /**
   * @param {Array} list
   * @param {Array} [completedOverride] 即将写入的历史列表（setData 前 data 里还没有时传入）
   */
  _filterUpcomingAgainstSettled(list, completedOverride) {
    if (!Array.isArray(list) || !list.length) return list || []
    // 剔除前先囤完整卡：结算后重建历史卡时这是唯一还留有 pad/国家等字段的来源
    this._stashFullMissionCards(list)
    const ids = this._collectSettleableSettledIdSet()
    // 列表归属不是状态证据；completed 仅在自身状态明确可落库时参与互斥。
    const completed = Array.isArray(completedOverride) ? completedOverride : this.data.completedMissions || []
    for (let i = 0; i < completed.length; i++) {
      const item = completed[i]
      if (item && item.id != null && isSettledStatusId(item.statusId)) ids.add(String(item.id))
    }
    if (!ids.size) return list
    const filtered = list.filter((m) => !m || m.id == null || !ids.has(String(m.id)))
    return filtered.length === list.length ? list : filtered
  },

  /**
   * 读云库 recent_settled 写入内存缓存（供 settle / 历史角标复用）。
   */
  async _ensureRecentSettledCache(force) {
    const now = Date.now()
    // 60 秒内刚从云端拉过 → force 降级读内存：冷启动 onLoad(loadInitialData) 与
    // onShow 先后各 force 一次，第一次已完成时在途去重帮不上，这里兜住第二次
    if (
      force &&
      this._recentSettledCloudFetchAt &&
      now - this._recentSettledCloudFetchAt < 60 * 1000 &&
      Array.isArray(this._recentSettledCache)
    ) {
      force = false
    }
    if (
      !force &&
      Array.isArray(this._recentSettledCache) &&
      this._recentSettledCacheAt &&
      now - this._recentSettledCacheAt < RECENT_SETTLED_MEM_TTL_MS
    ) {
      return this._recentSettledCache
    }
    // 在途去重：并发 force 复用同一个在途请求
    if (this._recentSettledFetchInflight) {
      return this._recentSettledFetchInflight
    }
    const inflight = (async () => {
      try {
        const settled = await fetchRecentSettledLaunches()
        this._recentSettledCloudFetchAt = Date.now()
        return this._absorbRecentSettled(settled)
      } catch (e) {}
      return Array.isArray(this._recentSettledCache) ? this._recentSettledCache : null
    })()
    this._recentSettledFetchInflight = inflight
    inflight.finally(() => {
      if (this._recentSettledFetchInflight === inflight) {
        this._recentSettledFetchInflight = null
      }
    })
    return inflight
  },

  /** 历史列表中仍显示「飞行中」的 id（最多 5） */
  _collectInflightCompletedIds(list) {
    const out = []
    const arr = Array.isArray(list) ? list : []
    for (let i = 0; i < arr.length && out.length < 5; i++) {
      const m = arr[i]
      if (!m || m.id == null) continue
      const sid = m.statusId != null ? Number(m.statusId) : 0
      if (sid === 6 || m.statusCategory === 'inflight') out.push(String(m.id))
    }
    return out
  },

  /** 把 resolve 结果写入 recent_settled 内存 + 会话 Map（终态覆盖飞行中） */
  _upsertResolvedIntoSettledCache(rows) {
    if (!Array.isArray(rows) || !rows.length) return
    const entries = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row || !row.id || !row.status) continue
      const sid = row.status.id != null ? Number(row.status.id) : 0
      if (!isTerminalStatusId(sid) && sid !== 6) continue
      entries.push({
        id: String(row.id),
        name: row.name || '',
        net: row.net || '',
        status: {
          id: row.status.id,
          name: row.status.name || '',
          abbrev: row.status.abbrev || ''
        },
        settledAtMs: Date.now(),
        source: 'resolveLaunchStatuses_client'
      })
    }
    if (!entries.length) return
    this._absorbRecentSettled(entries)
  },

  /**
   * 历史列表仍有「飞行中」时，按 id 主动解析终态后再合并。
   * 权威链：LL2 list（经云 resolve）> recent_settled 终态 > previous/乐观缓存。
   */
  async _reconcileInflightHistoryStatuses(list) {
    const base = Array.isArray(list) ? list : []
    const ids = this._collectInflightCompletedIds(base)
    if (!ids.length) return base
    if (!this._statusResolveInflight) this._statusResolveInflight = new Set()
    const pending = ids.filter((id) => !this._statusResolveInflight.has(id))
    if (!pending.length) {
      return this._mergeRecentSettledIntoCompletedList(base, this._recentSettledCache)
    }
    pending.forEach((id) => this._statusResolveInflight.add(id))
    try {
      const rows = await resolveLaunchStatuses(pending)
      if (Array.isArray(rows) && rows.length) {
        this._upsertResolvedIntoSettledCache(rows)
        return this._mergeRecentSettledIntoCompletedList(base, this._recentSettledCache)
      }
    } catch (e) {
    } finally {
      pending.forEach((id) => this._statusResolveInflight.delete(id))
    }
    return base
  },

  /** 用最新 recent_settled 修正历史列表角标 / 补插缺失卡；必要时 resolve 飞行中 */
  async _applyRecentSettledToCompletedList(force) {
    const settled = await this._ensureRecentSettledCache(!!force)
    const list = this.data.completedMissions || []
    let merged = this._mergeRecentSettledIntoCompletedList(list, settled)
    merged = await this._reconcileInflightHistoryStatuses(merged)
    if (merged === list) return
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
        } catch (e) {}
        try {
          this.hydrateCalendarFromLoadedMissionLists()
        } catch (e2) {}
      }
    )
  },

  /**
   * 详情页终态回写：升角标；历史没有该卡则补插；并从即将发射剔除。
   * @param {{ id: string, statusId?: number, statusBadgeText?: string, statusCategory?: string, statusAbbrev?: string, name?: string, net?: string }} patch
   */
  applyCompletedMissionStatusFromDetail(patch) {
    if (!patch || patch.id == null) return
    const sid = patch.statusId != null ? Number(patch.statusId) : 0
    if (!isTerminalStatusId(sid)) return
    const idStr = String(patch.id)
    const category =
      patch.statusCategory || getStatusCategory({ id: sid, name: patch.statusBadgeText, abbrev: patch.statusAbbrev })
    const badge = patch.statusBadgeText || getStatusBadgeText({ id: sid, abbrev: patch.statusAbbrev }, category)

    // 同步写入 recent_settled 内存（终态优先，覆盖飞行中）
    const mem = Array.isArray(this._recentSettledCache) ? this._recentSettledCache.slice() : []
    const memIdx = mem.findIndex((s) => s && String(s.id) === idStr)
    const settledRow = {
      id: idStr,
      name: patch.name || (memIdx >= 0 ? mem[memIdx].name : '') || '',
      net: patch.net || (memIdx >= 0 ? mem[memIdx].net : '') || '',
      status: { id: sid, name: badge, abbrev: patch.statusAbbrev || '' },
      settledAtMs: Date.now(),
      source: 'detail_page_backfill'
    }
    this._absorbRecentSettled([settledRow])

    const list = this.data.completedMissions || []
    const idx = list.findIndex((m) => m && String(m.id) === idStr)
    let nextCompleted
    if (idx >= 0) {
      const item = list[idx]
      if (item.statusCategory === category && item.statusBadgeText === badge && Number(item.statusId) === sid) {
        nextCompleted = list
        this._rememberSessionCompleted(item)
      } else {
        nextCompleted = list.slice()
        nextCompleted[idx] = {
          ...item,
          status: badge,
          statusId: sid,
          statusAbbrev: patch.statusAbbrev || item.statusAbbrev || '',
          statusCategory: category,
          statusBadgeText: badge,
          success: category === 'success' || category === 'deployed',
          isPartialFailure: category === 'partial',
          isFailure: category === 'failure' || category === 'partial',
          _optimisticSettled: true
        }
        this._rememberSessionCompleted(nextCompleted[idx])
      }
    } else {
      const base = (this.data.upcomingMissions || []).find((m) => m && String(m.id) === idStr) || null
      const entry = {
        id: idStr,
        name: patch.name || (base && base.name) || '',
        net: patch.net || (base && base.launchTime) || '',
        status: { id: sid, name: badge, abbrev: patch.statusAbbrev || '' },
        settledAtMs: Date.now()
      }
      const card = this._buildCompletedItemFromSettled(entry, base)
      this._rememberSessionCompleted(card)
      nextCompleted = [card].concat(list)
    }

    const nextUpcoming = (this.data.upcomingMissions || []).filter((m) => !m || String(m.id) !== idStr)
    const upcomingChanged = nextUpcoming.length !== (this.data.upcomingMissions || []).length
    const patchData = {
      ...buildMissionListSetData(
        'completed',
        nextCompleted,
        {
          nextOffset: this.data.completedMissionsOffset,
          hasMore: this.data.completedMissionsHasMore
        },
        filterExpiredMissions
      )
    }
    if (upcomingChanged) {
      patchData.upcomingMissions = nextUpcoming
      this.applyUpcomingAgencyFilterToPatch(patchData)
    }
    this.setData(patchData, () => {
      try {
        this.updateMissionListView('completed', nextCompleted)
      } catch (e) {}
      if (upcomingChanged) {
        try {
          this.scheduleUpcomingAgencyChipsOverflowHint()
        } catch (e2) {}
        const curId = this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
        if (curId === idStr) {
          try {
            this.switchToNextUpcomingMission()
          } catch (e3) {}
        }
      }
    })
  }
}

module.exports = {
  methods,
  isSettleableLiveStatusId,
  RECENT_SETTLED_MEM_TTL_MS
}
