const artemisArow = require('../../utils/artemis-arow.js')
const { artemisArow: ARTEMIS_CFG } = require('../../../../utils/config.js')
const { ROUTES, navigateTo } = require('../../../../utils/routes.js')
const { gateCheck, isProSync } = require('../../../../utils/membership.js')
const theme = require('../../../../utils/theme.js')

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
    /** agency：发射商详情；nasa：NASA 数据中心月球探索 Tab */
    scene: { type: String, value: 'agency' }
  },
  data: {
    visible: false,
    themeClass: '',
    missionPhase: 'active',
    missionSummary: null,
    endedExpanded: false,
    loading: false,
    error: '',
    met: '',
    velocityKmh: '—',
    distEarthKm: '—',
    isProUser: false
  },
  lifetimes: {
    attached() {
      this._detached = false
      try {
        this._safeSet({ themeClass: theme.getThemeClassSync() })
      } catch (_e) {}
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

    _canShow() {
      return artemisArow.shouldShowArtemisArowSection()
    },

    _boot() {
      if (this._detached) return
      this._teardown()
      if (!this._canShow()) {
        if (this.data.visible) this._safeSet({ visible: false })
        return
      }
      const phase = artemisArow.getArtemisMissionPhase()
      const patch = {
        visible: true,
        missionPhase: phase,
        isProUser: typeof isProSync === 'function' ? !!isProSync() : false
      }
      if (phase !== 'active') {
        patch.loading = false
        patch.error = ''
        patch.missionSummary = artemisArow.getArtemisMissionSummary() || null
        this._safeSet(patch)
        return
      }
      if (!(this.data.met && this.data.met !== '—' && !this.data.error)) patch.loading = true
      this._safeSet(patch)
      this._fetch(false)
      this._schedulePoll()
    },

    _teardown() {
      this._fetchSeq = (this._fetchSeq || 0) + 1
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
      if (artemisArow.getArtemisMissionPhase() !== 'active') return
      const ms = Math.max(12000, Number((ARTEMIS_CFG || {}).pollIntervalMs) || 15000)
      this._pollTimer = setInterval(() => {
        if (this._detached) {
          this._teardown()
          return
        }
        if (!this._canShow() || artemisArow.getArtemisMissionPhase() !== 'active') {
          this._boot()
          return
        }
        this._fetch(false)
      }, ms)
    },

    async _fetch(showLoading) {
      if (this._detached) return
      if (!this._canShow() || artemisArow.getArtemisMissionPhase() !== 'active') {
        this._boot()
        return
      }
      const seq = (this._fetchSeq = (this._fetchSeq || 0) + 1)
      const hasSnap = !!(this.data.met && this.data.met !== '—' && !this.data.error)
      if (showLoading || !hasSnap) this._safeSet({ loading: true, error: '' })
      try {
        const data = await artemisArow.fetchArtemisIiBriefing()
        if (this._detached || seq !== this._fetchSeq) return
        if (!data || !data.ok) {
          if (showLoading || !hasSnap) {
            this._safeSet({
              loading: false,
              error: (data && data.error) ? String(data.error) : '数据不可用'
            })
          } else {
            this._safeSet({ loading: false })
          }
          return
        }
        this._safeSet({
          loading: false,
          error: '',
          met: data.missionElapsedText || '—',
          velocityKmh: fmtInt(data.velocityKmh),
          distEarthKm: fmtInt(data.distanceFromEarthKm),
          isProUser: typeof isProSync === 'function' ? !!isProSync() : false
        })
        this._raw = {
          velocityKmh: data.velocityKmh || 0,
          distEarthKm: data.distanceFromEarthKm || 0,
          snapshotMs: Date.now()
        }
        this._startInterp()
      } catch (_e) {
        if (this._detached || seq !== this._fetchSeq) return
        if (showLoading || !hasSnap) this._safeSet({ loading: false, error: '网络异常，请稍后重试' })
        else this._safeSet({ loading: false })
      }
    },

    retry() {
      if (this._detached) return
      this._fetch(true)
      this._schedulePoll()
    },

    async openDetail() {
      if (this._detached) return
      try {
        const allowed = await gateCheck('artemis_telemetry', 'Artemis 遥测面板')
        if (this._detached || !allowed) return
        navigateTo(ROUTES.ARTEMIS_DETAIL)
      } catch (_e) {}
    },

    toggleEnded() {
      if (this._detached) return
      this._safeSet({ endedExpanded: !this.data.endedExpanded })
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
      const launchMs = artemisArow.getArtemisLaunchMs()
      let met = '—'
      if (isFinite(launchMs) && now >= launchMs) {
        let s = Math.floor((now - launchMs) / 1000)
        const d = Math.floor(s / 86400); s -= d * 86400
        const h = Math.floor(s / 3600); s -= h * 3600
        const m = Math.floor(s / 60); s -= m * 60
        met = pad2(d) + ':' + pad2(h) + ':' + pad2(m) + ':' + pad2(s)
      }
      const vKmS = raw.velocityKmh / 3600
      const distEarth = raw.distEarthKm + vKmS * ((now - raw.snapshotMs) / 1000)
      const patch = {}
      if (this.data.met !== met) patch.met = met
      const velocityText = fmtInt(raw.velocityKmh)
      if (this.data.velocityKmh !== velocityText) patch.velocityKmh = velocityText
      const distText = fmtInt(distEarth)
      if (this.data.distEarthKm !== distText) patch.distEarthKm = distText
      if (Object.keys(patch).length) this._safeSet(patch)
    }
  }
})
