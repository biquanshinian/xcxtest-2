// app.js
// 分包详情页共用 Behavior；主包入口引用以满足「主包 JS 文件」静态扫描（分包 require 主包模块不计入主包使用）
require('./utils/page-base.js')
const { getSystemInfo } = require('./utils/system.js')
const { getUiShellLayout } = require('./utils/layout.js')
const { cloudEnv } = require('./utils/config.js')
const storageCache = require('./utils/storage-sync-cache.js')
// 注意：api-cache-clean / demo-engine / membership / user-growth / popup-ad 等
// 仅在延迟回调中使用的模块改为回调内 require，缩短 onLaunch 同步执行段

const PROGRESS_DOT_CACHE_KEY = '_progress_dot_cache'
const PROGRESS_DOT_CACHE_TTL = 5 * 60 * 1000

/** 后台 news_articles 手动更新红点（与 pages/news 顶部「航天事件」、Tab 事件图标共用数据源） */
const NEWS_MANUAL_DOT_CACHE_KEY = '_news_manual_dot_cache'
const NEWS_MANUAL_DOT_CACHE_TTL = 5 * 60 * 1000
const NEWS_TAB_ACK_MANUAL_UPDATED_AT_KEY = '_news_tab_ack_manual_updated_at'
const ARTICLES_NAV_ACK_MANUAL_UPDATED_AT_KEY = '_articles_nav_ack_manual_updated_at'

/** 与 custom-tab-bar 共用：添加到桌面横条 snooze（启动时同步读入 globalData，避免 WebView 每页重建 TabBar 时异步闪动） */
const TABBAR_DESKTOP_STRIP_SNOOZE_KEY = 'add_desktop_strip_snooze_until'

// ── 内存缓存：避免 checkProgressDot 被多次调用时重复读 storage ──
let _memProgressDotCache = null   // { publishedAt, ts }
let _memNewsManualDotCache = null // { updatedAtMax: number, ts }

// ── 异步读取 in-flight 去重：启动时每个页面的 TabBar 都会触发红点检查，
//    并发调用共享同一次 getStorage / 云查询，避免同一 key 被重复读 ──
const _inflightWaiters = Object.create(null)
function _dedupAsync(name, starter, callback) {
  if (_inflightWaiters[name]) {
    _inflightWaiters[name].push(callback)
    return
  }
  _inflightWaiters[name] = [callback]
  starter((value) => {
    const waiters = _inflightWaiters[name] || []
    delete _inflightWaiters[name]
    for (let i = 0; i < waiters.length; i++) {
      try { waiters[i](value) } catch (e) {}
    }
  })
}

