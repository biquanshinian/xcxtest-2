/**
 * 全球发射商图鉴共享数据层
 * 供监控页预览板块与 monitor-pages/agency-list 完整列表页共用：
 * 全量拉取（聚合缓存 + 分页补全）、行格式化、筛选/搜索排序、模块级内存缓存。
 */
const { getAgencies } = require('../../../utils/api-monitor-data.js')
const { resolveAgencyLogoForDisplay } = require('../../../utils/agency-logo-cache.js')
const { resolveAgencyLogoBgTone } = require('../../../utils/agency-logo-bg.js')
const { overrideAgencyLogoUrl } = require('../../../utils/agency-logo-overrides.js')
const { translateAgencyName } = require('../../../utils/space-terms-i18n.js')
const { buildLl2ImageChain } = require('../../../utils/ll2-image.js')

const CACHE_TTL_MS = 10 * 60 * 1000
// v3: SpaceX logo 全局统一覆盖 + totalLaunchCount 排序，升版本让旧持久缓存失效
// v4: 补全 CHNR/AP-MCSTA/PLA/TiSPACE 等图鉴显示名汉化
const AGENCY_PERSIST_KEY = '_agency_list_persist_v4'
const AGENCY_PERSIST_TTL_MS = 24 * 60 * 60 * 1000

const TYPE_ZH = {
  Government: '政府',
  Commercial: '商业',
  Multinational: '跨国',
  Educational: '教育',
  Private: '私营',
  'Non-Profit': '非营利',
  Nonprofit: '非营利',
  Military: '军方',
  'Space Agency': '航天机构'
}

/** 机构类型英文 → 中文 */
function translateAgencyType(typeName) {
  const raw = String(typeName || '').trim()
  if (!raw) return '未知'
  if (/[\u4e00-\u9fff]/.test(raw)) return raw
  return TYPE_ZH[raw] || TYPE_ZH[raw.replace(/\b\w/g, (c) => c.toUpperCase())] || raw
}

/** 国家/地区英文名 → 中文（LL2 country.name） */
function translateCountryName(countryName) {
  const raw = String(countryName || '').trim()
  if (!raw) return ''
  if (/[\u4e00-\u9fff]/.test(raw)) return raw
  return COUNTRY_ZH[raw] || raw
}

/** 负责人字段：常见职务头衔汉化，人名保留原文 */
function translateAdministrator(raw) {
  let s = String(raw || '').trim()
  if (!s) return ''
  if (/[\u4e00-\u9fff]/.test(s) && !/[A-Za-z]{3,}/.test(s)) return s
  const pairs = [
    [/Chief Executive Officer/gi, '首席执行官'],
    [/Executive Director/gi, '执行董事'],
    [/Director General/gi, '总干事'],
    [/Acting\s+/gi, '代理'],
    [/Administrator/gi, '局长'],
    [/Chairwoman/gi, '主席'],
    [/Chairman/gi, '主席'],
    [/President/gi, '总裁'],
    [/Co-?Founder/gi, '联合创始人'],
    [/Founder/gi, '创始人'],
    [/\bCEO\b/g, '首席执行官'],
    [/\bCTO\b/g, '首席技术官'],
    [/\bCOO\b/g, '首席运营官'],
    [/Director/gi, '主任']
  ]
  for (let i = 0; i < pairs.length; i++) {
    s = s.replace(pairs[i][0], pairs[i][1])
  }
  return s
}

/** 社交媒体平台名汉化（品牌名保留常见中文习惯） */
function translateSocialMediaName(name) {
  const raw = String(name || '').trim()
  if (!raw) return '社交媒体'
  const key = raw.toLowerCase()
  const map = {
    twitter: '推特',
    'twitter / x': 'X（推特）',
    x: 'X',
    youtube: 'YouTube',
    facebook: '脸书',
    instagram: 'Instagram',
    linkedin: '领英',
    wikipedia: '维基百科',
    wiki: '维基百科',
    website: '官方网站',
    'official website': '官方网站',
    homepage: '官方网站',
    github: 'GitHub',
    reddit: 'Reddit',
    discord: 'Discord',
    telegram: 'Telegram',
    weibo: '微博',
    wechat: '微信',
    bilibili: '哔哩哔哩'
  }
  return map[key] || raw
}

