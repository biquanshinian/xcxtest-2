/**
 * LL2 / SNAPI 同步数据翻译富化 — 写入 xxxZh 字段供小程序按语言展示
 * 火箭型号名：本地词典 → 学习词典 → AI 机翻；译出后回写 rocket_name_dict。
 */
const { translateTextsBatch } = require('./translate.js')
const { translateRocketName } = require('./rocket-name-i18n.js')
const {
  warmRocketNameDict,
  lookupLearnedRocketName,
  rememberRocketName
} = require('./rocket-name-learn.js')
const {
  translateOrbit,
  translateMissionType,
  translateStatusName,
  translateEventType,
  translateDatePrecision,
  translateLocation,
  translateLandingType,
  translateAgencyType,
  translateCountryName,
  isUsableZhText
} = require('./space-terms-i18n.js')
const { repairAerospaceZhMistranslations, localizeMissionTitle } = require('./mission-title-i18n.js')
const { translateAgencyName, isAgencyNameResolved } = require('./agency-name-i18n.js')

/** 纠偏已写入的 *Zh（含旧缓存「人物-13」「雀雀」），不依赖本轮是否再机翻 */
function repairExistingLaunchZhTitles(launch) {
  if (!launch || typeof launch !== 'object') return false
  let changed = false
  function repair(obj, key) {
    if (!obj || obj[key] == null) return
    const next = repairAerospaceZhMistranslations(obj[key])
    if (next && next !== obj[key]) {
      obj[key] = next
      changed = true
    }
  }
  repair(launch, 'nameZh')
  if (launch.mission) {
    repair(launch.mission, 'nameZh')
    repair(launch.mission, 'descriptionZh')
    if (launch.mission.type && typeof launch.mission.type === 'object') {
      repair(launch.mission.type, 'nameZh')
    }
  }
  if (launch.pad) {
    repair(launch.pad, 'nameZh')
    if (launch.pad.location) repair(launch.pad.location, 'nameZh')
  }
  if (launch.status) repair(launch.status, 'nameZh')
  if (launch.launch_service_provider) repair(launch.launch_service_provider, 'nameZh')
  const rocketCfg = launch.rocket && launch.rocket.configuration
  if (rocketCfg) {
    repair(rocketCfg, 'nameZh')
    repair(rocketCfg, 'full_nameZh')
    repair(rocketCfg, 'descriptionZh')
  }
  iterLaunchLandings(launch, (landing) => {
    repair(landing, 'descriptionZh')
    const loc = landing.landing_location || landing.location
    if (loc) repair(loc, 'nameZh')
  })
  return changed
}

function shouldSlimLaunchList(url, params) {
  const u = String(url || '')
  const mode = params && params.mode
  return (u.includes('/launches/upcoming/') || u.includes('/launches/previous/')) && mode === 'detailed'
}

function isArticlesEndpoint(url, apiBase) {
  const u = String(url || '')
  if (u.includes('/articles')) return true
  if (apiBase && String(apiBase).includes('spaceflightnewsapi')) return true
  return false
}

function isEventsEndpoint(url) {
  return String(url || '').includes('/events/')
}

function hasUsableZh(obj, zhKey) {
  if (!obj || typeof obj !== 'object') return false
  return isUsableZhText(obj[zhKey])
}

function isEnglishish(text) {
  const s = String(text || '').trim()
  return !!(s && !/[\u4e00-\u9fff]/.test(s))
}

/**
 * 只走云端词典写 *Zh，不打混元/TMT。详情缓存命中、列表已译字段补洞用，节约额度。
 */
