/**
 * api-booster-extract.js
 * 统一的助推器/回收信息提取逻辑
 * 从 api.js 中 5 处重复代码提取而来
 */

const { inferNetRecoveryFromLaunch, buildLandingIcon, isZhuque3Rocket, isLandRecoveryType, normalizeLandingTypeShort, inferLandingTypeFromLocationShort, refineLandingTypeWithContext, isNewGlennRocket, isLpv1Landing } = require('./landing-icons.js')
const { pickLocalized } = require('./locale.js')
const { translateAgencyName } = require('./space-terms-i18n.js')

const ASDS_REGEX = /ASOG|OCISLY|JRTI|A SHORTFALL|OF COURSE I STILL|JUST READ THE INSTRUCTIONS|LPV[\s-]?1|JACKLYN|LANDING PLATFORM VESSEL/i
const RTLS_REGEX = /LZ-|LANDING ZONE|LZ1|LZ2|LZ4/
const REUSABLE_ROCKET_REGEX = /new shepard|starship|super heavy|星舰|long\s*march\s*12\s*b|cz[-\s]*12\s*b|长征\s*12\s*b|长征十二\s*b|长征十二乙/i
const SHIP_BOOSTER_REGEX = /(?:Ship|Booster)\s*\d+/i
const SERIAL_FROM_TEXT_REGEX = /\bB\d{3,5}\b/i
const FLIGHTS_FROM_TEXT_REGEX = /\b(\d{1,3})(?:st|nd|rd|th)?\s+flight\b/i

/**
 * LL2 构型级可复用标记（launcher_configurations.reusable）
 * 中国的发射 LL2 基本不建 stage 级着陆记录，但构型上会标 reusable: true（如长征十号乙网系回收），
 * 以此作为数据驱动的回收信号，替代维护火箭名白名单。
 * 注意：若本次任务在 stage 级明确标了 landing.attempt === false（如猎鹰九一次性构型任务），不视为可回收。
 */
function resolveConfigReusable(launch) {
  if (!launch || !launch.rocket) return false
  const cfg = launch.rocket.configuration ||
    (launch.rocket.rocket && launch.rocket.rocket.configuration)
  if (!cfg || cfg.reusable !== true) return false
  const launcher = resolveLauncher(launch)
  if (launcher && launcher.landing && launcher.landing.attempt === false) return false
  return true
}

/** 把构型级 reusable 信号合入 boosterInfo（无 stage 数据时兜底生成） */
function applyConfigReusable(launch, boosterInfo, finalImage) {
  if (!resolveConfigReusable(launch)) return boosterInfo
  // 网系回收（拦阻网驳船）识别：详情页/首页据此显示"网系回收"文案与专用图标
  // netRecoveryIcon 为按状态着色的内联 SVG（无着陆结果数据时中性色）
  const netRecovery = inferNetRecoveryFromLaunch(launch)
  if (boosterInfo) {
    boosterInfo.configReusable = true
    if (netRecovery) {
      boosterInfo.netRecovery = true
      boosterInfo.netRecoveryIcon = buildLandingIcon('NET_CATCH', 'neutral')
    }
    return boosterInfo
  }
  return {
    landingType: null,
    landingLocation: null,
    image: finalImage,
    configReusable: true,
    netRecovery: netRecovery || undefined,
    netRecoveryIcon: netRecovery ? buildLandingIcon('NET_CATCH', 'neutral') : undefined
  }
}

/**
 * 从 launch 对象中解析 launcher（第一级助推器）
 */
function resolveLauncher(launch) {
  if (!launch || !launch.rocket) return null
  const r = launch.rocket
  let launcher = r.launcher_stage || (r.rocket && r.rocket.launcher_stage) || r.first_stage || null
  if (Array.isArray(launcher) && launcher.length > 0) launcher = launcher[0]
  return (launcher && typeof launcher === 'object') ? launcher : null
}

/**
 * 从 launcher 对象中提取着陆类型
 */
