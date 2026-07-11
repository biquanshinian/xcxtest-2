const { isFeatureEnabled } = require('../../../../utils/feature-flags.js')
const themeUtil = require('../../../../utils/theme.js')

const DEFAULT_TOPIC = '星舰发射讨论'
const TOPIC_MAX_LEN = 20
const DEFAULT_COLLAPSE_LIMIT = 2
const DEFAULT_EXPAND_LIMIT = 10
const PROBE_INTERVAL_MS = 200
const MAX_PROBE_ATTEMPTS = 20
/** 主列表与探测列表高度差超过此值（px）视为超过折叠条数 */
const HEIGHT_THRESHOLD_PX = 6

function sanitizeTopic(raw) {
  const s = (raw != null ? String(raw) : '').trim() || DEFAULT_TOPIC
  // 微信官方：话题超过 20 字整组件不展示
  return s.length > TOPIC_MAX_LEN ? s.slice(0, TOPIC_MAX_LEN) : s
}

function clampExpandLimit(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return DEFAULT_EXPAND_LIMIT
  return Math.min(10, Math.max(DEFAULT_COLLAPSE_LIMIT + 1, Math.round(v)))
}

Component({
  properties: {
    topic: {
      type: String,
      value: DEFAULT_TOPIC
    },
    /** 折叠时展示的贴图条数，默认 2 */
    collapseLimit: {
      type: Number,
      value: DEFAULT_COLLAPSE_LIMIT
    },
    /** 展开后展示的贴图条数，官方上限 10 */
    expandLimit: {
      type: Number,
      value: DEFAULT_EXPAND_LIMIT
    }
  },

  data: {
    show: false,
    safeTopic: DEFAULT_TOPIC,
    expanded: false,
    effectiveLimit: DEFAULT_COLLAPSE_LIMIT,
    probeLimit: DEFAULT_COLLAPSE_LIMIT + 1,
    showToggle: false,
    /* 组件样式隔离，页面根的 .theme-light 选择器进不来，浅色态由组件自挂修饰类
       （只影响自绘外壳的图标/文字色；原生贴图区走官方默认样式，不参与主题） */
    panelLight: false
  },

  observers: {
    topic(t) {
      this.setData({ safeTopic: sanitizeTopic(t) })
      this._resetExpandState()
    },
    'collapseLimit, expandLimit'() {
      this._syncEffectiveLimit()
      this._syncProbeLimit()
    }
  },

  lifetimes: {
    attached() {
      this.setData({
        safeTopic: sanitizeTopic(this.properties.topic),
        panelLight: themeUtil.isLightSync()
      })
      // 全局主题切换（设置页切换 / 系统主题变化）时组件不经过 pageLifetimes.show，
      // 须主动订阅 theme.js 的变更通知，否则外壳修饰类停留在旧主题值
      this._themeHandler = this._syncTheme.bind(this)
      themeUtil.onThemeChange(this._themeHandler)
      if (!wx.canIUse('official-account-publish')) return
      // 后台「贴图讨论区」全局开关（enablePublishPanel，缺省开启；模块级缓存，全站组件只读一次库）
      isFeatureEnabled('enablePublishPanel').then((on) => {
        if (!on) return
        this.setData({ show: true })
        this._syncEffectiveLimit()
        this._syncProbeLimit()
        this._scheduleProbeCheck()
      })
    },
    detached() {
      this._clearProbeCheck()
      if (this._themeHandler) {
        themeUtil.offThemeChange(this._themeHandler)
        this._themeHandler = null
      }
    }
  },

  pageLifetimes: {
    /* 在其他页切了主题后返回本页：重新同步外壳主题修饰类 */
    show() {
      this._syncTheme()
    }
  },

  methods: {
    /** 同步主题修饰类（仅自绘外壳配色；原生贴图区为官方默认样式，无需重建） */
    _syncTheme() {
      const light = themeUtil.isLightSync()
      if (light !== this.data.panelLight) {
        this.setData({ panelLight: light })
      }
    },

    _getCollapsedLimit() {
      return Number(this.properties.collapseLimit) || DEFAULT_COLLAPSE_LIMIT
    },

    _syncEffectiveLimit() {
      const { expandLimit } = this.properties
      const { expanded } = this.data
      const collapsed = this._getCollapsedLimit()
      const limit = expanded ? clampExpandLimit(expandLimit) : collapsed
      this.setData({ effectiveLimit: limit })
    },

    _syncProbeLimit() {
      this.setData({ probeLimit: this._getCollapsedLimit() + 1 })
    },

    _resetExpandState() {
      this._clearProbeCheck()
      this._isEmpty = false
      this.setData({
        expanded: false,
        showToggle: false
      })
      this._syncEffectiveLimit()
      this._syncProbeLimit()
      this._scheduleProbeCheck()
    },

    _scheduleProbeCheck() {
      this._clearProbeCheck()
      this._probeAttempts = 0
      this._runProbeCheck()
    },

    _clearProbeCheck() {
      if (this._probeTimer) {
        clearTimeout(this._probeTimer)
        this._probeTimer = null
      }
    },

    _runProbeCheck() {
      if (this._isEmpty) {
        this.setData({ showToggle: false })
        return
      }
      if (this.data.expanded) {
        this.setData({ showToggle: true })
        return
      }

      const query = this.createSelectorQuery()
      query.select('.official-account-publish-native-wrap').boundingClientRect()
      query.select('.official-account-publish-probe-wrap').boundingClientRect()
      query.exec((res) => {
        if (!this.data.show || this._isEmpty || this.data.expanded) return

        const mainH = res && res[0] && res[0].height ? res[0].height : 0
        const probeH = res && res[1] && res[1].height ? res[1].height : 0

        if (mainH <= 0 || probeH <= 0) {
          this._retryProbeCheck()
          return
        }

        const overLimit = probeH > mainH + HEIGHT_THRESHOLD_PX
        this.setData({ showToggle: overLimit })
      })
    },

    _retryProbeCheck() {
      this._probeAttempts = (this._probeAttempts || 0) + 1
      if (this._probeAttempts >= MAX_PROBE_ATTEMPTS) {
        this.setData({ showToggle: false })
        return
      }
      this._probeTimer = setTimeout(() => this._runProbeCheck(), PROBE_INTERVAL_MS)
    },

    _handleEmpty() {
      this._isEmpty = true
      this._clearProbeCheck()
      this.setData({
        showToggle: false,
        expanded: false
      })
      this._syncEffectiveLimit()
    },

    onToggleExpand() {
      const expanded = !this.data.expanded
      const { expandLimit } = this.properties
      const collapsed = this._getCollapsedLimit()
      const effectiveLimit = expanded ? clampExpandLimit(expandLimit) : collapsed
      this.setData({ expanded, effectiveLimit })
      if (expanded) {
        this._clearProbeCheck()
        this.setData({ showToggle: true })
      } else {
        this._scheduleProbeCheck()
      }
    },

    onError(e) {
      const detail = e && e.detail ? e.detail : {}
      console.warn('[official-account-publish-panel] binderror', detail)
      this._clearProbeCheck()
      this.setData({ show: false })
    },

    onEmpty(e) {
      const detail = e && e.detail ? e.detail : {}
      console.log('[official-account-publish-panel] bindempty', detail)
      this._handleEmpty()
    },

    onProbeEmpty(e) {
      const detail = e && e.detail ? e.detail : {}
      console.log('[official-account-publish-panel] probe bindempty', detail)
      this._handleEmpty()
    },

    onPublishSuccess(e) {
      const postUrl = e && e.detail ? e.detail.postUrl : ''
      console.log('[official-account-publish-panel] bindpublishsuccess', postUrl)
      this._isEmpty = false
      this._scheduleProbeCheck()
      if (postUrl) {
        wx.showToast({ title: '发表成功', icon: 'success' })
      }
    }
  }
})