const SOCIAL_ICON_BASE = '/subpackages/monitor-pages/images/icons/social/'
const SOCIAL_ICON_MAP = {
  x: SOCIAL_ICON_BASE + 'ic-social-x.svg',
  youtube: SOCIAL_ICON_BASE + 'ic-social-youtube.svg',
  facebook: SOCIAL_ICON_BASE + 'ic-social-facebook.svg',
  instagram: SOCIAL_ICON_BASE + 'ic-social-instagram.svg',
  linkedin: SOCIAL_ICON_BASE + 'ic-social-linkedin.svg',
  wikipedia: SOCIAL_ICON_BASE + 'ic-social-wikipedia.svg',
  website: SOCIAL_ICON_BASE + 'ic-social-website.svg',
  github: SOCIAL_ICON_BASE + 'ic-social-github.svg',
  reddit: SOCIAL_ICON_BASE + 'ic-social-reddit.svg',
  discord: SOCIAL_ICON_BASE + 'ic-social-discord.svg',
  telegram: SOCIAL_ICON_BASE + 'ic-social-telegram.svg',
  weibo: SOCIAL_ICON_BASE + 'ic-social-weibo.svg',
  wechat: SOCIAL_ICON_BASE + 'ic-social-wechat.svg',
  bilibili: SOCIAL_ICON_BASE + 'ic-social-bilibili.svg',
  link: SOCIAL_ICON_BASE + 'ic-social-link.svg'
}

/**
 * 根据平台名 / URL 识别社交媒体 key，并返回本地 logo
 * @returns {{ key: string, name: string, icon: string }}
 */
function resolveSocialLinkMeta(name, url) {
  const n = String(name || '').trim().toLowerCase()
  const u = String(url || '').trim().toLowerCase()
  const blob = n + ' ' + u
  let key = 'link'
  if (n === 'x' || n === 'twitter' || /twitter|推特/.test(blob) ||
      /(?:^|\/\/)(?:www\.)?(?:x|twitter)\.com\b/.test(u) || /\bt\.co\b/.test(u)) {
    key = 'x'
  } else if (/youtube\.com|youtu\.be|youtube|油管/.test(blob)) key = 'youtube'
  else if (/facebook\.com|fb\.com|脸书|facebook/.test(blob)) key = 'facebook'
  else if (/instagram\.com|instagram/.test(blob)) key = 'instagram'
  else if (/linkedin\.com|领英|linkedin/.test(blob)) key = 'linkedin'
  else if (/wikipedia\.org|维基|wikipedia|\bwiki\b/.test(blob)) key = 'wikipedia'
  else if (/github\.com|github/.test(blob)) key = 'github'
  else if (/reddit\.com|reddit/.test(blob)) key = 'reddit'
  else if (/discord\.com|discord\.gg|discord/.test(blob)) key = 'discord'
  else if (/t\.me\b|telegram\.me|telegram/.test(blob)) key = 'telegram'
  else if (/weibo\.com|微博|weibo/.test(blob)) key = 'weibo'
  else if (/weixin\.qq|wechat\.com|微信|wechat/.test(blob)) key = 'wechat'
  else if (/bilibili\.com|b23\.tv|哔哩|bilibili/.test(blob)) key = 'bilibili'
  else if (/官网|官方网站|website|homepage|official/.test(n)) key = 'website'

  const LABELS = {
    x: 'X', youtube: 'YouTube', facebook: '脸书', instagram: 'Instagram', linkedin: '领英',
    wikipedia: '维基百科', website: '官方网站', github: 'GitHub', reddit: 'Reddit',
    discord: 'Discord', telegram: 'Telegram', weibo: '微博', wechat: '微信',
    bilibili: '哔哩哔哩', link: '链接'
  }
  return {
    key,
    name: translateSocialMediaName(name) || LABELS[key] || '链接',
    icon: SOCIAL_ICON_MAP[key] || SOCIAL_ICON_MAP.link
  }
}