function resolveLandingType(launcher) {
  const ll = launcher.landing
  const typeObj = (ll && ll.type && typeof ll.type === 'object') ? ll.type : null
  let typeStr = launcher.landing_type
    || (typeObj && (typeObj.abbrev || typeObj.name))
    || (ll && typeof ll.type === 'string' ? ll.type : null)
    || (ll && ll.landing_location && typeof ll.landing_location === 'object' ? ll.landing_location.type : null)
  if (typeStr && typeof typeStr === 'object') {
    typeStr = typeStr.name || typeStr.abbrev || null
  }

  let landingLocation = typeof launcher.landing_location === 'string' ? launcher.landing_location : null
  let locAbbrev = null
  let locName = null
  if (landingLocation == null && ll && ll.landing_location && typeof ll.landing_location === 'object') {
    locAbbrev = ll.landing_location.abbrev || null
    locName = ll.landing_location.name || null
    landingLocation = locAbbrev || locName || null
  } else if (landingLocation) {
    locAbbrev = landingLocation
  }

  let landingType = normalizeLandingTypeShort(typeStr)
  if (!landingType && (locAbbrev || locName || landingLocation)) {
    landingType = inferLandingTypeFromLocationShort(locAbbrev || landingLocation, locName)
  }
  // 兼容旧路径：仅靠落点字符串粗判 ASDS/RTLS
  if (!landingType && landingLocation) {
    const loc = String(landingLocation).toUpperCase()
    if (ASDS_REGEX.test(loc)) landingType = 'ASDS'
    else if (RTLS_REGEX.test(loc)) landingType = 'RTLS'
  }

  const landingDescription = (ll && ll.description) || ''
  landingType = refineLandingTypeWithContext(landingType, ll, locAbbrev || landingLocation, locName)
  return { landingType, landingLocation, landingDescription }
}

/** 倒计时/列表：为所有可识别的着陆类型挂上与详情页同源图标（中性色） */
function attachLandingTypeIcon(boosterInfo, launch) {
  if (!boosterInfo || !boosterInfo.landingType) return boosterInfo
  const t = boosterInfo.landingType
  const ld = { description: boosterInfo.landingDescription || '' }
  if (isNewGlennRocket(launch) && isLpv1Landing(ld, boosterInfo.landingLocation, null)) {
    boosterInfo.landingTypeIcon = buildLandingIcon('BO_LZ', 'neutral')
    return boosterInfo
  }
  // LL2 结构化 Net 着陆类型 → 走 netRecoveryIcon 渲染分支（保留 --net 放大样式）
  if (t === 'NET_CATCH') {
    if (!boosterInfo.netRecoveryIcon) {
      boosterInfo.netRecovery = true
      boosterInfo.netRecoveryIcon = buildLandingIcon('NET_CATCH', 'neutral')
    }
    return boosterInfo
  }
  // ASDS/RTLS/VL 由 WXML 静态 SVG 分支兜底（朱雀陆地回收另有 rtlsIcon）；
  // 其余类型（EXPENDED/LOST/HL/SPLASHDOWN/TOWER_CATCH...）统一挂 dataURI，
  // 与详情页 buildLandingDisplay 同源，避免倒计时区域漏图标。
  // EXPENDED/LOST 与详情页同色（橙色 failure），其余中性白
  if (t !== 'ASDS' && t !== 'RTLS' && t !== 'VL') {
    const status = (t === 'EXPENDED' || t === 'LOST') ? 'failure' : 'neutral'
    const icon = buildLandingIcon(t, status)
    if (icon) {
      boosterInfo.landingTypeIcon = icon
      boosterInfo.landingTypeIconStatus = status
    }
  }
  return boosterInfo
}

/**
 * 从 launch 对象提取助推器信息（列表级别：upcoming / completed / monthly / countdown）
 * @param {Object} launch  API 返回的 launch 对象
 * @param {string} rocketName  火箭显示名
 * @param {string} finalImage  火箭图片路径
 * @returns {Object|null} boosterInfo
 */
