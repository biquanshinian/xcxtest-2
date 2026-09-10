/**
 * 火箭档案指数：用 _config_meta 公开参数做同量级维度分。
 * 不是投票、不是权威排名。不依赖 wx，可供 node:test 直接引用。
 */
var compare = require('./rocket-compare.js')

var AXIS_COUNT = 6
var SCORE_MIN = 1
var SCORE_MAX = 5
var PEER_MIN = 8
var CLASS_PEER_MIN = 5

var DIMS = [
  { id: 'payload', label: '运力', short: '运力', weight: 1 },
  { id: 'thrust', label: '动力', short: '动力', weight: 0.85 },
  { id: 'economy', label: '经济性', short: '经济', weight: 0.9 },
  { id: 'reliability', label: '可靠度', short: '可靠', weight: 1.15 },
  { id: 'reuse', label: '复用', short: '复用', weight: 0.8 },
  { id: 'maturity', label: '成熟度', short: '成熟', weight: 0.7 }
]

var CLASS_META = {
  superheavy: { id: 'superheavy', label: '超重型' },
  heavy: { id: 'heavy', label: '重型' },
  medium: { id: 'medium', label: '中型' },
  small: { id: 'small', label: '小型' },
  unknown: { id: 'unknown', label: '未分级' }
}

function toNum(v) {
  if (v == null || v === '') return null
  var n = Number(v)
  return isNaN(n) ? null : n
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function foldName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/号/g, '')
    .replace(/[\s\-_.·•]/g, '')
}

function quantile(sorted, q) {
  if (!sorted.length) return null
  var pos = (sorted.length - 1) * q
  var lo = Math.floor(pos)
  var hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo)
}

function payloadKg(cfg) {
  var leo = toNum(cfg && cfg.leo_capacity)
  if (leo != null && leo > 0) return leo
  var gto = toNum(cfg && cfg.gto_capacity)
  if (gto != null && gto > 0) return gto
  return null
}

function payloadClass(cfg) {
  var kg = payloadKg(cfg)
  if (kg == null) return 'unknown'
  if (kg >= 40000) return 'superheavy'
  if (kg >= 8000) return 'heavy'
  if (kg >= 1500) return 'medium'
  return 'small'
}

function classLabel(id) {
  return (CLASS_META[id] || CLASS_META.unknown).label
}

function dimValue(cfg, id) {
  if (!cfg) return null
  if (id === 'payload') return payloadKg(cfg)
  if (id === 'thrust') {
    var thrust = toNum(cfg.to_thrust)
    return thrust != null && thrust > 0 ? thrust : null
  }
  if (id === 'economy') {
    var cost = toNum(cfg.launch_cost)
    if (cost == null || cost <= 0) return null
    var leo = toNum(cfg.leo_capacity)
    if (leo != null && leo > 0) return leo / cost
    return 1 / cost
  }
  if (id === 'reliability') {
    var rate = compare.successRate(cfg)
    var total = toNum(cfg.total_launch_count)
    if (rate == null || total == null || total < 3) return null
    if (total < 10) return rate * (0.55 + 0.45 * (total / 10))
    return rate
  }
  if (id === 'reuse') {
    if (cfg.reusable !== true) return null
    return compare.landingRate(cfg)
  }
  if (id === 'maturity') {
    var flights = toNum(cfg.total_launch_count)
    if (flights == null || flights <= 0) return null
    return Math.log(1 + flights)
  }
  return null
}

function absoluteScore(dimId, value) {
  if (dimId === 'reliability' || dimId === 'reuse') {
    return round1(SCORE_MIN + (SCORE_MAX - SCORE_MIN) * clamp(Number(value) / 100, 0, 1))
  }
  return null
}

function scoreAgainstPeers(value, peers, dimId) {
  if (value == null) return null
  if (peers && peers.length >= PEER_MIN) {
    var sorted = peers.slice().sort(function (a, b) { return a - b })
    var p10 = quantile(sorted, 0.1)
    var p90 = quantile(sorted, 0.9)
    if (p10 == null || p90 == null) return absoluteScore(dimId, value)
    if (Math.abs(p90 - p10) < 1e-9) return 3.5
    var t = clamp((value - p10) / (p90 - p10), 0, 1)
    return round1(SCORE_MIN + (SCORE_MAX - SCORE_MIN) * t)
  }
  return absoluteScore(dimId, value)
}

