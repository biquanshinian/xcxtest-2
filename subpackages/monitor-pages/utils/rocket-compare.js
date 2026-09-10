/**
 * 火箭型号对比：纯数据层，不依赖 wx，可供 node:test 直接引用。
 * 数据源字段与 booster_genealogy/_config_meta（LL2 launcher_configurations）同构。
 */

var gallerySearch = require('./gallery-search.js')

var MAX_COMPARE = 4
var GATE_PRODUCT_ID = 'rocket_compare'
var GATE_PRODUCT_NAME = '火箭型号对比'
var PICKER_IDLE_LIMIT = 36
var PICKER_SEARCH_LIMIT = 48

var COUNTRY_ZH = {
  CN: '中国', US: '美国', RU: '俄罗斯', JP: '日本', IN: '印度',
  FR: '法国', DE: '德国', GB: '英国', NZ: '新西兰', KR: '韩国',
  IL: '以色列', BR: '巴西', AU: '澳大利亚', KZ: '哈萨克斯坦',
  UA: '乌克兰', IT: '意大利', ES: '西班牙', IR: '伊朗'
}

var COMPARE_FIELDS = [
  { key: 'manufacturer', label: '发射商', kind: 'text' },
  { key: 'country', label: '国家/地区', kind: 'text' },
  { key: 'reusable', label: '复用能力', kind: 'bool', better: 'true' },
  { key: 'length', label: '全长', unit: 'm', kind: 'number', digits: 1, better: 'higher' },
  { key: 'diameter', label: '直径', unit: 'm', kind: 'number', digits: 1, better: 'higher' },
  { key: 'launch_mass', label: '起飞质量', unit: 't', kind: 'number', digits: 0, better: 'higher' },
  { key: 'leo_capacity', label: 'LEO 运力', unit: 'kg', kind: 'number', digits: 0, better: 'higher' },
  { key: 'gto_capacity', label: 'GTO 运力', unit: 'kg', kind: 'number', digits: 0, better: 'higher' },
  { key: 'to_thrust', label: '起飞推力', unit: 'kN', kind: 'number', digits: 0, better: 'higher' },
  { key: 'launch_cost', label: '单次发射成本', unit: '万美元', kind: 'number', digits: 1, better: 'lower', scale: 10000 },
  { key: 'max_stage', label: '级数', kind: 'number', digits: 0 },
  { key: 'maiden_flight', label: '首飞时间', kind: 'date', better: 'earlier' },
  { key: 'total_launch_count', label: '总发射', kind: 'number', digits: 0, better: 'higher' },
  { key: 'successful_launches', label: '成功发射', kind: 'number', digits: 0, better: 'higher' },
  { key: 'failed_launches', label: '失败发射', kind: 'number', digits: 0, better: 'lower' },
  { key: 'pending_launches', label: '待发射', kind: 'number', digits: 0 },
  { key: 'successRate', label: '发射成功率', kind: 'percent', better: 'higher' },
  { key: 'attempted_landings', label: '着陆尝试', kind: 'number', digits: 0, better: 'higher' },
  { key: 'successful_landings', label: '成功着陆', kind: 'number', digits: 0, better: 'higher' },
  { key: 'landingRate', label: '着陆成功率', kind: 'percent', better: 'higher' },
  { key: 'consecutive_successful_landings', label: '连续成功着陆', kind: 'number', digits: 0, better: 'higher' },
  { key: 'fastestTurnaroundText', label: '最快周转', kind: 'text' }
]

var FIELD_BY_KEY = {}
COMPARE_FIELDS.forEach(function (f) { FIELD_BY_KEY[f.key] = f })

var SPEC_GROUPS = [
  { id: 'basic', title: '基本信息', keys: ['manufacturer', 'country', 'reusable', 'maiden_flight'] },
  { id: 'size', title: '尺寸构型', keys: ['length', 'diameter', 'launch_mass', 'max_stage'] },
  { id: 'power', title: '运力动力', keys: ['leo_capacity', 'gto_capacity', 'to_thrust', 'launch_cost'] },
  { id: 'record', title: '发射战绩', keys: ['total_launch_count', 'successful_launches', 'failed_launches', 'pending_launches', 'successRate', 'attempted_landings', 'successful_landings', 'landingRate', 'consecutive_successful_landings', 'fastestTurnaroundText'] }
]