/** 国家英文名 → 中文（LL2 country.name 口径），用于中文搜索与卡片展示 */
const COUNTRY_ZH = {
  'China': '中国',
  'United States of America': '美国',
  'Russia': '俄罗斯',
  'Japan': '日本',
  'India': '印度',
  'France': '法国',
  'Germany': '德国',
  'Italy': '意大利',
  'United Kingdom': '英国',
  'South Korea': '韩国',
  'North Korea': '朝鲜',
  'Iran': '伊朗',
  'Israel': '以色列',
  'Ukraine': '乌克兰',
  'Kazakhstan': '哈萨克斯坦',
  'New Zealand': '新西兰',
  'Australia': '澳大利亚',
  'Canada': '加拿大',
  'Brazil': '巴西',
  'Spain': '西班牙',
  'Argentina': '阿根廷',
  'Netherlands': '荷兰',
  'Sweden': '瑞典',
  'Switzerland': '瑞士',
  'Norway': '挪威',
  'Denmark': '丹麦',
  'Austria': '奥地利',
  'Belgium': '比利时',
  'Poland': '波兰',
  'Turkey': '土耳其',
  'Singapore': '新加坡',
  'Indonesia': '印度尼西亚',
  'Malaysia': '马来西亚',
  'Thailand': '泰国',
  'Vietnam': '越南',
  'Mexico': '墨西哥',
  'South Africa': '南非',
  'Egypt': '埃及',
  'United Arab Emirates': '阿联酋',
  'Saudi Arabia': '沙特阿拉伯',
  'Luxembourg': '卢森堡',
  'Portugal': '葡萄牙',
  'Scotland': '苏格兰',
  'Taiwan': '中国台湾'
}

/**
 * 知名机构中文别名（键为缩写或英文名，小写）；
 * 支持「蓝箭」「诺格」这类简称，多别名用 | 分隔
 */
const AGENCY_ZH_ALIASES = {
  'nasa': '美国国家航空航天局|美国宇航局',
  'spacex': '太空探索技术公司|马斯克',
  'spx': '太空探索技术公司|马斯克',
  'casc': '中国航天科技集团|长征火箭',
  'cnsa': '中国国家航天局',
  'casic': '中国航天科工集团',
  'calt': '中国运载火箭技术研究院',
  'sast': '上海航天技术研究院',
  'expace': '快舟火箭|航天科工火箭',
  'landspace': '蓝箭航天|蓝箭|朱雀火箭',
  'i-space': '星际荣耀',
  'ispace': '星际荣耀',
  'galactic energy': '星河动力|谷神星火箭',
  'space pioneer': '天兵科技|天龙火箭',
  'orienspace': '东方空间|引力火箭',
  'deep blue aerospace': '深蓝航天|星云火箭',
  'cas space': '中科宇航|力箭火箭',
  'chnr': '中国火箭公司|中国火箭|捷龙',
  'china rocket': '中国火箭公司|中国火箭|捷龙',
  'china rocket co. ltd.': '中国火箭公司|中国火箭|捷龙',
  'china rocket co ltd': '中国火箭公司|中国火箭|捷龙',
  'ap-mcsta': '亚太空间技术与应用多边合作组织|亚太空间合作',
  'apmcsta': '亚太空间技术与应用多边合作组织|亚太空间合作',
  'pla': '中国人民解放军|解放军',
  "people's liberation army": '中国人民解放军|解放军',
  'tispace': '台湾创新太空|创新太空',
  'taiwan innovative space': '台湾创新太空|创新太空',
  'tasa': '台湾太空中心|台湾太空署',
  'taiwan space agency': '台湾太空中心|台湾太空署',
  'nspo': '国家太空中心|台湾太空中心',
  'national space organization': '国家太空中心|台湾太空中心',
  'onespace': '零壹空间',
  'cgwic': '中国长城工业集团|长城工业',
  'esa': '欧洲航天局|欧空局',
  'rfsa': '俄罗斯国家航天集团|俄航天',
  'roscosmos': '俄罗斯国家航天集团|俄航天',
  'jaxa': '日本宇宙航空研究开发机构',
  'isro': '印度空间研究组织',
  'blue origin': '蓝色起源|贝索斯|新格伦',
  'bo': '蓝色起源|贝索斯|新格伦',
  'rocket lab': '火箭实验室|电子号火箭',
  'rl': '火箭实验室|电子号火箭',
  'ula': '联合发射联盟|火神火箭',
  'arianespace': '阿丽亚娜航天|阿里安火箭',
  'asa': '阿丽亚娜航天|阿里安火箭',
  'northrop grumman': '诺斯罗普·格鲁曼|诺格|安塔瑞斯',
  'ngis': '诺斯罗普·格鲁曼|诺格|安塔瑞斯',
  'firefly aerospace': '萤火虫航天',
  'firefly': '萤火虫航天',
  'relativity space': '相对论空间|人族火箭',
  'virgin galactic': '维珍银河',
  'virgin orbit': '维珍轨道',
  'sierra space': '塞拉空间|追梦者飞船',
  'axiom space': '公理太空',
  'kari': '韩国航空宇宙研究院',
  'boeing': '波音|星际客机',
  'lockheed martin': '洛克希德·马丁|洛马',
  'mhi': '三菱重工',
  'mitsubishi heavy industries': '三菱重工',
  'ils': '国际发射服务',
  'astra': '阿斯特拉',
  'stoke space': '斯托克航天',
  'abl': 'ABL 航天系统'
}

