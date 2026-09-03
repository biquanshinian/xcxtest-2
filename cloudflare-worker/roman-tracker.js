/**
 * 罗曼太空望远镜追踪代理
 * NASA/JPL Horizons 星历体 -211 + NASA DSN Now（RST）
 * 与 subpackages/monitor-pages/utils/roman-ephem.js 保持同一套解析口径
 */

const HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api'
const DSN_URL = 'https://eyes.nasa.gov/dsn/data/dsn.xml'
const ROMAN_CMD = '-211'
const L2_CMD = 'SEMB-L2'
const DSN_NAME = 'RST'
const CACHE_MAX_AGE = 30
const KV_TTL = 300

const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
const STATION_ZH = { Goldstone: '戈尔德斯通', Madrid: '马德里', Canberra: '堪培拉' }

function pad2(n) { return String(n).padStart(2, '0') }

function fmtUtc(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
    ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds())
}

function fmtUtcLabel(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
    ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC'
}

function parseHorizonsVectors(text) {
  if (!text || typeof text !== 'string') return []
  const m = /\$\$SOE([\s\S]*?)\$\$EOE/.exec(text)
  if (!m) return []
  const lines = m[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const out = []
  for (let i = 0; i < lines.length;) {
    const head = lines[i]
    if (!/^\d+\.\d+/.test(head) || head.indexOf('A.D.') < 0) { i++; continue }
    if (!lines[i + 1] || !lines[i + 2] || !lines[i + 3]) break
    const cm = /A\.D\.\s*(\d{4})-(\w{3})-(\d+)\s+(\d+):(\d+):(\d+)/.exec(head)
    let tMs = NaN
    if (cm && MON[cm[2]] !== undefined) tMs = Date.UTC(+cm[1], MON[cm[2]], +cm[3], +cm[4], +cm[5], +cm[6])
    const xm = /X\s*=\s*([0-9.E+-]+)/.exec(lines[i + 1])
    const ym = /Y\s*=\s*([0-9.E+-]+)/.exec(lines[i + 1])
    const zm = /Z\s*=\s*([0-9.E+-]+)/.exec(lines[i + 1])
    const vxm = /VX\s*=\s*([0-9.E+-]+)/.exec(lines[i + 2])
    const vym = /VY\s*=\s*([0-9.E+-]+)/.exec(lines[i + 2])
    const vzm = /VZ\s*=\s*([0-9.E+-]+)/.exec(lines[i + 2])
    const rgm = /RG=\s*([0-9.E+-]+)/.exec(lines[i + 3])
    const ltm = /LT=\s*([0-9.E+-]+)/.exec(lines[i + 3])
    const rrm = /RR=\s*([0-9.E+-]+)/.exec(lines[i + 3])
    if (xm && ym && zm && vxm && vym && vzm && rgm) {
      const vx = parseFloat(vxm[1])
      const vy = parseFloat(vym[1])
      const vz = parseFloat(vzm[1])
      out.push({
        tMs,
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
  let best = rows[0]
  let bestDt = isFinite(rows[0].tMs) ? Math.abs(rows[0].tMs - nowMs) : Infinity
  for (let i = 1; i < rows.length; i++) {
    if (!isFinite(rows[i].tMs)) continue
    const dt = Math.abs(rows[i].tMs - nowMs)
    if (dt < bestDt) { bestDt = dt; best = rows[i] }
  }
  return best
}

function dist3d(a, b) {
  if (!a || !b) return NaN
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function parseXmlAttrs(raw) {
  const out = {}
  if (!raw) return out
  const re = /([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(raw))) out[m[1]] = m[2]
  return out
}

function fmtDataRate(n) {
  const v = Number(n)
  if (!isFinite(v) || v <= 0) return ''
  if (v >= 1000000) {
    const mb = v / 1000000
    return (Math.abs(mb - Math.round(mb)) < 0.05 ? String(Math.round(mb)) : mb.toFixed(1)) + ' Mbps'
  }
  if (v >= 1000) {
    const kb = v / 1000
    return (Math.abs(kb - Math.round(kb)) < 0.05 ? String(Math.round(kb)) : kb.toFixed(1)) + ' kbps'
  }
  return Math.round(v) + ' bps'
}

function parseDsnRst(xml) {
  if (!xml || typeof xml !== 'string') return null
  const tokens = xml.split(/(?=<station[\s>]|<dish[\s>])/i)
  let stationName = ''
  let stationCode = ''
  let hit = null
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (/^<station[\s>]/i.test(tok)) {
      const sa = parseXmlAttrs((/^<station\b([^>]*)>/i.exec(tok) || [])[1] || '')
      stationCode = sa.name || stationCode
      stationName = sa.friendlyName || stationName
      continue
    }
    if (!/^<dish[\s>]/i.test(tok)) continue
    if (!/spacecraft="RST"|name="RST"/i.test(tok)) continue
    const da = parseXmlAttrs((/^<dish\b([^>]*)>/i.exec(tok) || [])[1] || '')
    const downs = []
    const downRe = /<downSignal\b([^>]*)>/gi
    let dm
    while ((dm = downRe.exec(tok))) downs.push(parseXmlAttrs(dm[1]))
    let down = null
    for (let d = 0; d < downs.length; d++) {
      if (String(downs[d].spacecraft || '').toUpperCase() !== DSN_NAME) continue
      if (!down || String(downs[d].active) === 'true') down = downs[d]
    }
    const dataRate = down ? Number(down.dataRate) : NaN
    const candidate = {
      tracking: !!(down && String(down.active) === 'true'),
      spacecraft: DSN_NAME,
      dish: da.name || '',
      station: stationName,
      stationCode,
      stationZh: STATION_ZH[stationName] || stationName,
      band: (down && down.band) || '',
      dataRate: isFinite(dataRate) ? dataRate : null,
      dataRateText: fmtDataRate(dataRate)
    }
    if (candidate.tracking || !hit) hit = candidate
  }
  return hit
}

function formatDsnLine(dsn) {
  if (!dsn || !dsn.dish || !dsn.tracking) return ''
  const loc = dsn.stationZh || dsn.station || ''
  const parts = ['DSN']
  if (loc) parts.push(loc)
  if (dsn.dish) parts.push(dsn.dish)
  let line = parts.join(' ')
  if (dsn.band) line += ' · ' + dsn.band + ' 波段跟踪中'
  else line += ' · 跟踪中'
  if (dsn.dataRateText) line += ' · ' + dsn.dataRateText
  return line
}

function l2ProgressPct(distEarthKm, distL2Km) {
  if (!isFinite(distEarthKm) || distEarthKm < 0) return 0
  if (!isFinite(distL2Km) || distL2Km < 0) return 0
  if (distL2Km < 80000) return 100
  const pct = Math.round(100 * distEarthKm / (distEarthKm + distL2Km))
  if (pct < 0) return 0
  if (pct > 99) return 99
  return pct
}

function horizonsQuery(cmd, startCal, stopCal) {
  const target = new URL(HORIZONS_URL)
  target.searchParams.set('format', 'json')
  target.searchParams.set('COMMAND', "'" + cmd + "'")
  target.searchParams.set('OBJ_DATA', 'NO')
  target.searchParams.set('MAKE_EPHEM', 'YES')
  target.searchParams.set('EPHEM_TYPE', 'VECTORS')
  target.searchParams.set('CENTER', "'500@399'")
  target.searchParams.set('START_TIME', "'" + startCal + "'")
  target.searchParams.set('STOP_TIME', "'" + stopCal + "'")
  target.searchParams.set('STEP_SIZE', "'1 min'")
  target.searchParams.set('QUANTITIES', "'1'")
  target.searchParams.set('OUT_UNITS', 'KM-S')
  return target.toString()
}

async function fetchJson(url, timeoutMs) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0 (compatible; SpaceXProxy/1.0; RomanTracker)'
    },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url)
  return res
}

export async function handleRomanTrackerRequest(request, env, corsHeaders) {
  const cache = caches.default
  const cacheKey = new Request(new URL(request.url).origin + '/roman-tracker', { method: 'GET' })
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  const KV = env && env.TLE_KV
  const now = Date.now()
  const startCal = fmtUtc(new Date(now - 3 * 60000))
  const stopCal = fmtUtc(new Date(now + 1 * 60000))

  try {
    const [romanRes, l2Res, dsnRes] = await Promise.all([
      fetchJson(horizonsQuery(ROMAN_CMD, startCal, stopCal), 18000),
      fetchJson(horizonsQuery(L2_CMD, startCal, stopCal), 18000).catch(() => null),
      fetch(DSN_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpaceXProxy/1.0; RomanDSN)' },
        signal: AbortSignal.timeout(12000)
      }).catch(() => null)
    ])

    const romanJson = await romanRes.json()
    if (romanJson && romanJson.error) throw new Error(String(romanJson.error).slice(0, 160))

    const roman = pickClosest(parseHorizonsVectors(romanJson.result || ''), now)
    if (!roman || !isFinite(roman.rgKm)) throw new Error('无法解析罗曼星历')

    let l2 = null
    if (l2Res) {
      try {
        const l2Json = await l2Res.json()
        if (l2Json && !l2Json.error) {
          l2 = pickClosest(parseHorizonsVectors(l2Json.result || ''), now)
        }
      } catch (_) {}
    }

    let dsn = null
    if (dsnRes && dsnRes.ok) {
      try { dsn = parseDsnRst(await dsnRes.text()) } catch (_) {}
    }

    const distL2Km = l2 && l2.pos && roman.pos ? dist3d(roman.pos, l2.pos) : NaN
    const tracking = !!(dsn && dsn.tracking)
    const snapshot = {
      ok: true,
      source: tracking ? 'horizons+dsn' : 'horizons',
      command: ROMAN_CMD,
      velocityKmh: Math.round(roman.speedKmS * 3600),
      distanceFromEarthKm: Math.round(roman.rgKm),
      distanceToL2Km: isFinite(distL2Km) ? Math.round(distL2Km) : null,
      lightDelaySec: roman.ltSec != null && isFinite(roman.ltSec) ? Number(roman.ltSec.toFixed(3)) : null,
      rangeRateKmS: roman.rrKmS != null && isFinite(roman.rrKmS) ? Number(roman.rrKmS.toFixed(6)) : null,
      progressPct: l2ProgressPct(roman.rgKm, distL2Km),
      posKm: roman.pos ? {
        x: Math.round(roman.pos.x),
        y: Math.round(roman.pos.y),
        z: Math.round(roman.pos.z)
      } : null,
      speedKmS: isFinite(roman.speedKmS) ? Number(roman.speedKmS.toFixed(6)) : null,
      dsn: dsn || null,
      dsnLine: formatDsnLine(dsn),
      updatedAtLabel: fmtUtcLabel(new Date(now))
    }

    const body = JSON.stringify(snapshot)
    const resp = new Response(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=' + CACHE_MAX_AGE + ', max-age=' + CACHE_MAX_AGE
      }
    })
    if (KV) await KV.put('roman-tracker-last', body, { expirationTtl: KV_TTL }).catch(() => {})
    await cache.put(cacheKey, resp.clone())
    return resp
  } catch (e) {
    if (KV) {
      const stale = await KV.get('roman-tracker-last')
      if (stale) {
        return new Response(stale, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'X-Roman-Stale': 'true'
          }
        })
      }
    }
    return new Response(JSON.stringify({
      ok: false,
      error: '罗曼追踪暂不可达：' + ((e && e.message) || e)
    }), {
      status: 502,
      headers: corsHeaders
    })
  }
}