function listConfigs(map) {
  var out = []
  var src = map || {}
  for (var k in src) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue
    if (src[k] && src[k].id != null) out.push(src[k])
  }
  return out
}

function peerValues(configs, classId, dimId) {
  var same = []
  var all = []
  ;(configs || []).forEach(function (cfg) {
    var v = dimValue(cfg, dimId)
    if (v == null) return
    all.push(v)
    if (payloadClass(cfg) === classId) same.push(v)
  })
  return same.length >= CLASS_PEER_MIN ? same : all
}

function fieldByKey(key) {
  var list = compare.COMPARE_FIELDS || []
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].key === key) return list[i]
  }
  return null
}

function formatField(key, raw) {
  var field = fieldByKey(key)
  if (!field) return raw == null || raw === '' ? '' : String(raw)
  return compare.formatCell(field, raw)
}

function hasFlownConfig(cfg, now) {
  if (toNum(cfg && cfg.total_launch_count) > 0) return true
  var t = Date.parse((cfg && cfg.maiden_flight) || '')
  if (isNaN(t)) return false
  return t <= (now != null ? Number(now) : Date.now())
}

function dimRawText(cfg, id) {
  if (id === 'payload') {
    var leo = toNum(cfg.leo_capacity)
    if (leo != null) return formatField('leo_capacity', leo)
    var gto = toNum(cfg.gto_capacity)
    if (gto != null) return formatField('gto_capacity', gto)
    return ''
  }
  if (id === 'thrust') return formatField('to_thrust', toNum(cfg.to_thrust))
  if (id === 'economy') {
    var costField = fieldByKey('launch_cost')
    var cost = costField ? compare.pickFieldRaw(cfg, costField) : toNum(cfg.launch_cost)
    return cost == null ? '' : formatField('launch_cost', cost)
  }
  if (id === 'reliability') {
    var rate = compare.successRate(cfg)
    var total = toNum(cfg.total_launch_count)
    if (rate == null) return ''
    return compare.formatCell({ kind: 'percent' }, rate) + (total != null ? ' · ' + total + ' 次' : '')
  }
  if (id === 'reuse') {
    if (cfg.reusable !== true) return '一次性构型'
    var land = compare.landingRate(cfg)
    if (land == null) return '可复用 · 着陆样本不足'
    return '着陆 ' + compare.formatCell({ kind: 'percent' }, land)
  }
  if (id === 'maturity') {
    var n = toNum(cfg.total_launch_count)
    if (n == null || n <= 0) return '尚未首飞'
    return n + ' 次发射'
  }
  return ''
}

function dimHint(cfg, id, score) {
  if (score == null) {
    if (id === 'reuse' && cfg.reusable !== true) return '一次性，这一维不参评'
    if (id === 'reliability' || id === 'maturity') {
      if (!toNum(cfg.total_launch_count)) return '尚未首飞，暂不评分'
    }
    if (id === 'reuse') return '可复用，着陆样本不足'
    if (id === 'economy') return '缺少公开报价'
    return '公开参数不足'
  }
  if (score >= 4.4) return '同级前列'
  if (score >= 3.6) return '同级中上'
  if (score >= 2.8) return '同级中游'
  return '同级偏弱'
}

function gradeOf(overall, scoredCount, hasFlown) {
  if (scoredCount < 3) {
    return { id: 'thin', label: '样本不足', hint: '公开参数不够，暂不给综合指数' }
  }
  if (!hasFlown) {
    return { id: 'unflown', label: '尚未首飞', hint: '先看运力与构型，战绩待首飞后计入' }
  }
  if (overall >= 4.35) return { id: 'lead', label: '同级标杆', hint: '在同量级公开档案里处在前列' }
  if (overall >= 3.7) return { id: 'solid', label: '扎实', hint: '关键维度比较均衡' }
  if (overall >= 3.0) return { id: 'balanced', label: '均衡', hint: '有亮点也有缺口，适合对照档案看' }
  if (overall >= 2.3) return { id: 'early', label: '起步', hint: '公开战绩或参数仍偏少' }
  return { id: 'fresh', label: '新锐', hint: '档案刚展开，指数波动会比较大' }
}

function radarVertex(index, ratio, radius) {
  var n = AXIS_COUNT
  var ang = (-90 + index * 360 / n) * Math.PI / 180
  var t = clamp(ratio, 0.08, 1)
  var r = radius == null ? 38 : radius
  return {
    x: +(50 + r * t * Math.cos(ang)).toFixed(2),
    y: +(50 + r * t * Math.sin(ang)).toFixed(2)
  }
}