var PK_SECTIONS = [
  { id: 'size', title: '尺寸对比', keys: ['length', 'diameter', 'launch_mass', 'max_stage'] },
  { id: 'power', title: '运力对比', keys: ['leo_capacity', 'gto_capacity', 'to_thrust'] },
  { id: 'cost', title: '成本对比', keys: ['launch_cost'] },
  { id: 'record', title: '战绩对比', keys: ['total_launch_count', 'successful_launches', 'successRate', 'attempted_landings', 'successful_landings', 'landingRate', 'consecutive_successful_landings'] }
]

var OVERVIEW_KEYS = ['reusable', 'launch_cost', 'total_launch_count', 'successful_launches', 'successRate', 'leo_capacity', 'gto_capacity', 'to_thrust', 'landingRate']

function toNum(v) {
  if (v == null || v === '') return null
  var n = Number(v)
  return isNaN(n) ? null : n
}

function fmtDate(d) {
  if (!d) return ''
  try {
    var dt = new Date(d)
    if (isNaN(dt.getTime())) return String(d)
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0')
  } catch (e) {
    return String(d)
  }
}

function formatGrouped(n, digits) {
  if (n == null || isNaN(n)) return ''
  var text = digits != null ? Number(n).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1') : String(n)
  var parts = text.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}

function countryLabel(code) {
  var cc = String(code || '').trim().toUpperCase()
  return COUNTRY_ZH[cc] || cc || ''
}

function parseCompareIds(options) {
  var raw = ''
  if (options) {
    raw = options.ids || options.configIds || options.id || options.configId || ''
  }
  try { raw = decodeURIComponent(String(raw || '')) } catch (e) { raw = String(raw || '') }
  var seen = {}
  var ids = []
  String(raw).split(/[,|;\s]+/).forEach(function (piece) {
    var id = String(piece || '').trim()
    if (!id || seen[id]) return
    seen[id] = true
    ids.push(id)
  })
  return ids.slice(0, MAX_COMPARE)
}

function landingRate(cfg) {
  var att = toNum(cfg && cfg.attempted_landings)
  if (att == null || att <= 0) return null
  return Math.round((toNum(cfg.successful_landings) || 0) / att * 1000) / 10
}

function successRate(cfg) {
  var total = toNum(cfg && cfg.total_launch_count)
  if (total == null || total <= 0) return null
  return Math.round((toNum(cfg.successful_launches) || 0) / total * 1000) / 10
}

function pickFieldRaw(cfg, field) {
  if (!cfg) return null
  if (field.key === 'landingRate') return landingRate(cfg)
  if (field.key === 'successRate') return successRate(cfg)
  if (field.key === 'country') return countryLabel(cfg.countryCode)
  if (field.key === 'manufacturer') {
    return cfg.manufacturerDisplay || cfg.manufacturerNameZh || cfg.manufacturerName || ''
  }
  if (field.key === 'maiden_flight') return fmtDate(cfg.maiden_flight)
  if (field.key === 'fastestTurnaroundText') return cfg.fastestTurnaroundText || ''
  if (field.key === 'reusable') return cfg.reusable === true
  var n = toNum(cfg[field.key])
  if (n == null) return null
  if (field.scale) return n / field.scale
  return n
}

function formatCell(field, raw) {
  if (raw == null || raw === '') return '—'
  if (field.kind === 'bool') return raw ? '可复用' : '一次性'
  if (field.kind === 'percent') return formatGrouped(raw, 1) + '%'
  if (field.kind === 'date' || field.kind === 'text') return String(raw)
  var text = formatGrouped(raw, field.digits)
  return field.unit ? (text + ' ' + field.unit) : text
}

