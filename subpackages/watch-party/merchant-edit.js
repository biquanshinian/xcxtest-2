/**
 * 商家自建/编辑观礼场次（全程手机端，无需后台）
 * - 任务信息默认自动获取（从即将发射任务中选择），也可切手动填写
 * - 观礼点坐标用地图选点（wx.chooseLocation），商家无需理解经纬度数字
 * - 大屏科普轮播支持手机相册上传发射配置图（云存储，图片进大屏轮播）
 * - 现场奖品由商家自配；短码与物料码由云端自动生成
 */
const pageBase = require('../../utils/page-base.js')
const composerInput = require('./utils/composer-input-behavior.js')
const watchParty = require('./utils/api.js')
const launchList = require('../../utils/api-launch-list.js')
const { getRocketImage } = require('../../utils/util.js')
const { guardWatchPartyPage } = require('../../utils/watch-party-feature.js')

const SCIENCE_IMAGES_MAX = 10
const PRIZES_MAX = 20

/** 与云端 SESSION_SERVICE_CATALOG 对齐；优先用接口返回的 serviceOptions */
const DEFAULT_SERVICE_OPTIONS = [
  { id: 'viewing', label: '发射观礼' },
  { id: 'viewing_factory', label: '发射观礼+火箭工厂参观' },
  { id: 'viewing_factory_stay', label: '发射观礼+火箭工厂参观+住宿' },
  { id: 'charter', label: '包车服务' }
]

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function formatMissionTime(launchTime) {
  if (!launchTime) return '时间待定'
  const d = new Date(launchTime)
  if (isNaN(d.getTime())) return '时间待定'
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function formatMissionOption(m) {
  const name = m.missionName || m.name || ''
  return `${m.rocketName || '未知火箭'} · ${name} · ${formatMissionTime(m.launchTime)}`
}

function resolveRocketThumb(rocketName, rocketImage) {
  const img = typeof rocketImage === 'string' ? rocketImage.trim() : ''
  if (img) return img
  const name = typeof rocketName === 'string' ? rocketName.trim() : ''
  return name ? (getRocketImage(name) || '') : ''
}

function buildServiceRows(options, selectedIds) {
  const opts = (Array.isArray(options) && options.length) ? options : DEFAULT_SERVICE_OPTIONS
  const set = {}
  ;(selectedIds || []).forEach((id) => { set[String(id)] = true })
  return opts.map((s) => ({
    id: s.id,
    label: s.label || s.id,
    selected: !!set[s.id]
  }))
}

Page({
  behaviors: [pageBase, composerInput],
  _fallbackTab: '/pages/index/index',

  data: {
    loading: true,
    error: '',
    editing: false,
    saving: false,

    /** 任务信息：auto = 从即将发射任务选择（默认），manual = 手动填写 */
    missionMode: 'auto',
    missionOptions: [],
    missionLabels: [],
    missionIndex: -1,
    missionLoading: true,
    showMissionSheet: false,
    /** 当前选中任务的火箭配置图（列表/选中卡共用） */
    selectedRocketImage: '',

    form: {
      title: '',
      missionId: '',
      missionName: '',
      rocketName: '',
      agencyId: '',
      agencyName: '',
      agencyAbbrev: '',
      rocketConfigId: '',
      padLocationId: '',
      padLocationName: '',
      launchTime: '',
      address: '',
      lat: 0,
      lng: 0,
      intro: '',
      notice: '',
      capacity: '',
      status: 'open',
      enabled: true,
      passEnabled: false,
      passHours: 12
    },
    manualDate: '',
    manualTime: '',
    located: false,
    /** 停车点：[{ name, lat, lng, walkMinutes, note }] */
    parkingSpots: [],

    sciencePointsText: '',
    scienceImages: [],
    uploading: false,

    /** 现场奖品抽奖：默认关；开启后需配置奖品 */
    prizeDrawEnabled: false,
    prizes: [],
    prizeUploading: false,

    /** 服务套餐多选 + 微信群二维码 + 管控区车辆预约网址 */
    serviceRows: buildServiceRows(DEFAULT_SERVICE_OPTIONS, []),
    selectedServices: [],
    wechatGroupQr: '',
    qrUploading: false,
    vehicleBookingUrl: ''
  },

  onLoad(options) {
    this.initUiShell()
    this._sessionId = (options && options.sessionId) || ''
    this.setData({ editing: !!this._sessionId })
    guardWatchPartyPage(this).then((ok) => {
      if (!ok || this._unloaded) return
      this.loadAll()
    })
  },

  onUnload() {
    this._unloaded = true
  },

  _safeSetData(patch) {
    if (this._unloaded) return
    this.setData(patch)
  },

  // 输入/键盘：复用 composer-input-behavior（星问 AI 成熟协议）

  // ── 加载：商家信息（模板）+ 场次（编辑回填）+ 任务列表 + 卡池 ──

  loadAll() {
    this.setData({ loading: true, error: '' })
    watchParty.fetchMerchantMe().then((res) => {
      if (this._unloaded) return
      this._merchant = res.merchant || null
      const sessions = res.sessions || []
      const session = this._sessionId
        ? sessions.find((s) => s.sessionId === this._sessionId)
        : null
      if (this._sessionId && !session) {
        this._safeSetData({ loading: false, error: '场次不存在或不属于当前商家' })
        return
      }
      // 一商家一场：禁止在已有场次时进入「新建」
      if (!this._sessionId && sessions.length > 0) {
        this._safeSetData({ loading: false, error: '' })
        wx.showToast({ title: '已有场次，请返回编辑或开启下一场', icon: 'none' })
        setTimeout(() => {
          if (this._unloaded) return
          wx.navigateBack({ fail: () => {
            wx.redirectTo({ url: '/subpackages/watch-party/merchant' })
          } })
        }, 400)
        return
      }
      this.fillForm(session)
      this._safeSetData({ loading: false })
      this.loadMissions(session)
    }).catch((err) => {
      if (this._unloaded) return
      const msg = err && err.code === 4011
        ? '请先在商家中心绑定商家编号'
        : (err && err.message) || '加载失败，请重试'
      this._safeSetData({ loading: false, error: msg })
    })
  },

  onRetry() {
    this.loadAll()
  },

  fillForm(session) {
    const m = this._merchant || {}
    if (!session) {
      // 新建：预填商家资料模板，商家只需选任务、按需微调
      this.setData({
        form: {
          title: '',
          missionId: '',
          missionName: '',
          rocketName: '',
          agencyId: '',
          agencyName: '',
          agencyAbbrev: '',
          rocketConfigId: '',
          padLocationId: '',
          padLocationName: '',
          launchTime: '',
          address: m.address || '',
          lat: m.lat || 0,
          lng: m.lng || 0,
          intro: m.intro || '',
          notice: m.notice || '',
          capacity: '',
          status: 'open',
          enabled: true,
          passEnabled: false,
          passHours: 12
        },
        located: !!(m.lat && m.lng),
        parkingSpots: Array.isArray(m.parkingSpots)
          ? m.parkingSpots.map((p) => ({
            name: p.name || '',
            lat: p.lat || 0,
            lng: p.lng || 0,
            walkMinutes: p.walkMinutes || '',
            note: p.note || ''
          }))
          : [],
        missionMode: 'auto',
        selectedRocketImage: '',
        sciencePointsText: '',
        scienceImages: [],
        prizeDrawEnabled: false,
        prizes: [],
        serviceRows: buildServiceRows(DEFAULT_SERVICE_OPTIONS, []),
        selectedServices: [],
        wechatGroupQr: '',
        vehicleBookingUrl: ''
      })
      return
    }
    const patch = {
      form: {
        title: session.title || '',
        missionId: session.missionId || '',
        missionName: session.missionName || '',
        rocketName: session.rocketName || '',
        agencyId: session.agencyId || '',
        agencyName: session.agencyName || '',
        agencyAbbrev: session.agencyAbbrev || '',
        rocketConfigId: session.rocketConfigId || '',
        padLocationId: session.padLocationId || '',
        padLocationName: session.padLocationName || '',
        launchTime: session.launchTime || '',
        address: session.address || '',
        lat: session.lat || 0,
        lng: session.lng || 0,
        intro: session.intro || '',
        notice: session.notice || '',
        capacity: session.capacity ? String(session.capacity) : '',
        status: session.status || 'open',
        enabled: session.enabled !== false,
        passEnabled: session.passEnabled === true,
        passHours: Math.min(48, Math.max(1, Number(session.passHours || 12) || 12))
      },
      located: !!(session.lat && session.lng),
      parkingSpots: Array.isArray(session.parkingSpots)
        ? session.parkingSpots.map((p) => ({
          name: p.name || '',
          lat: p.lat || 0,
          lng: p.lng || 0,
          walkMinutes: p.walkMinutes ? String(p.walkMinutes) : '',
          note: p.note || ''
        }))
        : [],
      // 已填过任务信息的场次进手动模式，避免误覆盖
      missionMode: (session.missionId || session.rocketName || session.missionName) ? 'manual' : 'auto',
      selectedRocketImage: resolveRocketThumb(session.rocketName, ''),
      sciencePointsText: (session.sciencePoints || []).join('\n'),
      scienceImages: (session.scienceImages || []).slice(),
      prizeDrawEnabled: session.prizeDrawEnabled === true,
      prizes: Array.isArray(session.prizes)
        ? session.prizes.map((p, i) => ({
          id: p.id || '',
          name: p.name || '',
          image: p.image || '',
          stock: p.stock != null ? String(p.stock) : '1',
          remaining: p.remaining != null ? Number(p.remaining) : Number(p.stock) || 0,
          valueYuan: p.valueYuan != null && p.valueYuan !== '' ? String(p.valueYuan) : '',
          sort: Number(p.sort) || i
        }))
        : [],
      selectedServices: Array.isArray(session.services)
        ? session.services.map((s) => (typeof s === 'string' ? s : (s && s.id))).filter(Boolean)
        : [],
      wechatGroupQr: session.wechatGroupQr || '',
      vehicleBookingUrl: session.vehicleBookingUrl || ''
    }
    const svcOpts = (Array.isArray(session.serviceOptions) && session.serviceOptions.length)
      ? session.serviceOptions
      : DEFAULT_SERVICE_OPTIONS
    patch.serviceRows = buildServiceRows(svcOpts, patch.selectedServices)
    if (session.launchTime) {
      const d = new Date(session.launchTime)
      if (!isNaN(d.getTime())) {
        patch.manualDate = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
        patch.manualTime = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
      }
    }
    this.setData(patch)
  },

  loadMissions(session) {
    launchList.getUpcomingMissions(30, 0).then((res) => {
      if (this._unloaded) return
      const options = (res && res.list ? res.list : [])
        .filter((x) => x && x.launchTime)
        .map((x) => ({
          missionId: String(x.id || ''),
          name: x.name || '',
          missionName: x.missionName || '',
          rocketName: x.rocketName || '',
          launchTime: x.launchTime || '',
          launchTimeText: formatMissionTime(x.launchTime),
          rocketImage: resolveRocketThumb(x.rocketName, x.rocketImage),
          agencyId: x.launchAgencyId != null ? String(x.launchAgencyId) : '',
          agencyName: x.launchAgency || '',
          agencyAbbrev: x.launchAgencyAbbrev || '',
          rocketConfigId: x.rocketConfigId != null ? String(x.rocketConfigId) : '',
          padLocationId: x.padLocationId != null ? String(x.padLocationId) : '',
          padLocationName: x.padLocationName || '',
          label: ''
        }))
      options.forEach((o) => { o.label = formatMissionOption(o) })
      let missionIndex = -1
      let selectedRocketImage = this.data.selectedRocketImage || ''
      if (session && session.missionId) {
        missionIndex = options.findIndex((o) => o.missionId === session.missionId)
        if (missionIndex >= 0) selectedRocketImage = options[missionIndex].rocketImage || selectedRocketImage
      } else if (this.data.form.missionId) {
        missionIndex = options.findIndex((o) => o.missionId === this.data.form.missionId)
        if (missionIndex >= 0) selectedRocketImage = options[missionIndex].rocketImage || selectedRocketImage
      }
      this._safeSetData({
        missionOptions: options,
        missionLabels: options.map((o) => o.label),
        missionIndex,
        selectedRocketImage,
        missionLoading: false
      })
    }).catch(() => {
      this._safeSetData({ missionLoading: false })
    })
  },

  // ── 任务信息 ──

  onMissionModeTap(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode && mode !== this.data.missionMode) {
      this.setData({ missionMode: mode, showMissionSheet: false })
    }
  },

  onOpenMissionSheet() {
    if (this.data.missionLoading) return
    if (!this.data.missionOptions.length) {
      wx.showToast({ title: '任务列表暂不可用，请切「手动填写」', icon: 'none' })
      return
    }
    this.setData({ showMissionSheet: true })
  },

  onCloseMissionSheet() {
    this.setData({ showMissionSheet: false })
  },

  preventMove() {},

  onMissionPick(e) {
    // 兼容旧 native picker；现用自定义弹层 onMissionSelect
    const idx = Number(e.detail.value)
    this._applyMissionIndex(idx)
  },

  onMissionSelect(e) {
    const idx = Number(e.currentTarget.dataset.index)
    this._applyMissionIndex(idx)
    this.setData({ showMissionSheet: false })
  },

  _applyMissionIndex(idx) {
    const opt = this.data.missionOptions[idx]
    if (!opt) return
    const patch = {
      missionIndex: idx,
      selectedRocketImage: opt.rocketImage || resolveRocketThumb(opt.rocketName, ''),
      'form.missionId': opt.missionId,
      'form.missionName': opt.missionName || opt.name,
      'form.rocketName': opt.rocketName,
      'form.launchTime': opt.launchTime,
      'form.agencyId': opt.agencyId || '',
      'form.agencyName': opt.agencyName || '',
      'form.agencyAbbrev': opt.agencyAbbrev || '',
      'form.rocketConfigId': opt.rocketConfigId || '',
      'form.padLocationId': opt.padLocationId || '',
      'form.padLocationName': opt.padLocationName || ''
    }
    if (!this.data.form.title) {
      patch['form.title'] = `${opt.rocketName || '火箭'}发射观礼`
    }
    this.setData(patch)
  },

  onManualDateChange(e) {
    this.setData({ manualDate: e.detail.value })
    this._composeManualTime()
  },

  onManualTimeChange(e) {
    this.setData({ manualTime: e.detail.value })
    this._composeManualTime()
  },

  _composeManualTime() {
    const { manualDate, manualTime } = this.data
    if (!manualDate) return
    const d = new Date(`${manualDate}T${manualTime || '00:00'}:00+08:00`)
    if (!isNaN(d.getTime())) {
      this.setData({ 'form.launchTime': d.toISOString() })
    }
  },

  /** 文字输入额外 patch：改火箭名时刷新缩略图（基座 onTextInput 在 composer-input-behavior） */
  _onTextInputPatch(path, value) {
    if (path === 'form.rocketName') {
      return { selectedRocketImage: resolveRocketThumb(value, '') }
    }
    return null
  },

  onStatusToggle(e) {
    this.setData({ 'form.status': e.detail.value ? 'open' : 'closed' })
  },

  onEnabledToggle(e) {
    this.setData({ 'form.enabled': !!e.detail.value })
  },

  onPassToggle(e) {
    const on = !!e.detail.value
    const patch = { 'form.passEnabled': on }
    if (on && !(Number(this.data.form.passHours) > 0)) patch['form.passHours'] = 12
    this.setData(patch)
  },

  onPassHoursChange(e) {
    const v = Math.min(48, Math.max(1, Number(e.detail.value) || 12))
    this.setData({ 'form.passHours': v })
  },

  // ── 停车点 ──

  onAddParking() {
    const list = (this.data.parkingSpots || []).slice()
    if (list.length >= 10) {
      wx.showToast({ title: '最多添加 10 个停车点', icon: 'none' })
      return
    }
    list.push({ name: '', lat: 0, lng: 0, walkMinutes: '', note: '' })
    this.setData({ parkingSpots: list })
  },

  onRemoveParking(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const list = (this.data.parkingSpots || []).slice()
    if (idx < 0 || idx >= list.length) return
    list.splice(idx, 1)
    this.setData({ parkingSpots: list })
  },

  onChooseParkingLocation(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const spot = (this.data.parkingSpots || [])[idx]
    if (!spot) return
    this._runChooseLocation({
      lat: spot.lat,
      lng: spot.lng,
      onOk: (res) => {
        const patch = {
          [`parkingSpots[${idx}].lat`]: res.latitude,
          [`parkingSpots[${idx}].lng`]: res.longitude
        }
        if (!String(spot.name || '').trim() && res.name) {
          patch[`parkingSpots[${idx}].name`] = String(res.name).slice(0, 40)
        }
        this._safeSetData(patch)
        wx.showToast({ title: '停车点已定位', icon: 'success' })
      }
    })
  },

  // ── 地图选点（商家不用懂坐标数字） ──

  onChooseLocation() {
    const form = this.data.form || {}
    this._runChooseLocation({
      lat: form.lat,
      lng: form.lng,
      onOk: (res) => {
        const patch = {
          'form.lat': res.latitude,
          'form.lng': res.longitude,
          located: true
        }
        if (!form.address) {
          patch['form.address'] = [res.address, res.name].filter(Boolean).join(' ') || res.name || ''
        }
        this._safeSetData(patch)
        wx.showToast({ title: '定位成功', icon: 'success' })
      }
    })
  },

  _runChooseLocation({ lat, lng, onOk }) {
    if (typeof wx.chooseLocation !== 'function') {
      wx.showToast({ title: '当前微信版本不支持地图选点', icon: 'none' })
      return
    }
    const run = () => {
      if (this._unloaded) return
      const callOpts = {
        success: (res) => {
          if (this._unloaded || !res) return
          if (typeof onOk === 'function') onOk(res)
        },
        fail: (err) => {
          if (this._unloaded) return
          this._onChooseLocationFail(err)
        }
      }
      if (lat && lng) {
        callOpts.latitude = lat
        callOpts.longitude = lng
      }
      wx.chooseLocation(callOpts)
    }

    // 先走隐私授权（页面已挂 privacy-modal）；后台未声明隐私类型时仍会失败，见 fail 提示
    const app = typeof getApp === 'function' ? getApp() : null
    if (app && typeof app.ensurePrivacyAuthorized === 'function') {
      app.ensurePrivacyAuthorized().then((r) => {
        if (r && r.ok === false && r.declined) {
          wx.showToast({ title: '需要同意隐私协议才能选点', icon: 'none' })
          return
        }
        run()
      }).catch(() => run())
      return
    }
    run()
  },

  _onChooseLocationFail(err) {
    const msg = (err && err.errMsg) || ''
    // 用户主动取消选点：不打扰
    if (/cancel/i.test(msg)) return
    if (/auth|deny/i.test(msg)) {
      wx.showModal({
        title: '需要位置权限',
        content: '地图选点需要位置权限，请在设置中开启后重试。',
        confirmText: '去设置',
        success: (r) => {
          if (r.confirm) wx.openSetting({})
        }
      })
      return
    }
    // 后台隐私指引未声明「收集你选择的位置信息」时微信返回此错（errno 112）
    if (/privacy agreement|not declared|privacy/i.test(msg) || (err && Number(err.errno) === 112)) {
      wx.showModal({
        title: '选点接口未声明',
        content: '请在微信公众平台 → 设置 → 服务内容声明 → 用户隐私保护指引中，增加并声明「收集你选择的位置信息」（对应 wx.chooseLocation）。保存审核通过后稍等再生效。另请确认「开发管理 → 接口设置」已开通位置接口。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    // 接口未开通等
    if (/api banned|no permission|not authorized|未开通|没有权限/i.test(msg)) {
      wx.showModal({
        title: '位置接口未开通',
        content: '请在微信公众平台 → 开发管理 → 接口设置中申请开通「选择位置」相关接口，通过后再试。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    wx.showToast({
      title: '选点失败：' + (msg.replace(/^chooseLocation:fail\s*/i, '') || '请稍后重试'),
      icon: 'none',
      duration: 3000
    })
  },

  onOpenLocationPreview() {
    const form = this.data.form || {}
    const lat = form.lat
    const lng = form.lng
    if (!lat || !lng) return
    if (typeof wx.openLocation !== 'function') {
      wx.showToast({ title: '当前微信版本不支持打开地图', icon: 'none' })
      return
    }
    wx.openLocation({
      latitude: lat,
      longitude: lng,
      name: form.title || '观礼点',
      address: form.address || '',
      fail: () => {
        wx.showToast({ title: '打开地图失败', icon: 'none' })
      }
    })
  },

  // ── 大屏配置图：手机相册上传 → 云存储 ──

  onAddImages() {
    if (this.data.uploading) return
    const remain = SCIENCE_IMAGES_MAX - (this.data.scienceImages || []).length
    if (remain <= 0) {
      wx.showToast({ title: `最多上传 ${SCIENCE_IMAGES_MAX} 张`, icon: 'none' })
      return
    }
    if (typeof wx.chooseMedia !== 'function') {
      wx.showToast({ title: '当前微信版本不支持选图', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        if (this._unloaded) return
        const files = ((res && res.tempFiles) || []).map((f) => f && f.tempFilePath).filter(Boolean)
        if (files.length) this._uploadImages(files)
      },
      fail: (err) => {
        if (this._unloaded) return
        const msg = (err && err.errMsg) || ''
        if (/cancel/i.test(msg)) return
        if (/privacy agreement|not declared|privacy/i.test(msg) || (err && Number(err.errno) === 112)) {
          wx.showModal({
            title: '选图接口未声明',
            content: '请在微信公众平台 → 用户隐私保护指引中声明「收集你选中的照片或视频信息」（对应 wx.chooseMedia），审核通过后再试。',
            showCancel: false,
            confirmText: '知道了'
          })
          return
        }
        wx.showToast({ title: '选图失败，请重试', icon: 'none' })
      }
    })
  },

  _uploadImages(paths) {
    this._safeSetData({ uploading: true })
    wx.showLoading({ title: '上传中…', mask: true })
    const uploadOne = (filePath) => new Promise((resolve) => {
      const extMatch = /\.(\w+)$/.exec(filePath || '')
      const ext = (extMatch && extMatch[1].toLowerCase()) || 'jpg'
      if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
        resolve('')
        return
      }
      wx.cloud.uploadFile({
        cloudPath: `watch_party/science/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
        filePath,
        success: (res) => resolve((res && res.fileID) || ''),
        fail: () => resolve('')
      })
    })
    // 顺序上传（现场弱网下比并发稳）
    const results = []
    const run = (paths || []).reduce(
      (p, path) => p.then(() => uploadOne(path)).then((id) => { results.push(id) }),
      Promise.resolve()
    )
    run.then(() => {
      try { wx.hideLoading() } catch {}
      if (this._unloaded) return
      const okIds = results.filter(Boolean)
      const failCount = results.length - okIds.length
      const prev = this.data.scienceImages || []
      this._safeSetData({
        uploading: false,
        scienceImages: prev.concat(okIds).slice(0, SCIENCE_IMAGES_MAX)
      })
      if (failCount > 0) {
        wx.showToast({ title: `${failCount} 张上传失败，请重试`, icon: 'none' })
      }
    }).catch(() => {
      try { wx.hideLoading() } catch {}
      this._safeSetData({ uploading: false })
      wx.showToast({ title: '上传失败，请重试', icon: 'none' })
    })
  },

  onRemoveImage(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const list = this.data.scienceImages.slice()
    if (idx >= 0 && idx < list.length) {
      list.splice(idx, 1)
      this.setData({ scienceImages: list })
    }
  },

  onPreviewImage(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const list = this.data.scienceImages
    if (!list.length) return
    wx.previewImage({ current: list[idx] || list[0], urls: list, fail: () => {} })
  },

  // ── 现场奖品 ──

  onPrizeDrawToggle(e) {
    this.setData({ prizeDrawEnabled: !!e.detail.value })
  },

  onAddPrize() {
    const list = (this.data.prizes || []).slice()
    if (list.length >= PRIZES_MAX) {
      wx.showToast({ title: `最多添加 ${PRIZES_MAX} 件奖品`, icon: 'none' })
      return
    }
    list.push({
      id: '',
      name: '',
      image: '',
      stock: '1',
      remaining: 1,
      valueYuan: '',
      sort: list.length
    })
    this.setData({ prizes: list })
  },

  onRemovePrize(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const list = (this.data.prizes || []).slice()
    if (idx < 0 || idx >= list.length) return
    list.splice(idx, 1)
    list.forEach((p, i) => { p.sort = i })
    this.setData({ prizes: list })
  },

  onMovePrize(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const dir = e.currentTarget.dataset.dir
    const list = (this.data.prizes || []).slice()
    const j = dir === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || j < 0 || j >= list.length) return
    const tmp = list[idx]
    list[idx] = list[j]
    list[j] = tmp
    list.forEach((p, i) => { p.sort = i })
    this.setData({ prizes: list })
  },

  onChoosePrizeImage(e) {
    const idx = Number(e.currentTarget.dataset.index)
    if (this.data.prizeUploading) return
    if (typeof wx.chooseMedia !== 'function') {
      wx.showToast({ title: '当前微信版本不支持选图', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        if (this._unloaded) return
        const path = res && res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) return
        this._uploadPrizeImage(idx, path)
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (/cancel/i.test(msg)) return
        wx.showToast({ title: '选图失败，请重试', icon: 'none' })
      }
    })
  },

  _uploadPrizeImage(idx, filePath) {
    this._safeSetData({ prizeUploading: true })
    wx.showLoading({ title: '上传中…', mask: true })
    const extMatch = /\.(\w+)$/.exec(filePath || '')
    const ext = (extMatch && extMatch[1].toLowerCase()) || 'jpg'
    if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      try { wx.hideLoading() } catch {}
      this._safeSetData({ prizeUploading: false })
      wx.showToast({ title: '云能力不可用', icon: 'none' })
      return
    }
    wx.cloud.uploadFile({
      cloudPath: `watch_party/prizes/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
      filePath,
      success: (res) => {
        try { wx.hideLoading() } catch {}
        if (this._unloaded) return
        const fileID = (res && res.fileID) || ''
        this._safeSetData({ prizeUploading: false })
        if (!fileID) {
          wx.showToast({ title: '上传失败，请重试', icon: 'none' })
          return
        }
        this.setData({ [`prizes[${idx}].image`]: fileID })
        wx.showToast({ title: '已上传', icon: 'success' })
      },
      fail: () => {
        try { wx.hideLoading() } catch {}
        this._safeSetData({ prizeUploading: false })
        wx.showToast({ title: '上传失败，请重试', icon: 'none' })
      }
    })
  },

  // ── 服务套餐 / 微信群码 / 车辆预约 ──

  onToggleService(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    if (!id) return
    const list = (this.data.selectedServices || []).slice()
    const idx = list.indexOf(id)
    if (idx >= 0) list.splice(idx, 1)
    else list.push(id)
    const opts = (this.data.serviceRows || []).map((s) => ({ id: s.id, label: s.label }))
    this.setData({
      selectedServices: list,
      serviceRows: buildServiceRows(opts.length ? opts : DEFAULT_SERVICE_OPTIONS, list)
    })
  },

  onUploadWechatQr() {
    if (this.data.qrUploading) return
    if (typeof wx.chooseMedia !== 'function') {
      wx.showToast({ title: '当前微信版本不支持选图', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        if (this._unloaded) return
        const path = res && res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) return
        this._uploadWechatQr(path)
      },
      fail: (err) => {
        if (this._unloaded) return
        const msg = (err && err.errMsg) || ''
        if (/cancel/i.test(msg)) return
        if (/privacy agreement|not declared|privacy/i.test(msg) || (err && Number(err.errno) === 112)) {
          wx.showModal({
            title: '选图接口未声明',
            content: '请在微信公众平台 → 用户隐私保护指引中声明「收集你选中的照片或视频信息」（对应 wx.chooseMedia），审核通过后再试。',
            showCancel: false,
            confirmText: '知道了'
          })
          return
        }
        wx.showToast({ title: '选图失败，请重试', icon: 'none' })
      }
    })
  },

  _uploadWechatQr(filePath) {
    this._safeSetData({ qrUploading: true })
    wx.showLoading({ title: '上传中…', mask: true })
    const extMatch = /\.(\w+)$/.exec(filePath || '')
    const ext = (extMatch && extMatch[1].toLowerCase()) || 'jpg'
    if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      try { wx.hideLoading() } catch {}
      this._safeSetData({ qrUploading: false })
      wx.showToast({ title: '云能力不可用', icon: 'none' })
      return
    }
    wx.cloud.uploadFile({
      cloudPath: `watch_party/wechat_qr/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
      filePath,
      success: (res) => {
        try { wx.hideLoading() } catch {}
        if (this._unloaded) return
        const fileID = (res && res.fileID) || ''
        this._safeSetData({ qrUploading: false, wechatGroupQr: fileID })
        if (!fileID) wx.showToast({ title: '上传失败，请重试', icon: 'none' })
      },
      fail: () => {
        try { wx.hideLoading() } catch {}
        this._safeSetData({ qrUploading: false })
        wx.showToast({ title: '上传失败，请重试', icon: 'none' })
      }
    })
  },

  onPreviewWechatQr() {
    const url = this.data.wechatGroupQr
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  onRemoveWechatQr() {
    this.setData({ wechatGroupQr: '' })
  },

  // ── 保存 ──

  onSave() {
    if (this.data.saving) return
    const form = this.data.form || {}
    const missionMode = this.data.missionMode
    const sciencePointsText = this.data.sciencePointsText
    const scienceImages = this.data.scienceImages || []
    const prizeDrawEnabled = this.data.prizeDrawEnabled === true
    const title = String(form.title || '').trim()
      || (form.rocketName ? `${form.rocketName}发射观礼` : '')
    if (!title) {
      wx.showToast({ title: '请先选择发射任务或填写场次标题', icon: 'none' })
      return
    }
    if (missionMode === 'auto' && !form.missionId) {
      wx.showToast({ title: '请选择发射任务（或切「手动填写」）', icon: 'none' })
      return
    }

    const prizes = (this.data.prizes || []).map((p, i) => ({
      id: String((p && p.id) || '').trim(),
      name: String((p && p.name) || '').trim(),
      image: String((p && p.image) || '').trim(),
      stock: Math.min(9999, Math.max(1, Number(p && p.stock) || 1)),
      valueYuan: (p && p.valueYuan !== '' && p.valueYuan != null) ? Number(p.valueYuan) : null,
      sort: i
    })).filter((p) => p.name && p.image)

    if (prizeDrawEnabled && !prizes.length) {
      wx.showToast({ title: '开启抽奖请至少添加一件奖品（名称+照片）', icon: 'none' })
      return
    }

    const allowed = {}
    ;(this.data.serviceRows || DEFAULT_SERVICE_OPTIONS).forEach((s) => { if (s && s.id) allowed[s.id] = true })
    const services = (this.data.selectedServices || []).filter((id) => allowed[id])

    const body = {
      title,
      missionId: form.missionId,
      missionName: form.missionName,
      rocketName: form.rocketName,
      agencyId: form.agencyId || '',
      agencyName: form.agencyName || '',
      agencyAbbrev: form.agencyAbbrev || '',
      rocketConfigId: form.rocketConfigId || '',
      padLocationId: form.padLocationId || '',
      padLocationName: form.padLocationName || '',
      launchTime: form.launchTime,
      address: String(form.address || '').trim(),
      lat: form.lat || 0,
      lng: form.lng || 0,
      intro: form.intro,
      notice: form.notice,
      services,
      wechatGroupQr: String(this.data.wechatGroupQr || '').trim(),
      vehicleBookingUrl: String(this.data.vehicleBookingUrl || '').trim(),
      sciencePoints: String(sciencePointsText || '').split('\n').map((s) => s.trim()).filter(Boolean),
      scienceImages,
      prizeDrawEnabled,
      prizes,
      capacity: Math.max(0, Number(form.capacity) || 0),
      status: form.status,
      enabled: form.enabled,
      passEnabled: form.passEnabled === true,
      passHours: Math.min(48, Math.max(1, Number(form.passHours) || 12)),
      parkingSpots: (this.data.parkingSpots || [])
        .map((p) => ({
          name: String((p && p.name) || '').trim(),
          lat: Number(p && p.lat) || 0,
          lng: Number(p && p.lng) || 0,
          walkMinutes: Math.max(0, Number(p && p.walkMinutes) || 0),
          note: String((p && p.note) || '').trim()
        }))
        .filter((p) => p.name)
    }

    this.setData({ saving: true })
    const req = this._sessionId
      ? watchParty.merchantUpdateSession(this._sessionId, body)
      : watchParty.merchantCreateSession(body)
    req.then((res) => {
      try { watchParty.invalidateEntryCache() } catch {}
      try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch {}
      if (this._unloaded) return
      this._safeSetData({ saving: false })
      if (this._sessionId) {
        wx.showToast({ title: '已保存', icon: 'success' })
        setTimeout(() => {
          if (this._unloaded) return
          wx.navigateBack({ fail: () => {} })
        }, 600)
        return
      }
      wx.showModal({
        title: '场次创建成功',
        content: (res && res.qrCodeReady)
          ? '现场物料码已自动生成。到「现场大屏」投屏即可开始；开启奖品抽奖后用户扫码即可抽奖。'
          : '场次已创建。物料码稍后自动补生成（编辑页保存一次也可触发）。',
        showCancel: false,
        confirmText: '知道了',
        success: () => {
          if (this._unloaded) return
          wx.navigateBack({ fail: () => {} })
        }
      })
    }).catch((err) => {
      this._safeSetData({ saving: false })
      wx.showToast({ title: (err && err.message) || '保存失败，请重试', icon: 'none' })
    })
  }
})
