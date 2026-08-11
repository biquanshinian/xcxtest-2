/**
 * 发射时间变更弹窗（分包 shared）
 *
 * 视觉：深空玻璃拟态，与 morning-briefing / renewal-reminder 同一体系。
 * 配图：直接复用首页任务卡已盖章的 rocketImage / launchAgencyImage（不另开解析旁路）。
 *
 * 模式：
 *   DEV  — NET_CHANGE_MODAL_DEV_MODE=true：等首页列表就绪后用真实配图 + mock 时间预览
 *   正式 — maybeShow() 扫描当天改期，多个则取新 NET 最近的一条；一天只弹一次
 *
 * ★ 调试满意后把 NET_CHANGE_MODAL_DEV_MODE 改回 false 再上线
 */
const { getRocketImage, resolveMissionRocketImage } = require('../../../../utils/util.js')
const {
  isRemoteAgencyLogoUrl,
  resolveAgencyLogoForDisplay
} = require('../../../../utils/agency-logo-cache.js')
const { resolveAgencyLogoBgTone } = require('../../../../utils/agency-logo-bg.js')
const { enrichMissionsLaunchAgencyImages } = require('../../../../utils/upcoming-agency-logo-enrich.js')
const themeUtil = require('../../../../utils/theme.js')
const {
  scanAndPickTodayReminder,
  pickDevPreviewPayload,
  markPopupShownToday,
  isPopupShownToday
} = require('../../utils/net-change-reminder.js')

/** ★ 开发预览时改 true；生产保持 false */
const NET_CHANGE_MODAL_DEV_MODE = false

const AGENCY_FALLBACK_LOGO = '/images/icons/ic-rocket-outline.svg'

