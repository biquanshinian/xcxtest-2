/**
 * 星舰硬件设施详情页 —— 数据来自 NSF 硬件缓存（列表页已预热本地缓存，通常秒开）
 */
const pageBase = require('../../utils/page-base.js')
const {
  getStarshipHardwareFromDB,
  getStarshipHardwareTestsFromDB
} = require('../../utils/api-app-services.js')
const { resolveMediaUrl } = require('../../utils/image-config.js')
const { getCachedMediaImage } = require('../../utils/icon-cache.js')
const { togglePageTranslation } = require('../../utils/text-translate.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')

const B19_IMAGE_KEY = '最新版星舰组合体进展一二级图/b19_spacex3.webp'
const S39_IMAGE_KEY = '最新版星舰组合体进展一二级图/s39_spacex.webp'

function getFallbackImage(category) {
  const key = category === 'booster' || category === 'fullstack' ? B19_IMAGE_KEY : S39_IMAGE_KEY
  return resolveMediaUrl(key, '')
}

/** 硬件头图：cloud:// 原样返回；HTTPS 走缓存压缩（与进度页列表一致） */
function resolveHardwareDisplayImage(image, preset) {
  const raw = String(image || '').trim()
  if (!raw) return ''
  return getCachedMediaImage(raw, preset || 'medium')
}

function getStatusType(statusText) {
  const text = String(statusText || '').trim().toUpperCase()
  if (text === 'ACTIVE') return 'active'
  if (text === 'DESTROYED') return 'destroyed'
  if (text === 'EXPENDED') return 'expended'
  return 'retired'
}

/** ISO 时间 → 北京时间「YYYY-MM-DD HH:mm」 */
function formatBeijingTime(iso) {
  const ts = Date.parse(iso)
  if (!ts) return ''
  const d = new Date(ts + 8 * 60 * 60 * 1000)
  const pad = (n) => (n < 10 ? '0' + n : '' + n)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/progress/progress',

  data: {
    loading: true,
    errorMessage: '',
    vehicle: null,
    tests: [],
    testsLoading: true,
    navTitle: '硬件详情',
    testsTranslated: false,
    testsTranslating: false,
    descI18n: { testNotes: [] }
  },

  /** 测试记录备注「翻译/原文」（NSF notesEn 为英文原文） */
  onToggleTestsTranslate() {
    if (this.data.testsTranslating) return
    const tests = this.data.tests || []
    const fields = []
    tests.forEach((t, i) => {
      if (t && t.notesEn) fields.push({ path: 'descI18n.testNotes[' + i + ']', text: t.notesEn })
    })
    if (!fields.length) return
    togglePageTranslation(this, {
      switchKey: 'testsTranslated',
      loadingKey: 'testsTranslating',
      fields
    })
  },

  async onLoad(options) {
    this.initUiShell()
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    })
    const id = Number(options && options.id)
    this._vehicleId = id

    // 分享卡片 24h 免门控窗口：过期后走 gateCheck（会员放行，非会员弹开通引导）
    const shareAllowed = await checkShareEntryGate(this, options, 'starship_hardware', '星舰硬件设施')
    if (!shareAllowed) {
      this.setData({ loading: false, errorMessage: '分享链接已过期，开通星际通行证后可继续查看' })
      return
    }
    warmShareEntitlement(this, 'starship_hardware')

    if (!id && id !== 0) {
      this.setData({ loading: false, errorMessage: '缺少硬件编号' })
      return
    }
    this.loadDetail(id)
  },

  async loadDetail(id) {
    try {
      const res = await getStarshipHardwareFromDB()
      const raw = (res.vehicles || []).find((v) => Number(v.id) === Number(id))
      if (!raw) {
        this.setData({ loading: false, errorMessage: '未找到该硬件，数据可能尚未同步' })
        return
      }
      const rawImage = String(raw.image || '').trim()
      const vehicle = {
        ...raw,
        statusType: getStatusType(raw.status),
        rawImage,
        displayImage: rawImage
          ? resolveHardwareDisplayImage(rawImage, 'medium')
          : getFallbackImage(raw.category)
      }
      this.setData({
        loading: false,
        errorMessage: '',
        vehicle,
        navTitle: vehicle.name
      })
      this.loadTests(id)
    } catch (e) {
      this.setData({ loading: false, errorMessage: '数据加载失败，请稍后重试' })
    }
  },

  async loadTests(id) {
    try {
      const res = await getStarshipHardwareTestsFromDB()
      const tests = (res.tests || [])
        .filter((t) => Number(t.vehicleId) === Number(id))
        .map((t) => ({
          ...t,
          dateLabel: formatBeijingTime(t.date)
        }))
      this.setData({ tests, testsLoading: false })
    } catch (e) {
      this.setData({ tests: [], testsLoading: false })
    }
  },

  onHeroImageError() {
    const vehicle = this.data.vehicle
    if (!vehicle) return
    // 优先回退未压缩原图（避免 medium 压缩链失败误切成 B19/S39 占位）
    const raw = String(vehicle.rawImage || '').trim()
    if (raw && vehicle.displayImage !== raw) {
      this.setData({ 'vehicle.displayImage': raw })
      return
    }
    const fallback = getFallbackImage(vehicle.category)
    if (vehicle.displayImage === fallback) return
    this.setData({ 'vehicle.displayImage': fallback })
  },

  onCopyVideoLink(e) {
    const url = String((e.currentTarget.dataset.url || '')).trim()
    if (!url) {
      wx.showToast({ title: '暂无视频链接', icon: 'none' })
      return
    }
    // 剪贴板属隐私接口：未授权时框架会挂起本次调用并触发页面上的 privacy-modal，
    // 用户同意后自动继续（success），拒绝则走 fail → 弹窗兜底展示链接
    wx.setClipboardData({
      data: url,
      success: () => {
        // ≥2.1.0 基础库自带「内容已复制」原生 toast，错开 200ms 避免自定义提示被覆盖
        setTimeout(() => {
          wx.hideToast()
          wx.showToast({ title: '视频链接已复制', icon: 'none' })
        }, 200)
      },
      fail: () => {
        wx.showModal({ title: '视频链接', content: url, showCancel: false })
      }
    })
  },

  _buildShareTitle() {
    const v = this.data.vehicle
    if (!v) return '星舰硬件设施 | 火星探索日志'
    return `SpaceX ${v.name} · ${v.statusZh} | 火星探索日志`
  },

  _buildShareImage() {
    const v = this.data.vehicle
    return (v && v.displayImage) || ''
  },

  onShareAppMessage() {
    return {
      title: this._buildShareTitle(),
      path: withShareStampPath(`/subpackages/progress-extra/hardware-detail?id=${this._vehicleId}`, this),
      imageUrl: this._buildShareImage()
    }
  },

  onShareTimeline() {
    return {
      title: this._buildShareTitle(),
      query: withShareStampQuery(`id=${this._vehicleId}`, this),
      imageUrl: this._buildShareImage()
    }
  }
})
