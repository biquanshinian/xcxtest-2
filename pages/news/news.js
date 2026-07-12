// pages/news/news.js
const { formatDate } = require('../../utils/util.js')
const { tryShowPopupAd } = require('../../utils/popup-ad.js')
const { loadMoreInteraction } = require('../../utils/config.js')
const { loadCloudMediaMap, resolveMediaUrl } = require('../../utils/image-config.js')
const { getUiShellLayout } = require('../../utils/layout.js')
const { getSystemInfo } = require('../../utils/system.js')
const { getNewsListThumbTargetWidthPx, optimizeNewsThumbUrl } = require('../../utils/news-thumb-url.js')
const storageCache = require('../../utils/storage-sync-cache.js')
const { translateTexts, isMostlyChinese, vibrateMedium, translateGateCheck } = require('../../utils/text-translate.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const themeUtil = require('../../utils/theme.js')

// 新闻接口已移入 news-extra 分包（仅 news tab 与详情页使用），按需异步加载以削减主包体积
const NEWS_API_PKG = '../../subpackages/news-extra/utils/api-news.js'
let _newsApiMod = null
let _newsApiLoadPromise = null
function loadNewsApi() {
  if (_newsApiMod) return Promise.resolve(_newsApiMod)
  if (!_newsApiLoadPromise) {
    _newsApiLoadPromise = require.async(NEWS_API_PKG).then((mod) => {
      _newsApiMod = mod
      return mod
    })
  }
  return _newsApiLoadPromise
}

const ARTICLES_NAV_ACK_KEY = '_articles_nav_ack_manual_updated_at'
const LEGACY_ARTICLE_CACHE_KEYS = [
  'news_cache_articles_v4',
  'news_cache_articles_v3',
  'news_cache_articles_v2',
  'news_cache_articles'
]

const LOAD_MORE_LOWER_THRESHOLD = (loadMoreInteraction && loadMoreInteraction.lowerThreshold) || 120
const LOAD_MORE_TRIGGER_ZONE = (loadMoreInteraction && loadMoreInteraction.triggerZone) || 280
const NEWS_QR_IMAGE_KEY = 'images/qrcode.jpg'
const NEWS_QR_IMAGE_FALLBACK_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E4%BA%8C%E7%BB%B4%E7%A0%81/1773602500092_bc7nap.jpg'
const NEWS_SHARE_DEFAULT_KEY = 'images/share/default.jpg'

function resolveCardMediaSrc(val) {
  if (!val || !String(val).trim()) return ''
  const s = String(val).trim()
  if (/^https?:\/\//i.test(s)) return s
  return resolveMediaUrl(s, '') || s
}

function extractFirstImgSrcFromHtml(html) {
  if (!html || typeof html !== 'string') return ''
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html)
  return m ? String(m[1]).trim() : ''
}

/** 与详情页 normalizeArticle 的头图逻辑对齐：images[0] → image → 正文 HTML 首图 */
function resolveArticleCardImage(item) {
  if (!item) return ''
  const images = Array.isArray(item.images)
    ? item.images.map((u) => String(u || '').trim()).filter(Boolean)
    : []

  let url = ''
  if (images.length) url = resolveCardMediaSrc(images[0])
  if (!url && item.image) url = resolveCardMediaSrc(item.image)
  if (!url && item.content) {
    const first = extractFirstImgSrcFromHtml(item.content)
    if (first) url = resolveCardMediaSrc(first)
  }
  return url
}

/** 客户端兜底：统一按 publishedAt 毫秒降序混排（与 api.js 一致，不读 weight） */
function articlePublishedMs(item) {
  if (!item || item.publishedAt == null || item.publishedAt === '') return 0
  const v = item.publishedAt
  if (typeof v === 'number' && !isNaN(v)) {
    return v < 1e11 ? Math.round(v * 1000) : Math.round(v)
  }
  const t = new Date(v).getTime()
  return isNaN(t) ? 0 : t
}

function sortArticlesListByTimeDesc(list) {
  return (list || []).slice().sort((a, b) => {
    const pa = articlePublishedMs(a)
    const pb = articlePublishedMs(b)
    if (pb !== pa) return pb - pa
    return String(b && b.id || '').localeCompare(String(a && a.id || ''))
  })
}

Page({
  onLoad() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 3,
        currentPath: '/pages/news/news'
      })
    }

    const contentType = 'articles'

    const app = getApp()
    const uiShellLayout = (app && app.getUiShellLayout && app.getUiShellLayout()) || getUiShellLayout(getSystemInfo())
    const rpxToPx = uiShellLayout.windowWidth / 750
    const statusBarHeightRpx = uiShellLayout.statusBarHeight / rpxToPx
    const winW = uiShellLayout.windowWidth
    const winH = uiShellLayout.windowHeight
    const btnSize = 100 * rpxToPx
    const right = 30 * rpxToPx
    const bottom = 220 * rpxToPx + 40

    const sharedInitData = {
      themeClass: themeUtil.getThemeClassSync(),
      themeLight: themeUtil.isLightSync(),
      pageBgColor: themeUtil.getPageBgSync(),
      contentType,
      statusBarHeight: uiShellLayout.statusBarHeight,
      statusBarHeightRpx,
      navPlaceholderHeight: uiShellLayout.navPlaceholderHeight,
      tabBarReservedHeight: uiShellLayout.tabBarReservedHeight,
      windowWidth: winW,
      windowHeight: winH,
      buttonSize: btnSize,
      buttonX: winW - right - btnSize,
      buttonY: winH - bottom - btnSize,
      qrcodeImage: NEWS_QR_IMAGE_FALLBACK_URL,
      errorType: null
    }

    this.setData(sharedInitData)

    var self = this
    void loadCloudMediaMap().then(function () {
      self.setData({ qrcodeImage: self.getNewsQrImageUrl() })
    }).catch(function () {})

    setTimeout(function () {
      self._bootNewsData(contentType, sharedInitData)
    }, 0)
  },

  _clearLegacyArticleCaches() {
    if (_newsApiMod && typeof _newsApiMod.invalidateArticlesMergeCache === 'function') {
      _newsApiMod.invalidateArticlesMergeCache()
    }
    // 只清历史版本 key；当前 key 保留（切换标签秒显，后台静默换新）
    LEGACY_ARTICLE_CACHE_KEYS.forEach(function (key) {
      storageCache.invalidate(key)
      try { wx.removeStorage({ key: key, fail: function () {} }) } catch (e) {}
    })
  },

  /** 后台静默刷新第 1 页：不动 loading/列表，成功后整页替换并回写缓存 */
  _silentRefreshFirstPage(type) {
    if (type === 'articles' && _newsApiMod && typeof _newsApiMod.invalidateArticlesMergeCache === 'function') {
      _newsApiMod.invalidateArticlesMergeCache()
    }
    this.loadNews(false, { silent: true, type })
  },

  _bootNewsData(contentType, sharedInitData) {
    this._clearLegacyArticleCaches()
    const cached = this.getCache(contentType)
    if (cached && cached.newsList && cached.newsList.length > 0) {
      this.setData({
        newsList: cached.newsList,
        page: (cached.page || 1) + 1,
        hasMore: cached.hasMore !== false
      })
      // 先显旧数据，后台静默换新（手写稿排序/新事件不丢）
      this._silentRefreshFirstPage(contentType)
      return
    }
    this.loadNews()
  },

  onShow() {
    // 主题兜底同步：在其他 Tab 切了主题后回到本 Tab
    themeUtil.applyThemeToPage(this)
    try {
      const app = getApp && getApp()
      if (app && typeof app.syncAllTabBarsDesktopStrip === 'function') app.syncAllTabBarsDesktopStrip()
    } catch (e) {}
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const tabBar = this.getTabBar()
      tabBar.setData({
        selected: 3,
        currentPath: '/pages/news/news',
        showNewsDot: false
      })
      getApp().checkProgressDot(tabBar)
      getApp().checkProfileDot(tabBar)
      const app = getApp()
      if (app && typeof app.acknowledgeNewsTabManualDot === 'function') {
        app.acknowledgeNewsTabManualDot(() => {
          if (typeof app.checkNewsDot === 'function') app.checkNewsDot(tabBar)
        })
      } else if (typeof app.checkNewsDot === 'function') {
        app.checkNewsDot(tabBar)
      }
    }

    var self = this
    setTimeout(function () {
      self._refreshArticlesNavDot()
      if (self.data.newsList.length === 0) {
        const cached = self.getCache(self.data.contentType)
        if (cached && cached.newsList && cached.newsList.length > 0) {
          self.setData({
            newsList: cached.newsList,
            page: (cached.page || 1) + 1,
            hasMore: cached.hasMore !== false
          })
          self._silentRefreshFirstPage(self.data.contentType)
          return
        }
        if (!self.data.loading) {
          self.loadNews()
        }
      }
      tryShowPopupAd(3, self)
    }, 0)
  },

  onPopupAdClose() {
    this.setData({ popupAdVisible: false, popupAdItem: null })
  },

  /** 顶部「航天事件」是否与云端后台更新时间不一致（与 app.js ARTICLES_NAV_ACK 联动） */
  _refreshArticlesNavDot() {
    const app = getApp()
    if (!app || typeof app.fetchNewsManualLatestUpdatedMs !== 'function') return
    app.fetchNewsManualLatestUpdatedMs((latest) => {
      const L = Number(latest) || 0
      if (!L) {
        if (this.data.showArticlesNavDot) this.setData({ showArticlesNavDot: false })
        return
      }
      let ack = 0
      try {
        ack = Number(storageCache.readSync(ARTICLES_NAV_ACK_KEY, 0)) || 0
      } catch (_) {}
      const show = L > ack
      if (show !== this.data.showArticlesNavDot) this.setData({ showArticlesNavDot: show })
    })
  },

  /** 页面级翻译开关：预翻译字段本地秒切；缺译条目再调云端补翻（限流 20 条） */
  async onToggleNewsTranslate() {
    vibrateMedium()
    const next = !this.data.newsTranslated
    if (next) {
      // 翻译消耗云端 token：开启译文前统一走会员/看广告门控（切回原文免门控）
      const allowed = await translateGateCheck()
      if (!allowed) return
    }
    this.setData({ newsTranslated: next })
    if (next) this._fillMissingNewsTranslations()
  },

  _fillMissingNewsTranslations() {
    if (this._newsTranslateBusy) return
    const list = this.data.newsList || []
    const isArticles = this.data.contentType === 'articles'
    // 收集缺少云端预翻译且确为英文的字段（标题优先，其次摘要/描述），单次最多 20 条
    const fields = []
    for (let i = 0; i < list.length && fields.length < 20; i++) {
      const item = list[i]
      if (!item) continue
      if (item.title && !item.titleZh && !isMostlyChinese(item.title)) {
        fields.push({ path: `newsList[${i}].titleZh`, text: item.title })
      }
      if (fields.length >= 20) break
      const bodyKey = isArticles ? 'summary' : 'description'
      const bodyZhKey = bodyKey + 'Zh'
      if (item[bodyKey] && !item[bodyZhKey] && !isMostlyChinese(item[bodyKey])) {
        fields.push({ path: `newsList[${i}].${bodyZhKey}`, text: item[bodyKey] })
      }
    }
    if (!fields.length) return

    this._newsTranslateBusy = true
    translateTexts(fields.map((f) => f.text))
      .then((results) => {
        this._newsTranslateBusy = false
        // 用户可能已切回原文；译文仍写入 zh 字段，下次切换直接生效
        const patch = {}
        for (let i = 0; i < fields.length; i++) {
          if (results[i]) patch[fields[i].path] = results[i]
        }
        if (Object.keys(patch).length) this.setData(patch)
      })
      .catch(() => {
        this._newsTranslateBusy = false
      })
  },

  data: {
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    popupAdItem: null,
    popupAdVisible: false,
    contentType: 'articles',
    pageDesc: 'SpaceX马斯克航天太空动态·星链星舰猎鹰9号火箭发射事件',
    newsList: [],
    page: 1,
    limit: 10,
    hasMore: true,
    loading: false,
    loadMoreLowerThreshold: LOAD_MORE_LOWER_THRESHOLD,
    loadMoreTriggerZone: LOAD_MORE_TRIGGER_ZONE,
    loadMoreTriggered: false,
    preloadProgress: 0,
    errorType: null,
    newsTranslated: false,
    showArticlesNavDot: false,
    showQRCodeModal: false,
    qrcodeImage: '',
    buttonX: 0,
    buttonY: 0,
    windowWidth: 0,
    windowHeight: 0,
    buttonSize: 0,
    currentShareArticle: null,
    currentShareEvent: null,
    statusBarHeight: 44,
    statusBarHeightRpx: 88,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0
  },


  CACHE_DURATION: 30 * 60 * 1000,
  // v5/v2：卡片改为"原文 + 携带 Zh 字段"后旧缓存格式失效
  CACHE_KEY_EVENTS: 'news_cache_events_v2',
  CACHE_KEY_ARTICLES: 'news_cache_articles_v5',

  resolveNewsImage(key, fallback) {
    return resolveMediaUrl(key, fallback)
  },

  getNewsQrImageUrl() {
    const resolved = this.resolveNewsImage(NEWS_QR_IMAGE_KEY, '')
    return resolved || NEWS_QR_IMAGE_FALLBACK_URL
  },

  getCache(type) {
    try {
      const cacheKey = type === 'articles' ? this.CACHE_KEY_ARTICLES : this.CACHE_KEY_EVENTS
      const cached = storageCache.readSync(cacheKey, null)
      if (!cached || !cached.data) return null

      const now = Date.now()
      if (cached.timestamp && (now - cached.timestamp > this.CACHE_DURATION)) {
        storageCache.invalidate(cacheKey)
        try { wx.removeStorage({ key: cacheKey, fail: function () {} }) } catch (e) {}
        return null
      }

      return cached.data
    } catch (error) {
      return null
    }
  },

  setCache(type, data) {
    try {
      if (!type || (type !== 'articles' && type !== 'events')) return
      if (!data) return

      const cacheKey = type === 'articles'
        ? (this.CACHE_KEY_ARTICLES || 'news_cache_articles')
        : (this.CACHE_KEY_EVENTS || 'news_cache_events')

      if (!cacheKey) return

      storageCache.persistAsync(cacheKey, {
        data,
        timestamp: Date.now()
      })
    } catch (error) {}
  },

  switchContentType(e) {
    const type = e.currentTarget.dataset.type
    if (this.data.contentType === type) return

    const app = getApp()
    if (type === 'articles' && app && typeof app.acknowledgeArticlesNavManualDot === 'function') {
      app.acknowledgeArticlesNavManualDot(() => {
        this.setData({ showArticlesNavDot: false })
      })
    }

    // 两个标签都优先秒显本地缓存，再后台静默刷新（手写稿排序/新事件靠静默刷新兜底）
    const cached = this.getCache(type)
    if (cached && cached.newsList && cached.newsList.length > 0) {
      this.setData({
        contentType: type,
        newsList: cached.newsList,
        page: (cached.page || 1) + 1,
        hasMore: cached.hasMore !== false,
        errorType: null
      })
      this._silentRefreshFirstPage(type)
      this._refreshArticlesNavDot()
      return
    }

    this.setData({
      contentType: type,
      page: 1,
      newsList: [],
      hasMore: true,
      errorType: null
    })

    this.loadNews(true).finally(() => {
      this._refreshArticlesNavDot()
    })
  },

  /** 文章列表格式化（时间/卡片缩略图） */
  _formatArticlesList(list) {
    const thumbWidthPx = getNewsListThumbTargetWidthPx(
      this.data.windowWidth || getSystemInfo().windowWidth
    )
    return (list || []).map(item => {
      const rawImage = resolveArticleCardImage(item)
      return {
        ...item,
        formattedTime: formatDate(item.publishedAt, 'MM月DD日 HH:mm'),
        formattedDate: formatDate(item.publishedAt, 'YYYY年MM月DD日 HH:mm'),
        cardImage: rawImage ? optimizeNewsThumbUrl(rawImage, thumbWidthPx) : ''
      }
    })
  },

  /** 事件列表格式化（列表优先 LL2 ~350px 缩略图，原图仅供详情页） */
  _formatEventsList(list) {
    const eventThumbWidthPx = getNewsListThumbTargetWidthPx(
      this.data.windowWidth || getSystemInfo().windowWidth
    )
    return (list || []).map(item => {
      const rawCardImage = item.listImage || item.image
      return {
        ...item,
        formattedTime: formatDate(item.date, 'MM月DD日 HH:mm'),
        formattedDate: formatDate(item.date, 'YYYY年MM月DD日 HH:mm'),
        cardImage: rawCardImage ? optimizeNewsThumbUrl(rawCardImage, eventThumbWidthPx) : ''
      }
    })
  },

  async loadNews(reset = false, opts = {}) {
    // 静默刷新：不动 loading/当前列表，拉第 1 页成功后整页替换并回写缓存
    if (opts.silent) {
      const type = opts.type === 'events' ? 'events' : 'articles'
      if (!this._silentLoading) this._silentLoading = {}
      if (this._silentLoading[type]) return
      this._silentLoading[type] = true
      try {
        const newsApi = await loadNewsApi()
        let formattedList
        let hasMore
        if (type === 'articles') {
          const res = await newsApi.getArticlesList(1, this.data.limit)
          try { await loadCloudMediaMap() } catch (e) {}
          formattedList = sortArticlesListByTimeDesc(this._formatArticlesList(res.list))
          hasMore = res.hasMore !== false
        } else {
          const res = await newsApi.getEventsList(1, this.data.limit)
          formattedList = this._formatEventsList(res.list)
          hasMore = res.hasMore !== false && formattedList.length === this.data.limit
        }
        this.setCache(type, { newsList: formattedList, page: 1, hasMore })
        // 用户已翻页或正在加载更多时不整页替换，避免丢已加载内容；只回写缓存供下次秒显
        // （下拉刷新 forceReplace：用户主动要新数据，翻页深度不再作为拦截条件）
        const canReplace = this.data.contentType === type &&
          !this.data.loading &&
          (opts.forceReplace || this.data.page <= 2) &&
          formattedList.length > 0
        if (canReplace) {
          this.setData({ newsList: formattedList, page: 2, hasMore })
          if (this.data.newsTranslated) this._fillMissingNewsTranslations()
        }
      } catch (e) {
        // 静默失败不打扰：屏上已有缓存数据
      } finally {
        this._silentLoading[type] = false
      }
      return
    }

    if (this.data.loading) return

    if (!reset && this.data.page === 1) {
      const cached = this.getCache(this.data.contentType)
      if (cached && cached.newsList && cached.newsList.length > 0) {
        this.setData({
          newsList: cached.newsList,
          page: (cached.page || 1) + 1,
          hasMore: cached.hasMore !== false
        })
        this._silentRefreshFirstPage(this.data.contentType)
        this._refreshArticlesNavDot()
        return
      }
    }

    if (reset) {
      this.setData({
        page: 1,
        newsList: [],
        hasMore: true,
        errorType: null
      })
    }

    try {
      this.setData({ loading: true })

      const newsApi = await loadNewsApi()

      let res
      if (this.data.contentType === 'articles') {
        const isFirstPage = this.data.page === 1
        res = await newsApi.getArticlesList(this.data.page, this.data.limit)

        // 确保 COS key → URL 映射已就绪（内部有内存缓存与 in-flight 合并，重复调用开销极小）
        try { await loadCloudMediaMap() } catch (e) {}

        const formattedList = this._formatArticlesList(res.list)

        let newList = reset ? formattedList : [...this.data.newsList, ...formattedList]
        newList = sortArticlesListByTimeDesc(newList)
        const hasMore = res.hasMore !== false

        this.setData({
          newsList: newList,
          hasMore,
          page: this.data.page + 1,
          loading: false
        })

        if (isFirstPage) {
          this.setCache('articles', { newsList: newList, page: 1, hasMore })
        }
      } else {
        const isFirstPage = this.data.page === 1
        res = await newsApi.getEventsList(this.data.page, this.data.limit)

        const formattedList = this._formatEventsList(res.list)

        const newList = reset ? formattedList : [...this.data.newsList, ...formattedList]
        const hasMore = res.hasMore !== false && formattedList.length === this.data.limit

        this.setData({
          newsList: newList,
          hasMore,
          page: this.data.page + 1,
          loading: false
        })

        if (isFirstPage) {
          this.setCache('events', { newsList: formattedList, page: 1, hasMore })
        }
      }
    } catch (error) {
      let errorType = null
      let errorMessage = '加载失败'

      if (error.type === 'database_error') {
        errorType = 'database_error'
        errorMessage = error.errMsg || '数据暂不可用，请稍后再试'
      } else if (error.type === 'timeout' ||
                 (error.message && error.message.includes('超时')) ||
                 (error.message && error.message.includes('timeout'))) {
        errorType = 'timeout'
        errorMessage = '加载超时，请稍后重试'
      } else {
        errorType = 'unknown'
        errorMessage = error.errMsg || '加载失败，请稍后重试'
      }

      this.setData({
        loading: false,
        hasMore: false,
        errorType
      })

      wx.showToast({
        title: errorMessage,
        icon: 'none',
        duration: 2000
      })
    } finally {
      this._refreshArticlesNavDot()
    }
  },

  onNewsScroll(e) {
    const scrollTop = e.detail.scrollTop || 0
    const scrollHeight = e.detail.scrollHeight || 0
    const viewportHeight = this.data.windowHeight || getSystemInfo().windowHeight || 0
    const triggerZone = this.data.loadMoreTriggerZone || 280

    let preloadProgress = 0
    if (this.data.hasMore && !this.data.loading && scrollHeight > 0 && viewportHeight > 0) {
      const distanceToBottom = Math.max(0, scrollHeight - scrollTop - viewportHeight)
      preloadProgress = Math.max(0, Math.min(1, (triggerZone - distanceToBottom) / triggerZone))
    }

    // scroll 事件高频触发：进度量化到 0.05 一档，不变则跳过 setData——
    // 常规滚动阶段（进度恒为 0）不产生任何视图层通信
    const quantized = Math.round(preloadProgress * 20) / 20
    if (quantized === this._lastPreloadProgress) return
    this._lastPreloadProgress = quantized
    this.setData({ preloadProgress: quantized })
  },

  loadMoreNews() {
    if (!this.data.hasMore || this.data.loading || this._loadingMoreLock) return

    this._loadingMoreLock = true
    this._lastPreloadProgress = 1
    this.setData({
      loadMoreTriggered: true,
      preloadProgress: 1
    })

    const now = Date.now()
    if (!this._lastLoadMoreVibrateAt || now - this._lastLoadMoreVibrateAt > 1200) {
      this._lastLoadMoreVibrateAt = now
      wx.vibrateShort({ type: 'light' })
    }

    this.loadNews().finally(() => {
      this._loadingMoreLock = false
      this._lastPreloadProgress = 0
      this.setData({
        loadMoreTriggered: false,
        preloadProgress: 0
      })
    })
  },

  /** 页面级原生下拉刷新（全局统一）：清本地列表缓存后静默换新当前 Tab
   *  刷新全程只显示微信原生指示器，不清列表、不出现任何“加载中”占位 */
  onPullDownRefresh() {
    runPullRefresh(this, async () => {
      try {
        const cacheKey = this.data.contentType === 'articles' ? this.CACHE_KEY_ARTICLES : this.CACHE_KEY_EVENTS
        storageCache.invalidate(cacheKey)
        try { wx.removeStorage({ key: cacheKey, fail: function () {} }) } catch (e) {}
        if (this.data.contentType === 'articles' && _newsApiMod && typeof _newsApiMod.invalidateArticlesMergeCache === 'function') {
          _newsApiMod.invalidateArticlesMergeCache()
        }
      } catch (e) {}

      await this.loadNews(false, { silent: true, type: this.data.contentType, forceReplace: true })
    })
  },

  retryLoadNews() {
    this.loadNews(true)
  },

  showQRCode() {
    this.setData({ showQRCodeModal: true })
  },

  onQrcodeEntryTouchStart(e) {
    const t = e.touches[0]
    this._qrcodeStartX = t.clientX
    this._qrcodeStartY = t.clientY
    this._qrcodeStartBtnX = this.data.buttonX
    this._qrcodeStartBtnY = this.data.buttonY
    this._qrcodeIsDragging = false
  },

  onQrcodeEntryTouchMove(e) {
    const t = e.touches[0]
    const dx = t.clientX - this._qrcodeStartX
    const dy = t.clientY - this._qrcodeStartY
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      this._qrcodeIsDragging = true
    }
    const sz = this.data.buttonSize
    const W = this.data.windowWidth
    const H = this.data.windowHeight
    this._qrcodePendingX = Math.max(0, Math.min(W - sz, this._qrcodeStartBtnX + dx))
    this._qrcodePendingY = Math.max(0, Math.min(H - sz, this._qrcodeStartBtnY + dy))
    // touchmove 高频触发：按 ~60fps 节流 setData，避免拖拽期间渲染层被刷爆
    const now = Date.now()
    if (this._qrcodeLastMoveSetAt && now - this._qrcodeLastMoveSetAt < 16) return
    this._qrcodeLastMoveSetAt = now
    this.setData({ buttonX: this._qrcodePendingX, buttonY: this._qrcodePendingY })
  },

  onQrcodeEntryTouchEnd() {
    if (this._qrcodeIsDragging) {
      // 结束时落定最后一次位置（节流可能吞掉了末帧）
      if (this._qrcodePendingX != null) {
        this.setData({ buttonX: this._qrcodePendingX, buttonY: this._qrcodePendingY })
      }
      this._snapQrcodeEntryToEdge()
      return
    }
    this.showQRCode()
  },

  _snapQrcodeEntryToEdge() {
    const { buttonX, windowWidth, buttonSize } = this.data
    const centerX = windowWidth / 2
    const newX = (buttonX + buttonSize / 2) < centerX ? 0 : windowWidth - buttonSize
    this.setData({ buttonX: newX })
  },

  hideQRCode() {
    this.setData({ showQRCodeModal: false })
  },

  onQRCodeImageTap() {
    const qrUrl = this.data.qrcodeImage || this.getNewsQrImageUrl()
    wx.previewImage({
      urls: [qrUrl],
      current: qrUrl
    })
  },

  onQRCodeImageError() {
    if (this.data.qrcodeImage === NEWS_QR_IMAGE_FALLBACK_URL) return
    this.setData({ qrcodeImage: NEWS_QR_IMAGE_FALLBACK_URL })
  },

  stopPropagation() {},

  shareEvent(e) {
    if (e && e.stopPropagation) e.stopPropagation()
    const id = e.currentTarget.dataset.id || (e.detail && e.detail.target && e.detail.target.dataset && e.detail.target.dataset.id)
    const ev = this.data.newsList.find(item => item.id === id)
    if (ev) {
      this.setData({ currentShareEvent: ev, currentShareArticle: null })
    }
    return false
  },

  shareArticle(e) {
    if (e && e.stopPropagation) e.stopPropagation()
    const id = e.currentTarget.dataset.id || (e.detail && e.detail.target && e.detail.target.dataset && e.detail.target.dataset.id)
    const article = this.data.newsList.find(item => item.id === id)
    if (article) {
      this.setData({ currentShareArticle: article, currentShareEvent: null })
    }
    return false
  },

  onShareAppMessage() {
    const shareDefault = this.resolveNewsImage(NEWS_SHARE_DEFAULT_KEY, '')

    const ev = this.data.currentShareEvent
    if (ev) {
      const title = (ev.title || '即将发生') + ' | 火星探索日志'
      return {
        title,
        path: `/subpackages/news-extra/detail?id=${ev.id}&type=event`,
        imageUrl: ev.image || shareDefault
      }
    }

    const article = this.data.currentShareArticle
    if (article) {
      const title = (article.title || '航天事件') + ' | 火星探索日志'
      return {
        title,
        path: `/subpackages/news-extra/detail?id=${article.id}&type=article`,
        imageUrl: article.image || shareDefault
      }
    }

    return {
      title: 'SpaceX航天事件 - 星链·马斯克太空动态 | 火星探索日志',
      path: '/pages/news/news',
      imageUrl: shareDefault
    }
  },

  onShareTimeline() {
    const shareDefault = this.resolveNewsImage(NEWS_SHARE_DEFAULT_KEY, '')

    const ev = this.data.currentShareEvent
    if (ev) {
      const title = (ev.title || '即将发生') + ' | 火星探索日志'
      return {
        title,
        query: `id=${ev.id}&type=event`,
        imageUrl: ev.image || shareDefault
      }
    }

    const article = this.data.currentShareArticle
    if (article) {
      const title = (article.title || '航天事件') + ' | 火星探索日志'
      return {
        title,
        query: `id=${article.id}&type=article`,
        imageUrl: article.image || shareDefault
      }
    }

    return {
      title: 'SpaceX航天事件 - 星链·马斯克太空动态 | 火星探索日志',
      query: '',
      imageUrl: shareDefault
    }
  }
})
