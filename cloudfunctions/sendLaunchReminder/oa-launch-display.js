/**
 * 服务号 / 小程序提醒展示文案：与发射卡片中文对齐。
 * - thing* 字段可含中文（任务名、C 通道火箭名等）
 * - character_string* 仅 ASCII（工单/车辆编号槽位继续用英文火箭名）
 */
const { translateRocketName } = require('./rocket-name-i18n.js')
const { localizeMissionTitle } = require('./mission-title-i18n.js')
const { translateAgencyName, inferAgencyFromRocket } = require('./agency-name-i18n.js')

/** thing 字段偏短：去掉 Block N 构型后缀，避免「猎鹰9号 Block 5｜…」截断 */
function stripRocketBlockSuffix(s) {
  return String(s || '')
    .replace(/\s*Block\s*\d+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function resolveOaLaunchDisplay(launch) {
  launch = launch || {}
  var rocketEn = String(launch.rocketName || '').trim()
  var rocketZh = String(launch.rocketNameZh || '').trim()

  // launch_status 兜底只有整段 name「H3-22 | Michibiki…」时，拆出火箭段
  var fullRaw = String(launch.name || launch.nameEn || launch.missionName || '').trim()
  if ((!rocketEn || rocketEn === 'N/A') && fullRaw.indexOf('|') >= 0) {
    rocketEn = fullRaw.split('|')[0].trim()
  }

  if (!rocketZh) rocketZh = translateRocketName(rocketEn) || rocketEn
  rocketZh = stripRocketBlockSuffix(rocketZh)
  if (!rocketZh) rocketZh = '未知火箭'
  if (!rocketEn) {
    var ascii = rocketZh.replace(/[^\x20-\x7E]/g, '').trim()
    rocketEn = ascii || 'N/A'
  }

  var missionEn = String(launch.missionNameEn || launch.nameEn || '').trim()
  var missionRaw = String(launch.missionName || launch.name || '').trim()
  // 优先整段标题本地化（与列表卡 nameZh 一致），再取任务段
  var localizedFull = ''
  if (fullRaw) {
    localizedFull = localizeMissionTitle(fullRaw, rocketEn, rocketZh) || ''
  }
  var missionZh
  if (missionRaw && /[\u4e00-\u9fff]/.test(missionRaw) && !/[A-Za-z]{3,}/.test(missionRaw)) {
    missionZh = missionRaw
  } else if (localizedFull && /[\u4e00-\u9fff]/.test(localizedFull)) {
    if (localizedFull.indexOf('|') >= 0 || localizedFull.indexOf('｜') >= 0) {
      missionZh = localizedFull.split(/\s*[|｜]\s*/).slice(1).join('｜').trim() || localizedFull
    } else {
      missionZh = localizedFull
    }
  } else {
    missionZh =
      localizeMissionTitle(missionRaw || missionEn, rocketEn, rocketZh) ||
      missionRaw ||
      missionEn ||
      '未知任务'
  }

  var pad = String(launch.padNameZh || launch.padName || launch.pad || '').trim()
  var site = String(launch.siteZh || launch.site || '').trim()
  var remark = ''
  if (pad && site && pad !== site) remark = (pad + ' ' + site).substring(0, 20)
  else remark = (pad || site || '').substring(0, 20)

  // 巡检地点：优先发射场（site），避免工位名过长占满 thing
  var siteOnly = (site || pad || '').substring(0, 20)
  var agencyEn = String(launch.launchAgency || '').trim()
  var agencyAbbrev = String(launch.launchAgencyAbbrev || '').trim()
  var agencyZh = String(launch.launchAgencyZh || '').trim()
  if (!agencyZh) {
    agencyZh = translateAgencyName(agencyEn, agencyAbbrev) || ''
  }
  if (!agencyZh && !agencyEn) {
    agencyZh = inferAgencyFromRocket(rocketEn, rocketZh) || ''
  } else if (!agencyZh) {
    agencyZh = agencyEn
  }
  // 运维巡检公司 / 结果「单位名称」= 发射商；切勿回退成火箭名
  var agency = (agencyZh || agencyEn || '待确认').substring(0, 20)

  // 项目名称：与卡片「火箭｜任务」对齐（thing ≤20）；去掉 Block N 防截断
  var projectTitle = ''
  if (localizedFull && /[\u4e00-\u9fff]/.test(localizedFull)) {
    projectTitle = stripRocketBlockSuffix(localizedFull.replace(/\s*\|\s*/g, '｜'))
  } else if (rocketZh && missionZh) {
    missionZh = stripRocketBlockSuffix(missionZh)
    if (missionZh.indexOf(rocketZh) === 0) projectTitle = missionZh
    else projectTitle = rocketZh + '｜' + missionZh
  } else {
    projectTitle = stripRocketBlockSuffix(missionZh || rocketZh || '未知任务')
  }
  projectTitle = projectTitle.substring(0, 20)

  return {
    missionName: missionZh,
    rocketNameZh: rocketZh,
    rocketNameEn: rocketEn,
    remark: remark,
    siteName: siteOnly,
    agencyName: agency,
    projectTitle: projectTitle
  }
}

function isThingFieldKey(key) {
  return /^thing\d*$/i.test(String(key || '').trim())
}

module.exports = {
  resolveOaLaunchDisplay,
  isThingFieldKey,
  translateRocketName,
  localizeMissionTitle
}
