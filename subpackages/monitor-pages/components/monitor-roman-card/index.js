const romanTracker = require('../../utils/roman-tracker.js')
const { romanTracker: ROMAN_CFG } = require('../../../../utils/config.js')
const { ROUTES, navigateTo } = require('../../../../utils/routes.js')
const { optimizeImageUrl, isCosOriginUrl } = require('../../../../utils/cos-url.js')
const { gateCheck, isProSync } = require('../../../../utils/membership.js')
const theme = require('../../../../utils/theme.js')

const LOCAL_CARD_BG = '/subpackages/monitor-pages/images/roman/roman-card-bg.jpg'
const GATE_PRODUCT_ID = 'roman_tracker'
const GATE_PRODUCT_NAME = '罗曼太空望远镜追踪'

function joinDesc(parts) {
  return (parts || []).filter(Boolean).join(' · ')
}

function heroCopy(phase, opts) {
  const summary = (opts && opts.summary) || {}
  const loading = !!(opts && opts.loading)
  const error = (opts && opts.error) || ''
  const dsnLine = (opts && opts.dsnLine) || ''
  const phaseSub = (opts && opts.phaseSub) || ''
  const live = phase === 'cruise' || phase === 'l2'
  let badgeText = 'NASA · RST'
  let heroDesc = phaseSub || '公开星历追踪'
  let ctaText = '查看任务详情'
  if (loading && live) {
    badgeText = 'NASA · HORIZONS'
    heroDesc = '正在同步 NASA / JPL 公开星历…'
  } else if (error) {
    badgeText = 'NASA · RST'
    heroDesc = error
  } else if (phase === 'before') {
    badgeText = 'NASA · UPCOMING'
    heroDesc = joinDesc([
      summary.launchTime ? ('发射 ' + summary.launchTime) : '',
      summary.vehicle,
      summary.destination
    ]) || '即将发射'
  } else if (phase === 'ended') {
    badgeText = 'NASA · ARCHIVE'
    ctaText = '查看任务档案'
    heroDesc = joinDesc([
      summary.launchTime ? ('发射 ' + summary.launchTime) : '',
      summary.endTime ? ('结束 ' + summary.endTime) : '',
      summary.destination
    ]) || '任务已结束'
  } else if (dsnLine) {
    badgeText = 'NASA · DSN'
  }
  return { badgeText, heroDesc, ctaText, isLive: live }
}