function getZhAliases(name, abbrev) {
  const byAbbrev = AGENCY_ZH_ALIASES[String(abbrev || '').trim().toLowerCase()]
  const byName = AGENCY_ZH_ALIASES[String(name || '').trim().toLowerCase()]
  const raw = byAbbrev || byName || ''
  return raw ? raw.split('|') : []
}

/** 国家 alpha_2_code → 旗帜 emoji */
function getCountryFlag(countries) {
  if (!countries || !countries.length) return ''
  const code = countries[0].alpha_2_code
  if (!code) return ''
  try {
    return String.fromCodePoint(
      ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
    )
  } catch (e) { return '' }
}

/** 单个 agency 原始数据 → 卡片展示行 */
function formatAgency(agency) {
  const name = agency.name || '未知'
  const abbrev = agency.abbrev || ''
  const countryName = agency.country && agency.country[0] ? agency.country[0].name : ''
  const description = agency.description || '暂无简介'
  const typeName = agency.type ? agency.type.name : '未知'
  const launchers = agency.launchers || ''
  const spacecraft = agency.spacecraft || ''
  // SpaceX logo 全局统一（与全球发射统计页同源），其它机构用 LL2 原始 logo
  const logoUrlRaw = overrideAgencyLogoUrl(agency, agency.logo ? (agency.logo.thumbnail_url || agency.logo.image_url) : '')
  const imageUrlRaw = agency.image ? (agency.image.thumbnail_url || agency.image.image_url) : ''
  const imageUrlFullRaw = agency.image ? (agency.image.image_url || agency.image.thumbnail_url) : ''
  const logoUrl = resolveAgencyLogoForDisplay(logoUrlRaw) || logoUrlRaw
  const imageUrl = resolveAgencyLogoForDisplay(imageUrlRaw) || imageUrlRaw
  // 卡片图链：代理大图 → 大图 → 代理 logo → logo（与详情头图同源，避免卡空白详有图）
  const imageChain = buildLl2ImageChain(imageUrl, imageUrlRaw, imageUrlFullRaw, logoUrl, logoUrlRaw)
  const displayImage = imageChain[0] || imageUrl || logoUrl
  const logoBgTone = logoUrlRaw ? resolveAgencyLogoBgTone(logoUrlRaw) : ''

  const foundingYear = agency.founding_year || null
  const countryZh = COUNTRY_ZH[countryName] || ''
  const zhAliases = getZhAliases(name, abbrev)
  // 词典优先；别名表首项作兜底（如搜索别名已有中文而主词典漏配）
  const nameZh =
    translateAgencyName(name, abbrev) ||
    (zhAliases[0] && /[\u4e00-\u9fff]/.test(zhAliases[0]) ? zhAliases[0] : '') ||
    ''
  // 有中文则用中文；勿优先 abbrev（否则 China Rocket 未命中时卡片只显示 CHNR）
  const displayName = nameZh || name || abbrev || '未知机构'
  return {
    id: agency.id,
    name,
    abbrev,
    displayName,
    metaLine: (countryZh || countryName || '未知地区') + (foundingYear ? ' · ' + foundingYear + ' 年成立' : ''),
    countryZh,
    typeName,
    typeZh: translateAgencyType(typeName),
    typeClass: (typeName || '').toLowerCase().replace(/\s+/g, '-'),
    countryFlag: getCountryFlag(agency.country),
    countryName,
    countryCode: agency.country && agency.country[0] ? agency.country[0].alpha_2_code : '',
    founding_year: agency.founding_year || null,
    logoUrl,
    imageUrl,
    // 保留未压缩原链：imageMogr2 / 代理失败时 binderror 可回退，避免卡片空白
    logoUrlRaw: logoUrlRaw || '',
    imageUrlRaw: imageUrlRaw || '',
    // 卡片图：优先机构大图（含 Worker 代理），缺失时用 logo
    displayImage,
    imageFallbacks: imageChain.slice(1),
    imageMode: (imageUrl || imageUrlRaw) ? 'aspectFill' : 'aspectFit',
    logoBgTone,
    description,
    featured: !!agency.featured,
    // 总发射次数（云端 detailed 同步提供；旧缓存无此字段时为 null，排序按 0 处理）
    totalLaunchCount: agency.total_launch_count != null ? agency.total_launch_count : null,
    // 仅 JS 层搜索用，setData 前会被剔除
    _zhAliases: zhAliases,
    _searchText: [
      name, abbrev, countryName, description,
      launchers, spacecraft,
      agency.parent || '', agency.administrator || ''
    ].join(' ').toLowerCase()
  }
}

