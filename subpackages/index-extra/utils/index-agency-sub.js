/**
 * 首页发射商筛选 chips / 提醒订阅交互（用户触发）
 * 主包 index.js 经 require.async + attachTo 委托；index-extra 已 preload。
 * 首屏列表过滤仍留在主包 applyUpcomingAgencyFilterToPatch。
 */
const {
  subscribeLaunch,
  unsubscribeLaunch,
  isSubscribed
} = require('../../../utils/subscribe.js')
const { peekOaAlertReady } = require('../../../utils/oa-alert.js')
const {
  gateCheck,
  getMembershipState,
  isProSync
} = require('../../../utils/membership.js')
const {
  isRemoteAgencyLogoUrl,
  persistAgencyLogoAfterRemoteLoad,
  invalidateAgencyLogoCache
} = require('../../../utils/agency-logo-cache.js')
const { ensureAgencyLogoBgTone } = require('../../../utils/agency-logo-bg.js')

const methods = {
  async subscribeReminderForMission(mission) {
    if (!mission || !mission.id) return false
    const ok = await subscribeLaunch(mission)
    if (ok) {
      this._invalidatePageSubscribedIdSet()
      const mid = String(mission.id)
      const cur = this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
      if (cur === mid) {
        this.setData({ _countdownSubscribed: true })
      }
      this._syncDisplayedUpcomingSwipeRowFlags()
      this._pulseBellRing(mission.id)
    }
    return !!ok
  },

  _pulseBellRing(missionId) {
    const id = missionId != null ? String(missionId) : ''
    if (!id) return
    this.setData({ _bellRing: true, bellRingId: id })
    if (this._bellRingTimer) clearTimeout(this._bellRingTimer)
    this._bellRingTimer = setTimeout(() => {
      this.setData({ _bellRing: false, bellRingId: '' })
      this._bellRingTimer = null
    }, 580)
  },

  async unsubscribeReminderForMission(missionId, options) {
    if (!missionId) return false
    const silent = !!(options && options.silent)
    const ok = await unsubscribeLaunch(missionId)
    if (ok) {
      this._invalidatePageSubscribedIdSet()
      const mid = String(missionId)
      const cur = this.data.launchData && this.data.launchData.id != null ? String(this.data.launchData.id) : ''
      if (cur === mid) {
        this.setData({ _countdownSubscribed: false })
      }
      this._syncDisplayedUpcomingSwipeRowFlags()
      if (!silent) wx.showToast({ title: '提醒已关闭', icon: 'none' })
    }
    return !!ok
  },

  async onMissionSwipeSubscribeTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const row = this._findUpcomingMissionRow(id)
    if (!row) return
    if (this._subscribeReminderBusy) return
    this._vibrateMedium()
    this._subscribeReminderBusy = true
    try {
      const oaReady = !!(this.data.oaAlertReady || peekOaAlertReady())
      if (oaReady) {
        // 服务号已覆盖发射前与结果：遗留小程序结果订阅可关，否则仅提示
        if (isSubscribed(id)) {
          await this.unsubscribeReminderForMission(id, { silent: true })
          wx.showToast({ title: '已关闭本任务小程序结果订阅（服务号仍有效）', icon: 'none' })
        } else {
          wx.showToast({ title: '服务号已覆盖发射前与结果通知', icon: 'none' })
        }
        return
      }
      if (isSubscribed(id)) {
        await this.unsubscribeReminderForMission(id)
      } else {
        await this.subscribeReminderForMission(row)
      }
    } finally {
      this._subscribeReminderBusy = false
    }
  },

  async onCountdownRemind() {
    if (this._subscribeReminderBusy) return
    const launch = this.data.launchData
    if (!launch || !launch.id) return
    this._vibrateMedium()
    this._subscribeReminderBusy = true
    try {
      const oaReady = !!(this.data.oaAlertReady || peekOaAlertReady())
      if (oaReady) {
        // 服务号已覆盖发射前与结果：遗留小程序结果订阅可关，否则仅提示
        if (isSubscribed(launch.id)) {
          await this.unsubscribeReminderForMission(launch.id, { silent: true })
          wx.showToast({ title: '已关闭本任务小程序结果订阅（服务号仍有效）', icon: 'none' })
        } else {
          wx.showToast({ title: '服务号已覆盖发射前与结果通知', icon: 'none' })
        }
        return
      }
      const on = this.data._countdownSubscribed || isSubscribed(launch.id)
      if (on) {
        await this.unsubscribeReminderForMission(launch.id)
      } else {
        await this.subscribeReminderForMission(launch)
      }
    } finally {
      this._subscribeReminderBusy = false
    }
  },

  onUpcomingAgencyChipsScroll(e) {
    if (this.data.missionSwipeOpenWxkey) this.closeMissionSwipeCells()
    if (this.data.missionType !== 'upcoming') return
    const left = Math.max(0, Number((e.detail && e.detail.scrollLeft) || 0))
    const stepPx = 52
    const bucket = Math.floor(left / stepPx)
    if (this._upcomingAgencyScrollHapticBucket == null) {
      this._upcomingAgencyScrollHapticBucket = bucket
      return
    }
    if (bucket === this._upcomingAgencyScrollHapticBucket) return
    this._upcomingAgencyScrollHapticBucket = bucket
    this._vibrateLight()
  },

  async onUpcomingAgencyChipTap(e) {
    if (this.data.missionSwipeOpenWxkey) this.closeMissionSwipeCells()
    const key = e.currentTarget.dataset.key
    if (key === undefined || key === null) return
    await this._selectUpcomingAgencyKey(key === '_all' ? '_all' : String(key))
  },

  async _selectUpcomingAgencyKey(keyStr) {
    if (!this.data.isProUser) {
      if (keyStr === '_all') return
      const allowed = await gateCheck('home_upcoming_agency_filter', '即将发射 · 按发射商筛选')
      if (!allowed) return
      try {
        await getMembershipState(true)
      } catch (e) {}
      if (!isProSync()) return
      const upgradedPatch = { isProUser: true, selectedUpcomingAgencyKey: keyStr }
      this.applyUpcomingAgencyFilterToPatch(upgradedPatch)
      this.setData(upgradedPatch, () => this.scheduleUpcomingAgencyChipsOverflowHint())
      return
    }

    const patch = { selectedUpcomingAgencyKey: keyStr }
    this.applyUpcomingAgencyFilterToPatch(patch)
    this.setData(patch, () => this.scheduleUpcomingAgencyChipsOverflowHint())
  },

  onAgencyChipLogoLoad(e) {
    const remoteUrl = (e.currentTarget.dataset.logoRemote || '').trim()
    if (!isRemoteAgencyLogoUrl(remoteUrl)) return
    const self = this
    // 与图鉴同链路：落盘本地路径 + 透明 logo 自动取色填底（tone 持久化，冷启动直接命中）
    persistAgencyLogoAfterRemoteLoad(remoteUrl, function (localPath) {
      if (!localPath) return
      self._applyAgencyChipLocalLogo(remoteUrl, localPath)
      ensureAgencyLogoBgTone(remoteUrl, localPath, function (tone) {
        if (tone) self._applyAgencyChipLogoBgTone(remoteUrl, tone)
      })
    })
  },

  onAgencyChipLogoError(e) {
    const remoteUrl = (e.currentTarget.dataset.logoRemote || '').trim()
    if (!isRemoteAgencyLogoUrl(remoteUrl)) return
    // 本地缓存文件损坏等：清索引回退远程 URL，tone 复位待重新采样
    invalidateAgencyLogoCache(remoteUrl)
    const chips = this.data.upcomingAgencyChipsDisplayed
    if (!Array.isArray(chips) || !chips.length) return
    let changed = false
    const next = chips.map(function (c) {
      if (c.logoRemoteSrc === remoteUrl && c.logoUrl !== remoteUrl) {
        changed = true
        return { ...c, logoUrl: remoteUrl, logoBgTone: '' }
      }
      return c
    })
    if (changed) {
      this.setData({ upcomingAgencyChipsDisplayed: next })
    }
  },

  _applyAgencyChipLocalLogo(remoteUrl, localPath) {
    const chips = this.data.upcomingAgencyChipsDisplayed
    if (!Array.isArray(chips) || !chips.length || !localPath) return
    let changed = false
    const next = chips.map(function (c) {
      if (c.logoRemoteSrc === remoteUrl && c.logoUrl !== localPath) {
        changed = true
        return { ...c, logoUrl: localPath }
      }
      return c
    })
    if (changed) {
      this.setData({ upcomingAgencyChipsDisplayed: next }, () => this.scheduleUpcomingAgencyChipsOverflowHint())
    }
  },

  _applyAgencyChipLogoBgTone(remoteUrl, tone) {
    const chips = this.data.upcomingAgencyChipsDisplayed
    if (!Array.isArray(chips) || !chips.length || !tone) return
    let changed = false
    const next = chips.map(function (c) {
      if ((c.logoRemoteSrc === remoteUrl || c.logoUrl === remoteUrl) && c.logoBgTone !== tone) {
        changed = true
        return { ...c, logoBgTone: tone }
      }
      return c
    })
    if (changed) {
      this.setData({ upcomingAgencyChipsDisplayed: next })
    }
  },

  scheduleUpcomingAgencyChipsOverflowHint() {
    if (this.data.missionType !== 'upcoming') return
    const self = this
    setTimeout(function () {
      self.updateUpcomingAgencyChipsOverflowHint()
    }, 0)
  },

  updateUpcomingAgencyChipsOverflowHint() {
    if (this.data.missionType !== 'upcoming') return
    const query = wx.createSelectorQuery().in(this)
    query.select('.upcoming-agency-scroll').boundingClientRect()
    query.select('.upcoming-agency-chips-row').boundingClientRect()
    query.exec((res) => {
      const scrollRect = res && res[0]
      const gridRect = res && res[1]
      const hasOverflow = !!(scrollRect && gridRect && gridRect.width > scrollRect.width + 2)
      if (hasOverflow !== this.data.upcomingAgencyChipsHasOverflow) {
        this.setData({ upcomingAgencyChipsHasOverflow: hasOverflow })
      }
    })
  },

  _syncUpcomingAgencyScrollHapticBaseline(chips) {
    const sig =
      Array.isArray(chips) && chips.length
        ? chips.map((c) => (c && c.key != null ? String(c.key) : '')).join('\x1e')
        : ''
    if (sig !== this._upcomingAgencyChipsHapticSig) {
      this._upcomingAgencyChipsHapticSig = sig
      this._upcomingAgencyScrollHapticBucket = null
    }
  },
}

function attachTo(page) {
  if (page.__agencySubAttached) return methods
  page.__agencySubMethods = methods
  Object.keys(methods).forEach((key) => {
    page[key] = methods[key]
  })
  page.__agencySubAttached = true
  return methods
}

module.exports = { attachTo, methods }
