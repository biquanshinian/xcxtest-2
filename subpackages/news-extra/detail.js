const { getArticleDetail, getEventDetail } = require('./utils/api-news.js')
const { formatDate } = require('../../utils/util.js')
const { loadCloudMediaMap, resolveMediaUrl } = require('../../utils/image-config.js')
const { isPermissionDenied, getPermissionDeniedMessage } = require('../../utils/single-page.js')
const pageBase = require('../../utils/page-base.js')
const { resolveNewsDetailRoute } = require('./utils/page-route-options.js')
const { applyPageSearchInfo, buildNewsDetailSearchMeta } = require('./utils/page-search-info.js')
const { optimizeNewsHeroUrl } = require('../../utils/news-thumb-url.js')
const { togglePageTranslation } = require('../../utils/text-translate.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { workerProxyUrl } = require('../../utils/config.js')

const NEWS_SHARE_DEFAULT_KEY = 'images/share/default.jpg'

/** 国内可直连的自有域名（COS/云存储/自有 Worker），无需走图片代理 */
const DOMESTIC_IMAGE_HOST = /myqcloud\.com|tcb\.qcloud\.la|tcloudbaseapp\.com|marsx\.com\.cn/i

/**
 * 外链图片 → Cloudflare Worker 图片代理（GET /image?url=...，24h 边缘缓存）。
 * SNAPI 文章图（WP 系站点/Photon）与 LL2 事件图（DigitalOcean Spaces）国内直连大概率失败，
 * 与飞船图鉴 proxiedImageUrl 同一条代理链路。
 */
function proxiedNewsImageUrl(url) {
  const s = String(url || '').trim()
  if (!s || !/^https?:\/\//i.test(s)) return ''
  if (DOMESTIC_IMAGE_HOST.test(s)) return ''
  const base = String(workerProxyUrl || '').trim().replace(/\/$/, '')
  if (!base) return ''
  return base + '/image?url=' + encodeURIComponent(s)
}

/** 头图加载候选链：Worker 代理 → Photon 优化图 → 原图（binderror 逐级回退） */
function buildHeroCandidates(rawUrl) {
  const raw = String(rawUrl || '').trim()
  if (!raw) return []
  // 非 http(s)（cloud:// fileID 等）直接原样展示
  if (!/^https?:\/\//i.test(raw)) return [raw]
  const list = []
  const proxied = proxiedNewsImageUrl(raw)
  if (proxied) list.push(proxied)
  const photon = optimizeNewsHeroUrl(raw)
  if (photon && photon !== raw && list.indexOf(photon) < 0) list.push(photon)
  if (list.indexOf(raw) < 0) list.push(raw)
  return list
}

function resolveDetailMediaSrc(val) {
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

function manualArticleUsesRichContent(content) {
  if (!content || typeof content !== 'string') return false
  return /<[a-z][\s\S]*>/i.test(content.trim())
}

/** 将正文 HTML 内 img 的 COS key / 相对路径转为可加载 URL（富文本展示） */
function resolveManualArticleContentHtml(html, resolver) {
  if (!html || typeof html !== 'string') return ''
  const fn = resolver || resolveMediaUrl
  return html.replace(/\ssrc\s*=\s*["']([^"']+)["']/gi, (match, src) => {
    const raw = String(src || '').trim()
    if (!raw) return match
    const out = /^https?:\/\//i.test(raw) ? raw : (fn(raw, '') || raw)
    return ` src="${out}"`
  })
}

function normalizeArticle(article) {
  if (!article) return null
  const idStr = article.id != null ? String(article.id) : ''
  const isManualArticle = article.isManual === true || idStr.startsWith('manual_')
  const images = Array.isArray(article.images) ? article.images.map((u) => String(u || '').trim()).filter(Boolean) : []

  let heroImageUrl = ''
  if (images.length) heroImageUrl = resolveDetailMediaSrc(images[0])
  if (!heroImageUrl && article.image) heroImageUrl = resolveDetailMediaSrc(article.image)
  if (!heroImageUrl && article.content) {
    const first = extractFirstImgSrcFromHtml(article.content)
    if (first) heroImageUrl = resolveDetailMediaSrc(first)
  }
  // 外链图国内直连大概率失败：候选链 Worker 代理 → Photon 优化图 → 原图，binderror 逐级回退
  const heroImageRawUrl = heroImageUrl
  const heroCandidates = buildHeroCandidates(heroImageUrl)
  heroImageUrl = heroCandidates[0] || ''

  const contentRich = !!(isManualArticle && manualArticleUsesRichContent(article.content || ''))
  let contentRichHtml = contentRich
    ? resolveManualArticleContentHtml(article.content || '', resolveMediaUrl)
    : ''
  if (contentRichHtml && heroImageUrl) {
    contentRichHtml = contentRichHtml.replace(/^\s*<p[^>]*>\s*<img[^>]+>\s*<\/p>\s*/i, '')
  }

  return {
    ...article,
    isManualArticle,
    formattedTime: formatDate(article.publishedAt, 'MM月DD日 HH:mm'),
    formattedDate: formatDate(article.publishedAt, 'YYYY年MM月DD日 HH:mm'),
    heroImageUrl,
    heroImageRawUrl,
    heroCandidates,
    contentRich,
    contentRichHtml
  }
}

function normalizeEvent(event) {
  if (!event) return null
  const heroCandidates = buildHeroCandidates(event.image)
  return {
    ...event,
    heroImageRawUrl: event.image || '',
    heroCandidates,
    image: heroCandidates[0] || event.image || '',
    formattedTime: formatDate(event.date, 'MM月DD日 HH:mm'),
    formattedDate: formatDate(event.date, 'YYYY年MM月DD日 HH:mm')
  }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/news/news',

  data: {
    detailType: 'event',
    loading: true,
    errorMessage: '',
    item: null,
    shareImage: '',
    shareTitle: '航天事件详情 | 火星探索日志',
    navTitle: '航天事件详情',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,
    descTranslated: false,
    descTranslating: false,
    descI18n: { title: '', summary: '', content: '', eventDesc: '' }
  },

  /** 标题/摘要/正文/事件描述「翻译/原文」：预翻译字段秒切，其余走云端 */
  onToggleDescTranslate() {
    if (this.data.descTranslating) return
    const item = this.data.item || {}
    const fields = [
      { path: 'descI18n.title', text: item.title || '', zh: item.titleZh || '' }
    ]
    if (this.data.detailType === 'article') {
      if (item.summary) fields.push({ path: 'descI18n.summary', text: item.summary, zh: item.summaryZh || '' })
      // 富文本正文（HTML）不送翻，纯文本正文才翻译
      if (!item.contentRich && item.content && !item.isManualArticle) {
        fields.push({ path: 'descI18n.content', text: item.content })
      }
    } else if (item.description) {
      fields.push({ path: 'descI18n.eventDesc', text: item.description, zh: item.descriptionZh || '' })
    }
    togglePageTranslation(this, {
      switchKey: 'descTranslated',
      loadingKey: 'descTranslating',
      fields
    })
  },

  async onLoad(options) {
    const route = resolveNewsDetailRoute(options)
    this._entryRoute = route
    const { detailType, id } = route

    this.initUiShell()
    await loadCloudMediaMap()

    const shareImage = this.resolveShareImage('')
    this.setData({
      detailType,
      shareImage,
      navTitle: detailType === 'article' ? '文章详情' : '事件详情'
    })

    if (!id) {
      this.setData({
        loading: false,
        errorMessage: '缺少内容参数，请返回列表重新进入'
      })
      return
    }

    await this.loadDetail(detailType, id)
  },

  resolveShareImage(image) {
    return image || resolveMediaUrl(NEWS_SHARE_DEFAULT_KEY, '')
  },

  async loadDetail(detailType, id, opts = {}) {
    // silent（下拉刷新）：已有内容时不回退到加载骨架，只显示微信原生刷新指示器
    if (!(opts.silent && this.data.item)) {
      this.setData({ loading: true, errorMessage: '' })
    }

    try {
      const item = detailType === 'article'
        ? normalizeArticle(await getArticleDetail(id))
        : normalizeEvent(await getEventDetail(id))

      const shareTitle = `${item.title || (detailType === 'article' ? '航天事件' : '即将发生')} | 火星探索日志`
      const shareImage = this.resolveShareImage(detailType === 'article' ? (item.heroImageUrl || item.image) : item.image)

      this.setData({
        loading: false,
        item,
        shareTitle,
        shareImage,
        navTitle: detailType === 'article' ? '文章详情' : '事件详情'
      })

      const searchMeta = buildNewsDetailSearchMeta(item, detailType, shareImage)
      if (searchMeta) applyPageSearchInfo(searchMeta)

      // 记录新闻阅读（成就统计）
      try {
        const { trackNewsRead } = require('../../utils/behavior-stats.js')
        trackNewsRead(id)
      } catch (ex) {}
    } catch (error) {
      const msg = isPermissionDenied(error)
        ? getPermissionDeniedMessage()
        : (error && (error.errMsg || error.message)) || '内容加载失败，请稍后重试'
      this.setData({
        loading: false,
        errorMessage: msg
      })
    }
  },

  retryLoad() {
    const current = this.data.item
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1]
    const route = this._entryRoute || resolveNewsDetailRoute((currentPage && currentPage.options) || {})
    const detailType = route.detailType
    const id = route.id || (current && current.id ? String(current.id) : '')
    if (!id) return
    this.loadDetail(detailType, id)
  },

  /** 页面级原生下拉刷新（全局统一）：重拉当前文章/事件详情 */
  onPullDownRefresh() {
    const current = this.data.item
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1]
    const route = this._entryRoute || resolveNewsDetailRoute((currentPage && currentPage.options) || {})
    const detailType = route.detailType
    const id = route.id || (current && current.id ? String(current.id) : '')
    runPullRefresh(this, () => {
      if (!id) return Promise.resolve()
      return this.loadDetail(detailType, id, { silent: true })
    })
  },

  // goBack inherited from pageBase with _fallbackTab

  copyUrl(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const data = String(url)
    const doCopy = function () {
      wx.setClipboardData({
        data: data,
        success: function () { wx.showToast({ title: '链接已复制', icon: 'success' }) },
        fail: function () { wx.showModal({ title: '链接', content: data, showCancel: false }) }
      })
    }
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({ success: doCopy, fail: doCopy })
    } else {
      doCopy()
    }
  },

  /**
   * 云库手写稿原文链接：优先在微信内打开公众号文章；其它 https 走 web-view；失败或非 https 则复制。
   * openOfficialAccountArticle 需较新基础库；不可用或非公众号链时由 web-view/复制兜底。
   */
  openManualOriginalUrl(e) {
    let url = e.currentTarget.dataset.url
    if (url == null || url === '') return
    url = String(url).trim()
    if (!url) return
    if (/^http:\/\/mp\.weixin\.qq\.com/i.test(url)) {
      url = 'https://' + url.replace(/^https?:\/\//i, '')
    }

    const isMpArticle = /^https:\/\/mp\.weixin\.qq\.com\//i.test(url)
    const synthetic = { currentTarget: { dataset: { url } } }
    const fallbackCopy = () => this.copyUrl(synthetic)

    if (isMpArticle) {
      if (typeof wx.openOfficialAccountArticle === 'function') {
        wx.openOfficialAccountArticle({
          url,
          fail: function () { fallbackCopy() }
        })
      } else {
        wx.navigateTo({
          url: '/pages/webview/webview?url=' + encodeURIComponent(url),
          fail: function () { fallbackCopy() }
        })
      }
      return
    }

    if (/^https:\/\//i.test(url)) {
      wx.navigateTo({
        url: '/pages/webview/webview?url=' + encodeURIComponent(url),
        fail: function () { fallbackCopy() }
      })
      return
    }

    fallbackCopy()
  },

  onHeroImageError() {
    const item = this.data.item
    if (!item) return
    // 沿候选链逐级回退（代理 → Photon 优化图 → 原图），全部失败才隐藏头图
    const isArticle = this.data.detailType === 'article'
    const field = isArticle ? 'heroImageUrl' : 'image'
    const candidates = item.heroCandidates || []
    const idx = candidates.indexOf(item[field])
    const next = idx >= 0 ? candidates[idx + 1] : ''
    this.setData({ ['item.' + field]: next || '' })
  },

  /** 头图点击：全屏预览（预览界面长按可保存/转发），文章优先用当前可加载的这张 */
  onHeroPreview() {
    const item = this.data.item
    if (!item) return
    const url = this.data.detailType === 'article'
      ? (item.heroImageUrl || item.heroImageRawUrl)
      : item.image
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  onShareAppMessage() {

    const item = this.data.item
    const detailType = this.data.detailType
    if (!item) {
      return {
        title: '航天事件详情 | 火星探索日志',
        path: '/pages/news/news',
        imageUrl: this.data.shareImage
      }
    }

    return {
      title: this.data.shareTitle,
      path: `/subpackages/news-extra/detail?id=${item.id}&type=${detailType}`,
      imageUrl: this.data.shareImage
    }
  },

  onShareTimeline() {
    const item = this.data.item
    return {
      title: this.data.shareTitle,
      query: item ? `id=${item.id}&type=${this.data.detailType}` : '',
      imageUrl: this.data.shareImage
    }
  }
})
