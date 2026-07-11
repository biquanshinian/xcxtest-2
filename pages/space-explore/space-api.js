/**
 * 太空探索工具 API
 * APOD 请求通过 Cloudflare Worker 代理（api.marsx.com.cn 已在合法域名内）
 */

const { workerProxyUrl } = require('../../utils/config.js')
const { requestJsonData } = require('./http-request.js')

const CACHE_PREFIX = 'space_explore_'

function getCacheLocal(key, maxAge) {
  try {
    var cached = wx.getStorageSync(CACHE_PREFIX + key)
    if (cached && cached.ts && cached.data && (Date.now() - cached.ts < maxAge)) {
      return cached.data
    }
  } catch (e) {}
  return null
}

function setCacheLocal(key, data) {
  try {
    wx.setStorageSync(CACHE_PREFIX + key, { ts: Date.now(), data: data })
  } catch (e) {}
}

function dateStr(d) {
  const dt = d || new Date()
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0')
}

// 当天数据缓存 6h，历史日期缓存 30 天（内容不会再变）
function apodMaxAge(requestDate) {
  return requestDate === dateStr() ? 21600000 : 2592000000
}

function getAPOD(date) {
  const requestDate = date || dateStr()
  const key = 'apod_' + requestDate
  const cached = getCacheLocal(key, apodMaxAge(requestDate))
  if (cached) return Promise.resolve(cached)

  const base = (workerProxyUrl || 'https://api.marsx.com.cn') + '/nasa-apod'
  const url = base + '?date=' + requestDate

  return requestJsonData({
    url,
    timeout: 15000,
    cacheKey: CACHE_PREFIX + key,
    maxAge: apodMaxAge(requestDate)
  }).then(data => {
    setCacheLocal(key, data)
    return data
  }).catch(err => {
    if (requestDate === dateStr()) {
      const y = new Date()
      y.setDate(y.getDate() - 1)
      const yDate = dateStr(y)
      const yKey = 'apod_' + yDate
      const yCached = getCacheLocal(yKey, apodMaxAge(yDate))
      if (yCached) return yCached
      const yUrl = base + '?date=' + yDate
      return requestJsonData({
        url: yUrl,
        timeout: 15000,
        cacheKey: CACHE_PREFIX + yKey,
        maxAge: apodMaxAge(yDate)
      }).then(data => {
        setCacheLocal(yKey, data)
        data._fallbackDate = yDate
        return data
      })
    }
    throw err
  })
}

function updateAPODCache(date, patch) {
  const key = 'apod_' + date
  const cached = getCacheLocal(key, apodMaxAge(date))
  if (cached) setCacheLocal(key, Object.assign(cached, patch))
}

module.exports = { getAPOD, updateAPODCache, dateStr }