function applyLaunchDictionariesOnly(launch) {
  if (!launch || typeof launch !== 'object') return false
  let changed = false
  function setZh(obj, zhKey, zh) {
    const val = String(zh || '').trim()
    if (!obj || !val || !isUsableZhText(val) || hasUsableZh(obj, zhKey)) return
    obj[zhKey] = val
    changed = true
  }

  const pad = launch.pad
  if (pad && pad.name) setZh(pad, 'nameZh', translateLocation(pad.name))
  if (pad && pad.location && pad.location.name) {
    setZh(pad.location, 'nameZh', translateLocation(pad.location.name))
  }
  if (launch.status && launch.status.name) {
    setZh(launch.status, 'nameZh', translateStatusName(launch.status.name))
  }
  const mission = launch.mission
  if (mission && mission.orbit) {
    setZh(mission.orbit, 'nameZh', translateOrbit(mission.orbit))
  }
  if (mission && mission.type && typeof mission.type === 'object' && mission.type.name) {
    setZh(mission.type, 'nameZh', translateMissionType(mission.type))
  }
  const lsp = launch.launch_service_provider
  if (lsp && lsp.name && isAgencyNameResolved(lsp.name, lsp.abbrev)) {
    const mapped = translateAgencyName(lsp.name, lsp.abbrev)
    if (/[\u4e00-\u9fff]/.test(mapped)) {
      setZh(lsp, 'nameZh', mapped)
    }
  }

  const rocketCfg = launch.rocket && launch.rocket.configuration
  if (rocketCfg) {
    const fullEn = String(rocketCfg.full_name || '').trim()
    const nameEn = String(rocketCfg.name || '').trim()
    if (fullEn) {
      setZh(
        rocketCfg,
        'full_nameZh',
        translateRocketName(fullEn) || lookupLearnedRocketName(fullEn) || ''
      )
    }
    if (nameEn) {
      setZh(
        rocketCfg,
        'nameZh',
        translateRocketName(nameEn) ||
          lookupLearnedRocketName(nameEn) ||
          rocketCfg.full_nameZh ||
          ''
      )
    }
  }

  const rocketEn = rocketCfg && (rocketCfg.full_name || rocketCfg.name)
  const rocketZh = rocketCfg && (rocketCfg.full_nameZh || rocketCfg.nameZh)
  if (launch.name) {
    setZh(launch, 'nameZh', localizeMissionTitle(launch.name, rocketEn, rocketZh))
  }
  if (mission && mission.name) {
    setZh(mission, 'nameZh', localizeMissionTitle(mission.name, rocketEn, rocketZh))
  }

  iterLaunchLandings(launch, (landing) => {
    const loc = landing.landing_location || landing.location
    if (loc && loc.name) {
      setZh(loc, 'nameZh', translateLocation(loc.name) || translateLocation(loc.abbrev))
    }
  })
  return changed
}

function collectLaunchTexts(launch) {
  const texts = []
  const slots = []

  function add(slot, text) {
    const s = String(text || '').trim()
    if (!s) return
    texts.push(s)
    slot.src = s
    slots.push(slot)
  }

  if (!launch || typeof launch !== 'object') return { texts, slots }

  // 词典先落 *Zh（0 机翻）；已有中文 *Zh 不再送翻
  applyLaunchDictionariesOnly(launch)

  if (isEnglishish(launch.name) && !hasUsableZh(launch, 'nameZh')) {
    add({ type: 'nameZh', launch }, launch.name)
  }

  const mission = launch.mission
  if (mission && isEnglishish(mission.name) && !hasUsableZh(mission, 'nameZh')) {
    add({ type: 'mission.nameZh', launch }, mission.name)
  }
  if (mission && mission.description && !hasUsableZh(mission, 'descriptionZh')) {
    add({ type: 'mission.descriptionZh', launch }, mission.description)
  }
  if (mission && mission.type && typeof mission.type === 'object' && isEnglishish(mission.type.name) && !hasUsableZh(mission.type, 'nameZh')) {
    add({ type: 'mission.type.nameZh', launch }, mission.type.name)
  }

  const pad = launch.pad
  if (pad && isEnglishish(pad.name) && !hasUsableZh(pad, 'nameZh')) {
    add({ type: 'pad.nameZh', launch }, pad.name)
  }
  if (pad && pad.location && isEnglishish(pad.location.name) && !hasUsableZh(pad.location, 'nameZh')) {
    add({ type: 'pad.location.nameZh', launch }, pad.location.name)
  }

  const status = launch.status
  if (status && isEnglishish(status.name) && !hasUsableZh(status, 'nameZh')) {
    add({ type: 'status.nameZh', launch }, status.name)
  }

  const lsp = launch.launch_service_provider
  if (
    lsp &&
    isEnglishish(lsp.name) &&
    !hasUsableZh(lsp, 'nameZh') &&
    !isAgencyNameResolved(lsp.name, lsp.abbrev)
  ) {
    add({ type: 'lsp.nameZh', launch }, lsp.name)
  }

  const rocketCfg = launch.rocket && launch.rocket.configuration
  if (rocketCfg) {
    const fullEn = String(rocketCfg.full_name || '').trim()
    const nameEn = String(rocketCfg.name || '').trim()
    if (fullEn && !hasUsableZh(rocketCfg, 'full_nameZh') && isEnglishish(fullEn)) {
      add({ type: 'rocket.configuration.full_nameZh', launch }, fullEn)
    }
    if (nameEn && !hasUsableZh(rocketCfg, 'nameZh') && isEnglishish(nameEn)) {
      if (!(hasUsableZh(rocketCfg, 'full_nameZh') && nameEn === fullEn)) {
        add({ type: 'rocket.configuration.nameZh', launch }, nameEn)
      } else {
        rocketCfg.nameZh = rocketCfg.full_nameZh
      }
    }
    if (rocketCfg.description && !hasUsableZh(rocketCfg, 'descriptionZh')) {
      add({ type: 'rocket.configuration.descriptionZh', launch }, rocketCfg.description)
    }
  }

  collectLandingDescriptionTexts(launch, add)

  return { texts, slots }
}

