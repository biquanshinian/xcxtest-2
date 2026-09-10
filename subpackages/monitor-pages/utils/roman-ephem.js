/**
 * 罗曼太空望远镜星历 / DSN 纯函数（无 wx）
 * 数据源：NASA/JPL Horizons 星历体 -211、NASA DSN Now（RST）
 */

var MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
var KM_S_TO_KMH = 3600
var STATION_ZH = { Goldstone: '戈尔德斯通', Madrid: '马德里', Canberra: '堪培拉' }

function pad2(n) { return String(n).padStart(2, '0') }

function fmtMet(nowMs, launchMs) {
  if (!isFinite(nowMs) || !isFinite(launchMs) || nowMs < launchMs) return '—'
  var s = Math.floor((nowMs - launchMs) / 1000)
  var d = Math.floor(s / 86400); s -= d * 86400
  var h = Math.floor(s / 3600); s -= h * 3600
  var m = Math.floor(s / 60); s -= m * 60
  return pad2(d) + ':' + pad2(h) + ':' + pad2(m) + ':' + pad2(s)
}

function fmtNumber(n) {
  if (!isFinite(n)) return '—'
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtUtcLabel(isoOrDate) {
  var d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (isNaN(d.getTime())) return ''
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
    ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC'
}

function fmtDataRate(n) {
  var v = Number(n)
  if (!isFinite(v) || v <= 0) return ''
  if (v >= 1000000) {
    var mb = v / 1000000
    return (Math.abs(mb - Math.round(mb)) < 0.05 ? String(Math.round(mb)) : mb.toFixed(1)) + ' Mbps'
  }
  if (v >= 1000) {
    var kb = v / 1000
    return (Math.abs(kb - Math.round(kb)) < 0.05 ? String(Math.round(kb)) : kb.toFixed(1)) + ' kbps'
  }
  return Math.round(v) + ' bps'
}

function fmtLightDelay(sec) {
  if (!isFinite(sec) || sec < 0) return ''
  if (sec < 60) return sec.toFixed(1).replace(/\.0$/, '') + ' 秒'
  var m = Math.floor(sec / 60)
  var s = Math.round(sec % 60)
  return m + ' 分' + (s ? s + ' 秒' : '')
}

/**
 * 任务阶段：'before' | 'cruise' | 'l2' | 'ended'
 * cruiseEndUtcIso 约为发射后 3 个月抵达日地 L2 的公开口径
 * missionEndUtcIso 为任务结束；到点后监控页隐藏卡片，发射商详情仍保留档案
 */
function getMissionPhase(cfg, nowMs) {
  var now = isFinite(nowMs) ? nowMs : Date.now()
  var launchMs = cfg && cfg.launchUtcIso ? Date.parse(cfg.launchUtcIso) : NaN
  var cruiseEndMs = cfg && cfg.cruiseEndUtcIso ? Date.parse(cfg.cruiseEndUtcIso) : NaN
  var endMs = cfg && cfg.missionEndUtcIso ? Date.parse(cfg.missionEndUtcIso) : NaN
  if (isFinite(endMs) && now >= endMs) return 'ended'
  if (isFinite(launchMs) && now < launchMs) return 'before'
  if (isFinite(cruiseEndMs) && now >= cruiseEndMs) return 'l2'
  return 'cruise'
}

function phaseSubtitle(phase) {
  if (phase === 'before') return '即将发射'
  if (phase === 'l2') return '日地 L2 · 晕轨道'
  if (phase === 'ended') return '任务已结束'
  return '奔赴日地 L2'
}

function isSectionVisible(cfg, nowMs) {
  if (!cfg || cfg.enabled === false) return false
  var now = isFinite(nowMs) ? nowMs : Date.now()
  if (cfg.visibleAfterIso) {
    var t = Date.parse(cfg.visibleAfterIso)
    if (!isNaN(t) && now < t) return false
  }
  if (cfg.visibleUntilIso) {
    var t2 = Date.parse(cfg.visibleUntilIso)
    if (!isNaN(t2) && now > t2) return false
  }
  return true
}

function isMonitorVisible(cfg, nowMs) {
  if (!isSectionVisible(cfg, nowMs)) return false
  return getMissionPhase(cfg, nowMs) !== 'ended'
}

function parseHorizonsVectors(text) {
  if (!text || typeof text !== 'string') return []
  var m = /\$\$SOE([\s\S]*?)\$\$EOE/.exec(text)
  if (!m) return []
  var lines = m[1].split(/\r?\n/).map(function (l) { return l.trim() }).filter(Boolean)
  var out = []
  for (var i = 0; i < lines.length;) {
    var head = lines[i]
    if (!/^\d+\.\d+/.test(head) || head.indexOf('A.D.') < 0) { i++; continue }
    if (!lines[i + 1] || !lines[i + 2] || !lines[i + 3]) break
    var cm = /A\.D\.\s*(\d{4})-(\w{3})-(\d+)\s+(\d+):(\d+):(\d+)/.exec(head)
    var tMs = NaN
    if (cm && MON[cm[2]] !== undefined) tMs = Date.UTC(+cm[1], MON[cm[2]], +cm[3], +cm[4], +cm[5], +cm[6])
    var xm = /X\s*=\s*([0-9.E+-]+)/.exec(lines[i + 1])
    var ym = /Y\s*=\s*([0-9.E+-]+)/.exec(lines[i + 1])
    var zm = /Z\s*=\s*([0-9.E+-]+)/.exec(lines[i + 1])
    var vxm = /VX\s*=\s*([0-9.E+-]+)/.exec(lines[i + 2])
    var vym = /VY\s*=\s*([0-9.E+-]+)/.exec(lines[i + 2])
    var vzm = /VZ\s*=\s*([0-9.E+-]+)/.exec(lines[i + 2])
    var rgm = /RG=\s*([0-9.E+-]+)/.exec(lines[i + 3])
    var ltm = /LT=\s*([0-9.E+-]+)/.exec(lines[i + 3])
    var rrm = /RR=\s*([0-9.E+-]+)/.exec(lines[i + 3])
    if (xm && ym && zm && vxm && vym && vzm && rgm) {
      var vx = parseFloat(vxm[1])
      var vy = parseFloat(vym[1])
      var vz = parseFloat(vzm[1])
      out.push({
        tMs: tMs,
        pos: { x: parseFloat(xm[1]), y: parseFloat(ym[1]), z: parseFloat(zm[1]) },
        rgKm: parseFloat(rgm[1]),
        speedKmS: Math.sqrt(vx * vx + vy * vy + vz * vz),
        ltSec: ltm ? parseFloat(ltm[1]) : null,
        rrKmS: rrm ? parseFloat(rrm[1]) : null
      })
    }
    i += 4
  }
  return out
}

function pickClosest(rows, nowMs) {
  if (!rows || !rows.length) return null
  var best = rows[0]
  var bestDt = isFinite(rows[0].tMs) ? Math.abs(rows[0].tMs - nowMs) : Infinity
  for (var i = 1; i < rows.length; i++) {
    if (!isFinite(rows[i].tMs)) continue
    var dt = Math.abs(rows[i].tMs - nowMs)
    if (dt < bestDt) { bestDt = dt; best = rows[i] }
  }
  return best
}

function dist3d(a, b) {
  if (!a || !b) return NaN
  var dx = a.x - b.x
  var dy = a.y - b.y
  var dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function parseXmlAttrs(raw) {
  var out = {}
  if (!raw) return out
  var re = /([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/g
  var m
  while ((m = re.exec(raw))) out[m[1]] = m[2]
  return out
}

function parseDsnRst(xml, spacecraftName) {
  var name = String(spacecraftName || 'RST').toUpperCase()
  if (!xml || typeof xml !== 'string') return null
  var tokens = xml.split(/(?=<station[\s>]|<dish[\s>])/i)
  var stationName = ''
  var stationCode = ''
  var hit = null
  for (var i = 0; i < tokens.length; i++) {
    var tok = tokens[i]
    if (/^<station[\s>]/i.test(tok)) {
      var sa = parseXmlAttrs((/^<station\b([^>]*)>/i.exec(tok) || [])[1] || '')
      stationCode = sa.name || stationCode
      stationName = sa.friendlyName || stationName
      continue
    }
    if (!/^<dish[\s>]/i.test(tok)) continue
    var scRe = new RegExp('spacecraft="' + name + '"|name="' + name + '"', 'i')
    if (!scRe.test(tok)) continue
    var da = parseXmlAttrs((/^<dish\b([^>]*)>/i.exec(tok) || [])[1] || '')
    var downs = []
    var downRe = /<downSignal\b([^>]*)>/gi
    var dm
    while ((dm = downRe.exec(tok))) downs.push(parseXmlAttrs(dm[1]))
    var down = null
    for (var d = 0; d < downs.length; d++) {
      if (String(downs[d].spacecraft || '').toUpperCase() !== name) continue
      if (!down || String(downs[d].active) === 'true') down = downs[d]
    }
    var ta = parseXmlAttrs((/<target\b([^>]*)>/i.exec(tok) || [])[1] || '')
    var active = !!(down && String(down.active) === 'true')
    var dataRate = down ? Number(down.dataRate) : NaN
    var candidate = {
      tracking: active,
      spacecraft: name,
      dish: da.name || '',
      station: stationName,
      stationCode: stationCode,
      stationZh: STATION_ZH[stationName] || stationName,
      band: (down && down.band) || '',
      dataRate: isFinite(dataRate) ? dataRate : null,
      dataRateText: fmtDataRate(dataRate),
      activity: da.activity || '',
      rangeKm: ta && Number(ta.downlegRange) > 0 ? Number(ta.downlegRange) : null
    }
    // 交接班时可能多天线同时出现 RST：优先正在跟踪的，否则保留最后一条
    if (candidate.tracking || !hit) hit = candidate
  }
  return hit
}

function formatDsnLine(dsn) {
  if (!dsn || !dsn.dish || !dsn.tracking) return ''
  var loc = dsn.stationZh || dsn.station || ''
  var parts = ['DSN']
  if (loc) parts.push(loc)
  if (dsn.dish) parts.push(dsn.dish)
  var line = parts.join(' ')
  if (dsn.band) line += ' · ' + dsn.band + ' 波段跟踪中'
  else line += ' · 跟踪中'
  if (dsn.dataRateText) line += ' · ' + dsn.dataRateText
  return line
}

function fmtRangeRate(rrKmS) {
  if (!isFinite(rrKmS)) return { text: '—', dir: '径向速率未知', signedKmh: null }
  var dir = '径向平稳'
  if (rrKmS > 0.01) dir = '远离地球'
  else if (rrKmS < -0.01) dir = '接近地球'
  return {
    text: fmtNumber(Math.abs(rrKmS * 3600)),
    dir: dir,
    signedKmh: Math.round(rrKmS * 3600)
  }
}

function cruiseRemainLabel(cfg, nowMs) {
  var end = cfg && cfg.cruiseEndUtcIso ? Date.parse(cfg.cruiseEndUtcIso) : NaN
  if (!isFinite(end)) return ''
  var now = isFinite(nowMs) ? nowMs : Date.now()
  if (now >= end) return '已进入公开口径的 L2 窗口'
  var days = Math.max(1, Math.ceil((end - now) / 86400000))
  return '公开口径约 ' + days + ' 天后抵达 L2'
}

function roundTripLight(sec) {
  if (!isFinite(sec) || sec < 0) return ''
  return fmtLightDelay(sec * 2)
}

function l2ProgressPct(distEarthKm, distL2Km, phase) {
  if (phase === 'l2') return 100
  if (!isFinite(distEarthKm) || distEarthKm < 0) return 0
  if (!isFinite(distL2Km) || distL2Km < 0) return 0
  if (distL2Km < 80000) return 100
  var pct = Math.round(100 * distEarthKm / (distEarthKm + distL2Km))
  if (pct < 0) return 0
  if (pct > 99) return 99
  return pct
}

function buildSnapshot(opts) {
  var nowMs = opts.nowMs
  var launchMs = opts.launchMs
  var roman = opts.roman
  var l2 = opts.l2
  var dsn = opts.dsn || null
  var phase = opts.phase || 'cruise'
  if (!roman || !isFinite(roman.rgKm)) return null
  var distL2Km = l2 && l2.pos && roman.pos ? dist3d(roman.pos, l2.pos) : NaN
  var velocityKmh = Math.round(roman.speedKmS * KM_S_TO_KMH)
  var pct = l2ProgressPct(roman.rgKm, distL2Km, phase)
  return {
    ok: true,
    source: opts.source || 'horizons',
    missionElapsedText: fmtMet(nowMs, launchMs),
    velocityKmh: velocityKmh,
    distanceFromEarthKm: Math.round(roman.rgKm),
    distanceToL2Km: isFinite(distL2Km) ? Math.round(distL2Km) : null,
    lightDelaySec: roman.ltSec != null && isFinite(roman.ltSec) ? roman.ltSec : null,
    lightDelayText: fmtLightDelay(roman.ltSec),
    rangeRateKmS: roman.rrKmS != null && isFinite(roman.rrKmS) ? roman.rrKmS : null,
    progressPct: pct,
    posKm: roman.pos ? {
      x: Math.round(roman.pos.x),
      y: Math.round(roman.pos.y),
      z: Math.round(roman.pos.z)
    } : null,
    speedKmS: isFinite(roman.speedKmS) ? Number(roman.speedKmS.toFixed(6)) : null,
    dsn: dsn,
    dsnLine: formatDsnLine(dsn),
    updatedAtLabel: fmtUtcLabel(new Date(nowMs))
  }
}

module.exports = {
  pad2: pad2,
  fmtMet: fmtMet,
  fmtNumber: fmtNumber,
  fmtUtcLabel: fmtUtcLabel,
  fmtDataRate: fmtDataRate,
  fmtLightDelay: fmtLightDelay,
  getMissionPhase: getMissionPhase,
  phaseSubtitle: phaseSubtitle,
  isSectionVisible: isSectionVisible,
  isMonitorVisible: isMonitorVisible,
  parseHorizonsVectors: parseHorizonsVectors,
  pickClosest: pickClosest,
  dist3d: dist3d,
  parseDsnRst: parseDsnRst,
  formatDsnLine: formatDsnLine,
  l2ProgressPct: l2ProgressPct,
  fmtRangeRate: fmtRangeRate,
  cruiseRemainLabel: cruiseRemainLabel,
  roundTripLight: roundTripLight,
  buildSnapshot: buildSnapshot,
  KM_S_TO_KMH: KM_S_TO_KMH
}
