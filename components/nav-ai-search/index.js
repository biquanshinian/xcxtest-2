const { resolveNavAiSearchVisible, openNavAiSearch } = require('../../utils/nav-ai-search.js')
const themeUtil = require('../../utils/theme.js')

Component({
  options: {
    virtualHost: true
  },
  properties: {
    hidden: {
      type: Boolean,
      value: false
    }
  },
  data: {
    visible: false,
    /* 组件样式隔离下页面根的 .theme-light 变量进不来，浅色态由组件自挂修饰类 */
    themeLight: false
  },
  lifetimes: {
    attached() {
      this._themeHandler = this._syncTheme.bind(this)
      themeUtil.onThemeChange(this._themeHandler)
      this._syncTheme()
      this._syncVisible()
    },
    detached() {
      if (this._themeHandler) {
        themeUtil.offThemeChange(this._themeHandler)
        this._themeHandler = null
      }
    }
  },
  pageLifetimes: {
    show() {
      this._syncTheme()
      this._syncVisible()
    }
  },
  methods: {
    _syncTheme() {
      const light = themeUtil.isLightSync()
      if (light !== this.data.themeLight) {
        this.setData({ themeLight: light })
      }
    },
    async _syncVisible() {
      const on = await resolveNavAiSearchVisible()
      if (!!this.data.visible !== on) {
        this.setData({ visible: on })
      }
    },
    onTap() {
      this.triggerEvent('search')
      openNavAiSearch()
    }
  }
})