function fmtInt(n) {
  if (!isFinite(n)) return '—'
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    /** agency/nasa：任务结束后仍显示档案；monitor：结束后自动隐藏 */
    scene: { type: String, value: 'monitor' }
  },
  data: {
    visible: false,
    themeClass: '',
    phase: 'cruise',
    phaseSub: '',
    summary: null,
    loading: false,
    error: '',
    met: '—',
    velocityKmh: '—',
    distEarthKm: '—',
    progressPct: 0,
    showProgress: false,
    dsnLine: '',
    cardBg: LOCAL_CARD_BG,
    cardBgCos: '',
    badgeText: 'NASA · RST',
    heroDesc: '公开星历追踪',
    ctaText: '查看任务详情',
    isLive: true,
    isProUser: false
  },
  lifetimes: {
    attached() {
      this._detached = false
      try {
        this._safeSet({ themeClass: theme.getThemeClassSync() })
      } catch (_e) {}
      this._resolveCardBg()
      this._boot()
    },
    detached() {
      this._detached = true
      this._teardown()
    }
  },
  pageLifetimes: {
    show() {
      if (this._detached) return
      if (this.data.visible && this.data.isLive) {
        if (this._raw) this._startInterp()
        this._schedulePoll()
        if (!this._raw && !this._fetching) this._fetch(false)
        return
      }
      this._boot()
    },
    hide() {
      this._teardown()
    }
  },
  methods: {
    _safeSet(patch) {
      if (this._detached || !patch) return
      try {
        this.setData(patch)
      } catch (_e) {}
    },

    _resolveCardBg() {
      if (this._cosBgFailed) {
        this._safeSet({ cardBg: LOCAL_CARD_BG, cardBgCos: '' })
        return
      }
      const raw = String((ROMAN_CFG && ROMAN_CFG.cardBgUrl) || '').trim()
      if (!raw || !/^https?:\/\//i.test(raw)) {
        this._safeSet({ cardBg: LOCAL_CARD_BG, cardBgCos: '' })
        return
      }
      const probed = isCosOriginUrl(raw) ? optimizeImageUrl(raw, 'medium') : raw
      this._safeSet({
        cardBg: LOCAL_CARD_BG,
        cardBgCos: probed
      })
    },

    onCosBgReady() {
      if (this._detached || this._cosBgFailed) return
      const cos = this.data.cardBgCos
      if (cos && this.data.cardBg !== cos) this._safeSet({ cardBg: cos, cardBgCos: '' })
    },

    onCosBgError() {
      this._failCardBg()
    },

    onCardBgError() {
      this._failCardBg()
    },

    _failCardBg() {
      if (this._detached) return
      this._cosBgFailed = true
      if (this.data.cardBgCos) {
        this._safeSet({ cardBgCos: '' })
        return
      }
      if (this.data.cardBg && this.data.cardBg !== LOCAL_CARD_BG) {
        this._safeSet({ cardBg: LOCAL_CARD_BG })
        return
      }
      if (this.data.cardBg) this._safeSet({ cardBg: '' })
    },

    _canShow() {
      if (this.data.scene === 'agency' || this.data.scene === 'nasa') {
        return romanTracker.shouldShowRomanSection()
      }
      return romanTracker.shouldShowRomanOnMonitor()
    },

    _boot() {
      if (this._detached) return
      this._teardown()
      if (!this._canShow()) {
        if (this.data.visible) this._safeSet({ visible: false })
        return
      }
      const phase = romanTracker.getRomanMissionPhase()
      const live = phase === 'cruise' || phase === 'l2'
      const summary = romanTracker.getRomanMissionSummary() || null
      const phaseSub = romanTracker.getRomanPhaseSubtitle()
      const hasSnap = !!(this.data.met && this.data.met !== '—' && !this.data.error)
      const loading = live && !hasSnap
      const patch = Object.assign({
        visible: true,
        phase: phase,
        phaseSub: phaseSub,
        summary: summary,
        loading: loading,
        error: live ? this.data.error : '',
        isProUser: typeof isProSync === 'function' ? !!isProSync() : false
      }, heroCopy(phase, { summary: summary, phaseSub: phaseSub, loading: loading, error: live ? this.data.error : '' }))
      if (!live) {
        patch.loading = false
        patch.error = ''
        this._safeSet(patch)
        return
      }
      this._safeSet(patch)
      this._fetch(false)
      this._schedulePoll()
    },

    _teardown() {
      this._fetchSeq = (this._fetchSeq || 0) + 1
      this._fetching = false
      if (this._pollTimer) {
        clearInterval(this._pollTimer)
        this._pollTimer = null
      }
      this._stopInterp()
    },

    _schedulePoll() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer)
        this._pollTimer = null
      }
      if (this._detached || !this._canShow()) return
      const phase = romanTracker.getRomanMissionPhase()
      if (phase === 'before' || phase === 'ended') return
      const ms = Math.max(20000, Number((ROMAN_CFG || {}).pollIntervalMs) || 60000)
      this._pollTimer = setInterval(() => {
        if (this._detached) {
          this._teardown()
          return
        }
        if (!this._canShow() || romanTracker.getRomanMissionPhase() === 'ended') {
          this._boot()
          return
        }
        this._fetch(false)
      }, ms)
    },

    async _fetch(showLoading) {
      if (this._detached) return
      if (!this._canShow()) return
      const phase = romanTracker.getRomanMissionPhase()
      if (phase === 'before' || phase === 'ended') {
        this._boot()
        return
      }
      this._fetching = true
      const seq = (this._fetchSeq = (this._fetchSeq || 0) + 1)
      const hasSnap = !!(this.data.met && this.data.met !== '—' && !this.data.error)
      const summary = this.data.summary || romanTracker.getRomanMissionSummary() || {}
      const phaseSub = this.data.phaseSub || romanTracker.getRomanPhaseSubtitle()
      if (showLoading || !hasSnap) {
        this._safeSet(Object.assign({ loading: true, error: '' }, heroCopy(phase, {
          summary, phaseSub, loading: true, error: ''
        })))
      }
      try {
        const data = await romanTracker.fetchRomanBriefing()
        if (this._detached || seq !== this._fetchSeq) return
        if (!data || !data.ok) {
          const err = (data && data.error) ? String(data.error) : '数据不可用'
          if (showLoading || !hasSnap) {
            this._safeSet(Object.assign({ loading: false, error: err }, heroCopy(phase, {
              summary, phaseSub, loading: false, error: err
            })))
          } else {
            this._safeSet({ loading: false })
          }
          return
        }
        const nextPhase = data.phase || phase
        const nextSub = data.phaseSub || phaseSub
        const dsnLine = data.dsnLine || ''
        this._safeSet(Object.assign({
          loading: false,
          error: '',
          phase: nextPhase,
          phaseSub: nextSub,
          met: data.missionElapsedText || '—',
          velocityKmh: fmtInt(data.velocityKmh),
          distEarthKm: fmtInt(data.distanceFromEarthKm),
          progressPct: isFinite(data.progressPct) ? data.progressPct : 0,
          showProgress: nextPhase === 'cruise' || nextPhase === 'l2',
          dsnLine: dsnLine,
          isProUser: typeof isProSync === 'function' ? !!isProSync() : false
        }, heroCopy(nextPhase, { summary, phaseSub: nextSub, loading: false, error: '', dsnLine: dsnLine })))
        this._raw = {
          velocityKmh: data.velocityKmh || 0,
          distEarthKm: data.distanceFromEarthKm || 0,
          rangeRateKmS: isFinite(data.rangeRateKmS)
            ? data.rangeRateKmS
            : (data.velocityKmh || 0) / 3600,
          snapshotMs: Date.now()
        }
        this._startInterp()
      } catch (_e) {
        if (this._detached || seq !== this._fetchSeq) return
        if (showLoading || !hasSnap) {
          this._safeSet(Object.assign({ loading: false, error: '网络异常，请稍后重试' }, heroCopy(phase, {
            summary, phaseSub, loading: false, error: '网络异常，请稍后重试'
          })))
        } else {
          this._safeSet({ loading: false })
        }
      } finally {
        if (seq === this._fetchSeq) this._fetching = false
      }
    },

    retry() {
      if (this._detached) return
      this._fetch(true)
      this._schedulePoll()
    },

    async openDetail() {
      if (this._detached) return
      if (this._gateChecking) return
      this._gateChecking = true
      try {
        const allowed = await gateCheck(GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
        if (this._detached || !allowed) return
        navigateTo(ROUTES.ROMAN_DETAIL)
      } catch (_e) {
      } finally {
        this._gateChecking = false
      }
    },

    _startInterp() {
      this._stopInterp()
      if (this._detached || !this._raw) return
      this._interpTick()
      this._interpTimer = setInterval(() => this._interpTick(), 1000)
    },
    _stopInterp() {
      if (this._interpTimer) {
        clearInterval(this._interpTimer)
        this._interpTimer = null
      }
    },
    _interpTick() {
      if (this._detached) return
      const raw = this._raw
      if (!raw) return
      const now = Date.now()
      const launchMs = romanTracker.getRomanLaunchMs()
      let met = '—'
      if (isFinite(launchMs) && now >= launchMs) {
        let s = Math.floor((now - launchMs) / 1000)
        const d = Math.floor(s / 86400); s -= d * 86400
        const h = Math.floor(s / 3600); s -= h * 3600
        const m = Math.floor(s / 60); s -= m * 60
        met = pad2(d) + ':' + pad2(h) + ':' + pad2(m) + ':' + pad2(s)
      }
      const distEarth = raw.distEarthKm + (raw.rangeRateKmS || 0) * ((now - raw.snapshotMs) / 1000)
      const patch = {}
      if (this.data.met !== met) patch.met = met
      const distText = fmtInt(distEarth)
      if (this.data.distEarthKm !== distText) patch.distEarthKm = distText
      const velocityText = fmtInt(raw.velocityKmh)
      if (this.data.velocityKmh !== velocityText) patch.velocityKmh = velocityText
      if (Object.keys(patch).length) this._safeSet(patch)
    }
  }
})
