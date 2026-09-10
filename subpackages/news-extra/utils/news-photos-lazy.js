/**
 * subpackages/news-extra/utils/news-photos-lazy.js
 * 新闻页「航天摄影」列表/瀑布流/投稿入口（从 pages/news/news.js 拆出）。
 *
 * 主包 news.js 通过 require.async + attachTo 委托加载；
 * news 页 preloadRule 已预下载 news-extra，首屏几乎无等待。
 *
 * 注意：sharePhoto / onNewsCardSnapshotTap / onShareAppMessage 的 photo 分支
 * 必须留主包（open-type=share 需同步 setData），勿迁入本模块。
 */
const { formatDate } = require('../../../utils/util.js')
const { displayImageUrl } = require('../../../utils/cos-url.js')
const { fetchMainConfig } = require('../../../utils/feature-flags.js')

const ASTRO_PHOTOS_API_PKG = './api-astro-photos.js'
let _astroPhotosApiMod = null
let _astroPhotosApiLoadPromise = null

function loadAstroPhotosApi() {
  if (_astroPhotosApiMod) return Promise.resolve(_astroPhotosApiMod)
  if (!_astroPhotosApiLoadPromise) {
    _astroPhotosApiLoadPromise = require.async(ASTRO_PHOTOS_API_PKG).then((mod) => {
      _astroPhotosApiMod = mod
      return mod
    })
  }
  return _astroPhotosApiLoadPromise
}