function valuesEqual(a, b, kind) {
  if (a == null || a === '' || b == null || b === '') return false
  if (kind === 'number' || kind === 'percent') {
    return Math.abs(Number(a) - Number(b)) < 1e-6
  }
  return String(a) === String(b)
}

function rowDiffers(raws, kind) {
  var present = raws.filter(function (v) { return v != null && v !== '' })
  if (present.length < 2) return false
  var first = present[0]
  for (var i = 1; i < present.length; i++) {
    if (!valuesEqual(first, present[i], kind)) return true
  }
  return false
}

function pickWinnerIndexes(raws, field) {
  var better = field.better
  if (!better) return []
  var best = null
  var indexes = []
  raws.forEach(function (raw, idx) {
    if (raw == null || raw === '') return
    var score
    if (field.kind === 'bool') {
      if (better !== 'true' || raw !== true) return
      score = 1
    } else if (field.kind === 'date') {
      var t = Date.parse(raw)
      if (isNaN(t)) return
      score = better === 'earlier' ? -t : t
    } else {
      var n = Number(raw)
      if (isNaN(n)) return
      score = better === 'lower' ? -n : n
    }
    if (best == null || score > best) {
      best = score
      indexes = [idx]
    } else if (score === best) {
      indexes.push(idx)
    }
  })
  if (indexes.length === raws.filter(function (v) { return v != null && v !== '' }).length) {
    return []
  }
  return indexes
}

function modelLabel(model) {
  return (model && (model.name || model.fullName || model.alias)) || '该型号'
}

function ratioHint(high, low) {
  if (high == null || low == null || Number(low) === 0) return ''
  var r = Number(high) / Number(low)
  if (r >= 1.15) return '约 ' + r.toFixed(1).replace(/\.0$/, '') + ' 倍'
  var pct = Math.round((Number(high) - Number(low)) / Number(low) * 100)
  if (Math.abs(pct) >= 5) return '高 ' + Math.abs(pct) + '%'
  return ''
}

function buildInsights(models, rows) {
  var insights = []
  if (!models || models.length < 2) return insights
  rows.forEach(function (row) {
    if (!row.differs) return
    var field = row.field
    var present = []
    row.raws.forEach(function (raw, idx) {
      if (raw == null || raw === '') return
      present.push({ idx: idx, raw: raw, name: modelLabel(models[idx]), text: row.cells[idx].text })
    })
    if (present.length < 2) return

    if (field.kind === 'bool') {
      var yes = present.filter(function (p) { return p.raw === true }).map(function (p) { return p.name })
      var no = present.filter(function (p) { return p.raw === false }).map(function (p) { return p.name })
      if (yes.length && no.length) {
        insights.push({
          key: field.key,
          tone: 'key',
          text: yes.join('、') + ' 可复用，' + no.join('、') + ' 为一次性构型'
        })
      }
      return
    }

    if (field.kind === 'text' || field.kind === 'date') {
      if (present.length === 2) {
        insights.push({
          key: field.key,
          tone: 'info',
          text: field.label + '：' + present[0].name + '（' + present[0].text + '），' + present[1].name + '（' + present[1].text + '）'
        })
      } else {
        insights.push({
          key: field.key,
          tone: 'info',
          text: field.label + '各不相同：' + present.map(function (p) { return p.name + ' ' + p.text }).join(' / ')
        })
      }
      return
    }

    var sorted = present.slice().sort(function (a, b) { return Number(b.raw) - Number(a.raw) })
    if (field.better === 'lower') sorted.reverse()
    var top = sorted[0]
    var bottom = sorted[sorted.length - 1]
    if (valuesEqual(top.raw, bottom.raw, field.kind)) return
    var hi = Math.max(Number(top.raw), Number(bottom.raw))
    var lo = Math.min(Number(top.raw), Number(bottom.raw))
    var hint = (field.kind === 'percent' || field.kind === 'number') ? ratioHint(hi, lo) : ''
    var verb = field.better === 'lower' ? '更低' : '更高'
    if (present.length === 2) {
      var delta = Math.abs(Number(top.raw) - Number(bottom.raw))
      var deltaText = formatGrouped(delta, field.digits)
      if (field.unit) deltaText += ' ' + field.unit
      if (field.kind === 'percent') deltaText = formatGrouped(delta, 1) + ' 个百分点'
      insights.push({
        key: field.key,
        tone: field.better ? 'lead' : 'info',
        text: top.name + ' 的' + field.label + '（' + top.text + '）比 ' + bottom.name + '（' + bottom.text + '）' + verb +
          (deltaText ? ' ' + deltaText : '') + (hint ? '，' + hint : '')
      })
      return
    }
    var topWord = field.better === 'lower' ? '最低' : '最高'
    var bottomWord = field.better === 'lower' ? '最高' : '最低'
    insights.push({
      key: field.key,
      tone: field.better ? 'lead' : 'info',
      text: field.label + topWord + '是 ' + top.name + '（' + top.text + '），' + bottomWord + '是 ' + bottom.name +
        '（' + bottom.text + '）' + (hint ? '，相差 ' + hint : '')
    })
  })
  return insights
}

