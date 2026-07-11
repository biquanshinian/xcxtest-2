/**
 * monitor-pages 分包内地图场景常量与观测点计算。
 * 注意：不能放在其他分包（如 shared）再同步 require——分包间同步引用
 * 在直达入口（朋友圈单页 1154 / 分享卡片直开）时目标分包未下载，会导致页面 JS 报错黑屏。
 */
const LAUNCH_SITES = [
  {
    id: 101,
    key: 'starbase',
    name: 'Starbase',
    shortName: 'Starbase',
    latitude: 25.9972,
    longitude: -97.1566,
    region: '美国 · 德州',
    operator: 'SpaceX',
    vehicle: 'Starship / Super Heavy',
    summary: '星舰综合测试、发射与回收基地。',
    accentColor: '#34C759'
  },
  {
    id: 102,
    key: 'lc-39a',
    name: 'Kennedy Space Center LC-39A',
    shortName: 'LC-39A',
    latitude: 28.60839,
    longitude: -80.60433,
    region: '美国 · 佛州',
    operator: 'NASA / SpaceX',
    vehicle: 'Falcon 9 / Falcon Heavy / Dragon',
    summary: '载人龙飞船、货运与重型任务核心发射台。',
    accentColor: '#0A84FF'
  },
  {
    id: 103,
    key: 'slc-40',
    name: 'Cape Canaveral SLC-40',
    shortName: 'SLC-40',
    latitude: 28.56186,
    longitude: -80.57737,
    region: '美国 · 佛州',
    operator: 'SpaceX',
    vehicle: 'Falcon 9',
    summary: 'Starlink 与商业任务高频发射场。',
    accentColor: '#64D2FF'
  },
  {
    id: 104,
    key: 'slc-4e',
    name: 'Vandenberg SLC-4E',
    shortName: 'SLC-4E',
    latitude: 34.63209,
    longitude: -120.61083,
    region: '美国 · 加州',
    operator: 'SpaceX',
    vehicle: 'Falcon 9',
    summary: '极轨和太阳同步轨道任务的重要发射场。',
    accentColor: '#5E5CE6'
  },
  {
    id: 105,
    key: 'oca',
    name: 'Omelek / Pacific test legacy',
    shortName: '历史站点',
    latitude: 9.0477,
    longitude: 167.7431,
    region: '马绍尔群岛',
    operator: 'SpaceX',
    vehicle: 'Falcon 1',
    summary: 'SpaceX 早期轨道发射历史节点。',
    accentColor: '#FF9F0A'
  },
  {
    id: 106,
    key: 'wenchang',
    name: '文昌航天发射场',
    shortName: '文昌',
    latitude: 19.6145,
    longitude: 110.9510,
    region: '中国 · 海南',
    operator: 'CASC',
    vehicle: '长征五号 / 长征七号 / 长征八号',
    summary: '中国低纬度滨海发射场，承担深空探测与空间站任务。',
    accentColor: '#FF2D55'
  },
  {
    id: 107,
    key: 'jiuquan',
    name: '酒泉卫星发射中心',
    shortName: '酒泉',
    latitude: 40.9606,
    longitude: 100.2913,
    region: '中国 · 甘肃',
    operator: 'CASC',
    vehicle: '长征二号 / 神舟 / 天舟',
    summary: '中国最早的航天发射场，载人航天任务主发射基地。',
    accentColor: '#FF6B35'
  },
  {
    id: 108,
    key: 'xichang',
    name: '西昌卫星发射中心',
    shortName: '西昌',
    latitude: 28.2463,
    longitude: 102.0267,
    region: '中国 · 四川',
    operator: 'CASC',
    vehicle: '长征三号 / 长征二号丙',
    summary: '中国地球同步轨道与北斗导航卫星主要发射场。',
    accentColor: '#BF5AF2'
  },
  {
    id: 109,
    key: 'taiyuan',
    name: '太原卫星发射中心',
    shortName: '太原',
    latitude: 38.8490,
    longitude: 111.6080,
    region: '中国 · 山西',
    operator: 'CASC',
    vehicle: '长征四号 / 长征六号',
    summary: '中国太阳同步轨道与极轨卫星发射基地。',
    accentColor: '#AC8E68'
  },
  {
    id: 110,
    key: 'baikonur',
    name: 'Baikonur Cosmodrome',
    shortName: '拜科努尔',
    latitude: 45.9650,
    longitude: 63.3050,
    region: '哈萨克斯坦',
    operator: 'Roscosmos',
    vehicle: 'Soyuz / Proton',
    summary: '世界首个航天发射场，联盟号载人飞船主发射基地。',
    accentColor: '#30B0C7'
  },
  {
    id: 111,
    key: 'vostochny',
    name: 'Vostochny Cosmodrome',
    shortName: '东方',
    latitude: 51.8844,
    longitude: 128.3340,
    region: '俄罗斯 · 远东',
    operator: 'Roscosmos',
    vehicle: 'Soyuz-2 / Angara',
    summary: '俄罗斯新一代航天发射场。',
    accentColor: '#32ADE6'
  },
  {
    id: 112,
    key: 'kourou',
    name: 'Guiana Space Centre',
    shortName: '库鲁',
    latitude: 5.2360,
    longitude: -52.7690,
    region: '法属圭亚那',
    operator: 'ESA / Arianespace',
    vehicle: 'Ariane 6 / Vega-C',
    summary: '欧洲航天局主力发射场，靠近赤道优势显著。',
    accentColor: '#007AFF'
  },
  {
    id: 113,
    key: 'sriharikota',
    name: 'Satish Dhawan Space Centre',
    shortName: 'SHAR',
    latitude: 13.7199,
    longitude: 80.2304,
    region: '印度 · 安得拉邦',
    operator: 'ISRO',
    vehicle: 'PSLV / GSLV / LVM3',
    summary: '印度空间研究组织主要航天发射场。',
    accentColor: '#FF9500'
  },
  {
    id: 114,
    key: 'tanegashima',
    name: 'Tanegashima Space Center',
    shortName: '种子岛',
    latitude: 30.4009,
    longitude: 131.0036,
    region: '日本 · 鹿儿岛',
    operator: 'JAXA',
    vehicle: 'H3 / Epsilon',
    summary: '日本宇宙航空研究开发机构主力发射场。',
    accentColor: '#E8453C'
  },
  {
    id: 115,
    key: 'naro',
    name: 'Naro Space Center',
    shortName: '罗老',
    latitude: 34.4316,
    longitude: 127.5350,
    region: '韩国 · 全罗南道',
    operator: 'KARI',
    vehicle: 'KSLV-II (Nuri)',
    summary: '韩国首个航天发射场。',
    accentColor: '#5856D6'
  },
  {
    id: 116,
    key: 'semnan',
    name: 'Semnan Launch Site',
    shortName: '塞姆南',
    latitude: 35.2345,
    longitude: 53.9210,
    region: '伊朗',
    operator: 'ISA',
    vehicle: 'Simorgh / Safir',
    summary: '伊朗主要航天发射场。',
    accentColor: '#AF52DE'
  },
  {
    id: 117,
    key: 'plesetsk',
    name: 'Plesetsk Cosmodrome',
    shortName: '普列谢茨克',
    latitude: 62.9271,
    longitude: 40.5777,
    region: '俄罗斯 · 阿尔汉格尔斯克',
    operator: 'Roscosmos',
    vehicle: 'Soyuz-2 / Angara / Rokot',
    summary: '俄罗斯军用与极轨卫星发射基地。',
    accentColor: '#636366'
  },
  {
    id: 118,
    key: 'wallops',
    name: 'Mid-Atlantic Regional Spaceport',
    shortName: 'Wallops',
    latitude: 37.8433,
    longitude: -75.4784,
    region: '美国 · 弗吉尼亚',
    operator: 'NASA / Rocket Lab',
    vehicle: 'Antares / Electron',
    summary: 'NASA 沃洛普斯飞行设施，Rocket Lab 美国发射场。',
    accentColor: '#48484A'
  },
  {
    id: 119,
    key: 'mahia',
    name: 'Rocket Lab Launch Complex 1',
    shortName: 'Mahia',
    latitude: -39.2615,
    longitude: 177.8649,
    region: '新西兰 · 马希亚半岛',
    operator: 'Rocket Lab',
    vehicle: 'Electron',
    summary: 'Rocket Lab 主力商业发射场。',
    accentColor: '#00C7BE'
  }
]

