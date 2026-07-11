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

/** 「星舰S40」/「助推器B20」：随后台 id 字段自动更新 */
function buildVehicleLabel(item, type) {
  const id = item && item.id ? String(item.id).trim().toUpperCase() : ''
  return (type === 'ship' ? '星舰' : '助推器') + id
}

/** 与 progress 页 normalizeStarshipStatusData 的 detail 部分保持一致 */
function buildDetail(item, type) {
  const detail = (item && item.detail) || {}
  const fallbackTitle = buildVehicleLabel(item, type)
  const fallbackSubtitle = type === 'ship' ? 'STARSHIP' : 'SUPER HEAVY'

  // 卡片缩略图作为头图兜底
  const images = []
  if (item) {
    if (Array.isArray(item.images)) images.push(...item.images)
    if (Array.isArray(item.previewImages)) images.push(...item.previewImages)
    if (item.image) images.unshift(item.image)
    const cloudImage = resolveCloudAsset(item, 'thumbnailMediaKey', 'thumbnailFallback')
    if (cloudImage) images.unshift(cloudImage)
  }
  const cardImage = images.map(normalizeImageUrl).filter(Boolean)[0] || getFallbackImage(type)

  return {
    title: detail.title || fallbackTitle,
    subtitle: detail.subtitle || fallbackSubtitle,
    statusText: detail.statusText || '活跃',
    summary: detail.summary || `${fallbackTitle}正在执行对应阶段的测试与验证任务。`,
    heroImage: resolveCloudAsset(detail, 'heroMediaKey', 'heroFallback') || cardImage,
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
        // 话题固定为「星舰S40」/「助推器B20」格式，随后台 id 自动更新
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
