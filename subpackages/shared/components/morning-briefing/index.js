const { markBriefingRead, isBriefingUnread, loadPreferences, isBriefingGloballyEnabled, isBriefingPopupShownToday, markBriefingPopupShown } = require('../../../../utils/user-growth.js')
const { getAllStats } = require('../../../../utils/behavior-stats.js')
const { getRocketImage, resolveMissionRocketImage } = require('../../../../utils/util.js')
const { resolveMediaUrl } = require('../../../../utils/image-config.js')
const { ROUTES, navigateTo } = require('../../../../utils/routes.js')
const { gateCheck } = require('../../../../utils/membership.js')
const storageCache = require('../../../../utils/storage-sync-cache.js')
const themeUtil = require('../../../../utils/theme.js')
const { resolveTweetAccountAvatarUrl } = require('../../../../utils/event-share-image.js')

/** progress 为 tabBar 页，switchTab 不能带 query，用本地存储传筛选账号 */
var BRIEFING_PROGRESS_FILTER_KEY = '_briefing_progress_filter_source'
var BRIEFING_PROGRESS_FILTER_CLEAR_KEY = '_briefing_progress_filter_clear'

function normalizePageRoute(route) {
  if (route == null || typeof route !== 'string') return ''
  return route.replace(/^\//, '')
}

function isIndexPage(p) {
  return p && normalizePageRoute(p.route) === 'pages/index/index'
}

function markPopupShown() {
  markBriefingPopupShown()
}

function resolveRocketImg(rocketName) {
  var n = rocketName
  if (n == null || typeof n !== 'string') n = ''
  return getRocketImage(n) || ''
}

/** 与详情头图同源：按火箭名 forceRecompute，不锁死列表里可能过期的 default 盖章 */
function resolveBriefingRocketImage(m, rocketName) {
  if (!m) return resolveRocketImg(rocketName)
  var name = rocketName || m.rocketName || m.rocket || ''
  var cfg = m.rocketConfiguration || null
  var stamped = m.rocketImage || m.image || ''
  return resolveMissionRocketImage(stamped, name, cfg, true)
}

/** 标题常为「火箭型号 | 任务/载荷名」，简报第一行只展示竖线后任务名（第二行已是火箭型号） */
function briefingMissionDisplayName(rawTitle) {
  if (rawTitle == null || typeof rawTitle !== 'string') return ''
  var t = rawTitle.trim()
  if (!t) return ''
  if (/\s*\|\s*/.test(t)) {
    var parts = t.split(/\s*\|\s*/)
    if (parts.length >= 2) {
      var rest = parts.slice(1).join(' | ').trim()
      if (rest) return rest
    }
  }
  return t
}

/** rocket/rocketName 缺失时，从「型号 | 任务」标题里取竖线前一段作为型号，便于配置图映射 */
function briefingRocketNameFromMission(m, rawTitle) {
  var r = (m.rocket != null && m.rocket !== '') ? String(m.rocket).trim() : ''
  if (!r && m.rocketName != null && m.rocketName !== '') r = String(m.rocketName).trim()
  if (r) return r
  var title = (rawTitle != null && typeof rawTitle === 'string') ? rawTitle.trim() : ''
  if (title.indexOf('|') !== -1) {
    var head = title.split(/\s*\|\s*/)[0].trim()
    if (head) return head
  }
  return ''
}

/** 与 userDataGateway.handleGetTodayBriefing 中 utcToBeijingDate 一致 */
function utcToBeijingYmd(raw) {
  if (!raw) return ''
  var d = new Date(raw)
  if (isNaN(d.getTime())) return ''
  var beijing = new Date(d.getTime() + 8 * 3600 * 1000)
  var y = beijing.getUTCFullYear()
  var mo = String(beijing.getUTCMonth() + 1).padStart(2, '0')
  var day = String(beijing.getUTCDate()).padStart(2, '0')
  return y + '-' + mo + '-' + day
}

/** 与发射日历同源：优先首页 calendarAllMissions，否则本地日历缓存（不请求云函数） */
function getCalendarMissionsForBriefing() {
  try {
    var pages = getCurrentPages()
    for (var i = pages.length - 1; i >= 0; i--) {
      var p = pages[i]
      if (isIndexPage(p) && p.data && Array.isArray(p.data.calendarAllMissions) && p.data.calendarAllMissions.length > 0) {
        return p.data.calendarAllMissions
      }
    }
  } catch (e) {}
  try {
    var raw = storageCache.readMemOrSync('calendar_missions_cache', null)
    if (raw && Array.isArray(raw.all) && raw.all.length > 0) {
      return raw.all
    }
  } catch (e2) {}
  return []
}

function isMissionCompletedCalendar(m) {
  if (!m) return false
  if (m._isUpcoming === false) return true
  if (m._detailType === 'completed') return true
  return false
}

/** 合并多路任务列表并按 id 去重（后者覆盖前者，方便 upcoming 覆盖过期缓存） */
function mergeMissionListsForBriefing(lists) {
  var map = {}
  for (var L = 0; L < lists.length; L++) {
    var arr = lists[L]
    if (!Array.isArray(arr)) continue
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i]
      if (!m) continue
      var id = String(m.id || m._id || '')
      var key = id || ('noid_' + L + '_' + i)
      map[key] = m
    }
  }
  var out = []
  for (var k in map) {
    if (Object.prototype.hasOwnProperty.call(map, k)) {
      out.push(map[k])
    }
  }
  return out
}

