const pageBase = require('../../utils/page-base.js')
const { getPhotoDetail, deleteMinePhoto } = require('./utils/api-astro-photos.js')
const UPLOAD_PASSWORD = 'zghtzp'
const { displayImageUrl } = require('../../utils/cos-url.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { resolveMediaUrl } = require('../../utils/image-config.js')
const storageCache = require('../../utils/storage-sync-cache.js')

const NEWS_SHARE_DEFAULT_KEY = 'images/share/default.jpg'
const PHOTOS_CACHE_KEY = 'news_cache_photos_v2'
const PHOTOS_CACHE_KEYS_LEGACY = ['news_cache_photos_v1']

/** 去掉 imageMogr2 等处理参数，保证大图预览走原图 */
function toOriginalPhotoUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  const base = raw.split('?')[0]
  return displayImageUrl(base, 'full') || base
}

/** 轮播区高度：按封面比例，钳制在竖图/横图合理区间（贴合小红书看图框） */
function resolveGalleryHeightRpx(doc, photos) {
  let ratio = Number(doc && doc.coverAspectRatio) || 0
  if (!(ratio > 0) && photos && photos[0]) {
    const w = Number(photos[0].width) || 0
    const h = Number(photos[0].height) || 0
    if (w > 0 && h > 0) ratio = w / h
  }
  if (!(ratio > 0)) ratio = 1
  // width/height：竖图更矮上限、横图更矮下限
  const clamped = Math.max(0.56, Math.min(1.35, ratio))
  // 卡片左右各 28rpx + 页面容器 32rpx，轮播贴卡片边后可视宽 ≈ 750 - 64
  const contentW = 750 - 64
  return Math.round(contentW / clamped)
}