App({
  onLaunch(options) {
    this.refreshUiShellLayout()
    // 邀请得月卡：截获分享链接里的 inviter，延迟上报核销（不阻塞启动）
    try { require('./utils/invite.js').captureInviteFromOptions(options) } catch (e) {}
    // 主题预热：注册系统主题监听（跟随系统模式用），浅色时同步下拉刷新背景区
    try {
      const themeUtil = require('./utils/theme.js')
      themeUtil.initSystemThemeListener()
      if (themeUtil.isLightSync()) themeUtil.syncWindowBackground()
    } catch (e) {}
    // 异步批量预热热点 key：10 次 getStorageSync 串行同步读会阻塞首帧，
    // 改为 wx.getStorage 并行预热；预热完成前个别消费方自行做单 key 同步读兜底
    try { storageCache.warmManyAsync() } catch (e) {}
    this.initTabBarUiCache()
    this.initPrivacyAuthorization()
    this.initAgentHandoff()

    // 调试入口：在微信开发者工具控制台直接调
    //   getApp().resetPopupAd()           // 清掉本地弹窗广告所有缓存与会话标记
    //   getApp().debugPopupAdConfig()     // 打印当前弹窗广告配置
    this.resetPopupAd = function () {
      try { require('./utils/popup-ad.js').resetPopupAdLocalState() } catch (e) { console.warn(e) }
    }
    this.debugPopupAdConfig = async function () {
      try {
        const cfg = await require('./utils/popup-ad.js').fetchPopupAdConfig()
        console.log('[popup-ad] current config:', cfg)
        return cfg
      } catch (e) { console.warn(e); return null }
    }

    if (!wx.cloud) {
      wx.showModal({
        title: '基础库版本过低',
        content: '请使用 2.2.3 或以上的基础库以使用云能力',
        showCancel: false
      })
    } else {
      try {
        wx.cloud.init({
          env: cloudEnv,
          traceUser: true
        })

        // 已移除冷启动 /ping 预热：当前日活下 adminGateway 实例常驻为热，
        // 每次冷启动多打一次纯预热调用只增加计费调用量，收益趋近于零

        setTimeout(() => {
          try { require('./utils/user-growth.js').recordMilestone('FIRST_OPEN', null, true) } catch (e) {}
        }, 0)

        setTimeout(() => {
          try { require('./utils/api-cache-clean.js').cleanExpiredApiCache() } catch (e) {}
          try { require('./utils/icon-cache.js').preloadStaticMediaUrls() } catch (e) {}
          require('./utils/membership.js').getMembershipState().then(state => {
            this.globalData.membershipState = state
          }).catch(() => {})
          try { require('./utils/feature-flags.js').fetchMainConfig() } catch (e) {}
          const demoEngine = require('./utils/demo-engine.js')
          demoEngine.initDemoEngine().then(() => {
            this.globalData.demoMode = demoEngine.isDemoActive()
            this.globalData.isLiveAccount = demoEngine.isLiveAccount()
          }).catch(() => {})
        }, 2000)
      } catch (error) {
        wx.showModal({
          title: '云开发初始化失败',
          content: '请检查云开发环境配置：' + (error.message || '未知错误'),
          showCancel: false
        })
      }
    }
  },

  /**
   * 小程序 AI 开发模式：接收原子接口 handoff 数据（按 pageId 暂存，目标页 onLoad 领取）
   * 低版本基础库无 wx.onAgentHandoff，静默跳过
   */
  initAgentHandoff() {
    if (typeof wx.onAgentHandoff !== 'function') return
    try {
      wx.onAgentHandoff(({ pageId, path, query, payload }) => {
        this.globalData.agentHandoffs = this.globalData.agentHandoffs || {}
        this.globalData.agentHandoffs[pageId] = { path, query, payload }
      })
    } catch (e) {}
  },

  /** 目标页领取 handoff 数据（一次性），无则返回 null */
  takeAgentHandoff(pageId) {
    const handoffs = this.globalData.agentHandoffs
    if (!handoffs || pageId == null || !handoffs[pageId]) return null
    const data = handoffs[pageId]
    delete handoffs[pageId]
    return data
  },

  initPrivacyAuthorization() {
    if (this._privacyInitialized) return

    this._privacyInitialized = true
    this._privacyAuthorizeInFlight = null
    this.globalData.privacyResolvers = []
    this.globalData.privacyEventInfo = null
    this.globalData.privacyContractName = ''
    this.globalData.needPrivacyAuthorization = false
    // 隐私门控：授权状态确认前全局禁触（privacy-modal 组件渲染透明遮罩 + TabBar 拦截切页），
    // 已授权用户 getPrivacySetting 毫秒级回来即解锁，无感知
    this._privacyGateListeners = []
    this._setPrivacyGate(true)
    // 兜底：15s 内未确认（如入口页没挂 privacy-modal 弹不出授权窗）强制解锁，避免整个 UI 卡死；
    // 授权弹窗已弹出时其自带全屏遮罩，门控提前解除不影响拦截
    this._privacyGateTimer = setTimeout(() => { this._setPrivacyGate(false) }, 15000)

    if (typeof wx.onNeedPrivacyAuthorization === 'function') {
      wx.onNeedPrivacyAuthorization((resolve, eventInfo) => {
        this.globalData.privacyEventInfo = eventInfo || null
        this.globalData.privacyResolvers.push(resolve)
        this.showPrivacyAuthorizationModal(eventInfo || null)

        const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
        const currentPage = pages.length ? pages[pages.length - 1] : null
        if (currentPage && typeof currentPage.onNeedPrivacyAuthorization === 'function') {
          try {
            currentPage.onNeedPrivacyAuthorization(eventInfo || null)
          } catch (error) {}
        }
      })
    }

    this.updatePrivacySettingCache()
  },

  /** 隐私门控开/关：状态变化时通知已注册的监听者（privacy-modal 组件等） */
  _setPrivacyGate(active) {
    const next = !!active
    if (!next && this._privacyGateTimer) {
      clearTimeout(this._privacyGateTimer)
      this._privacyGateTimer = null
    }
    if (this.globalData.privacyGateActive === next) return
    this.globalData.privacyGateActive = next
    this._notifyPrivacyGateListeners()
  },

  /**
   * 开屏动画展示中标记：开屏层本身已全屏遮挡（含 TabBar），此时隐私禁触遮罩
   * 必须让位——遮罩挂在 root-portal 根层级，会压住整个开屏层（层叠上下文隔离，
   * 开屏内部子元素 z-index 再大也无效），导致「跳过」按钮点击无反应。
   * TabBar 切页守卫直接读 privacyGateActive，不受此标记影响，门控依旧生效。
   */
  setSplashActive(active) {
    const next = !!active
    if (this.globalData.splashActive === next) return
    this.globalData.splashActive = next
    this._notifyPrivacyGateListeners()
  },

  /** 通知监听者「当前是否需要渲染禁触遮罩」= 门控激活 且 开屏未在展示 */
  _notifyPrivacyGateListeners() {
    const blocking = !!this.globalData.privacyGateActive && !this.globalData.splashActive
    const listeners = (this._privacyGateListeners || []).slice()
    listeners.forEach((fn) => {
      try { fn(blocking) } catch (error) {}
    })
  },

  onPrivacyGateChange(fn) {
    if (typeof fn !== 'function') return
    if (!this._privacyGateListeners) this._privacyGateListeners = []
    this._privacyGateListeners.push(fn)
  },

  offPrivacyGateChange(fn) {
    if (!this._privacyGateListeners) return
    this._privacyGateListeners = this._privacyGateListeners.filter((item) => item !== fn)
  },

  updatePrivacySettingCache() {
    return new Promise((resolve) => {
      if (typeof wx.getPrivacySetting !== 'function') {
        this.globalData.needPrivacyAuthorization = false
        this._setPrivacyGate(false)
        resolve({ needAuthorization: false, unsupported: true })
        return
      }

      wx.getPrivacySetting({
        success: (res) => {
          this.globalData.needPrivacyAuthorization = !!res.needAuthorization
          this.globalData.privacyContractName = res.privacyContractName || ''
          // 已授权 → 立即解除门控；待授权 → 保持禁触直到弹窗同意/拒绝
          if (!res.needAuthorization) this._setPrivacyGate(false)
          resolve(res)
        },
        fail: (err) => {
          // 查询失败无法确认状态，解锁避免误伤（隐私 API 触发时微信会再走 onNeedPrivacyAuthorization）
          this._setPrivacyGate(false)
          resolve({ errMsg: err && err.errMsg ? err.errMsg : 'getPrivacySetting failed' })
        }
      })
    })
  },

  ensurePrivacyAuthorized() {
    if (this._privacyAuthorizeInFlight) {
      return this._privacyAuthorizeInFlight
    }

    this._privacyAuthorizeInFlight = new Promise((resolve) => {
      let finished = false
      const finish = (result) => {
        if (finished) return
        finished = true
        if (this._privacyAuthorizeTimer) {
          clearTimeout(this._privacyAuthorizeTimer)
          this._privacyAuthorizeTimer = null
        }
        this._privacyAuthorizeFinish = null
        this._privacyAuthorizeInFlight = null
        // 授权流程有了结果（同意/拒绝/超时/失败）→ 解除全局禁触
        this._setPrivacyGate(false)
        resolve(result)
      }

      // 暴露给 agree/disagree 回调主动 finish，避免某些场景下 wx.requirePrivacyAuthorize 不回调导致 hang
      this._privacyAuthorizeFinish = finish

      // 兜底超时：30s 内未拿到任何回调就认定失败，避免任何意外情况下整个 UI 永远卡住
      this._privacyAuthorizeTimer = setTimeout(() => {
        finish({ ok: false, timeout: true })
      }, 30000)

      const clearPendingResolvers = () => {
        this.globalData.privacyResolvers = []
      }

      const requestAuthorize = () => {
        if (typeof wx.requirePrivacyAuthorize !== 'function') {
          this.globalData.needPrivacyAuthorization = false
          clearPendingResolvers()
          finish({ ok: true, unsupported: true })
          return
        }

        wx.requirePrivacyAuthorize({
          success: () => {
            this.globalData.needPrivacyAuthorization = false
            clearPendingResolvers()
            finish({ ok: true })
          },
          fail: (err) => {
            clearPendingResolvers()
            finish({ ok: false, err })
          }
        })
      }

      if (typeof wx.getPrivacySetting !== 'function') {
        finish({ ok: true, unsupported: true })
        return
      }

      wx.getPrivacySetting({
        success: (res) => {
          this.globalData.needPrivacyAuthorization = !!res.needAuthorization
          this.globalData.privacyContractName = res.privacyContractName || ''
          if (!res.needAuthorization) {
            clearPendingResolvers()
            finish({ ok: true, alreadyAuthorized: true })
            return
          }
          const shown = this.showPrivacyAuthorizationModal()
          if (!shown) {
            // 第一次没弹出来：80ms 后重试一次
            setTimeout(() => {
              const retried = this.showPrivacyAuthorizationModal()
              if (!retried) {
                // 当前页面没有挂载 <privacy-modal>，弹不出来 → 立即结束以免 hang
                clearPendingResolvers()
                finish({ ok: false, modalUnavailable: true })
              }
            }, 80)
          }
          requestAuthorize()
        },
        fail: () => {
          requestAuthorize()
        }
      })
    })

    return this._privacyAuthorizeInFlight
  },

  showPrivacyAuthorizationModal(eventInfo) {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    const currentPage = pages.length ? pages[pages.length - 1] : null
    if (!currentPage || typeof currentPage.selectComponent !== 'function') return false

    const modal = currentPage.selectComponent('#globalPrivacyModal')
    if (!modal || typeof modal.show !== 'function') return false

    modal.show({
      contractName: this.globalData.privacyContractName || '《小程序用户隐私保护指引》',
      referrer: eventInfo && eventInfo.referrer ? eventInfo.referrer : ''
    })
    return true
  },

  hidePrivacyAuthorizationModal() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    const currentPage = pages.length ? pages[pages.length - 1] : null
    if (!currentPage || typeof currentPage.selectComponent !== 'function') return false

    const modal = currentPage.selectComponent('#globalPrivacyModal')
    if (!modal || typeof modal.hide !== 'function') return false

    modal.hide()
    return true
  },

  agreePrivacyAuthorization(buttonId) {
    const queue = (this.globalData.privacyResolvers || []).splice(0)
    queue.forEach((resolve) => {
      try {
        resolve({ event: 'agree', buttonId: buttonId || 'agree-btn' })
      } catch (error) {}
    })
    this.globalData.needPrivacyAuthorization = false
    this.hidePrivacyAuthorizationModal()
    // 兜底：主动结束 ensurePrivacyAuthorized 的 in-flight promise，
    // 避免某些场景下 wx.requirePrivacyAuthorize 的 success 回调没触发导致 await hang
    if (typeof this._privacyAuthorizeFinish === 'function') {
      this._privacyAuthorizeFinish({ ok: true, viaModal: true })
    }
    this._setPrivacyGate(false)
  },

  disagreePrivacyAuthorization() {
    const queue = (this.globalData.privacyResolvers || []).splice(0)
    queue.forEach((resolve) => {
      try {
        resolve({ event: 'disagree' })
      } catch (error) {}
    })
    this.hidePrivacyAuthorizationModal()
    // 兜底：主动结束 ensurePrivacyAuthorized 的 in-flight promise（拒绝时 wx.requirePrivacyAuthorize 不会回 fail）
    if (typeof this._privacyAuthorizeFinish === 'function') {
      this._privacyAuthorizeFinish({ ok: false, viaModal: true, declined: true })
    }
    this._setPrivacyGate(false)
  },

  openPrivacyContract() {
    return new Promise((resolve) => {
      if (typeof wx.openPrivacyContract !== 'function') {
        resolve({ ok: false, unsupported: true })
        return
      }

      wx.openPrivacyContract({
        success: () => resolve({ ok: true }),
        fail: (err) => resolve({ ok: false, err })
      })
    })
  },

  refreshUiShellLayout() {
    try {
      const layout = getUiShellLayout(getSystemInfo())
      this.globalData.uiShellLayout = layout
    } catch (error) {
      this.globalData.uiShellLayout = getUiShellLayout({})
    }
  },

  getUiShellLayout() {
    if (!this.globalData.uiShellLayout) {
      this.refreshUiShellLayout()
    }
    return this.globalData.uiShellLayout
  },

  /** WebView 下 custom-tab-bar 每 Tab 重建：用内存缓存首帧桌面横条显隐，避免 wx.getStorage 异步跳变 */
  readAddDesktopStripVisibleSync() {
    try {
      const snoozeUntil = Number(storageCache.readMemOrSync(TABBAR_DESKTOP_STRIP_SNOOZE_KEY, 0)) || 0
      return Date.now() >= snoozeUntil
    } catch (_) {
      return true
    }
  },

  /** 关闭「添加到桌面」横条：写 storage 并同步 app/tabBar 内存态 */
  snoozeAddDesktopStrip(ms) {
    const until = Date.now() + (Number(ms) || 0)
    try {
      storageCache.persistSync(TABBAR_DESKTOP_STRIP_SNOOZE_KEY, until)
    } catch (_) {}
    this.patchTabBarUiCache({ showAddDesktopStrip: false })
  },

  initTabBarUiCache() {
    const layout = this.getUiShellLayout()
    this.globalData.tabBarUiCache = {
      selected: 0,
      currentPath: '/pages/index/index',
      hidden: false,
      showProgressDot: false,
      showProfileDot: false,
      showNewsDot: false,
      showAddDesktopStrip: this.readAddDesktopStripVisibleSync(),
      navPlaceholderHeight: (layout && layout.navPlaceholderHeight) || 0
    }
  },

  patchTabBarUiCache(patch) {
    if (!patch || typeof patch !== 'object') return
    if (!this.globalData.tabBarUiCache) this.initTabBarUiCache()
    Object.assign(this.globalData.tabBarUiCache, patch)
  },

  getTabBarUiCache() {
    if (!this.globalData.tabBarUiCache) this.initTabBarUiCache()
    return this.globalData.tabBarUiCache
  },

  onShow(options) {
    this.refreshUiShellLayout()
    // 激励视频等全屏层关闭后，自定义导航下偶发胶囊不恢复；回前台时读一次胶囊矩形做轻量唤醒
    try {
      wx.getMenuButtonBoundingClientRect()
    } catch (e) {}
    // 热启动从分享卡片进入时 onLaunch 不触发，这里兜底截获 inviter
    try { require('./utils/invite.js').captureInviteFromOptions(options) } catch (e) {}
    setTimeout(() => {
      try {
        const { trackDailyOpen } = require('./utils/behavior-stats.js')
        trackDailyOpen()
        require('./utils/subscribe.js').warmSubscribedStoreAsync()
        require('./utils/aiService.js').warmAIChatEnabledAsync()
        wx.getMenuButtonBoundingClientRect()
      } catch (e) {}
    }, 0)
  },

  checkProgressDot(tabBar) {
    if (!tabBar) return

    const applyDotState = (latestPublishedAt) => {
      if (!latestPublishedAt) return
      const setDot = (show) => {
        tabBar.setData({ showProgressDot: show })
        this.patchTabBarUiCache({ showProgressDot: show })
      }
      // 走 storageCache 内存层：page-storage-boot 启动已预热，
      // progress 页也经 storageCache 写入，读写同源、不会读到过期值
      const lastViewed = Number(storageCache.readMemOrSync('_progress_last_viewed', 0)) || 0
      setDot(latestPublishedAt > lastViewed)
    }

    // 先查内存缓存
    if (_memProgressDotCache && _memProgressDotCache.ts &&
        (Date.now() - _memProgressDotCache.ts < PROGRESS_DOT_CACHE_TTL)) {
      applyDotState(_memProgressDotCache.publishedAt)
      return
    }

    // 再查 storage（异步、并发去重）
    _dedupAsync('progressDotLatest', (resolve) => {
      wx.getStorage({
        key: PROGRESS_DOT_CACHE_KEY,
        success: (res) => {
          const cached = res.data
          if (cached && cached.ts && (Date.now() - cached.ts < PROGRESS_DOT_CACHE_TTL)) {
            _memProgressDotCache = cached
            resolve(cached.publishedAt)
            return
          }
          this._fetchProgressDotFromCloud(resolve)
        },
        fail: () => {
          this._fetchProgressDotFromCloud(resolve)
        }
      })
    }, applyDotState)
  },

  /** 云端查最新 publishedAt；无论成功失败都会回调（失败回调 0） */
  _fetchProgressDotFromCloud(resolve) {
    const db = wx.cloud.database()
    db.collection('starship_event_updates')
      .where({ status: 'published' })
      .orderBy('publishedAt', 'desc')
      .limit(1)
      .field({ publishedAt: true })
      .get()
      .then(res => {
        const latest = res.data && res.data[0]
        if (!latest || !latest.publishedAt) {
          resolve(0)
          return
        }
        const cacheObj = { publishedAt: latest.publishedAt, ts: Date.now() }
        _memProgressDotCache = cacheObj
        try { wx.setStorage({ key: PROGRESS_DOT_CACHE_KEY, data: cacheObj, fail: () => {} }) } catch (e) {}
        resolve(latest.publishedAt)
      })
      .catch(() => resolve(0))
  },

  /**
   * news_articles.updatedAt 统一成毫秒时间戳
   */
  _normalizeNewsManualUpdatedTs(val) {
    if (val == null || val === '') return 0
    if (typeof val === 'number' && !isNaN(val)) {
      return val < 1e11 ? Math.round(val * 1000) : Math.round(val)
    }
    if (typeof val === 'object' && typeof val.seconds === 'number') {
      return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1e6)
    }
    if (typeof val === 'object' && typeof val._seconds === 'number') {
      return val._seconds * 1000 + Math.floor((val._nanoseconds || 0) / 1e6)
    }
    if (typeof val === 'object' && typeof val.getTime === 'function') {
      const t = val.getTime()
      return isNaN(t) ? 0 : t
    }
    const d = new Date(val)
    const t = d.getTime()
    return isNaN(t) ? 0 : t
  },

  /** 从手写稿文档或云函数裁剪字段上取「最新更新时间」毫秒值 */
  _maxManualUpdatedTsFromDocs(list) {
    let maxTs = 0
    const arr = list || []
    for (let i = 0; i < arr.length; i++) {
      const doc = arr[i]
      if (!doc) continue
      let ts = this._normalizeNewsManualUpdatedTs(doc.updatedAt)
      if (!ts) ts = this._normalizeNewsManualUpdatedTs(doc.publishedAt || doc.date)
      if (ts > maxTs) maxTs = ts
    }
    return maxTs
  },

  /**
   * 拉取 news_articles 已发布手写稿的「全局最新更新时间」
   * 优先走 userDataGateway（与列表一致，绕开客户端库读权限）；失败再直连 DB，并带索引降级。
   */
  _fetchNewsManualLatestUpdatedAtFromCloud(done) {
    const finish = (ts) => done && done(Number(ts) || 0)

    const tryDbSimpleLimit = () => {
      if (!wx.cloud || !wx.cloud.database) {
        finish(0)
        return
      }
      const db = wx.cloud.database()
      const cap = 30
      db.collection('news_articles')
        .where({ published: true })
        .limit(cap)
        .get()
        .then((res) => {
          const docs = (res && res.data) || []
          finish(this._maxManualUpdatedTsFromDocs(docs))
        })
        .catch(() => finish(0))
    }

    const tryDbOrderByUpdated = () => {
      if (!wx.cloud || !wx.cloud.database) {
        tryDbSimpleLimit()
        return
      }
      const db = wx.cloud.database()
      db.collection('news_articles')
        .where({ published: true })
        .orderBy('updatedAt', 'desc')
        .limit(1)
        .field({ updatedAt: true, publishedAt: true, date: true })
        .get()
        .then((res) => {
          const doc = res.data && res.data[0]
          if (!doc) {
            tryDbSimpleLimit()
            return
          }
          let ts = this._normalizeNewsManualUpdatedTs(doc.updatedAt)
          if (!ts) ts = this._normalizeNewsManualUpdatedTs(doc.publishedAt || doc.date)
          finish(ts || 0)
        })
        .catch(() => tryDbSimpleLimit())
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      tryDbOrderByUpdated()
      return
    }

    wx.cloud
      .callFunction({
        name: 'userDataGateway',
        data: { action: 'getNewsManualForApp' },
        timeout: 12000
      })
      .then((res) => {
        const r = (res && res.result) || {}
        if (r.success !== true) {
          tryDbOrderByUpdated()
          return
        }
        if (!r.enabled) {
          finish(0)
          return
        }
        const items = Array.isArray(r.items) ? r.items : []
        const maxTs = this._maxManualUpdatedTsFromDocs(items)
        if (maxTs > 0) {
          finish(maxTs)
          return
        }
        if (items.length === 0) {
          finish(0)
          return
        }
        tryDbOrderByUpdated()
      })
      .catch(() => tryDbOrderByUpdated())
  },

  /** 拉取「后台手动文章」最新更新时间（带缓存 + 并发去重，供 Tab 红点与新闻页导航红点共用） */
  fetchNewsManualLatestUpdatedMs(done) {
    const finish = (ts) => {
      const n = Number(ts) || 0
      done && done(n)
    }

    if (_memNewsManualDotCache && _memNewsManualDotCache.ts &&
        (Date.now() - _memNewsManualDotCache.ts < NEWS_MANUAL_DOT_CACHE_TTL)) {
      finish(_memNewsManualDotCache.updatedAtMax)
      return
    }

    // 启动时多个 TabBar 实例会并发调用：共享同一次 getStorage 与云查询
    _dedupAsync('newsManualLatest', (resolve) => {
      const fromCloud = () => {
        this._fetchNewsManualLatestUpdatedAtFromCloud((ts) => {
          const cacheObj = { updatedAtMax: ts || 0, ts: Date.now() }
          _memNewsManualDotCache = cacheObj
          try { wx.setStorage({ key: NEWS_MANUAL_DOT_CACHE_KEY, data: cacheObj, fail: () => {} }) } catch (e) {}
          resolve(ts)
        })
      }
      wx.getStorage({
        key: NEWS_MANUAL_DOT_CACHE_KEY,
        success: (res) => {
          const cached = res.data
          if (cached && cached.ts && (Date.now() - cached.ts < NEWS_MANUAL_DOT_CACHE_TTL)) {
            _memNewsManualDotCache = cached
            resolve(cached.updatedAtMax)
            return
          }
          fromCloud()
        },
        fail: fromCloud
      })
    }, finish)
  },

  /** 读「上次进入新闻 Tab」ack：内存优先，未加载时并发去重地异步预热一次 */
  _readNewsTabAck(callback) {
    if (storageCache.isLoaded(NEWS_TAB_ACK_MANUAL_UPDATED_AT_KEY)) {
      callback(Number(storageCache.getMem(NEWS_TAB_ACK_MANUAL_UPDATED_AT_KEY)) || 0)
      return
    }
    _dedupAsync('newsTabAck', (resolve) => {
      storageCache.warmAsync(NEWS_TAB_ACK_MANUAL_UPDATED_AT_KEY, 0).then((val) => {
        resolve(Number(val) || 0)
      })
    }, callback)
  },

  /** TabBar「事件」图标红点：存在比「上次进入新闻 Tab」更新的后台文章 updatedAt */
  checkNewsDot(tabBar) {
    if (!tabBar) return
    const setNewsDot = (show) => {
      tabBar.setData({ showNewsDot: show })
      this.patchTabBarUiCache({ showNewsDot: show })
    }

    const applyDotState = (latestTs) => {
      const latest = Number(latestTs) || 0
      if (!latest) {
        setNewsDot(false)
        return
      }
      this._readNewsTabAck((ack) => {
        setNewsDot(latest > ack)
      })
    }

    this.fetchNewsManualLatestUpdatedMs(applyDotState)
  },

  /** 进入新闻 Tab 后调用：把 Tab 红点对应 ack 拉到当前云端最新 */
  acknowledgeNewsTabManualDot(done) {
    _memNewsManualDotCache = null
    const proceed = () => {
      this.fetchNewsManualLatestUpdatedMs((latest) => {
        if (latest > 0) {
          try { storageCache.persistAsync(NEWS_TAB_ACK_MANUAL_UPDATED_AT_KEY, latest) } catch (e) {}
        }
        done && done()
      })
    }
    // 异步删除完成后再拉最新值，避免 fetch 内部 getStorage 读到未删除的旧缓存
    try {
      wx.removeStorage({ key: NEWS_MANUAL_DOT_CACHE_KEY, complete: proceed })
    } catch (e) { proceed() }
  },

  /** 用户点了顶部「航天事件」后调用：清除该按钮红点 ack */
  acknowledgeArticlesNavManualDot(done) {
    _memNewsManualDotCache = null
    const proceed = () => {
      this.fetchNewsManualLatestUpdatedMs((latest) => {
        if (latest > 0) {
          try { storageCache.persistAsync(ARTICLES_NAV_ACK_MANUAL_UPDATED_AT_KEY, latest) } catch (e) {}
        }
        done && done()
      })
    }
    try {
      wx.removeStorage({ key: NEWS_MANUAL_DOT_CACHE_KEY, complete: proceed })
    } catch (e) { proceed() }
  },

  checkProfileDot(tabBar) {
    if (!tabBar) return
    try {
      const { warmProfilePageStorageSync } = require('./utils/page-storage-boot.js')
      warmProfilePageStorageSync()
      const { isCheckedInToday } = require('./utils/checkin.js')
      const { getDailyQuestion } = require('./utils/space-quiz.js')
      const { getSubscribedMissions } = require('./utils/subscribe.js')

      const notCheckedIn = !isCheckedInToday()
      const quizInfo = getDailyQuestion()
      const notAnswered = !quizInfo.alreadyAnswered
      const reminders = getSubscribedMissions()
      const hasNewReminder = reminders.length > 0

      const showDot = notCheckedIn || notAnswered || hasNewReminder
      if (this._profileDotMem === showDot && tabBar.data && tabBar.data.showProfileDot === showDot) return
      this._profileDotMem = showDot
      tabBar.setData({ showProfileDot: showDot })
      this.patchTabBarUiCache({ showProfileDot: showDot })
    } catch (e) {
      tabBar.setData({ showProfileDot: false })
      this.patchTabBarUiCache({ showProfileDot: false })
    }
  },

  /**
   * 「添加到桌面」横条：多端 Tab 栏可能存在多个实例，切换 Tab 时需统一按本地 snooze 刷新。
   * 关闭横条后调用，或在各个 Tab 页 onShow 调用。
   */
  syncAllTabBarsDesktopStrip() {
    try {
      const cache = this.globalData.tabBarUiCache
      let show
      if (cache && typeof cache.showAddDesktopStrip === 'boolean' && storageCache.isLoaded(TABBAR_DESKTOP_STRIP_SNOOZE_KEY)) {
        show = cache.showAddDesktopStrip
      } else {
        show = this.readAddDesktopStripVisibleSync()
        this.patchTabBarUiCache({ showAddDesktopStrip: show })
      }
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      const seen = []
      ;(pages || []).forEach((p) => {
        if (!p || typeof p.getTabBar !== 'function') return
        const tb = p.getTabBar()
        if (!tb) return
        if (seen.indexOf(tb) !== -1) return
        seen.push(tb)
        if (typeof tb.applyDesktopStripVisible === 'function') {
          tb.applyDesktopStripVisible(show)
        } else if (typeof tb.syncDesktopStripFromStorage === 'function') {
          tb.syncDesktopStripFromStorage()
        }
      })
    } catch (e) {}
  },

  /**
   * 旧版路径 / 分享链接兜底：页面挪到分包后，历史入口仍可能命中 pages/progress/* 等旧路径
   */
  onPageNotFound(res) {
    const path = String((res && res.path) || '').replace(/^\//, '')
    const query = (res && res.query) || {}
    const legacyMap = {
      'pages/progress/starbase-map': '/subpackages/progress-extra/starbase-map',
      'pages/progress/road-closure-map': '/subpackages/progress-extra/road-closure-map',
      'pages/progress/road-closure-detail': '/subpackages/progress-extra/road-closure-detail',
      'pages/progress/event-detail': '/subpackages/progress-extra/event-detail',
      'pages/progress/hardware-list': '/subpackages/progress-extra/hardware-list',
      'pages/progress/hardware-detail': '/subpackages/progress-extra/hardware-detail',
      'pages/progress/starship-detail': '/subpackages/progress-extra/starship-detail',
      'pages/index/mission-detail': '/pages/mission-detail/mission-detail',
      'subpackages/index-extra/mission-detail': '/pages/mission-detail/mission-detail'
    }
    const target = legacyMap[path]
    if (target) {
      const qs = Object.keys(query)
        .filter((k) => query[k] != null && query[k] !== '')
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
        .join('&')
      wx.redirectTo({
        url: qs ? `${target}?${qs}` : target,
        fail: () => {
          wx.switchTab({ url: '/pages/progress/progress' })
        }
      })
      return
    }
    wx.switchTab({
      url: '/pages/index/index',
      fail: () => {}
    })
  },

  globalData: {
    userInfo: null,
    uiShellLayout: null,
    tabBarUiCache: null,
    privacyResolvers: [],
    privacyEventInfo: null,
    privacyContractName: '',
    needPrivacyAuthorization: false,
    privacyGateActive: false,
    /** 开屏动画展示中（开屏层自身全屏遮挡，禁触遮罩让位，否则吞掉「跳过」点击） */
    splashActive: false,
    demoMode: false,
    isLiveAccount: false,
    membershipState: null,
    /** 搜索页 → 监控页一次性交接的发射商 id（switchTab 不能带 query，内存传递即可，无需落 storage） */
    pendingAgencyDetailId: '',
    /** 事件更新视频 → 播放页一次性交接（URL 可能很长，避免走 query） */
    pendingEventVideo: null
  }
})