function toMarker(item, options = {}) {
  const color = options.color || '#0A84FF'
  return {
    id: item.id,
    latitude: item.latitude,
    longitude: item.longitude,
    width: options.width || 30,
    height: options.height || 30,
    callout: {
      content: item.shortName || item.name,
      color: '#FFFFFF',
      fontSize: 12,
      borderRadius: 12,
      bgColor: color,
      padding: 8,
      display: options.display || 'BYCLICK'
    }
  }
}

function directionToBearing(directionText = '') {
  const text = String(directionText || '').toUpperCase().trim()
  const map = {
    N: 0,
    NE: 45,
    E: 90,
    SE: 135,
    S: 180,
    SW: 225,
    W: 270,
    NW: 315
  }
  return map[text] != null ? map[text] : 90
}

function offsetLatLng(origin, distanceKm, bearingDeg) {
  const earthRadiusKm = 6371
  const bearing = bearingDeg * Math.PI / 180
  const lat1 = origin.latitude * Math.PI / 180
  const lng1 = origin.longitude * Math.PI / 180
  const angularDistance = distanceKm / earthRadiusKm

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  )
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  )

  return {
    latitude: lat2 * 180 / Math.PI,
    longitude: lng2 * 180 / Math.PI
  }
}

function buildObservationCandidates(observer, pass) {
  const origin = {
    latitude: Number(observer.latitude),
    longitude: Number(observer.longitude)
  }
  const primaryBearing = directionToBearing(pass && pass.startDirection)
  const maxElev = Number(pass && pass.maxElev) || 0
  const trainCount = Number(pass && pass.trainCount) || 1
  const variants = [
    {
      id: 301,
      title: '主推荐点',
      distanceKm: 1.2,
      bearing: primaryBearing,
      sceneTag: '快速到达',
      reason: '优先面向过境起始方向，适合快速到达并尽快完成站位。'
    },
    {
      id: 302,
      title: '开阔备选点',
      distanceKm: 2.3,
      bearing: (primaryBearing + 18) % 360,
      sceneTag: '视野更开阔',
      reason: '稍远离建筑遮挡，更适合中高仰角过境的完整观察。'
    },
    {
      id: 303,
      title: trainCount > 1 ? '列车观测点' : '长弧线观测点',
      distanceKm: 3.4,
      bearing: (primaryBearing + 34) % 360,
      sceneTag: trainCount > 1 ? '适合列车过境' : '适合长弧线',
      reason: trainCount > 1 ? '适合列车状过境时持续追踪多颗目标。' : '适合持续时间较长的弧线过境观察。'
    }
  ]

  return variants.map((item, index) => {
    const point = offsetLatLng(origin, item.distanceKm, item.bearing)
    const scoreBase = 92 - index * 7
    const elevBonus = maxElev >= 60 ? 4 : (maxElev >= 35 ? 2 : 0)
    const recommendationScore = Math.max(72, Math.min(99, scoreBase + elevBonus))
    return {
      ...item,
      ...point,
      directionLabel: pass && pass.startDirection ? pass.startDirection : 'E',
      etaText: item.distanceKm < 1.5 ? '步行约 15 分钟' : item.distanceKm < 2.6 ? '骑行约 12 分钟' : '驾车约 10 分钟',
      recommendationScore,
      obstructionHint: index === 0 ? '优先保证正前方无遮挡' : (index === 1 ? '建议选择空旷地带' : '适合长时间抬头跟踪'),
      bestFor: maxElev >= 55 ? '高仰角快速通过' : (trainCount > 1 ? '列车状连续过境' : '普通可见过境')
    }
  })
}