const DEV_MOCK_TIMES = {
  oldNet: '2026-08-11T07:45:00+08:00',
  newNet: '2026-08-31T08:00:00+08:00'
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatNetChangeTime(iso) {
  if (!iso) return '时间未知'
  const d = iso instanceof Date ? iso : new Date(iso)
  if (isNaN(d.getTime())) {
    if (typeof iso === 'string' && iso.trim()) return iso.trim()
    return '时间未知'
  }
  return (
    d.getFullYear() +
    '年' +
    (d.getMonth() + 1) +
    '月' +
    d.getDate() +
    '日 ' +
    WEEKDAYS[d.getDay()] +
    ' ' +
    pad2(d.getHours()) +
    ':' +
    pad2(d.getMinutes())
  )
}

function getIndexPage() {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    for (let i = pages.length - 1; i >= 0; i--) {
      const p = pages[i]
      const route = p && p.route != null ? String(p.route).replace(/^\//, '') : ''
      if (route === 'pages/index/index') return p
    }
    return pages.length ? pages[pages.length - 1] : null
  } catch (e) {
    return null
  }
}

function getUpcomingMissionsFromPage() {
  const page = getIndexPage()
  if (!page || !page.data) return []
  const list = page.data.upcomingMissions
  return Array.isArray(list) ? list : []
}

/** 与首页任务卡同源：优先已盖章 rocketImage；否则按英文名 forceRecompute */
function resolveRocketSrc(payload) {
  const stamped = (payload && (payload.rocketImage || payload.image)) || ''
  if (stamped && String(stamped).trim()) return String(stamped).trim()

  const en =
    (payload && (payload.rocketNameEn || payload.rocketImageName)) ||
    (payload && payload.rocketName) ||
    ''
  const cfg = (payload && payload.rocketConfiguration) || null
  if (en || cfg) {
    return resolveMissionRocketImage('', en, cfg, true) || getRocketImage(en) || ''
  }
  return ''
}

function resolveAgencyLogoFields(rawLogoUrl) {
  const raw = typeof rawLogoUrl === 'string' && rawLogoUrl.trim() ? rawLogoUrl.trim() : ''
  if (!raw) {
    return { agencyLogoUrl: AGENCY_FALLBACK_LOGO, agencyLogoRemote: '', logoBgTone: '' }
  }
  const remote = isRemoteAgencyLogoUrl(raw) ? raw : ''
  return {
    agencyLogoUrl: remote ? resolveAgencyLogoForDisplay(raw) : raw,
    agencyLogoRemote: remote,
    logoBgTone: remote ? resolveAgencyLogoBgTone(remote) : ''
  }
}

/** 单行标题：优先「型号 | 任务」；已含竖线则原样用，避免与火箭型号重复两行 */
function buildHeadlineText(rocketName, missionName) {
  const rocket = String(rocketName || '').trim()
  const mission = String(missionName || '').trim()
  if (mission && /\s*\|\s*/.test(mission)) return mission
  if (rocket && mission) {
    if (mission.indexOf(rocket) === 0) return mission
    return rocket + ' | ' + mission
  }
  return mission || rocket
}

function buildViewModel(payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const rocketName = String(p.rocketName || '').trim()
  const missionName = String(p.missionName || p.name || '').trim()
  const agencyName = String(p.agencyName || p.launchAgency || p.agencyAbbrev || '').trim()
  const agencyAbbrev = String(p.agencyAbbrev || p.launchAgencyAbbrev || '').trim()
  const rawLogo = p.agencyLogoUrl || p.launchAgencyImage || ''
  const logoFields = resolveAgencyLogoFields(rawLogo)

  return {
    visible: true,
    missionId: p.missionId || p.id || '',
    rocketName: rocketName,
    missionName: missionName,
    headlineText: buildHeadlineText(rocketName, missionName),
    agencyName: agencyName || agencyAbbrev,
    agencyAbbrev: agencyAbbrev,
    rocketImage: resolveRocketSrc(p),
    agencyLogoUrl: logoFields.agencyLogoUrl,
    agencyLogoRemote: logoFields.agencyLogoRemote,
    logoBgTone: logoFields.logoBgTone || p.logoBgTone || '',
    oldTimeText: p.oldTimeText || formatNetChangeTime(p.oldNet || p.previousNet || p.prevNet),
    newTimeText: p.newTimeText || formatNetChangeTime(p.newNet || p.net || p.currentNet)
  }
}

Component({
  data: {
    visible: false,
    themeClass: '',
    missionId: '',
    rocketName: '',
    missionName: '',
    headlineText: '',
    agencyName: '',
    agencyAbbrev: '',
    rocketImage: '',
    agencyLogoUrl: AGENCY_FALLBACK_LOGO,
    agencyLogoRemote: '',
    logoBgTone: '',
    oldTimeText: '',
    newTimeText: '',
    devMode: !!NET_CHANGE_MODAL_DEV_MODE
  },

  lifetimes: {
    attached() {
      try {
        this.setData({ themeClass: themeUtil.getThemeClassSync() || '' })
      } catch (e) {}
      if (NET_CHANGE_MODAL_DEV_MODE) {
        this._scheduleDevPreview()
      }
    },
    detached() {
      if (this._devTimer) {
        clearTimeout(this._devTimer)
        this._devTimer = null
      }
    }
  },

  pageLifetimes: {
    show() {
      try {
        this.setData({ themeClass: themeUtil.getThemeClassSync() || '' })
      } catch (e) {}
    }
  },

  methods: {
    isDevMode() {
      return !!NET_CHANGE_MODAL_DEV_MODE
    },

    _scheduleDevPreview() {
      const self = this
      let tries = 0
      const tick = function () {
        tries += 1
        const page = getIndexPage()
        const splashOn = !!(page && page.data && page.data.splashVisible)
        const missions = getUpcomingMissionsFromPage()
        const launchData = page && page.data ? page.data.launchData : null
        const hasImage =
          missions.some(function (m) { return m && (m.rocketImage || m.image) }) ||
          !!(launchData && (launchData.rocketImage || launchData.image))
        const ready = !splashOn && hasImage
        if (!ready && tries < 60) {
          self._devTimer = setTimeout(tick, 300)
          return
        }
        let payload = pickDevPreviewPayload(missions, DEV_MOCK_TIMES, launchData)
        if (!payload) {
          // 列表仍空：先出文案；列表就绪后再补一次配图
          payload = {
            rocketName: '朱雀三号',
            rocketNameEn: 'ZhuQue-3',
            rocketImageName: 'zhuque-3',
            missionName: '第 2 次试飞',
            agencyName: '蓝箭航天',
            agencyAbbrev: 'LandSpace',
            oldNet: DEV_MOCK_TIMES.oldNet,
            newNet: DEV_MOCK_TIMES.newNet
          }
          if (tries < 80) {
            self.show(payload)
            self._devTimer = setTimeout(tick, 400)
            return
          }
        }
        self.show(payload)
      }
      this._devTimer = setTimeout(tick, 400)
    },

    /**
     * 正式入口：展示一次改期弹窗
     * @param {Object} payload
     * @returns {boolean}
     */
    show(payload) {
      if (!payload || typeof payload !== 'object') return false
      let themeClass = this.data.themeClass || ''
      try {
        themeClass = themeUtil.getThemeClassSync() || themeClass
      } catch (e) {}
      const vm = buildViewModel(payload)
      vm.themeClass = themeClass
      vm.devMode = !!NET_CHANGE_MODAL_DEV_MODE
      this._lastRocketNameEn = String(payload.rocketNameEn || payload.rocketImageName || payload.rocketName || '').trim()
      this.setData(vm)
      this._enrichAgencyLogo(payload)
      this.triggerEvent('shown', {
        missionId: vm.missionId,
        oldTimeText: vm.oldTimeText,
        newTimeText: vm.newTimeText
      })
      return true
    },

    _enrichAgencyLogo(payload) {
      const self = this
      if (self.data.agencyLogoRemote) return

      const stub = {
        id: payload && (payload.missionId || payload.id),
        launchAgencyId: payload && payload.launchAgencyId,
        launchAgency: payload && (payload.agencyName || payload.launchAgency),
        launchAgencyAbbrev: payload && (payload.agencyAbbrev || payload.launchAgencyAbbrev),
        launchAgencyImage: payload && (payload.launchAgencyImage || payload.agencyLogoUrl) || ''
      }

      // 先从首页列表同 id / 同发射商捞已富化的 logo
      try {
        const missions = getUpcomingMissionsFromPage()
        for (let i = 0; i < missions.length; i++) {
          const m = missions[i]
          if (!m) continue
          const sameId = stub.id && String(m.id) === String(stub.id)
          const sameAgency =
            stub.launchAgencyId != null &&
            m.launchAgencyId != null &&
            String(m.launchAgencyId) === String(stub.launchAgencyId)
          if ((sameId || sameAgency) && m.launchAgencyImage) {
            const fields = resolveAgencyLogoFields(m.launchAgencyImage)
            self.setData({
              agencyLogoUrl: fields.agencyLogoUrl,
              agencyLogoRemote: fields.agencyLogoRemote,
              logoBgTone: fields.logoBgTone
            })
            if (fields.agencyLogoRemote) return
          }
        }
      } catch (e) {}

      if (!stub.launchAgencyId) return

      enrichMissionsLaunchAgencyImages([stub])
        .then(function (list) {
          if (!self.data.visible) return
          const enriched = list && list[0]
          const raw = enriched && enriched.launchAgencyImage
          if (!raw) return
          const fields = resolveAgencyLogoFields(raw)
          self.setData({
            agencyLogoUrl: fields.agencyLogoUrl,
            agencyLogoRemote: fields.agencyLogoRemote,
            logoBgTone: fields.logoBgTone
          })
        })
        .catch(function () {})
    },

    /**
     * 队列入口：扫描当天改期并弹最近一条。
     * DEV 模式下走预览（若已 visible 则跳过）。
     * @param {Function} [isBlocked]
     * @returns {Promise<boolean>}
     */
    maybeShow(isBlocked) {
      const self = this
      if (self.data.visible) return Promise.resolve(false)

      if (NET_CHANGE_MODAL_DEV_MODE) {
        // DEV 由 attached 自驱；队列再调一次时若尚未弹出可补一次
        return Promise.resolve().then(function () {
          if (typeof isBlocked === 'function' && isBlocked()) return false
          if (self.data.visible) return false
          self._scheduleDevPreview()
          return true
        })
      }

      return Promise.resolve()
        .then(function () {
          if (typeof isBlocked === 'function' && isBlocked()) return false
          if (isPopupShownToday()) return false
          const missions = getUpcomingMissionsFromPage()
          const payload = scanAndPickTodayReminder(missions)
          if (!payload) return false
          const shown = self.show(payload)
          if (shown) markPopupShownToday()
          return shown
        })
        .catch(function () {
          return false
        })
    },

    _dismiss() {
      if (!NET_CHANGE_MODAL_DEV_MODE) {
        try {
          markPopupShownToday()
        } catch (e) {}
      }
      this.setData({ visible: false })
    },

    onConfirm() {
      try {
        if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light' })
      } catch (e) {}
      const missionId = this.data.missionId
      this._dismiss()
      this.triggerEvent('confirm', { missionId: missionId })
      this.triggerEvent('closed', { reason: 'confirm', missionId: missionId })
    },

    onClose() {
      try {
        if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light' })
      } catch (e) {}
      const missionId = this.data.missionId
      this._dismiss()
      this.triggerEvent('closed', { reason: 'close', missionId: missionId })
    },

    onRocketImageError() {
      // 与首页卡片一致：破图时按英文名再算一次
      const en = this._lastRocketNameEn || this.data.rocketName
      const next = en ? resolveMissionRocketImage('', en, null, true) || getRocketImage(en) || '' : ''
      if (next && next !== this.data.rocketImage) {
        this.setData({ rocketImage: next })
        return
      }
      if (this.data.rocketImage) this.setData({ rocketImage: '' })
    },

    onAgencyLogoError() {
      if (this.data.agencyLogoUrl === AGENCY_FALLBACK_LOGO) return
      this.setData({
        agencyLogoUrl: AGENCY_FALLBACK_LOGO,
        agencyLogoRemote: '',
        logoBgTone: ''
      })
    },

    noop() {}
  }
})
