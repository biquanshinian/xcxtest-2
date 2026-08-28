/**
 * 3D 展陈页文案：用 LL2 构型规格拼「展陈 / 尺寸 / 特征 / 简介」。
 * 纯数据，不碰 wx / three，方便单测。
 */

function compactKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function firstText(list) {
  for (var i = 0; i < list.length; i++) {
    var s = String(list[i] || '').trim()
    if (s) return s
  }
  return ''
}

/** 与详情页 formatRocketSpecScalar 同一套数字，避免 124.4 被收成 124 */
function formatSpecScalar(raw) {
  if (raw == null || raw === '') return ''
  var n = Number(raw)
  if (!isFinite(n)) {
    var s = String(raw).trim()
    return s
  }
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n))
  return String(Math.round(n * 100) / 100)
}

function fmtNum(value, unit) {
  if (value == null || value === '') return ''
  var n = Number(value)
  if (!isFinite(n)) return ''
  return formatSpecScalar(n) + (unit || '')
}

function fmtDate(value) {
  if (!value) return ''
  var dt = new Date(value)
  if (isNaN(dt.getTime())) return String(value)
  return (
    dt.getFullYear() +
    '-' +
    String(dt.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(dt.getDate()).padStart(2, '0')
  )
}

function configKeys(cfg) {
  if (!cfg || typeof cfg !== 'object') return []
  return [cfg.full_name, cfg.name, cfg.alias, cfg.full_nameZh, cfg.nameZh]
}

/** 详情页规格行 → 构型字段，保证 3D 标注与「规格」卡同一份数 */
var DETAIL_SPEC_FIELDS = {
  长度: 'length',
  直径: 'diameter',
  发射质量: 'launch_mass',
  起飞推力: 'to_thrust',
  'LEO 运力': 'leo_capacity',
  'GTO 运力': 'gto_capacity',
  'GEO 运力': 'geo_capacity',
  'SSO 运力': 'sso_capacity',
  最大飞行高度: 'apogee',
  首飞日期: 'maiden_flight'
}

function parseSpecNumber(line) {
  var m = String(line || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

function configFromDetailSpecs(specs) {
  if (!Array.isArray(specs) || !specs.length) return null
  var cfg = {}
  var filled = 0
  for (var i = 0; i < specs.length; i++) {
    var row = specs[i] || {}
    var label = String(row.label || '').trim()
    var line = String(row.line || '').trim()
    if (!label || !line) continue
    if (label === '级数') {
      var parts = line.match(/(\d+)\s*[–\-]\s*(\d+)/)
      if (parts) {
        cfg.min_stage = Number(parts[1])
        cfg.max_stage = Number(parts[2])
        filled++
      } else {
        var one = line.match(/(\d+)/)
        if (one) {
          cfg.max_stage = Number(one[1])
          filled++
        }
      }
      continue
    }
    var key = DETAIL_SPEC_FIELDS[label]
    if (!key) continue
    if (key === 'maiden_flight') {
      cfg.maiden_flight = line
      filled++
      continue
    }
    var num = parseSpecNumber(line)
    if (num == null || !isFinite(num)) continue
    cfg[key] = num
    filled++
  }
  return filled ? cfg : null
}

/** 同名多构型时，优先选详情页那种整箭（更长、更重、有推力） */
function specRank(cfg) {
  if (!cfg) return 0
  var length = Number(cfg.length) || 0
  var mass = Number(cfg.launch_mass) || 0
  var thrust = Number(cfg.to_thrust) || 0
  var flights = Number(cfg.total_launch_count) || 0
  return length * 1000 + mass + thrust * 0.001 + flights
}

function nameMatchScore(cfg, needles) {
  var aliases = configKeys(cfg).map(compactKey).filter(Boolean)
  var score = 0
  for (var n = 0; n < needles.length; n++) {
    for (var a = 0; a < aliases.length; a++) {
      if (!needles[n] || !aliases[a]) continue
      if (needles[n] === aliases[a]) score = Math.max(score, 3)
      else if (aliases[a].indexOf(needles[n]) >= 0 || needles[n].indexOf(aliases[a]) >= 0) {
        score = Math.max(score, 1)
      }
    }
  }
  return score
}

function matchRocketConfig(configs, input) {
  var map = configs && typeof configs === 'object' ? configs : {}
  var src = input && typeof input === 'object' ? input : {}
  if (src.detailConfig && typeof src.detailConfig === 'object') {
    return src.detailConfig
  }
  var detailCfg = configFromDetailSpecs(src.detailSpecs)
  if (detailCfg) {
    var named = matchRocketConfig(map, {
      configId: src.configId,
      rocketName: src.rocketName,
      rocketNameEn: src.rocketNameEn
    })
    if (!named) return detailCfg
    return Object.assign({}, named, detailCfg)
  }
  var configId = String(src.configId || '').trim()
  if (configId) {
    if (map[configId]) return map[configId]
    var ids = Object.keys(map)
    for (var i = 0; i < ids.length; i++) {
      var row = map[ids[i]]
      if (row && String(row.id) === configId) return row
    }
  }
  var needles = [src.rocketNameEn, src.rocketName]
    .map(compactKey)
    .filter(Boolean)
  if (!needles.length) return null
  var pool = []
  var keys = Object.keys(map)
  for (var k = 0; k < keys.length; k++) {
    var cfg = map[keys[k]]
    var score = nameMatchScore(cfg, needles)
    if (score >= 1) pool.push({ cfg: cfg, score: score })
  }
  if (!pool.length) return null
  pool.sort(function (a, b) {
    return specRank(b.cfg) - specRank(a.cfg) || b.score - a.score
  })
  return pool[0].cfg
}

function pushFeat(list, label, value) {
  if (!value) return
  list.push({ label: label, value: value })
}

function buildExhibit(cfg, extra) {
  var src = extra && typeof extra === 'object' ? extra : {}
  var name = firstText([
    src.rocketName,
    cfg && (cfg.full_nameZh || cfg.nameZh || cfg.full_name || cfg.name)
  ])
  var nameEn = firstText([
    src.rocketNameEn,
    cfg && (cfg.full_name || cfg.name)
  ])
  var manufacturer = firstText([
    cfg && (cfg.manufacturerNameZh || cfg.manufacturerName),
    src.manufacturer
  ])
  var credit = String(src.credit || '').trim()
  var length = cfg ? fmtNum(cfg.length, ' m') : ''
  var diameter = cfg ? fmtNum(cfg.diameter, ' m') : ''
  var mass = cfg ? fmtNum(cfg.launch_mass, ' t') : ''
  var intro = firstText([cfg && cfg.descriptionZh, cfg && cfg.description])
  var features = []
  if (cfg) {
    if (cfg.reusable === true) pushFeat(features, '构型', '可复用')
    else if (cfg.reusable === false) pushFeat(features, '构型', '一次性')
    if (cfg.max_stage != null) {
      var stage =
        cfg.min_stage != null && cfg.min_stage !== cfg.max_stage
          ? cfg.min_stage + '–' + cfg.max_stage + ' 级'
          : String(cfg.max_stage) + ' 级'
      pushFeat(features, '级数', stage)
    }
    pushFeat(features, 'LEO 运力', fmtNum(cfg.leo_capacity, ' kg'))
    pushFeat(features, '起飞推力', fmtNum(cfg.to_thrust, ' kN'))
    pushFeat(features, '首飞', fmtDate(cfg.maiden_flight))
  }
  var series = !!(src.series || src.seriesModel)
  var sizeParts = []
  if (!series) {
    if (length) sizeParts.push('全长 ' + length)
    if (diameter) sizeParts.push('直径 ' + diameter)
    if (mass) sizeParts.push('起飞质量 ' + mass)
  }
  var subtitle = manufacturer || (nameEn && nameEn !== name ? nameEn : '三维展陈')
  return {
    title: name || '火箭 3D',
    subtitle: subtitle,
    credit: credit,
    intro: intro,
    length: length,
    diameter: diameter,
    mass: mass,
    sizeSummary: sizeParts.join(' · '),
    features: features,
    featureSummary: features
      .slice(0, 3)
      .map(function (item) {
        return item.label + ' ' + item.value
      })
      .join(' · '),
    series: series,
    hasSize: !series && sizeParts.length > 0,
    hasIntro: !!intro,
    hasFeat: !series && (features.length > 0 || !!intro)
  }
}

module.exports = {
  compactKey,
  matchRocketConfig,
  configFromDetailSpecs,
  specRank,
  buildExhibit,
  fmtNum,
  formatSpecScalar,
  fmtDate
}
