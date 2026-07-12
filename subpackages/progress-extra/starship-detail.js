const pageBase = require('../../utils/page-base.js')
const { getStarshipStatusFromDB } = require('../../utils/api-app-services.js')
const { resolveMediaUrl } = require('../../utils/image-config.js')

const B19_IMAGE_KEY = '最新版星舰组合体进展一二级图/b19_spacex3.webp'
const S39_IMAGE_KEY = '最新版星舰组合体进展一二级图/s39_spacex.webp'

function getFallbackImage(type) {
  return resolveMediaUrl(type === 'ship' ? S39_IMAGE_KEY : B19_IMAGE_KEY, '')
}

function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return ''
  const normalized = url.replace(/\\/g, '/')
  if (/^https?:\/\//.test(normalized) || /^cloud:\/\//.test(normalized) || /^wxfile:\/\//.test(normalized)) {
    return normalized
  }
  if (normalized.startsWith('/')) return normalized
  const resolved = resolveMediaUrl(normalized, '')
  return resolved || ''
}

function resolveCloudAsset(item, keyField, fallbackField) {
  const key = item[keyField]
  const fallback = item[fallbackField]
  if (key || fallback) {
    return normalizeImageUrl(resolveMediaUrl(key, fallback || ''))
  }
  return ''
}

/** 「星舰S40」/「助推器B20」：优先全称，其次短编号 */
function buildVehicleLabel(item, type) {
  const fullName = item && item.name ? String(item.name).trim() : ''
  if (fullName) return fullName
  const id = item && item.id ? String(item.id).trim().toUpperCase() : ''
  return (type === 'ship' ? '星舰' : '助推器') + id
}

/** 英文状态 → 中文标签（与硬件设施 statusZh 口径一致），映射不到返回空串 */
function getStatusZh(status) {
  const map = { ACTIVE: '活跃', DESTROYED: '已损毁', EXPENDED: '已消耗', RETIRED: '已退役' }
  return map[String(status || '').trim().toUpperCase()] || ''
}

/** 与 progress 页 normalizeStarshipStatusData 的 detail 部分保持一致 */
function buildDetail(item, type) {
  const detail = (item && item.detail) || {}
  const fallbackTitle = buildVehicleLabel(item, type)
  const fallbackSubtitle = type === 'ship' ? 'STARSHIP' : 'SUPER HEAVY'

  // 自动数据优先：NSF image/images 在前，后台 thumbnail 仅兜底
  const images = []
  if (item) {
    if (item.image) images.push(item.image)
    if (Array.isArray(item.images)) images.push(...item.images)
    if (Array.isArray(item.previewImages)) images.push(...item.previewImages)
    const cloudImage = resolveCloudAsset(item, 'thumbnailMediaKey', 'thumbnailFallback')
    if (cloudImage) images.push(cloudImage)
  }
  const autoImage = [...new Set(images.map(normalizeImageUrl).filter(Boolean))][0] || ''
  const manualHero = resolveCloudAsset(detail, 'heroMediaKey', 'heroFallback')

  return {
    title: detail.title || fallbackTitle,
    subtitle: detail.subtitle || fallbackSubtitle,
    statusText: detail.statusText || getStatusZh(item && item.status) || '活跃',
    summary: detail.summary || `${fallbackTitle}正在执行对应阶段的测试与验证任务。`,
    // 优先级：自动图 > 手动头图 > 静态占位
    heroImage: autoImage || manualHero || getFallbackImage(type),
    showChecklist: detail.showChecklist === true,
    checklist: Array.isArray(detail.checklist) ? detail.checklist : []
  }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/progress/progress',
  data: {
    loading: true,
    errorMessage: '',
    type: 'booster',
    detail: null,
    discussionTopic: '',
    navTitle: '进展详情',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    menuButtonWidth: 88
  },

  onLoad(options) {
    this.initUiShell()
    const type = options && options.type === 'ship' ? 'ship' : 'booster'
    this.setData({ type })
    this.loadDetail(type)
  },

  async loadDetail(type) {
    try {
      const data = await getStarshipStatusFromDB()
      const item = (data && data[type]) || null
      const detail = buildDetail(item, type)
      this.setData({
        loading: false,
        detail,
        navTitle: detail.title,
        // 话题优先全称（Ship 40），与硬件详情页话题口径一致；缺全称时回退「星舰S40」格式
        discussionTopic: buildVehicleLabel(item, type)
      })
    } catch (e) {
      this.setData({ loading: false, errorMessage: '数据加载失败，请稍后重试' })
    }
  },

  onHeroImageError() {
    this.setData({ 'detail.heroImage': getFallbackImage(this.data.type) })
  },

  onShareAppMessage() {
    const title = (this.data.detail && this.data.detail.title) || '星舰组合体进展'
    return {
      title: title + ' 进展详情 | 火星探索日志',
      path: '/subpackages/progress-extra/starship-detail?type=' + this.data.type
    }
  }
})
