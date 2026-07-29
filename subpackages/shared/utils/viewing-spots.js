/**
 * 发射观礼点数据（中国 + 美国）
 *
 * 数据口径（改动前务必先读）：
 * - 坐标一律为 WGS-84，取自 OpenStreetMap（Nominatim / Overpass 实测），导航时统一过 wgs84ToGcj02。
 *   不要再混用 GCJ-02 直录：两套坐标系混在一张表里，最后没人说得清某个点该不该转换。
 * - 落点只允许取内陆地物：停车场、车行道路节点、村镇、山峰、公园。
 *   绝不能取 natural=beach / bay 的岸线或水域中心点——沙滩在 OSM 里是沿岸线的长条几何，
 *   其中心点常落在水面一侧，导航过去就是「定位到海里」。
 * - distanceKm 是「观礼点 → padKey 指定参照点」的直线距离，由坐标反算得出，
 *   distanceText 只是展示文案。审计会校验两者一致（见 scripts/_audit_ai_chat_rich_runtime.js），
 *   所以改坐标必须同步改 distanceKm，否则自检会红。
 * - 参照点取发射场区中心或具体工位（见 REFERENCE_PADS），同一发射场内不同工位相距 1–2 km，
 *   所以文案统一说「约」，现场以管控告示为准。
 * - 军事管制发射场（酒泉/西昌/太原）不给导航坐标，只给「需官方渠道」的说明，避免把用户导到警戒区。
 */

const PI = Math.PI
const A = 6378245.0
const EE = 0.006693421622965943

function outOfChina(lng, lat) {
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55)
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0
  return ret
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0
  return ret
}

/** WGS-84 → GCJ-02（火星坐标系）；境外坐标原样返回 */
function wgs84ToGcj02(lng, lat) {
  const numLng = Number(lng)
  const numLat = Number(lat)
  if (!isFinite(numLng) || !isFinite(numLat)) return { lng: numLng, lat: numLat }
  if (outOfChina(numLng, numLat)) return { lng: numLng, lat: numLat }

  let dlat = transformLat(numLng - 105.0, numLat - 35.0)
  let dlng = transformLng(numLng - 105.0, numLat - 35.0)
  const radlat = (numLat / 180.0) * PI
  let magic = Math.sin(radlat)
  magic = 1 - EE * magic * magic
  const sqrtmagic = Math.sqrt(magic)
  dlat = (dlat * 180.0) / (((A * (1 - EE)) / (magic * sqrtmagic)) * PI)
  dlng = (dlng * 180.0) / ((A / sqrtmagic) * Math.cos(radlat) * PI)
  return { lng: numLng + dlng, lat: numLat + dlat }
}

/** 距离参照点（WGS-84）：工位或发射场区中心，用于反算并自检 distanceKm */
const REFERENCE_PADS = {
  wenchang_site: { label: '文昌发射场', lat: 19.62857, lng: 110.95975 },
  lc39a: { label: 'LC-39A', lat: 28.6084, lng: -80.6043 },
  lz1: { label: 'LZ-1 回收区', lat: 28.4858, lng: -80.5444 },
  starbase_olp: { label: '星舰轨道发射台', lat: 25.9972, lng: -97.1566 },
  slc4e: { label: 'SLC-4E', lat: 34.6321, lng: -120.6106 }
}

/** 两点直线距离（km） */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const rad = (x) => (Number(x) * PI) / 180
  const dLat = rad(lat2) - rad(lat1)
  const dLng = rad(lng2) - rad(lng1)
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 观礼点到其参照工位的实际距离（km）；缺参照时返回 null */
function spotDistanceKm(spot) {
  const pad = spot && REFERENCE_PADS[spot.padKey]
  if (!pad || !spot || spot.lat == null || spot.lng == null) return null
  return haversineKm(spot.lat, spot.lng, pad.lat, pad.lng)
}

