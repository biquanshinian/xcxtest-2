// pages/news/news.js
const { formatDate } = require('../../utils/util.js')
const { tryShowPopupAd } = require('../../utils/popup-ad.js')
const { loadMoreInteraction } = require('../../utils/config.js')
const { loadCloudMediaMap, resolveMediaUrl } = require('../../utils/image-config.js')
const { getUiShellLayout } = require('../../utils/layout.js')
const { getSystemInfo } = require('../../utils/system.js')
const { getNewsListThumbTargetWidthPx, optimizeNewsThumbUrl } = require('../../utils/news-thumb-url.js')
const storageCache = require('../../utils/storage-sync-cache.js')
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

// ========== 低频逻辑在 news-extra 分包 ==========
// news-lazy：导航红点、二维码入口；news-photos-lazy：摄影列表/瀑布流/投稿。
// require.async + attachTo 与 profile-lazy / progress-lazy 一致。
// sharePhoto / 卡片快照 / onShareAppMessage 需同步，保留在下方 Page 内。
const NEWS_LAZY_METHODS = [
  '_refreshArticlesNavDot',
  '_refreshPhotosNavDot',
  'acknowledgePhotosNavDot',
  'onQrcodeEntryTouchStart',
  'onQrcodeEntryTouchMove',
  'onQrcodeEntryTouchEnd',
  '_snapQrcodeEntryToEdge',
  'onQRCodeImageTap',
  'onQRCodeImageError'
]
function ensureNewsLazy(page) {
  if (page.__newsLazyAttached) return Promise.resolve(page.__newsLazyMod)
  if (!page.__newsLazyLoadPromise) {
    // 字面量路径：开发者工具静态分析识别不了 require.async(变量)，会把分包模块误报为无依赖文件
    page.__newsLazyLoadPromise = require.async('../../subpackages/news-extra/utils/news-lazy.js').then((mod) => {
      mod.attachTo(page)
      page.__newsLazyMod = mod
      return mod
    }).catch((err) => {
      page.__newsLazyLoadPromise = null
      console.error('[News] news-lazy 分包加载失败:', err)
      throw err
    })
  }
  return page.__newsLazyLoadPromise
}
function delegateNewsLazy(name) {
  return function (...args) {
    const page = this
    if (page.__newsLazyAttached) return page[name](...args)
    return ensureNewsLazy(page).then(() => page[name](...args))
  }
}
const newsLazyDelegates = {}
NEWS_LAZY_METHODS.forEach((name) => {
  newsLazyDelegates[name] = delegateNewsLazy(name)
})

const NEWS_PHOTOS_METHODS = [
  '_refreshPhotosNavFlag',
  '_applyPhotosEnabledFromApi',
  '_isPhotoListItem',
  '_authorAvatarChar',
  '_photoItemHeight',
  '_buildPhotoColumns',
  '_appendPhotoColumns',
  '_setPhotosViewList',
  '_formatPhotosList',
  '_pulsePhotoFabOnScroll',
  'goPhotoUpload'
]
function ensureNewsPhotos(page) {
  if (page.__newsPhotosAttached) return Promise.resolve(page.__newsPhotosMod)
  if (!page.__newsPhotosLoadPromise) {
    page.__newsPhotosLoadPromise = require.async('../../subpackages/news-extra/utils/news-photos-lazy.js').then((mod) => {
      mod.attachTo(page)
      page.__newsPhotosMod = mod
      return mod
    }).catch((err) => {
      page.__newsPhotosLoadPromise = null
      console.error('[News] news-photos-lazy 分包加载失败:', err)
      throw err
    })
  }
  return page.__newsPhotosLoadPromise
}
function delegateNewsPhotos(name) {
  return function (...args) {
    const page = this
    if (page.__newsPhotosAttached) return page[name](...args)
    return ensureNewsPhotos(page).then(() => page[name](...args))
  }
}
const newsPhotosDelegates = {}
NEWS_PHOTOS_METHODS.forEach((name) => {
  newsPhotosDelegates[name] = delegateNewsPhotos(name)
})

