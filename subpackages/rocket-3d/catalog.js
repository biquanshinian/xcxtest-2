/**
 * 3D 展陈「选择型号」列表：只列出 media_assets 已启用的 GLB。
 * 纯数据，不碰 wx / three。
 */
var { SERIES_SLUG, resolveSlug, isValidRocket3dSlug } = require('../../utils/rocket-3d-slug.js')
var { specRank } = require('./exhibit.js')

var SLUG_META = {
  'falcon-9': { title: '猎鹰 9 号', nameEn: 'Falcon 9', subtitle: 'SpaceX' },
  'falcon-heavy': { title: '猎鹰重型', nameEn: 'Falcon Heavy', subtitle: 'SpaceX' },
  starship: { title: '星舰', nameEn: 'Starship', subtitle: 'SpaceX' },
  electron: { title: 'Electron', nameEn: 'Electron', subtitle: 'Rocket Lab' },
  'new-shepard': { title: 'New Shepard', nameEn: 'New Shepard', subtitle: 'Blue Origin' },
  'new-glenn': { title: 'New Glenn', nameEn: 'New Glenn', subtitle: 'Blue Origin' },
  sls: { title: '太空发射系统', nameEn: 'SLS', subtitle: 'NASA' },
  vulcan: { title: 'Vulcan Centaur', nameEn: 'Vulcan', subtitle: 'ULA' },
  'zhuque-2e': { title: '朱雀二号改', nameEn: 'Zhuque-2E', subtitle: '蓝箭航天' },
  'zhuque-3': { title: '朱雀三号', nameEn: 'Zhuque-3', subtitle: '蓝箭航天' },
  'ceres-1': { title: '谷神星一号', nameEn: 'Ceres-1', subtitle: '星河动力' },
  'ceres-2': { title: '谷神星二号', nameEn: 'Ceres-2', subtitle: '星河动力' },
  'long-march-series': { title: '长征全系列', nameEn: 'Long March series', subtitle: '中国航天科技集团', series: true },
  'long-march-2c': { title: '长征二号丙', nameEn: 'Long March 2C', subtitle: '中国航天科技集团' },
  'long-march-2d': { title: '长征二号丁', nameEn: 'Long March 2D', subtitle: '中国航天科技集团' },
  'long-march-2f': { title: '长征二号 F', nameEn: 'Long March 2F', subtitle: '中国航天科技集团' },
  'long-march-3be': { title: '长征三号乙改', nameEn: 'Long March 3B/E', subtitle: '中国航天科技集团' },
  'long-march-4b': { title: '长征四号乙', nameEn: 'Long March 4B', subtitle: '中国航天科技集团' },
  'long-march-4c': { title: '长征四号丙', nameEn: 'Long March 4C', subtitle: '中国航天科技集团' },
  'long-march-5': { title: '长征五号', nameEn: 'Long March 5', subtitle: '中国航天科技集团' },
  'long-march-5b': { title: '长征五号 B', nameEn: 'Long March 5B', subtitle: '中国航天科技集团' },
  'long-march-6a': { title: '长征六号甲', nameEn: 'Long March 6A', subtitle: '中国航天科技集团' },
  'long-march-7a': { title: '长征七号甲', nameEn: 'Long March 7A', subtitle: '中国航天科技集团' },
  'long-march-8a': { title: '长征八号甲', nameEn: 'Long March 8A', subtitle: '中国航天科技集团' },
  'long-march-11': { title: '长征十一号', nameEn: 'Long March 11', subtitle: '中国航天科技集团' },
  'long-march-11h': { title: '长征十一号海', nameEn: 'Long March 11H', subtitle: '中国航天科技集团' },
  'long-march-12': { title: '长征十二号', nameEn: 'Long March 12', subtitle: '中国航天科技集团' },
  'long-march-12a': { title: '长征十二号甲', nameEn: 'Long March 12A', subtitle: '中国航天科技集团' },
  'long-march-12b': { title: '长征十二号乙', nameEn: 'Long March 12B', subtitle: '中国航天科技集团' },
  'gravity-1': { title: '引力一号', nameEn: 'Gravity-1', subtitle: '东方空间' },
  'kuaizhou-11': { title: '快舟十一号', nameEn: 'Kuaizhou-11', subtitle: '中国航天科工' },
  'kinetica-1': { title: '力箭一号', nameEn: 'Kinetica-1', subtitle: '中科宇航' },
  'hyperbola-1': { title: '双曲线一号', nameEn: 'Hyperbola-1', subtitle: '星际荣耀' },
  'jielong-3': { title: '捷龙三号', nameEn: 'Jielong-3', subtitle: '中国火箭' },
  'vega-c': { title: 'Vega C', nameEn: 'Vega C', subtitle: 'Arianespace' },
  'ariane-6': { title: 'Ariane 6', nameEn: 'Ariane 6', subtitle: 'Arianespace' },
  'soyuz-2': { title: '联盟-2', nameEn: 'Soyuz-2', subtitle: 'Roscosmos' },
  'soyuz-5': { title: '联盟-5', nameEn: 'Soyuz-5', subtitle: 'Roscosmos' }
}