/** 发射场分组信息（rank 越小越推荐） */
const VIEWING_SITES = {
  wenchang: {
    siteName: '文昌航天发射场',
    country: 'CN',
    countryLabel: '中国 · 海南',
    padNote: '长征五号 / 长征七号 / 长征八号',
    aliases: ['文昌', '海南', '龙楼', '淇水湾', '铜鼓岭', '石头公园', '南海港',
      '长征五号', '长五', '胖五', 'cz-5', 'cz5', '长征七号', '长七', 'cz-7',
      '长征八号', '长八', '嫦娥', '天舟', '天问', '载人月球', '文昌发射场']
  },
  jiuquan: {
    siteName: '酒泉卫星发射中心',
    country: 'CN',
    countryLabel: '中国 · 内蒙额济纳',
    padNote: '神舟 / 长征二号F',
    restricted: true,
    restrictedNote: '发射场位于军事管制区，周边无公共观礼点。载人任务的观礼台由官方统一组织，需通过东风航天城景区或官方接待渠道提前报备，个人不能自驾抵达工位附近。',
    aliases: ['酒泉', '东风', '东风航天城', '神舟', '载人发射', '天宫', '额济纳', '长征二号f', '长二f']
  },
  xichang: {
    siteName: '西昌卫星发射中心',
    country: 'CN',
    countryLabel: '中国 · 四川凉山',
    padNote: '长征三号乙 / 北斗',
    restricted: true,
    restrictedNote: '观礼台位于泽远一侧的管控范围内，需随官方组织或本地正规团队进入，个人不可自驾抵达；山区道路发射日会实施交通管制。',
    aliases: ['西昌', '凉山', '冕宁', '泽远', '北斗', '长征三号', '长三乙', '嫦娥一号']
  },
  taiyuan: {
    siteName: '太原卫星发射中心',
    country: 'CN',
    countryLabel: '中国 · 山西岢岚',
    padNote: '长征六号 / 太阳同步轨道任务',
    restricted: true,
    restrictedNote: '不对外开放观礼，周边为管控区域，没有公共观礼点，请勿自行前往。',
    aliases: ['太原', '岢岚', '长征六号', '长六']
  },
  ksc: {
    siteName: '肯尼迪航天中心 / 卡纳维拉尔角',
    country: 'US',
    countryLabel: '美国 · 佛罗里达',
    padNote: 'LC-39A / SLC-40 / SLC-41',
    aliases: ['肯尼迪', '卡纳维拉尔', '卡角', '佛州', '佛罗里达', 'ksc', 'lc-39a', '39a',
      'slc-40', 'slc-41', '猎鹰9', '猎鹰九', 'falcon', '猎鹰重型', '龙飞船', 'crew dragon',
      '泰特斯维尔', 'titusville', 'playalinda', '新格伦', 'new glenn', '美国发射']
  },
  starbase: {
    siteName: '星舰基地 Starbase',
    country: 'US',
    countryLabel: '美国 · 德州博卡奇卡',
    padNote: '星舰 / 超重型助推器',
    aliases: ['星舰', 'starship', 'starbase', '博卡奇卡', 'boca chica', '南帕德里',
      'south padre', 'spi', '德州', '得州', '布朗斯维尔', 'brownsville', '超重型']
  },
  vandenberg: {
    siteName: '范登堡太空军基地',
    country: 'US',
    countryLabel: '美国 · 加州隆波克',
    padNote: 'SLC-4E / SLC-6（极轨任务）',
    aliases: ['范登堡', 'vandenberg', 'vsfb', 'vafb', '加州', '加利福尼亚',
      '隆波克', 'lompoc', 'slc-4', 'slc-6', '极轨']
  }
}

/**
 * 可导航的公共观礼点
 * 每条的 lat/lng 均为 WGS-84，且落在内陆地物上（navHint 说明取的是什么地物）。
 */
