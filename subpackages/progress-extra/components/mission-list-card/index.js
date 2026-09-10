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
  const rocketEn =
    (item._langPack && item._langPack.rocketNameEn) ||
    item.rocketName ||
    ''
  return resolveMissionRocketImage(
    item.rocketImage || item.image || '',
    rocketEn,
    item.rocketConfiguration,
    !!forceRecompute
  )
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'apply-shared'
  },

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
    },
    enableFavorite: {
      type: Boolean,
      value: false
    },
    favorited: {
      type: Boolean,
      value: false
    },
    favAnimate: {
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
      const id = item.id == null ? '' : String(item.id).trim()
      if (!id) return
      const type = item._detailType === 'completed' ? 'completed' : 'upcoming'
      this.triggerEvent('cardtap', { id, type, launchId: id, launchType: type })
    },

    onFavoriteTap() {
      const item = this.data.item || {}
      const id = item.id == null ? '' : String(item.id).trim()
      if (!id) return
      try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
      const type = item._detailType === 'completed' ? 'completed' : 'upcoming'
      let favorited = false
      try {
        const { toggleMissionFavorite } = require('../../../../utils/favorites.js')
        favorited = !!toggleMissionFavorite(item, type)
      } catch (err) {
        try { wx.showToast({ title: '收藏失败，请重试', icon: 'none' }) } catch (e2) {}
        return
      }
      this.triggerEvent('favoritetap', { id, type, favorited })
      try { wx.showToast({ title: favorited ? '已收藏' : '已取消收藏', icon: 'none' }) } catch (e3) {}
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