function extractBoosterInfoForList(launch, rocketName, finalImage) {
  let boosterInfo = null
  const launcher = resolveLauncher(launch)

  if (launcher) {
    const ll = launcher.landing
    const hasStage = launcher.serial_number != null || launcher.flights !== undefined || launcher.launcher_flight_number != null
    const hasLanding = ll && (ll.landing_location || ll.description)
    const hasDirect = launcher.landing_type || (typeof launcher.landing_location === 'string' && launcher.landing_location)
    const hasReused = launcher.reused === true || launcher.reused === false

    if (hasStage || hasLanding || hasDirect || hasReused) {
      const { landingType, landingLocation, landingDescription } = resolveLandingType(launcher)
      const textPool = [landingDescription, (launch.mission && launch.mission.description) || '', launch.name || ''].join(' ')
      const serialFromText = textPool.match(SERIAL_FROM_TEXT_REGEX)
      const flightsFromTextMatch = textPool.match(FLIGHTS_FROM_TEXT_REGEX)
      const flightsFromText = flightsFromTextMatch ? Number(flightsFromTextMatch[1]) : null

      boosterInfo = {
        serialNumber: launcher.serial_number || (serialFromText ? serialFromText[0].toUpperCase() : null),
        status: launcher.status || 'active',
        flightProven: launcher.flight_proven || false,
        flights: launcher.flights !== undefined && launcher.flights !== null
          ? launcher.flights
          : (launcher.launcher_flight_number != null ? launcher.launcher_flight_number : (isNaN(flightsFromText) ? null : flightsFromText)),
        landingAttempt: launcher.attempted_landings !== undefined && launcher.attempted_landings !== null ? launcher.attempted_landings > 0 : null,
        landingSuccess: launcher.successful_landings !== undefined && launcher.successful_landings !== null ? launcher.successful_landings : null,
        landingType,
        landingLocation,
        landingDescription,
        reused: launcher.reused === true ? true : (launcher.reused === false ? false : null),
        image: finalImage
      }
    }
  }

  // 构型级 reusable 信号（slim _v5 起列表缓存保留 configuration.reusable）
  boosterInfo = applyConfigReusable(launch, boosterInfo, finalImage)

  // 可回收火箭推断
  boosterInfo = inferRecoveryFallback(launch, rocketName, finalImage, boosterInfo)

  // 蓝箭朱雀三号：陆地回收用 landspace 图形（与卡片/详情同源 dataURI；倒计时恒 upcoming → neutral 白）
  if (boosterInfo && isLandRecoveryType(boosterInfo.landingType) && isZhuque3Rocket(launch)) {
    boosterInfo.rtlsIcon = buildLandingIcon('LANDSPACE', 'neutral')
  }

  return attachLandingTypeIcon(boosterInfo, launch)
}

/**
 * 从 launch 对象提取助推器信息（简化版：countdown 场景，字段较少）
 */
function extractBoosterInfoSimple(launch, rocketName, finalImage) {
  let boosterInfo = null
  const launcher = resolveLauncher(launch)

  if (launcher) {
    const ll = launcher.landing
    const hasStage = launcher.serial_number != null || launcher.flights !== undefined || launcher.launcher_flight_number != null
    const hasLanding = ll && (ll.landing_location || ll.description)
    const hasDirect = launcher.landing_type || (typeof launcher.landing_location === 'string' && launcher.landing_location)
    const hasReused = launcher.reused === true || launcher.reused === false

    if (hasStage || hasLanding || hasDirect || hasReused) {
      const { landingType, landingLocation, landingDescription } = resolveLandingType(launcher)
      boosterInfo = {
        serialNumber: launcher.serial_number || null,
        flights: launcher.flights !== undefined && launcher.flights !== null
          ? launcher.flights
          : (launcher.launcher_flight_number != null ? launcher.launcher_flight_number : null),
        landingType,
        landingLocation,
        landingDescription,
        reused: launcher.reused === true ? true : (launcher.reused === false ? false : null),
        image: finalImage
      }
    }
  }

  // 构型级 reusable 信号（与列表版一致）
  boosterInfo = applyConfigReusable(launch, boosterInfo, finalImage)

  if (boosterInfo && isLandRecoveryType(boosterInfo.landingType) && isZhuque3Rocket(launch)) {
    boosterInfo.rtlsIcon = buildLandingIcon('LANDSPACE', 'neutral')
  }

  // 可回收火箭推断（简化版不做 Ship/Booster serial 检查）
  if (!boosterInfo) {
    const cfg = (launch.rocket && launch.rocket.configuration) || (launch.rocket && launch.rocket.rocket && launch.rocket.rocket.configuration)
    const familyNames = (cfg && Array.isArray(cfg.families)) ? cfg.families.map(f => (f && f.name) ? f.name : '').filter(Boolean).join(' ') : ''
    const nameForReuse = [rocketName, familyNames, (cfg && typeof cfg.variant === 'string' ? cfg.variant : null), (typeof launch.name === 'string' ? launch.name : null)].filter(Boolean).join(' ')
    if (REUSABLE_ROCKET_REGEX.test(nameForReuse || rocketName)) {
      boosterInfo = { landingType: 'RTLS', landingLocation: null, image: finalImage, inferredRecovery: true }
      if (isZhuque3Rocket(launch)) boosterInfo.rtlsIcon = buildLandingIcon('LANDSPACE', 'neutral')
    }
  }

  return attachLandingTypeIcon(boosterInfo, launch)
}