const VIEWING_SPOTS = [
  // ── 文昌 ──
  {
    id: 'wenchang_qishuiwan',
    siteKey: 'wenchang',
    rank: 1,
    name: '淇水湾海滩',
    nameEn: 'Qishuiwan Beach',
    address: '海南文昌市龙楼镇钻石大道 · 淇水湾海滩停车场',
    navHint: '沙滩北段路边停车场',
    padKey: 'wenchang_site',
    lat: 19.64412,
    lng: 110.99029,
    distanceKm: 3.61,
    distanceText: '距发射场约 3.6 km',
    costText: '免费（停车场免费）',
    viewText: '侧面海景视角，可拍「大海 + 火箭」同框',
    tips: '导航终点是沙滩边的停车场，停好车走几步就是观礼岸线。央视机位常设于这一带，发射日建议提前 3–4 小时占位；国家级重大任务有临时清场管控的可能，备一个备选点。龙楼镇内的付费观礼台请先核对市里公布的备案名单。'
  },
  {
    id: 'wenchang_stone_park',
    siteKey: 'wenchang',
    rank: 2,
    name: '石头公园',
    nameEn: 'Stone Park',
    address: '海南文昌市龙楼镇古松村 · 石头公园滨海路',
    navHint: '礁石区外侧的车行道路',
    padKey: 'wenchang_site',
    lat: 19.63740,
    lng: 111.02939,
    distanceKm: 7.37,
    distanceText: '距发射场约 7.4 km',
    costText: '免费',
    viewText: '海蚀地貌前景 + 火箭升空',
    tips: '导航停在礁石区外的路上（再往海走约 150 m 就是礁石）。人比淇水湾少，但距离更远；礁石湿滑，夜间发射注意照明与落潮时间。'
  },
  {
    id: 'wenchang_tonggu',
    siteKey: 'wenchang',
    rank: 3,
    name: '铜鼓岭',
    nameEn: 'Tongguling',
    address: '海南文昌市龙楼镇铜鼓岭景区（主峰一带）',
    navHint: '铜鼓岭主峰',
    padKey: 'wenchang_site',
    lat: 19.67000,
    lng: 111.01863,
    distanceKm: 7.72,
    distanceText: '距发射场约 7.7 km',
    costText: '景区门票',
    viewText: '登高俯瞰月亮湾与发射场全景',
    tips: '坐标是主峰，需沿景区盘山路上行，末段要步行。视野开阔但冲击力弱于淇水湾；发射日景区可能限流，注意 17 点前后停止入园。'
  },

  // ── 肯尼迪航天中心 / 卡纳维拉尔角 ──
  {
    id: 'ksc_playalinda',
    siteKey: 'ksc',
    rank: 1,
    name: '普拉亚琳达海滩',
    nameEn: 'Playalinda Beach',
    address: 'Playalinda Beach Parking Lot 1, Canaveral National Seashore, Titusville, FL',
    navHint: '1 号停车场',
    padKey: 'lc39a',
    lat: 28.65493,
    lng: -80.63209,
    distanceKm: 5.87,
    distanceText: '距 LC-39A 约 5.9 km（39B 约 3.3 km）',
    costText: '停车约 $20',
    viewText: '公共区域离 39A 最近，火箭几乎从头顶爬升',
    tips: '导航终点是 1 号停车场（越往北的停车场离工位越远）。开放时间约 6:00–20:00（冬季 18:00 关闭），载人任务与部分猎鹰发射会因安全封闭，务必备第二方案。'
  },
  {
    id: 'ksc_space_view_park',
    siteKey: 'ksc',
    rank: 2,
    name: '太空观景公园',
    nameEn: 'Space View Park',
    address: 'Indian River Ave, Titusville, FL',
    navHint: '公园',
    padKey: 'lc39a',
    lat: 28.61373,
    lng: -80.80468,
    distanceKm: 19.63,
    distanceText: '距 LC-39A 约 19.6 km',
    costText: '免费',
    viewText: '隔印第安河正对航天中心，水面倒影出片',
    tips: '最受欢迎的免费点位，重大发射会现场放 NASA 音频直播；长焦 200mm 以上才能拍清塔架上的火箭。'
  },
  {
    id: 'ksc_max_brewer',
    siteKey: 'ksc',
    rank: 3,
    name: '帕里什公园（马克斯布鲁尔桥东）',
    nameEn: 'Parrish Park / Max Brewer Bridge',
    address: 'Parrish Park, Max Brewer Memorial Pkwy, Titusville, FL',
    navHint: '桥东侧公园',
    padKey: 'lc39a',
    lat: 28.62416,
    lng: -80.79450,
    distanceKm: 18.72,
    distanceText: '距 LC-39A 约 18.7 km',
    costText: '免费',
    viewText: '河岸视野开阔，可看多个工位',
    tips: '停在公园停车场，别停桥面。沿 US-1 与 SR-406 河岸大多视线通畅；注意超大建筑（VAB）会挡住个别角度的具体工位。'
  },
  {
    id: 'ksc_visitor_complex',
    siteKey: 'ksc',
    rank: 4,
    name: 'KSC 游客中心',
    nameEn: 'Kennedy Space Center Visitor Complex',
    address: '9500 Space Commerce Way, Merritt Island, FL',
    navHint: '游客中心入口',
    padKey: 'lc39a',
    lat: 28.52428,
    lng: -80.68186,
    distanceKm: 12.03,
    distanceText: '距 LC-39A 约 12 km（土星五号馆更近）',
    costText: '需门票，观礼票另售',
    viewText: '园内土星五号中心是离工位最近的可买票位置',
    tips: '观礼票不是每场都卖，通常只对载人、猎鹰重型等大任务开放，需提前抢；园区本身对工位无直视角。'
  },
  {
    id: 'ksc_jetty_park',
    siteKey: 'ksc',
    rank: 5,
    name: '防波堤公园',
    nameEn: 'Jetty Park',
    address: 'Jetty Park, Port Canaveral, FL',
    navHint: '公园入口',
    padKey: 'lz1',
    lat: 28.40657,
    lng: -80.59401,
    distanceKm: 9.97,
    distanceText: '距 LZ-1 回收区约 10 km',
    costText: '需入园费',
    viewText: '面朝西北，适合 SLC-37/36/46 与助推器回收',
    tips: '追猎鹰一级回收的首选（落地前会听到双声爆），设施齐全；但对最北的 39A 距离偏远，看北工位不如泰特斯维尔一侧。'
  },

  // ── 星舰基地 ──
  {
    id: 'starbase_isla_blanca',
    siteKey: 'starbase',
    rank: 1,
    name: '伊斯拉布兰卡公园',
    nameEn: 'Isla Blanca Park, South Padre Island',
    address: '33174 State Park Rd 100, South Padre Island, TX',
    navHint: '公园',
    padKey: 'starbase_olp',
    lat: 26.07139,
    lng: -97.15869,
    distanceKm: 8.25,
    distanceText: '距轨道发射台约 8.3 km',
    costText: '约 $10 / 车',
    viewText: '隔湾正对发射与回收塔，水面视线无遮挡',
    tips: '公认的公众首选点位，有洗手间和遮阳棚；试飞日常提前数小时甚至一天满位，读卡机常故障，带足现金。'
  },
  {
    id: 'starbase_port_isabel',
    siteKey: 'starbase',
    rank: 2,
    name: '伊莎贝尔港滨水区',
    nameEn: 'Port Isabel Waterfront',
    address: 'Port Isabel, TX',
    navHint: '市区中心',
    padKey: 'starbase_olp',
    lat: 26.07341,
    lng: -97.20858,
    distanceKm: 9.94,
    distanceText: '距发射台约 9.9 km',
    costText: '免费',
    viewText: '大陆一侧向东望，视线通畅',
    tips: '南帕德里岛堵车时的主力备选，停车更容易、人更少；4 号公路在试飞前会被警方封闭，不要试图靠近工位。'
  },

  // ── 范登堡 ──
  {
    id: 'vandenberg_ocean_beach',
    siteKey: 'vandenberg',
    rank: 1,
    name: '海洋海滩公园',
    nameEn: 'Ocean Beach Park',
    address: 'Ocean Park Rd, Lompoc, CA',
    navHint: '公园（Surf 海滩南侧）',
    padKey: 'slc4e',
    lat: 34.68953,
    lng: -120.59923,
    distanceKm: 6.51,
    distanceText: '距 SLC-4E 约 6.5 km',
    costText: '免费',
    viewText: '开阔平坦的海岸，升空后很快可见',
    tips: '沿 W Ocean Ave 向西到封锁点前的路侧是公共道路能到的最近位置，声浪最强。3–9 月雪鸻繁殖季部分沙滩封闭，海雾是范登堡头号杀手；基地内无公共观礼区，切勿越界进入军事区。'
  },
  {
    id: 'vandenberg_jalama',
    siteKey: 'vandenberg',
    rank: 2,
    name: '哈拉马海滩公园',
    nameEn: 'Jalama Beach County Park',
    address: 'Jalama Rd, Lompoc, CA',
    navHint: '县立公园（含露营地）',
    padKey: 'slc4e',
    lat: 34.50676,
    lng: -120.50019,
    distanceKm: 17.19,
    distanceText: '距 SLC-4E 直线约 17 km',
    costText: '需入园费',
    viewText: '海岸线取景漂亮，适合夜间与晨昏发射',
    tips: '距离远，只在晴朗通透的天气值得跑；进出是一条山路，发射后车流慢。'
  }
]