/**
 * 拉取全量 agencies：先尝试聚合缓存（limit=400），实际不足时自动分页补全。
 * Space Devs API max limit=100，只有 syncAgencies 云函数写入的聚合缓存才有 400 条。
 */
async function fetchAllAgencies() {
  const byId = new Map()
  const addResults = (results) => {
    for (const a of (results || [])) {
      if (a == null || a.id == null) continue
      const id = String(a.id)
      if (!byId.has(id)) byId.set(id, a)
    }
  }

  // 双请求互为兜底：其一失败仍可展示另一份（如仅知名机构）
  const [dataFeatured, firstFull] = await Promise.all([
    getAgencies({ featured: true, limit: 50, offset: 0 }).catch(() => null),
    getAgencies({ featured: false, limit: 400, offset: 0 }).catch(() => null)
  ])
  addResults(dataFeatured && dataFeatured.results)
  addResults(firstFull && firstFull.results)
  if (byId.size === 0) throw new Error('agencies_unavailable')

  const firstCount = (firstFull && firstFull.results && firstFull.results.length) || 0
  const totalCount = (firstFull && typeof firstFull.count === 'number') ? firstFull.count : 0

  if (firstCount < totalCount) {
    let offset = firstCount
    const pageLimit = 100
    const maxOffset = Math.min(totalCount + 100, 2000)
    while (offset < maxOffset) {
      try {
        const page = await getAgencies({ featured: false, limit: pageLimit, offset })
        const chunk = (page && page.results) || []
        if (!chunk.length) break
        addResults(chunk)
        offset += chunk.length
        if (chunk.length < pageLimit || !page.next) break
      } catch (e) {
        break
      }
    }
  }

  const list = Array.from(byId.values()).map(formatAgency)
  list.sort(compareAgenciesByLaunchCount)

  return { list, totalCount: totalCount || list.length, partial: !firstFull }
}

/**
 * 全局统一排序：总发射次数多者在前（旧缓存缺字段按 0 处理），
 * 并列时知名机构优先，再按成立年份早者在前
 */
function compareAgenciesByLaunchCount(a, b) {
  const la = a.totalLaunchCount || 0
  const lb = b.totalLaunchCount || 0
  if (lb !== la) return lb - la
  if (a.featured !== b.featured) return a.featured ? -1 : 1
  return (a.founding_year || 9999) - (b.founding_year || 9999)
}

let _cache = null
let _inflight = null
/** featured 预览专属 inflight，避免监控页并行多入口重复打云 */
let _featuredInflight = null