/**
 * 可回收火箭推断兜底逻辑（列表级别共用）
 */
function inferRecoveryFallback(launch, rocketName, finalImage, boosterInfo) {
  const cfg = (launch.rocket && launch.rocket.configuration) || (launch.rocket && launch.rocket.rocket && launch.rocket.rocket.configuration)
  const familyNames = (cfg && Array.isArray(cfg.families)) ? cfg.families.map(f => (f && f.name) ? f.name : '').filter(Boolean).join(' ') : ''
  const nameForReuse = [rocketName, familyNames, (cfg && typeof cfg.variant === 'string' ? cfg.variant : null), (typeof (launch && launch.name) === 'string' ? launch.name : null)].filter(Boolean).join(' ')

  if (!boosterInfo && REUSABLE_ROCKET_REGEX.test(nameForReuse || rocketName)) {
    boosterInfo = { landingType: 'RTLS', landingLocation: null, image: finalImage, inferredRecovery: true }
  }

  if (!boosterInfo) {
    const text = [launch.name, (launch.mission && launch.mission.name), (launch.mission && launch.mission.description)].filter(Boolean).join(' ')
    if (SHIP_BOOSTER_REGEX.test(text)) {
      boosterInfo = { landingType: 'RTLS', landingLocation: null, image: finalImage, inferredRecovery: true }
    } else {
      const checkSerial = (s) => (typeof s === 'string' && SHIP_BOOSTER_REGEX.test(s))
      const stages = [
        (launch.rocket && launch.rocket.launcher_stage),
        (launch.rocket && launch.rocket.spacecraft_stage),
        (launch.rocket && launch.rocket.configuration && launch.rocket.configuration.launcher_stage),
        (launch.rocket && launch.rocket.configuration && launch.rocket.configuration.spacecraft_stage)
      ].filter(Boolean)
      for (const arr of stages) {
        if (!Array.isArray(arr)) continue
        for (const it of arr) {
          if (!it || typeof it !== 'object') continue
          const sn = (it.serial_number != null ? it.serial_number : (it.launcher && it.launcher.serial_number != null ? it.launcher.serial_number : (it.spacecraft && it.spacecraft.serial_number != null ? it.spacecraft.serial_number : undefined)))
          if (checkSerial(sn)) { boosterInfo = { landingType: 'RTLS', landingLocation: null, image: finalImage, inferredRecovery: true }; break }
        }
        if (boosterInfo) break
      }
    }
  }

  // 兜底：Starship 一律标为可回收
  const _all = [rocketName, familyNames, (cfg && typeof cfg.variant === 'string' ? cfg.variant : null), launch.name, (launch.mission && launch.mission.name), (launch.mission && launch.mission.description)].filter(Boolean).join(' ')
  if (/starship/i.test(_all) && !(boosterInfo && (boosterInfo.landingType || boosterInfo.landingLocation || boosterInfo.configReusable))) {
    boosterInfo = { landingType: 'RTLS', landingLocation: null, image: finalImage, inferredRecovery: true }
  }

  return boosterInfo
}

/**
 * 判断 boosterInfo 是否表示本次任务可回收
 */
function isRecoverable(boosterInfo) {
  if (!boosterInfo) return false
  // 构型级 reusable（LL2 launcher_configurations.reusable）是权威数据信号，直接判定可回收
  if (boosterInfo.configReusable === true) return true
  return !!(
    !boosterInfo.inferredRecovery &&
    (
      boosterInfo.landingType ||
      boosterInfo.landingLocation ||
      (typeof boosterInfo.landingDescription === 'string' && boosterInfo.landingDescription.trim())
    )
  )
}