function iterLaunchLandings(launch, fn) {
  const rocket = launch && launch.rocket
  if (!rocket || typeof rocket !== 'object') return
  const arrays = [
    rocket.launcher_stage,
    rocket.spacecraft_stage,
    rocket.rocket && rocket.rocket.launcher_stage,
    rocket.rocket && rocket.rocket.spacecraft_stage
  ]
  for (let a = 0; a < arrays.length; a++) {
    const arr = arrays[a]
    if (!Array.isArray(arr)) continue
    for (let i = 0; i < arr.length; i++) {
      const landing = arr[i] && arr[i].landing
      if (landing && typeof landing === 'object') fn(landing)
    }
  }
}

function collectLandingDescriptionTexts(launch, add) {
  iterLaunchLandings(launch, (landing) => {
    const en = String(landing.description || '').trim()
    if (en && !hasUsableZh(landing, 'descriptionZh') && isEnglishish(en)) {
      add({ type: 'landing.descriptionZh', landing }, en)
    }
    const loc = landing.landing_location || landing.location
    if (loc && typeof loc === 'object' && loc.name && !hasUsableZh(loc, 'nameZh')) {
      const locZh = translateLocation(loc.name) || translateLocation(loc.abbrev)
      if (locZh) loc.nameZh = locZh
      else if (isEnglishish(loc.name)) {
        add({ type: 'landing.location.nameZh', loc }, loc.name)
      }
    }
  })
}

function hasMissingLandingDescriptionZh(launch) {
  let missing = false
  iterLaunchLandings(launch, (landing) => {
    const en = String(landing.description || '').trim()
    if (en && !hasUsableZh(landing, 'descriptionZh') && isEnglishish(en)) missing = true
  })
  return missing
}

function applyLaunchTranslations(slots, translations) {
  const learnJobs = []
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const zh = translations[i] || ''
    // 降级路径可能原样返回英文——与原文相同视为未翻译，不写入 zh 字段
    // （否则会存下假中文，之后配好 TMT 也不会重翻）
    if (!zh || zh === slot.src || !isUsableZhText(zh)) continue
    if (slot.type === 'nameZh') {
      slot.launch.nameZh = zh
    } else if (slot.type === 'mission.nameZh') {
      if (slot.launch.mission) slot.launch.mission.nameZh = zh
    } else if (slot.type === 'mission.descriptionZh') {
      if (slot.launch.mission) slot.launch.mission.descriptionZh = zh
    } else if (slot.type === 'pad.nameZh') {
      if (slot.launch.pad) slot.launch.pad.nameZh = zh
    } else if (slot.type === 'pad.location.nameZh') {
      if (slot.launch.pad && slot.launch.pad.location) slot.launch.pad.location.nameZh = zh
    } else if (slot.type === 'status.nameZh') {
      if (slot.launch.status) slot.launch.status.nameZh = zh
    } else if (slot.type === 'lsp.nameZh') {
      if (slot.launch.launch_service_provider) slot.launch.launch_service_provider.nameZh = zh
    } else if (slot.type === 'mission.type.nameZh') {
      if (slot.launch.mission && slot.launch.mission.type && typeof slot.launch.mission.type === 'object') {
        slot.launch.mission.type.nameZh = zh
      }
    } else if (slot.type === 'rocket.configuration.full_nameZh') {
      const cfg = slot.launch.rocket && slot.launch.rocket.configuration
      if (cfg) {
        cfg.full_nameZh = zh
        if (!cfg.nameZh && cfg.name && String(cfg.name) === slot.src) cfg.nameZh = zh
        learnJobs.push(rememberRocketName(slot.src, zh))
      }
    } else if (slot.type === 'rocket.configuration.nameZh') {
      const cfg = slot.launch.rocket && slot.launch.rocket.configuration
      if (cfg) {
        cfg.nameZh = zh
        learnJobs.push(rememberRocketName(slot.src, zh))
      }
    } else if (slot.type === 'rocket.configuration.descriptionZh') {
      const cfg = slot.launch.rocket && slot.launch.rocket.configuration
      if (cfg) cfg.descriptionZh = zh
    } else if (slot.type === 'landing.descriptionZh') {
      if (slot.landing) slot.landing.descriptionZh = zh
    } else if (slot.type === 'landing.location.nameZh') {
      if (slot.loc) slot.loc.nameZh = zh
    }
  }
  return learnJobs
}

