/**
 * 发射列表卡中英字段包：映射时写入 _langPack，切换语言时就地套用，无需整表重拉。
 */

const { isContentLangEn, launchCardUiText, zhField, pickLocalized, isUsableZhText, seedDescI18nFields, repairZhForDisplay } = require('./locale.js')
const { resolveLaunchMissionOverride, localizeMissionTitle } = require('./mission-title-i18n.js')
const { translateRocketName } = require('./rocket-name-i18n.js')
const { translateAgencyName } = require('./agency-name-i18n.js')
const { translateLocation } = require('./space-terms-display.js')

function buildLaunchSitePair(launch) {
  const pad = launch && launch.pad
  if (!pad) {
    return { padLocationZh: '未知地点', padLocationEn: 'Unknown location' }
  }
  const padEn = (pad.name || '').trim()
  const locEn = (pad.location && pad.location.name) ? String(pad.location.name).trim() : ''
  const padZh = zhField(pad, 'name') || translateLocation(padEn)
  const locZh = pad.location
    ? (zhField(pad.location, 'name') || translateLocation(locEn))
    : ''
  // 中文卡优先展示发射场地名（参考图：肯尼迪航天中心 / 酒泉…）
  // *Zh 槽禁止回填英文，展示回退交给 applyContentLang
  const padLocationZh = locZh || padZh || ''
  const padLocationEn = locEn || padEn || 'Unknown location'
  const launchSiteZh = (padZh && locZh && padZh !== locZh)
    ? `${padZh}, ${locZh}`.trim()
    : (padZh || locZh || '')
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

function hasDisplayZh(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''))
}

function hasCjkText(s) {
  return /[\u4e00-\u9fff]/.test(String(s || ''))
}

/** 英文槽只收无汉字文本，避免把已套中文的展示字段写回 *En */
function pickEnglishSlot(packVal, fallbacks) {
  const list = [packVal].concat(Array.isArray(fallbacks) ? fallbacks : [])
  for (let i = 0; i < list.length; i++) {
    const s = String(list[i] || '').trim()
    if (s && !hasCjkText(s)) return s
  }
  return ''
}

function fillZhFromDict(current, en, mapper) {
  const repaired = repairZhForDisplay(current)
  if (isUsableZhText(repaired)) return repaired
  const mapped = mapper ? mapper(en) : ''
  if (mapped && hasDisplayZh(mapped) && isUsableZhText(mapped)) return String(mapped).trim()
  if (mapped && hasDisplayZh(mapped)) return String(mapped).trim()
  return ''
}

/**
 * 缺 *Zh 或假英文 *Zh 时，用与列表卡同一套词典补齐，避免详情首屏先英后中。
 */
function hydrateMissionLangPack(mission) {
  if (!mission || typeof mission !== 'object') return mission
  const pack = mission._langPack && typeof mission._langPack === 'object'
    ? mission._langPack
    : {}
  const pad = mission.padDetail && typeof mission.padDetail === 'object' ? mission.padDetail : null
  const nameEn = pickEnglishSlot(pack.nameEn, [mission.nameEn, mission.name])
  const missionEn = pickEnglishSlot(pack.missionNameEn, [mission.missionNameEn, mission.missionName])
  const rocketEn = pickEnglishSlot(pack.rocketNameEn, [mission.rocketNameEn, mission.rocketName])
  const padEn = pickEnglishSlot(pack.padLocationEn, [mission.padLocationEn, mission.padLocation])
  const siteEn = pickEnglishSlot(pack.launchSiteEn, [mission.launchSiteEn, mission.launchSite])
  const padNameEn = pickEnglishSlot(pack.padNameEn, [pad && pad.padNameEn, pad && pad.padName])
  const locNameEn = pickEnglishSlot(pack.locationNameEn, [pad && pad.locationNameEn, pad && pad.locationName])
  const agencyEn = pickEnglishSlot(pack.launchAgencyEn, [mission.launchAgencyEn, mission.launchAgency])
  const agencyAbbrev = String(mission.launchAgencyAbbrev || '').trim()

  pack.nameEn = nameEn
  pack.missionNameEn = missionEn
  pack.rocketNameEn = rocketEn
  pack.padLocationEn = padEn
  pack.launchSiteEn = siteEn
  pack.padNameEn = padNameEn
  pack.locationNameEn = locNameEn
  pack.launchAgencyEn = agencyEn

  const rocketZh = fillZhFromDict(pack.rocketNameZh, rocketEn, translateRocketName)
  pack.rocketNameZh = rocketZh
  pack.nameZh = fillZhFromDict(pack.nameZh, nameEn, function (en) {
    return localizeMissionTitle(en, rocketEn, rocketZh)
  })
  pack.missionNameZh = fillZhFromDict(pack.missionNameZh, missionEn, function (en) {
    return localizeMissionTitle(en, rocketEn, rocketZh)
  })
  pack.padLocationZh = fillZhFromDict(pack.padLocationZh, padEn, translateLocation)
  pack.launchSiteZh = fillZhFromDict(pack.launchSiteZh, siteEn, translateLocation)
  pack.padNameZh = fillZhFromDict(pack.padNameZh, padNameEn, translateLocation)
  pack.locationNameZh = fillZhFromDict(pack.locationNameZh, locNameEn, translateLocation)
  pack.launchAgencyZh = resolveAgencyDisplayZh(agencyEn, agencyAbbrev, pack.launchAgencyZh)

  mission._langPack = pack
  return mission
}

