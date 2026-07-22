/**
 * subpackages/monitor-pages/utils/monitor-weather.js
 * 博卡奇卡（Starbase）实况天气整块逻辑（从 pages/monitor/monitor.js 拆出）：
 * 本地持久缓存回填（stale-while-revalidate）+ open-meteo 请求 + 天气码映射。
 *
 * 主包 monitor.js 通过 require.async + attachTo 委托加载，
 * 与 monitor-pass / monitor-galleries / monitor-orbital 模式一致；
 * monitor 页在 preloadRule 中预下载 monitor-pages 分包，几乎无加载等待。
 */
const methods = {
  /** 进页面先用上次成功的天气数据渲染（stale-while-revalidate），网络刷新随后进行 */
  _hydrateStarbaseWeatherFromCache() {
    if (this.data.starbaseWeather && this.data.starbaseWeather.loaded) return
    const MAX_STALE_MS = 3 * 60 * 60 * 1000
    const FRESH_MS = 10 * 60 * 1000
    wx.getStorage({
      key: '_starbase_weather_cache',
      success: (res) => {
        const cached = res.data
        if (!cached || !cached.payload || !cached.ts) return
        if (Date.now() - cached.ts > MAX_STALE_MS) return
        if (this.data.starbaseWeather && this.data.starbaseWeather.loaded) return
        this.setData({ starbaseWeather: { ...cached.payload, loading: false, error: '' } })
        // 命中新鲜缓存时视为已加载，短期内不再发起网络请求
        if (Date.now() - cached.ts < FRESH_MS) {
          this._starbaseWeatherCacheAt = cached.ts
        }
      },
      fail: () => {}
    })
  },

  /**
   * 博卡奇卡（Starbase）实况天气：观测时刻显示为 CST（中国标准时间 UTC+8），实况/气温/风速仍为当地观测值
   * @param {boolean} forceRefresh 为 true 时下拉刷新跳过短期缓存
   */
  loadStarbaseWeather(forceRefresh) {
    const CACHE_MS = 10 * 60 * 1000
    const now = Date.now()
    if (this._starbaseWeatherInFlight) return Promise.resolve()
    if (
      !forceRefresh &&
      this._starbaseWeatherCacheAt &&
      now - this._starbaseWeatherCacheAt < CACHE_MS &&
      this.data.starbaseWeather &&
      this.data.starbaseWeather.loaded
    ) {
      return Promise.resolve()
    }
    this._starbaseWeatherInFlight = true
    const prev = this.data.starbaseWeather || {}
    this.setData({
      starbaseWeather: {
        ...prev,
        loading: true,
        error: ''
      }
    })

    const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=25.9971&longitude=-97.1564&current=temperature_2m,weather_code,wind_speed_10m&timezone=Asia/Shanghai&wind_speed_unit=kmh'

    return new Promise((resolve, reject) => {
      wx.request({
        url: weatherUrl,
        method: 'GET',
        timeout: 15000,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data)
          } else {
            reject(new Error('HTTP ' + res.statusCode))
          }
        },
        fail: (err) => reject(err || new Error('request:fail'))
      })
    })
      .then((data) => {
        const cur = data && data.current
        if (!cur || typeof cur !== 'object') throw new Error('invalid current')
        const units = data.current_units || {}
        const tempUnit = units.temperature_2m || '°C'
        const windUnit = units.wind_speed_10m || ''
        const code = Number(cur.weather_code)
        const wxMap = this._mapWeatherCode(code)
        const tempVal = cur.temperature_2m
        const tempLine = tempVal != null && tempVal !== ''
          ? `${Number(tempVal).toFixed(1).replace(/\.0$/, '')}${tempUnit}`
          : '—'
        const ws = cur.wind_speed_10m
        const windLine = ws != null && ws !== ''
          ? `${Number(ws).toFixed(1).replace(/\.0$/, '')}${windUnit ? ` ${windUnit}` : ''}`
          : '—'
        const timeLine = cur.time ? `${cur.time.replace('T', ' ').trim()} CST` : ''
        const payload = {
          loaded: true,
          loading: false,
          error: '',
          timeLine,
          conditionText: wxMap.text,
          tempLine,
          windLine,
          weatherIcon: wxMap.icon,
          windIcon: '/images/starbase-weather/wind-lines.svg'
        }
        this._starbaseWeatherCacheAt = Date.now()
        this.setData({ starbaseWeather: payload })
        // 持久化：下次进页面先展示上次数据，避免等待跨境请求
        try {
          wx.setStorage({ key: '_starbase_weather_cache', data: { payload, ts: Date.now() }, fail: () => {} })
        } catch (e) {}
      })
      .catch((err) => {
        const had = !!(prev && prev.loaded)
        console.warn('[monitor] starbase weather error:', err)
        if (!had && !this._starbaseWeatherRetried) {
          this._starbaseWeatherRetried = true
          this._starbaseWeatherInFlight = false
          setTimeout(() => this.loadStarbaseWeather(true), 4000)
          return
        }
        this._starbaseWeatherRetried = false
        this.setData({
          starbaseWeather: {
            ...prev,
            loading: false,
            error: had ? '' : '天气暂时不可用'
          }
        })
      })
      .finally(() => {
        this._starbaseWeatherInFlight = false
      })
  },

  _mapWeatherCode(code) {
    const c = Number(code)
    const base = '/images/starbase-weather/'
    if (!Number.isFinite(c)) return { text: '未知', icon: base + 'w-unknown.svg' }
    if (c === 0) return { text: '晴朗', icon: base + 'w-clear.svg' }
    if (c === 1) return { text: '大部晴朗', icon: base + 'w-mainly-clear.svg' }
    if (c === 2) return { text: '多云', icon: base + 'w-partly.svg' }
    if (c === 3) return { text: '阴', icon: base + 'w-overcast.svg' }
    if (c === 45 || c === 48) return { text: '雾', icon: base + 'w-fog.svg' }
    if (c >= 51 && c <= 57) return { text: '毛毛雨', icon: base + 'w-drizzle.svg' }
    if (c >= 61 && c <= 67) return { text: '雨', icon: base + 'w-rain.svg' }
    if (c >= 71 && c <= 77) return { text: '雪', icon: base + 'w-snow.svg' }
    if (c >= 80 && c <= 82) return { text: '阵雨', icon: base + 'w-rain.svg' }
    if (c === 85 || c === 86) return { text: '阵雪', icon: base + 'w-snow.svg' }
    if (c >= 95 && c <= 99) return { text: '雷暴', icon: base + 'w-thunder.svg' }
    return { text: '未知', icon: base + 'w-unknown.svg' }
  }
}

module.exports = {
  methods,
  /** 把全部方法挂到页面实例上（委托加载后调用） */
  attachTo(page) {
    Object.keys(methods).forEach((k) => {
      page[k] = methods[k].bind(page)
    })
    page.__weatherAttached = true
  }
}
