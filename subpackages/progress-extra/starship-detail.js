const pageBase = require('../../utils/page-base.js')
const {
  getStarshipStatusFromDB,
  getStarshipHardwareFromDB
} = require('../../utils/api-app-services.js')
const { resolveMediaUrl } = require('../../utils/image-config.js')
const { getCachedMediaImage } = require('../../utils/icon-cache.js')

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

/** 与进度页一致：该分类下 Active 且 ordering 最小 */
function pickCurrentHardwareVehicle(vehicles, category) {
  const all = Array.isArray(vehicles) ? vehicles : []
  let best = null
  for (let i = 0; i < all.length; i++) {
    const v = all[i]
    if (!v || v.category !== category) continue
    if (String(v.status || '').toLowerCase() !== 'active') continue
    if (!best || v.ordering < best.ordering) best = v
  }
  return best
}

/**
 * 与 progress 页 normalizeStarshipStatusData 的 detail 部分保持一致；
 * hardwareImage：首页组合体卡片同源的 NSF 硬件 Active 图，优先于 starshipStatus 旧图
 */
function buildDetail(item, type, hardwareVehicle) {
  const detail = (item && item.detail) || {}
  const hwName = hardwareVehicle && hardwareVehicle.name
  const fallbackTitle = hwName
    ? buildVehicleLabel({ name: hwName }, type)
    : buildVehicleLabel(item, type)
  const fallbackSubtitle = type === 'ship' ? 'STARSHIP' : 'SUPER HEAVY'

  // 自动数据优先：硬件 Active 图（与首页 overlay 同源）> NSF status 图 > 后台 thumbnail
  const images = []
  if (hardwareVehicle && hardwareVehicle.image) {
    images.push(hardwareVehicle.image)
  }
  if (item) {
    if (item.image) images.push(item.image)
    if (Array.isArray(item.images)) images.push(...item.images)
    if (Array.isArray(item.previewImages)) images.push(...item.previewImages)
    const cloudImage = resolveCloudAsset(item, 'thumbnailMediaKey', 'thumbnailFallback')
    if (cloudImage) images.push(cloudImage)
  }
  const autoImage = [...new Set(images.map(normalizeImageUrl).filter(Boolean))][0] || ''
  const manualHero = resolveCloudAsset(detail, 'heroMediaKey', 'heroFallback')
  const statusFromHw = hardwareVehicle && (hardwareVehicle.statusZh || getStatusZh(hardwareVehicle.status))
  const summaryFromHw = hardwareVehicle && hardwareVehicle.notesZh

  return {
    title: detail.title || fallbackTitle,
    subtitle: detail.subtitle || fallbackSubtitle,
    statusText: detail.statusText || statusFromHw || getStatusZh(item && item.status) || '活跃',
    summary: detail.summary || summaryFromHw || `${fallbackTitle}正在执行对应阶段的测试与验证任务。`,
    // 优先级：硬件/自动图 > 手动头图 > 静态占位
    heroImage: autoImage || manualHero || getFallbackImage(type),
    rawHeroImage: autoImage || '',
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
      const [data, hwRes] = await Promise.all([
        getStarshipStatusFromDB(),
        getStarshipHardwareFromDB().catch(function () {
          return { vehicles: [] }
        })
      ])
      const item = (data && data[type]) || null
      const hardwareVehicle = pickCurrentHardwareVehicle(
        (hwRes && hwRes.vehicles) || [],
        type
      )
      const detail = buildDetail(item, type, hardwareVehicle)
      // HTTPS 可压缩缓存；cloud:// 原样（与首页卡片一致）
      if (detail.heroImage) {
        detail.heroImage = getCachedMediaImage(detail.heroImage, 'medium')
      }
      this.setData({
        loading: false,
        detail,
        navTitle: detail.title,
        // 话题优先全称（Ship 40），与硬件详情页话题口径一致；缺全称时回退「星舰S40」格式
        discussionTopic: buildVehicleLabel(
          hardwareVehicle ? { name: hardwareVehicle.name } : item,
          type
        )
      })
    } catch (e) {
      this.setData({ loading: false, errorMessage: '数据加载失败，请稍后重试' })
    }
  },

  onHeroImageError() {
    const detail = this.data.detail
    const raw = detail && detail.rawHeroImage
    if (raw && detail.heroImage !== raw) {
      this.setData({ 'detail.heroImage': raw })
      return
    }
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
