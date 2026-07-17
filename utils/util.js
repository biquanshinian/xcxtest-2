// utils/util.js
// 工具函数
const { resolveMediaUrl, findFuzzyRocketConfigUrl } = require('./image-config.js')
const { getCachedRocketConfig, appendRocketGifCgifCi } = require('./icon-cache.js')
const { toCdnUrl } = require('./cos-url.js')

/**
 * 格式化日期时间（自动处理时区）
 * @param {String|Date} date 日期（UTC时间字符串或Date对象）
 * @param {String} format 格式
 * @returns {String} 格式化后的日期字符串（本地时区）
 */
function formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
  if (!date || date === 'undefined' || date === 'null') {
    return '日期未知'
  }

  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) {
    return '无效日期'
  }

  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  const second = String(d.getSeconds()).padStart(2, '0')
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const weekday = weekdays[d.getDay()]

  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hour)
    .replace('mm', minute)
    .replace('ss', second)
    .replace('WW', weekday)
}

function getCountdown(targetTime) {
  const now = new Date().getTime()
  const target = targetTime instanceof Date ? targetTime.getTime() : new Date(targetTime).getTime()

  if (isNaN(target)) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      total: 0,
      isExpired: true
    }
  }

  const diff = target - now

  if (diff <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      total: 0,
      isExpired: true
    }
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((diff % (1000 * 60)) / 1000)

  return {
    days,
    hours,
    minutes,
    seconds,
    total: diff,
    isExpired: false
  }
}

function formatCountdown(countdown) {
  if (countdown.isExpired) {
    return '已过期'
  }
  return `${countdown.days}天 ${String(countdown.hours).padStart(2, '0')}:${String(countdown.minutes).padStart(2, '0')}:${String(countdown.seconds).padStart(2, '0')}`
}

const DEFAULT_ROCKET_IMAGE = '火箭配置图/default.jpg'