const methods = {
  /**
   * 全局开关 enableAstroPhotos（defaultOff + failClosed）
   * @param {{ fromLoad?: boolean }} [opts] fromLoad：onLoad 会统一 boot，此处不 loadNews
   * @returns {Promise<boolean>} 是否展示航天摄影入口
   */
  _refreshPhotosNavFlag(opts) {
    const self = this
    const fromLoad = !!(opts && opts.fromLoad)
    return fetchMainConfig(true)
      .then((cfg) => {
        const show = !!(cfg && cfg._id && cfg.enableAstroPhotos === true)
        const wasPhotos = self.data.contentType === 'photos'
        const patch = { showPhotosNav: show }
        if (!show && wasPhotos) {
          self._newsLoadToken = (self._newsLoadToken || 0) + 1
          patch.contentType = 'articles'
          patch.newsList = []
          patch.photoColLeft = []
          patch.photoColRight = []
          patch.page = 1
          patch.hasMore = true
          patch.loading = false
          patch.showPhotosNavDot = false
        }
        self.setData(patch)
        if (!show && wasPhotos && !fromLoad) {
          self.loadNews(true)
        }
        if (show) {
          if (self.data.contentType === 'photos') {
            self.acknowledgePhotosNavDot(self._photosDotLatestAt)
          } else {
            self._refreshPhotosNavDot()
          }
        } else if (self.data.showPhotosNavDot) {
          self.setData({ showPhotosNavDot: false })
        }
        return show
      })
      .catch(() => {
        const wasPhotos = self.data.contentType === 'photos'
        const patch = { showPhotosNav: false, showPhotosNavDot: false }
        if (wasPhotos) {
          self._newsLoadToken = (self._newsLoadToken || 0) + 1
          patch.contentType = 'articles'
          patch.newsList = []
          patch.photoColLeft = []
          patch.photoColRight = []
          patch.page = 1
          patch.hasMore = true
          patch.loading = false
        }
        self.setData(patch)
        if (wasPhotos && !fromLoad) self.loadNews(true)
        return false
      })
  },

  /** listPublic.enabled===false 时强制藏 Tab（比本地 flag 缓存更及时） */
  _applyPhotosEnabledFromApi(enabled) {
    if (enabled !== false) return false
    if (!this.data.showPhotosNav && this.data.contentType !== 'photos') return true
    this._newsLoadToken = (this._newsLoadToken || 0) + 1
    const wasPhotos = this.data.contentType === 'photos'
    this.setData({
      showPhotosNav: false,
      showPhotosNavDot: false,
      loading: false,
      contentType: wasPhotos ? 'articles' : this.data.contentType,
      newsList: wasPhotos ? [] : this.data.newsList,
      photoColLeft: [],
      photoColRight: [],
      page: wasPhotos ? 1 : this.data.page,
      hasMore: wasPhotos ? true : this.data.hasMore
    })
    if (wasPhotos) this.loadNews(true)
    return true
  },

  /** 仅保留真正的航天摄影条目，避免文章/事件列表串进摄影 Tab */
  _isPhotoListItem(item) {
    if (!item || typeof item !== 'object') return false
    const id = item.id || item._id
    if (!id) return false
    if (item.newsSite) return false
    if (item.type && item.date && !item.authorName) return false
    const cover = item.coverUrl || item.cardImage ||
      (item.photos && item.photos[0] && (item.photos[0].url || item.photos[0].displayUrl))
    return !!(item.authorName && cover)
  },

  /** 作者圆头像：首字母 / 首汉字 */
  _authorAvatarChar(name) {
    const s = String(name || '').trim()
    if (!s) return '?'
    const ch = (Array.from(s)[0] || '?')
    if (/^[a-z]$/i.test(ch)) return ch.toUpperCase()
    return ch
  },

  _photoItemHeight(item) {
    const ratio = Math.max(0.45, Math.min(2.4, Number(item && item.coverAspectRatio) || 1))
    return (1 / ratio) + 0.62
  },

  _buildPhotoColumns(list) {
    const left = []
    const right = []
    let leftH = 0
    let rightH = 0
    for (let i = 0; i < (list || []).length; i++) {
      const item = list[i]
      const h = this._photoItemHeight(item)
      if (leftH <= rightH) {
        left.push(item)
        leftH += h
      } else {
        right.push(item)
        rightH += h
      }
    }
    return { photoColLeft: left, photoColRight: right }
  },

  /** 加载更多：只把新增项追加到较短列，避免前页卡片左右乱跳 */
  _appendPhotoColumns(newItems) {
    const left = (this.data.photoColLeft || []).slice()
    const right = (this.data.photoColRight || []).slice()
    let leftH = 0
    let rightH = 0
    for (let i = 0; i < left.length; i++) leftH += this._photoItemHeight(left[i])
    for (let i = 0; i < right.length; i++) rightH += this._photoItemHeight(right[i])
    for (let i = 0; i < (newItems || []).length; i++) {
      const item = newItems[i]
      const h = this._photoItemHeight(item)
      if (leftH <= rightH) {
        left.push(item)
        leftH += h
      } else {
        right.push(item)
        rightH += h
      }
    }
    return { photoColLeft: left, photoColRight: right }
  },

  _setPhotosViewList(list, extra) {
    const next = list || []
    const prev = this.data.newsList || []
    let cols
    const canAppend = prev.length > 0 &&
      next.length > prev.length &&
      prev.every((p, i) => String((p && (p.id || p._id)) || '') === String((next[i] && (next[i].id || next[i]._id)) || ''))
    if (canAppend) {
      cols = this._appendPhotoColumns(next.slice(prev.length))
    } else {
      cols = this._buildPhotoColumns(next)
    }
    this.setData(Object.assign({
      newsList: next,
      photoColLeft: cols.photoColLeft,
      photoColRight: cols.photoColRight
    }, extra || {}))
  },

  _formatPhotosList(list) {
    return (list || []).filter((item) => this._isPhotoListItem(item)).map((item) => {
      const cover = item.coverUrl || (item.photos && item.photos[0] && item.photos[0].url) || ''
      const ratio = Number(item.coverAspectRatio) || 1
      const count = Number(item.photoCount) > 0
        ? Number(item.photoCount)
        : (Array.isArray(item.photos) ? item.photos.length : 0)
      const authorName = item.authorName || ''
      return {
        ...item,
        id: item.id || item._id,
        authorName,
        authorAvatar: this._authorAvatarChar(authorName),
        coverAspectRatio: Math.max(0.45, Math.min(2.4, ratio)),
        cardImage: cover ? displayImageUrl(cover, 'thumb') : '',
        publishedAtText: (() => {
          if (!item.createdAt) return ''
          const t = formatDate(item.createdAt, 'MM月DD日')
          return (t === '无效日期' || t === '日期未知') ? '' : t
        })(),
        photoCountText: count > 0 ? `${count}` : '',
        _listKind: 'photo'
      }
    })
  },

  /** 滑动列表时收起投稿 FAB，停滑约 320ms 后自动展现 */
  _pulsePhotoFabOnScroll() {
    if (this.data.contentType !== 'photos' || !this.data.showPhotosNav) return
    if (!this.data.photoFabHidden) {
      this.setData({ photoFabHidden: true })
    }
    if (this._photoFabShowTimer) {
      clearTimeout(this._photoFabShowTimer)
      this._photoFabShowTimer = null
    }
    this._photoFabShowTimer = setTimeout(() => {
      this._photoFabShowTimer = null
      if (this.data.contentType === 'photos' && this.data.showPhotosNav && this.data.photoFabHidden) {
        this.setData({ photoFabHidden: false })
      }
    }, 320)
  },

  goPhotoUpload() {
    if (!this.data.showPhotosNav) {
      wx.showToast({ title: '航天摄影暂未开放', icon: 'none' })
      return
    }
    const UPLOAD_PASSWORD = 'zghtzp'
    const openUpload = () => {
      const { ROUTES } = require('../../../utils/routes.js')
      wx.navigateTo({ url: ROUTES.PHOTO_UPLOAD || '/subpackages/news-extra/photo-upload' })
    }
    wx.showModal({
      title: '投稿密码',
      editable: true,
      placeholderText: '请输入投稿密码',
      confirmText: '确认',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        const pwd = String(res.content || '').trim()
        if (!pwd) {
          wx.showToast({ title: '请输入投稿密码', icon: 'none' })
          return
        }
        if (pwd !== UPLOAD_PASSWORD) {
          wx.showToast({ title: '投稿密码错误', icon: 'none' })
          return
        }
        try {
          const app = getApp()
          if (app) {
            app._astroPhotoUploadGate = { password: pwd, at: Date.now() }
          }
        } catch (e) {}
        openUpload()
      }
    })
  }
}

module.exports = {
  methods,
  loadAstroPhotosApi,
  attachTo(page) {
    Object.keys(methods).forEach((k) => {
      page[k] = methods[k].bind(page)
    })
    page.__newsPhotosAttached = true
  }
}