/**
 * 轻量预览：监控页默认 2 张卡专用。
 * 只读 featured 聚合缓存（1 个云文档），不触发全量分页；
 * 若全量列表已有缓存（用户逛过完整列表页）则直接复用，零请求。
 * 并发去重：族谱/飞船/发射商三入口同时进时只发一轮请求。
 */
async function getFeaturedAgencies() {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return { list: _cache.list, totalCount: _cache.totalCount, partial: _cache.partial }
  }
  const persist = _readAgencyPersist()
  if (persist) {
    _cache = {
      list: persist.list,
      totalCount: persist.totalCount,
      partial: persist.partial,
      at: persist.at
    }
    return { list: persist.list, totalCount: persist.totalCount, partial: persist.partial }
  }
  if (_featuredInflight) return _featuredInflight
  _featuredInflight = Promise.all([
    getAgencies({ featured: true, limit: 50, offset: 0 }),
    getAgencies({ featured: false, limit: 1, offset: 0 }).catch(() => null)
  ]).then(function (pair) {
    const data = pair[0]
    const countProbe = pair[1]
    const list = ((data && data.results) || []).map(formatAgency)
    if (!list.length) {
      const stale = _readAgencyPersist(true)
      if (stale) {
        return { list: stale.list, totalCount: stale.totalCount, partial: true, stale: true }
      }
      throw new Error('agencies_unavailable')
    }
    list.sort(compareAgenciesByLaunchCount)
    let totalCount = 0
    if (countProbe && typeof countProbe.count === 'number' && countProbe.count > 0) {
      totalCount = countProbe.count
    } else if (data && typeof data.count === 'number' && data.count > 0) {
      totalCount = data.count
    } else {
      totalCount = list.length
    }
    const result = { list: list, totalCount: totalCount, partial: true, preview: true }
    // 预览结果写入内存缓存，供同屏其它入口复用（不全量 persist，避免覆盖完整列表）
    _cache = { list: list, totalCount: totalCount, partial: true, at: Date.now() }
    return result
  }).finally(function () {
    _featuredInflight = null
  })
  return _featuredInflight
}

function _readAgencyPersist(allowStale) {
  try {
    const hit = wx.getStorageSync(AGENCY_PERSIST_KEY)
    if (!hit || !hit.list || !hit.list.length || !hit.at) return null
    // allowStale：云端/网络全部失败时的最后兜底，宁可展示超过 24h 的旧列表也不白屏
    if (!allowStale && Date.now() - hit.at > AGENCY_PERSIST_TTL_MS) return null
    return hit
  } catch (e) {
    return null
  }
}

function _writeAgencyPersist(payload) {
  try {
    wx.setStorage({
      key: AGENCY_PERSIST_KEY,
      data: {
        list: payload.list,
        totalCount: payload.totalCount,
        partial: payload.partial,
        at: Date.now()
      },
      fail: function () {}
    })
  } catch (e) {}
}

/** 全量列表（模块级内存缓存 10 分钟，页面间共享；并发去重；冷启动读本地持久缓存） */
function getAllAgencies(options) {
  const opts = options || {}
  if (!opts.forceRefresh && _cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return Promise.resolve(_cache)
  }
  if (!opts.forceRefresh) {
    const persist = _readAgencyPersist()
    if (persist) {
      _cache = {
        list: persist.list,
        totalCount: persist.totalCount,
        partial: persist.partial,
        at: persist.at
      }
      // 持久缓存超过内存 TTL 时后台静默刷新，不阻塞首屏
      if (Date.now() - persist.at >= CACHE_TTL_MS && !_inflight) {
        fetchAllAgencies()
          .then(function (r) {
            _cache = { list: r.list, totalCount: r.totalCount, partial: r.partial, at: Date.now() }
            _writeAgencyPersist(_cache)
          })
          .catch(function () {})
      }
      return Promise.resolve(_cache)
    }
  }
  if (_inflight) return _inflight
  _inflight = fetchAllAgencies()
    .then((r) => {
      _cache = { list: r.list, totalCount: r.totalCount, partial: r.partial, at: Date.now() }
      _writeAgencyPersist(_cache)
      _inflight = null
      return _cache
    })
    .catch((e) => {
      _inflight = null
      // stale-if-error：拉取全挂时回退超龄持久缓存（旧列表也比「加载失败」强），
      // 下次进入页面仍会正常重试刷新
      const stale = _readAgencyPersist(true)
      if (stale) {
        return { list: stale.list, totalCount: stale.totalCount, partial: true, stale: true }
      }
      throw e
    })
  return _inflight
}

