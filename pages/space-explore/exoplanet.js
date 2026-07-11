const pageBase = require('../../utils/page-base.js')

const EXOPLANETS = [
  {
    name: 'Proxima Centauri b',
    nameCN: '比邻星 b',
    star: 'Proxima Centauri',
    distance: 4.24,
    distanceUnit: '光年',
    radius: 1.08,
    mass: 1.27,
    period: 11.2,
    periodUnit: '天',
    discovered: 2016,
    method: '径向速度法',
    type: 'rocky',
    typeCN: '岩石行星',
    habitable: true,
    temp: -39,
    icon: '🌍',
    color: '#4CAF50',
    desc: '距太阳系最近的系外行星，位于宜居带内，可能拥有液态水'
  },
  {
    name: 'TRAPPIST-1e',
    nameCN: 'TRAPPIST-1e',
    star: 'TRAPPIST-1',
    distance: 39.6,
    distanceUnit: '光年',
    radius: 0.92,
    mass: 0.69,
    period: 6.1,
    periodUnit: '天',
    discovered: 2017,
    method: '凌日法',
    type: 'rocky',
    typeCN: '岩石行星',
    habitable: true,
    temp: -27,
    icon: '🌎',
    color: '#2196F3',
    desc: 'TRAPPIST-1 七行星系统中最可能宜居的行星，大小与地球相似'
  },
  {
    name: 'Kepler-452b',
    nameCN: '开普勒-452b',
    star: 'Kepler-452',
    distance: 1402,
    distanceUnit: '光年',
    radius: 1.63,
    mass: 5.0,
    period: 384.8,
    periodUnit: '天',
    discovered: 2015,
    method: '凌日法',
    type: 'super-earth',
    typeCN: '超级地球',
    habitable: true,
    temp: -8,
    icon: '🌏',
    color: '#FF9800',
    desc: '被称为"地球2.0"，围绕类太阳恒星运行，轨道周期与地球相近'
  },
  {
    name: '55 Cancri e',
    nameCN: '巨蟹座55e',
    star: '55 Cancri',
    distance: 41,
    distanceUnit: '光年',
    radius: 1.88,
    mass: 7.99,
    period: 0.74,
    periodUnit: '天',
    discovered: 2004,
    method: '径向速度法',
    type: 'super-earth',
    typeCN: '超级地球',
    habitable: false,
    temp: 2573,
    icon: '💎',
    color: '#E91E63',
    desc: '表面温度极高的"钻石星球"，内部可能富含碳结晶结构'
  },
  {
    name: 'HD 209458 b',
    nameCN: 'HD 209458 b',
    star: 'HD 209458',
    distance: 157,
    distanceUnit: '光年',
    radius: 1.38,
    mass: 0.69,
    period: 3.52,
    periodUnit: '天',
    discovered: 1999,
    method: '凌日法',
    type: 'hot-jupiter',
    typeCN: '热木星',
    habitable: false,
    temp: 1130,
    icon: '🟤',
    color: '#795548',
    desc: '第一颗通过凌日法确认的系外行星，也称"Osiris"'
  },
  {
    name: 'WASP-76b',
    nameCN: 'WASP-76b',
    star: 'WASP-76',
    distance: 640,
    distanceUnit: '光年',
    radius: 1.83,
    mass: 0.92,
    period: 1.81,
    periodUnit: '天',
    discovered: 2013,
    method: '凌日法',
    type: 'hot-jupiter',
    typeCN: '热木星',
    habitable: false,
    temp: 2400,
    icon: '🌧️',
    color: '#FF5722',
    desc: '会下"铁雨"的行星——白天铁被蒸发，夜晚凝结为铁滴降落'
  },
  {
    name: 'Kepler-22b',
    nameCN: '开普勒-22b',
    star: 'Kepler-22',
    distance: 587,
    distanceUnit: '光年',
    radius: 2.38,
    mass: 9.1,
    period: 289.9,
    periodUnit: '天',
    discovered: 2011,
    method: '凌日法',
    type: 'super-earth',
    typeCN: '超级地球',
    habitable: true,
    temp: -11,
    icon: '🌊',
    color: '#00BCD4',
    desc: '首颗被确认位于宜居带的系外行星，可能是"海洋世界"'
  },
  {
    name: 'GJ 1214 b',
    nameCN: 'GJ 1214 b',
    star: 'GJ 1214',
    distance: 48,
    distanceUnit: '光年',
    radius: 2.68,
    mass: 6.55,
    period: 1.58,
    periodUnit: '天',
    discovered: 2009,
    method: '凌日法',
    type: 'mini-neptune',
    typeCN: '迷你海王星',
    habitable: false,
    temp: 555,
    icon: '💧',
    color: '#3F51B5',
    desc: '被称为"水世界"，大气层可能富含水蒸气或氢气'
  },
  {
    name: 'PSR B1257+12 b',
    nameCN: 'PSR B1257+12 b',
    star: 'PSR B1257+12',
    distance: 2300,
    distanceUnit: '光年',
    radius: 0.19,
    mass: 0.02,
    period: 25.3,
    periodUnit: '天',
    discovered: 1992,
    method: '脉冲星计时法',
    type: 'rocky',
    typeCN: '岩石行星',
    habitable: false,
    temp: -200,
    icon: '⚡',
    color: '#9C27B0',
    desc: '人类发现的第一颗系外行星，围绕脉冲星运行，沐浴在强辐射中'
  },
  {
    name: 'TOI-700 d',
    nameCN: 'TOI-700 d',
    star: 'TOI-700',
    distance: 101.4,
    distanceUnit: '光年',
    radius: 1.07,
    mass: 1.72,
    period: 37.4,
    periodUnit: '天',
    discovered: 2020,
    method: '凌日法',
    type: 'rocky',
    typeCN: '岩石行星',
    habitable: true,
    temp: -2,
    icon: '🌱',
    color: '#8BC34A',
    desc: 'TESS 发现的首颗宜居带地球大小行星，可能存在稳定大气'
  },
  {
    name: 'K2-18b',
    nameCN: 'K2-18b',
    star: 'K2-18',
    distance: 124,
    distanceUnit: '光年',
    radius: 2.61,
    mass: 8.63,
    period: 33,
    periodUnit: '天',
    discovered: 2015,
    method: '凌日法',
    type: 'mini-neptune',
    typeCN: '迷你海王星',
    habitable: true,
    temp: -23,
    icon: '🔬',
    color: '#009688',
    desc: 'JWST 在其大气中探测到二甲基硫(DMS)，可能是生物标志物'
  },
  {
    name: 'HR 8799 e',
    nameCN: 'HR 8799 e',
    star: 'HR 8799',
    distance: 129,
    distanceUnit: '光年',
    radius: 1.2,
    mass: 7.0,
    period: 18000,
    periodUnit: '天',
    discovered: 2010,
    method: '直接成像法',
    type: 'gas-giant',
    typeCN: '气态巨行星',
    habitable: false,
    temp: 1000,
    icon: '📸',
    color: '#607D8B',
    desc: '首批通过直接成像法发现的系外行星之一，质量约为木星7倍'
  }
]

