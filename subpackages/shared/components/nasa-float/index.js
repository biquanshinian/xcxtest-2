const { getUiShellLayout } = require('../../../../utils/layout.js')
const { ROUTES, navigateTo } = require('../../../../utils/routes.js')
const { getSystemInfo } = require('../../../../utils/system.js')
const { fetchAIChatEnabled, isAIChatEnabledSync } = require('../../utils/aiService.js')
const { isFeatureEnabled } = require('../../../../utils/feature-flags.js')
const storageCache = require('../../../../utils/storage-sync-cache.js')

const VISIT_KEY = '_float_visit_'
const LUNAR_COUNT_KEY = '_float_lunar_count'
const LUNAR_CACHE_KEY = '_float_lunar_cache'
const LUNAR_CACHE_TTL = 30 * 60 * 1000

// invert: 纯白单色 SVG，浅色主题下经 --icon-invert 反色为深色（NASA 彩色 logo 不反色）
const BASE_MENU_ITEMS = [
  { key: 'nasa', label: 'NASA数据', icon: '', image: '/images/icons/nasa-logo.png' },
  { key: 'lunar', label: '月愿计划', icon: '', image: '/images/icons/moon-crescent.svg', invert: true },
  { key: 'astro', label: '天文日历', icon: '', image: '/images/icons/ic-telescope.svg', invert: true },
  { key: 'exoplanet', label: '系外行星', icon: '', image: '/images/icons/ic-exoplanet.svg', invert: true }
]

const AI_MENU_ITEM = { key: 'aichat', label: '星问AI', icon: '✦', image: '' }

function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/** 按功能开关拼菜单：月愿 / 星问均可隐藏 */
function buildMenuList(opts) {
  const aiEnabled = !!(opts && opts.aiEnabled)
  const showAiChat = !!(opts && opts.showAiChat)
  const lunarEnabled = opts && opts.lunarEnabled !== false
  const items = BASE_MENU_ITEMS.filter((it) => it.key !== 'lunar' || lunarEnabled)
  if (aiEnabled && showAiChat) items.push(AI_MENU_ITEM)
  return items
}

