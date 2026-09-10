/**
 * 发射时间变更弹窗（分包 shared）
 *
 * 视觉：深空玻璃拟态，与 morning-briefing / renewal-reminder 同一体系。
 * 配图：直接复用首页任务卡已盖章的 rocketImage / launchAgencyImage（不另开解析旁路）。
 *
 * 模式：
 *   DEV  — NET_CHANGE_MODAL_DEV_MODE=true：等首页列表就绪后用真实配图 + mock 时间预览
 *   正式 — maybeShow() 拉 launch_data 改期行（与服务号同一信源）再扫未发射变更；
 *           由首页冷启动队列调用，同一进程只弹一次
 *
 * ★ 调试满意后把 NET_CHANGE_MODAL_DEV_MODE 改回 false 再上线
 */
const {
  resolveIndexCardRocketImage,
  hydrateNetChangePayloadFromCard,
  findHomepageCardForNetChange
} = require('../../utils/index-card-rocket-image.js')
const {
  isRemoteAgencyLogoUrl,
  resolveAgencyLogoForDisplay
} = require('../../../../utils/agency-logo-cache.js')
const { resolveAgencyLogoBgTone } = require('../../../../utils/agency-logo-bg.js')
const { enrichMissionsLaunchAgencyImages } = require('../../../../utils/upcoming-agency-logo-enrich.js')
const themeUtil = require('../../../../utils/theme.js')
const {
  scanAndPickTodayReminder,
  overlayServerNetChanges,
  fetchRecentNetChanges,
  markEventShown,
  pickDevPreviewPayloads,
  resolveNetChangeDisplay
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

function findHomepageCardForPayload(payload) {
  const page = getIndexPage()
  return findHomepageCardForNetChange(payload, page && page.data)
}

/** 与首页任务卡同一条链路：force 重算，允许 default 盖章升级为配置图 */
function resolveRocketSrc(payload) {
  return resolveIndexCardRocketImage(payload)
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
  const oldNet = p.oldNet || p.previousNet || p.prevNet
  const newNet = p.newNet || p.net || p.currentNet
  const display = resolveNetChangeDisplay(oldNet, newNet, {
    statusId: p.statusId,
    netPrecision: p.netPrecision,
    previousNet: oldNet,
    launchTime: newNet
  })
  const untrusted = p.newTimeUntrusted != null ? !!p.newTimeUntrusted : display.newTimeUntrusted
  const changeKind = untrusted
    ? 'delay'
    : p.changeKind === 'advance' || p.changeKind === 'delay'
      ? p.changeKind
      : display.kind

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
    oldNet: oldNet || '',
    newNet: newNet || '',
    oldTimeText: p.oldTimeText || formatNetChangeTime(oldNet),
    newTimeText: untrusted
      ? display.newTimeText || p.newTimeText || '时间待定'
      : p.newTimeText || formatNetChangeTime(newNet),
    newTimeLabel: untrusted ? display.newTimeLabel || '当前安排' : '新时间',
    newTimeUntrusted: untrusted,
    changeKind: changeKind,
    titleText: untrusted ? display.titleText || '发射已推迟' : p.titleText || display.titleText,
    deltaText: untrusted ? display.deltaText || '新时间待定' : p.deltaText || display.deltaText,
    _key: String(p.missionId || p.id || '') + '|' + String(oldNet || '') + '|' + String(newNet || '')
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
    oldNet: '',
    newNet: '',
    oldTimeText: '',
    newTimeText: '',
    newTimeLabel: '新时间',
    newTimeUntrusted: false,
    changeKind: 'delay',
    titleText: '发射时间变更',
    deltaText: '',
    cards: [],
    cardIndex: 0,
    cardCount: 0,
    swipeHintOn: false,
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
      if (this._hintStartTimer) {
        clearTimeout(this._hintStartTimer)
        this._hintStartTimer = null
      }
      if (this._hintEndTimer) {
        clearTimeout(this._hintEndTimer)
        this._hintEndTimer = null
      }
      this._setOverlayBlocking(false)
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
        let payload = pickDevPreviewPayloads(missions, DEV_MOCK_TIMES, launchData)
        if (!payload || !payload.length) {
          // 列表仍空：先出文案；列表就绪后再补一次配图
          payload = [
            {
              rocketName: '朱雀三号',
              rocketNameEn: 'ZhuQue-3',
              rocketImageName: 'zhuque-3',
              missionName: '第 2 次试飞',
              agencyName: '蓝箭航天',
              agencyAbbrev: 'LandSpace',
              oldNet: '2026-08-11T07:45:00+08:00',
              newNet: '2026-08-31T08:00:00+08:00'
            },
            {
              rocketName: '猎鹰9号',
              rocketNameEn: 'Falcon 9',
              missionName: 'Starlink',
              agencyName: 'SpaceX',
              oldNet: '2026-08-20T14:00:00+08:00',
              newNet: '2026-08-20T09:30:00+08:00'
            }
          ]
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
     * 正式入口：展示改期弹窗（单条或滑卡列表）
     * @param {Object|Object[]} payload
     * @returns {boolean}
     */
    show(payload) {
      const list = Array.isArray(payload) ? payload : payload ? [payload] : []
      if (!list.length) return false
      let themeClass = this.data.themeClass || ''
      try {
        themeClass = themeUtil.getThemeClassSync() || themeClass
      } catch (e) {}
      // 先锁遮罩再渲染；任何异常必须解锁，否则轮播被永久锁死且弹窗不出现
      this._setOverlayBlocking(true)
      try {
        const hydrated = []
        for (let i = 0; i < list.length; i++) {
          hydrated.push(hydrateNetChangePayloadFromCard(list[i], findHomepageCardForPayload(list[i])))
        }
        this._hydratedPayloads = hydrated
        const cards = []
        for (let i = 0; i < hydrated.length; i++) {
          cards.push(buildViewModel(hydrated[i]))
        }
        const first = cards[0]
        this._lastRocketNameEn = String(list[0].rocketNameEn || list[0].rocketImageName || list[0].rocketName || '').trim()
        this.setData({
          visible: true,
          themeClass: themeClass,
          devMode: !!NET_CHANGE_MODAL_DEV_MODE,
          cards: cards,
          cardIndex: 0,
          cardCount: cards.length,
          swipeHintOn: false,
          missionId: first.missionId,
          changeKind: first.changeKind,
          titleText: first.titleText,
          deltaText: first.deltaText
        })
        this._enrichCards(hydrated)
        this._startSwipeHint(cards.length > 1)
        this.triggerEvent('shown', {
          missionId: first.missionId,
          changeKind: first.changeKind,
          count: cards.length
        })
        return true
      } catch (e) {
        this._setOverlayBlocking(false)
        return false
      }
    },

    /** 首页任务卡火箭图盖章后，弹窗同步成同一张配置图 */
    resyncRocketImagesFromHomepage() {
      if (!this.data.visible) return
      const prev = this._hydratedPayloads
      if (!Array.isArray(prev) || !prev.length) return
      const hydrated = []
      for (let i = 0; i < prev.length; i++) {
        hydrated.push(hydrateNetChangePayloadFromCard(prev[i], findHomepageCardForPayload(prev[i])))
      }
      this._hydratedPayloads = hydrated
      const cards = this.data.cards || []
      const patch = {}
      for (let i = 0; i < hydrated.length; i++) {
        const nextSrc = resolveRocketSrc(hydrated[i])
        const cur = cards[i] && cards[i].rocketImage
        if (nextSrc && nextSrc !== cur) {
          patch['cards[' + i + '].rocketImage'] = nextSrc
        }
      }
      if (Object.keys(patch).length) this.setData(patch)
    },

    _clearSwipeHint() {
      if (this._hintStartTimer) {
        clearTimeout(this._hintStartTimer)
        this._hintStartTimer = null
      }
      if (this._hintEndTimer) {
        clearTimeout(this._hintEndTimer)
        this._hintEndTimer = null
      }
    },

    _startSwipeHint(enable) {
      const self = this
      self._clearSwipeHint()
      if (!enable) {
        if (self.data.swipeHintOn) self.setData({ swipeHintOn: false })
        return
      }
      self._hintStartTimer = setTimeout(function () {
        self._hintStartTimer = null
        if (!self.data.visible) return
        self.setData({ swipeHintOn: true })
        self._hintEndTimer = setTimeout(function () {
          self._hintEndTimer = null
          if (self.data.swipeHintOn) self.setData({ swipeHintOn: false })
        }, 1700)
      }, 80)
    },

    onSwiperTouch() {
      if (!this.data.swipeHintOn) return
      this._clearSwipeHint()
      this.setData({ swipeHintOn: false })
    },

    onCardChange(e) {
      const idx = e && e.detail && typeof e.detail.current === 'number' ? e.detail.current : 0
      const card = this.data.cards && this.data.cards[idx]
      if (!card) return
      this._lastRocketNameEn = String(card.rocketNameEn || card.rocketName || '').trim()
      this._clearSwipeHint()
      this.setData({
        cardIndex: idx,
        swipeHintOn: false,
        missionId: card.missionId,
        changeKind: card.changeKind,
        titleText: card.titleText,
        deltaText: card.deltaText
      })
    },

    _applyCardLogo(index, fields) {
      if (!fields) return
      this.setData({
        ['cards[' + index + '].agencyLogoUrl']: fields.agencyLogoUrl,
        ['cards[' + index + '].agencyLogoRemote']: fields.agencyLogoRemote,
        ['cards[' + index + '].logoBgTone']: fields.logoBgTone
      })
    },

    _enrichCards(payloads) {
      const self = this
      const missions = getUpcomingMissionsFromPage()
      const list = Array.isArray(payloads) ? payloads : []
      for (let i = 0; i < list.length; i++) {
        self._enrichOneCard(list[i], i, missions)
      }
    },

    _enrichOneCard(payload, index, missions) {
      const self = this
      const stub = {
        id: payload && (payload.missionId || payload.id),
        launchAgencyId: payload && payload.launchAgencyId,
        launchAgency: payload && (payload.agencyName || payload.launchAgency),
        launchAgencyAbbrev: payload && (payload.agencyAbbrev || payload.launchAgencyAbbrev),
        launchAgencyImage: (payload && (payload.launchAgencyImage || payload.agencyLogoUrl)) || ''
      }
      try {
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
            self._applyCardLogo(index, fields)
            if (fields.agencyLogoRemote) return
          }
        }
      } catch (e) {}
      if (!stub.launchAgencyId) return
      enrichMissionsLaunchAgencyImages([stub])
        .then(function (res) {
          if (!self.data.visible) return
          const enriched = res && res[0]
          const raw = enriched && enriched.launchAgencyImage
          if (!raw) return
          self._applyCardLogo(index, resolveAgencyLogoFields(raw))
        })
        .catch(function () {})
    },

    /**
     * 队列入口：扫描未发射任务的提前/延期。
     * 是否冷启动由首页队列把关（简报 → 续费 → 本弹窗）；DEV 走预览。
     * @param {Function} [isBlocked]
     * @returns {Promise<boolean>}
     */
    maybeShow(isBlocked) {
      const self = this
      if (self.data.visible || self._opening) return Promise.resolve(false)
      self._opening = true
      self._lastScanBlocked = false

      if (NET_CHANGE_MODAL_DEV_MODE) {
        // DEV 由 attached 自驱；队列再调一次时若尚未弹出可补一次
        return Promise.resolve().then(function () {
          if (typeof isBlocked === 'function' && isBlocked()) return false
          if (self.data.visible) return false
          self._scheduleDevPreview()
          return true
        }).then(function (shown) {
          self._opening = false
          return shown
        }, function () {
          self._opening = false
          return false
        })
      }

      return fetchRecentNetChanges()
        .then(function (pack) {
          const serverRows = pack && Array.isArray(pack.rows) ? pack.rows : []
          if (typeof isBlocked === 'function' && isBlocked()) {
            self._lastScanBlocked = true
            self._lastScanFromServer = false
            self._lastScanServerCount = 0
            return false
          }
          self._lastScanFromServer = !!(pack && pack.fromServer)
          self._lastScanServerCount = serverRows.length
          const missions = overlayServerNetChanges(getUpcomingMissionsFromPage(), serverRows)
          const payloads = scanAndPickTodayReminder(missions)
          if (!payloads || !payloads.length) return false
          if (typeof isBlocked === 'function' && isBlocked()) {
            self._lastScanBlocked = true
            self._lastScanFromServer = false
            self._lastScanServerCount = 0
            return false
          }
          const shown = self.show(payloads)
          if (shown) {
            for (let i = 0; i < payloads.length; i++) markEventShown(payloads[i])
          }
          return shown
        })
        .catch(function () {
          self._lastScanFromServer = false
          self._lastScanServerCount = 0
          self._lastScanBlocked = false
          return false
        })
        .then(function (shown) {
          self._opening = false
          return shown
        })
    },

    /** 列表就绪时只预热 launch_data，不抢简报/续费队列 */
    prewarm() {
      fetchRecentNetChanges().catch(function () {})
    },

    _setOverlayBlocking(on) {
      try {
        const app = typeof getApp === 'function' ? getApp() : null
        if (app && typeof app.setNetChangeModalVisible === 'function') {
          app.setNetChangeModalVisible(!!on)
        }
      } catch (e) {}
    },

    _armTapGuard() {
      try {
        const app = typeof getApp === 'function' ? getApp() : null
        if (app && typeof app.armPrivacyTapGuard === 'function') {
          app.armPrivacyTapGuard()
        }
      } catch (e) {}
    },

    _dismiss() {
      this._clearSwipeHint()
      this._setOverlayBlocking(false)
      this.setData({ visible: false, swipeHintOn: false })
    },

    /**
     * 点击必须在同步栈内关闭弹窗（放进 setTimeout 会被连点重置/异常打断，出现「点了不关」）。
     * 点穿防护不靠延迟关闭：先 arm 800ms 守卫，轮播侧还有 frozen 静态层 + disable-touch 兜底。
     */
    onConfirm() {
      try {
        if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light' })
      } catch (e) {}
      this._armTapGuard()
      const missionId = this.data.missionId
      this._dismiss()
      this.triggerEvent('confirm', { missionId: missionId })
      this.triggerEvent('closed', { reason: 'confirm', missionId: missionId })
    },

    onClose() {
      try {
        if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light' })
      } catch (e) {}
      this._armTapGuard()
      const missionId = this.data.missionId
      this._dismiss()
      this.triggerEvent('closed', { reason: 'close', missionId: missionId })
    },

    onRocketImageError(e) {
      const idx = e && e.currentTarget && e.currentTarget.dataset ? Number(e.currentTarget.dataset.index) : this.data.cardIndex
      const card = this.data.cards && this.data.cards[idx]
      const raw = (this._hydratedPayloads && this._hydratedPayloads[idx]) || {}
      const next = resolveIndexCardRocketImage(
        Object.assign({}, raw, { rocketImage: '', image: '' })
      )
      if (next && card && next !== card.rocketImage) {
        this.setData({ ['cards[' + idx + '].rocketImage']: next })
        return
      }
      if (card && card.rocketImage) this.setData({ ['cards[' + idx + '].rocketImage']: '' })
    },

    onAgencyLogoError(e) {
      const idx = e && e.currentTarget && e.currentTarget.dataset ? Number(e.currentTarget.dataset.index) : this.data.cardIndex
      const card = this.data.cards && this.data.cards[idx]
      if (!card || card.agencyLogoUrl === AGENCY_FALLBACK_LOGO) return
      this.setData({
        ['cards[' + idx + '].agencyLogoUrl']: AGENCY_FALLBACK_LOGO,
        ['cards[' + idx + '].agencyLogoRemote']: '',
        ['cards[' + idx + '].logoBgTone']: ''
      })
    },

    noop() {}
  }
})