function buildCompareTable(models, options) {
  var onlyDiff = !!(options && options.onlyDiff)
  var rows = []
  var list = models || []
  var diffCount = 0
  var sameCount = 0
  COMPARE_FIELDS.forEach(function (field) {
    var raws = list.map(function (model) { return pickFieldRaw(model && model.cfg, field) })
    var allEmpty = raws.every(function (v) { return v == null || v === '' })
    if (allEmpty) return
    var differs = rowDiffers(raws, field.kind)
    if (differs) diffCount += 1
    else sameCount += 1
    if (onlyDiff && !differs) return
    var winners = differs ? pickWinnerIndexes(raws, field) : []
    var cells = raws.map(function (raw, idx) {
      return {
        i: idx,
        text: formatCell(field, raw),
        empty: raw == null || raw === '',
        win: winners.indexOf(idx) >= 0
      }
    })
    rows.push({
      key: field.key,
      label: field.label,
      differs: differs,
      field: field,
      raws: raws,
      cells: cells
    })
  })
  var insights = buildInsights(list, rows)
  var displayRows = rows.map(function (row) {
    return {
      key: row.key,
      label: row.label,
      differs: row.differs,
      cells: row.cells
    }
  })
  return {
    rows: displayRows,
    insights: insights,
    diffCount: diffCount,
    sameCount: sameCount
  }
}

var CATALOG_FULL_MIN_COUNT = 480

function catalogLooksIncomplete(configs) {
  return Object.keys(configs || {}).length < CATALOG_FULL_MIN_COUNT
}

function mergeConfigMaps(base, extra) {
  var out = {}
  var src = base || {}
  var add = extra || {}
  for (var k in src) {
    if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k]
  }
  for (var id in add) {
    if (!Object.prototype.hasOwnProperty.call(add, id) || !add[id]) continue
    var key = String(add[id].id != null ? add[id].id : id)
    if (!out[key]) out[key] = add[id]
  }
  return out
}

function idsMissingFromArchive(ids, configs) {
  var seen = {}
  var missed = []
  ;(ids || []).forEach(function (id) {
    var key = String(id == null ? '' : id).trim()
    if (!key || seen[key]) return
    seen[key] = true
    if (!resolveConfig(configs, key)) missed.push(key)
  })
  return missed
}

function resolveConfig(configs, id) {
  var map = configs || {}
  var key = String(id == null ? '' : id).trim()
  if (!key) return null
  if (map[key]) return map[key]
  if (map[id]) return map[id]
  var asNum = Number(key)
  if (!isNaN(asNum) && map[asNum]) return map[asNum]
  for (var k in map) {
    if (!Object.prototype.hasOwnProperty.call(map, k)) continue
    var cfg = map[k]
    if (cfg && String(cfg.id) === key) return cfg
  }
  return null
}

var SLOT_TONES = ['orange', 'blue', 'amber', 'purple']