Component({
  options: { addGlobalClass: true },

  properties: {
    badgeCount: { type: Number, value: 0 },
    show: { type: Boolean, value: true },
    /** 当前页是否挂载 ai-chat 面板（收藏页等无星问的页面传 false） */
    showAiChat: { type: Boolean, value: true }
  },

  observers: {
    show(val) {
      const visible = !!val
      // show 关掉时清掉滑动隐藏态，避免再显示时卡在 translateX 隐藏
      if (!visible) {
        if (this._scrollShowTimer) {
          clearTimeout(this._scrollShowTimer)
          this._scrollShowTimer = null
        }
        this.setData({ visible: false, scrollHidden: false })
        return
      }
      const patch = { visible: true }
      if (this.data.scrollHidden) patch.scrollHidden = false
      this.setData(patch)
    }
  },

  data: {
    visible: false,
    expanded: false,
    showDot: false,
    dotMap: {},
    btnX: 0,
    btnY: 0,
    windowWidth: 0,
    windowHeight: 0,
    btnSize: 48,
    safeLeft: 20,
    safeTop: 0,
    safeBottom: 0,
    menuMaxHeight: 400,
    particles: [],
    menuItems: BASE_MENU_ITEMS,
    // 与新闻页投稿 FAB 一致：滑动收起，停滑后自动展现
    scrollHidden: false,
    scrollHideSide: 'right'
  },

  lifetimes: {
    attached() {
      const self = this
      setTimeout(() => {
        try {
          const app = getApp && getApp()
          const layout =
            (app && app.getUiShellLayout && app.getUiShellLayout()) || getUiShellLayout(getSystemInfo())
          const sys = getSystemInfo()
          const ratio = sys.windowWidth / 750
          const btnSize = Math.round(96 * ratio)
          const safeTop = layout.navPlaceholderHeight
          const safeBottom = layout.tabBarReservedHeight
          const btnX = sys.windowWidth - btnSize - 12
          const btnY = Math.round(sys.windowHeight * 0.65)
          const menuMaxHeight = Math.max(200, btnY - safeTop - 24)

          self.setData({
            visible: self.properties.show,
            windowWidth: sys.windowWidth,
            windowHeight: sys.windowHeight,
            btnSize,
            safeTop,
            safeBottom,
            btnX,
            btnY,
            menuMaxHeight,
            // 月愿默认隐藏，等配置确认开启后再显示，避免首帧闪出入口
            menuItems: buildMenuList({
              aiEnabled: true,
              showAiChat: self.properties.showAiChat,
              lunarEnabled: false
            })
          })
          self._lunarEnabled = false
          self._emitPositionChange()

          self._refreshMenuFlags()

          setTimeout(() => {
            try {
              self._refreshMenuFlags({ syncAi: true })
              self._checkAllDots()
            } catch (_) {}
          }, 50)
        } catch (_) {}
      }, 0)
    },

    detached() {
      // 组件销毁后粒子定时器/异步回调不再 setData
      this._detached = true
      if (this._scrollShowTimer) {
        clearTimeout(this._scrollShowTimer)
        this._scrollShowTimer = null
      }
    }
  },

  methods: {
    /**
     * 页面 scroll-view 滚动时调用：收起悬浮钮，停滑约 320ms 后自动展现
     * （对齐新闻页投稿 FAB `_pulsePhotoFabOnScroll`）
     */
    pulseScrollHide() {
      if (this._detached || !this.data.visible || !this.data.windowWidth) return
      // 菜单展开或正在拖拽时不抢手势
      if (this.data.expanded || this._isDragging) return

      const onRight = (this.data.btnX + this.data.btnSize / 2) >= (this.data.windowWidth / 2)
      if (!this.data.scrollHidden) {
        this.setData({
          scrollHidden: true,
          scrollHideSide: onRight ? 'right' : 'left'
        })
      } else if (
        (onRight && this.data.scrollHideSide !== 'right') ||
        (!onRight && this.data.scrollHideSide !== 'left')
      ) {
        this.setData({ scrollHideSide: onRight ? 'right' : 'left' })
      }

      if (this._scrollShowTimer) {
        clearTimeout(this._scrollShowTimer)
        this._scrollShowTimer = null
      }
      this._scrollShowTimer = setTimeout(() => {
        this._scrollShowTimer = null
        if (this._detached) return
        if (this.data.scrollHidden && this.data.visible) {
          this.setData({ scrollHidden: false })
        }
      }, 320)
    },

    getFloatPosition() {
      const d = this.data
      return {
        btnX: d.btnX,
        btnY: d.btnY,
        btnSize: d.btnSize,
        windowWidth: d.windowWidth,
        windowHeight: d.windowHeight
      }
    },

    _emitPositionChange() {
      const d = this.data
      if (!d.windowWidth) return
      this.triggerEvent('positionchange', {
        btnX: d.btnX,
        btnY: d.btnY,
        btnSize: d.btnSize
      })
    },

    _menuListSig(items) {
      if (!Array.isArray(items) || !items.length) return ''
      return items.map((it) => (it && it.key) || '').join(',')
    },

    /** 按星问 / 月愿功能开关刷新圆盘菜单 */
    _refreshMenuFlags(opts) {
      if (this._detached) return
      const syncAi = !!(opts && opts.syncAi)
      const apply = (aiEnabled, lunarEnabled) => {
        if (this._detached) return
        const next = buildMenuList({
          aiEnabled,
          showAiChat: this.properties.showAiChat,
          lunarEnabled
        })
        if (this._menuListSig(next) !== this._menuListSig(this.data.menuItems)) {
          this.setData({ menuItems: next })
        }
      }

      if (syncAi) {
        apply(isAIChatEnabledSync(), !!this._lunarEnabled)
      }

      Promise.all([
        // 与详情页一致：读不到配置时隐藏星问，避免过审仍露出入口
        isFeatureEnabled('enableAIChat', { failClosed: true }).catch(() => false),
        isFeatureEnabled('enableLunarWishes', { failClosed: true }).catch(() => false)
      ]).then(([aiEnabled, lunarEnabled]) => {
        this._lunarEnabled = !!lunarEnabled
        // 同步 aiService 缓存，供 _openAiChat 的 sync 判断
        fetchAIChatEnabled().catch(() => {})
        apply(!!aiEnabled, this._lunarEnabled)
      })
    },

    _vibrateMedium() {
      try {
        if (typeof wx.vibrateShort === 'function') {
          wx.vibrateShort({ type: 'medium' })
        }
      } catch (_) {}
    },

    _clampBtnY(btnY) {
      const { btnSize, windowHeight, safeTop, safeBottom } = this.data
      const minY = safeTop
      const maxY = windowHeight - btnSize - safeBottom
      return Math.max(minY, Math.min(maxY, btnY))
    },

    _updateMenuMaxHeight() {
      const { btnY, safeTop } = this.data
      this.setData({ menuMaxHeight: Math.max(200, btnY - safeTop - 24) })
    },

    onTouchStart(e) {
      this._touchTs = Date.now()
      const t = e.touches[0]
      this._startX = t.clientX
      this._startY = t.clientY
      this._startBtnX = this.data.btnX
      this._startBtnY = this.data.btnY
      this._isDragging = false
    },

    onTouchMove(e) {
      if (this.data.expanded) return
      const t = e.touches[0]
      const dx = t.clientX - this._startX
      const dy = t.clientY - this._startY
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        this._isDragging = true
      }
      const { btnSize, windowWidth, safeLeft } = this.data
      const newX = Math.max(safeLeft, Math.min(windowWidth - btnSize, this._startBtnX + dx))
      const newY = this._clampBtnY(this._startBtnY + dy)
      this._pendingBtnX = newX
      this._pendingBtnY = newY

      // touchmove 高频：按 ~60fps 节流 setData；menuMaxHeight 拖拽中菜单必然收起，延迟到 touchEnd 再算
      const now = Date.now()
      if (!this._lastMoveSetAt || now - this._lastMoveSetAt >= 16) {
        this._lastMoveSetAt = now
        this.setData({ btnX: newX, btnY: newY })
      }

      if (this._isDragging) {
        this._spawnParticle(newX + btnSize / 2, newY + btnSize / 2)
      }
    },

    onTouchEnd() {
      const wasDragging = !!this._isDragging
      this._isDragging = false
      if (wasDragging) {
        // 落定末帧位置（节流可能吞掉最后一次 move）
        if (this._pendingBtnX != null) {
          this.setData({ btnX: this._pendingBtnX, btnY: this._pendingBtnY })
        }
        this._updateMenuMaxHeight()
        this._snapToEdge()
        this._fadeOutParticles()
        return
      }

      this._vibrateMedium()
      this.setData({ expanded: !this.data.expanded })
    },

    onTouchCancel() {
      // 系统取消手势时也要复位，否则 pulseScrollHide 会一直被 _isDragging 挡住
      this._isDragging = false
    },

    _spawnParticle(cx, cy) {
      if (!this._particleList) this._particleList = []
      if (!this._particleId) this._particleId = 0
      const now = Date.now()
      // 32ms 节流 + 上限 40：每个粒子会触发 3 次整数组 setData，降低生成频率以控开销
      if (this._lastParticleTs && now - this._lastParticleTs < 32) return
      this._lastParticleTs = now

      const offsetX = (Math.random() - 0.5) * 16
      const offsetY = (Math.random() - 0.5) * 16
      const size = 0.5 + Math.random() * 1.0
      const p = { id: ++this._particleId, x: cx + offsetX, y: cy + offsetY, opacity: 1, scale: size }
      this._particleList.push(p)
      if (this._particleList.length > 40) this._particleList = this._particleList.slice(-40)
      this.setData({ particles: this._particleList })

      setTimeout(() => {
        if (this._detached) return
        this._particleList = this._particleList.map(item =>
          item.id === p.id ? { ...item, opacity: 0, scale: 0.1 } : item
        )
        this.setData({ particles: this._particleList })
      }, 50)

      setTimeout(() => {
        if (this._detached) return
        this._particleList = this._particleList.filter(item => item.id !== p.id)
        this.setData({ particles: this._particleList })
      }, 1800)
    },

    _fadeOutParticles() {
      if (!this._particleList || !this._particleList.length) return
      this._particleList = this._particleList.map(p => ({ ...p, opacity: 0, scale: 0.05 }))
      this.setData({ particles: this._particleList })
      setTimeout(() => {
        if (this._detached) return
        this._particleList = []
        this.setData({ particles: [] })
      }, 1600)
    },

    onMenuTap(e) {
      this._vibrateMedium()
      const key = e.currentTarget.dataset.key
      this.setData({ expanded: false })
      if (key !== 'aichat') {
        this._markVisited(key)
      }
      if (key === 'nasa') {
        navigateTo(ROUTES.NASA_DATA)
      } else if (key === 'lunar') {
        isFeatureEnabled('enableLunarWishes', { failClosed: true }).then((on) => {
          if (!on) {
            wx.showToast({ title: '功能暂未开放', icon: 'none' })
            return
          }
          navigateTo(ROUTES.LUNAR_WISHES)
        }).catch(() => {
          wx.showToast({ title: '功能暂未开放', icon: 'none' })
        })
      } else if (key === 'astro') {
        navigateTo(ROUTES.ASTRO_CALENDAR)
      } else if (key === 'exoplanet') {
        navigateTo(ROUTES.EXOPLANET)
      } else if (key === 'aichat') {
        this._openAiChat()
      }
    },

    _openAiChat() {
      try {
        if (!isAIChatEnabledSync()) {
          wx.showToast({ title: '星问AI暂未开放', icon: 'none' })
          return
        }
      } catch (e) {}
      // 再异步确认（防缓存过期仍放行）；关闭时不进详情页
      isFeatureEnabled('enableAIChat', { failClosed: true }).then((on) => {
        if (!on) {
          wx.showToast({ title: '星问AI暂未开放', icon: 'none' })
          return
        }
        navigateTo(ROUTES.AI_CHAT)
      }).catch(() => {
        wx.showToast({ title: '星问AI暂未开放', icon: 'none' })
      })
    },

    onMaskTap() {
      this.setData({ expanded: false })
    },

    _snapToEdge() {
      const { btnX, btnY, windowWidth, btnSize, safeLeft } = this.data
      const edgeMargin = 12
      const newX = (btnX + btnSize / 2) < (windowWidth / 2) ? edgeMargin : windowWidth - btnSize - edgeMargin
      const newY = this._clampBtnY(btnY)
      this.setData({ btnX: newX, btnY: newY })
      this._updateMenuMaxHeight()
      this._emitPositionChange()
    },

    _checkAllDots() {
      const today = todayStr()
      const map = {}

      // 组件挂在全部 Tab 页，经 storage-sync-cache 内存层去重，避免每次重建都 sync 读
      try { map.astro = storageCache.readMemOrSync(VISIT_KEY + 'astro', '') !== today }
      catch (e) { map.astro = true }

      try { map.nasa = storageCache.readMemOrSync(VISIT_KEY + 'nasa', '') !== today }
      catch (e) { map.nasa = true }

      map.exoplanet = false
      map.lunar = false

      this.setData({
        dotMap: map,
        showDot: Object.keys(map).some(k => map[k])
      })

      // 月愿入口关闭时不查红点，避免多余请求
      if (this._lunarEnabled) this._checkLunarDot()
    },

    _checkLunarDot() {
      try {
        const cache = storageCache.readMemOrSync(LUNAR_CACHE_KEY, null)
        if (cache && cache.ts && Date.now() - cache.ts < LUNAR_CACHE_TTL) {
          if (cache.dot) this._setDot('lunar', true)
          return
        }
      } catch (e) {}

      const { cloudEnv } = require('../../../../utils/config.js')
      wx.cloud.callFunction({
        name: 'lunarWishes',
        config: { env: cloudEnv },
        data: { action: 'stats' }
      }).then(res => {
        const result = res.result || {}
        if (result.code === 0 && result.data) {
          const current = result.data.totalWishes || 0
          let lastSeen = 0
          try { lastSeen = storageCache.readMemOrSync(LUNAR_COUNT_KEY, 0) || 0 } catch (e) {}
          const hasDot = current > lastSeen
          this._setDot('lunar', hasDot)
          try {
            storageCache.persistAsync(LUNAR_CACHE_KEY, { ts: Date.now(), dot: hasDot, total: current })
          } catch (e) {}
        }
      }).catch(() => {})
    },

    _setDot(key, hasDot) {
      const dotMap = Object.assign({}, this.data.dotMap)
      dotMap[key] = hasDot
      this.setData({
        dotMap: dotMap,
        showDot: Object.keys(dotMap).some(k => dotMap[k])
      })
    },

    _markVisited(key) {
      if (key === 'astro' || key === 'nasa') {
        try { storageCache.persistAsync(VISIT_KEY + key, todayStr()) } catch (e) {}
      } else if (key === 'lunar') {
        try {
          const cache = storageCache.readMemOrSync(LUNAR_CACHE_KEY, null)
          if (cache && cache.total) {
            storageCache.persistAsync(LUNAR_COUNT_KEY, cache.total)
            storageCache.persistAsync(LUNAR_CACHE_KEY, Object.assign({}, cache, { dot: false }))
          }
        } catch (e) {}
      }
      this._setDot(key, false)
    }
  }
})
