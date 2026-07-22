/**
 * subpackages/profile-extra/utils/profile-lazy.js
 * 我的页低频非首屏逻辑（从 pages/profile/profile.js 拆出）：
 * - 竞猜战绩：拉取投票结果、补全任务名/火箭图、清除记录
 * - 里程碑彩蛋：阈值检测、金蛋队列弹窗、领奖回写
 * - 服务号自动提醒：状态查询 / 开关 / 复制名称
 * - 老订阅记录补全、我的奖品、年度报告入口、在线客服区块（复制微信号 / 客服回调 / 设计稿分享）
 *
 * 主包 profile.js 通过 require.async + attachTo 委托加载，
 * 与首页 index-vote / 进展页 progress-lazy 模式一致。
 * profile 页在 preloadRule 中预下载 profile-extra 分包，实际几乎无加载等待。
 */
const { ROUTES } = require('../../../utils/routes.js')
const storageCache = require('../../../utils/storage-sync-cache.js')
const { clearLocalVotes, resolveVoteChoiceMeta } = require('../../../utils/index-page-helpers.js')
const { getRocketImage } = require('../../../utils/util.js')
const { getUpcomingMissions, getCompletedMissions } = require('../../../utils/api-launch-list.js')
const { getMyVoteResults, getVoteStats, clearMyVoteResults } = require('../../../utils/api-app-services.js')
const { getSubscribedMissions, saveLocalSubscription } = require('../../../utils/subscribe.js')
const { getOaAlertStatus, enableOaAlert, disableOaAlert } = require('./oa-alert.js')

const VOTE_STATS_TTL_MS = 5 * 60 * 1000
const MILESTONE_CHECK_TTL_MS = 10 * 60 * 1000

// onShow 高频云调用节流：OA 状态 / 奖品数据变化频率极低，
// 期内直接复用已渲染数据；主动操作（切开关、领奖、下拉刷新）时强刷
const OA_ALERT_STATUS_TTL_MS = 10 * 60 * 1000
const MY_PRIZES_TTL_MS = 10 * 60 * 1000

function defaultMilestoneTitle(type, threshold) {
  var n = Number(threshold) || 0
  if (!n) return ''
  if (type === 'checkin') return '恭喜达成' + n + '天签到！'
  if (type === 'quiz') return '恭喜累计答对' + n + '题！'
  if (type === 'vote') return '恭喜累计猜对' + n + '次发射！'
  return ''
}

function normalizeMilestoneTitle(m) {
  var title = (m && m.title) || ''
  var threshold = Number(m && m.threshold) || 0
  var type = m && m.type
  if (!threshold) return title

  // 误用签到标题的问答/竞猜里程碑：按类型生成正确标题
  if ((type === 'quiz' || type === 'vote') && /恭喜达成\d+天签到/.test(title)) {
    return defaultMilestoneTitle(type, threshold)
  }

  if (!title) return defaultMilestoneTitle(type, threshold) || title

  if (type === 'checkin') {
    var checkinMatch = title.match(/恭喜达成(\d+)天签到/)
    if (checkinMatch && Number(checkinMatch[1]) !== threshold) {
      return title.replace(/恭喜达成\d+天签到/, '恭喜达成' + threshold + '天签到')
    }
  } else if (type === 'quiz') {
    var quizMatch = title.match(/恭喜(?:累计)?答对(\d+)题/)
    if (quizMatch && Number(quizMatch[1]) !== threshold) {
      return title.replace(/恭喜(?:累计)?答对\d+题/, '恭喜累计答对' + threshold + '题')
    }
  } else if (type === 'vote') {
    var voteMatch = title.match(/恭喜(?:累计)?猜对(\d+)(?:次)?/)
    if (voteMatch && Number(voteMatch[1]) !== threshold) {
      return title.replace(/恭喜(?:累计)?猜对\d+(?:次)?(?:发射)?/, '恭喜累计猜对' + threshold + '次发射')
    }
  }
  return title
}

