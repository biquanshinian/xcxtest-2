/**
 * LL2 / SNAPI 同步数据翻译富化 — 写入 xxxZh 字段供小程序按语言展示
 */
const { translateTextsBatch } = require('./translate.js')
const {
  translateOrbit,
  translateStatusName,
  translateEventType,
  translateDatePrecision,
  translateLocation,
  translateLandingType
} = require('./space-terms-i18n.js')

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

  const mission = launch.mission
  if (mission && mission.description) {
    add({ type: 'mission.descriptionZh', launch }, mission.description)
  }

  const pad = launch.pad
  if (pad && pad.name) {
    const locZh = translateLocation(pad.name)
    if (locZh) pad.nameZh = locZh
    else add({ type: 'pad.nameZh', launch }, pad.name)
  }
  if (pad && pad.location && pad.location.name) {
    const locZh = translateLocation(pad.location.name)
    if (locZh) pad.location.nameZh = locZh
    else add({ type: 'pad.location.nameZh', launch }, pad.location.name)
  }

  const status = launch.status
  if (status && status.name) {
    const stZh = translateStatusName(status.name)
    if (stZh) status.nameZh = stZh
    else add({ type: 'status.nameZh', launch }, status.name)
  }

  if (mission && mission.orbit) {
    const orbZh = translateOrbit(mission.orbit)
    if (orbZh) mission.orbit.nameZh = orbZh
  }

  const rocketCfg = launch.rocket && launch.rocket.configuration
  if (rocketCfg && rocketCfg.description) {
    add({ type: 'rocket.configuration.descriptionZh', launch }, rocketCfg.description)
  }

  return { texts, slots }
}

function applyLaunchTranslations(slots, translations) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const zh = translations[i] || ''
    // 降级路径可能原样返回英文——与原文相同视为未翻译，不写入 zh 字段
    // （否则会存下假中文，之后配好 TMT 也不会重翻）
    if (!zh || zh === slot.src) continue
    if (slot.type === 'mission.descriptionZh') {
      if (slot.launch.mission) slot.launch.mission.descriptionZh = zh
    } else if (slot.type === 'pad.nameZh') {
      if (slot.launch.pad) slot.launch.pad.nameZh = zh
    } else if (slot.type === 'pad.location.nameZh') {
      if (slot.launch.pad && slot.launch.pad.location) slot.launch.pad.location.nameZh = zh
    } else if (slot.type === 'status.nameZh') {
      if (slot.launch.status) slot.launch.status.nameZh = zh
    } else if (slot.type === 'rocket.configuration.descriptionZh') {
      const cfg = slot.launch.rocket && slot.launch.rocket.configuration
      if (cfg) cfg.descriptionZh = zh
    }
  }
}

async function enrichLaunchList(apiData) {
  if (!apiData || !Array.isArray(apiData.results)) return apiData
  const allTexts = []
  const allSlots = []

  for (const launch of apiData.results) {
    const { texts, slots } = collectLaunchTexts(launch)
    for (let i = 0; i < texts.length; i++) {
      allTexts.push(texts[i])
      allSlots.push(slots[i])
    }
  }

  if (!allTexts.length) return apiData

  const translations = await translateTextsBatch(allTexts)
  applyLaunchTranslations(allSlots, translations)
  return apiData
}

/** 单条 launch 详情富化（fetchLaunchDetail 等绕过列表同步的路径使用） */
async function enrichSingleLaunch(launch) {
  if (!launch || typeof launch !== 'object') return launch
  const { texts, slots } = collectLaunchTexts(launch)
  if (!texts.length) return launch
  const translations = await translateTextsBatch(texts)
  applyLaunchTranslations(slots, translations)
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

  if (event.name) add({ type: 'nameZh', event }, event.name)
  if (event.description) add({ type: 'descriptionZh', event }, event.description)

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
    if (locZh) event.locationZh = locZh
    else add({ type: 'locationZh', event }, event.location)
  }

  return { texts, slots }
}

function applyEventTranslations(slots, translations) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const zh = translations[i] || ''
    if (!zh || zh === slot.src) continue
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
  if (article.title) add({ type: 'titleZh', article }, article.title)
  if (article.summary) add({ type: 'summaryZh', article }, article.summary)
  return { texts, slots }
}

function applyArticleTranslations(slots, translations) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const zh = translations[i] || ''
    if (!zh || zh === slot.src) continue
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
  return apiData
}

module.exports = {
  enrichApiDataForTranslation,
  enrichLaunchList,
  enrichSingleLaunch,
  enrichEventsList,
  enrichArticlesList,
  translateLandingType
}
