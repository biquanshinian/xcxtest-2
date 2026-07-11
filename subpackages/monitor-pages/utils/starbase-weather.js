/**
 * 轻量 wx.request JSON 封装（避免跨分包引用 shared/http-request）
 */
function _wxRequestJson(url, timeout) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      timeout: timeout || 12000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          reject(new Error('HTTP ' + res.statusCode))
        }
      },
      fail(err) {
        reject(err || new Error('request:fail'))
      }
    })
  })
}

/**
 * 博卡奇卡（Starbase）实况天气 — Open-Meteo 公开接口（无需 Key）。
 * 坐标仍为德州博卡奇卡；请求 timezone=Asia/Shanghai，使 current.time 为中国标准时间，
 * 界面固定后缀 CST（UTC+8，无夏令时）。
 * 小程序需在公众平台配置 request 合法域名：https://api.open-meteo.com
 */
const STARBASE_LAT = 25.9971
const STARBASE_LON = -97.1564

const WX_ICON = {
  clear: '/images/starbase-weather/w-clear.svg',
  mainly_clear: '/images/starbase-weather/w-mainly-clear.svg',
  partly: '/images/starbase-weather/w-partly.svg',
  overcast: '/images/starbase-weather/w-overcast.svg',
  fog: '/images/starbase-weather/w-fog.svg',
  drizzle: '/images/starbase-weather/w-drizzle.svg',
  rain: '/images/starbase-weather/w-rain.svg',
  snow: '/images/starbase-weather/w-snow.svg',
  thunder: '/images/starbase-weather/w-thunder.svg',
  unknown: '/images/starbase-weather/w-unknown.svg'
}

/**
 * Open-Meteo WMO weathercode → 中文简述 + 图标
 * @see https://open-meteo.com/en/docs
 */
function mapWeatherCode(code) {
  const c = Number(code)
  if (!Number.isFinite(c)) {
    return { text: '未知', icon: WX_ICON.unknown }
  }
  if (c === 0) return { text: '晴朗', icon: WX_ICON.clear }
  if (c === 1) return { text: '大部晴朗', icon: WX_ICON.mainly_clear }
  if (c === 2) return { text: '多云', icon: WX_ICON.partly }
  if (c === 3) return { text: '阴', icon: WX_ICON.overcast }
  if (c === 45 || c === 48) return { text: '雾', icon: WX_ICON.fog }
  if (c >= 51 && c <= 57) return { text: '毛毛雨', icon: WX_ICON.drizzle }
  if (c >= 61 && c <= 67) return { text: '雨', icon: WX_ICON.rain }
  if (c >= 71 && c <= 77) return { text: '雪', icon: WX_ICON.snow }
  if (c >= 80 && c <= 82) return { text: '阵雨', icon: WX_ICON.rain }
  if (c === 85 || c === 86) return { text: '阵雪', icon: WX_ICON.snow }
  if (c >= 95 && c <= 99) return { text: '雷暴', icon: WX_ICON.thunder }
  return { text: '未知', icon: WX_ICON.unknown }
}

/** 实况观测时刻以中国标准时间 CST（UTC+8）展示 */
function formatChinaStandardTimeLine(timeIso) {
  if (!timeIso || typeof timeIso !== 'string') return ''
  const parts = timeIso.replace('T', ' ').trim()
  return `${parts} CST`
}

function normalizeOpenMeteoPayload(data) {
  const cur = data && data.current
  if (!cur || typeof cur !== 'object') {
    throw new Error('invalid current')
  }
  const units = data.current_units || {}
  const tempUnit = units.temperature_2m || '°C'
  const windUnit = units.wind_speed_10m || ''
  const { text, icon } = mapWeatherCode(cur.weather_code)
  const tempVal = cur.temperature_2m
  const tempLine =
    tempVal != null && tempVal !== ''
      ? `${Number(tempVal).toFixed(1).replace(/\.0$/, '')}${tempUnit}`
      : '—'
  const ws = cur.wind_speed_10m
  const windLine =
    ws != null && ws !== ''
      ? `${Number(ws).toFixed(1).replace(/\.0$/, '')}${windUnit ? ` ${windUnit}` : ''}`
      : '—'

  const timeLine = formatChinaStandardTimeLine(cur.time)

  return {
    loaded: true,
    loading: false,
    error: '',
    timeLine,
    conditionText: text,
    tempLine,
    windLine,
    weatherIcon: icon,
    windIcon: '/images/starbase-weather/wind-lines.svg'
  }
}

function fetchStarbaseWeatherWx() {
  const url = 'https://api.open-meteo.com/v1/forecast?' + [
    'latitude=' + STARBASE_LAT,
    'longitude=' + STARBASE_LON,
    'current=temperature_2m,weather_code,wind_speed_10m',
    'timezone=Asia/Shanghai',
    'wind_speed_unit=kmh'
  ].join('&')

  return _wxRequestJson(url, 12000)
    .then((data) => normalizeOpenMeteoPayload(data))
    .catch((err) => {
      const msg = String((err && (err.message || err.errMsg)) || err || '')
      if (/domain|600002|url not in domain/i.test(msg)) {
        return {
          loaded: false,
          loading: false,
          error: '天气服务域名未配置',
          timeLine: '',
          conditionText: '—',
          tempLine: '—',
          windLine: '—',
          weatherIcon: WX_ICON.unknown,
          windIcon: '/images/starbase-weather/wind-lines.svg'
        }
      }
      throw err
    })
}

module.exports = {
  STARBASE_LAT,
  STARBASE_LON,
  fetchStarbaseWeatherWx,
  mapWeatherCode,
  normalizeOpenMeteoPayload
}