function mapMilestoneForEgg(m) {
  if (!m) return {}
  return {
    milestoneId: m._id,
    type: m.type,
    threshold: Number(m.threshold) || 0,
    title: normalizeMilestoneTitle(m),
    description: m.description || '',
    prizeImage: m.prizeImage || '',
    eggImage: m.eggImage || '',
    customOptions: Array.isArray(m.customOptions) ? m.customOptions : [],
    customNote: m.customNote || ''
  }
}

const methods = {
  // ── 服务号 B 通道自动提醒 ──

  async loadOaAlertStatus(force) {
    // onShow 高频入口节流：状态只会因用户自己切开关/关注服务号而变，10 分钟内不重复查
    const now = Date.now()
    if (!force && this._oaAlertStatusAt && now - this._oaAlertStatusAt < OA_ALERT_STATUS_TTL_MS) return
    this._oaAlertStatusAt = now
    try {
      const status = await getOaAlertStatus()
      this.setData({
        oaAlertEnabled: !!status.enabled,
        oaAlertFollowed: !!status.followed,
        oaAlertReady: !!status.ready,
        oaAlertMessage: status.message || ''
      })
    } catch (e) {}
  },

  async onOaAlertSwitch(e) {
    const wantOn = !!(e && e.detail && e.detail.value)
    if (this.data.oaAlertLoading) return
    this.setData({ oaAlertLoading: true })

    try {
      if (wantOn) {
        const ok = await enableOaAlert()
        if (!ok) {
          this.setData({ oaAlertEnabled: false })
        }
      } else {
        await disableOaAlert()
      }
    } finally {
      this.setData({ oaAlertLoading: false })
      this.loadOaAlertStatus(true)
      try {
        const { invalidateOaAlertCache } = require('./oa-alert.js')
        if (invalidateOaAlertCache) invalidateOaAlertCache()
      } catch (e) {}
    }
  },

  onCopyOaName() {
    wx.setClipboardData({
      data: '火星探索日志',
      success: () => wx.showToast({ title: '已复制服务号名称', icon: 'success' })
    })
  },

  /** 对缺少名称或发射时间的老订阅记录，尝试从本地详情缓存或 API 获取完整数据 */
  async _enrichIncompleteReminders() {
    const missions = this._cachedSubscribedMissions || getSubscribedMissions()
    const incomplete = missions.filter(m =>
      !m.name || m.name === '发射任务 #' + m.id || m.name === '未知任务' || !m.launchTime || !m.rocketImage
    )
    if (!incomplete.length) return

    // 列表只拉一次（此前每条不完整订阅都串行各拉 2 次列表，N 条 = 2N 次请求），
    // 拉到内存后所有订阅统一匹配
    let upcomingList = null
    let completedList = null
    const fetchListsOnce = async () => {
      if (upcomingList !== null) return
      try {
        const upcoming = await getUpcomingMissions(50, 0)
        upcomingList = upcoming.list || []
      } catch (e) {
        upcomingList = []
      }
      try {
        const completed = await getCompletedMissions(50, 0)
        completedList = completed.list || []
      } catch (e) {
        completedList = []
      }
    }

    let changed = false
    for (const m of incomplete) {
      // 先查本地详情缓存
      let detail = this._getMissionFromLocalCache(m.id)
      if (!detail) {
        await fetchListsOnce()
        detail = upcomingList.find(item => String(item.id) === String(m.id)) ||
          (completedList || []).find(item => String(item.id) === String(m.id))
      }
      if (!detail) continue

      const enriched = {
        id: m.id,
        missionName: detail.missionName || detail.name || m.name,
        name: detail.missionName || detail.name || m.name,
        rocketName: detail.rocketName || m.rocket,
        rocketImage: detail.rocketImage || m.rocketImage,
        launchTime: detail.launchTime || detail.windowStart || m.launchTime,
        padName: (detail.padDetail && detail.padDetail.padName) || m.pad
      }

      const nameChanged = enriched.missionName && enriched.missionName !== m.name
      const timeChanged = enriched.launchTime && enriched.launchTime !== m.launchTime
      const imgChanged = enriched.rocketImage && !m.rocketImage
      if (nameChanged || timeChanged || imgChanged) {
        saveLocalSubscription(m.id, enriched)
        changed = true
      }
    }
    if (changed) this.loadMyReminders(true)
  },

  // ── 我的奖品 ──

  loadMyPrizes(force) {
    if (!wx.cloud || !wx.cloud.callFunction) return
    // onShow 高频入口节流：奖品列表只在领奖后变化，10 分钟内复用已渲染数据
    var now = Date.now()
    if (!force && this._myPrizesAt && now - this._myPrizesAt < MY_PRIZES_TTL_MS) return
    this._myPrizesAt = now
    var self = this
    wx.cloud.callFunction({
      name: 'adminGateway',
      data: { path: '/milestone-claim/my', method: 'GET' }
    }).then(function (res) {
      var list = (res.result && res.result.data) || []
      // 补充 prizeImage（从缓存的里程碑配置中取）
      var milestoneCache = {}
      try {
        var cached = storageCache.readMemOrSync('_milestone_config_cache_v2', []) || []
        cached.forEach(function (m) { milestoneCache[m._id] = m })
      } catch (e) {}
      list.forEach(function (item) {
        if (!item.prizeImage && milestoneCache[item.milestoneId]) {
          item.prizeImage = milestoneCache[item.milestoneId].prizeImage || ''
        }
        // 将 selections 对象转为显示文本
        if (item.selections && typeof item.selections === 'object') {
          var parts = []
          var keys = Object.keys(item.selections)
          for (var k = 0; k < keys.length; k++) {
            if (item.selections[keys[k]]) parts.push(keys[k] + '：' + item.selections[keys[k]])
          }
          item.selectionsText = parts.join(' / ')
        }
      })
      self.setData({ myPrizes: list })
    }).catch(function () {})
  },

  onCopyTracking(e) {
    var num = e.currentTarget.dataset.num
    if (!num) return
    var data = String(num)
    var doCopy = function () {
      wx.setClipboardData({
        data: data,
        success: function () { wx.showToast({ title: '已复制', icon: 'success' }) },
        fail: function () {
          wx.showModal({ content: data, confirmText: '好的', showCancel: false })
        }
      })
    }
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({
        success: doCopy,
        fail: function () {
          // 隐私授权失败，直接尝试复制（部分版本不需要授权）
          doCopy()
        }
      })
    } else {
      doCopy()
    }
  },

  // ── 在线客服区块 ──

  onCopyWechat() {
    var data = String(this.data.aboutWechat || '')
    if (!data) return
    var doCopy = function () {
      wx.setClipboardData({
        data: data,
        success: function () { wx.showToast({ title: '已复制', icon: 'success' }) },
        fail: function () {
          wx.showModal({ title: '微信号', content: data, confirmText: '好的', showCancel: false })
        }
      })
    }
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({
        success: doCopy,
        fail: function () { doCopy() }
      })
    } else {
      doCopy()
    }
  },

  /** 客服会话回调：用户在会话中点击小程序卡片返回时，按卡片指定路径跳转 */
  onContactCallback(e) {
    var detail = (e && e.detail) || {}
    var path = String(detail.path || '')
    if (!path) return
    var query = detail.query || {}
    var qs = Object.keys(query)
      .map(function (k) { return k + '=' + encodeURIComponent(query[k]) })
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

  onShareFigma() {
    var url = 'https://admin.marsx.com.cn/#/share/figma'
    var encoded = encodeURIComponent(url)
    var copyAndModal = function () {
      wx.setClipboardData({
        data: url,
        success: function () {
          wx.showModal({
            title: '已复制设计稿链接',
            content: '链接已复制到剪贴板，可粘贴到聊天或浏览器打开：\n\n' + url,
            showCancel: false,
            confirmText: '我知道了'
          })
        },
        fail: function () {
          wx.showModal({
            title: '设计稿链接',
            content: url,
            showCancel: false,
            confirmText: '好的'
          })
        }
      })
    }
    wx.navigateTo({
      url: '/pages/webview/webview?url=' + encoded,
      fail: function () {
        copyAndModal()
      }
    })
  },

  // ── 年度报告入口 ──

  /** 年度报告入口：仅后台开启且在展示时间窗内 */
  loadYearReviewEntry() {
    if (!wx.cloud) return
    wx.cloud
      .callFunction({
        name: 'userDataGateway',
        data: { action: 'getYearInReviewConfig' }
      })
      .then((res) => {
        const r = res.result
        if (!r || !r.success || !r.config) return
        const c = r.config
        this.setData({
          yearReviewVisible: !!c.showEntry,
          yearReviewTitle: c.title || '我的太空年鉴',
          yearReviewSubtitle: c.subtitle || '',
          yearReviewYear: c.year || new Date().getFullYear()
        })
      })
      .catch(() => {})
  },

  goYearReview() {
    const y = this.data.yearReviewYear || new Date().getFullYear()
    wx.navigateTo({ url: `${ROUTES.YEAR_REVIEW}?year=${y}` })
  },

  loadAboutConfig() {
    var self = this
    wx.cloud.callFunction({
      name: 'adminGateway',
      data: { path: '/about-config', method: 'GET' }
    }).then(function (res) {
      var data = res.result && res.result.data
      if (data) {
        var update = {}
        if (data.aboutText) update.aboutText = data.aboutText
        if (data.aboutWechat) update.aboutWechat = data.aboutWechat
        if (Object.keys(update).length) self.setData(update)
      }
    }).catch(function () {})
  },

  async loadVoteStats(force) {
    var self = this
    // onShow 高频入口节流：战绩只在竞猜结算后变化，5 分钟内复用已渲染数据
    var throttleNow = Date.now()
    if (!force && this._voteStatsAt && throttleNow - this._voteStatsAt < VOTE_STATS_TTL_MS) return
    this._voteStatsAt = throttleNow
    try {
      var serverResults = await getMyVoteResults()

      // 对「发射时间已过 2 小时仍未结算」的投票触发读路径结算（与 adminGateway 自动结算一致），避免仅靠定时任务
      // 结算触发 10 分钟内只做一次（每次 onShow 都补结算太浪费），且并行发起而非串行 await
      var nudgeThrottled = this._voteNudgeDoneAt && (Date.now() - this._voteNudgeDoneAt < 10 * 60 * 1000)
      if (serverResults && serverResults.length && !nudgeThrottled) {
        var TWO_H = 2 * 60 * 60 * 1000
        var nudgeTasks = []
        for (var nj = 0; nj < serverResults.length && nudgeTasks.length < 8; nj++) {
          var sr0 = serverResults[nj]
          if (sr0.result) continue
          var lt0 = sr0.launchTime || sr0.lockedLaunchTime || ''
          if (!lt0) continue
          var ms0 = new Date(lt0).getTime()
          if (!ms0 || Date.now() - ms0 < TWO_H) continue
          nudgeTasks.push(
            getVoteStats(sr0.launchId, true, {
              launchTime: lt0,
              status: 'completed',
              voteType: sr0.voteType === 'outcome' ? 'outcome' : 'ontime'
            }).catch(function () {})
          )
        }
        if (nudgeTasks.length > 0) {
          this._voteNudgeDoneAt = Date.now()
          await Promise.all(nudgeTasks)
          serverResults = await getMyVoteResults()
        }
      }

      if (!serverResults || !serverResults.length) {
        // 兜底：本地也查一下，确保不漏
        var localVotesEmpty = storageCache.readMemOrSync('_voted_launches', {}) || {}
        if (!Object.keys(localVotesEmpty).length) {
          self.setData({
            voteStats: { total: 0, settled: 0, correct: 0, accuracy: 0, streak: 0, bestStreak: 0 },
            voteHistory: []
          })
          return
        }
        serverResults = []
      }

      // 用本地成败记录纠正「点了成功却落成准时/不鸽」的历史脏数据
      var localVotes = storageCache.readMemOrSync('_voted_launches', {}) || {}
      var resultMap = {}
      for (var ri = 0; ri < serverResults.length; ri++) {
        var rawItem = serverResults[ri] || {}
        var meta0 = resolveVoteChoiceMeta(rawItem.choice, rawItem.voteType)
        var mapKey0 = String(rawItem.launchId) + '::' + meta0.voteType
        resultMap[mapKey0] = Object.assign({}, rawItem, {
          voteType: meta0.voteType,
          choice: meta0.choice,
          choiceLabel: meta0.choiceLabel,
          voteTypeLabel: meta0.voteTypeLabel
        })
      }
      Object.keys(localVotes).forEach(function (lk) {
        var parts = String(lk).split('::')
        if (parts.length < 2) return
        var localVt = parts[parts.length - 1]
        if (localVt !== 'outcome' && localVt !== 'ontime') return
        var localLaunchId = parts.slice(0, -1).join('::')
        var localChoice = localVotes[lk]
        var localMeta = resolveVoteChoiceMeta(localChoice, localVt)
        if (!localMeta.choice) return
        var mk = localLaunchId + '::' + localMeta.voteType
        var ontimeKey = localLaunchId + '::ontime'
        var hasLocalOntime = !!(localVotes[localLaunchId + '::ontime'] || localVotes[localLaunchId])

        // 本地有成败票，服务端却只有准时 ge/buge → 升格为成败，去掉误投准时脏数据
        if (localMeta.voteType === 'outcome') {
          var ontimeRow = resultMap[ontimeKey]
          if (ontimeRow && (ontimeRow.choice === 'ge' || ontimeRow.choice === 'buge') && !resultMap[mk] && !hasLocalOntime) {
            resultMap[mk] = Object.assign({}, ontimeRow, {
              voteType: 'outcome',
              voteTypeLabel: '成败',
              choice: localMeta.choice,
              choiceLabel: localMeta.choiceLabel
            })
            delete resultMap[ontimeKey]
            return
          }
        }

        if (!resultMap[mk]) {
          resultMap[mk] = {
            launchId: localLaunchId,
            voteType: localMeta.voteType,
            voteTypeLabel: localMeta.voteTypeLabel,
            choice: localMeta.choice,
            choiceLabel: localMeta.choiceLabel,
            result: '',
            missionName: '',
            rocketName: '',
            launchTime: '',
            lockedLaunchTime: ''
          }
        } else if (localMeta.voteType === 'outcome') {
          resultMap[mk].voteType = 'outcome'
          resultMap[mk].voteTypeLabel = '成败'
          resultMap[mk].choice = localMeta.choice
          resultMap[mk].choiceLabel = localMeta.choiceLabel
          if (!hasLocalOntime && resultMap[ontimeKey] &&
            (resultMap[ontimeKey].choice === 'ge' || resultMap[ontimeKey].choice === 'buge')) {
            delete resultMap[ontimeKey]
          }
        }
      })
      serverResults = Object.keys(resultMap).map(function (k) { return resultMap[k] })

      var history = []
      var settled = 0
      var correct = 0

      for (var i = 0; i < serverResults.length; i++) {
        var item = serverResults[i]
        var meta = resolveVoteChoiceMeta(item.choice, item.voteType)
        var choice = meta.choice
        var choiceLabel = item.choiceLabel || meta.choiceLabel
        var voteType = meta.voteType
        var voteTypeLabel = item.voteTypeLabel || meta.voteTypeLabel
        var result = item.result || ''
        if (voteType === 'outcome') {
          if (result === 'buge') result = 'success'
          else if (result === 'ge') result = 'failure'
        }
        var isCorrect = !!(result && choice && choice === result)

        if (result) {
          settled++
          if (isCorrect) correct++
        }

        // 服务器老投票记录可能没存任务名/火箭名（主记录首建时缺失就不再回填），
        // 先从本地任务详情缓存补全，仍缺的稍后统一从任务列表补
        var missionName = item.missionName || ''
        var rocketName = item.rocketName || ''
        if (!missionName || !rocketName) {
          var cachedMission = self._getMissionFromLocalCache(item.launchId)
          if (cachedMission) {
            if (!missionName) missionName = cachedMission.missionName || cachedMission.name || ''
            if (!rocketName) rocketName = cachedMission.rocketName || ''
          }
        }

        // 获取火箭配置图
        var rocketImage = ''
        if (rocketName) {
          rocketImage = getRocketImage(rocketName) || ''
        }

        // 计算距发射天数
        var launchTimeStr = item.lockedLaunchTime || item.launchTime || ''
        var daysLabel = ''
        if (result) {
          daysLabel = isCorrect ? '✓ 猜对' : '✕ 猜错'
        } else if (launchTimeStr) {
          var ltMs = new Date(launchTimeStr).getTime()
          var nowMs = Date.now()
          if (ltMs > 0) {
            var diffDays = Math.ceil((ltMs - nowMs) / (24 * 60 * 60 * 1000))
            if (diffDays <= 0) daysLabel = '待揭晓'
            else if (diffDays === 1) daysLabel = '明天'
            else daysLabel = diffDays + '天后'
          } else {
            daysLabel = '待揭晓'
          }
        } else {
          daysLabel = '待揭晓'
        }

        history.push({
          id: item.launchId + '::' + voteType,
          launchId: item.launchId,
          voteType: voteType,
          voteTypeLabel: voteTypeLabel,
          name: missionName || '任务 #' + item.launchId,
          rocket: rocketName,
          rocketImage: rocketImage,
          choice: choice,
          choiceLabel: choiceLabel,
          result: result,
          isCorrect: isCorrect,
          daysLabel: daysLabel,
          launchTime: launchTimeStr,
          sortTime: launchTimeStr ? new Date(launchTimeStr).getTime() || 0 : 0,
          settledAt: item.settledAt || ''
        })
      }

      history.sort(function (a, b) { return b.sortTime - a.sortTime })

      var streak = 0
      var bestStreak = 0
      var tempStreak = 0
      for (var si = 0; si < history.length; si++) {
        if (!history[si].result) continue
        if (history[si].isCorrect) {
          tempStreak++
          if (tempStreak > bestStreak) bestStreak = tempStreak
        } else {
          tempStreak = 0
        }
      }
      for (var sj = 0; sj < history.length; sj++) {
        if (!history[sj].result) continue
        if (history[sj].isCorrect) streak++
        else break
      }

      self.setData({
        voteStats: {
          total: serverResults.length,
          settled: settled,
          correct: correct,
          accuracy: settled > 0 ? Math.round(correct / settled * 100) : 0,
          streak: streak,
          bestStreak: bestStreak
        },
        voteHistory: history
      })

      self._enrichVoteHistory()
    } catch (e) {
      console.error('[Profile] loadVoteStats error:', e)
    }
  },

  /** 对仍缺任务名/火箭图的竞猜记录，从任务列表接口补全（列表只拉一次） */
  async _enrichVoteHistory() {
    var history = this.data.voteHistory || []
    var needFix = history.some(function (h) {
      return !h.rocketImage || h.name.indexOf('任务 #') === 0
    })
    if (!needFix) return
    if (this._voteEnrichPending) return
    this._voteEnrichPending = true

    try {
      var lists = await Promise.all([
        getUpcomingMissions(50, 0).catch(function () { return { list: [] } }),
        getCompletedMissions(50, 0).catch(function () { return { list: [] } })
      ])
      var all = (lists[0].list || []).concat(lists[1].list || [])
      if (!all.length) return

      var byId = {}
      all.forEach(function (m) { byId[String(m.id)] = m })

      var patch = {}
      var latest = this.data.voteHistory || []
      for (var i = 0; i < latest.length; i++) {
        var h = latest[i]
        if (h.rocketImage && h.name.indexOf('任务 #') !== 0) continue
        var m = byId[String(h.id)]
        if (!m) continue

        var name = m.missionName || m.name || ''
        var rocket = m.rocketName || ''
        if (name && h.name.indexOf('任务 #') === 0) {
          patch['voteHistory[' + i + '].name'] = name
        }
        if (rocket && !h.rocket) {
          patch['voteHistory[' + i + '].rocket'] = rocket
        }
        if (!h.rocketImage) {
          var img = rocket ? (getRocketImage(rocket) || '') : ''
          if (img) patch['voteHistory[' + i + '].rocketImage'] = img
        }
      }
      if (Object.keys(patch).length > 0) this.setData(patch)
    } catch (e) {
      console.error('[Profile] _enrichVoteHistory error:', e)
    } finally {
      this._voteEnrichPending = false
    }
  },

  onVoteHistoryTap(e) {
    var id = e.currentTarget.dataset.id
    if (!id) return
    // 兼容复合 id：launchId::voteType
    var launchId = String(id).split('::')[0]
    wx.navigateTo({ url: ROUTES.MISSION_DETAIL + '?id=' + launchId + '&type=upcoming' })
  },

  onToggleVoteHistory() {
    this.setData({ voteHistoryExpanded: !this.data.voteHistoryExpanded })
  },

  /** 清除全部竞猜记录：中度震动 → 二次确认 → 云端删除 + 本地清空 */
  onClearVoteHistory() {
    var self = this
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    wx.showModal({
      title: '清除竞猜记录',
      content: '确定清除全部竞猜记录吗？统计与连胜数据将一并清零，此操作不可恢复。',
      confirmText: '清除',
      confirmColor: '#FF453A',
      success: function (res) {
        if (!res.confirm) return
        self._doClearVoteHistory()
      }
    })
  },

  async _doClearVoteHistory() {
    if (this._voteClearPending) return
    this._voteClearPending = true
    wx.showLoading({ title: '清除中...', mask: true })
    try {
      await clearMyVoteResults()
      clearLocalVotes()
      this._voteStatsAt = 0
      this.setData({
        voteStats: { total: 0, settled: 0, correct: 0, accuracy: 0, streak: 0, bestStreak: 0 },
        voteHistory: [],
        voteHistoryExpanded: false
      })
      wx.hideLoading()
      wx.showToast({ title: '已清除', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: (e && e.message) || '清除失败，请稍后重试', icon: 'none' })
    } finally {
      this._voteClearPending = false
    }
  },

  checkMilestones(force) {
    if (this.data.showMilestoneEgg) return

    // onShow 高频入口节流：里程碑配置/领奖记录变化极低频，10 分钟内不重复拉取
    // （签到/答题后的主动检查传 force=true 绕过）
    var throttleNow = Date.now()
    if (!force && this._milestoneCheckAt && throttleNow - this._milestoneCheckAt < MILESTONE_CHECK_TTL_MS) return
    this._milestoneCheckAt = throttleNow

    var self = this

    // ★ 测试模式：设为 true 跳过阈值检测直接弹金蛋（使用后台真实数据），测试完改回 false
    var TEST_MODE = false
    if (TEST_MODE) {
      var fetchTestMilestones = wx.cloud.callFunction({
        name: 'adminGateway',
        data: { path: '/milestones', method: 'GET' }
      }).then(function (res) { return (res.result && res.result.data) || [] })
        .catch(function () { return [] })

      var fetchTestClaims = wx.cloud.callFunction({
        name: 'adminGateway',
        data: { path: '/milestone-claim/my', method: 'GET' }
      }).then(function (res) { return (res.result && res.result.data) || [] })
        .catch(function () { return [] })

      Promise.all([fetchTestMilestones, fetchTestClaims]).then(function (results) {
        var list = results[0] || []
        var claimedList = results[1] || []
        var claimedIds = {}
        claimedList.forEach(function (c) { claimedIds[c.milestoneId] = true })

        var queue = []
        list.forEach(function (m) {
          if (!m.enabled) return
          if (claimedIds[m._id]) return
          queue.push(mapMilestoneForEgg(m))
        })
        if (queue.length > 0) {
          self.data._milestoneQueue = queue
          setTimeout(function () { self._showNextMilestone() }, 800)
        }
      })
      return
    }

    if (!wx.cloud || !wx.cloud.callFunction) return

    var checkinData = storageCache.getMem('_checkin_data')
    if (checkinData === undefined) {
      try { checkinData = require('../../../utils/checkin.js').warmCheckinStoreSync() } catch (e) { checkinData = null }
    }
    var checkinDays = checkinData ? (checkinData.totalDays || 0) : 0

    var quizData = storageCache.getMem('_space_quiz_data')
    if (quizData === undefined) {
      try { quizData = require('../../../utils/space-quiz.js').warmQuizStoreSync() } catch (e2) { quizData = null }
    }
    var quizCorrect = quizData ? (quizData.correctCount || 0) : 0

    var voteCorrect = self.data.voteStats ? self.data.voteStats.correct || 0 : 0

    if (checkinDays === 0 && quizCorrect === 0 && voteCorrect === 0) return

    var cacheKey = '_milestone_config_cache_v2'
    var claimCacheKey = '_milestone_claims_cache'
    var milestones = null
    var myClaims = null

    milestones = storageCache.readMemOrSync(cacheKey, null)
    myClaims = storageCache.readMemOrSync(claimCacheKey, null)

    var fetchMilestones = new Promise(function (resolve) {
      wx.cloud.callFunction({
        name: 'adminGateway',
        data: { path: '/milestones', method: 'GET' }
      }).then(function (res) {
        var list = (res.result && res.result.data) || []
        storageCache.persistAsync(cacheKey, list)
        resolve(list)
      }).catch(function () {
        resolve(milestones || [])
      })
    })

    var fetchClaims = new Promise(function (resolve) {
      wx.cloud.callFunction({
        name: 'adminGateway',
        data: { path: '/milestone-claim/my', method: 'GET' }
      }).then(function (res) {
        var cloudList = (res.result && res.result.data) || []
        // 合并本地缓存，防止刚提交的领奖记录被覆盖
        var localClaims = []
        localClaims = storageCache.readMemOrSync(claimCacheKey, []) || []
        var idSet = {}
        cloudList.forEach(function (c) { idSet[c.milestoneId] = true })
        localClaims.forEach(function (c) {
          if (c.milestoneId && !idSet[c.milestoneId]) cloudList.push(c)
        })
        storageCache.persistAsync(claimCacheKey, cloudList)
        resolve(cloudList)
      }).catch(function () {
        resolve(myClaims || [])
      })
    })

    Promise.all([fetchMilestones, fetchClaims]).then(function (results) {
      var allMilestones = results[0] || []
      var claimedList = results[1] || []

      var claimedIds = {}
      claimedList.forEach(function (c) { claimedIds[c.milestoneId] = true })

      var queue = []
      allMilestones.forEach(function (m) {
        if (!m.enabled) return
        if (claimedIds[m._id]) return

        var threshold = Number(m.threshold) || 0
        var reached = false
        if (m.type === 'checkin' && checkinDays >= threshold) reached = true
        if (m.type === 'quiz' && quizCorrect >= threshold) reached = true
        if (m.type === 'vote' && voteCorrect >= threshold) reached = true

        if (reached) {
          queue.push(mapMilestoneForEgg(m))
        }
      })

      if (queue.length > 0) {
        self.data._milestoneQueue = queue
        self._showNextMilestone()
      }
    })
  },

  _showNextMilestone() {
    var queue = this.data._milestoneQueue
    if (!queue || queue.length === 0) {
      this.setData({ showMilestoneEgg: false, currentMilestone: {} })
      return
    }
    var next = queue.shift()
    this.setData({ currentMilestone: next, showMilestoneEgg: true })
  },

  onMilestoneClose() {
    this.setData({ showMilestoneEgg: false })
    var self = this
    setTimeout(function () {
      self._showNextMilestone()
    }, 300)
  },

  onMilestoneClaimed(e) {
    var milestoneId = e.detail && e.detail.milestoneId
    if (milestoneId) {
      try {
        var claims = storageCache.readSync('_milestone_claims_cache', []) || []
        claims.push({ milestoneId: milestoneId })
        storageCache.persistAsync('_milestone_claims_cache', claims)
      } catch (err) {}
      // 刚领完奖：立刻强刷奖品列表，绕过 10 分钟节流
      this._myPrizesAt = 0
      this.loadMyPrizes(true)
    }
  },
}

module.exports = {
  methods,
  /** 把全部方法挂到页面实例上（委托加载后调用） */
  attachTo(page) {
    Object.keys(methods).forEach((k) => {
      page[k] = methods[k].bind(page)
    })
    page.__profileLazyAttached = true
  }
}
