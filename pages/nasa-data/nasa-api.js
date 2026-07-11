/**
 * NASA 数据 API 封装
 * 1. 近地天体 (CAD API) - ssd-api.jpl.nasa.gov
 * 2. 地球自然事件 (EONET API) - eonet.gsfc.nasa.gov
 * 3. 火星车照片 (Nebulum API) - rovers.nebulum.one
 */

const { formatDate } = require('../../utils/util.js')

function requestJsonData(options) {
  var url = options.url
  var timeout = options.timeout || 15000
  return new Promise(function (resolve, reject) {
    wx.request({
      url: url,
      method: 'GET',
      timeout: timeout,
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          reject(new Error('HTTP ' + res.statusCode))
        }
      },
      fail: function (err) {
        reject(err || new Error('request:fail'))
      }
    })
  })
}

function simpleGet(url, params) {
  params = params || {}
  const qs = Object.keys(params)
    .filter(function (k) { return params[k] !== '' && params[k] != null })
    .map(function (k) { return k + '=' + encodeURIComponent(params[k]) })
    .join('&')
  const fullUrl = qs ? url + '?' + qs : url
  return requestJsonData({ url: fullUrl, timeout: 15000 }).catch(function (err) {
    const msg = String((err && (err.message || err.errMsg)) || err || '')
    if (/domain|600002|url not in domain/i.test(msg)) {
      return Promise.reject(new Error('request:domain not configured'))
    }
    return Promise.reject(err)
  })
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

// 1 AU ≈ 1.496 亿公里
const AU_TO_KM = 149597870.7
const MOON_DIST_AU = 0.00257

/** 近地天体接近数据 */
function getCloseApproach(options = {}) {
  return simpleGet('https://ssd-api.jpl.nasa.gov/cad.api', {
    'date-min': options.dateMin || 'now',
    'date-max': options.dateMax || '+60',
    'dist-max': options.distMax || '0.05',
    diameter: 'true',
    fullname: 'true',
    sort: options.sort || 'date',
    limit: options.limit || 50
  })
}

/** 解析 CAD 返回的二维数组为对象数组 */
function parseCADData(raw) {
  if (!raw || !raw.data || !raw.fields) return []
  const fields = raw.fields
  return raw.data.map(row => {
    const obj = {}
    fields.forEach((f, i) => { obj[f] = row[i] })
    // 计算额外字段
    const distAU = parseFloat(obj.dist)
    obj.distKm = (distAU * AU_TO_KM).toFixed(0)
    obj.distWanKm = (distAU * AU_TO_KM / 10000).toFixed(1)
    obj.distLD = (distAU / MOON_DIST_AU).toFixed(2)
    // 安全等级
    if (distAU < MOON_DIST_AU) {
      obj.safeLevel = 'danger'
      obj.safeLevelText = '极近'
      obj.safeLevelIcon = '🔴'
    } else if (distAU < 0.01) {
      obj.safeLevel = 'warning'
      obj.safeLevelText = '较近'
      obj.safeLevelIcon = '🟡'
    } else {
      obj.safeLevel = 'safe'
      obj.safeLevelText = '安全'
      obj.safeLevelIcon = '🟢'
    }
    // 格式化日期
    obj.cdFormatted = (obj.cd || '').replace(/(\d{4})-(\w+)-(\d+)\s+(\d+:\d+)/, '$1年$2月$3日 $4')
    obj.vRelFormatted = parseFloat(obj.v_rel || 0).toFixed(2)
    obj.hFormatted = parseFloat(obj.h || 0).toFixed(1)
    obj.diameterText = obj.diameter ? `${parseFloat(obj.diameter).toFixed(3)} km` : '未知'
    obj.fullnameClean = (obj.fullname || '').trim()
    return obj
  })
}

/** 地球自然事件 */
function getEarthEvents(options = {}) {
  const params = {
    status: options.status || 'open',
    limit: options.limit || 30
  }
  if (options.days) params.days = options.days
  if (options.category) params.category = options.category
  return simpleGet('https://eonet.gsfc.nasa.gov/api/v3/events', params)
}

const CATEGORY_ICONS = {
  wildfires: '🔥', volcanoes: '🌋', severeStorms: '🌀',
  seaLakeIce: '🧊', earthquakes: '🔴', floods: '🌊',
  landslides: '⛰️', drought: '☀️', dustHaze: '🌫️',
  snow: '❄️', tempExtremes: '🌡️', waterColor: '💧', manmade: '🏭'
}

/** 解析 EONET 事件 */
function parseEONETEvents(raw) {
  if (!raw || !raw.events) return []
  return raw.events.map(ev => {
    const cat = (ev.categories && ev.categories[0]) || {}
    const geo = (ev.geometry && ev.geometry[0]) || {}
    return {
      id: ev.id,
      title: ev.title,
      description: ev.description || '',
      categoryId: cat.id || '',
      categoryTitle: cat.title || '未知',
      categoryIcon: CATEGORY_ICONS[cat.id] || '🌍',
      closed: ev.closed,
      isOpen: !ev.closed,
      statusText: ev.closed ? '已结束' : '活跃中',
      date: geo.date || '',
      dateFormatted: formatDate(geo.date, 'YYYY-MM-DD'),
      coordinates: geo.coordinates || [],
      coordText: geo.coordinates ? `${geo.coordinates[1].toFixed(2)}°N, ${geo.coordinates[0].toFixed(2)}°E` : '',
      magnitudeValue: geo.magnitudeValue,
      magnitudeUnit: geo.magnitudeUnit || '',
      magnitudeText: geo.magnitudeValue != null ? `${geo.magnitudeValue} ${geo.magnitudeUnit}` : '',
      sourceUrl: (ev.sources && ev.sources[0]) ? ev.sources[0].url : '',
      link: ev.link
    }
  })
}

/** 火星车照片 */
function getRoverPhotos(rover, options = {}) {
  const base = `https://rovers.nebulum.one/api/v1/rovers/${rover}/photos`
  const params = options.sol != null
    ? { sol: options.sol }
    : { earth_date: options.earthDate || todayStr() }
  return simpleGet(base, params)
}

/** 相机名称中英对照 */
const CAMERA_NAMES = {
  FHAZ_RIGHT_B: '前避障相机(右)', FHAZ_LEFT_B: '前避障相机(左)',
  RHAZ_RIGHT_B: '后避障相机(右)', RHAZ_LEFT_B: '后避障相机(左)',
  NAV_RIGHT_B: '导航相机(右)', NAV_LEFT_B: '导航相机(左)',
  MAST_RIGHT: '桅杆相机(右)', MAST_LEFT: '桅杆相机(左)',
  CHEMCAM_RMI: 'ChemCam 远程微成像', MAHLI: '手持透镜成像仪',
  MARDI: '下降成像仪',
  NAVCAM_LEFT: '导航相机(左)', NAVCAM_RIGHT: '导航相机(右)',
  FRONT_HAZCAM_LEFT_A: '前避障相机(左)', FRONT_HAZCAM_RIGHT_A: '前避障相机(右)',
  REAR_HAZCAM_LEFT: '后避障相机(左)', REAR_HAZCAM_RIGHT: '后避障相机(右)',
  MCZ_LEFT: 'Mastcam-Z(左)', MCZ_RIGHT: 'Mastcam-Z(右)',
  SUPERCAM_RMI: 'SuperCam 远程微成像',
  SKYCAM: '天空相机', SHERLOC_WATSON: 'SHERLOC Watson',
  EDL_DDCAM: '下降阶段相机', EDL_PUCAM1: '降落伞上视相机',
  EDL_RUCAM: '火箭上视相机', EDL_RDCAM: '火箭下视相机',
  LCAM: '着陆相机', PIXL_MCC: 'PIXL 微环境相机'
}

/** 解析火星车照片 */
function parseRoverPhotos(raw) {
  if (!raw || !raw.photos) return []
  return raw.photos.map(p => {
    const camName = p.camera ? p.camera.name : ''
    return {
      id: p.id,
      sol: p.sol,
      cameraName: camName,
      cameraFullName: p.camera ? p.camera.full_name : '',
      cameraCN: CAMERA_NAMES[camName] || camName,
      imgSrc: p.img_src,
      earthDate: p.earth_date,
      roverName: p.rover ? p.rover.name : '',
      landingDate: p.rover ? p.rover.landing_date : ''
    }
  })
}

module.exports = {
  getCloseApproach, parseCADData,
  getEarthEvents, parseEONETEvents, CATEGORY_ICONS,
  getRoverPhotos, parseRoverPhotos,
  AU_TO_KM, MOON_DIST_AU
}