/** Space Devs /media 相对路径补全（launch 内嵌对象常为相对路径） */
function absolutizeAgencyAssetUrl(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  if (/^cloud:\/\//i.test(s)) return s
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('//')) return `https:${s}`
  if (s.startsWith('/')) return `https://ll.thespacedevs.com${s}`
  return s
}

function pickImageLikeField(obj) {
  if (!obj) return ''
  if (typeof obj === 'string') return obj.trim()
  if (typeof obj !== 'object') return ''
  /* 与监控页发射商图鉴一致：优先缩略图 */
  const nested =
    (typeof obj.thumbnail_url === 'string' && obj.thumbnail_url.trim()) ||
    (typeof obj.image_url === 'string' && obj.image_url.trim()) ||
    (typeof obj.url === 'string' && obj.url.trim())
  return nested ? nested.trim() : ''
}

function pickAgencyImageUrl(entity) {
  if (!entity || typeof entity !== 'object') return ''
  const direct =
    (typeof entity.image_url === 'string' && entity.image_url.trim()) ||
    (typeof entity.logo_url === 'string' && entity.logo_url.trim())
  const fromLogoObj = pickImageLikeField(entity.logo)
  const fromImageObj = pickImageLikeField(entity.image)
  const fromSocial = pickImageLikeField(entity.social_logo)
  const picked = (direct && direct.trim()) || fromLogoObj || fromImageObj || fromSocial || ''
  return picked ? absolutizeAgencyAssetUrl(picked) : ''
}

/**
 * 提取发射机构信息
 */
function extractLaunchAgency(launch) {
  let launchAgency = ''
  let launchAgencyId = null
  let launchAgencyAbbrev = ''
  let launchAgencyImage = ''
  if (launch.launch_service_provider && launch.launch_service_provider.name) {
    const lsp = launch.launch_service_provider
    // 中文模式下用词典译名（CASC→中国航天科技集团等）；未收录保留原名
    launchAgency = pickLocalized(translateAgencyName(lsp.name, lsp.abbrev), lsp.name)
    launchAgencyId = lsp.id != null ? lsp.id : null
    launchAgencyAbbrev = lsp.abbrev || ''
    launchAgencyImage = pickAgencyImageUrl(lsp)
  } else if (launch.program && launch.program.length > 0) {
    const program = launch.program[0]
    if (program.agencies && program.agencies.length > 0) {
      const ag = program.agencies[0]
      launchAgency = pickLocalized(translateAgencyName(ag.name, ag.abbrev), ag.name)
      launchAgencyId = ag.id != null ? ag.id : null
      launchAgencyAbbrev = ag.abbrev || ''
      launchAgencyImage = pickAgencyImageUrl(ag)
    }
  }
  return { launchAgency, launchAgencyId, launchAgencyAbbrev, launchAgencyImage }
}

/**
 * 空列表结果
 */
function emptyListResult() {
  return { list: [], hasMore: false, nextOffset: 0 }
}

/**
 * Promise 超时包装
 */
function withTimeout(promise, ms, msg) {
  if (ms === undefined) ms = 5000
  if (msg === undefined) msg = '请求超时'
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(msg)) }, ms)
    })
  ])
}

/**
 * 解包云数据库缓存数据（消除 6 处重复的层层判断）
 */
function unwrapCacheData(docData) {
  let apiData = docData.data || docData
  if (apiData && typeof apiData === 'object' && !Array.isArray(apiData)) {
    if (apiData.data && apiData.data.results && Array.isArray(apiData.data.results)) {
      apiData = apiData.data
    }
  }
  return apiData
}

module.exports = {
  extractBoosterInfoForList,
  extractBoosterInfoSimple,
  inferRecoveryFallback,
  isRecoverable,
  resolveConfigReusable,
  extractLaunchAgency,
  emptyListResult,
  withTimeout,
  unwrapCacheData,
  resolveLauncher,
  resolveLandingType,
  ASDS_REGEX,
  RTLS_REGEX,
  REUSABLE_ROCKET_REGEX,
  SHIP_BOOSTER_REGEX
}
