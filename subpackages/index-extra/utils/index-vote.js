/**
 * 首页「发射竞猜投票」逻辑 — 分包异步加载（attachTo 模式，与 index-calendar-page 同构），
 * 减轻主包 index.js 注入与解析体积。竞猜框只在倒计时卡片数据就绪后出现，天然可延迟。
 */
const { getVoteStats, getVoteStatsStale, castVote } = require('../../../utils/api-app-services.js')
const {
  getInitialVoteState,
  buildVoteState,
  buildDualVoteUiPatch,
  mergeVoteBundle,
  getLocalVote,
  saveLocalVote,
  removeLocalVote,
  shouldSkipVoteRefresh
} = require('../../../utils/index-page-helpers.js')

// 竞猜刷新间隔：此前 15s，每次切 Tab 回首页都会重新打 adminGateway（skipCache=true 绕过本地缓存）。
// 投票后的最新票数由 castVote 返回值直接回填 bundle，不依赖这里的定时刷新；
// 防降级复核路径会先把 loadedAt 归零再触发，也不受该 TTL 影响。
const VOTE_REFRESH_TTL = 5 * 60 * 1000

const voteMethods = {
  resetVoteData() {
    this._voteRenderedLaunchId = ''
    this.setData(getInitialVoteState())
  },

  /** 竞猜防降级复核：绕过 30s 缓存强制重查一次（每任务限一次，避免循环重试） */
  _scheduleVoteRecheck(launchId) {
    this._voteRecheckDone = this._voteRecheckDone || {}
    if (this._voteRecheckDone[launchId]) return
    this._voteRecheckDone[launchId] = true
    if (this._voteRecheckTimer) clearTimeout(this._voteRecheckTimer)
    this._voteRecheckTimer = setTimeout(() => {
      this._voteRecheckTimer = null
      if (!this.data.launchData || String(this.data.launchData.id || '') !== String(launchId)) return
      this.loadVoteData(launchId, true)
    }, 1500)
  },

  _buildVoteMissionInfo(launchId, voteType) {
    const ld = this.data.launchData
    if (!ld || String(ld.id || '') !== String(launchId)) {
      return { voteType: voteType === 'outcome' ? 'outcome' : 'ontime' }
    }
    return {
      voteType: voteType === 'outcome' ? 'outcome' : 'ontime',
      launchTime: ld.launchTime || '',
      status: ld._detailType || '',
      statusCategory: ld.statusCategory || '',
      statusAbbrev: ld.statusAbbrev || '',
      statusName: ld.statusBadgeText || ld.status || '',
      missionName: ld.missionName || '',
      rocketName: ld.rocketName || ''
    }
  },

  _applyVoteBundle(launchId, preferredType) {
    const bundle = (this._voteBundle && this._voteBundle[String(launchId)]) || {}
    const active = preferredType || this.data.activeVoteType || 'ontime'
    this.setData(buildDualVoteUiPatch(bundle, active, launchId))
    this._voteRenderedLaunchId = String(launchId)
  },

  onVoteTypeSwitch(e) {
    const vt = (e.currentTarget.dataset && e.currentTarget.dataset.type) || ''
    if (vt !== 'ontime' && vt !== 'outcome') return
    if (vt === this.data.activeVoteType) return
    if (vt === 'ontime' && !this.data.voteOntimeEnabled) return
    if (vt === 'outcome' && !this.data.voteOutcomeEnabled) return
    const launchId = this.data.launchData && this.data.launchData.id
    if (!launchId) return
    this._applyVoteBundle(launchId, vt)
  },

  async loadVoteData(launchId, skipCache) {
    if (!launchId) return

    // 仅前7个即将发射的任务开放竞猜
    var missions = this.data.upcomingMissions || []
    var mIdx = -1
    for (var mi = 0; mi < missions.length; mi++) {
      if (String(missions[mi].id) === String(launchId)) {
        mIdx = mi
        break
      }
    }
    // 不在前7个中（包括找不到的情况，missions为空时放行让后续逻辑处理）
    if (missions.length > 0 && (mIdx < 0 || mIdx >= 7)) {
      this.setData(getInitialVoteState())
      return null
    }

    var currentLaunchId = String(launchId)
    var now = Date.now()
    this._voteRequestMeta = this._voteRequestMeta || {}
    var voteMeta = this._voteRequestMeta[currentLaunchId] || {}

    if (voteMeta.promise) {
      return voteMeta.promise
    }

    if (
      shouldSkipVoteRefresh({
        launchId: currentLaunchId,
        lastLoadedAt: voteMeta.loadedAt,
        ttlMs: VOTE_REFRESH_TTL,
        skipCache,
        now
      })
    ) {
      // 优先用投票后更新过的 live bundle，避免旧 voteMeta.bundle 把票数打回 0
      this._voteBundle = this._voteBundle || {}
      if (!this._voteBundle[currentLaunchId] && voteMeta.bundle) {
        this._voteBundle[currentLaunchId] = voteMeta.bundle
      } else if (this._voteBundle[currentLaunchId] && voteMeta.bundle) {
        this._voteBundle[currentLaunchId] = mergeVoteBundle(
          voteMeta.bundle,
          this._voteBundle[currentLaunchId],
          currentLaunchId
        )
      }
      if (this._voteBundle[currentLaunchId]) {
        this._applyVoteBundle(currentLaunchId, this.data.activeVoteType)
      }
      return voteMeta.stats || null
    }

    var request = (async () => {
      // stale-while-revalidate：先用本地旧缓存即时渲染（含本地已投选项），云端结果回来后覆盖
      if (!voteMeta.bundle) {
        try {
          var staleOntime = await getVoteStatsStale(launchId, 'ontime')
          var staleOutcome = await getVoteStatsStale(launchId, 'outcome')
          if (
            (staleOntime || staleOutcome) &&
            this.data.launchData &&
            String(this.data.launchData.id || '') === currentLaunchId
          ) {
            var staleBundle = { ontime: staleOntime, outcome: staleOutcome }
            this._voteBundle = this._voteBundle || {}
            this._voteBundle[currentLaunchId] = staleBundle
            this._applyVoteBundle(currentLaunchId, this.data.activeVoteType)
          }
        } catch (eStale) {}
      }

      var ontimeInfo = this._buildVoteMissionInfo(currentLaunchId, 'ontime')
      var outcomeInfo = this._buildVoteMissionInfo(currentLaunchId, 'outcome')

      // 优先复用 onLoad 预取的准时竞猜结果
      var ontimeStats = null
      var outcomeStats = null
      if (String(this._votePrefetchId || '') === currentLaunchId && this._votePrefetchPromise) {
        var prefetchPromise = this._votePrefetchPromise
        this._votePrefetchId = ''
        this._votePrefetchPromise = null
        var ldTs =
          this.data.launchData && this.data.launchData.launchTime
            ? new Date(this.data.launchData.launchTime).getTime()
            : 0
        if (ldTs && ldTs - Date.now() > 30 * 60 * 1000) {
          try {
            ontimeStats = await prefetchPromise
          } catch (ePrefetch) {
            ontimeStats = null
          }
        }
      }

      var fetchTasks = []
      if (!ontimeStats) {
        fetchTasks.push(
          getVoteStats(launchId, skipCache, ontimeInfo)
            .then(function (s) {
              ontimeStats = s
            })
            .catch(function () {
              ontimeStats = null
            })
        )
      }
      fetchTasks.push(
        getVoteStats(launchId, skipCache, outcomeInfo)
          .then(function (s) {
            outcomeStats = s
          })
          .catch(function () {
            outcomeStats = null
          })
      )
      await Promise.all(fetchTasks)

      // 合并本地已投选项
      if (ontimeStats && !ontimeStats.myVote) ontimeStats.myVote = getLocalVote(launchId, 'ontime')
      if (outcomeStats && !outcomeStats.myVote) outcomeStats.myVote = getLocalVote(launchId, 'outcome')

      var prevBundle = (this._voteBundle && this._voteBundle[currentLaunchId]) || (voteMeta && voteMeta.bundle) || null
      var bundle = mergeVoteBundle(prevBundle, { ontime: ontimeStats, outcome: outcomeStats }, currentLaunchId)
      var activeStats =
        (this.data.activeVoteType === 'outcome' ? bundle.outcome : bundle.ontime) || bundle.ontime || bundle.outcome

      // 防降级：stale 已渲染出竞猜框后，fresh 若双题型都关闭/失败，先复核再隐藏
      var staleRendered = String(this._voteRenderedLaunchId || '') === currentLaunchId && this.data.voteSlotVisible
      var freshSlotVisible = !!(bundle.ontime && bundle.ontime.enabled) || !!(bundle.outcome && bundle.outcome.enabled)
      var freshDowngrade = !freshSlotVisible
      if (staleRendered && freshDowngrade) {
        this._voteRecheckDone = this._voteRecheckDone || {}
        if (!skipCache && !this._voteRecheckDone[currentLaunchId]) {
          this._voteRequestMeta[currentLaunchId] = {
            loadedAt: 0,
            stats: null,
            bundle: prevBundle || null,
            promise: null
          }
          this._scheduleVoteRecheck(currentLaunchId)
          return activeStats
        }
        if (!ontimeStats && !outcomeStats) {
          this._voteRequestMeta[currentLaunchId] = {
            loadedAt: 0,
            stats: null,
            bundle: prevBundle || null,
            promise: null
          }
          return null
        }
      }

      this._voteBundle = this._voteBundle || {}
      this._voteBundle[currentLaunchId] = bundle
      this._voteRequestMeta[currentLaunchId] = {
        loadedAt: Date.now(),
        stats: activeStats,
        bundle,
        promise: null
      }
      if (!this.data.launchData || String(this.data.launchData.id || '') !== currentLaunchId) return activeStats
      this._applyVoteBundle(currentLaunchId, this.data.activeVoteType)
      return activeStats
    })()

    this._voteRequestMeta[currentLaunchId] = {
      ...voteMeta,
      promise: request
    }

    try {
      return await request
    } finally {
      var latestMeta = this._voteRequestMeta[currentLaunchId] || {}
      if (latestMeta.promise === request) {
        this._voteRequestMeta[currentLaunchId] = {
          ...latestMeta,
          promise: null
        }
      }
    }
  },

  async onVote(e) {
    var pill = (e.currentTarget.dataset && (e.currentTarget.dataset.pill || e.currentTarget.dataset.side)) || ''
    var launchId = this.data.launchData.id
    var voteType = this.data.activeVoteType === 'outcome' ? 'outcome' : 'ontime'
    // 左右侧在 JS 内映射，避免把成败投成 ge/buge
    var choice =
      voteType === 'outcome'
        ? pill === 'left'
          ? 'failure'
          : pill === 'right'
            ? 'success'
            : ''
        : pill === 'left'
          ? 'ge'
          : pill === 'right'
            ? 'buge'
            : ''
    if (!launchId || !choice) return
    if (this.data.voteData && this.data.voteData.votingClosed) {
      wx.showToast({ title: '竞猜已封盘', icon: 'none' })
      return
    }
    if (this.data.myVote) {
      wx.showToast({ title: '你已经投过啦', icon: 'none' })
      return
    }
    // 投票成功路径：中度震动反馈
    this._vibrateMedium()
    saveLocalVote(launchId, choice, voteType)
    var oldData = this.data.voteData || { geCount: 0, buGeCount: 0 }
    var leftChoice = voteType === 'outcome' ? 'failure' : 'ge'
    var rightChoice = voteType === 'outcome' ? 'success' : 'buge'
    var newGe = (oldData.geCount || 0) + (choice === leftChoice ? 1 : 0)
    var newBuge = (oldData.buGeCount || 0) + (choice === rightChoice ? 1 : 0)
    var total = newGe + newBuge
    var votePatch = {
      myVote: choice,
      'voteData.geCount': newGe,
      'voteData.buGeCount': newBuge,
      'voteData.failureCount': voteType === 'outcome' ? newGe : oldData.failureCount || 0,
      'voteData.successCount': voteType === 'outcome' ? newBuge : oldData.successCount || 0,
      voteTotal: total,
      voteGePct: Math.round((newGe / total) * 100),
      voteBugePct: Math.round((newBuge / total) * 100)
    }
    this.setData(votePatch)
    var serverData = null
    var voteFailMsg = ''
    try {
      serverData = await castVote(launchId, choice, {
        voteType,
        missionName: this.data.launchData.missionName,
        rocketName: this.data.launchData.rocketName,
        launchTime: this.data.launchData.launchTime,
        statusCategory: this.data.launchData.statusCategory || '',
        statusAbbrev: this.data.launchData.statusAbbrev || '',
        statusName: this.data.launchData.statusBadgeText || ''
      })
    } catch (err) {
      serverData = null
      voteFailMsg = (err && err.message) || ''
    }
    if (serverData) {
      var normalized = buildVoteState(serverData, choice, voteType)
      // 服务端若未带回票数，至少保留乐观更新的人数与比例条
      if (!normalized.voteTotal && total > 0) {
        normalized.voteData.geCount = newGe
        normalized.voteData.buGeCount = newBuge
        if (voteType === 'outcome') {
          normalized.voteData.failureCount = newGe
          normalized.voteData.successCount = newBuge
        }
        normalized.voteTotal = total
        normalized.voteGePct = Math.round((newGe / total) * 100)
        normalized.voteBugePct = Math.round((newBuge / total) * 100)
      }
      this.setData({
        voteData: normalized.voteData,
        myVote: choice,
        voteTotal: normalized.voteTotal,
        voteGePct: normalized.voteGePct,
        voteBugePct: normalized.voteBugePct,
        activeVoteType: voteType
      })
      this._voteBundle = this._voteBundle || {}
      var lid = String(launchId)
      var b = this._voteBundle[lid] || {}
      var votedStats = Object.assign({}, serverData, {
        myVote: choice,
        enabled: true,
        geCount: normalized.voteData.geCount,
        buGeCount: normalized.voteData.buGeCount,
        failureCount: normalized.voteData.failureCount,
        successCount: normalized.voteData.successCount
      })
      b[voteType] = votedStats
      this._voteBundle[lid] = b
      // 同步 meta，避免 TTL 内刷新用旧 bundle 把票数打回 0
      this._voteRequestMeta = this._voteRequestMeta || {}
      var prevMeta = this._voteRequestMeta[lid] || {}
      this._voteRequestMeta[lid] = {
        loadedAt: Date.now(),
        stats: votedStats,
        bundle: b,
        promise: prevMeta.promise || null
      }
    } else {
      // 提交失败：回滚乐观更新（本地记录 + UI 计数），否则界面显示已投票但服务端没有记录
      removeLocalVote(launchId, voteType)
      var rbTotal = (oldData.geCount || 0) + (oldData.buGeCount || 0)
      this.setData({
        myVote: '',
        'voteData.geCount': oldData.geCount || 0,
        'voteData.buGeCount': oldData.buGeCount || 0,
        voteTotal: rbTotal,
        voteGePct: rbTotal > 0 ? Math.round(((oldData.geCount || 0) / rbTotal) * 100) : 50,
        voteBugePct: rbTotal > 0 ? Math.round(((oldData.buGeCount || 0) / rbTotal) * 100) : 50
      })
      wx.showToast({ title: voteFailMsg || '投票失败，请重试', icon: 'none' })
    }
  }
}

function attachTo(page) {
  if (page.__voteAttached) return voteMethods
  Object.keys(voteMethods).forEach((key) => {
    page[key] = voteMethods[key]
  })
  page.__voteAttached = true
  return voteMethods
}

module.exports = { attachTo }
