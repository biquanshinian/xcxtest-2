/**
 * 直播演示模式覆盖层组件
 * - 气泡讲解 + 二维码展示
 * - 整段音频播放（不分步）
 * - 默认循环播放
 */
Component({
  properties: {
    showControls: { type: Boolean, value: true },
    qrcodeUrl: { type: String, value: '' },
    loop: { type: Boolean, value: true }
  },

  data: {
    visible: false,
    showMask: false,
    showFinger: false,
    showQrcode: false,
    bubbleText: '',
    bubblePosition: 'top',
    bubbleTop: 0,
    bubbleLeft: 0,
    spotlightRect: { top: 0, left: 0, width: 0, height: 0 },
    spotlightRadius: 8,
    fingerTop: 0,
    fingerLeft: 0,
    currentStep: 0,
    totalSteps: 0,
    scriptTitle: '',
    _script: null,
    _timer: null,
    _audioCtx: null,
    _paused: false,
    _watcherId: null
  },

  lifetimes: {
    detached() {
      this._cleanup()
      this._closeWatcher()
    }
  },

  methods: {
    /** 启动演示脚本（支持传入脚本队列循环播放） */
    startScript(script) {
      if (!script || !script.steps || !script.steps.length) return
      this._cleanup()
      this.setData({
        visible: true,
        _script: script,
        totalSteps: script.steps.length,
        currentStep: 0,
        scriptTitle: script.title || '演示模式'
      })
      // 播放整段音频（如果有）
      if (script.audioUrl) {
        this._playAudio(script.audioUrl)
      }
      this._executeStep(0)
    },

    /**
     * 启动多脚本循环播放
     * @param {Array} scriptList - 脚本数组 [{ title, steps, audioUrl }, ...]
     */
    startScriptLoop(scriptList) {
      if (!scriptList || !scriptList.length) return
      this._scriptQueue = scriptList
      this._scriptQueueIndex = 0
      this.startScript(scriptList[0])
    },

    /** 播放队列中的下一个脚本 */
    _playNextScript() {
      if (!this._scriptQueue || !this._scriptQueue.length) {
        // 没有队列，单脚本循环
        const script = this.data._script
        if (script) {
          if (script.audioUrl) this._playAudio(script.audioUrl)
          this._executeStep(0)
        }
        return
      }
      this._scriptQueueIndex = ((this._scriptQueueIndex || 0) + 1) % this._scriptQueue.length
      const nextScript = this._scriptQueue[this._scriptQueueIndex]
      this.startScript(nextScript)
    },

    /** 停止演示 */
    stopScript() {
      this._cleanup()
      this.setData({
        visible: false, showMask: false, showFinger: false,
        showQrcode: false, bubbleText: '',
        currentStep: 0, totalSteps: 0
      })
      this.triggerEvent('stop')
    },

    /** 执行指定步骤 */
    _executeStep(index) {
      const script = this.data._script
      if (!script) return

      if (index >= script.steps.length || index < 0) {
        if (this.data.loop) {
          // 循环：回首页，2s 后播放下一个脚本
          this.setData({ showMask: false, showFinger: false, showQrcode: false, bubbleText: '' })
          this._stopAudio()
          wx.switchTab({
            url: '/pages/index/index',
            complete: () => {
              const t = setTimeout(() => {
                this._playNextScript()
              }, 2000)
              this.setData({ _timer: t })
            }
          })
          return
        }
        this._showFinale()
        return
      }

      this.setData({ currentStep: index })
      const step = script.steps[index]

      if (this.data._timer) { clearTimeout(this.data._timer); this.setData({ _timer: null }) }

      // 重置
      this.setData({ showMask: false, showFinger: false, bubbleText: '', showQrcode: false })

      switch (step.action) {
        case 'navigate': this._doNavigate(step); break
        case 'highlight': this._doHighlight(step); break
        case 'bubble': this._doBubble(step); break
        case 'scroll': this._doScroll(step); break
        case 'qrcode': this._doQrcode(step); break
        case 'wait': break
        default: this._doBubble(step)
      }

      // 自动下一步
      if (step.delay && step.delay > 0 && !this.data._paused) {
        const t = setTimeout(() => this._executeStep(index + 1), step.delay)
        this.setData({ _timer: t })
      }
    },

    _doNavigate(step) {
      if (step.bubble) {
        this.setData({ bubbleText: step.bubble, bubbleTop: step.top || 200, bubbleLeft: step.left || 30 })
      }
      if (step.page) {
        if (step.isTab) {
          wx.switchTab({ url: step.page })
        } else {
          wx.navigateTo({ url: step.page, fail: () => wx.redirectTo({ url: step.page }) })
        }
      }
    },

    _doHighlight(step) {
      this.setData({
        showMask: true,
        bubbleText: step.bubble || '',
        spotlightRect: step.rect || { top: 0, left: 0, width: 0, height: 0 },
        spotlightRadius: step.radius || 8
      })
      if (step.rect) {
        const bTop = step.rect.top + step.rect.height + 20
        const isBottom = bTop > 500
        this.setData({
          bubblePosition: isBottom ? 'bottom' : 'top',
          bubbleTop: isBottom ? step.rect.top - 100 : bTop,
          bubbleLeft: Math.max(20, step.rect.left - 20)
        })
      }
      if (step.showFinger && step.rect) {
        this.setData({
          showFinger: true,
          fingerTop: step.rect.top + step.rect.height / 2 - 20,
          fingerLeft: step.rect.left + step.rect.width / 2 - 14
        })
      }
    },

    _doBubble(step) {
      this.setData({
        bubbleText: step.bubble || step.text || '',
        bubblePosition: step.position || 'top',
        bubbleTop: step.top || 300,
        bubbleLeft: step.left || 40
      })
    },

    _doScroll(step) {
      if (step.scrollTop !== undefined) {
        wx.pageScrollTo({ scrollTop: step.scrollTop, duration: 500 })
      }
      if (step.bubble) {
        setTimeout(() => {
          this.setData({
            bubbleText: step.bubble,
            bubbleTop: step.top || 300,
            bubbleLeft: step.left || 40
          })
        }, 600)
      }
    },

    _doQrcode(step) {
      this.setData({
        showQrcode: !!(this.data.qrcodeUrl || step.qrcodeUrl),
        bubbleText: step.bubble || '扫码体验小程序',
        bubbleTop: step.top || 200,
        bubbleLeft: step.left || 40
      })
      if (step.qrcodeUrl && !this.data.qrcodeUrl) {
        this.setData({ qrcodeUrl: step.qrcodeUrl })
      }
    },

    _showFinale() {
      this.setData({
        showMask: false, showFinger: false,
        bubbleText: '演示结束，感谢观看！',
        bubbleTop: 250, bubbleLeft: 40,
        showQrcode: !!this.data.qrcodeUrl
      })
      const t = setTimeout(() => this.stopScript(), 8000)
      this.setData({ _timer: t })
    },

    /** 播放整段音频 */
    _playAudio(url) {
      this._stopAudio()
      const ctx = wx.createInnerAudioContext()
      ctx.src = url
      ctx.onError(() => {})
      ctx.play()
      this.setData({ _audioCtx: ctx })
    },

    _stopAudio() {
      if (this.data._audioCtx) {
        try { this.data._audioCtx.stop(); this.data._audioCtx.destroy() } catch (e) {}
        this.setData({ _audioCtx: null })
      }
    },

    _cleanup() {
      if (this.data._timer) { clearTimeout(this.data._timer); this.setData({ _timer: null }) }
      this._stopAudio()
    },

    /** 仅组件销毁或重新订阅时关闭：startScript 复用 _cleanup，不能在那里断开远程控制 */
    _closeWatcher() {
      if (this._watcher) {
        try { this._watcher.close() } catch (e) {}
        this._watcher = null
      }
    },

    /** 监听云数据库远程控制指令 */
    startRemoteControl() {
      this._closeWatcher()
      try {
        const db = wx.cloud.database()
        const watcher = db.collection('demo_mode').doc('control').watch({
          onChange: (snapshot) => {
            if (!snapshot.docs || !snapshot.docs.length) return
            const doc = snapshot.docs[0]
            if (doc.command === 'start' && doc.scriptName) {
              this.triggerEvent('remoteStart', { scriptName: doc.scriptName })
            } else if (doc.command === 'stop') {
              this.stopScript()
            } else if (doc.command === 'next') {
              this.onNext()
            } else if (doc.command === 'prev') {
              this.onPrev()
            } else if (doc.command === 'goto' && typeof doc.step === 'number') {
              this._executeStep(doc.step)
            }
          },
          onError: (err) => console.warn('[DemoOverlay] watch error:', err)
        })
        // watcher 存实例变量（不进 data），detached/_cleanup 时 close，避免组件销毁后监听泄漏
        this._watcher = watcher
      } catch (e) {
        console.warn('[DemoOverlay] startRemoteControl failed:', e)
      }
    },

    onPrev() {
      const prev = this.data.currentStep - 1
      if (prev >= 0) this._executeStep(prev)
    },
    onNext() {
      this._executeStep(this.data.currentStep + 1)
    },
    onStop() { this.stopScript() },
    onMaskTap() { this.onNext() },
    hideQrcode() { this.setData({ showQrcode: false }) }
  }
})