function barPercentsList(raws) {
  var nums = (raws || []).map(function (v) {
    if (v == null || v === '') return null
    var n = Number(v)
    return isNaN(n) ? null : n
  })
  var present = nums.filter(function (n) { return n != null })
  if (present.length < 2) {
    return { pcts: nums.map(function () { return 0 }), empty: true }
  }
  var max = 0
  present.forEach(function (n) {
    var a = Math.abs(n)
    if (a > max) max = a
  })
  if (max === 0) {
    return { pcts: nums.map(function (n) { return n == null ? 0 : 36 }), empty: false }
  }
  return {
    pcts: nums.map(function (n) {
      return n == null ? 0 : Math.max(10, Math.round(Math.abs(n) / max * 100))
    }),
    empty: false
  }
}

function barPercents(left, right) {
  var bars = barPercentsList([left, right])
  return { left: bars.pcts[0] || 0, right: bars.pcts[1] || 0, empty: bars.empty }
}

function packSlot(model, tone) {
  if (!model) {
    return { empty: true, tone: tone, name: '添加型号', sub: '点击选择', imageUrl: '', configId: '', countryFlag: '', reusable: false }
  }
  var cost = pickFieldRaw(model.cfg, FIELD_BY_KEY.launch_cost)
  return {
    empty: false,
    tone: tone,
    configId: model.configId,
    name: modelLabel(model),
    fullName: model.fullName || model.name || '',
    sub: model.manufacturerDisplay || '',
    costText: cost == null ? '' : formatCell(FIELD_BY_KEY.launch_cost, cost),
    imageUrl: model.imageUrl || '',
    countryFlag: model.countryFlag || '',
    reusable: !!(model.cfg && model.cfg.reusable)
  }
}

function buildPkRowModels(field, models) {
  var list = models || []
  var raws = list.map(function (model) { return pickFieldRaw(model && model.cfg, field) })
  var winners = pickWinnerIndexes(raws, field)
  var numeric = field.kind === 'number' || field.kind === 'percent'
  var bars = numeric ? barPercentsList(raws) : { pcts: raws.map(function () { return 0 }), empty: true }
  var present = raws.filter(function (v) { return v != null && v !== '' }).length
  var canScore = present >= 2
  var values = raws.map(function (raw, idx) {
    var empty = raw == null || raw === ''
    var win = canScore && winners.indexOf(idx) >= 0
    return {
      i: idx,
      tone: SLOT_TONES[idx] || 'blue',
      text: empty ? '暂无' : formatCell(field, raw),
      empty: empty,
      win: win,
      weak: canScore && winners.length > 0 && !win && !empty,
      pct: bars.pcts[idx] || 0
    }
  })
  var left = values[0] || { text: '暂无', empty: true, win: false, weak: false, pct: 0 }
  var right = values[1] || { text: '暂无', empty: true, win: false, weak: false, pct: 0 }
  return {
    key: field.key,
    label: field.label,
    unit: field.unit || (field.kind === 'percent' ? '%' : ''),
    values: values,
    leftText: left.text,
    rightText: right.text,
    leftEmpty: !!left.empty,
    rightEmpty: !!right.empty,
    leftWin: !!left.win,
    rightWin: !!right.win,
    leftWeak: !!left.weak,
    rightWeak: !!right.weak,
    leftPct: left.pct,
    rightPct: right.pct,
    numeric: numeric,
    empty: values.every(function (v) { return v.empty })
  }
}

function buildPkRow(field, leftModel, rightModel) {
  return buildPkRowModels(field, [leftModel, rightModel])
}

function sectionWinner(rows) {
  var left = 0
  var right = 0
  ;(rows || []).forEach(function (row) {
    if (row.leftEmpty || row.rightEmpty) return
    if (row.leftWin) left += 1
    if (row.rightWin) right += 1
  })
  if (left === right) return ''
  return left > right ? 'left' : 'right'
}

function collectPkModels(leftModel, rightModel) {
  if (Array.isArray(leftModel)) return leftModel.slice(0, MAX_COMPARE)
  return [leftModel, rightModel]
}