Component({
  properties: {
    mode: { type: String, value: 'popup' },
    icon: { type: String, value: '' }
  },

  data: {
    briefing: null,
    loading: true,
    showPopup: false,
    hasData: false,
    _briefingDisabled: false,
    newsCount: 0,
    tweetStats: [],
    tweetTotal: 0,
    tweetEventLoading: false,
    popupScrollHeightPx: 420,
    /* root-portal 弹窗脱离页面 DOM，继承不到页面根的 theme-light 变量，组件自行挂主题类 */
    themeClass: ''
  },

  lifetimes: {
    attached() {
      this._userClosedThisSession = false
      this._tweetStatsLoaded = false
      this._detached = false
      var self = this
      try { this.setData({ themeClass: themeUtil.getThemeClassSync() }) } catch (eTheme) {}
      setTimeout(function () {
        self._updatePopupScrollHeight()
      }, 0)
      // 详情页模式：进页面即视为已读（同时抑制首页当日重复自动弹窗）
      if (this.data.mode === 'page') {
        try {
          markBriefingRead()
          markBriefingPopupShown()
        } catch (e) {}
      }
      // 立即开始加载，不再延迟 1500ms
      self._loadBriefing()
    },
    detached() {
      // 终止 _startBriefingDataWait 的 300ms 轮询链，避免组件销毁后定时器空跑
      this._detached = true
    }
  },

  pageLifetimes: {
    resize() {
      this._updatePopupScrollHeight()
    },
    show() {
      // 用户可能在「我的太空」切了主题再回首页，回显时刷新弹窗主题类
      try { this.setData({ themeClass: themeUtil.getThemeClassSync() }) } catch (eTheme) {}
    }
  },

  methods: {
    /** 遮罩层阻挡背后滚动穿透 */
    preventMove() {},

    _updatePopupScrollHeight() {
      try {
        var sys = wx.getWindowInfo ? Object.assign({}, wx.getWindowInfo(), wx.getDeviceInfo()) : wx.getSystemInfoSync()
        var wh = sys.windowHeight || 667
        var safeTop = 0
        var safeBottom = 0
        if (sys.safeArea) {
          safeTop = Math.max(0, sys.safeArea.top)
          if (typeof sys.screenHeight === 'number') {
            safeBottom = Math.max(0, sys.screenHeight - sys.safeArea.bottom)
          }
        }
        // 弹窗总高度目标：矮屏更收紧（避免顶到刘海、下贴 Tab）
        var short = wh <= 700
        var totalRatio = short ? 0.68 : 0.74
        var maxPopupTotal = Math.floor(wh * totalRatio - safeTop * 0.25 - safeBottom * 0.25)
        // 标题栏 + 分享按钮 + 内边距（经验 px，与 wxss 大致对齐）
        var chromePx = 188
        var h = maxPopupTotal - chromePx
        // 滚动区硬顶：约为屏高的 42%～46%，内容不多时少留大块空白
        var scrollCap = Math.floor(wh * (short ? 0.42 : 0.46))
        if (h > scrollCap) h = scrollCap
        if (h < 200) h = Math.max(180, Math.floor(wh * 0.36))
        this.setData({ popupScrollHeightPx: h })
      } catch (e) {
        this.setData({ popupScrollHeightPx: 340 })
      }
    },

    /**
     * 自动弹窗判定；返回是否真正弹出。
     * ignorePrivacyGate=true 供隐私授权流程结束后的接力补弹使用
     * （首次进入因需授权被错峰跳过时，授权弹窗关闭后由首页重新触发）。
     */
    _maybeAutoShowPopup(ignorePrivacyGate) {
      var self = this
      if (self.data.mode !== 'popup') return false
      if (self.data._briefingDisabled) return false
      try {
        var prefs = loadPreferences()
        if (prefs.briefingEnabled === false) return false
      } catch (ePrefs) {}
      if (isBriefingPopupShownToday()) return false
      if (self._userClosedThisSession) return false
      if (self.data.showPopup) return false
      if (!ignorePrivacyGate) {
        // 错峰隐私授权：首次进入需授权时本次跳过自动弹窗，避免多弹窗叠加
        try {
          var appInst = getApp()
          if (appInst && appInst.globalData && appInst.globalData.needPrivacyAuthorization) return false
        } catch (ePrivacy) {}
      }
      // 数据已就绪时直接展示内容，不再回到 loading 态；弹出前刷新主题类（跟随系统时可能已变）
      var themeCls = ''
      try { themeCls = themeUtil.getThemeClassSync() } catch (eTheme) {}
      self.setData({ showPopup: true, loading: !self.data.hasData, themeClass: themeCls })
      if (!self._tweetStatsLoaded) {
        self._tweetStatsLoaded = true
        self.setData({ tweetEventLoading: true })
        self._loadTweetStats()
      }
      return true
    },

    _loadBriefing() {
      var self = this
      var prefs = loadPreferences()
      if (prefs.briefingEnabled === false) {
        self.setData({ loading: false, hasData: false, _briefingDisabled: true })
        return
      }

      // 优先弹窗：必须放在 hasData 早退之前，
      // 否则数据加载完成后的重入调用（如隐私授权后接力）永远弹不出来
      self._maybeAutoShowPopup(false)

      // 如果已经加载过数据，直接重新构建渲染（不重设 loading）
      if (self._briefingWaitStarted && self.data.hasData) {
        self._buildAndRender()
        return
      }

      // 详情页模式：事件更新板块常显，进页即拉取动态条数；
      // 本地无数据（分享冷启动）时不等 3s 轮询，立刻并行走 API 兜底
      if (self.data.mode === 'page') {
        if (!self._tweetStatsLoaded) {
          self._tweetStatsLoaded = true
          self.setData({ tweetEventLoading: true })
          self._loadTweetStats()
        }
        if (!self._isBriefingDataReady()) {
          self._maybeFetchForPageMode(null)
        }
      }

      // 如果已经在等待中，不重复启动（但标记需要刷新）
      if (self._briefingWaitStarted) {
        self._pendingRefresh = true
        return
      }

      // 全局开关
      var globalCheckDone = false
      isBriefingGloballyEnabled().then(function (globalOk) {
        globalCheckDone = true
        if (!globalOk && !self._briefingWaitStarted) {
          self.setData({ loading: false, hasData: false, showPopup: false, _briefingDisabled: true })
          return
        }
        self._startBriefingDataWait()
      }).catch(function () {
        globalCheckDone = true
        self._startBriefingDataWait()
      })

      // 如果全局开关 200ms 内没返回，先开始等数据
      setTimeout(function () {
        if (!globalCheckDone) {
          self._startBriefingDataWait()
        }
      }, 200)
    },

    /** 等首页「即将发射」或「发射日历」数据就绪后再构建简报 */
    _startBriefingDataWait: function () {
      if (this._briefingWaitStarted) return
      this._briefingWaitStarted = true
      var self = this
      var attempts = 0
      var maxAttempts = 10
      function tryBuild() {
        if (self._detached) return
        attempts++
        var indexLoaded = self._isBriefingDataReady()
        if (indexLoaded || attempts >= maxAttempts) {
          self._buildAndRender()
          // 如果轮询期间有外部刷新请求，用最新数据再构建一次
          if (self._pendingRefresh) {
            self._pendingRefresh = false
            setTimeout(function () { self._buildAndRender() }, 100)
          }
          return
        }
        // 如果外部回调已通知数据就绪，立即构建
        if (self._pendingRefresh) {
          self._pendingRefresh = false
          self._buildAndRender()
          return
        }
        setTimeout(tryBuild, 300)
      }
      tryBuild()
    },

    /** 即将发射列表或日历合并列表任一就绪即可构建简报（昨日依赖日历中的已完成） */
    _isBriefingDataReady: function () {
      try {
        var pages = getCurrentPages()
        for (var i = pages.length - 1; i >= 0; i--) {
          var p = pages[i]
          if (isIndexPage(p) && p.data) {
            var up = (p.data.upcomingMissions || []).length
            var cal = (p.data.calendarAllMissions || []).length
            return up > 0 || cal > 0
          }
        }
      } catch (e) {}
      try {
        var raw = storageCache.readMemOrSync('calendar_missions_cache', null)
        if (raw && Array.isArray(raw.all) && raw.all.length > 0) return true
      } catch (e2) {}
      return false
    },

    _buildAndRender: function () {
      var briefing = this._buildBriefingFromCache()
      this._renderBriefing(briefing)
    },

    _renderBriefing: function (briefing) {
      var stats = getAllStats()

      if (briefing.todayLaunches && briefing.todayLaunches.length > 0) {
        briefing.todayLaunches = briefing.todayLaunches.map(function (item) {
          item.rocketImage = resolveBriefingRocketImage(item, item.rocket)
          return item
        })
      }
      if (briefing.yesterdayResults && briefing.yesterdayResults.length > 0) {
        briefing.yesterdayResults = briefing.yesterdayResults.map(function (item) {
          item.rocketImage = resolveBriefingRocketImage(item, item.rocket)
          return item
        })
      }

      var nextData = {
        briefing: briefing,
        loading: false,
        hasData: true,
        newsCount: stats.newsReadCount || 0
      }
      this.setData(nextData)

      if (this.data.showPopup && typeof this._loadTweetStats === 'function' && !this._tweetStatsLoaded) {
        this.setData({ tweetEventLoading: true })
        this._tweetStatsLoaded = true
        this._loadTweetStats()
      }

      this._maybeFetchForPageMode(briefing)
    },

    /**
     * 详情页模式兜底：分享落地冷启动时首页不在页面栈、日历缓存也可能为空，
     * 本地拼不出"今日发射/昨日回顾"就直接从 API 拉一次任务列表再重建
     */
    _maybeFetchForPageMode(briefing) {
      if (this.data.mode !== 'page') return
      if (this._pageFetchStarted) return
      var hasContent = briefing && (
        (briefing.todayLaunches && briefing.todayLaunches.length > 0) ||
        (briefing.yesterdayResults && briefing.yesterdayResults.length > 0)
      )
      if (hasContent) return
      this._pageFetchStarted = true

      var self = this
      var api
      try {
        api = require('../../../../utils/api-launch-list.js')
      } catch (e) {
        return
      }
      self.setData({ loading: true })
      Promise.all([
        api.getUpcomingMissions(30, 0).catch(function () { return { list: [] } }),
        api.getCompletedMissions(30, 0).catch(function () { return { list: [] } })
      ]).then(function (results) {
        self._fallbackUpcoming = (results[0] && results[0].list) || []
        self._fallbackCompleted = ((results[1] && results[1].list) || []).map(function (m) {
          m._detailType = 'completed'
          return m
        })
        if (self._detached) return
        self._buildAndRender()
      }).catch(function () {
        if (self._detached) return
        self.setData({ loading: false })
      })
    },

    _buildBriefingFromCache() {
      // 计算北京时间今日 / 昨日 yyyy-MM-dd
      var now = new Date()
      var beijing = new Date(now.getTime() + 8 * 3600 * 1000)
      var todayStr = beijing.toISOString().slice(0, 10)
      var yest = new Date(beijing.getTime() - 86400000)
      var yestStr = yest.toISOString().slice(0, 10)

      // 从首页读 upcoming / completed；日历列表与发射日历同源（含已完成分页合并）
      var upcoming = []
      var completed = []
      var calendar = getCalendarMissionsForBriefing()
      try {
        var pages = getCurrentPages()
        for (var i = pages.length - 1; i >= 0; i--) {
          var p = pages[i]
          if (isIndexPage(p) && p.data) {
            if (Array.isArray(p.data.upcomingMissions)) upcoming = p.data.upcomingMissions
            if (Array.isArray(p.data.completedMissions) && p.data.completedMissions.length > 0) {
              completed = p.data.completedMissions.slice(0, 40)
            }
            break
          }
        }
      } catch (e) {}

      // 取任务北京日期：优先 net（与发射数据一致），避免 launchDate 与日历格子用的本地算法不一致
      function missionToBeijingDate(m) {
        var raw = m.launchTime || m.net || m.windowStart || ''
        if (raw) return utcToBeijingYmd(raw)
        var t = m.launchDate || m.localDate || ''
        if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t)) {
          return t.slice(0, 10)
        }
        return ''
      }

      // 详情页模式的 API 兜底数据（无首页/无缓存时由 _maybeFetchForPageMode 填充）
      if (Array.isArray(this._fallbackUpcoming) && this._fallbackUpcoming.length > 0 && upcoming.length === 0) {
        upcoming = this._fallbackUpcoming
      }
      if (Array.isArray(this._fallbackCompleted) && this._fallbackCompleted.length > 0 && completed.length === 0) {
        completed = this._fallbackCompleted
      }

      var pool = mergeMissionListsForBriefing([calendar, upcoming, completed])
      function mapMission(m) {
        var rawTitle = (m.name || m.missionName || m.title || '').trim()
        var rocketName = briefingRocketNameFromMission(m, rawTitle)
        var cat = m.statusCategory || ''
        var statusLabel = ''
        if (m.statusBadgeText) {
          statusLabel = m.statusBadgeText
        } else if (cat === 'success' || m.success === true) {
          statusLabel = '成功'
        } else if (cat === 'failure' || m.isFailure === true) {
          statusLabel = '失败'
        } else if (cat === 'partial' || m.isPartialFailure === true) {
          statusLabel = '部分失败'
        } else if (cat === 'delayed') {
          statusLabel = '推迟'
        } else if (cat === 'cancelled') {
          statusLabel = '取消'
        } else if (cat === 'pending') {
          statusLabel = '待定'
        } else {
          var abbrev = String(m.statusAbbrev || '').toLowerCase()
          var nameStr = String(typeof m.status === 'string' ? m.status : '')
          if (abbrev.indexOf('success') !== -1 || /成功|succeed/i.test(nameStr)) {
            statusLabel = '成功'
          } else if (abbrev.indexOf('fail') !== -1 || /^failure|fail/i.test(abbrev) || /失败/.test(nameStr)) {
            statusLabel = '失败'
          } else if (/partial/i.test(abbrev) || /部分/.test(nameStr)) {
            statusLabel = '部分失败'
          } else {
            statusLabel = nameStr ? nameStr.slice(0, 24) : '已完成'
          }
        }

        var briefingStatus = 'unknown'
        if (cat === 'success' || m.success === true) briefingStatus = 'success'
        else if (cat === 'failure' || m.isFailure === true) briefingStatus = 'failure'
        else if (cat === 'partial' || m.isPartialFailure === true) briefingStatus = 'partial'

        var statusCategory = 'pending'
        if (cat === 'success' || m.success === true) statusCategory = 'success'
        else if (cat === 'failure' || m.isFailure === true) statusCategory = 'failure'
        else if (cat === 'partial' || m.isPartialFailure === true) statusCategory = 'partial'
        else if (cat === 'delayed') statusCategory = 'delayed'
        else if (cat === 'cancelled') statusCategory = 'cancelled'
        else if (cat === 'pending') statusCategory = 'pending'
        else if (m.statusCategory && /^(success|failure|partial|delayed|cancelled|pending)$/.test(m.statusCategory)) {
          statusCategory = m.statusCategory
        } else {
          if (/已成功|^成功|succeed/i.test(statusLabel)) statusCategory = 'success'
          else if (/部分失败/.test(statusLabel)) statusCategory = 'partial'
          else if (/失败/.test(statusLabel)) statusCategory = 'failure'
          else if (/推迟/.test(statusLabel)) statusCategory = 'delayed'
          else if (/取消/.test(statusLabel)) statusCategory = 'cancelled'
        }

        var detailType = 'upcoming'
        if (m._detailType === 'completed') detailType = 'completed'
        else if (m._isUpcoming === false) detailType = 'completed'
        else if (isMissionCompletedCalendar(m)) detailType = 'completed'

        return {
          id: m.id || m._id || '',
          name: briefingMissionDisplayName(rawTitle) || rawTitle,
          rocket: rocketName,
          rocketImage: resolveBriefingRocketImage(m, rocketName),
          status: briefingStatus,
          statusLabel: statusLabel,
          statusCategory: statusCategory,
          time: m.launchTime || m.net || '',
          detailType: detailType
        }
      }

      var todayLaunches = []
      var yesterdayResults = []

      if (pool.length > 0) {
        todayLaunches = pool.filter(function (m) { return missionToBeijingDate(m) === todayStr }).map(mapMission)
        yesterdayResults = pool.filter(function (m) {
          return missionToBeijingDate(m) === yestStr && isMissionCompletedCalendar(m)
        }).map(mapMission)
        if (yesterdayResults.length === 0) {
          yesterdayResults = pool.filter(function (m) { return missionToBeijingDate(m) === yestStr }).map(mapMission)
        }
      }

      if (todayLaunches.length === 0) {
        todayLaunches = upcoming.filter(function (m) { return missionToBeijingDate(m) === todayStr }).map(mapMission)
      }
      if (yesterdayResults.length === 0) {
        yesterdayResults = completed.filter(function (m) { return missionToBeijingDate(m) === yestStr }).map(mapMission)
        if (yesterdayResults.length === 0) {
          yesterdayResults = upcoming.filter(function (m) { return missionToBeijingDate(m) === yestStr }).map(mapMission)
        }
      }

      return {
        _id: todayStr,
        date: todayStr,
        todayLaunches: todayLaunches,
        yesterdayResults: yesterdayResults,
        spaceFact: null,
        astroEvent: null
      }
    },

    onClosePopup() {
      try {
        if (typeof wx.vibrateShort === 'function') {
          wx.vibrateShort({ type: 'medium' })
        }
      } catch (e) {}
      markPopupShown()
      markBriefingRead()
      this._userClosedThisSession = true
      this.setData({ showPopup: false })
      this.triggerEvent('closed')
    },

    /** 内联卡片（profile 页）点击：跳转简报详情页 */
    onShowInline() {
      navigateTo(ROUTES.BRIEFING)
    },

    onShareBriefing() {
      this.triggerEvent('sharebriefing', { briefing: this.data.briefing })
    },

    _loadTweetStats() {
      var self = this
      if (!wx.cloud) {
        self.setData({ tweetEventLoading: false, tweetStats: [], tweetTotal: 0 })
        return
      }
      // 当日缓存先上屏（秒开），云端结果回来后静默刷新
      var cacheKey = '_briefing_tweet_stats_cache'
      var todayYmd = utcToBeijingYmd(new Date().toISOString())
      try {
        var cached = storageCache.readMemOrSync(cacheKey, null)
        if (cached && cached.date === todayYmd && Array.isArray(cached.stats)) {
          self.setData({
            tweetStats: cached.stats,
            tweetTotal: cached.total || 0,
            tweetEventLoading: false
          })
        }
      } catch (e0) {}
      try {
        wx.cloud.callFunction({
          name: 'userDataGateway',
          data: { action: 'getTodayTweetStats' }
        }).then(function (res) {
          var result = res.result || {}
          var total = 0
          var stats = []
          if (result.success) {
            total = typeof result.total === 'number' ? result.total : 0
            if (result.tweetStats && result.tweetStats.length > 0) {
            stats = result.tweetStats.map(function (item) {
              return {
                screenName: item.screenName,
                label: item.label,
                avatarUrl: item.avatarUrl || resolveTweetAccountAvatarUrl(item.screenName) || '',
                todayCount: item.todayCount
              }
            })
            }
          }
          self.setData({ tweetStats: stats, tweetTotal: total, tweetEventLoading: false })
          try {
            storageCache.persistAsync(cacheKey, { date: todayYmd, stats: stats, total: total })
          } catch (e1) {}
        }).catch(function () {
          self.setData({ tweetEventLoading: false })
        })
      } catch (e) {
        self.setData({ tweetEventLoading: false })
      }
    },

    async onTweetAccountTap(e) {
      var allowed = await gateCheck('starship_progress_event_source', '星舰事件更新 · 按账号查看')
      if (!allowed) return
      var ds = e.currentTarget.dataset || {}
      var list = this.data.tweetStats || []
      var item = list[ds.index]
      if (!item && ds.index !== undefined && ds.index !== '') {
        var n = parseInt(ds.index, 10)
        if (!isNaN(n)) item = list[n]
      }
      var screenName = (item && item.screenName) || ds.source || ''
      if (!screenName) return
      var params = { source: String(screenName) }
      if (item && item.label) params.label = String(item.label)
      var br = this.data.briefing
      if (br && br.date) params.date = String(br.date)
      navigateTo(ROUTES.EVENT_DETAIL, params)
    },

    /** 事件更新区标题 / X 图标 / 空态：进度 tab（展示全部账号动态） */
    onTweetBriefingHeaderTap() {
      try {
        // 必须经 storageCache 写：这两个 key 启动时已 warm 进内存，
        // progress 页用 readMemOrSync 读取，直写 wx.setStorageSync 会读到过期内存值
        storageCache.persistSync(BRIEFING_PROGRESS_FILTER_KEY, '')
        storageCache.persistSync(BRIEFING_PROGRESS_FILTER_CLEAR_KEY, '1')
      } catch (e) {}
      wx.switchTab({ url: ROUTES.PROGRESS })
    },

    /** 今日发射 / 昨日回顾行点击 → 任务详情（与首页、profile 竞猜一致） */
    onBriefingMissionTap(e) {
      var dataset = e.currentTarget.dataset || {}
      var id = dataset.id
      if (id === undefined || id === null || String(id) === '') return
      var type = dataset.type === 'completed' ? 'completed' : 'upcoming'
      wx.navigateTo({
        url: ROUTES.MISSION_DETAIL + '?id=' + encodeURIComponent(String(id)) + '&type=' + type
      })
    },

    refresh() {
      this._userClosedThisSession = false
      this._tweetStatsLoaded = false
      this._briefingWaitStarted = false
      this.setData({ loading: true })
      this._loadBriefing()
    }
  }
})