Page({
  ...newsLazyDelegates,
  ...newsPhotosDelegates,
  onLoad() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 3,
        currentPath: '/pages/news/news'
      })
    }

    // 新闻 Tab 默认落在「航天摄影」；开关关闭时由 _refreshPhotosNavFlag 回退到航天事件
    const contentType = 'photos'

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

    // 先等开关，再 boot，避免摄影缓存在关入口时污染「航天事件」列表
    // 预热摄影 helper，与 preloadRule 叠加，减少首屏委托等待
    void ensureNewsPhotos(this).catch(() => {})
    this._refreshPhotosNavFlag({ fromLoad: true })
      .then((show) => {
        const type = show ? 'photos' : 'articles'
        if (self.data.contentType !== type) {
          self.setData({ contentType: type })
        }
        self._bootNewsData(type, sharedInitData)
      })
      .catch(() => {
        self.setData({
          contentType: 'articles',
          showPhotosNav: false,
          showPhotosNavDot: false
        })
        self._bootNewsData('articles', sharedInitData)
      })
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
  _silentRefreshFirstPage(type, opts) {
    const force = !!(opts && (opts.forceReplace || opts.force))
    // 摄影列表：60s 内有成功拉取则跳过静默刷新，砍掉切 Tab / onShow 重复打库
    if (
      type === 'photos' &&
      !force &&
      this._photosLastFetchAt &&
      Date.now() - this._photosLastFetchAt < 60 * 1000
    ) {
      return
    }
    if (type === 'articles' && _newsApiMod && typeof _newsApiMod.invalidateArticlesMergeCache === 'function') {
      _newsApiMod.invalidateArticlesMergeCache()
    }
    this.loadNews(false, Object.assign({ silent: true, type }, opts || {}, force ? { forceReplace: true } : {}))
  },

  _bootNewsData(contentType, sharedInitData) {
    // 与当前 Tab / 开关不一致时不灌缓存，防止摄影列表污染航天事件
    if (this.data.contentType !== contentType) return
    if (contentType === 'photos' && !this.data.showPhotosNav) return
    this._clearLegacyArticleCaches()
    const cached = this.getCache(contentType)
    const cachedList = this._sanitizeCachedNewsList(contentType, cached && cached.newsList)
    if (cachedList.length > 0) {
      const pagePatch = {
        page: (cached.page || 1) + 1,
        hasMore: cached.hasMore !== false
      }
      if (contentType === 'photos') {
        void ensureNewsPhotos(this).then(() => {
          if (this.data.contentType !== 'photos') return
          this._setPhotosViewList(this._formatPhotosList(cachedList), pagePatch)
          this._silentRefreshFirstPage(contentType)
        }).catch(() => {
          this.loadNews()
        })
        return
      }
      this.setData(Object.assign({ newsList: cachedList }, pagePatch))
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
    this._refreshPhotosNavFlag()
    // 详情页本人删除后回列表：清摄影缓存并强制静默刷新
    try {
      const app = getApp()
      if (app && app._astroPhotosNeedRefresh) {
        app._astroPhotosNeedRefresh = 0
        storageCache.invalidate(this.CACHE_KEY_PHOTOS)
        try { wx.removeStorage({ key: this.CACHE_KEY_PHOTOS, fail: function () {} }) } catch (e) {}
        if (this.data.contentType === 'photos') {
          this.loadNews(false, { silent: true, type: 'photos', forceReplace: true })
        }
      }
    } catch (e) {}
    setTimeout(function () {
      self._refreshArticlesNavDot()
      self._refreshPhotosNavDot()
      if (self.data.newsList.length === 0) {
        const type = self.data.contentType
        const cached = self.getCache(type)
        const cachedList = self._sanitizeCachedNewsList(type, cached && cached.newsList)
        if (cachedList.length > 0) {
          const pagePatch = {
            page: (cached.page || 1) + 1,
            hasMore: cached.hasMore !== false
          }
          if (type === 'photos') {
            void ensureNewsPhotos(self).then(() => {
              if (self.data.contentType !== 'photos') return
              self._setPhotosViewList(self._formatPhotosList(cachedList), pagePatch)
              self._silentRefreshFirstPage(type)
            }).catch(() => {
              if (!self.data.loading) self.loadNews()
            })
            return
          }
          self.setData(Object.assign({ newsList: cachedList }, pagePatch))
          self._silentRefreshFirstPage(type)
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

  onHide() {
    if (this._photoFabShowTimer) {
      clearTimeout(this._photoFabShowTimer)
      this._photoFabShowTimer = null
    }
    // 切走 Tab 时复位，避免回来后投稿钮仍停在滑动隐藏态
    if (this.data.photoFabHidden) {
      this.setData({ photoFabHidden: false })
    }
  },

  onUnload() {
    if (this._photoFabShowTimer) {
      clearTimeout(this._photoFabShowTimer)
      this._photoFabShowTimer = null
    }
  },

  data: {
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    popupAdItem: null,
    popupAdVisible: false,
    contentType: 'photos',
    showPhotosNav: false,
    pageDesc: 'SpaceX马斯克航天太空动态·星链星舰猎鹰9号火箭发射事件',
    newsList: [],
    photoColLeft: [],
    photoColRight: [],
    page: 1,
    limit: 10,
    hasMore: true,
    loading: false,
    loadMoreLowerThreshold: LOAD_MORE_LOWER_THRESHOLD,
    loadMoreTriggerZone: LOAD_MORE_TRIGGER_ZONE,
    scrollRefreshing: false,
    loadMoreTriggered: false,
    preloadProgress: 0,
    errorType: null,
    showArticlesNavDot: false,
    showPhotosNavDot: false,
    showQRCodeModal: false,
    qrcodeImage: '',
    buttonX: 0,
    buttonY: 0,
    windowWidth: 0,
    windowHeight: 0,
    buttonSize: 0,
    currentShareArticle: null,
    currentShareEvent: null,
    currentSharePhoto: null,
    photoFabHidden: false,
    statusBarHeight: 44,
    statusBarHeightRpx: 88,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0
  },


  CACHE_DURATION: 30 * 60 * 1000,
  // v5/v2：卡片改为"原文 + 携带 Zh 字段"后旧缓存格式失效
  CACHE_KEY_EVENTS: 'news_cache_events_v2',
  CACHE_KEY_ARTICLES: 'news_cache_articles_v5',
  // v2：列表改为 photoCount 瘦字段，旧缓存可被格式化兼容，换 key 避免脏结构久留
  CACHE_KEY_PHOTOS: 'news_cache_photos_v2',
  // news-lazy 分包模块（onQRCodeImageError）经页面实例读取该兜底地址
  NEWS_QR_IMAGE_FALLBACK_URL,

  resolveNewsImage(key, fallback) {
    return resolveMediaUrl(key, fallback)
  },

  getNewsQrImageUrl() {
    const resolved = this.resolveNewsImage(NEWS_QR_IMAGE_KEY, '')
    return resolved || NEWS_QR_IMAGE_FALLBACK_URL
  },

  _cacheKeyForType(type) {
    if (type === 'articles') return this.CACHE_KEY_ARTICLES
    if (type === 'events') return this.CACHE_KEY_EVENTS
    if (type === 'photos') return this.CACHE_KEY_PHOTOS
    return ''
  },

  getCache(type) {
    try {
      const cacheKey = this._cacheKeyForType(type)
      if (!cacheKey) return null
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
      if (!type || (type !== 'articles' && type !== 'events' && type !== 'photos')) return
      if (!data) return

      const cacheKey = this._cacheKeyForType(type)
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
    if (type === 'photos' && !this.data.showPhotosNav) {
      wx.showToast({ title: '航天摄影暂未开放', icon: 'none' })
      return
    }

    // 作废进行中的列表请求，避免文章/事件结果晚到串进摄影 Tab
    this._newsLoadToken = (this._newsLoadToken || 0) + 1
    this._loadingMoreLock = false

    const app = getApp()
    if (type === 'articles' && app && typeof app.acknowledgeArticlesNavManualDot === 'function') {
      app.acknowledgeArticlesNavManualDot(() => {
        this.setData({ showArticlesNavDot: false })
      })
    }
    if (type === 'photos') {
      // 带上内存水位，避免无 hint 时 ack 落不成、短进短出红点回燃
      this.acknowledgePhotosNavDot(this._photosDotLatestAt)
    }

    // 优先秒显本地缓存，再后台静默刷新
    const cached = this.getCache(type)
    const rawCachedList = cached && cached.newsList
    const cachedList = this._sanitizeCachedNewsList(type, rawCachedList)
    // 摄影缓存曾被文章/事件污染时，顺手回写干净列表，避免下次再串出
    if (
      type === 'photos' &&
      Array.isArray(rawCachedList) &&
      cachedList.length !== rawCachedList.length
    ) {
      this.setCache('photos', {
        newsList: cachedList,
        page: (cached && cached.page) || 1,
        hasMore: !cached || cached.hasMore !== false
      })
    }
    if (this._photoFabShowTimer) {
      clearTimeout(this._photoFabShowTimer)
      this._photoFabShowTimer = null
    }

    if (cachedList.length > 0) {
      const pagePatch = {
        contentType: type,
        page: (cached.page || 1) + 1,
        hasMore: cached.hasMore !== false,
        errorType: null,
        loading: false,
        photoFabHidden: false
      }
      if (type === 'photos') {
        this._setPhotosViewList(this._formatPhotosList(cachedList), pagePatch)
      } else {
        this.setData(Object.assign({
          newsList: cachedList,
          photoColLeft: [],
          photoColRight: []
        }, pagePatch))
      }
      this._silentRefreshFirstPage(type)
      this._refreshArticlesNavDot()
      // 切入摄影已 ack，勿立刻 refresh 与 ack 竞态；其它 Tab 才刷红点
      if (type !== 'photos') this._refreshPhotosNavDot()
      return
    }

    this.setData({
      contentType: type,
      page: 1,
      newsList: [],
      photoColLeft: [],
      photoColRight: [],
      hasMore: true,
      errorType: null,
      loading: false,
      photoFabHidden: false
    })

    this.loadNews(true).finally(() => {
      this._refreshArticlesNavDot()
      if (type !== 'photos') this._refreshPhotosNavDot()
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

  /** 仅保留真正的航天摄影条目，避免文章/事件列表串进摄影 Tab */
  // _isPhotoListItem / 瀑布流 / _formatPhotosList / goPhotoUpload → news-photos-lazy

  _sanitizeCachedNewsList(type, list) {
    if (!Array.isArray(list)) return []
    if (type === 'photos') {
      // 委托可能尚未 attach：此时不过滤，交给后续 _formatPhotosList
      if (typeof this._isPhotoListItem === 'function' && this.__newsPhotosAttached) {
        return list.filter((row) => this._isPhotoListItem(row))
      }
      return list
    }
    return list
  },

  _isStaleNewsLoad(type, loadToken) {
    return this.data.contentType !== type || this._newsLoadToken !== loadToken
  },

  async loadNews(reset = false, opts = {}) {
    // 静默刷新：不动 loading/当前列表，拉第 1 页成功后整页替换并回写缓存
    if (opts.silent) {
      const type = opts.type === 'events'
        ? 'events'
        : (opts.type === 'photos' ? 'photos' : 'articles')
      // 下拉 forceReplace 始终放行；普通静默在 60s 内跳过摄影列表
      if (
        type === 'photos' &&
        !opts.forceReplace &&
        this._photosLastFetchAt &&
        Date.now() - this._photosLastFetchAt < 60 * 1000
      ) {
        return
      }
      if (!this._silentLoading) this._silentLoading = {}
      if (!this._silentReloadQueued) this._silentReloadQueued = {}
      if (this._silentLoading[type]) {
        // 切 Tab 期间旧静默未结束时排队，结束后补刷当前意图
        this._silentReloadQueued[type] = opts
        return
      }
      this._silentLoading[type] = true
      const silentToken = this._newsLoadToken
      try {
        let formattedList
        let hasMore
        let photosLatestAt = 0
        if (type === 'photos') {
          const photosMod = await ensureNewsPhotos(this)
          const api = await photosMod.loadAstroPhotosApi()
          const res = await api.listPublicPhotos(0, this.data.limit)
          if (this._applyPhotosEnabledFromApi(res && res.enabled)) return
          formattedList = this._formatPhotosList(res.list || [])
          hasMore = formattedList.length
            ? !!(res.hasMore || formattedList.length >= this.data.limit)
            : false
          photosLatestAt = Number(res && res.latestAt) || 0
        } else {
          const newsApi = await loadNewsApi()
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
        }
        if (this._isStaleNewsLoad(type, silentToken)) return
        if (type === 'photos') {
          this._photosLastFetchAt = Date.now()
          // stale 判定后再动红点，避免快切 Tab 时用过期请求点亮
          if (this.data.contentType === 'photos') {
            this.acknowledgePhotosNavDot(photosLatestAt)
          } else {
            this._refreshPhotosNavDot(photosLatestAt)
          }
        }
        this.setCache(type, { newsList: formattedList, page: 1, hasMore })
        // 用户已翻页或正在加载更多时不整页替换，避免丢已加载内容；只回写缓存供下次秒显
        // （下拉刷新 forceReplace：用户主动要新数据，翻页深度不再作为拦截条件；并忽略 loading）
        // 摄影 Tab 允许空列表替换，用于清掉被污染的本地缓存
        const allowEmptyReplace = type === 'photos' || !!opts.forceReplace
        const canReplace = this.data.contentType === type &&
          (opts.forceReplace || !this.data.loading) &&
          (opts.forceReplace || this.data.page <= 2) &&
          (formattedList.length > 0 || allowEmptyReplace)
        if (canReplace) {
          if (type === 'photos') {
            this._setPhotosViewList(formattedList, {
              page: 2,
              hasMore,
              loading: opts.forceReplace ? false : this.data.loading
            })
          } else {
            this.setData({
              newsList: formattedList,
              page: 2,
              hasMore,
              loading: opts.forceReplace ? false : this.data.loading
            })
          }
        }
      } catch (e) {
        // 静默失败不打扰：屏上已有缓存数据
      } finally {
        this._silentLoading[type] = false
        const queued = this._silentReloadQueued[type]
        if (queued) {
          delete this._silentReloadQueued[type]
          if (this.data.contentType === type) {
            this.loadNews(false, Object.assign({}, queued, { silent: true, type }))
          }
        }
      }
      return
    }

    const type = this.data.contentType
    const loadToken = this._newsLoadToken

    if (this.data.loading) return

    if (!reset && this.data.page === 1) {
      const cached = this.getCache(type)
      const safeCached = this._sanitizeCachedNewsList(type, cached && cached.newsList)
      if (safeCached.length > 0) {
        const pagePatch = {
          page: (cached.page || 1) + 1,
          hasMore: cached.hasMore !== false
        }
        if (type === 'photos') {
          await ensureNewsPhotos(this)
          if (this._isStaleNewsLoad(type, loadToken)) return
          this._setPhotosViewList(this._formatPhotosList(safeCached), pagePatch)
        } else {
          this.setData(Object.assign({ newsList: safeCached }, pagePatch))
        }
        this._silentRefreshFirstPage(type)
        this._refreshArticlesNavDot()
        return
      }
    }

    if (reset) {
      this.setData({
        page: 1,
        newsList: [],
        photoColLeft: type === 'photos' ? [] : this.data.photoColLeft,
        photoColRight: type === 'photos' ? [] : this.data.photoColRight,
        hasMore: true,
        errorType: null
      })
    }

    try {
      this.setData({ loading: true })

      const isFirstPage = this.data.page === 1
      let formattedList
      let hasMore

      if (type === 'photos') {
        const photosMod = await ensureNewsPhotos(this)
        if (this._isStaleNewsLoad(type, loadToken)) return
        const api = await photosMod.loadAstroPhotosApi()
        if (this._isStaleNewsLoad(type, loadToken)) return
        const res = await api.listPublicPhotos(Math.max(0, this.data.page - 1), this.data.limit)
        if (this._isStaleNewsLoad(type, loadToken)) return
        if (this._applyPhotosEnabledFromApi(res && res.enabled)) return
        formattedList = this._formatPhotosList(res.list || [])
        hasMore = formattedList.length
          ? !!(res.hasMore || formattedList.length >= this.data.limit)
          : false
        const base = reset ? [] : (this.data.newsList || []).filter((row) => this._isPhotoListItem(row))
        const newList = reset ? formattedList : [...base, ...formattedList]
        this._photosLastFetchAt = Date.now()
        this._setPhotosViewList(newList, {
          hasMore,
          page: this.data.page + 1,
          loading: false
        })
        if (isFirstPage) {
          this.setCache('photos', { newsList: formattedList, page: 1, hasMore })
        }
        // 人在摄影 Tab：首页/翻页都只 ack 水位，绝不点亮
        this.acknowledgePhotosNavDot(res && res.latestAt)
      } else if (type === 'articles') {
        const newsApi = await loadNewsApi()
        if (this._isStaleNewsLoad(type, loadToken)) return
        const res = await newsApi.getArticlesList(this.data.page, this.data.limit)
        if (this._isStaleNewsLoad(type, loadToken)) return

        // 确保 COS key → URL 映射已就绪（内部有内存缓存与 in-flight 合并，重复调用开销极小）
        try { await loadCloudMediaMap() } catch (e) {}

        formattedList = this._formatArticlesList(res.list)
        let newList = reset ? formattedList : [...this.data.newsList, ...formattedList]
        newList = sortArticlesListByTimeDesc(newList)
        hasMore = res.hasMore !== false

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
        const newsApi = await loadNewsApi()
        if (this._isStaleNewsLoad(type, loadToken)) return
        const res = await newsApi.getEventsList(this.data.page, this.data.limit)
        if (this._isStaleNewsLoad(type, loadToken)) return

        formattedList = this._formatEventsList(res.list)
        const newList = reset ? formattedList : [...this.data.newsList, ...formattedList]
        hasMore = res.hasMore !== false && formattedList.length === this.data.limit

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

      if (!this._isStaleNewsLoad(type, loadToken)) {
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
      }
    } finally {
      if (!this._isStaleNewsLoad(type, loadToken)) {
        this.setData({ loading: false })
      }
      this._refreshArticlesNavDot()
    }
  },

  /** 滑动列表时收起投稿 FAB → news-photos-lazy._pulsePhotoFabOnScroll */

  onNewsScroll(e) {
    this._pulsePhotoFabOnScroll()
    try {
      const { pulseNasaFloatOnScroll } = require('../../utils/nasa-float-scroll.js')
      pulseNasaFloatOnScroll(this)
    } catch (err) {}

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

  /** 原生三点下拉刷新（页面级 / scroll-view refresher 共用）：清缓存后静默换新当前 Tab */
  onScrollRefresh() {
    this._runNewsPullRefresh('scrollRefreshing')
  },

  onPullDownRefresh() {
    this._runNewsPullRefresh()
  },

  _runNewsPullRefresh(key) {
    runPullRefresh(this, async () => {
      try {
        const cacheKey = this._cacheKeyForType(this.data.contentType)
        if (cacheKey) {
          storageCache.invalidate(cacheKey)
          try { wx.removeStorage({ key: cacheKey, fail: function () {} }) } catch (e) {}
        }
        if (this.data.contentType === 'articles' && _newsApiMod && typeof _newsApiMod.invalidateArticlesMergeCache === 'function') {
          _newsApiMod.invalidateArticlesMergeCache()
        }
        if (this.data.contentType === 'photos') {
          await this._refreshPhotosNavFlag()
        }
      } catch (e) {}

      await this.loadNews(false, { silent: true, type: this.data.contentType, forceReplace: true })
    }, key)
  },

  // goPhotoUpload → news-photos-lazy

  retryLoadNews() {
    this.loadNews(true)
  },

  showQRCode() {
    this.setData({ showQRCodeModal: true })
  },

  hideQRCode() {
    this.setData({ showQRCodeModal: false })
  },

  stopPropagation() {},

  /**
   * 点卡片跳详情时把列表项一次性暂存到 app 级（navigator 无 eventChannel）：
   * 详情页先用快照上屏做首屏加速，网络详情照常拉取兜底
   */
  onNewsCardSnapshotTap(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : ''
    if (!id) return
    const item = (this.data.newsList || []).find((row) => String(row && row.id) === String(id))
    if (!item) return
    try {
      const app = getApp()
      if (app) {
        const type = this.data.contentType === 'articles'
          ? 'article'
          : (this.data.contentType === 'photos' ? 'photo' : 'event')
        app._newsDetailSnapshot = {
          id: String(id),
          type,
          item,
          at: Date.now()
        }
      }
    } catch (err) {}
  },

  _findNewsItemById(id) {
    if (id == null || id === '') return null
    return (this.data.newsList || []).find((item) => String(item && item.id) === String(id)) || null
  },

  /** 同步记下待分享项，避免 catchtap setData 与 onShareAppMessage 竞态 */
  _rememberShareItem(kind, item) {
    this._pendingShareKind = kind || ''
    this._pendingShareItem = item || null
    if (kind === 'photo') {
      this.setData({ currentSharePhoto: item, currentShareArticle: null, currentShareEvent: null })
    } else if (kind === 'event') {
      this.setData({ currentShareEvent: item, currentShareArticle: null, currentSharePhoto: null })
    } else if (kind === 'article') {
      this.setData({ currentShareArticle: item, currentShareEvent: null, currentSharePhoto: null })
    }
  },

  _resolveSharePayload(kind, item, shareDefault) {
    if (!item) return null
    if (kind === 'photo') {
      const title = ((item.authorName || '航天摄影') + (item.location ? ' · ' + item.location : '')) + ' | 火星探索日志'
      return {
        title,
        path: `/subpackages/news-extra/photo-detail?id=${item.id}`,
        query: `id=${item.id}`,
        // 优先缩略图，避免自定义分享图体积过大
        imageUrl: item.cardImage || item.coverUrl || shareDefault
      }
    }
    if (kind === 'event') {
      return {
        title: (item.title || '即将发生') + ' | 火星探索日志',
        path: `/subpackages/news-extra/detail?id=${item.id}&type=event`,
        query: `id=${item.id}&type=event`,
        imageUrl: item.image || item.cardImage || shareDefault
      }
    }
    if (kind === 'article') {
      return {
        title: (item.title || '航天事件') + ' | 火星探索日志',
        path: `/subpackages/news-extra/detail?id=${item.id}&type=article`,
        query: `id=${item.id}&type=article`,
        imageUrl: item.image || item.cardImage || shareDefault
      }
    }
    return null
  },

  shareEvent(e) {
    if (e && e.stopPropagation) e.stopPropagation()
    const id = e.currentTarget.dataset.id || (e.detail && e.detail.target && e.detail.target.dataset && e.detail.target.dataset.id)
    const ev = this._findNewsItemById(id)
    if (ev) this._rememberShareItem('event', ev)
    return false
  },

  shareArticle(e) {
    if (e && e.stopPropagation) e.stopPropagation()
    const id = e.currentTarget.dataset.id || (e.detail && e.detail.target && e.detail.target.dataset && e.detail.target.dataset.id)
    const article = this._findNewsItemById(id)
    if (article) this._rememberShareItem('article', article)
    return false
  },

  sharePhoto(e) {
    if (e && e.stopPropagation) e.stopPropagation()
    const id = e.currentTarget.dataset.id || (e.detail && e.detail.target && e.detail.target.dataset && e.detail.target.dataset.id)
    const photo = this._findNewsItemById(id)
    if (photo) this._rememberShareItem('photo', photo)
    return false
  },

  onShareAppMessage(e) {
    const shareDefault = this.resolveNewsImage(NEWS_SHARE_DEFAULT_KEY, '')

    // 卡片面层分享按钮：优先读 button dataset（不依赖异步 setData）
    if (e && e.from === 'button' && e.target && e.target.dataset) {
      const ds = e.target.dataset
      const id = ds.id
      const item = this._findNewsItemById(id)
      let kind = ''
      if (this.data.contentType === 'photos') kind = 'photo'
      else if (this.data.contentType === 'events') kind = 'event'
      else if (this.data.contentType === 'articles') kind = 'article'
      // dataset 可显式带 type，避免切 Tab 瞬间错配
      if (ds.type === 'photo' || ds.type === 'event' || ds.type === 'article') kind = ds.type
      const payload = this._resolveSharePayload(kind, item, shareDefault)
      if (payload) {
        this._rememberShareItem(kind, item)
        return { title: payload.title, path: payload.path, imageUrl: payload.imageUrl }
      }
    }

    const pendingKind = this._pendingShareKind
    const pendingItem = this._pendingShareItem
    if (pendingKind && pendingItem) {
      const payload = this._resolveSharePayload(pendingKind, pendingItem, shareDefault)
      if (payload) return { title: payload.title, path: payload.path, imageUrl: payload.imageUrl }
    }

    const photo = this.data.currentSharePhoto
    const photoPayload = this._resolveSharePayload('photo', photo, shareDefault)
    if (photoPayload) {
      return { title: photoPayload.title, path: photoPayload.path, imageUrl: photoPayload.imageUrl }
    }

    const ev = this.data.currentShareEvent
    const evPayload = this._resolveSharePayload('event', ev, shareDefault)
    if (evPayload) {
      return { title: evPayload.title, path: evPayload.path, imageUrl: evPayload.imageUrl }
    }

    const article = this.data.currentShareArticle
    const articlePayload = this._resolveSharePayload('article', article, shareDefault)
    if (articlePayload) {
      return { title: articlePayload.title, path: articlePayload.path, imageUrl: articlePayload.imageUrl }
    }

    return {
      title: '航天事件 - 星链·马斯克太空动态 | 火星探索日志',
      path: '/pages/news/news',
      imageUrl: shareDefault
    }
  },

  onShareTimeline() {
    const shareDefault = this.resolveNewsImage(NEWS_SHARE_DEFAULT_KEY, '')

    const pendingKind = this._pendingShareKind
    const pendingItem = this._pendingShareItem
    if (pendingKind && pendingItem) {
      const payload = this._resolveSharePayload(pendingKind, pendingItem, shareDefault)
      if (payload) return { title: payload.title, query: payload.query, imageUrl: payload.imageUrl }
    }

    const photoPayload = this._resolveSharePayload('photo', this.data.currentSharePhoto, shareDefault)
    if (photoPayload) {
      return { title: photoPayload.title, query: photoPayload.query, imageUrl: photoPayload.imageUrl }
    }

    const evPayload = this._resolveSharePayload('event', this.data.currentShareEvent, shareDefault)
    if (evPayload) {
      return { title: evPayload.title, query: evPayload.query, imageUrl: evPayload.imageUrl }
    }

    const articlePayload = this._resolveSharePayload('article', this.data.currentShareArticle, shareDefault)
    if (articlePayload) {
      return { title: articlePayload.title, query: articlePayload.query, imageUrl: articlePayload.imageUrl }
    }

    return {
      title: '航天事件 - 星链·马斯克太空动态 | 火星探索日志',
      query: '',
      imageUrl: shareDefault
    }
  }
})
