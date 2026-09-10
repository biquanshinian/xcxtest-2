/**
 * 飞船名展示回退：与云端 space-terms-i18n.translateSpacecraftName 同一套词典。
 * 优先云端 *Zh；图鉴与空间站停靠列表必须走这里，禁止各页各写一套。
 */
const { pickLocalized } = require('./locale.js')

const SPACECRAFT_ZH = {
  shenzhou: '神舟',
  tianzhou: '天舟',
  'chinese reusable space vehicle': '中国可重复使用航天器',
  'crew dragon 2': '载人龙飞船 2',
  'crew dragon': '载人龙飞船',
  'cargo dragon 2': '货运龙飞船 2',
  'cargo dragon': '货运龙飞船',
  'dragon 1': '龙飞船 1',
  dragon: '龙飞船',
  'starship v1': '星舰 V1',
  'starship v2': '星舰 V2',
  'starship v3': '星舰 V3',
  starship: '星舰',
  'tesla roadster': '特斯拉 Roadster',
  'cst-100 starliner': 'CST-100 星际客机',
  starliner: '星际客机',
  'dream chaser': '追梦者',
  'crew capsule 1': '新谢泼德乘员舱 1',
  'crew capsule 2.0': '新谢泼德乘员舱 2.0',
  'crew capsule 2': '新谢泼德乘员舱 2',
  orion: '猎户座',
  'apollo command/service module': '阿波罗指令/服务舱',
  'apollo command service module': '阿波罗指令/服务舱',
  'apollo lunar module': '阿波罗登月舱',
  gemini: '双子座',
  mercury: '水星号',
  'space shuttle': '航天飞机',
  'north american x-15': '北美 X-15',
  'x-37b': 'X-37B',
  soyuz: '联盟号',
  'soyuz ms': '联盟号 MS',
  'soyuz t': '联盟号 T',
  'soyuz tm': '联盟号 TM',
  'soyuz tma': '联盟号 TMA',
  'soyuz tma-m': '联盟号 TMA-M',
  'progress 7k-tg': '进步号 7K-TG',
  'progress-m': '进步号-M',
  'progress-m1': '进步号-M1',
  'progress-m (modified)': '进步号-M（改进型）',
  'progress-m modified': '进步号-M（改进型）',
  'progress-ms': '进步号-MS',
  'progress m-um': '进步号 M-UM',
  progress: '进步号',
  vostok: '东方号',
  voskhod: '上升号',
  buran: '暴风雪号',
  'automated transfer vehicle (atv)': '自动转移飞行器（ATV）',
  'automated transfer vehicle atv': '自动转移飞行器（ATV）',
  'automated transfer vehicle': '自动转移飞行器（ATV）',
  atv: '自动转移飞行器（ATV）',
  'h-ii transfer vehicle (htv)': 'H-II 转移飞行器（白鹳）',
  'h-ii transfer vehicle htv': 'H-II 转移飞行器（白鹳）',
  'h-ii transfer vehicle': 'H-II 转移飞行器（白鹳）',
  htv: 'H-II 转移飞行器（白鹳）',
  'htv-x': 'HTV-X（白鹳 X）',
  'cygnus enhanced': '增强型天鹅座',
  'cygnus standard': '标准型天鹅座',
  'cygnus upgraded': '升级型天鹅座',
  cygnus: '天鹅座',
  gaganyaan: '加甘扬号',
  'space rider': '太空骑士',
  spaceshiptwo: '太空船二号',
  'space ship two': '太空船二号'
}

const DRAGON_SHIP_ZH = {
  freedom: '自由号',
  endurance: '耐力号',
  resilience: '韧性号',
  endeavour: '奋进号',
  endeavor: '奋进号'
}

function normKey(s) {
  return String(s || '').trim().toLowerCase()
}

function lookupDict(dict, raw) {
  const key = normKey(raw)
  if (!key) return ''
  return dict[key] || ''
}

function softenKey(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[.,/()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function localizeDragonShipSuffix(suffix) {
  const key = normKey(suffix)
  if (DRAGON_SHIP_ZH[key]) return DRAGON_SHIP_ZH[key]
  const first = key.split(/\s+/)[0]
  return DRAGON_SHIP_ZH[first] || suffix
}

function translateSpacecraftName(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  if (/[\u4e00-\u9fff]/.test(raw) && !/[A-Za-z]{3,}/.test(raw)) return raw
  const direct = lookupDict(SPACECRAFT_ZH, raw)
  if (direct) return direct
  const soft = softenKey(raw)
  const softHit = lookupDict(SPACECRAFT_ZH, soft)
  if (softHit) return softHit
  const keys = Object.keys(SPACECRAFT_ZH).sort((a, b) => b.length - a.length)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k.length < 3) continue
    if (soft === k) return SPACECRAFT_ZH[k]
    if (soft.indexOf(k + ' ') !== 0 && soft.indexOf(k + '-') !== 0) continue
    const restSoft = soft.slice(k.length).replace(/^[\s-]+/, '').trim()
    if (!restSoft) return SPACECRAFT_ZH[k]
    const base = SPACECRAFT_ZH[k]
    if ((base === '神舟' || base === '天舟') && /^\d+$/.test(restSoft)) return base + restSoft + '号'
    if (base === '联盟号 MS' && /^\d+$/.test(restSoft)) return '联盟号 MS-' + restSoft
    if (base === '进步号-MS' && /^\d+$/.test(restSoft)) return '进步号-MS-' + restSoft
    if (base === '进步号') {
      const ms = restSoft.match(/^ms[-\s]*(\d+)/i)
      if (ms) return '进步号-MS-' + ms[1]
    }
    if (base === '载人龙飞船' || base === '货运龙飞船' || base === '龙飞船') {
      const ship = localizeDragonShipSuffix(restSoft)
      return ship ? base + ' ' + ship : base
    }
    if (base === '天鹅座') {
      const crs = raw.match(/CRS\s*NG[-\s]?(\d+)/i) || raw.match(/\bNG[-\s]?(\d+)/i)
      const memorial = raw.match(/\((.+)\)/)
      let out = '天鹅座'
      if (crs) out += ' CRS NG-' + crs[1]
      if (memorial) out += '（' + memorial[1].trim() + '）'
      return out
    }
    const re = new RegExp(
      '^' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s\\-]+') + '[\\s\\-]+(.+)$',
      'i'
    )
    const m = raw.match(re)
    const suffix = (m && m[1] ? String(m[1]).trim() : restSoft)
    return suffix ? base + ' ' + suffix : base
  }
  return ''
}

function resolveSpacecraftDisplayZh(name, cloudZh) {
  const fromCloud = pickLocalized(cloudZh, '')
  if (fromCloud) return fromCloud
  const mapped = translateSpacecraftName(name)
  return mapped && /[\u4e00-\u9fff]/.test(mapped) ? mapped : ''
}

module.exports = {
  translateSpacecraftName,
  resolveSpacecraftDisplayZh
}