function getPassQualityMeta(pass) {
  const maxElev = Number(pass && pass.maxElev) || 0
  const durationMin = Number(pass && pass.durationMin) || 0
  const brightnessText = String(pass && pass.brightnessText || '').toLowerCase()
  const trainCount = Number(pass && pass.trainCount) || 1
  let level = '普通'
  let color = '#8E8E93'
  let advice = '建议提前 10 分钟抵达，优先选择东/西方向无遮挡区域。'

  if (maxElev >= 60 || brightnessText === 'bright') {
    level = '优秀'
    color = '#34C759'
    advice = '这类过境非常适合直接肉眼观测，建议优先选择主推荐点。'
  } else if (maxElev >= 35 || durationMin >= 6) {
    level = '良好'
    color = '#0A84FF'
    advice = '整体观测体验较好，建议尽量避开路灯和高楼遮挡。'
  }

  if (trainCount > 1) {
    advice = '检测到列车状过境，建议选择更开阔的位置并延长观测时间。'
  }

  return {
    level,
    color,
    advice,
    trainLabel: trainCount > 1 ? `${trainCount} 颗列车` : '单批过境'
  }
}

module.exports = {
  LAUNCH_SITES,
  toMarker,
  directionToBearing,
  offsetLatLng,
  buildObservationCandidates,
  getPassQualityMeta
}