function radarPolygon(ratios, radius) {
  return (ratios || []).map(function (ratio, i) {
    return radarVertex(i, ratio, radius)
  })
}

function ringPolygon(ratio) {
  var pts = []
  for (var i = 0; i < AXIS_COUNT; i++) pts.push(radarVertex(i, ratio, 38))
  return pts
}

function variantKey(s) {
  var raw = String(s || '')
  var f = foldName(raw)
  var block = raw.match(/block\s*(\d+)/i) || f.match(/block(\d+)/)
  if (block) return 'block' + block[1]
  var zhBlock = raw.match(/第\s*(\d+)\s*型/)
  if (zhBlock) return 'block' + zhBlock[1]
  if (/full\s*thrust|fullthrust/i.test(raw)) return 'fullthrust'
  var ver = raw.match(/\bv\s*(\d+(?:\.\d+)?)\b/i)
  if (ver) return 'v' + ver[1]
  return ''
}

function matchConfigByName(configs, name, nameEn) {
  var needles = [foldName(name), foldName(nameEn)].filter(function (s) { return s.length >= 2 })
  if (!needles.length) return null
  var wantVariant = variantKey([name, nameEn].join(' '))
  var best = null
  var bestScore = 0
  var bestRank = -1
  var list = listConfigs(configs)
  list.forEach(function (cfg) {
    var full = foldName(cfg.full_name || '')
    var short = foldName(cfg.name || '')
    var zhFull = foldName(cfg.full_nameZh || '')
    var zh = foldName(cfg.nameZh || '')
    var alias = foldName(cfg.alias || '')
    var hay = foldName([cfg.full_name, cfg.name, cfg.full_nameZh, cfg.nameZh, cfg.alias, cfg.variant].join(' '))
    if (!hay) return
    var score = 0
    needles.forEach(function (n) {
      if (full === n || short === n || zhFull === n || zh === n || alias === n) score += 50 + n.length
      else if (full.indexOf(n) >= 0 || zhFull.indexOf(n) >= 0) score += 18 + n.length
      else if (hay.indexOf(n) >= 0) score += 8 + n.length
      else if (n.indexOf(full) >= 0 && full.length >= 6) score += 6
      else if (n.indexOf(short) >= 0 && short.length >= 4) score += 3
    })
    if (wantVariant) {
      var got = variantKey([cfg.full_name, cfg.name, cfg.variant].join(' '))
      if (got && got === wantVariant) score += 24
      else if (got && got !== wantVariant) score -= 20
    }
    if (score < 4) return
    var rank = (toNum(cfg.total_launch_count) || 0) * 10 + hay.length + (cfg.active !== false ? 2 : 0)
    if (score > bestScore || (score === bestScore && rank > bestRank)) {
      bestScore = score
      bestRank = rank
      best = cfg
    }
  })
  return best
}

function resolveScoreConfig(configs, options) {
  var opts = options || {}
  var id = opts.configId
  if (id != null && String(id).trim() !== '') {
    return compare.resolveConfig(configs, id)
  }
  return matchConfigByName(configs, opts.name, opts.nameEn)
}

function buildInsights(cfg, dims, overall) {
  var lines = []
  if (cfg.reusable !== true) {
    lines.push({ tone: 'note', text: '一次性构型，复用维不参评，避免和可回收火箭硬比' })
  }
  var scored = dims.filter(function (d) { return d.score != null })
  if (scored.length) {
    var top = scored.slice().sort(function (a, b) { return b.score - a.score })[0]
    var low = scored.slice().sort(function (a, b) { return a.score - b.score })[0]
    if (top && top.score >= 4.2) lines.push({ tone: 'lead', text: '最突出的是' + top.label })
    if (low && low.score <= 2.6 && low.id !== top.id) {
      lines.push({ tone: 'warn', text: '相对薄弱的是' + low.label })
    }
  }
  if (overall != null && overall >= 4.2) {
    lines.push({ tone: 'lead', text: '综合指数在同量级里靠前，仍只是档案折算' })
  }
  return lines.slice(0, 3)
}