function buildPkView(leftModel, rightModel) {
  var models = collectPkModels(leftModel, rightModel)
  var filled = models.filter(Boolean)
  var pair = filled.length <= 2
  var rowModels = pair ? [models[0] || null, models[1] || null] : filled
  var overview = OVERVIEW_KEYS.map(function (key) {
    return buildPkRowModels(FIELD_BY_KEY[key], rowModels)
  }).filter(function (row) { return !row.empty })
  var sections = PK_SECTIONS.map(function (sec) {
    var rows = sec.keys.map(function (key) {
      return buildPkRowModels(FIELD_BY_KEY[key], rowModels)
    }).filter(function (row) { return !row.empty || row.numeric })
    return {
      id: sec.id,
      title: sec.title,
      winner: pair ? sectionWinner(rows) : '',
      rows: rows
    }
  }).filter(function (sec) { return sec.rows.length > 0 })
  return {
    pair: pair,
    left: packSlot(models[0] || null, SLOT_TONES[0]),
    right: packSlot(models[1] || null, SLOT_TONES[1]),
    slots: filled.map(function (model, idx) { return packSlot(model, SLOT_TONES[idx]) }),
    overview: overview,
    sections: sections
  }
}

function buildSpecGroups(models, options) {
  var table = buildCompareTable(models, options)
  var rowMap = {}
  table.rows.forEach(function (row) { rowMap[row.key] = row })
  var groups = SPEC_GROUPS.map(function (g) {
    var rows = g.keys.map(function (key) { return rowMap[key] }).filter(Boolean)
    return { id: g.id, title: g.title, rows: rows }
  }).filter(function (g) { return g.rows.length > 0 })
  return {
    groups: groups,
    insights: table.insights,
    diffCount: table.diffCount,
    sameCount: table.sameCount
  }
}

function slimPickerCard(card, picked) {
  if (!card) return null
  return {
    configId: card.configId,
    fullName: card.fullName || card.name || '',
    manufacturer: card.manufacturer || '',
    manufacturerId: card.manufacturerId || '',
    manufacturerAbbrev: card.manufacturerAbbrev || '',
    manufacturerDisplay: card.manufacturerDisplay || card.manufacturer || '',
    thumbnailUrl: card.thumbnailUrl || card.imageUrl || '',
    picked: !!picked,
    reusable: card.reusable === true,
    statRight: card.statText || card.manufacturerDisplay || card.manufacturer || ''
  }
}

/** 选型列表：本地检索 + 截断渲染，不把 500+ 条整表 setData */
function buildPickerView(cards, keyword, selectedModels) {
  var selected = selectedModels || []
  var picked = {}
  selected.forEach(function (m) {
    if (m && m.configId != null) picked[String(m.configId)] = true
  })
  var filtered = gallerySearch.filterCardsByKeyword(cards || [], keyword)
  var hasQuery = !!gallerySearch.normalizeGalleryQuery(keyword)
  var cap = hasQuery ? PICKER_SEARCH_LIMIT : PICKER_IDLE_LIMIT
  var selectedCards = []
  var rest = []
  filtered.forEach(function (card) {
    if (picked[String(card.configId)]) selectedCards.push(card)
    else rest.push(card)
  })
  var combined = selectedCards.concat(rest)
  var limit = Math.max(cap, selectedCards.length)
  var sliced = combined.slice(0, limit)
  var slim = sliced.map(function (card) {
    return slimPickerCard(card, picked[String(card.configId)])
  }).filter(Boolean)
  return {
    groups: groupPickerCards(slim),
    shown: slim.length,
    total: filtered.length,
    truncated: filtered.length > slim.length
  }
}

function groupPickerCards(cards) {
  var picked = []
  var reusable = []
  var expendable = []
  ;(cards || []).forEach(function (card) {
    if (card && card.picked) picked.push(card)
    else if (card && card.reusable) reusable.push(card)
    else expendable.push(card)
  })
  var groups = []
  if (picked.length) groups.push({ id: 'picked', title: '已选型号', items: picked })
  if (reusable.length) groups.push({ id: 'reusable', title: '可复用', items: reusable })
  if (expendable.length) groups.push({ id: 'expendable', title: '一次性', items: expendable })
  return groups
}

