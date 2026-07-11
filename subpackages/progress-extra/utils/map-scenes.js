/**
 * progress-extra 分包内地图场景常量。
 * 注意：不能放在其他分包（如 shared）再同步 require——分包间同步引用
 * 在直达入口（朋友圈单页 1154 / 分享卡片直开）时目标分包未下载，会导致页面 JS 报错黑屏。
 */
const STARBASE_CENTER = {
  latitude: 25.9972,
  longitude: -97.1566
}

const STARBASE_FACILITIES = [
  {
    id: 1,
    key: 'orbital-launch-mount',
    name: 'Orbital Launch Mount',
    shortName: 'OLM',
    latitude: 25.99735,
    longitude: -97.15615,
    category: '发射设施',
    status: '关键设施',
    summary: '星舰组合体发射与回收作业核心区域。'
  },
  {
    id: 2,
    key: 'mechazilla-tower',
    name: 'Mechazilla Tower',
    shortName: '塔架',
    latitude: 25.99775,
    longitude: -97.15605,
    category: '回收设施',
    status: '在役',
    summary: '承担星舰堆叠、回收与地面操作。'
  },
  {
    id: 3,
    key: 'megabay-1',
    name: 'Megabay 1',
    shortName: 'Megabay',
    latitude: 25.99392,
    longitude: -97.15485,
    category: '生产设施',
    status: '在役',
    summary: '星舰与超重助推器总装和维护区域。'
  },
  {
    id: 4,
    key: 'starfactory',
    name: 'Starfactory',
    shortName: 'Starfactory',
    latitude: 25.99495,
    longitude: -97.1532,
    category: '生产设施',
    status: '扩建中',
    summary: '用于提升星舰结构件制造效率。'
  },
  {
    id: 5,
    key: 'masseys-test-site',
    name: 'Massey Test Site',
    shortName: 'Massey',
    latitude: 25.9808,
    longitude: -97.1684,
    category: '测试设施',
    status: '高频使用',
    summary: 'Raptor 与相关系统测试区域。'
  },
  {
    id: 6,
    key: 'build-site',
    name: 'Build Site',
    shortName: 'Build Site',
    latitude: 25.99425,
    longitude: -97.1519,
    category: '装配区域',
    status: '活跃',
    summary: '筒段、鼻锥和总装流程密集分布。'
  }
]

const ROAD_CLOSURE_SCENE = {
  center: {
    latitude: 25.996,
    longitude: -97.1548
  },
  markers: [
    {
      id: 201,
      latitude: 25.9893,
      longitude: -97.1768,
      width: 28,
      height: 28,
      callout: {
        content: '检查点',
        color: '#FFFFFF',
        fontSize: 12,
        borderRadius: 12,
        bgColor: '#1C1C1E',
        padding: 8,
        display: 'BYCLICK'
      }
    },
    {
      id: 202,
      latitude: 25.9972,
      longitude: -97.1566,
      width: 28,
      height: 28,
      callout: {
        content: '发射区',
        color: '#FFFFFF',
        fontSize: 12,
        borderRadius: 12,
        bgColor: '#FF453A',
        padding: 8,
        display: 'BYCLICK'
      }
    }
  ],
  polylines: [
    {
      points: [
        { latitude: 25.9893, longitude: -97.1768 },
        { latitude: 25.9919, longitude: -97.1714 },
        { latitude: 25.9946, longitude: -97.1659 },
        { latitude: 25.9966, longitude: -97.1609 },
        { latitude: 25.9972, longitude: -97.1566 }
      ],
      color: '#FF453ACC',
      width: 6,
      dottedLine: false,
      arrowLine: true
    }
  ],
  polygons: [
    {
      points: [
        { latitude: 25.9966, longitude: -97.1594 },
        { latitude: 25.9986, longitude: -97.1594 },
        { latitude: 25.9986, longitude: -97.1541 },
        { latitude: 25.9966, longitude: -97.1541 }
      ],
      strokeWidth: 1,
      strokeColor: '#FF453A',
      fillColor: '#FF453A22'
    }
  ]
}

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

module.exports = {
  STARBASE_CENTER,
  STARBASE_FACILITIES,
  ROAD_CLOSURE_SCENE,
  toMarker
}
