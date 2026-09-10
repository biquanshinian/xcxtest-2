/**
 * subpackages/news-extra/utils/news-lazy.js
 * 新闻页低频非首屏逻辑（从 pages/news/news.js 拆出）：
 * - 「航天事件」/「航天摄影」导航红点检测
 * - 二维码悬浮入口拖拽/贴边 + 二维码弹窗图片交互
 *
 * 主包 news.js 通过 require.async + attachTo 委托加载，
 * 与 profile-lazy / progress-lazy 模式一致；news 页在 preloadRule
 * 中预下载 news-extra 分包，实际几乎无加载等待。
 *
 * 注意：分享按钮（shareEvent/shareArticle，open-type=share 需同步 setData）
 * 与卡片快照暂存（onNewsCardSnapshotTap，需在 navigator 跳转前同步写入）
 * 必须保留在主包，勿迁入本模块。
 */
const storageCache = require('../../../utils/storage-sync-cache.js')
const { fetchMainConfig } = require('../../../utils/feature-flags.js')

const ARTICLES_NAV_ACK_KEY = '_articles_nav_ack_manual_updated_at'
const PHOTOS_NAV_ACK_KEY = '_photos_nav_ack_latest_at'

const methods = {
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

  /**
   * 顶部「航天摄影」红点：有新投稿上墙（astroPhotosLatestAt > 本地 ack）时显示
   * @param {number} [hintLatestAt] listPublic 返回的 latestAt，可跳过再读配置
   */
  _refreshPhotosNavDot(hintLatestAt) {
    if (!this.data.showPhotosNav) {
      if (this.data.showPhotosNavDot) this.setData({ showPhotosNavDot: false })
      return
    }
    // 已在摄影 Tab：视作已读，只同步水位，禁止点亮
    if (this.data.contentType === 'photos') {
      this.acknowledgePhotosNavDot(hintLatestAt)
      return
    }
    const apply = (latest) => {
      // 异步回来时若已切进摄影 Tab，勿再点亮
      if (this.data.contentType === 'photos') {
        this.acknowledgePhotosNavDot(latest)
        return
      }
      if (!this.data.showPhotosNav) {
        if (this.data.showPhotosNavDot) this.setData({ showPhotosNavDot: false })
        return
      }
      const L = Number(latest) || 0
      if (!L) {
        // 读失败/无水位：保留现有红点状态，勿强行灭灯
        return
      }
      let ack = 0
      try {
        ack = Number(storageCache.readSync(PHOTOS_NAV_ACK_KEY, 0)) || 0
      } catch (_) {}
      const show = L > ack
      if (show !== this.data.showPhotosNavDot) this.setData({ showPhotosNavDot: show })
    }
    const hinted = Number(hintLatestAt) || 0
    if (hinted > 0) {
      const merged = Math.max(Number(this._photosDotLatestAt) || 0, hinted)
      this._photosDotLatestAt = merged
      this._photosDotFetchedAt = Date.now()
      apply(merged)
      return
    }
    // 60s 内复用；超时强制刷 global_config，避免 5min feature-flags TTL 导致红点迟迟不亮
    const fresh = this._photosDotFetchedAt && (Date.now() - this._photosDotFetchedAt < 60 * 1000)
    if (fresh && this._photosDotLatestAt != null) {
      apply(this._photosDotLatestAt)
      return
    }
    fetchMainConfig(true)
      .then((cfg) => {
        const L = Number(cfg && cfg.astroPhotosLatestAt) || 0
        const merged = Math.max(Number(this._photosDotLatestAt) || 0, L)
        this._photosDotLatestAt = merged
        this._photosDotFetchedAt = Date.now()
        apply(merged)
      })
      .catch(() => {
        // 网络失败：保留现态，仅用内存水位尝试
        if (this._photosDotLatestAt) apply(this._photosDotLatestAt)
      })
  },

  /**
   * 进入「航天摄影」后清除红点
   * @param {number|Function} [hintOrDone] listPublic.latestAt，或完成回调
   * @param {Function} [done]
   */
  acknowledgePhotosNavDot(hintOrDone, done) {
    let hintLatestAt = 0
    let cb = done
    if (typeof hintOrDone === 'function') {
      cb = hintOrDone
    } else {
      hintLatestAt = Number(hintOrDone) || 0
    }
    const finish = (latest) => {
      const L = Math.max(
        Number(latest) || 0,
        hintLatestAt,
        Number(this._photosDotLatestAt) || 0
      )
      if (L > 0) {
        try { storageCache.persistAsync(PHOTOS_NAV_ACK_KEY, L) } catch (_) {}
        this._photosDotLatestAt = L
        this._photosDotFetchedAt = Date.now()
      }
      if (this.data.showPhotosNavDot) this.setData({ showPhotosNavDot: false })
      cb && cb()
    }
    // 有 hint 或内存水位时直接落盘 ack，避免短进短出 + 静默 60s 跳过导致红点回燃
    const mem = Number(this._photosDotLatestAt) || 0
    if (hintLatestAt > 0 || mem > 0) {
      finish(Math.max(hintLatestAt, mem))
      return
    }
    fetchMainConfig(true)
      .then((cfg) => finish(cfg && cfg.astroPhotosLatestAt))
      .catch(() => finish(0))
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

  onQRCodeImageTap() {
    const qrUrl = this.data.qrcodeImage || this.getNewsQrImageUrl()
    wx.previewImage({
      urls: [qrUrl],
      current: qrUrl
    })
  },

  onQRCodeImageError() {
    if (this.data.qrcodeImage === this.NEWS_QR_IMAGE_FALLBACK_URL) return
    this.setData({ qrcodeImage: this.NEWS_QR_IMAGE_FALLBACK_URL })
  }
}

module.exports = {
  methods,
  /** 把全部方法挂到页面实例上（委托加载后调用） */
  attachTo(page) {
    Object.keys(methods).forEach((k) => {
      page[k] = methods[k].bind(page)
    })
    page.__newsLazyAttached = true
  }
}