async function enrichLaunchList(apiData) {
  if (!apiData || !Array.isArray(apiData.results)) return apiData
  try { await warmRocketNameDict() } catch (e) {}
  const allTexts = []
  const allSlots = []

  for (const launch of apiData.results) {
    repairExistingLaunchZhTitles(launch)
    const { texts, slots } = collectLaunchTexts(launch)
    for (let i = 0; i < texts.length; i++) {
      allTexts.push(texts[i])
      allSlots.push(slots[i])
    }
  }

  if (!allTexts.length) {
    for (const launch of apiData.results) repairExistingLaunchZhTitles(launch)
    return apiData
  }

  // 型号短名单独 force，避免 H3-22 / KZ-1A 被 shouldMachineTranslate 挡掉
  const forceAt = allSlots.map(function (s) {
    return !!(s && (s.type === 'rocket.configuration.nameZh' || s.type === 'rocket.configuration.full_nameZh'))
  })
  const translations = await translateTextsBatch(allTexts, { forceAt: forceAt })
  const learnJobs = applyLaunchTranslations(allSlots, translations) || []
  if (learnJobs.length) {
    try { await Promise.all(learnJobs) } catch (e2) {}
  }
  for (const launch of apiData.results) repairExistingLaunchZhTitles(launch)
  return apiData
}

/** 单条 launch 详情富化（fetchLaunchDetail 等绕过列表同步的路径使用） */
async function enrichSingleLaunch(launch) {
  if (!launch || typeof launch !== 'object') return launch
  try { await warmRocketNameDict() } catch (e) {}
  repairExistingLaunchZhTitles(launch)
  const { texts, slots } = collectLaunchTexts(launch)
  if (!texts.length) {
    repairExistingLaunchZhTitles(launch)
    return launch
  }
  const forceAt = slots.map(function (s) {
    return !!(s && (s.type === 'rocket.configuration.nameZh' || s.type === 'rocket.configuration.full_nameZh'))
  })
  const translations = await translateTextsBatch(texts, { forceAt: forceAt })
  const learnJobs = applyLaunchTranslations(slots, translations) || []
  if (learnJobs.length) {
    try { await Promise.all(learnJobs) } catch (e2) {}
  }
  repairExistingLaunchZhTitles(launch)
  return launch
}

function collectEventTexts(event) {
  const texts = []
  const slots = []

  function add(slot, text) {
    const s = String(text || '').trim()
    if (!s) return
    texts.push(s)
    slot.src = s
    slots.push(slot)
  }

  if (!event || typeof event !== 'object') return { texts, slots }

  if (isEnglishish(event.name) && !hasUsableZh(event, 'nameZh')) {
    add({ type: 'nameZh', event }, event.name)
  }
  if (event.description && !hasUsableZh(event, 'descriptionZh')) {
    add({ type: 'descriptionZh', event }, event.description)
  }

  if (event.type && event.type.name) {
    const tZh = translateEventType(event.type.name)
    if (tZh) event.type.nameZh = tZh
  }

  if (event.date_precision && event.date_precision.name) {
    const dpZh = translateDatePrecision(event.date_precision.name)
    if (dpZh) event.date_precision.nameZh = dpZh
  }

  if (event.location) {
    const locZh = translateLocation(event.location)
    if (locZh && !hasUsableZh(event, 'locationZh')) event.locationZh = locZh
    else if (!hasUsableZh(event, 'locationZh') && isEnglishish(event.location)) {
      add({ type: 'locationZh', event }, event.location)
    }
  }

  return { texts, slots }
}

function applyEventTranslations(slots, translations) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const zh = translations[i] || ''
    if (!zh || zh === slot.src || !isUsableZhText(zh)) continue
    if (slot.type === 'nameZh') slot.event.nameZh = zh
    else if (slot.type === 'descriptionZh') slot.event.descriptionZh = zh
    else if (slot.type === 'locationZh') slot.event.locationZh = zh
  }
}