const TYPE_FILTERS = [
  { key: '', label: '全部' },
  { key: 'rocky', label: '岩石行星' },
  { key: 'super-earth', label: '超级地球' },
  { key: 'hot-jupiter', label: '热木星' },
  { key: 'mini-neptune', label: '迷你海王星' },
  { key: 'gas-giant', label: '气态巨行星' }
]

const DISCOVERY_METHODS = [
  { method: '凌日法', count: 0, icon: '🌑', desc: '检测行星遮挡恒星光芒导致的亮度变化' },
  { method: '径向速度法', count: 0, icon: '🎯', desc: '测量恒星受行星引力影响产生的"摇摆"' },
  { method: '直接成像法', count: 0, icon: '📸', desc: '直接拍摄到行星的光或热辐射图像' },
  { method: '脉冲星计时法', count: 0, icon: '⚡', desc: '通过脉冲星信号周期变化推算行星存在' },
  { method: '微引力透镜法', count: 0, icon: '🔍', desc: '利用引力弯曲光线的效应发现行星' }
]

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/index/index',

  data: {
    planets: EXOPLANETS,
    filteredPlanets: EXOPLANETS,
    typeFilters: TYPE_FILTERS,
    discoveryMethods: DISCOVERY_METHODS,
    activeFilter: '',
    habitableOnly: false,
    expandedName: '',
    stats: {
      total: EXOPLANETS.length,
      habitable: EXOPLANETS.filter(p => p.habitable).length,
      nearest: EXOPLANETS.reduce((min, p) => p.distance < min.distance ? p : min, EXOPLANETS[0]),
      methods: 0
    }
  },

  onLoad() {
    this.initUiShell()
    this._updateStats()
  },

  _updateStats() {
    const methods = new Set(EXOPLANETS.map(p => p.method))
    const methodCounts = DISCOVERY_METHODS.map(m => ({
      ...m,
      count: EXOPLANETS.filter(p => p.method === m.method).length
    }))
    this.setData({
      discoveryMethods: methodCounts,
      'stats.methods': methods.size
    })
  },

  onFilterTap(e) {
    const key = e.currentTarget.dataset.key
    const newFilter = this.data.activeFilter === key ? '' : key
    this.setData({ activeFilter: newFilter })
    this._applyFilter()
  },

  onHabitableToggle() {
    this.setData({ habitableOnly: !this.data.habitableOnly })
    this._applyFilter()
  },

  _applyFilter() {
    const { activeFilter, habitableOnly } = this.data
    let list = EXOPLANETS
    if (activeFilter) list = list.filter(p => p.type === activeFilter)
    if (habitableOnly) list = list.filter(p => p.habitable)
    this.setData({ filteredPlanets: list })
  },

  onCardTap(e) {
    const name = e.currentTarget.dataset.name
    this.setData({ expandedName: this.data.expandedName === name ? '' : name })
  },

  onShareAppMessage() {
    return {
      title: '系外行星图鉴 · 探索已知的奇异世界',
      path: '/pages/space-explore/exoplanet'
    }
  },

  onShareTimeline() {
    return { title: '系外行星图鉴 · 探索已知的奇异世界' }
  }
})