function buildScoreView(cfg, configsMap) {
  if (!cfg) {
    return {
      ready: false,
      overall: null,
      overallText: '—',
      grade: { id: 'thin', label: '样本不足', hint: '未找到该型号档案' },
      classId: 'unknown',
      classLabel: CLASS_META.unknown.label,
      peerCount: 0,
      scoredCount: 0,
      hasFlown: false,
      dims: [],
      radar: { points: [], rings: [], labels: [] },
      insights: [],
      disclaimer: '由公开发射档案折算，按同量级对比，不是投票也不是权威排名。'
    }
  }

  var classId = payloadClass(cfg)
  var configs = listConfigs(configsMap)
  var peerCount = configs.filter(function (c) { return payloadClass(c) === classId }).length
  var hasFlown = hasFlownConfig(cfg)
  var dims = DIMS.map(function (meta) {
    var value = dimValue(cfg, meta.id)
    var peers = peerValues(configs, classId, meta.id)
    var score = scoreAgainstPeers(value, peers, meta.id)
    return {
      id: meta.id,
      label: meta.label,
      short: meta.short,
      weight: meta.weight,
      score: score,
      scoreText: score == null ? '—' : score.toFixed(1),
      pct: score == null ? 0 : Math.round((score / SCORE_MAX) * 100),
      rawText: dimRawText(cfg, meta.id),
      hint: dimHint(cfg, meta.id, score),
      missing: score == null
    }
  })

  var weightSum = 0
  var scoreSum = 0
  dims.forEach(function (d) {
    if (d.score == null) return
    weightSum += d.weight
    scoreSum += d.score * d.weight
  })
  var scoredCount = dims.filter(function (d) { return d.score != null }).length
  var overall = weightSum > 0 && scoredCount >= 3 ? round2(scoreSum / weightSum) : null
  var grade = gradeOf(overall, scoredCount, hasFlown)

  var ratios = dims.map(function (d) { return d.missing ? 0.12 : d.score / SCORE_MAX })
  var labels = dims.map(function (d, i) {
    var pt = radarVertex(i, 1, 50)
    return {
      id: d.id,
      label: d.short,
      x: pt.x,
      y: pt.y,
      missing: d.missing,
      score: d.score,
      scoreText: d.scoreText
    }
  })

  return {
    ready: true,
    overall: overall,
    overallText: overall == null ? '—' : overall.toFixed(2),
    grade: grade,
    classId: classId,
    classLabel: classLabel(classId),
    peerCount: peerCount,
    scoredCount: scoredCount,
    hasFlown: hasFlown,
    reusable: cfg.reusable === true,
    dims: dims,
    radar: {
      points: radarPolygon(ratios, 38),
      rings: [ringPolygon(0.36), ringPolygon(0.68), ringPolygon(1)],
      labels: labels
    },
    insights: buildInsights(cfg, dims, overall),
    disclaimer: '由公开发射档案折算，按同量级对比，不是投票也不是权威排名。'
  }
}

/** 入场跳数：只改分数展示，不改原始折算。雷达只带分数，不带参数原文。 */
function applyScoreProgress(view, t) {
  if (!view) return view
  var p = clamp(t == null ? 1 : Number(t), 0, 1)
  if (isNaN(p)) p = 1
  var dims = (view.dims || []).map(function (d) {
    var shown = '—'
    if (!d.missing && d.score != null) shown = (d.score * p).toFixed(1)
    return Object.assign({}, d, { scoreShown: shown })
  })
  var labels = ((view.radar && view.radar.labels) || []).map(function (lab, i) {
    var d = dims[i] || {}
    return Object.assign({}, lab, {
      score: d.score,
      scoreText: d.scoreText,
      scoreShown: d.scoreShown || '—',
      rawText: ''
    })
  })
  return Object.assign({}, view, {
    dims: dims,
    radar: Object.assign({}, view.radar || {}, { labels: labels }),
    overallShown: view.overall == null ? '—' : (view.overall * p).toFixed(2)
  })
}

module.exports = {
  DIMS: DIMS,
  AXIS_COUNT: AXIS_COUNT,
  SCORE_MIN: SCORE_MIN,
  SCORE_MAX: SCORE_MAX,
  payloadClass: payloadClass,
  classLabel: classLabel,
  dimValue: dimValue,
  scoreAgainstPeers: scoreAgainstPeers,
  matchConfigByName: matchConfigByName,
  resolveScoreConfig: resolveScoreConfig,
  buildScoreView: buildScoreView,
  applyScoreProgress: applyScoreProgress,
  radarPolygon: radarPolygon,
  radarVertex: radarVertex,
  hasFlownConfig: hasFlownConfig,
  formatField: formatField
}
