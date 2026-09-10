/**
 * 构型目录纯函数（主包可用）。
 * pickConfigById：有 id 只认 id。
 * pickLatestRocketConfig*：统计页导航兜底，同系列取最新款；不是身份匹配。
 */

function foldRocketKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

/** 微信 dataset / 空 mustache 可能把 null 收成 "null" */
function cleanConfigId(value) {
  const s = value == null ? '' : String(value).trim()
  if (!s || s === 'undefined' || s === 'null') return ''
  return s
}

function listConfigs(configs) {
  if (!configs || typeof configs !== 'object') return []
  if (Array.isArray(configs)) return configs.filter(Boolean)
  return Object.keys(configs).map((k) => configs[k]).filter(Boolean)
}

/** 按 LL2 构型 id 取目录项（对象键或数组） */
function pickConfigById(configs, id) {
  const key = cleanConfigId(id)
  if (!key || !configs || typeof configs !== 'object') return null
  if (Array.isArray(configs)) {
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i]
      if (!cfg) continue
      const cid = cleanConfigId(cfg.id != null ? cfg.id : cfg.configId)
      if (cid && cid === key) return cfg
    }
    return null
  }
  return configs[key] || configs[Number(key)] || null
}

function configNameKeys(cfg) {
  if (!cfg || typeof cfg !== 'object') return []
  return [cfg.name, cfg.full_name, cfg.nameZh, cfg.full_nameZh]
    .map(foldRocketKey)
    .filter(Boolean)
}

function configHasExactNameKey(cfg, queryFold) {
  if (!queryFold) return false
  const keys = configNameKeys(cfg)
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === queryFold) return true
  }
  return false
}

/** 仅当前缀兜底：H3 → H3-22。精确名已在 pickLatest 里先处理，避免 Long March 1 误伤 11 */
function configMatchesNamePrefix(cfg, queryFold) {
  if (!queryFold || queryFold.length < 2) return false
  const keys = configNameKeys(cfg)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k.length > queryFold.length && k.indexOf(queryFold) === 0) return true
  }
  return false
}

function configRecencyRank(cfg) {
  const inUse = cfg && (cfg.in_use === true || cfg.active === true)
  const retired = cfg && (cfg.in_use === false || cfg.active === false)
  return {
    activeScore: inUse ? 2 : (retired ? 0 : 1),
    maiden: Date.parse((cfg && cfg.maiden_flight) || '') || 0,
    flights: Number(cfg && cfg.total_launch_count) || 0,
    id: Number(cfg && cfg.id) || 0
  }
}

function compareConfigRecency(a, b) {
  const ra = configRecencyRank(a)
  const rb = configRecencyRank(b)
  if (rb.activeScore !== ra.activeScore) return rb.activeScore - ra.activeScore
  if (rb.maiden !== ra.maiden) return rb.maiden - ra.maiden
  if (rb.flights !== ra.flights) return rb.flights - ra.flights
  return rb.id - ra.id
}

/** 统计排行按名跳型号：同系列里取最新款 */
function pickLatestRocketConfigByName(configs, name) {
  const query = foldRocketKey(name)
  if (!query || query.length < 2) return null
  const all = listConfigs(configs)
  // 统计桶 key 就是 configuration.name（Falcon 9 / Long March 11），先精确再前缀
  const exactName = all.filter((cfg) => foldRocketKey(cfg && cfg.name) === query)
  if (exactName.length) {
    exactName.sort(compareConfigRecency)
    return exactName[0]
  }
  const exactAny = all.filter((cfg) => configHasExactNameKey(cfg, query))
  if (exactAny.length) {
    exactAny.sort(compareConfigRecency)
    return exactAny[0]
  }
  const prefixed = all.filter((cfg) => configMatchesNamePrefix(cfg, query))
  if (!prefixed.length) return null
  prefixed.sort(compareConfigRecency)
  return prefixed[0]
}

/**
 * 有构型 id 先取该条的系列名，再升到同系列最新款；
 * 目录未命中时回落种子构型。
 */
function pickLatestRocketConfig(configs, input) {
  const src = input && typeof input === 'object' ? input : {}
  const seed = pickConfigById(configs, src.configId)
  const query = (seed && (seed.name || seed.full_name)) || src.nameEn || src.name || ''
  return pickLatestRocketConfigByName(configs, query) || seed || null
}

module.exports = {
  foldRocketKey,
  cleanConfigId,
  pickConfigById,
  pickLatestRocketConfigByName,
  pickLatestRocketConfig
}
