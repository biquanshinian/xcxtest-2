/**
 * 现场奖品卡视图模型（抽卡结果覆盖层 / 我的奖品卡册共用）
 *
 * 商业化分档只看商家后台填写的奖品价值 valueYuan（元）：
 *   ≥188 SSR 压轴大奖 · ≥68 SR 珍稀好礼 · >0 R 甄选好礼 · 其余 N 纪念好礼
 * 卡面同时是领奖凭证：凭证号取云端 drawId 尾段，编号/日期/场次一并上卡。
 * 纯逻辑无 wx 依赖，供 Node 审计直接单测。
 */

var PRIZE_TIER_THRESHOLDS = { SSR: 188, SR: 68 }

var TIER_META = {
  SSR: { label: '压轴大奖', en: 'GRAND PRIZE' },
  SR: { label: '珍稀好礼', en: 'RARE PRIZE' },
  R: { label: '甄选好礼', en: 'SELECT PRIZE' },
  N: { label: '纪念好礼', en: 'SOUVENIR' }
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

/**
 * 价值 → 分档
 * @param {number|null} valueYuan
 * @returns {{ tier: 'N'|'R'|'SR'|'SSR', label: string, en: string }}
 */
function resolvePrizeTier(valueYuan) {
  var v = Number(valueYuan)
  var tier = 'N'
  if (isFinite(v) && v > 0) {
    if (v >= PRIZE_TIER_THRESHOLDS.SSR) tier = 'SSR'
    else if (v >= PRIZE_TIER_THRESHOLDS.SR) tier = 'SR'
    else tier = 'R'
  }
  return { tier: tier, label: TIER_META[tier].label, en: TIER_META[tier].en }
}

/** 凭证号：drawId 尾段大写；无 drawId 时不出凭证行 */
function buildVoucherNo(drawId) {
  var raw = String(drawId || '').replace(/[^0-9a-zA-Z]/g, '')
  if (!raw) return ''
  return 'WP-' + raw.slice(-8).toUpperCase()
}

/**
 * 组装卡面视图模型
 * @param {object} prize 云端 prize/card/draw 记录（name/image/valueYuan/serialNo/stock|limitTotal/desc）
 * @param {object} [extra] { drawId, createdAt, sessionTitle, rocketName, missionName }
 */
function decoratePrizeCard(prize, extra) {
  var p = prize && typeof prize === 'object' ? prize : {}
  var x = extra && typeof extra === 'object' ? extra : {}

  var valueYuan = p.valueYuan == null || p.valueYuan === '' ? null : Number(p.valueYuan)
  if (!isFinite(valueYuan)) valueYuan = null
  var tierInfo = resolvePrizeTier(valueYuan)

  var serialNo = Number(p.serialNo) || 0
  var limitTotal = Number(p.stock || p.limitTotal) || 0
  var serialText = ''
  if (serialNo > 0) {
    serialText = limitTotal > 0
      ? '限量 No.' + serialNo + '/' + limitTotal
      : 'No.' + serialNo
  }

  var ts = Number(x.createdAt) || Date.now()
  var d = new Date(ts)
  var dateText = isNaN(d.getTime())
    ? ''
    : d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate())

  var sessionLine = String(x.sessionTitle || '').trim()
  if (!sessionLine) {
    sessionLine = [x.rocketName, x.missionName]
      .map(function (s) { return String(s || '').trim() })
      .filter(Boolean)
      .join(' · ')
  }

  return {
    name: p.name || '',
    image: p.image || '',
    valueYuan: valueYuan,
    valueText: valueYuan != null ? '¥' + valueYuan : '',
    // 价值行已单独展示，desc 只保留商家自定义文案，避免「价值约 ¥x」重复出现
    desc: valueYuan != null ? '' : (p.desc || ''),
    tier: tierInfo.tier,
    tierLabel: tierInfo.label,
    tierEn: tierInfo.en,
    serialNo: serialNo,
    limitTotal: limitTotal,
    serialText: serialText,
    voucherNo: buildVoucherNo(x.drawId),
    dateText: dateText,
    sessionLine: sessionLine
  }
}

module.exports = {
  PRIZE_TIER_THRESHOLDS,
  resolvePrizeTier,
  decoratePrizeCard
}
