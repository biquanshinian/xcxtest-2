// pages/webview/webview.js
const config = require('../../utils/config.js')
const theme = require('../../utils/theme.js')

Page({
  data: {
    url: '',
    baseUrl: '',
    loading: true,
    loadError: false,
    errorMessage: '',
    loadTimeout: false,
    pageTitle: '星舰监控中心',
    showDomainTip: false,
    showEmbedTip: false,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000'
  },

  onLoad(options) {
    // 注入全局主题（明亮 / 深色）
    this.setData({
      themeClass: theme.getThemeClassSync(),
      themeLight: theme.isLightSync(),
      pageBgColor: theme.getPageBgSync()
    })

    // 设置页面标题
    wx.setNavigationBarTitle({
      title: '星舰监控中心'
    })

    if (options.url) {
      const url = decodeURIComponent(options.url)
      
      // 验证URL格式（必须使用HTTPS）
      if (!url.startsWith('https://')) {
        this.setData({
          loading: false,
          loadError: true,
          errorMessage: '网页地址必须使用HTTPS协议'
        })
        return
      }

      // 验证是否为配置的业务域名
      const domain = this.extractDomain(url)
      const configuredDomain = this.extractDomain(config.userWebPreviewUrl || '')
      
      if (configuredDomain && domain !== configuredDomain && !domain.endsWith('.' + configuredDomain)) {
      }

      this.setData({
        url: url,
        baseUrl: url,
        loading: true,
        loadError: false,
        loadTimeout: false
      })
      
      // 设置超时检测（30秒，根据微信文档建议）
      this.loadTimer = setTimeout(() => {
        if (this.data.loading) {
          this.setData({
            loading: false,
            loadTimeout: true,
            errorMessage: '网页加载超时，请检查网络连接或稍后重试'
          })
        }
      }, 30000)
    } else {
      // 如果没有传入URL，优先使用云中转页面，否则使用直接URL
      const cloudUrl = config.monitorCloudPreviewUrl || ''
      const directUrl = config.userWebPreviewUrl || ''
      const defaultUrl = cloudUrl || directUrl
      
      if (defaultUrl) {
        this.setData({
          url: defaultUrl,
          baseUrl: defaultUrl,
          loading: true,
          loadError: false,
          loadTimeout: false
        })
        
        this.loadTimer = setTimeout(() => {
          if (this.data.loading) {
            this.setData({
              loading: false,
              loadTimeout: true,
              errorMessage: '网页加载超时，请检查网络连接或稍后重试'
            })
          }
        }, 30000)
      } else {
        this.setData({
          loading: false,
          loadError: true,
          errorMessage: '网页地址未配置'
        })
      }
    }
  },

  /**
   * 提取URL的域名
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url)
      return urlObj.hostname
    } catch (e) {
      return ''
    }
  },

  onUnload() {
    // 清理定时器
    if (this.loadTimer) {
      clearTimeout(this.loadTimer)
      this.loadTimer = null
    }
  },

  // web-view 加载完成
  onWebViewLoad(e) {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer)
      this.loadTimer = null
    }
    this.setData({
      loading: false,
      loadError: false,
      loadTimeout: false
    })
    
    // 加载完成后可以尝试获取页面标题（如果网页支持）
    // 注意：web-view 无法直接获取内嵌网页的标题，这是微信的限制
  },

  // web-view 加载错误
  onWebViewError(e) {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer)
      this.loadTimer = null
    }
    
    let errorMsg = '网页加载失败'
    let showDomainTip = false
    let showEmbedTip = false
    
    if (e.detail && e.detail.errMsg) {
      const errMsg = e.detail.errMsg.toLowerCase()
      if (errMsg.includes('timeout')) {
        errorMsg = '加载超时，请检查网络连接'
      } else if (errMsg.includes('domain') || errMsg.includes('业务域名') || errMsg.includes('不支持打开')) {
        errorMsg = '域名未配置或网页中包含未配置的第三方内容'
        showDomainTip = true
        
        // 检查是否是第三方嵌入内容（如 MARS）
        if (errMsg.includes('不支持打开') || errMsg.includes('embed')) {
          showEmbedTip = true
          errorMsg = '网页中包含第三方嵌入内容（如 MARS），需要配置业务域名'
        }
      } else if (errMsg.includes('ssl') || errMsg.includes('certificate') || errMsg.includes('证书')) {
        errorMsg = 'SSL证书错误，请检查网站证书配置'
      } else if (errMsg.includes('network')) {
        errorMsg = '网络错误，请检查网络连接'
      } else if (errMsg.includes('http')) {
        errorMsg = '协议错误，必须使用HTTPS协议'
      } else {
        errorMsg = `加载失败: ${e.detail.errMsg}`
      }
    }
    
    this.setData({
      loading: false,
      loadError: true,
      errorMessage: errorMsg,
      showDomainTip: showDomainTip,
      showEmbedTip: showEmbedTip
    })
  },

  onReload() {
    const u = this.data.baseUrl
    if (!u) return
    
    this.setData({
      loading: true,
      loadError: false,
      loadTimeout: false
    })
    
    // 清理旧定时器
    if (this.loadTimer) {
      clearTimeout(this.loadTimer)
    }
    
    // 重新设置URL（添加时间戳避免缓存）
    const sep = u.indexOf('?') >= 0 ? '&' : '?'
    this.setData({ 
      url: u + sep + '_=' + Date.now() 
    })
    
    // 重新设置超时检测
    this.loadTimer = setTimeout(() => {
      if (this.data.loading) {
        this.setData({
          loading: false,
          loadTimeout: true,
          errorMessage: '网页加载超时，请检查网络连接或稍后重试'
        })
      }
    }, 30000)
  },

  goBack() {
    // 多重兜底：navigateBack 失败 → switchTab → 延迟再试 switchTab → toast 提示
    // 分享冷启动时页面栈只有 1 层，navigateBack 会失败；switchTab 在 tabBar 未就绪时
    // 也可能静默失败；wx.reLaunch 不支持 tabBar 页面，所以不用它。
    const FALLBACK_TAB = '/pages/monitor/monitor'
    const retrySwitch = () => {
      setTimeout(() => {
        wx.switchTab({
          url: FALLBACK_TAB,
          fail: () => {
            try { wx.showToast({ title: '返回失败，请重启小程序', icon: 'none' }) } catch (_) {}
          }
        })
      }, 50)
    }
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: FALLBACK_TAB, fail: retrySwitch })
      }
    })
  },

  /**
   * 在浏览器中打开网页
   */
  openInBrowser() {
    const url = this.data.baseUrl || config.userWebPreviewUrl || ''
    if (!url) {
      wx.showToast({
        title: '网页地址未配置',
        icon: 'none',
        duration: 2000
      })
      return
    }

    // 复制链接到剪贴板
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showModal({
          title: '链接已复制',
          content: `链接已复制到剪贴板\n\n${url}\n\n请在浏览器中粘贴打开即可查看完整内容`,
          showCancel: false,
          confirmText: '我知道了',
          success: () => {
            // 提示用户如何打开
            wx.showActionSheet({
              itemList: ['已复制，去浏览器粘贴'],
              success: () => {
                // 用户已了解，无需额外操作
              }
            }).catch(() => {
              // 忽略取消操作
            })
          }
        })
      },
      fail: (err) => {
        // 如果复制失败，显示链接让用户手动复制
        wx.showModal({
          title: '请手动复制链接',
          content: url,
          showCancel: false,
          confirmText: '我知道了',
          success: () => {
            // 尝试再次复制
            wx.setClipboardData({
              data: url,
              success: () => {
                wx.showToast({
                  title: '复制成功',
                  icon: 'success',
                  duration: 2000
                })
              }
            })
          }
        })
      }
    })
  },

  /**
   * 分享功能
   */
  onShareAppMessage() {
    return {
      title: '星舰监控中心 - 实时监控星舰基地建设进度',
      path: `/pages/webview/webview?url=${encodeURIComponent(this.data.baseUrl || config.userWebPreviewUrl || '')}`,
      imageUrl: '' // 可以设置分享图片
    }
  },

  /**
   * 分享到朋友圈
   */
  onShareTimeline() {
    return {
      title: '星舰监控中心 - 实时监控星舰基地建设进度',
      query: `url=${encodeURIComponent(this.data.baseUrl || config.userWebPreviewUrl || '')}`
    }
  }
})
