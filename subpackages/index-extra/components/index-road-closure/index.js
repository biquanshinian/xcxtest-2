/** ★ 开发预览时改 true；看完样式改回 false 再上线 */
const ROAD_CLOSURE_DEV_MODE = false

const DEV_NOTICE = {
  isActive: true,
  message: 'Boca Chica Beach Road / SH-4 交通管制中：海滩关闭，Hwy 4 预计延迟 30–90 分钟，请改走备用路线，勿在封控路段停留',
  timeRange: '8月19日 08:00 - 8月19日 18:00',
  sourceLabel: 'Starbase.gov'
}

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    /* 组件 wxss 的 .theme-light 后代选择器无法匹配组件外的页面根节点，
       须把主题类挂到组件自身根节点上才能生效 */
    themeClass: { type: String, value: '' },
    notice: { type: Object, value: null },
    missionType: { type: String, value: 'upcoming' }
  },
  data: {
    displayText: '',
    scrolling: false,
    durationSec: 14,
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
      const msg = String(notice.message || 'Boca Chica 道路封闭中').trim()
      const timeRange = String(notice.timeRange || '').trim()
      const displayText = timeRange && msg.indexOf(timeRange) < 0
        ? msg + '   ' + timeRange
        : msg
      const previewNotice = visible ? notice : null
      const patch = { visible, previewNotice }
      if (displayText !== this.data.displayText) {
        patch.displayText = displayText
        patch.scrolling = false
        patch.trackStyle = ''
      }
      this.setData(patch, () => {
        if (visible) this._scheduleMeasure()
      })
    },

    _scheduleMeasure() {
      if (this._measureTimer) clearTimeout(this._measureTimer)
      this._measureTimer = setTimeout(() => {
        this._measureTimer = null
        this._measureTicker()
      }, 50)
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
        if (!well || !item || !well.width || !item.width) return
        const overflow = item.width > well.width - 36
        const durationSec = overflow
          ? Math.min(26, Math.max(9, Math.round((item.width / 32) * 10) / 10))
          : 14
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
