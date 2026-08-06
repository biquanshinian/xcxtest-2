/**
 * 星问 AI 对话输入协议（成熟源）——页面 / 组件共用 Behavior
 * 观礼分包有同步副本：subpackages/watch-party/utils/composer-input-behavior.js
 *
 * 约定（与 subpackages/shared/components/ai-chat 输入栏一致）：
 *   - adjust-position="{{false}}"  关闭系统顶页面，改用 keyboardHeight 上收
 *   - hold-keyboard="{{true}}"     点发送/相邻控件不收键盘
 *   - cursor-spacing="24"
 *   - bindfocus / bindblur / bindkeyboardheightchange
 *   - 宿主用 style="padding-bottom: {{keyboardHeight}}px;" 上收
 *
 * 观礼表单页额外（scroll-view 内多字段）：
 *   - scroll-view：scroll-top="{{composerScrollTop}}" scroll-with-animation
 *                 bindscroll="onComposerScroll"（手指滑动收键盘，避免光标/占位符漂移）
 *   - 每个 input/textarea 须有稳定 id，聚焦后滚入可视区
 *
 * 多字段表单额外：
 *   - data-path + bindinput="onTextInput"（同值跳过）
 *   - 短码框 bindinput="onCodeInput"（大小写只在提交时变）
 *
 * 可选钩子（页面/组件覆盖）：
 *   _applyComposerKeyboard(kb)     自定义 setData（AI 半屏缩高、triggerEvent）
 *   _onComposerKeyboardHeight(kb)  高度变更后副作用（滚到底等）
 *   _onTextInputPatch(path, value) 返回额外 patch（如火箭缩略图）
 */