const SPOTS_BY_SITE = VIEWING_SPOTS.reduce((acc, spot) => {
  if (!acc[spot.siteKey]) acc[spot.siteKey] = []
  acc[spot.siteKey].push(spot)
  return acc
}, {})

Object.keys(SPOTS_BY_SITE).forEach((key) => {
  SPOTS_BY_SITE[key].sort((a, b) => (a.rank || 99) - (b.rank || 99))
})

function normalizeQuery(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '')
}

/** 命中的发射场 key（含受限场地）；命中不到返回 '' */
function matchViewingSiteKey(text) {
  const q = normalizeQuery(text)
  if (!q) return ''
  let bestKey = ''
  let bestLen = 0
  Object.keys(VIEWING_SITES).forEach((key) => {
    const aliases = VIEWING_SITES[key].aliases || []
    aliases.forEach((alias) => {
      const a = normalizeQuery(alias)
      if (a && a.length > bestLen && q.indexOf(a) >= 0) {
        bestKey = key
        bestLen = a.length
      }
    })
  })
  return bestKey
}

/**
 * 按查询挑观礼点
 * @returns {{ siteKey, site, spots, restricted, restrictedNote, matched }}
 *   restricted 为 true 时 spots 为空，只给说明文案
 */
function pickViewingSpots(text, limit) {
  const max = Number(limit) > 0 ? Number(limit) : 2
  const matchedKey = matchViewingSiteKey(text)
  const siteKey = matchedKey || 'wenchang'
  const site = VIEWING_SITES[siteKey] || null
  if (site && site.restricted) {
    return {
      siteKey,
      site,
      spots: [],
      restricted: true,
      restrictedNote: site.restrictedNote || '',
      matched: !!matchedKey
    }
  }
  return {
    siteKey,
    site,
    spots: (SPOTS_BY_SITE[siteKey] || []).slice(0, max),
    restricted: false,
    restrictedNote: '',
    matched: !!matchedKey
  }
}

/** 观礼点 → wx.openLocation 参数（表内一律 WGS-84，出口统一转 GCJ-02） */
function toNavPoint(spot) {
  if (!spot || spot.lat == null || spot.lng == null) return null
  const fixed = wgs84ToGcj02(spot.lng, spot.lat)
  if (!isFinite(fixed.lat) || !isFinite(fixed.lng)) return null
  return {
    latitude: Number(fixed.lat.toFixed(6)),
    longitude: Number(fixed.lng.toFixed(6)),
    name: spot.name + (spot.nameEn ? '（' + spot.nameEn + '）' : ''),
    address: [spot.address, spot.distanceText].filter(Boolean).join(' · ')
  }
}

module.exports = {
  VIEWING_SITES,
  VIEWING_SPOTS,
  REFERENCE_PADS,
  wgs84ToGcj02,
  haversineKm,
  spotDistanceKm,
  matchViewingSiteKey,
  pickViewingSpots,
  toNavPoint
}