/**
 * 将当前内容语言套到列表项展示字段（就地修改并返回同一对象）。
 */
function applyContentLangToMission(mission) {
  if (!mission || typeof mission !== 'object') return mission
  hydrateMissionLangPack(mission)
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
    mission.rocketName = en
      ? (pack.rocketNameEn || pack.rocketNameZh)
      : (pack.rocketNameZh || pack.rocketNameEn)
    mission.padLocation = en
      ? (pack.padLocationEn || pack.padLocationZh)
      : (pack.padLocationZh || pack.padLocationEn)
    mission.launchSite = en
      ? (pack.launchSiteEn || pack.padLocationEn || pack.launchSiteZh)
      : (pack.launchSiteZh || pack.padLocationZh || pack.launchSiteEn)
    mission.name = en ? (pack.nameEn || pack.nameZh) : (pack.nameZh || pack.nameEn)
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
    mission.launchAgency = en
      ? (pack.launchAgencyEn || pack.launchAgencyZh || '')
      : (pack.launchAgencyZh || pack.launchAgencyEn || '')
    mission.countryDisplay = en ? pack.countryDisplayEn : pack.countryDisplayZh
    const badge = en ? pack.statusBadgeTextEn : pack.statusBadgeTextZh
    mission.statusBadgeText = badge
    mission.status = badge
    mission.recoveryTagText = en ? pack.recoveryTagTextEn : pack.recoveryTagTextZh
    // 详情页发射场地块 / missionFull.name 与列表标题同源；只读云端 *Zh
    if (mission.padDetail && typeof mission.padDetail === 'object') {
      const padName = en
        ? (pack.padNameEn || pack.padNameZh || mission.padDetail.padName)
        : (pack.padNameZh || pack.padNameEn || mission.padDetail.padName)
      const locationName = en
        ? (pack.locationNameEn || pack.locationNameZh || mission.padDetail.locationName)
        : (pack.locationNameZh || pack.locationNameEn || mission.padDetail.locationName)
      mission.padDetail = Object.assign({}, mission.padDetail, {
        padName: padName || mission.padDetail.padName,
        locationName: locationName || mission.padDetail.locationName
      })
    }
    if (mission.missionFull && typeof mission.missionFull === 'object') {
      const mfName = en
        ? (pack.missionNameEn || pack.nameEn)
        : (pack.missionNameZh || pack.nameZh)
      if (mfName) {
        mission.missionFull = Object.assign({}, mission.missionFull, { name: mfName })
      }
    }
  }
  if (Array.isArray(mission.boosterStages) && mission.boosterStages.length) {
    mission.boosterStages = mission.boosterStages.map((stage) => {
      if (!stage || typeof stage !== 'object') return stage
      const next = {}
      const zh = stage.landingDescriptionZh || ''
      const enText = stage.landingDescriptionEn || ''
      if (zh || enText) {
        next.landingDescription = pickLocalized(zh, enText) || stage.landingDescription
      }
      const locZh = stage.landingLocationZh || ''
      const locEn = stage.landingLocationEn || stage.landingLocation || ''
      if (locZh || locEn) {
        next.landingLocation = pickLocalized(locZh, '') || translateLocation(locEn) || locEn || stage.landingLocation
      }
      return Object.keys(next).length ? Object.assign({}, stage, next) : stage
    })
  }
  if (mission.boosterInfo && typeof mission.boosterInfo === 'object') {
    const infoPatch = {}
    const infoZh = mission.boosterInfo.landingDescriptionZh || ''
    const infoEn = mission.boosterInfo.landingDescriptionEn || ''
    if (infoZh || infoEn) {
      infoPatch.landingDescription = pickLocalized(infoZh, infoEn) || mission.boosterInfo.landingDescription
    }
    const locZh = mission.boosterInfo.landingLocationZh || ''
    const locEn = mission.boosterInfo.landingLocationEn || mission.boosterInfo.landingLocation || ''
    if (locZh || locEn) {
      infoPatch.landingLocation = pickLocalized(locZh, '') || translateLocation(locEn) || locEn || mission.boosterInfo.landingLocation
    }
    if (Object.keys(infoPatch).length) {
      mission.boosterInfo = Object.assign({}, mission.boosterInfo, infoPatch)
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

/**
 * 详情页长文：云端已有可用 *Zh 时第一帧写入 descI18n，按钮直接显示「原文」。
 * 没有 *Zh 的段落保持英文原文，不进页自动机翻。
 */
function seedMissionDescI18n(mission) {
  if (!mission || typeof mission !== 'object' || isContentLangEn()) {
    return {
      descI18n: {
        missionDesc: '',
        rocketDesc: '',
        payloads: [],
        programs: [],
        updates: [],
        failReason: '',
        statusNote: '',
        padDesc: '',
        locDesc: '',
        weather: ''
      },
      descTranslated: false
    }
  }
  const mf = mission.missionFull || {}
  const rf = mission.rocketFull || {}
  const pad = mission.padDetail || {}
  const payloads = Array.isArray(mission.payloadDetails) ? mission.payloadDetails : []
  const programs = Array.isArray(mission.programInfo) ? mission.programInfo : []
  return seedDescI18nFields({
    missionDesc: mf.descriptionZh,
    rocketDesc: rf.descriptionZh,
    payloads: payloads.map((p) => (p && (p.descriptionZh || zhField(p, 'description'))) || ''),
    programs: programs.map((p) => (p && (p.descriptionZh || zhField(p, 'description'))) || ''),
    updates: [],
    failReason: mission.failReasonZh,
    statusNote: mission.statusDescriptionZh,
    padDesc: pad.padDescriptionZh,
    locDesc: pad.locationDescriptionZh,
    weather: mission.weatherConcernsZh
  })
}

/** 用户已点「原文」时，后台刷新不得再把 descI18n 填回中文 */
function takeDescSeed(page, mission) {
  if (page && page._textTranslateReverted) return {}
  return seedMissionDescI18n(mission)
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
  const fromDict = translateRocketName(en) || ''
  const zh = fromCloud || (hasDisplayZh(fromDict) ? fromDict : '')
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
  // 与详情页同一条路：云端 *Zh → localizeMissionTitle（USSF/朱雀等）→ 英文
  let nameZhFromData = zhField(launch, 'name')
  let missionZhFromData = launch && launch.mission ? zhField(launch.mission, 'name') : ''
  if (!nameZhFromData && nameEn) {
    const loc = localizeMissionTitle(nameEn, rocketNameEn, rocketNameZh)
    if (isUsableZhText(loc)) nameZhFromData = loc
  }
  if (!missionZhFromData && missionEn) {
    const loc = localizeMissionTitle(missionEn, rocketNameEn, rocketNameZh)
    if (isUsableZhText(loc)) missionZhFromData = loc
  }

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

  let nameZh = nameZhFromData || ''
  let missionZh = missionZhFromData || ''

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
    nameZh: nameZh || missionZh,
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

/**
 * @param {string} preferred 列表侧
 * @param {string} fallback 详情侧（云端 nameZh）
 * @param {{ preferZh?: boolean }} [opts] preferZh：中文槽避免未译英文盖掉已有中文
 */
function pickBetterMissionTitle(preferred, fallback, opts) {
  const a = String(preferred || '').trim()
  const b = String(fallback || '').trim()
  if (!a) return b
  if (!b) return a
  const aGen = isGenericMissionTitle(a)
  const bGen = isGenericMissionTitle(b)
  // 占位名（未知有效载荷等）不得覆盖已公布的真实译名
  if (!aGen && bGen) return a
  if (aGen && !bGen) return b
  if (opts && opts.preferZh) {
    const aZh = hasCjkText(a)
    const bZh = hasCjkText(b)
    // 列表已是中文、详情 *Zh 仍是英文原文 → 保留列表
    if (aZh && !bZh) return a
    if (!aZh && bZh) return b
    // 两边都是真实中文：以云端详情为准，译名纠偏只改云函数即可生效
    if (aZh && bZh) return b
  }
  // 英文槽或均无汉字：详情往往更新
  return b || a
}

/**
 * 合并列表/详情 _langPack：详情覆盖机构、译名等云端字段；
 * 仅当详情仍是占位/未译英文时，才用列表中文标题托底。
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

/** 机构展示名：云端 nameZh → 与详情同一词典 → 英文 */
function resolveAgencyDisplayZh(name, abbrev, cloudZh) {
  const fromCloud = pickLocalized(cloudZh, '')
  if (fromCloud) return fromCloud
  const mapped = translateAgencyName(name, abbrev)
  return isUsableZhText(mapped) ? mapped : ''
}

module.exports = {
  getBeijingDateParts,
  formatMissionListTime,
  formatMissionListTimeOrUnknown,
  formatMissionListDate,
  formatHomeLaunchTimeParts,
  applyContentLangToMission,
  applyContentLangToMissionList,
  hydrateMissionLangPack,
  seedMissionDescI18n,
  takeDescSeed,
  buildRocketNamePair,
  buildTitlePair,
  buildLaunchSitePair,
  rocketNameForImage,
  isGenericMissionTitle,
  mergeMissionLangPack,
  resolveAgencyDisplayZh
}