function firstText(list) {
  for (var i = 0; i < list.length; i++) {
    var s = String(list[i] || '').trim()
    if (s) return s
  }
  return ''
}

function humanizeSlug(slug) {
  var key = String(slug || '').toLowerCase()
  if (!key) return ''
  if (key === SERIES_SLUG) return '长征全系列'
  return key.split('-').map(function (part) {
    if (!part) return ''
    if (/^\d+[a-z]*$/.test(part)) return part.toUpperCase()
    return part.charAt(0).toUpperCase() + part.slice(1)
  }).join(' ')
}

function listReadySlugs(ready) {
  var keys = []
  if (Array.isArray(ready)) keys = ready
  else if (ready && typeof ready === 'object') keys = Object.keys(ready)
  var out = []
  var seen = {}
  for (var i = 0; i < keys.length; i++) {
    var slug = String(keys[i] || '').toLowerCase()
    if (!isValidRocket3dSlug(slug) || seen[slug]) continue
    seen[slug] = true
    out.push(slug)
  }
  return out
}

function resolveConfigSlug(cfg) {
  if (!cfg || typeof cfg !== 'object') return ''
  return (
    resolveSlug(cfg.full_name) ||
    resolveSlug(cfg.name) ||
    resolveSlug(cfg.alias) ||
    resolveSlug(cfg.full_nameZh) ||
    resolveSlug(cfg.nameZh)
  )
}

function indexConfigsBySlug(configs) {
  var map = {}
  var src = configs && typeof configs === 'object' ? configs : {}
  var ids = Object.keys(src)
  for (var i = 0; i < ids.length; i++) {
    var cfg = src[ids[i]]
    var slug = resolveConfigSlug(cfg)
    if (!slug) continue
    var prev = map[slug]
    if (!prev || specRank(cfg) > specRank(prev)) map[slug] = cfg
  }
  return map
}

function buildModelCatalog(ready, configs) {
  var slugs = listReadySlugs(ready)
  var bySlug = indexConfigsBySlug(configs)
  var items = slugs.map(function (slug) {
    var meta = SLUG_META[slug] || {}
    var cfg = bySlug[slug]
    var series = slug === SERIES_SLUG || !!meta.series
    var title = series
      ? firstText([meta.title, humanizeSlug(slug), '长征全系列'])
      : firstText([
        cfg && cfg.full_nameZh,
        cfg && cfg.nameZh,
        meta.title,
        cfg && cfg.full_name,
        cfg && cfg.name,
        humanizeSlug(slug)
      ])
    var nameEn = series
      ? firstText([meta.nameEn, humanizeSlug(slug)])
      : firstText([
        cfg && cfg.full_name,
        cfg && cfg.name,
        meta.nameEn,
        humanizeSlug(slug)
      ])
    var subtitle = series
      ? firstText([meta.subtitle, '中国航天科技集团'])
      : firstText([
        cfg && cfg.manufacturerNameZh,
        cfg && cfg.manufacturerName,
        meta.subtitle
      ])
    return {
      slug: slug,
      title: title,
      nameEn: nameEn,
      subtitle: subtitle,
      configId: cfg && cfg.id != null ? String(cfg.id) : '',
      series: series,
      status: series ? '全系列' : subtitle
    }
  })
  items.sort(function (a, b) {
    if (a.series !== b.series) return a.series ? 1 : -1
    return String(a.title).localeCompare(String(b.title), 'zh')
  })
  return items
}

function pickCatalogItem(items, slug, rocketName, rocketNameEn) {
  var list = Array.isArray(items) ? items : []
  var key = String(slug || '').toLowerCase()
  var i
  if (key) {
    for (i = 0; i < list.length; i++) {
      if (list[i].slug === key) return list[i]
    }
  }
  var resolved = resolveSlug(rocketNameEn) || resolveSlug(rocketName)
  if (resolved) {
    for (i = 0; i < list.length; i++) {
      if (list[i].slug === resolved) return list[i]
    }
  }
  return null
}

/** 导航栏只跟当前正在展的 GLB slug，不对档案名、不回落到目录第一项 */
function navFromDisplayedSlug(slug, items) {
  var key = String(slug || '').toLowerCase()
  var meta = SLUG_META[key] || {}
  var picked = pickCatalogItem(items, key)
  var series = key === SERIES_SLUG || !!(picked && picked.series) || !!meta.series
  var title = series
    ? firstText([meta.title, picked && picked.title, '长征全系列'])
    : firstText([picked && picked.title, meta.title, humanizeSlug(key)])
  var subtitle = series
    ? firstText([meta.subtitle, picked && picked.subtitle, '中国航天科技集团'])
    : firstText([picked && picked.subtitle, meta.subtitle])
  return {
    pickerTitle: title || '3D 展陈',
    pickerSub: subtitle,
    navTitle: title || '3D 展陈',
    currentSlug: key
  }
}

module.exports = {
  SLUG_META,
  humanizeSlug,
  listReadySlugs,
  buildModelCatalog,
  pickCatalogItem,
  navFromDisplayedSlug
}
