/**
 * 观礼表单输入协议（观礼分包副本）
 *
 * 2026-08 重构：回归微信原生键盘方案，修复两类实机问题：
 *   1) 输入内容被键盘挡住、收起键盘才能看到文字；
 *   2) 光标与 placeholder 随手动 scroll 补偿漂移。
 * 旧协议（adjust-position=false + hold-keyboard + keyboardHeight padding + scrollTop 补偿）
 * 依赖原生输入层与 webview 滚动的手工对齐，机型差异下经常错位；现改为：
 *   - input/textarea 不再关闭 adjust-position（默认 true，系统自动顶起页面）
 *   - 保留 cursor-spacing="24" 让光标距键盘留出间距
 *   - 不再监听键盘高度、不再手动滚动，keyboardHeight 恒为 0（兼容遗留 wxml 绑定）
 *
 * 多字段表单约定（保留）：
 *   - data-path + bindinput="onTextInput"（同值跳过）
 *   - 短码框 bindinput="onCodeInput"（大小写只在提交时变）
 *   - 可选钩子 _onTextInputPatch(path, value) 返回额外 patch（如火箭缩略图）
 *
 * 2026-08 单行输入 textarea 化：iOS 上 input 聚焦切原生层导致光标/文字漂移
 * （always-embed 实测无效），textarea 同层渲染稳定。单行 textarea 带
 * data-single="1" 标记 + confirm-type 非 return（回车不换行），这里兜底
 * 过滤粘贴带入的换行符。
 */
module.exports = Behavior({
  data: {
    keyboardHeight: 0,
    composerScrollTop: 0
  },

  methods: {
    /** 兼容遗留绑定：原生 adjust-position 下无需任何滚动补偿 */
    onComposerScroll() {},
    onInputFocus() {},
    onInputBlur() {},
    onInputKeyboardHeightChange() {},

    /** 点非输入区收起键盘（个别页面主动调用） */
    dismissKeyboard() {
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
      let value = (e.detail && e.detail.value != null) ? e.detail.value : ''
      // 单行 textarea：过滤换行（粘贴/个别安卓键盘回车）。
      // 只动换行不动空格：合并空格会在连敲空格时改写受控值 → 光标跳。
      if (ds.single && typeof value === 'string' && /[\r\n]/.test(value)) {
        value = value.replace(/[\r\n]+/g, ' ')
      }
      if (String(this._readDataPath(path)) === String(value)) return
      const patch = { [path]: value }
      if (typeof this._onTextInputPatch === 'function') {
        const extra = this._onTextInputPatch(path, value)
        if (extra && typeof extra === 'object') Object.assign(patch, extra)
      }
      this.setData(patch)
    },

    /** 短码框：输入中不做大小写/空格变换（避免改写受控值打断输入法、光标跳末尾），
     *  只滤换行；空格由提交端 trim。 */
    onCodeInput(e) {
      let v = (e && e.detail && e.detail.value != null) ? e.detail.value : ''
      if (typeof v === 'string' && /[\r\n]/.test(v)) v = v.replace(/[\r\n]+/g, '')
      if (v === (this.data && this.data.codeInput)) return
      this.setData({ codeInput: v })
    }
  }
})