async function enrichEventsList(apiData) {
  if (!apiData || !Array.isArray(apiData.results)) return apiData
  const allTexts = []
  const allSlots = []

  for (const event of apiData.results) {
    const { texts, slots } = collectEventTexts(event)
    for (let i = 0; i < texts.length; i++) {
      allTexts.push(texts[i])
      allSlots.push(slots[i])
    }
  }

  if (!allTexts.length) return apiData

  const translations = await translateTextsBatch(allTexts)
  applyEventTranslations(allSlots, translations)
  return apiData
}

function collectArticleTexts(article) {
  const texts = []
  const slots = []

  function add(slot, text) {
    const s = String(text || '').trim()
    if (!s) return
    texts.push(s)
    slot.src = s
    slots.push(slot)
  }

  if (!article || typeof article !== 'object') return { texts, slots }
  if (isEnglishish(article.title) && !hasUsableZh(article, 'titleZh')) {
    add({ type: 'titleZh', article }, article.title)
  }
  if (article.summary && !hasUsableZh(article, 'summaryZh')) {
    add({ type: 'summaryZh', article }, article.summary)
  }
  return { texts, slots }
}

function applyArticleTranslations(slots, translations) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const zh = translations[i] || ''
    if (!zh || zh === slot.src || !isUsableZhText(zh)) continue
    if (slot.type === 'titleZh') slot.article.titleZh = zh
    else if (slot.type === 'summaryZh') slot.article.summaryZh = zh
  }
}

async function enrichArticlesList(apiData) {
  if (!apiData || !Array.isArray(apiData.results)) return apiData
  const allTexts = []
  const allSlots = []

  for (const article of apiData.results) {
    const { texts, slots } = collectArticleTexts(article)
    for (let i = 0; i < texts.length; i++) {
      allTexts.push(texts[i])
      allSlots.push(slots[i])
    }
  }

  if (!allTexts.length) return apiData

  const translations = await translateTextsBatch(allTexts)
  applyArticleTranslations(allSlots, translations)
  return apiData
}

/**
 * 按 endpoint 类型富化 API 数据
 */
function isStationsEndpoint(url) {
  return /\/space_stations\//.test(String(url || ''))
}

function isAgenciesEndpoint(url) {
  return /\/agencies\//.test(String(url || ''))
}

function enrichStationRow(row) {
  if (!row || typeof row !== 'object') return
  if (row.name && !hasUsableZh(row, 'nameZh')) {
    const zh = translateLocation(row.name)
    if (zh) row.nameZh = zh
  }
  if (row.status && row.status.name && !hasUsableZh(row.status, 'nameZh')) {
    const zh = translateStatusName(row.status.name)
    if (zh) row.status.nameZh = zh
  }
}

function enrichAgencyRow(row) {
  if (!row || typeof row !== 'object') return
  if (row.type && row.type.name && !hasUsableZh(row.type, 'nameZh')) {
    const zh = translateAgencyType(row.type.name)
    if (zh) row.type.nameZh = zh
  }
  if (Array.isArray(row.country)) {
    row.country.forEach((c) => {
      if (!c || !c.name || hasUsableZh(c, 'nameZh')) return
      const zh = translateCountryName(c.name)
      if (zh) c.nameZh = zh
    })
  }
}

function enrichStationsData(apiData) {
  if (apiData && Array.isArray(apiData.results)) apiData.results.forEach(enrichStationRow)
  else enrichStationRow(apiData)
  return apiData
}

function enrichAgenciesData(apiData) {
  if (apiData && Array.isArray(apiData.results)) apiData.results.forEach(enrichAgencyRow)
  else enrichAgencyRow(apiData)
  return apiData
}

async function enrichApiDataForTranslation(url, params, apiData, apiBase) {
  if (!apiData) return apiData

  if (shouldSlimLaunchList(url, params)) {
    return enrichLaunchList(apiData)
  }
  if (isEventsEndpoint(url)) {
    return enrichEventsList(apiData)
  }
  if (isArticlesEndpoint(url, apiBase)) {
    return enrichArticlesList(apiData)
  }
  if (isStationsEndpoint(url)) {
    return enrichStationsData(apiData)
  }
  if (isAgenciesEndpoint(url)) {
    return enrichAgenciesData(apiData)
  }
  return apiData
}

module.exports = {
  enrichApiDataForTranslation,
  enrichLaunchList,
  enrichSingleLaunch,
  enrichEventsList,
  enrichArticlesList,
  translateLandingType,
  repairExistingLaunchZhTitles,
  applyLaunchDictionariesOnly,
  hasMissingLandingDescriptionZh
}
