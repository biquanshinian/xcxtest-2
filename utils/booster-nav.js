/**
 * 可回收火箭实体详情统一跳转：门控 → 预塞族谱档案 → booster-detail
 * 任务详情 / 首页倒计时 / 族谱 / 监控图鉴共用，保证同一数据骨架。
 */

function normalizeSerial(serial) {
  return String(serial || '').trim()
}

function serialMatch(item, serial) {
  if (!item || !serial) return false
  const a = String(item.serialNumber || item.serial || '').trim()
  if (!a) return false
  return a === serial || a.toUpperCase() === serial.toUpperCase()
}

/**
 * @param {string} serial
 * @param {Object} [options]
 *   - raw: 已有族谱原始文档（族谱列表入口可直接传入，免再拉）
 *   - heroImage: 卡片当前已显示的图（详情头图复用，避免卡有图详无图）
 *   - skipGate: 已在外层做过门控时跳过
 * @returns {Promise<boolean>} 是否已发起跳转
 */
async function openBoosterEntityDetail(serial, options) {
  options = options || {}
  serial = normalizeSerial(serial)
  if (!serial || serial === '未披露') {
    wx.showToast({ title: '暂无该助推器档案', icon: 'none' })
    return false
  }

  if (!options.skipGate) {
    try {
      const { gateCheck } = require('./membership.js')
      const allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
      if (!allowed) return false
    } catch (e) {
      // 门控异常 fail-open，与 membership 其它入口一致
    }
  }

  let raw = options.raw || null
  if (!raw) {
    try {
      const { getBoosterGenealogy } = require('./api-app-services.js')
      const list = await getBoosterGenealogy()
      raw = (list || []).find(function (b) { return serialMatch(b, serial) }) || null
    } catch (e) {
      raw = null
    }
  }

  try {
    const app = typeof getApp === 'function' ? getApp() : null
    if (app && raw) app._boosterDetailData = raw
    // 与飞船图鉴 _spacecraftHeroImage 同模式：卡面图直传详情头图
    if (app && options.heroImage) {
      app._boosterHeroImage = { serial: serial, src: String(options.heroImage) }
    }
  } catch (e) {}

  const { ROUTES, navigateTo } = require('./routes.js')
  navigateTo(ROUTES.BOOSTER_DETAIL, { serial: serial })
  return true
}

/**
 * 火箭型号详情统一跳转：门控 → rocket-model-detail（_config_meta 缺失时页面自带 LL2 兜底）
 * @param {string|number} configId LL2 launcher_configuration id
 * @param {Object} [options]
 *   - skipGate: 已在外层做过门控时跳过
 * @returns {Promise<boolean>} 是否已发起跳转
 */
async function openRocketModelDetail(configId, options) {
  options = options || {}
  if (configId == null || configId === '') {
    wx.showToast({ title: '暂无该型号档案', icon: 'none' })
    return false
  }

  if (!options.skipGate) {
    try {
      const { gateCheck } = require('./membership.js')
      const allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
      if (!allowed) return false
    } catch (e) {
      // 门控异常 fail-open，与 membership 其它入口一致
    }
  }

  const { ROUTES, navigateTo } = require('./routes.js')
  navigateTo(ROUTES.ROCKET_MODEL_DETAIL, { configId: configId })
  return true
}

module.exports = {
  openBoosterEntityDetail,
  openRocketModelDetail,
  normalizeSerial,
  serialMatch
}
