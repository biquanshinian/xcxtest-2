/**
 * 发射列表卡中英字段包：映射时写入 _langPack，切换语言时就地套用，无需整表重拉。
 */

const { isContentLangEn, launchCardUiText, zhField } = require('./locale.js')
const { translateRocketName } = require('./rocket-name-i18n.js')
const { localizeMissionTitle, resolveLaunchMissionOverride } = require('./mission-title-i18n.js')
const { translateLocation, translateAgencyName } = require('./space-terms-i18n.js')

function buildLaunchSitePair(launch) {
  const pad = launch && launch.pad
  if (!pad) {
    return { padLocationZh: '未知地点', padLocationEn: 'Unknown location' }
  }
  const padEn = (pad.name || '').trim()
  const locEn = (pad.location && pad.location.name) ? String(pad.location.name).trim() : ''
  const padZh = zhField(pad, 'name') || translateLocation(padEn) || padEn
  const locZh = pad.location
    ? (zhField(pad.location, 'name') || translateLocation(locEn) || locEn)
    : ''
  // 中文卡优先展示发射场地名（参考图：肯尼迪航天中心 / 酒泉…）
  const padLocationZh = locZh || padZh || '未知地点'
  const padLocationEn = locEn || padEn || 'Unknown location'
  const launchSiteZh = (padZh && locZh && padZh !== locZh)
    ? `${padZh}, ${locZh}`.trim()
    : (padZh || locZh || '未知地点')
  const launchSiteEn = (padEn && locEn && padEn !== locEn)
    ? `${padEn}, ${locEn}`.trim()
    : (padEn || locEn || 'Unknown location')
  return { padLocationZh, padLocationEn, launchSiteZh, launchSiteEn }
}

const WEEKDAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 北京时间（UTC+8）拆件；非法返回 null */
function getBeijingDateParts(iso) {
  if (!iso) return null
  const d = iso instanceof Date ? iso : new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  const cst = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  return {
    year: cst.getUTCFullYear(),
    month: cst.getUTCMonth() + 1,
    day: cst.getUTCDate(),
    hour: cst.getUTCHours(),
    minute: cst.getUTCMinutes(),
    second: cst.getUTCSeconds(),
    weekdayZh: WEEKDAYS_ZH[cst.getUTCDay()],
    weekdayEn: WEEKDAYS_EN[cst.getUTCDay()]
  }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatMissionListTime(iso) {
  const p = getBeijingDateParts(iso)
  if (!p) return ''
  if (isContentLangEn()) {
    return `${pad2(p.month)}/${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`
  }
  return `${pad2(p.month)}月${pad2(p.day)}日 ${pad2(p.hour)}:${pad2(p.minute)}`
}

function formatMissionListTimeOrUnknown(iso) {
  const t = formatMissionListTime(iso)
  return t || launchCardUiText('unknownTime')
}

/** 仅日期（分享/SEO）；固定北京时间 */
function formatMissionListDate(iso) {
  const p = getBeijingDateParts(iso)
  if (!p) return ''
  if (isContentLangEn()) {
    return `${pad2(p.month)}/${pad2(p.day)}`
  }
  return `${pad2(p.month)}月${pad2(p.day)}日`
}

/**
 * 首页倒计时大字时间：YYYY年MM月DD日 + 星期 HH:mm:ss（北京时间）
 * formatDate 参数保留兼容，不再参与时区计算。
 */
function formatHomeLaunchTimeParts(launchTime, _formatDate) {
  const p = getBeijingDateParts(launchTime)
  if (!p) {
    return { date: '时间未知', weekTime: '', full: '时间未知' }
  }
  if (isContentLangEn()) {
    const date = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
    const weekTime = `${p.weekdayEn} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`
    return { date, weekTime, full: `${date} ${weekTime}` }
  }
  const date = `${p.year}年${pad2(p.month)}月${pad2(p.day)}日`
  const weekTime = `${p.weekdayZh} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`
  return { date, weekTime, full: `${date} ${weekTime}` }
}

/**
 * 将当前内容语言套到列表项展示字段（就地修改并返回同一对象）。
 */
function applyContentLangToMission(mission) {
  if (!mission || typeof mission !== 'object') return mission
  const pack = mission._langPack
  const en = isContentLangEn()
  // 列表/日历缓存里可能仍粘着「未知有效载荷」；按 launch.id 覆盖到已公布载荷名
  if (pack) {
    const ov = resolveLaunchMissionOverride(mission.id || mission._id)
    if (ov) {
      const missZh = isGenericMissionTitle(pack.missionNameZh)
      const missEn = isGenericMissionTitle(pack.missionNameEn)
      if (missZh || missEn) {
        if (missZh) pack.missionNameZh = ov.missionNameZh
        if (missEn) pack.missionNameEn = ov.missionNameEn
        const rkZh = String(pack.rocketNameZh || '').trim()
        const rkEn = String(pack.rocketNameEn || '').trim()
        if (isGenericMissionTitle(pack.nameZh)) {
          pack.nameZh = rkZh ? rkZh + ' | ' + ov.missionNameZh : ov.missionNameZh
        }
        if (isGenericMissionTitle(pack.nameEn)) {
          pack.nameEn = rkEn ? rkEn + ' | ' + ov.missionNameEn : ov.missionNameEn
        }
      }
    }
  }
  if (pack) {
    mission.rocketName = en ? pack.rocketNameEn : pack.rocketNameZh
    mission.padLocation = en ? pack.padLocationEn : pack.padLocationZh
    mission.launchSite = en
      ? (pack.launchSiteEn || pack.padLocationEn)
      : (pack.launchSiteZh || pack.padLocationZh)
    mission.name = en ? pack.nameEn : pack.nameZh
    // 列表主标题只用任务段；火箭型号单独一行展示，避免「猎鹰9号 | …」下再重复火箭名
    if (en) {
      mission.missionName = pack.missionNameEn || pack.nameEn
    } else {
      let seg = String(pack.missionNameZh || '').trim()
      const fullZh = String(pack.nameZh || '').trim()
      const rocketZh = String(pack.rocketNameZh || '').trim()
      if (!seg && fullZh) {
        const pipeMatch = fullZh.match(/^(.+?)\s*[|｜]\s*(.+)$/)
        if (pipeMatch) {
          const left = pipeMatch[1].trim()
          const right = pipeMatch[2].trim()
          if (right && (!rocketZh || left === rocketZh || left.indexOf(rocketZh) >= 0 || rocketZh.indexOf(left) >= 0)) {
            seg = right
          }
        } else if (rocketZh && fullZh.indexOf(rocketZh) === 0) {
          seg = fullZh.slice(rocketZh.length).replace(/^\s*[|｜·•\-—]\s*/, '').trim()
        }
      }
      mission.missionName = seg || fullZh || pack.nameEn
    }
    if (en) {
      mission.launchAgency = pack.launchAgencyEn || pack.launchAgencyZh || ''
    } else {
      // 词典优先：避免历史缓存把英文原名写进 launchAgencyZh（如 China Rocket Co. Ltd.）
      const agencyDict = translateAgencyName(
        pack.launchAgencyEn || pack.launchAgencyZh || mission.launchAgency,
        mission.launchAgencyAbbrev
      )
      mission.launchAgency = agencyDict || pack.launchAgencyZh || pack.launchAgencyEn || ''
    }
    mission.countryDisplay = en ? pack.countryDisplayEn : pack.countryDisplayZh
    const badge = en ? pack.statusBadgeTextEn : pack.statusBadgeTextZh
    mission.statusBadgeText = badge
    mission.status = badge
    mission.recoveryTagText = en ? pack.recoveryTagTextEn : pack.recoveryTagTextZh
    // 中文：缓存可能滞后于短语/地点词典，展示前再对齐一次
    // （USSF、文昌全称、以及纯中文误译如「麻雀」←Zhuque）
    if (!en) {
      if (mission.missionName) {
        mission.missionName = localizeMissionTitle(
          mission.missionName,
          pack.rocketNameEn,
          pack.rocketNameZh
        ) || mission.missionName
      }
      if (mission.name) {
        mission.name = localizeMissionTitle(
          mission.name,
          pack.rocketNameEn,
          pack.rocketNameZh
        ) || mission.name
      }
      if (mission.padLocation && /[A-Za-z]{3,}/.test(mission.padLocation)) {
        mission.padLocation =
          translateLocation(mission.padLocation) ||
          translateLocation(pack.padLocationEn) ||
          mission.padLocation
      }
      if (mission.launchSite && /[A-Za-z]{3,}/.test(mission.launchSite)) {
        mission.launchSite =
          translateLocation(mission.launchSite) ||
          translateLocation(pack.launchSiteEn || pack.padLocationEn) ||
          mission.launchSite
      }
      if (mission.rocketName) {
        mission.rocketName =
          translateRocketName(mission.rocketName) ||
          pack.rocketNameZh ||
          mission.rocketName
      }
    }
    // 详情页发射场地块 / missionFull.name 与列表标题同源
    if (mission.padDetail && typeof mission.padDetail === 'object') {
      let padName = en
        ? (pack.padNameEn || mission.padDetail.padName)
        : (pack.padNameZh || mission.padDetail.padName)
      let locationName = en
        ? (pack.locationNameEn || mission.padDetail.locationName)
        : (pack.locationNameZh || mission.padDetail.locationName)
      if (!en) {
        if (padName && /[A-Za-z]{3,}/.test(padName)) {
          padName = translateLocation(padName) || padName
        }
        if (locationName && /[A-Za-z]{3,}/.test(locationName)) {
          locationName = translateLocation(locationName) || locationName
        }
      }
      mission.padDetail = Object.assign({}, mission.padDetail, {
        padName: padName || mission.padDetail.padName,
        locationName: locationName || mission.padDetail.locationName
      })
    }
    if (mission.missionFull && typeof mission.missionFull === 'object') {
      let mfName = en
        ? (pack.missionNameEn || pack.nameEn)
        : (pack.missionNameZh || pack.nameZh)
      if (!en && mfName && /[A-Za-z]{3,}/.test(mfName)) {
        mfName = localizeMissionTitle(mfName, pack.rocketNameEn, pack.rocketNameZh) || mfName
      }
      if (mfName) {
        mission.missionFull = Object.assign({}, mission.missionFull, { name: mfName })
      }
    }
  }
  if (mission.boosterInfo && mission.boosterInfo.flights >= 1) {
    mission.flightCountLabel = launchCardUiText('flightCount', { n: mission.boosterInfo.flights })
  } else {
    mission.flightCountLabel = ''
  }
  mission.langCdDay = launchCardUiText('cdDay')
  mission.langCdHour = launchCardUiText('cdHour')
  mission.langCdMin = launchCardUiText('cdMin')
  mission.langCdSec = launchCardUiText('cdSec')
  mission.langUnknownMission = launchCardUiText('unknownMission')
  mission.langUnknownCountry = launchCardUiText('unknownCountry')
  if (mission.launchTime) {
    mission.formattedTime = formatMissionListTime(mission.launchTime) || launchCardUiText('unknownTime')
  } else if (!mission.formattedTime) {
    mission.formattedTime = launchCardUiText('unknownTime')
  }
  return mission
}

function applyContentLangToMissionList(list) {
  if (!Array.isArray(list)) return list
  for (let i = 0; i < list.length; i++) {
    applyContentLangToMission(list[i])
  }
  return list
}

/**
 * @param {string} rocketNameEn
 * @param {object} [rocketConfiguration] 可带云端 nameZh / full_nameZh（AI 自动翻译）
 */
function buildRocketNamePair(rocketNameEn, rocketConfiguration) {
  const en = String(rocketNameEn || '').trim() || launchCardUiText('unknownRocket')
  const cfg = rocketConfiguration && typeof rocketConfiguration === 'object' ? rocketConfiguration : null
  const fromCloud = cfg
    ? (zhField(cfg, 'full_name') || zhField(cfg, 'name') || '')
    : ''
  const zh = fromCloud || translateRocketName(en) || en
  return { rocketNameEn: en, rocketNameZh: zh }
}

/** 配图/fuzzy 匹配专用：永远用英文火箭名，避免中文展示名 miss 字典 */
function rocketNameForImage(mission) {
  if (!mission || typeof mission !== 'object') return ''
  const fromPack = mission._langPack && mission._langPack.rocketNameEn
  if (fromPack) return String(fromPack).trim()
  if (mission.rocketNameEn) return String(mission.rocketNameEn).trim()
  const cfg = mission.rocketConfiguration
  if (cfg && typeof cfg === 'object') {
    const full = typeof cfg.full_name === 'string' ? cfg.full_name.trim() : ''
    const name = typeof cfg.name === 'string' ? cfg.name.trim() : ''
    if (full || name) return full || name
  }
  // 无 _langPack / configuration 时回退 rocketName / rocket（中文展示名由 util 别名展开兜底）
  return String(mission.rocketName || mission.rocket || '').trim()
}

function buildTitlePair(launch, rocketNameEn, rocketNameZh) {
  const ov = resolveLaunchMissionOverride(launch && launch.id)
  let nameEn = String((launch && launch.name) || '').trim()
  let missionEn = String((launch && launch.mission && launch.mission.name) || '').trim()
  // 云端预翻译优先；再套客户端词典/短语（顺带把机翻残留的 Falcon Heavy 等换成中文火箭名）
  let nameZhFromData = zhField(launch, 'name')
  let missionZhFromData = launch && launch.mission ? zhField(launch.mission, 'name') : ''

  // 占位任务名覆盖（LL2 仍写 Unknown Payload / 旧缓存 nameZh 粘住「未知有效载荷」）
  if (ov) {
    if (isGenericMissionTitle(missionEn)) missionEn = ov.missionNameEn
    if (isGenericMissionTitle(nameEn)) {
      nameEn = (rocketNameEn ? rocketNameEn + ' | ' : '') + ov.missionNameEn
    }
    if (isGenericMissionTitle(missionZhFromData)) missionZhFromData = ov.missionNameZh
    if (isGenericMissionTitle(nameZhFromData)) {
      const rk = rocketNameZh || rocketNameEn || ''
      nameZhFromData = rk ? rk + ' | ' + ov.missionNameZh : ov.missionNameZh
    }
  }

  // 占位中文不得压过已更新的英文（如 nameZh=未知有效载荷，name=ChinaSat 4B）
  if (isGenericMissionTitle(nameZhFromData) && !isGenericMissionTitle(nameEn)) {
    nameZhFromData = ''
  }
  if (isGenericMissionTitle(missionZhFromData) && !isGenericMissionTitle(missionEn)) {
    missionZhFromData = ''
  }

  let nameZh = localizeMissionTitle(nameZhFromData || nameEn, rocketNameEn, rocketNameZh)
    || nameZhFromData
    || nameEn
  let missionZh = localizeMissionTitle(missionZhFromData || missionEn, rocketNameEn, rocketNameZh)
    || missionZhFromData
    || missionEn

  if (ov) {
    if (isGenericMissionTitle(missionZh)) missionZh = ov.missionNameZh
    if (isGenericMissionTitle(nameZh)) {
      const rk = rocketNameZh || rocketNameEn || ''
      nameZh = rk ? rk + ' | ' + ov.missionNameZh : ov.missionNameZh
    }
    if (isGenericMissionTitle(missionEn)) missionEn = ov.missionNameEn
    if (isGenericMissionTitle(nameEn)) {
      nameEn = (rocketNameEn ? rocketNameEn + ' | ' : '') + ov.missionNameEn
    }
  }

  // 中文标题优先完整 launch.name（含火箭|任务），与参考卡「猎鹰重型 | …」一致
  return {
    nameEn: nameEn || missionEn,
    nameZh: nameZh || missionZh || nameEn,
    missionNameEn: missionEn,
    missionNameZh: missionZh
  }
}

/** 占位任务名：详情 LL2 常回 Unknown Payload，不应盖掉列表已译好的「中星4B号」等 */
function isGenericMissionTitle(s) {
  const t = String(s || '').trim()
  if (!t) return true
  const lower = t.toLowerCase()
  if (/^unknown(\s+payloads?)?$/.test(lower)) return true
  if (/^unknown\s+payload/.test(lower)) return true
  if (/^未知有效载荷$/.test(t) || /^未知任务$/.test(t)) return true
  // 整段「火箭 | 未知有效载荷」
  if (/[|｜]\s*(未知有效载荷|unknown\s+payloads?)\s*$/i.test(t)) return true
  return false
}

function hasCjkText(s) {
  return /[\u4e00-\u9fff]/.test(String(s || ''))
}

/**
 * @param {string} preferred 列表侧
 * @param {string} fallback 详情侧
 * @param {{ preferZh?: boolean }} [opts] preferZh：中文槽优先含汉字的一侧，避免未译英文盖掉列表中文
 */
function pickBetterMissionTitle(preferred, fallback, opts) {
  const a = String(preferred || '').trim()
  const b = String(fallback || '').trim()
  if (!a) return b
  if (!b) return a
  const aGen = isGenericMissionTitle(a)
  const bGen = isGenericMissionTitle(b)
  if (!aGen && bGen) return a
  if (aGen && !bGen) return b
  if (opts && opts.preferZh) {
    const aZh = hasCjkText(a)
    const bZh = hasCjkText(b)
    // 列表已是中文、详情 *Zh 仍是英文原文 → 保留列表
    if (aZh && !bZh) return a
    if (!aZh && bZh) return b
    // 两边都有汉字：保留列表（首屏/卡片同源，避免详情机翻回退）
    if (aZh && bZh) return a
  }
  // 英文槽或均无汉字：详情往往更新
  return b || a
}

/**
 * 合并列表/详情 _langPack：详情覆盖机构等地名字段，但占位任务名不覆盖列表中文标题。
 */
function mergeMissionLangPack(listPack, detailPack) {
  const base = listPack && typeof listPack === 'object' ? listPack : null
  const detail = detailPack && typeof detailPack === 'object' ? detailPack : null
  if (!base && !detail) return null
  if (!base) return Object.assign({}, detail)
  if (!detail) return Object.assign({}, base)
  const out = Object.assign({}, base, detail)
  out.missionNameZh = pickBetterMissionTitle(base.missionNameZh, detail.missionNameZh, { preferZh: true })
  out.missionNameEn = pickBetterMissionTitle(base.missionNameEn, detail.missionNameEn)
  out.nameZh = pickBetterMissionTitle(base.nameZh, detail.nameZh, { preferZh: true })
  out.nameEn = pickBetterMissionTitle(base.nameEn, detail.nameEn)
  // 详情任务段是占位或未译英文时，用列表任务段重建完整中文标题
  const detailZhWeak =
    isGenericMissionTitle(detail.missionNameZh) ||
    (!hasCjkText(detail.missionNameZh) && hasCjkText(base.missionNameZh))
  if (detailZhWeak && !isGenericMissionTitle(base.missionNameZh) && hasCjkText(base.missionNameZh)) {
    out.missionNameZh = base.missionNameZh
    const rocket = String(out.rocketNameZh || out.rocketNameEn || '').trim()
    if (rocket && out.missionNameZh) {
      out.nameZh = rocket + ' | ' + out.missionNameZh
    } else if (!isGenericMissionTitle(base.nameZh) && hasCjkText(base.nameZh)) {
      out.nameZh = base.nameZh
    }
  }
  if (isGenericMissionTitle(detail.missionNameEn) && !isGenericMissionTitle(base.missionNameEn)) {
    out.missionNameEn = base.missionNameEn
    const rocketEn = String(out.rocketNameEn || '').trim()
    if (rocketEn && out.missionNameEn) {
      out.nameEn = rocketEn + ' | ' + out.missionNameEn
    } else if (!isGenericMissionTitle(base.nameEn)) {
      out.nameEn = base.nameEn
    }
  }
  return out
}

module.exports = {
  getBeijingDateParts,
  formatMissionListTime,
  formatMissionListTimeOrUnknown,
  formatMissionListDate,
  formatHomeLaunchTimeParts,
  applyContentLangToMission,
  applyContentLangToMissionList,
  buildRocketNamePair,
  buildTitlePair,
  buildLaunchSitePair,
  rocketNameForImage,
  isGenericMissionTitle,
  mergeMissionLangPack
}
