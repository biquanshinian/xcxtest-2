/** ★ 开发预览时改 true；看完样式改回 false 再上线 */
const ROAD_CLOSURE_DEV_MODE = false

const DEV_NOTICE = {
  isActive: true,
  statusText: '海滩封闭 · 道路延迟',
  detailText: '8月23日 08:00–12:00  ·  8月23日 18:00–22:00  ·  发射台至产线（8月23日 11:30–14:30）  ·  Hwy 4 预计延迟 30–90 分钟',
  message: '海滩封闭 · 道路延迟  ·  8月23日 08:00–12:00  ·  8月23日 18:00–22:00  ·  发射台至产线（8月23日 11:30–14:30）  ·  Hwy 4 预计延迟 30–90 分钟',
  timeRange: '8月23日 08:00 - 8月23日 22:00',
  sourceLabel: 'Starbase.gov'
}

function flattenLine(text) {
  return String(text || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
}

Component({
  options: { virtualHost: true, styleIsolation: 'apply-shared' },
  properties: {
    /* 组件 wxss 的 .theme-light 后代选择器无法匹配组件外的页面根节点，
       须把主题类挂到组件自身根节点上才能生效 */
    themeClass: { type: String, value: '' },
    notice: { type: Object, value: null },
    missionType: { type: String, value: 'upcoming' }
  },
  data: {
    headline: '',
    displayText: '',
    scrolling: false,
    durationSec: 16,
    trackStyle: '',
    previewNotice: null,
    visible: false
  },
  observers: {
    'notice, missionType': function () {
      this._syncDisplay()
    }
  },
  lifetimes: {
    ready() {
      this._syncDisplay()
    },
    detached() {
      if (this._measureTimer) {
        clearTimeout(this._measureTimer)
        this._measureTimer = null
      }
    }
  },
  methods: {
    emitOpen() { this.triggerEvent('open') },

    _effectiveNotice() {
      if (ROAD_CLOSURE_DEV_MODE) return DEV_NOTICE
      return this.data.notice || null
    },

    _syncDisplay() {
      const notice = this._effectiveNotice() || {}
      const visible = !!(notice.isActive && this.data.missionType !== 'calendar')
      const statusText = flattenLine(notice.statusText)
      const detailText = flattenLine(notice.detailText)
      const msg = flattenLine(notice.message || '星舰基地道路封路通知')
      const timeRange = flattenLine(notice.timeRange)
      const displayText = detailText
        || (timeRange && msg.indexOf(timeRange) < 0 ? msg + '  ·  ' + timeRange : msg)
      const headline = statusText && detailText && statusText !== displayText
        ? statusText
        : ''
      const previewNotice = visible ? notice : null
      const textChanged =
        displayText !== this.data.displayText || headline !== this.data.headline
      const patch = {}
      if (visible !== this.data.visible) patch.visible = visible
      if (previewNotice !== this.data.previewNotice) patch.previewNotice = previewNotice
      if (textChanged) {
        patch.headline = headline
        patch.displayText = displayText
        patch.scrolling = false
        patch.trackStyle = ''
      }
      if (!Object.keys(patch).length) return
      this.setData(patch, () => {
        if (visible) {
          this._measureRetries = 0
          this._scheduleMeasure(50)
        }
      })
    },

    _scheduleMeasure(delay) {
      if (this._measureTimer) clearTimeout(this._measureTimer)
      this._measureTimer = setTimeout(() => {
        this._measureTimer = null
        this._measureTicker()
      }, delay || 50)
    },

    _measureTicker() {
      if (!this.data.visible) {
        if (this.data.scrolling) this.setData({ scrolling: false, trackStyle: '' })
        return
      }
      const query = this.createSelectorQuery()
      query.select('.road-closure-ticker').boundingClientRect()
      query.select('.road-closure-ticker-probe').boundingClientRect()
      query.exec((res) => {
        const well = res && res[0]
        const item = res && res[1]
        if (!well || !item || !well.width || !item.width) {
          // 首帧/骨架期布局未就绪会量到 0：退避重试，避免停在省略号态
          const retries = this._measureRetries || 0
          if (retries < 3) {
            this._measureRetries = retries + 1
            this._scheduleMeasure(120 * (retries + 1))
          }
          return
        }
        this._measureRetries = 0
        // 阈值须与非滚动态 CSS 一致：轨道左右各 16rpx padding，再留 4px 防临界抖动。
        // 否则文案宽度落在临界带时会被 ellipsis 裁掉几字而不是进入滚动。
        let screenWidth = 375
        try {
          const win = wx.getWindowInfo ? wx.getWindowInfo() : null
          if (win && win.screenWidth) screenWidth = win.screenWidth
        } catch (e) {}
        const availWidth = well.width - 32 * (screenWidth / 750) - 4
        const overflow = item.width > availWidth
        const durationSec = overflow
          ? Math.min(48, Math.max(12, Math.round((item.width / 22) * 10) / 10))
          : 16
        const trackStyle = overflow ? 'animation-duration:' + durationSec + 's;' : ''
        if (
          this.data.scrolling !== overflow ||
          this.data.durationSec !== durationSec ||
          this.data.trackStyle !== trackStyle
        ) {
          this.setData({ scrolling: overflow, durationSec, trackStyle })
        }
      })
    }
  }
})