function resolveRocketHttpsToLocal(url) {
  const u = typeof url === 'string' ? url.trim() : ''
  if (!u) return u
  if (/^https?:\/\//i.test(u)) return getCachedRocketConfig(u)
  return u
}

function resolveRocketImagePath(mediaKey) {
  if (!mediaKey || typeof mediaKey !== 'string') {
    return resolveRocketHttpsToLocal(resolveMediaUrl(DEFAULT_ROCKET_IMAGE, ''))
  }

  if (/^https?:\/\//i.test(mediaKey) || mediaKey.startsWith('cloud://') || mediaKey.startsWith('wxfile://')) {
    if (/^https?:\/\//i.test(mediaKey)) return resolveRocketHttpsToLocal(mediaKey)
    return mediaKey
  }

  return resolveRocketHttpsToLocal(resolveMediaUrl(String(mediaKey).replace(/^\/+/, ''), ''))
}

function ensureLocalImage(url) {
  if (url == null || typeof url !== 'string') return resolveRocketImagePath(DEFAULT_ROCKET_IMAGE)
  const u = String(url).trim()
  if (!u) return resolveRocketImagePath(DEFAULT_ROCKET_IMAGE)
  if (/^https?:\/\//i.test(u)) return getCachedRocketConfig(u)
  if (/^cloud:\/\//i.test(u) || /^wxfile:\/\//i.test(u)) return u
  return resolveRocketImagePath(u)
}

/**
 * 火箭名 → COS「火箭配置图/」下文件名映射（fuzzy DB 兜底用）。
 * 优先级：DB media_assets fuzzy 命中（动态/GIF）→ 本字典拼 COS 直链 → 默认占位。
 * 注意：本字典仅用作 fallback，运营要换图/换 GIF 时只在后台后台改 media_assets 即可，
 *      DB 命中会优先生效，本字典的旧静态图不会遮蔽。
 */
const ROCKET_IMAGE_MAP = {
  'falcon 9': '火箭配置图/Falcon 9 Block 5.jpg',
  'falcon9': '火箭配置图/Falcon 9 Block 5.jpg',
  'falcon 9 block 5': '火箭配置图/Falcon 9 Block 5.jpg',
  'falcon 9 block': '火箭配置图/Falcon 9 Block 5.jpg',
  'falcon heavy': '火箭配置图/Falcon Heavy.jpg',
  'falconheavy': '火箭配置图/Falcon Heavy.jpg',
  'f9': '火箭配置图/Falcon 9 Block 5.jpg',
  'fh': '火箭配置图/Falcon Heavy.jpg',
  'electron': '火箭配置图/Electron.jpg',
  'new shepard': '火箭配置图/New-Shepard.jpg',
  'newshepard': '火箭配置图/New-Shepard.jpg',
  'soyuz 2.1': '火箭配置图/Soyuz_2.1b-Fregat-M.jpg',
  'soyuz 2.1a': '火箭配置图/Soyuz_2.1b-Fregat-M.jpg',
  'soyuz 2.1b': '火箭配置图/Soyuz_2.1b-Fregat-M.jpg',
  'soyuz-2.1': '火箭配置图/Soyuz_2.1b-Fregat-M.jpg',
  'soyuz-2.1a': '火箭配置图/Soyuz_2.1b-Fregat-M.jpg',
  'soyuz-2.1b': '火箭配置图/Soyuz_2.1b-Fregat-M.jpg',
  'soyuz 5': '火箭配置图/Soyuz 5.webp',
  'soyuz-5': '火箭配置图/Soyuz 5.webp',
  'soyuz': '火箭配置图/Soyuz_2.1b-Fregat-M.jpg',
  'sls': '火箭配置图/SLS_Block_1.jpg',
  'space launch system': '火箭配置图/SLS_Block_1.jpg',
  'artemis': '火箭配置图/SLS_Block_1.jpg',
  'vulcan': '火箭配置图/Vulcan VC4S.jpg',
  'vulcan centaur': '火箭配置图/Vulcan VC4S.jpg',
  'pslv': '火箭配置图/pslv_dl.jpg',
  'ceres-1s': '火箭配置图/Ceres-1S.jpg',
  'ceres-2': '火箭配置图/Ceres-2.jpg',
  'ceres 2': '火箭配置图/Ceres-2.jpg',
  'spectrum': '火箭配置图/Spectrum-Flight-1.jpg',
  'smart dragon 3': '火箭配置图/Jielong-3.jpg',
  'smartdragon 3': '火箭配置图/Jielong-3.jpg',
  'jielong-3': '火箭配置图/Jielong-3.jpg',
  'jielong 3': '火箭配置图/Jielong-3.jpg',
  'p1lvm-3': '火箭配置图/p1LVM-3 Mark-3.jpg',
  'p1lvm 3': '火箭配置图/p1LVM-3 Mark-3.jpg',
  'starship v3 flight 12': '火箭配置图/Starship V3 Flight 12.jpg',
  'starship v3': '火箭配置图/Starship V3 Flight 12.jpg',
  'starship': '火箭配置图/Starship V3 Flight 12.jpg',

  '8a': '火箭配置图/Long March 8A CZ-8A_SatNet_LEO-14.jpg',
  '8 a': '火箭配置图/Long March 8A CZ-8A_SatNet_LEO-14.jpg',
  '6a': '火箭配置图/Long-March-6A-CZ-6A_SatNet_LEO_Group_05.jpg',
  '6 a': '火箭配置图/Long-March-6A-CZ-6A_SatNet_LEO_Group_05.jpg',
  '7a': '火箭配置图/Long March 7A.jpg',
  '7 a': '火箭配置图/Long March 7A.jpg',
  '2c': '火箭配置图/LongMarch2C.jpg',
  '2 c': '火箭配置图/LongMarch2C.jpg',
  '3be': '火箭配置图/Long_March_3BE.jpg',
  '3 be': '火箭配置图/Long_March_3BE.jpg',
  '3b/e': '火箭配置图/Long_March_3BE.jpg',
  '3b e': '火箭配置图/Long_March_3BE.jpg',
  '4b': '火箭配置图/Long_March_4B_rocket.jpg',
  '4 b': '火箭配置图/Long_March_4B_rocket.jpg',
  '12a': '火箭配置图/CZ-12A Long March 12A.jpg',
  '12 a': '火箭配置图/CZ-12A Long March 12A.jpg',
  '12b': '火箭配置图/LongMarch12B.jpg',
  '12 b': '火箭配置图/LongMarch12B.jpg',
  'lm12': '火箭配置图/LM12.jpg',

  'kairos': '火箭配置图/KAIROS.jpg',
  'kslv-2': '火箭配置图/KSLV-2.jpg',
  'kslv 2': '火箭配置图/KSLV-2.jpg',
  'h3-30s': '火箭配置图/H3-30S.jpg',
  'h3 30s': '火箭配置图/H3-30S.jpg',
  'gslv mk ii': '火箭配置图/GSLV Mk II.jpg',
  'gslv mkii': '火箭配置图/GSLV Mk II.jpg',
  'gslv': '火箭配置图/GSLV Mk II.jpg',
  'alpha block 1': '火箭配置图/Alpha Block 1.jpg',
  'ariane 64': '火箭配置图/Ariane 64.jpg',
  'ariane 6': '火箭配置图/Ariane 64.jpg',

  'cz-7a': '火箭配置图/CZ-7A_YG-45.jpg',
  'cz7a': '火箭配置图/CZ-7A_YG-45.jpg',
  'cz 7a': '火箭配置图/CZ-7A_YG-45.jpg',
  'long march 11h': '火箭配置图/Long March 11H.jpg',
  'long march 2d': '火箭配置图/Long March 2D.jpg',
  'long march 2fg': '火箭配置图/Long March 2FG.jpg',
  'long march 4c': '火箭配置图/Long March 4C.jpg',
  'long march 5byz-2': '火箭配置图/Long March 5BYZ-2.jpg',
  'long march 5byz 2': '火箭配置图/Long March 5BYZ-2.jpg',
  'minotaur iv': '火箭配置图/Minotaur IV.jpg',
  'new glenn': '火箭配置图/New Glenn.jpg',
  'pegasus xl': '火箭配置图/Pegasus XL.jpg',
  'tianlong 2': '火箭配置图/Tianlong 2.jpg',
  'zhuque-2e': '火箭配置图/ZhuQue-2E.jpg',
  'zhuque 2e': '火箭配置图/ZhuQue-2E.jpg',
  'zhuque-2e block 2': '火箭配置图/ZhuQue-2E.jpg',
  'zhuque 2e block 2': '火箭配置图/ZhuQue-2E.jpg',
  'zhuque-3': '火箭配置图/ZhuQue-3.jpg',
  'zhuque 3': '火箭配置图/ZhuQue-3.jpg',
  'vega c': '火箭配置图/Vega C.jpg',
  'vega-c': '火箭配置图/Vega C.jpg',
  'vegac': '火箭配置图/Vega C.jpg',

  'proton m': '火箭配置图/Proton M DM 3.webp',
  'proton-m': '火箭配置图/Proton M DM 3.webp',
  'protonm': '火箭配置图/Proton M DM 3.webp',
  'proton m dm 3': '火箭配置图/Proton M DM 3.webp',
  'proton-m dm-3': '火箭配置图/Proton M DM 3.webp',
  'kuaizhou 11': '火箭配置图/Kuaizhou_11.webp',
  'kuaizhou-11': '火箭配置图/Kuaizhou_11.webp',
  'kinetica-1': '火箭配置图/Kinetica-1_Rocket.webp',
  'kinetica 1': '火箭配置图/Kinetica-1_Rocket.webp',
  'kz-1a': '火箭配置图/KZ-1A_VDES_A_B.webp',
  'kz 1a': '火箭配置图/KZ-1A_VDES_A_B.webp',
  'angara 1.2': '火箭配置图/Angara_1.2.webp',
  'angara-1.2': '火箭配置图/Angara_1.2.webp',
  'ceres-1': '火箭配置图/Ceres-1.webp',
  'ceres 1': '火箭配置图/Ceres-1.webp',
  'gravity1': '火箭配置图/Gravity1.webp',
  'gravity 1': '火箭配置图/Gravity1.webp',
  'shavit-2': '火箭配置图/Shavit-2.webp',
  'shavit 2': '火箭配置图/Shavit-2.webp',
  'eris flight 1': '火箭配置图/Eris Flight 1.webp',
  'hyperbola-1': '火箭配置图/Hyperbola-1.webp',
  'hyperbola 1': '火箭配置图/Hyperbola-1.webp',
  'h-iia 202': '火箭配置图/H-IIA_202_rocket.webp',
  'h iia 202': '火箭配置图/H-IIA_202_rocket.webp',
  'angara a5 brizm': '火箭配置图/Angara_A5_BrizM.webp',
  'angara a5': '火箭配置图/Angara_A5_BrizM.webp',

  // 全名别名（与上方型号短码同源）；勿再放裸「long march」→ 会把 10B 等未登记型号误配成 3BE
  'long march 3be': '火箭配置图/Long_March_3BE.jpg',
  'long march 3 be': '火箭配置图/Long_March_3BE.jpg',
  'long march 3b/e': '火箭配置图/Long_March_3BE.jpg',
  'long march 3b e': '火箭配置图/Long_March_3BE.jpg',
  'long march 4b': '火箭配置图/Long_March_4B_rocket.jpg',
  'long march 4 b': '火箭配置图/Long_March_4B_rocket.jpg',
  'long march 8a': '火箭配置图/Long March 8A CZ-8A_SatNet_LEO-14.jpg',
  'long march 6a': '火箭配置图/Long-March-6A-CZ-6A_SatNet_LEO_Group_05.jpg',
  'long march 7a': '火箭配置图/Long March 7A.jpg',
  'long march 2c': '火箭配置图/LongMarch2C.jpg',
  'long march 12a': '火箭配置图/CZ-12A Long March 12A.jpg',
  'long march 12b': '火箭配置图/LongMarch12B.jpg',

  'falcon': '火箭配置图/Falcon 9 Block 5.jpg',
  'smart dragon': '火箭配置图/Jielong-3.jpg',
  'smartdragon': '火箭配置图/Jielong-3.jpg',
  'jielong': '火箭配置图/Jielong-3.jpg'
}

/**
 * 兜底字典查找：按规范化后的火箭名做精确 + 子串匹配，命中即返回 COS 路径 key。
 * 仅在 DB media_assets fuzzy 未命中时使用。
 */
function lookupRocketImageKeyByName(rocketName) {
  if (!rocketName || typeof rocketName !== 'string') return ''
  // 与 fuzzy 匹配一致：统一分隔符，避免「3B/E」「Long_March_3BE」漏命中
  const name = rocketName
    .trim()
    .toLowerCase()
    .replace(/[._/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name) return ''

  if (ROCKET_IMAGE_MAP[name]) return ROCKET_IMAGE_MAP[name]

  if (name.includes('starship')) return '火箭配置图/Starship V3 Flight 12.jpg'
  if (name.includes('falcon heavy')) return '火箭配置图/Falcon Heavy.jpg'
  if (name.includes('falcon')) return '火箭配置图/Falcon 9 Block 5.jpg'
  if (name.includes('sls') || name.includes('space launch system')) return '火箭配置图/SLS_Block_1.jpg'
  if (name.includes('vulcan')) return '火箭配置图/Vulcan VC4S.jpg'
  if (name.includes('soyuz')) {
    if (name.includes('5')) return '火箭配置图/Soyuz 5.webp'
    return '火箭配置图/Soyuz_2.1b-Fregat-M.jpg'
  }
  if (name.includes('pslv')) return '火箭配置图/pslv_dl.jpg'
  if ((name.includes('smart dragon') || name.includes('smartdragon') || name.includes('jielong')) && name.includes('3')) {
    return '火箭配置图/Jielong-3.jpg'
  }

  // 「数字+字母」型号（如 8a / 6a / 12b）→ 取最长可命中的 key
  const modelRegex = /(\d+)\s*([a-z]+)/gi
  modelRegex.lastIndex = 0
  const candidates = []
  let m
  while ((m = modelRegex.exec(name)) !== null) {
    candidates.push(`${m[1]}${m[2]}`.toLowerCase())
    candidates.push(`${m[1]} ${m[2]}`.toLowerCase())
  }
  const uniq = [...new Set(candidates)].sort((a, b) => b.length - a.length)
  for (const k of uniq) {
    if (ROCKET_IMAGE_MAP[k]) return ROCKET_IMAGE_MAP[k]
  }

  // 已抽出具体型号（如 10b）但字典未登记 → 禁止再落到「falcon / jielong」等无数字家族泛 key
  const compactModels = uniq.filter((k) => !/\s/.test(k))
  const hasUnresolvedModel = compactModels.length > 0 &&
    !compactModels.some((k) => ROCKET_IMAGE_MAP[k])

  // 字典 key 子串扫描：型号优先（如 "8a"），其次按长度倒序，避免 "falcon" 抢走 "falcon heavy"
  const sortedKeys = Object.keys(ROCKET_IMAGE_MAP).sort((a, b) => {
    const isModel = (k) => /^\d+[a-z]+$/i.test(k) || /^\d+\s+[a-z]+$/i.test(k) || /^lm\d+/i.test(k)
    const aM = isModel(a), bM = isModel(b)
    if (aM && !bM) return -1
    if (!aM && bM) return 1
    return b.length - a.length
  })
  for (const key of sortedKeys) {
    if (!name.includes(key)) continue
    if (hasUnresolvedModel && !/\d/.test(key)) continue
    return ROCKET_IMAGE_MAP[key]
  }

  return ''
}

function getRocketImage(rocketName) {
  if (!rocketName || typeof rocketName !== 'string') {
    return resolveRocketImagePath(DEFAULT_ROCKET_IMAGE)
  }

  const rawRocketTrimmed = String(rocketName).trim()
  if (!rawRocketTrimmed) {
    return resolveRocketImagePath(DEFAULT_ROCKET_IMAGE)
  }

  // 1) 后台 media_assets 模糊匹配优先（动态/GIF 生效；getCachedRocketConfig 内会自动走本地缓存）
  const fuzzyCloud = findFuzzyRocketConfigUrl(rawRocketTrimmed)
  if (fuzzyCloud && String(fuzzyCloud).trim()) {
    return resolveRocketHttpsToLocal(String(fuzzyCloud).trim())
  }

  // 2) 字典 fallback：DB 未命中时，按字典 key 拼 COS 直链（仍受本地缓存保护）
  const fallbackKey = lookupRocketImageKeyByName(rawRocketTrimmed)
  if (fallbackKey) {
    return resolveRocketImagePath(fallbackKey)
  }

  // 3) 默认占位
  return resolveRocketImagePath(DEFAULT_ROCKET_IMAGE)
}

function rocketConfigurationDisplayName(rocketConfiguration) {
  if (!rocketConfiguration || typeof rocketConfiguration !== 'object') return ''
  const n = rocketConfiguration.name
  const fn = rocketConfiguration.full_name
  // 与 utils/api.js getRocketDisplayNameFromConfig 一致：优先短名 name，再 full_name
  if (typeof n === 'string' && n.trim()) return n.trim()
  if (typeof fn === 'string' && fn.trim()) return fn.trim()
  return ''
}

function isRemoteRocketSrc(u) {
  if (!u || typeof u !== 'string') return false
  const t = u.trim()
  if (!t) return false
  return /^https?:\/\//i.test(t) || t.startsWith('cloud://') || t.startsWith('wxfile://')
}

/** 是否为占位 default.jpg（含 COS 直链）；此类 stamped 允许被 fuzzy/字典结果覆盖 */
function isDefaultRocketSrc(u) {
  if (u == null || typeof u !== 'string') return true
  const s = u.trim()
  if (!s) return true
  if (/火箭配置图\/default\.jpg/i.test(s)) return true
  if (/\/default\.jpg(\?|#|$)/i.test(s)) return true
  return false
}

/**
 * 是否应用 next 覆盖 current。
 * 禁止「非 default → default」降级（media map 二次刷新偶发 miss 时会把已正确的图盖掉）。
 */
function shouldReplaceRocketImage(current, next) {
  if (!next || typeof next !== 'string' || !String(next).trim()) return false
  const cur = current == null ? '' : String(current).trim()
  const nxt = String(next).trim()
  if (!cur) return true
  if (cur === nxt) return false
  const strip = (u) => {
    const i = u.indexOf('?')
    return i >= 0 ? u.slice(0, i) : u
  }
  if (strip(cur) === strip(nxt)) return false
  // 已有正确图时，不允许被 default 覆盖
  if (!isDefaultRocketSrc(cur) && isDefaultRocketSrc(nxt)) return false
  return true
}

/** 将 API / 缓存中的火箭图字符串规范为可交给 <image> 的最终地址 */
function finalizeRocketDisplaySrc(candidate) {
  if (candidate == null || typeof candidate !== 'string') return ''
  const raw = candidate.trim()
  if (!raw) return ''
  if (isRemoteRocketSrc(raw)) {
    if (/^https?:\/\//i.test(raw)) {
      // default 占位图保持远程 URL 形态：换成 wxfile 本地路径会让
      // isDefaultRocketSrc 判断失效，导致占位图无法被真实火箭图升级覆盖
      if (isDefaultRocketSrc(raw)) return appendRocketGifCgifCi(toCdnUrl(raw.trim()))
      // 走火箭图缓存链：GIF 加 cgif 抽帧、静态图加 imageMogr2 压缩、命中本地 wxfile 直接复用，
      // 避免已盖章的远程原图绕过压缩直接交给 <image>
      return getCachedRocketConfig(raw.trim())
    }
    return raw
  }
  return resolveRocketImagePath(raw.replace(/^\/+/, ''))
}

/**
 * 列表/倒计时/详情共用：优先非 default 的已盖章远程图；default 可被 getRocketImage 升级。
 * forceRecompute=true 时优先按火箭名重算，但若重算结果是 default 而已有非 default 盖章，则保留盖章（防二次刷新降级）。
 */
function resolveMissionRocketImage(imagePath, rocketName, rocketConfiguration, forceRecompute) {
  const fromCfg = rocketConfigurationDisplayName(rocketConfiguration)
  const nameArg = rocketName && typeof rocketName === 'string' ? String(rocketName).trim() : ''
  const trimmedName = (nameArg || fromCfg).trim()

  const stampedRaw = finalizeRocketDisplaySrc(typeof imagePath === 'string' ? imagePath : '')
  const rebuilt = trimmedName ? finalizeRocketDisplaySrc(getRocketImage(trimmedName)) : ''

  const stampedRemote = isRemoteRocketSrc(stampedRaw)
  const rebuiltRemote = isRemoteRocketSrc(rebuilt)
  const stampedDefault = isDefaultRocketSrc(stampedRaw)
  const rebuiltDefault = isDefaultRocketSrc(rebuilt)

  if (forceRecompute) {
    // 强制重算：非 default 的新结果优先；否则保留已有非 default 盖章，禁止降级
    if (rebuilt && !rebuiltDefault) return rebuilt
    if (stampedRaw && !stampedDefault) return stampedRaw
    if (rebuilt) return rebuilt
    if (stampedRaw) return stampedRaw
    return finalizeRocketDisplaySrc(DEFAULT_ROCKET_IMAGE)
  }

  // 非 default 的已盖章远程图优先（避免二次 resolve 换一套 URL 导致灰块）
  if (stampedRemote && !stampedDefault) return stampedRaw
  // default / 空 stamped 允许被 fuzzy·字典结果升级
  if (rebuiltRemote && !rebuiltDefault) return rebuilt
  if (stampedRemote) return stampedRaw
  if (rebuiltRemote) return rebuilt
  if (stampedRaw && !stampedDefault) return stampedRaw
  if (rebuilt) return rebuilt
  if (stampedRaw) return stampedRaw

  if (trimmedName) {
    const fuzzy = getRocketImage(trimmedName)
    const fuzzyDone = finalizeRocketDisplaySrc(typeof fuzzy === 'string' ? fuzzy : '')
    if (fuzzyDone) return fuzzyDone
  }
  return finalizeRocketDisplaySrc(DEFAULT_ROCKET_IMAGE)
}

module.exports = {
  formatDate,
  getCountdown,
  formatCountdown,
  ensureLocalImage,
  getRocketImage,
  resolveMissionRocketImage,
  isDefaultRocketSrc,
  shouldReplaceRocketImage
}