function joinCompareIds(ids) {
  return (ids || []).map(function (id) { return String(id) }).filter(Boolean).slice(0, MAX_COMPARE).join(',')
}

/** 已选出的型号优先；目录还没就绪时回落入页 ids，避免加载中转发丢对比 */
function resolveShareIds(selected, fallbackIds, catalogReady) {
  var fromSelected = (selected || []).map(function (m) {
    return m && m.configId != null ? String(m.configId) : ''
  }).filter(Boolean)
  if (fromSelected.length) return fromSelected.slice(0, MAX_COMPARE)
  if (catalogReady) return []
  return (fallbackIds || []).map(function (id) { return String(id) }).filter(Boolean).slice(0, MAX_COMPARE)
}

function buildShareQuery(ids) {
  var joined = joinCompareIds(ids)
  return joined ? 'ids=' + encodeURIComponent(joined) : ''
}

/** 带入不足 2 款时，选型列表就是入口页，不是结果页上的浮层 */
function isPickerEntry(ids) {
  return !Array.isArray(ids) || ids.length < 2
}

/** 选型是结果页上的浮层时，返回只关列表；否则离开对比页回到上一页 */
function shouldClosePickerOnBack(state) {
  var src = state && typeof state === 'object' ? state : {}
  return !!(src.pickerOpen && src.pickerFromResult)
}

/** 综合结果页返回应回到选型（火箭对比），不要直接退出 */
function shouldReturnToPickerOnBack(state) {
  var src = state && typeof state === 'object' ? state : {}
  if (src.pickerOpen) return false
  var selected = src.selected || []
  return selected.length >= 2
}

function buildShareTitle(models) {
  var names = (models || []).map(function (m) { return modelLabel(m) }).filter(Boolean)
  if (names.length >= 2) return names.slice(0, 3).join(' vs ') + ' · 火箭对比'
  if (names.length === 1) return names[0] + ' · 对比其他型号'
  return '火箭型号对比 | 火星探索日志'
}

module.exports = {
  MAX_COMPARE: MAX_COMPARE,
  GATE_PRODUCT_ID: GATE_PRODUCT_ID,
  GATE_PRODUCT_NAME: GATE_PRODUCT_NAME,
  COMPARE_FIELDS: COMPARE_FIELDS,
  SPEC_GROUPS: SPEC_GROUPS,
  parseCompareIds: parseCompareIds,
  joinCompareIds: joinCompareIds,
  resolveShareIds: resolveShareIds,
  buildShareQuery: buildShareQuery,
  countryLabel: countryLabel,
  landingRate: landingRate,
  successRate: successRate,
  pickFieldRaw: pickFieldRaw,
  formatCell: formatCell,
  buildCompareTable: buildCompareTable,
  buildPkView: buildPkView,
  buildSpecGroups: buildSpecGroups,
  groupPickerCards: groupPickerCards,
  slimPickerCard: slimPickerCard,
  buildPickerView: buildPickerView,
  PICKER_IDLE_LIMIT: PICKER_IDLE_LIMIT,
  PICKER_SEARCH_LIMIT: PICKER_SEARCH_LIMIT,
  barPercents: barPercents,
  buildShareTitle: buildShareTitle,
  resolveConfig: resolveConfig,
  idsMissingFromArchive: idsMissingFromArchive,
  catalogLooksIncomplete: catalogLooksIncomplete,
  mergeConfigMaps: mergeConfigMaps,
  CATALOG_FULL_MIN_COUNT: CATALOG_FULL_MIN_COUNT,
  isPickerEntry: isPickerEntry,
  shouldClosePickerOnBack: shouldClosePickerOnBack,
  shouldReturnToPickerOnBack: shouldReturnToPickerOnBack,
  SLOT_TONES: SLOT_TONES
}