/**
 * 相关度打分（分值即排序依据，严格按分数降序）：
 * 中文别名 > 缩写 > 英文名 > 国家（中/英） > 描述等全文弱信号
 */
function getAgencyMatchScore(agency, query) {
  if (!query) return 0
  const name = (agency.name || '').toLowerCase()
  const abbrev = (agency.abbrev || '').toLowerCase()
  const countryName = (agency.countryName || '').toLowerCase()
  const countryZh = agency.countryZh || ''
  const zhAliases = agency._zhAliases || []
  const searchText = (agency._searchText || '').toLowerCase()

  let score = 0

  // 中文别名（如「蓝箭」→ LandSpace、「诺格」→ Northrop Grumman）
  let aliasScore = 0
  for (const alias of zhAliases) {
    if (alias === query) aliasScore = Math.max(aliasScore, 150)
    else if (alias.startsWith(query)) aliasScore = Math.max(aliasScore, 115)
    else if (alias.includes(query)) aliasScore = Math.max(aliasScore, 85)
  }
  score += aliasScore

  if (abbrev === query) score += 140
  else if (abbrev.startsWith(query)) score += 110
  else if (abbrev.includes(query)) score += 80

  if (name === query) score += 130
  else if (name.startsWith(query)) score += 100
  else if (name.includes(query)) score += 72

  // 国家：中文精确命中（如「中国」）优先于模糊包含
  if (countryZh && countryZh === query) score += 70
  else if (countryZh && countryZh.includes(query) && query.length >= 2) score += 42

  if (countryName === query) score += 68
  else if (countryName.startsWith(query)) score += 54
  else if (countryName.includes(query)) score += 36

  // 描述/火箭型号等全文命中降为弱信号，避免大量模糊笼统的结果混入前排
  if (score === 0 && searchText.includes(query)) score += 10

  return score
}

/**
 * 筛选 + 搜索排序（与原监控页逻辑一致）：
 * - featured 无关键词时只看知名，有关键词时在全部中检索（如「蓝箭」→ LandSpace 非 featured）
 * - 有关键词时按匹配分降序
 */
function filterAgencies(all, filter, keyword) {
  const list = all || []
  const query = String(keyword || '').trim().toLowerCase()
  let filtered = list

  if (filter === 'featured') {
    filtered = query ? list : list.filter(a => a.featured)
  } else if (filter === 'Government') {
    filtered = list.filter(a => a.typeName === 'Government')
  } else if (filter === 'Commercial') {
    filtered = list.filter(a => a.typeName === 'Commercial')
  }

  if (query) {
    filtered = filtered
      .map(a => ({ a, sc: getAgencyMatchScore(a, query) }))
      .filter(x => x.sc > 0)
      .sort((x, y) => {
        if (y.sc !== x.sc) return y.sc - x.sc
        return compareAgenciesByLaunchCount(x.a, y.a)
      })
      .map(x => x.a)
  }

  return filtered
}

/** setData 前剔除 JS 层搜索字段 */
function toDisplayRow(item) {
  const row = { ...item }
  delete row._searchText
  delete row._zhAliases
  return row
}

const AGENCY_FILTERS = [
  { id: 'featured', label: '知名' },
  { id: 'all', label: '全部' },
  { id: 'Government', label: '政府' },
  { id: 'Commercial', label: '商业' }
]

module.exports = {
  AGENCY_FILTERS,
  TYPE_ZH,
  COUNTRY_ZH,
  translateAgencyType,
  translateCountryName,
  translateAdministrator,
  translateSocialMediaName,
  resolveSocialLinkMeta,
  formatAgency,
  getAllAgencies,
  getFeaturedAgencies,
  filterAgencies,
  toDisplayRow
}