module.exports = Behavior({
  data: {
    keyboardHeight: 0,
    composerScrollTop: 0
  },

  /** Page 生命周期 */
  onLoad() {
    this._composerAttachKeyboard()
  },
  onUnload() {
    this._composerDetachKeyboard()
  },
  onShow() {
    // 回页后允许同一高度再次上收（见 pageLifetimes.hide 注释）
    this._lastKbHeight = -1
  },
  onHide() {
    this._composerResetOnHide()
  },

  /** Component 生命周期 */
  lifetimes: {
    attached() {
      this._composerAttachKeyboard()
    },
    detached() {
      this._composerDetachKeyboard()
    }
  },

  pageLifetimes: {
    show() {
      this._lastKbHeight = -1
    },
    hide() {
      this._composerResetOnHide()
    }
  },

  methods: {
    _composerAttachKeyboard() {
      if (this._kbHandler) return
      this._lastKbHeight = -1
      this._kbHandler = (res) => {
        // 组件未展示时忽略（AI 半屏）；页面恒处理
        if (this.data && this.data.visible === false && !this.data.isPageMode) return
        this._updateKeyboardLayout((res && res.height) || 0)
      }
      try {
        if (typeof wx !== 'undefined' && typeof wx.onKeyboardHeightChange === 'function') {
          wx.onKeyboardHeightChange(this._kbHandler)
        }
      } catch (e) {}
    },

    _composerDetachKeyboard() {
      if (this._blurKbTimer) {
        clearTimeout(this._blurKbTimer)
        this._blurKbTimer = null
      }
      if (this._composerScrollTimers) {
        this._composerScrollTimers.forEach((t) => clearTimeout(t))
        this._composerScrollTimers = null
      }
      if (this._kbHandler) {
        try {
          if (typeof wx !== 'undefined' && typeof wx.offKeyboardHeightChange === 'function') {
            wx.offKeyboardHeightChange(this._kbHandler)
          }
        } catch (e) {}
        this._kbHandler = null
      }
    },

    /**
     * 离开页面必须清零键盘状态。_lastKbHeight 是去抖用的，若带着上次的
     * 高度残留回来，下次键盘以同一高度弹起会被去抖吞掉，输入栏就留在键盘底下。
     */
    _composerResetOnHide() {
      if (this._blurKbTimer) {
        clearTimeout(this._blurKbTimer)
        this._blurKbTimer = null
      }
      this._lastKbHeight = -1
      this._composerPendingScrollId = ''
      const needClear = !!(this.data && (this.data.keyboardHeight || this.data.inputFocus))
      if (needClear) {
        const patch = { keyboardHeight: 0 }
        if (this.data.inputFocus !== undefined) patch.inputFocus = false
        this.setData(patch)
      }
      if (typeof this._onComposerKeyboardHide === 'function') {
        try { this._onComposerKeyboardHide() } catch (e) {}
      }
    },

    _updateKeyboardLayout(keyboardHeight) {
      const kb = Math.max(0, Number(keyboardHeight) || 0)
      if (this._lastKbHeight === kb) {
        if (kb > 0 && this._composerPendingScrollId) {
          this._composerScheduleScrollIntoView(this._composerPendingScrollId)
        }
        return
      }
      this._lastKbHeight = kb

      if (kb > 0 && this._blurKbTimer) {
        clearTimeout(this._blurKbTimer)
        this._blurKbTimer = null
      }

      if (typeof this._applyComposerKeyboard === 'function') {
        this._applyComposerKeyboard(kb)
      } else if (!this.data || this.data.keyboardHeight !== kb) {
        this.setData({ keyboardHeight: kb })
      }

      if (kb > 0 && this._composerPendingScrollId) {
        this._composerScheduleScrollIntoView(this._composerPendingScrollId)
      }

      if (typeof this._onComposerKeyboardHeight === 'function') {
        try { this._onComposerKeyboardHeight(kb) } catch (e) {}
      }
    },

    /** scroll-view 手指滑动：收起键盘，避免原生光标/占位符随滚漂移 */
    onComposerScroll() {
      if (Date.now() < (this._composerIgnoreScrollDismissUntil || 0)) return
      if (!(this.data && this.data.keyboardHeight > 0)) return
      this.dismissKeyboard()
    },

    _composerScheduleScrollIntoView(id) {
      const aid = String(id || '').trim()
      if (!aid) return
      if (!this._composerScrollTimers) this._composerScrollTimers = []
      this._composerScrollTimers.forEach((t) => clearTimeout(t))
      // 等 padding-bottom / 键盘高度布局两帧后再量，部分机型需二次校正
      this._composerScrollTimers = [
        setTimeout(() => this._composerScrollAnchorIntoView(aid), 48),
        setTimeout(() => this._composerScrollAnchorIntoView(aid), 260)
      ]
    },

    /** 将聚焦输入框滚入 scroll-view 可视区（键盘上方） */
    _composerScrollAnchorIntoView(id) {
      const aid = String(id || '').trim()
      if (!aid || typeof wx === 'undefined' || !wx.createSelectorQuery) return
      try {
        const q = wx.createSelectorQuery().in(this)
        q.select('.page-scroll').scrollOffset()
        q.select('.page-scroll').boundingClientRect()
        q.select('#' + aid).boundingClientRect()
        q.exec((res) => {
          const so = res && res[0]
          const sv = res && res[1]
          const el = res && res[2]
          if (!so || !sv || !el || !(el.height > 0)) return
          const margin = 20
          let next = Number(so.scrollTop) || 0
          if (el.top < sv.top + margin) {
            next -= (sv.top + margin - el.top)
          }
          if (el.bottom > sv.bottom - margin) {
            next += (el.bottom - (sv.bottom - margin))
          }
          next = Math.max(0, next)
          const cur = Number(so.scrollTop) || 0
          if (Math.abs(next - cur) < 2) return
          this._composerIgnoreScrollDismissUntil = Date.now() + 520
          // 同值不触发滚动：先写一个邻近值再写目标
          const bump = next + (next === (this.data && this.data.composerScrollTop) ? 0.01 : 0)
          this.setData({ composerScrollTop: bump })
          if (bump !== next) {
            setTimeout(() => {
              this._composerIgnoreScrollDismissUntil = Date.now() + 320
              this.setData({ composerScrollTop: next })
            }, 32)
          }
        })
      } catch (e) {}
    },

    /** input 聚焦：focus 事件自带键盘高度（部分机型 wx.onKeyboardHeightChange 不触发） */
    onInputFocus(e) {
      if (this._blurKbTimer) {
        clearTimeout(this._blurKbTimer)
        this._blurKbTimer = null
      }
      const id = String((e && e.currentTarget && e.currentTarget.id) || '').trim()
      this._composerPendingScrollId = id
      const h = (e && e.detail && e.detail.height) || 0
      if (h > 0) this._updateKeyboardLayout(h)
      else if (id) this._composerScheduleScrollIntoView(id)
    },

    /** adjust-position=false 时由输入框直接回调，最可靠 */
    onInputKeyboardHeightChange(e) {
      const h = (e && e.detail && e.detail.height) || 0
      this._updateKeyboardLayout(h)
    },

    /** 失焦延迟归位，避免与 keyboardheightchange 竞态 */
    onInputBlur() {
      this._composerPendingScrollId = ''
      if (this._blurKbTimer) clearTimeout(this._blurKbTimer)
      this._blurKbTimer = setTimeout(() => {
        this._blurKbTimer = null
        this._updateKeyboardLayout(0)
      }, 120)
    },

    /** 点非输入区：失焦并收起（多字段页无受控 focus 时走 hideKeyboard） */
    dismissKeyboard() {
      if (this._blurKbTimer) {
        clearTimeout(this._blurKbTimer)
        this._blurKbTimer = null
      }
      this._composerPendingScrollId = ''
      const patch = {}
      if (this.data && this.data.inputFocus) patch.inputFocus = false
      if (Object.keys(patch).length) this.setData(patch)
      this._updateKeyboardLayout(0)
      try {
        if (typeof wx !== 'undefined' && typeof wx.hideKeyboard === 'function') {
          wx.hideKeyboard({ fail: () => {} })
        }
      } catch (e) {}
    },

    _readDataPath(path) {
      const keys = String(path || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
      let cur = this.data
      for (let i = 0; i < keys.length; i++) {
        if (cur == null) return ''
        cur = cur[keys[i]]
      }
      return cur == null ? '' : cur
    },

    /** 多字段：data-path + bindinput="onTextInput" */
    onTextInput(e) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
      const path = String(ds.path || '').trim()
      if (!path) return
      const value = (e.detail && e.detail.value != null) ? e.detail.value : ''
      if (String(this._readDataPath(path)) === String(value)) return
      const patch = { [path]: value }
      if (typeof this._onTextInputPatch === 'function') {
        const extra = this._onTextInputPatch(path, value)
        if (extra && typeof extra === 'object') Object.assign(patch, extra)
      }
      this.setData(patch)
    },

    /** 短码框：输入中不做大小写变换（避免光标跳末尾） */
    onCodeInput(e) {
      const v = (e && e.detail && e.detail.value != null) ? e.detail.value : ''
      if (v === (this.data && this.data.codeInput)) return
      this.setData({ codeInput: v })
    }
  }
})
