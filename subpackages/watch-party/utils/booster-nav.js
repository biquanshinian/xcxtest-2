/**
 * 可回收火箭实体详情统一跳转：门控 → 预塞族谱档案 → booster-detail
 * 各分包本地副本（禁止放主包：主包 Tab 未引用会被「未使用 JS」扫描拦截；
 * 亦不可只放 shared 再被其它分包 sync require，分享冷启动会黑屏）。
 */

function normalizeSerial(serial) {
  const s = String(serial || '').trim()
  if (!s || /^unknown/i.test(s) || /^(tbd|n\/?a|null|none|未披露|未知|\?+|-+)$/i.test(s)) {
    return ''
  }
  return s
}

function serialMatch(item, serial) {
  if (!item || !serial) return false
  const a = String(item.serialNumber || item.serial || '').trim()
  if (!a) return false
  return a === serial || a.toUpperCase() === serial.toUpperCase()
}

function pickLauncherId(value) {
  if (value == null) return ''
  const id = String(value).trim()
  return id && id !== 'undefined' && id !== 'null' ? id : ''
}

function launcherIdMatch(item, launcherId) {
  const id = pickLauncherId(launcherId)
  if (!item || !id) return false
  return pickLauncherId(item.ll2Id || item.launcherId) === id
}

async function openBoosterEntityDetail(serial, options) {
  options = options || {}
  serial = normalizeSerial(serial)
  const launcherId = pickLauncherId(
    options.ll2Id || options.launcherId ||
    (options.raw && (options.raw.ll2Id || options.raw.launcherId))
  )
  if ((!serial || serial === '未披露') && !launcherId) {
    wx.showToast({ title: '暂无该助推器档案', icon: 'none' })
    return false
  }

  if (!options.skipGate) {
    try {
      const { gateCheck } = require('../../../utils/membership.js')
      const allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
      if (!allowed) return false
    } catch (e) {}
  }

  let raw = options.raw || null
  if (!raw) {
    try {
      const { getBoosterGenealogy } = require('../../../utils/api-app-services.js')
      const list = await getBoosterGenealogy()
      raw = (list || []).find(function (b) { return launcherIdMatch(b, launcherId) }) ||
        (list || []).find(function (b) { return serialMatch(b, serial) }) || null
    } catch (e) {
      raw = null
    }
  }
  if (raw && !serial) serial = normalizeSerial(raw.serialNumber || raw.serial)
  const resolvedId = launcherId || pickLauncherId(raw && (raw.ll2Id || raw.launcherId))

  try {
    const app = typeof getApp === 'function' ? getApp() : null
    if (app && raw) app._boosterDetailData = raw
    if (app && options.heroImage && serial) {
      app._boosterHeroImage = { serial: serial, src: String(options.heroImage) }
    }
  } catch (e) {}

  const { ROUTES, navigateTo } = require('../../../utils/routes.js')
  const params = {}
  if (serial) params.serial = serial
  if (resolvedId) params.ll2Id = resolvedId
  navigateTo(ROUTES.BOOSTER_DETAIL, params)
  return true
}

async function openRocketModelDetail(configId, options) {
  options = options || {}
  if (configId == null || configId === '') {
    wx.showToast({ title: '暂无该型号档案', icon: 'none' })
    return false
  }

  if (!options.skipGate) {
    try {
      const { gateCheck } = require('../../../utils/membership.js')
      const allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
      if (!allowed) return false
    } catch (e) {}
  }

  const { ROUTES, navigateTo } = require('../../../utils/routes.js')
  navigateTo(ROUTES.ROCKET_MODEL_DETAIL, { configId: configId })
  return true
}

module.exports = {
  openBoosterEntityDetail,
  openRocketModelDetail,
  normalizeSerial,
  serialMatch
}
