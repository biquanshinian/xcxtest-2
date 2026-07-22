/**
 * 首页即将发射任务卡片（内容区）——供检查清单等页复用，保证回收/溅落图标与首页一致
 * 左侧火箭配置图与首页/任务详情头图共用 resolveMissionRocketImage，失败时强制重算
 */
const {
  resolveMissionRocketImage,
  shouldReplaceRocketImage
} = require('../../../../utils/util.js')
const { loadCloudMediaMap } = require('../../../../utils/image-config.js')
const { markDownloadFailed } = require('../../../../utils/download-fail-cache.js')

const DEFAULT_ROCKET_IMAGE = '火箭配置图/default.jpg'

function resolveCardRocketImage(item, forceRecompute) {
  if (!item || typeof item !== 'object') {
    return resolveMissionRocketImage(DEFAULT_ROCKET_IMAGE)
  }
  return resolveMissionRocketImage(
    item.rocketImage || item.image || '',
    item.rocketName,
    item.rocketConfiguration,
    !!forceRecompute
  )
}

Component({
  properties: {
    item: {
      type: Object,
      value: {}
    },
    index: {
      type: Number,
      value: 0
    },
    themeLight: {
      type: Boolean,
      value: false
    }
  },

  data: {
    displayRocketImage: ''
  },

  observers: {
    item(item) {
      const next = resolveCardRocketImage(item, true)
      if (next === this.data.displayRocketImage) return
      this.setData({ displayRocketImage: next || '' })
      this._rocketImageRetrying = false
    }
  },

  methods: {
    onTap() {
      const item = this.data.item || {}
      this.triggerEvent('cardtap', {
        id: item.id,
        type: item._detailType || 'upcoming'
      })
    },

    /**
     * 与首页 onImageError / 详情 onHeroImageError 同路径：
     * media map 未就绪时的假 URL → await map → 按火箭名强制 fuzzy 重算
     */
    async onRocketImageError() {
      if (this._rocketImageRetrying) return
      this._rocketImageRetrying = true

      const item = this.data.item || {}
      const failedImage = this.data.displayRocketImage || item.rocketImage || item.image || ''
      if (failedImage && /^https?:\/\//i.test(String(failedImage).trim())) {
        markDownloadFailed(String(failedImage).trim(), 404)
      }

      try {
        await loadCloudMediaMap()
      } catch (e) {}

      const fuzzy = resolveCardRocketImage(
        { ...item, rocketImage: failedImage, image: failedImage },
        true
      )
      let nextImage = fuzzy
      if (!nextImage || nextImage === failedImage) {
        nextImage = resolveMissionRocketImage(
          DEFAULT_ROCKET_IMAGE,
          item.rocketName,
          item.rocketConfiguration,
          true
        )
      }

      if (nextImage && shouldReplaceRocketImage(failedImage, nextImage)) {
        this.setData({ displayRocketImage: nextImage })
        this.triggerEvent('rocketimagefix', {
          id: item.id,
          rocketImage: nextImage
        })
      }
      this._rocketImageRetrying = false
    }
  }
})
