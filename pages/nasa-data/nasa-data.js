const nasaApi = require('./nasa-api')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const pageBase = require('../../utils/page-base.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    statusBarHeight: 0,
    navPlaceholderHeight: 0,
    menuButtonWidth: 88,
    scrollRefreshing: false,
    activeTab: 0,
    tabs: [
      { key: 'mars', label: '火星探索', icon: '🌕' },
      { key: 'eonet', label: '地球事件', icon: '🌍' },
      { key: 'cad', label: '近地天体', icon: '☄️' }
    ],

    // Tab 0: 火星探索
    cadLoading: false,
    cadError: '',
    cadList: [],
    cadCount: 0,
    cadTimeRange: '60',
    cadSort: 'date',

    // Tab 1: 地球事件
    eonetLoading: false,
    eonetError: '',
    eonetList: [],
    eonetFilteredList: [],
    eonetCategory: '',
    eonetCategories: [],

    // Tab 2: 近地天体
    marsLoading: false,
    marsError: '',
    marsPhotos: [],
    marsRover: 'curiosity',
    marsDate: '',
    marsUseSol: true,
    marsSol: '',
    marsRetryCount: 0,
    marsRoverInfo: {
      curiosity: {
        name: '好奇号 Curiosity',
        landed: '2012-08-06',
        mission: '研究火星气候与地质',
        cover: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%81%AB%E6%98%9F%E8%BD%A6/1774444017438_lo6uf1.jpg',
        launchDate: '2011-11-26',
        landingSite: 'Gale Crater（盖尔陨石坑）',
        weight: '899 kg',
        power: '核电池（MMRTG）',
        cameras: 'MAST / MAHLI / MARDI / NAVCAM / HAZCAM / ChemCam',
        instruments: 'SAM / CheMin / RAD / DAN / REMS / APXS',
        distance: '已行驶超过 32 公里',
        status: '运行中'
      },
      perseverance: {
        name: '毅力号 Perseverance',
        landed: '2021-02-18',
        mission: '寻找古代生命迹象',
        cover: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%81%AB%E6%98%9F%E8%BD%A6/1774444013740_fes66k.gif',
        launchDate: '2020-07-30',
        landingSite: 'Jezero Crater（杰泽罗陨石坑）',
        weight: '1025 kg',
        power: '核电池（MMRTG）',
        cameras: 'Mastcam-Z / NAVCAM / HAZCAM / SuperCam / SHERLOC / PIXL',
        instruments: 'SuperCam / PIXL / SHERLOC / MOXIE / MEDA / RIMFAX',
        distance: '已行驶超过 30 公里',
        status: '运行中',
        companion: '搭载机智号（Ingenuity）直升机'
      }
    }
  },

  onLoad() {
    this.initUiShell()

    let menuButtonWidth = 88
    try {
      const rect = wx.getMenuButtonBoundingClientRect()
      if (rect && rect.width) menuButtonWidth = Math.max(88, Math.ceil(rect.width + 24))
    } catch (e) {}

    this.setData({
      menuButtonWidth,
      marsDate: this._todayStr()
    })
    this.loadMarsPhotos()
  },

  // ========== 导航 ==========
  // goBack inherited from pageBase,

  onTabTap(e) {
    const idx = parseInt(e.currentTarget.dataset.index)
    if (idx === this.data.activeTab) return
    this.setData({ activeTab: idx })
    if (idx === 0 && !this.data.marsPhotos.length && !this.data.marsLoading) this.loadMarsPhotos()
    if (idx === 1 && !this.data.eonetList.length && !this.data.eonetLoading) this.loadEONETData()
    if (idx === 2 && !this.data.cadList.length && !this.data.cadLoading) this.loadCADData()
  },

  /** 原生三点下拉刷新：重拉当前 Tab 的 NASA 数据（已有数据时不回退骨架） */
  onScrollRefresh() {
    this._runNasaPullRefresh('scrollRefreshing')
  },

  onPullDownRefresh() {
    this._runNasaPullRefresh()
  },

  _runNasaPullRefresh(key) {
    runPullRefresh(this, () => {
      const idx = this.data.activeTab
      if (idx === 1) return this.loadEONETData({ silent: this.data.eonetList.length > 0 })
      if (idx === 2) return this.loadCADData({ silent: this.data.cadList.length > 0 })
      return this.loadMarsPhotos({ silent: this.data.marsPhotos.length > 0 })
    }, key)
  },

  // ========== Tab 2: 近地天体 ==========
  loadCADData(opts = {}) {
    this.setData(opts.silent ? { cadError: '' } : { cadLoading: true, cadError: '' })
    return nasaApi.getCloseApproach({
      dateMax: '+' + this.data.cadTimeRange,
      sort: this.data.cadSort
    }).then(raw => {
      const list = nasaApi.parseCADData(raw)
      this.setData({ cadList: list, cadCount: raw.count || list.length, cadLoading: false })
    }).catch(err => {
      console.error('[CAD] load error:', err)
      this.setData({ cadLoading: false, cadError: err.message || '加载失败' })
    })
  },

  onCadTimeFilter(e) {
    const val = e.currentTarget.dataset.value
    if (val === this.data.cadTimeRange) return
    this.setData({ cadTimeRange: val }, () => this.loadCADData())
  },

  onCadSortChange(e) {
    const val = e.currentTarget.dataset.value
    if (val === this.data.cadSort) return
    this.setData({ cadSort: val }, () => this.loadCADData())
  },

  // ========== Tab 1: 地球事件 ==========
  loadEONETData(opts = {}) {
    if (this._eonetLoading) return
    this._eonetLoading = true
    this.setData(opts.silent ? { eonetError: '' } : { eonetLoading: true, eonetError: '' })

    return nasaApi.getEarthEvents({ days: 60, limit: 50 }).then(raw => {
      const list = nasaApi.parseEONETEvents(raw)
      const catMap = {}
      list.forEach(ev => {
        if (ev.categoryId && !catMap[ev.categoryId]) {
          catMap[ev.categoryId] = { id: ev.categoryId, title: ev.categoryTitle, icon: ev.categoryIcon }
        }
      })
      this.setData({
        eonetList: list,
        eonetFilteredList: list,
        eonetCategories: Object.values(catMap),
        eonetLoading: false
      })
      this._eonetLoading = false
    }).catch(err => {
      console.error('[EONET] 请求失败:', err)
      this.setData({ eonetLoading: false, eonetError: err.message || '加载失败' })
      this._eonetLoading = false
    })
  },

  onEonetCategoryFilter(e) {
    const cat = e.currentTarget.dataset.value || ''
    this.setData({ eonetCategory: cat })
    if (!cat) {
      this.setData({ eonetFilteredList: this.data.eonetList })
    } else {
      this.setData({ eonetFilteredList: this.data.eonetList.filter(ev => ev.categoryId === cat) })
    }
  },

  openEonetMap(e) {
    const idx = e.currentTarget.dataset.index
    const item = this.data.eonetFilteredList[idx]
    if (!item || !item.coordinates || !item.coordinates.length) return
    wx.navigateTo({
      url: `/pages/nasa-data/eonet-map?lat=${item.coordinates[1]}&lng=${item.coordinates[0]}&title=${encodeURIComponent(item.title || '')}&category=${encodeURIComponent(item.categoryTitle || '')}&date=${encodeURIComponent(item.dateFormatted || '')}&magnitude=${encodeURIComponent(item.magnitudeText || '')}&status=${encodeURIComponent(item.statusText || '')}`
    })
  },

  // ========== Tab 0: 火星探索 ==========
  loadMarsPhotos(loadOpts = {}) {
    if (this._marsLoading) return
    this._marsLoading = true
    this.setData(loadOpts.silent ? { marsError: '' } : { marsLoading: true, marsError: '' })

    const rover = this.data.marsRover
    const hasExplicitSol = !!this.data.marsSol && this.data.marsUseSol
    // 首屏 / 切车：优先 latest_photos；选日期或空结果回退日则走按日查询
    const useLatest = !hasExplicitSol && this.data.marsRetryCount === 0 && !loadOpts.forceDate

    const fetchPromise = useLatest
      ? nasaApi.getRoverLatestPhotos(rover).catch(() => {
          const opts = this.data.marsSol
            ? { sol: this.data.marsSol }
            : { earthDate: this.data.marsDate || this._todayStr() }
          return nasaApi.getRoverPhotos(rover, opts)
        })
      : nasaApi.getRoverPhotos(rover, hasExplicitSol
          ? { sol: this.data.marsSol }
          : { earthDate: this.data.marsDate || this._todayStr() })

    return fetchPromise.then(raw => {
      const photos = nasaApi.parseRoverPhotos(raw)

      if (photos.length === 0 && this.data.marsRetryCount < 4) {
        // 回退一天重试（与网络重试分开）
        const curDate = this.data.marsDate || this._todayStr()
        const prev = new Date(curDate)
        prev.setDate(prev.getDate() - 1)
        const prevStr = prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0') + '-' + String(prev.getDate()).padStart(2, '0')
        this._marsLoading = false
        this.setData({
          marsDate: prevStr,
          marsRetryCount: this.data.marsRetryCount + 1,
          marsUseSol: false
        }, () => this.loadMarsPhotos({ forceDate: true }))
        return
      }

      if (photos.length > 0) {
        this.setData({
          marsPhotos: photos,
          marsLoading: false,
          marsError: '',
          marsRetryCount: 0,
          marsSol: String(photos[0].sol),
          marsDate: photos[0].earthDate || this.data.marsDate
        })
        this._saveMarsPhotoCache(rover, photos)
      } else {
        this.setData({
          marsPhotos: photos,
          marsLoading: false,
          marsRetryCount: 0,
          marsError: '该日期暂无照片，请选择其他日期'
        })
      }
      this._marsLoading = false
    }).catch(err => {
      console.error('[Mars] 请求失败:', err)
      this._marsLoading = false
      const cached = this._readMarsPhotoCache(rover)
      if (cached && cached.photos && cached.photos.length) {
        this.setData({
          marsPhotos: cached.photos,
          marsLoading: false,
          marsError: '',
          marsRetryCount: 0,
          marsSol: cached.sol || '',
          marsDate: cached.date || this.data.marsDate
        })
        wx.showToast({ title: '数据源缓慢，已展示缓存照片', icon: 'none' })
        return
      }
      const msg = (err && err.message) || '加载失败'
      const friendly = /超时|timeout/i.test(msg)
        ? '请求超时，火星车数据源较慢，请稍后重试'
        : (/domain/i.test(msg) ? '数据源域名未配置' : msg)
      this.setData({ marsLoading: false, marsError: friendly, marsRetryCount: 0 })
    })
  },

  _saveMarsPhotoCache(rover, photos) {
    try {
      wx.setStorage({
        key: 'mars_photos_cache_' + rover,
        data: {
          photos: photos.slice(0, 30),
          sol: String(photos[0].sol || ''),
          date: photos[0].earthDate || '',
          ts: Date.now()
        }
      })
    } catch (e) {}
  },

  _readMarsPhotoCache(rover) {
    try {
      return wx.getStorageSync('mars_photos_cache_' + rover) || null
    } catch (e) {
      return null
    }
  },

  onMarsRoverSwitch(e) {
    const rover = e.currentTarget.dataset.value
    if (rover === this.data.marsRover) return
    this._marsLoading = false
    this.setData({
      marsRover: rover,
      marsPhotos: [],
      marsDate: this._todayStr(),
      marsRetryCount: 0,
      marsUseSol: false,
      marsSol: ''
    }, () => this.loadMarsPhotos())
  },

  onMarsDateChange(e) {
    this._marsLoading = false
    this.setData({
      marsDate: e.detail.value,
      marsRetryCount: 0,
      marsUseSol: false,
      marsSol: ''
    }, () => this.loadMarsPhotos({ forceDate: true }))
  },

  onMarsPhotoTap(e) {
    const src = e.currentTarget.dataset.src
    const urls = this.data.marsPhotos.map(p => p.imgSrc)
    wx.previewImage({ current: src, urls })
    // 记录火星车照片浏览（成就统计）
    try {
      const { incrementStat } = require('../../utils/behavior-stats.js')
      incrementStat('marsPhotoCount')
    } catch (ex) {}
  },

  onRoverCoverTap() {
    const src = this.data.marsRoverInfo[this.data.marsRover].cover
    wx.previewImage({ current: src, urls: [src] })
  },

  // ========== 工具 ==========
  _todayStr() {
    const d = new Date()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  },

  // ========== 分享 ==========
  _getShareImage() {
    // 火星探索 Tab 用火星车封面图，通过 COS imageMogr2 裁剪为 1:1 正方形并压缩
    // 微信朋友圈分享图要求：正方形，不超过 128KB
    if (this.data.activeTab === 0) {
      const cover = this.data.marsRoverInfo[this.data.marsRover].cover
      if (cover && cover.includes('cos.ap-guangzhou.myqcloud.com')) {
        return cover + '?imageMogr2/thumbnail/500x500!/gravity/center/crop/500x500/format/jpg/quality/80'
      }
      return cover
    }
    return ''
  },

  onShareAppMessage() {
    const tabNames = ['火星探索', '地球自然事件', '近地天体监测']
    const tabName = tabNames[this.data.activeTab] || 'NASA 数据中心'
    const img = this._getShareImage()
    const result = {
      title: tabName + ' | NASA 数据中心 - 火星探索日志',
      path: '/pages/nasa-data/nasa-data'
    }
    if (img) result.imageUrl = img
    return result
  },

  onShareTimeline() {
    const tabNames = ['火星探索', '地球自然事件', '近地天体监测']
    const tabName = tabNames[this.data.activeTab] || 'NASA 数据中心'
    const img = this._getShareImage()
    const result = {
      title: tabName + ' | NASA 数据中心 - 火星探索日志',
      query: ''
    }
    if (img) result.imageUrl = img
    return result
  }
})