function normalizePhoto(doc) {
  if (!doc) return null
  let photos = (Array.isArray(doc.photos) ? doc.photos : []).map((p) => {
    const url = (p && p.url) || ''
    return Object.assign({}, p, {
      // 详情页内联预览用压缩图；点开大图用 originalUrl
      displayUrl: url ? displayImageUrl(url, 'medium') : '',
      originalUrl: toOriginalPhotoUrl(url),
      url
    })
  })
  // 列表瘦字段快照可能只有 coverUrl：先垫一张封面，避免 swiper 空白闪屏
  const coverHint = String(doc.coverUrl || '').trim()
  if (!photos.length && coverHint) {
    photos = [{
      url: coverHint,
      displayUrl: displayImageUrl(coverHint, 'medium') || coverHint,
      originalUrl: toOriginalPhotoUrl(coverHint)
    }]
  }
  const editCount = Math.max(0, Number(doc.editCount) || 0)
  const isOwner = !!doc.isOwner
  const coverRaw = doc.coverUrl || (photos[0] && photos[0].url) || ''
  const countHint = Math.max(photos.length, Number(doc.photoCount) || 0)
  return Object.assign({}, doc, {
    id: doc.id || doc._id,
    photos,
    photoCount: countHint,
    coverUrl: coverRaw,
    // 分享卡片用缩略图，避免带原图体积
    coverThumb: coverRaw ? displayImageUrl(coverRaw, 'thumb') : '',
    deviceModel: doc.deviceModel || '',
    editCount,
    isOwner,
    canEdit: doc.canEdit === true || (isOwner && editCount < 1),
    galleryHeightRpx: resolveGalleryHeightRpx(doc, photos)
  })
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/news/news',

  data: {
    loading: true,
    errorMessage: '',
    item: null,
    shareImage: '',
    shareTitle: '航天摄影 | 火星探索日志',
    navTitle: '航天摄影',
    scrollRefreshing: false,
    deleting: false,
    photoCurrent: 0,
    photoTotal: 0,
    galleryHeightRpx: 686
  },

  onLoad(options) {
    this.initUiShell()
    const id = String((options && options.id) || '').trim()
    this._photoId = id
    if (!id) {
      this.setData({
        loading: false,
        errorMessage: '缺少内容参数，请返回列表重新进入'
      })
      return
    }
    this.loadDetail(id)
  },

  onShow() {
    if (typeof this.syncTheme === 'function') this.syncTheme()
    // 从编辑页返回后刷新，更新 canEdit / 图文
    if (this._photoId && this._detailShownOnce) {
      this.loadDetail(this._photoId, { silent: true })
    }
    this._detailShownOnce = true
  },

  _takeSnapshot(id) {
    try {
      const app = getApp()
      const snap = app && app._newsDetailSnapshot
      if (!snap) return null
      app._newsDetailSnapshot = null
      if (String(snap.id) !== String(id) || snap.type !== 'photo') return null
      if (Date.now() - (snap.at || 0) > 30 * 1000) return null
      return snap.item
    } catch (e) {}
    return null
  },

  async loadDetail(id, opts = {}) {
    if (!this.data.item && !opts.silent) {
      const snap = this._takeSnapshot(id)
      if (snap) {
        const snapItem = normalizePhoto(snap)
        if (snapItem) {
          this.setData({
            loading: false,
            item: snapItem,
            photoCurrent: 0,
            // 快照阶段可能只有封面垫图：页码跟实际 swiper 张数走，避免虚高 1/3
            photoTotal: (snapItem.photos || []).length,
            galleryHeightRpx: snapItem.galleryHeightRpx || 686,
            shareTitle: `${snapItem.authorName || '航天摄影'} | 火星探索日志`,
            shareImage: snapItem.coverThumb || snapItem.coverUrl || ''
          })
          opts = Object.assign({}, opts, { silent: true })
        }
      }
    }

    if (!(opts.silent && this.data.item)) {
      this.setData({ loading: true, errorMessage: '' })
    }

    try {
      const item = normalizePhoto(await getPhotoDetail(id))
      const total = (item && item.photos && item.photos.length) || 0
      const keepIndex = opts.silent
        ? Math.min(this.data.photoCurrent || 0, Math.max(0, total - 1))
        : 0
      this.setData({
        loading: false,
        errorMessage: '',
        item,
        photoCurrent: keepIndex,
        photoTotal: total,
        galleryHeightRpx: (item && item.galleryHeightRpx) || 686,
        shareTitle: `${(item && item.authorName) || '航天摄影'} | 火星探索日志`,
        shareImage: (item && (item.coverThumb || item.coverUrl)) || ''
      })
    } catch (error) {
      const msg = (error && (error.message || error.errMsg)) || '内容加载失败，请稍后重试'
      // 静默刷新 / 已有快照时不要用错误态盖住内容
      if (opts.silent && this.data.item) {
        this.setData({ loading: false })
        wx.showToast({ title: msg, icon: 'none' })
        return
      }
      this.setData({
        loading: false,
        errorMessage: msg
      })
    }
  },

  retryLoad() {
    if (!this._photoId) return
    this.loadDetail(this._photoId)
  },

  onScrollRefresh() {
    runPullRefresh(this, () => {
      if (!this._photoId) return Promise.resolve()
      return this.loadDetail(this._photoId, { silent: true })
    }, 'scrollRefreshing')
  },

  onPhotoSwiperChange(e) {
    const current = Number(e && e.detail && e.detail.current) || 0
    if (current === this.data.photoCurrent) return
    this.setData({ photoCurrent: current })
  },

  onPhotoPreview(e) {
    const item = this.data.item
    if (!item || !Array.isArray(item.photos) || !item.photos.length) return
    const fromTap = Number(e && e.currentTarget && e.currentTarget.dataset.index)
    const index = !isNaN(fromTap) ? fromTap : (this.data.photoCurrent || 0)
    // 大图预览强制原图，不用页面内联的压缩 displayUrl
    const urls = item.photos.map((p) => p.originalUrl || p.url).filter(Boolean)
    if (!urls.length) return
    wx.previewImage({
      current: urls[Math.max(0, Math.min(index, urls.length - 1))],
      urls,
      showmenu: true
    })
  },

  onEditMine() {
    const item = this.data.item
    if (!item || !item.canEdit) {
      wx.showToast({ title: '仅可重新编辑一次', icon: 'none' })
      return
    }
    const id = item.id || this._photoId
    if (!id) return

    wx.showModal({
      title: '重新编辑',
      content: '每条投稿仅可编辑一次，请确认后再改',
      editable: true,
      placeholderText: '请输入投稿密码',
      confirmText: '去编辑',
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
            app._astroPhotoUploadGate = {
              password: pwd,
              editId: id,
              item,
              at: Date.now()
            }
          }
        } catch (e) {}
        wx.navigateTo({
          url: `/subpackages/news-extra/photo-upload?id=${encodeURIComponent(id)}`
        })
      }
    })
  },

  onDeleteMine() {
    const item = this.data.item
    if (!item || !item.isOwner || this.data.deleting) return
    const id = item.id || this._photoId
    if (!id) return

    wx.showModal({
      title: '删除投稿',
      content: '删除后不可恢复，云端图片将一并清除',
      confirmText: '删除',
      confirmColor: '#FF3B30',
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ deleting: true })
        wx.showLoading({ title: '删除中…', mask: true })
        try {
          await deleteMinePhoto(id)
          try {
            ;[PHOTOS_CACHE_KEY].concat(PHOTOS_CACHE_KEYS_LEGACY).forEach((key) => {
              storageCache.invalidate(key)
              wx.removeStorage({ key, fail() {} })
            })
          } catch (e) {}
          try {
            const app = getApp()
            if (app) app._astroPhotosNeedRefresh = Date.now()
          } catch (e) {}
          wx.hideLoading()
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => this.goBack(), 700)
        } catch (e) {
          wx.hideLoading()
          this.setData({ deleting: false })
          wx.showToast({
            title: String((e && (e.message || e.errMsg)) || '删除失败').slice(0, 40),
            icon: 'none'
          })
        }
      }
    })
  },

  onShareAppMessage() {
    const item = this.data.item || {}
    const shareDefault = resolveMediaUrl(NEWS_SHARE_DEFAULT_KEY, '')
    return {
      title: this.data.shareTitle || '航天摄影 | 火星探索日志',
      path: `/subpackages/news-extra/photo-detail?id=${item.id || this._photoId || ''}`,
      imageUrl: item.coverThumb || this.data.shareImage || item.coverUrl || shareDefault
    }
  },

  onShareTimeline() {
    const item = this.data.item || {}
    const shareDefault = resolveMediaUrl(NEWS_SHARE_DEFAULT_KEY, '')
    return {
      title: this.data.shareTitle || '航天摄影 | 火星探索日志',
      query: `id=${item.id || this._photoId || ''}`,
      imageUrl: item.coverThumb || this.data.shareImage || item.coverUrl || shareDefault
    }
  }
})
