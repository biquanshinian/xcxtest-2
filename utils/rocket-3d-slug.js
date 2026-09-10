/**
 * 火箭名 → 3D 模型 slug。主包工具，供详情门控与 rocket-3d 分包共用。
 * COS 约定：models/rockets/{slug}.glb
 */
const MODEL_PREFIX = 'models/rockets/'
const SERIES_SLUG = 'long-march-series'

function isLongMarchMemberSlug(slug) {
  const key = String(slug || '').toLowerCase()
  if (!key || key === SERIES_SLUG) return false
  return key === 'long-march' || key.indexOf('long-march-') === 0
}

function isLongMarchFamilyName(name) {
  const key = normalizeRocketKey(name)
  return /^long march/.test(key)
}

const SLUG_ALIASES = {
  'falcon 9': 'falcon-9',
  falcon9: 'falcon-9',
  'falcon 9 block 5': 'falcon-9',
  'falcon 9 block': 'falcon-9',
  f9: 'falcon-9',
  falcon: 'falcon-9',
  'falcon heavy': 'falcon-heavy',
  falconheavy: 'falcon-heavy',
  fh: 'falcon-heavy',
  starship: 'starship',
  'starship v3': 'starship',
  'starship v3 flight 12': 'starship',
  'super heavy': 'starship',
  superheavy: 'starship',
  'starship super heavy': 'starship',
  electron: 'electron',
  'new shepard': 'new-shepard',
  newshepard: 'new-shepard',
  'new glenn': 'new-glenn',
  sls: 'sls',
  'space launch system': 'sls',
  artemis: 'sls',
  vulcan: 'vulcan',
  'vulcan centaur': 'vulcan',
  'zhuque 2e': 'zhuque-2e',
  zhuque2e: 'zhuque-2e',
  'zhuque 3': 'zhuque-3',
  zhuque3: 'zhuque-3',
  'ceres 1': 'ceres-1',
  ceres1: 'ceres-1',
  'ceres 2': 'ceres-2',
  ceres2: 'ceres-2',
  'long march series': 'long-march-series',
  'long march family': 'long-march-series',
  'long march 2c': 'long-march-2c',
  'long march 2d': 'long-march-2d',
  'long march 2fg': 'long-march-2f',
  'long march 3be': 'long-march-3be',
  'long march 3b e': 'long-march-3be',
  'long march 4b': 'long-march-4b',
  'long march 4c': 'long-march-4c',
  'long march 5': 'long-march-5',
  'long march 5b': 'long-march-5b',
  'long march 6 a': 'long-march-6a',
  'long march 6a': 'long-march-6a',
  'long march 7 a': 'long-march-7a',
  'long march 7a': 'long-march-7a',
  'long march 8 a': 'long-march-8a',
  'long march 8a': 'long-march-8a',
  'long march 11': 'long-march-11',
  'long march 11h': 'long-march-11h',
  'long march 12': 'long-march-12',
  'long march 12a': 'long-march-12a',
  'long march 12b': 'long-march-12b',
  'cz 5': 'long-march-5',
  cz5: 'long-march-5',
  'cz 5b': 'long-march-5b',
  cz5b: 'long-march-5b',
  'cz 7a': 'long-march-7a',
  cz7a: 'long-march-7a',
  'cz 8a': 'long-march-8a',
  cz8a: 'long-march-8a',
  'gravity 1': 'gravity-1',
  gravity1: 'gravity-1',
  'kuaizhou 11': 'kuaizhou-11',
  'kinetica 1': 'kinetica-1',
  'hyperbola 1': 'hyperbola-1',
  'jielong 3': 'jielong-3',
  'smart dragon 3': 'jielong-3',
  'vega c': 'vega-c',
  vegac: 'vega-c',
  'ariane 6': 'ariane-6',
  'ariane 64': 'ariane-6',
  soyuz: 'soyuz-2',
  'soyuz 2 1': 'soyuz-2',
  'soyuz 2 1a': 'soyuz-2',
  'soyuz 2 1b': 'soyuz-2',
  'soyuz 5': 'soyuz-5'
}

const SUBSTRING_RULES = [
  [/falcon\s*heavy/, 'falcon-heavy'],
  [/falcon/, 'falcon-9'],
  [/starship/, 'starship'],
  [/super\s*heavy/, 'starship'],
  [/new\s*glenn/, 'new-glenn'],
  [/new\s*shepard/, 'new-shepard'],
  [/zhuque\s*3/, 'zhuque-3'],
  [/zhuque\s*2/, 'zhuque-2e'],
  [/long\s*march\s*series/, 'long-march-series'],
  [/long\s*march\s*5b/, 'long-march-5b'],
  [/long\s*march\s*5/, 'long-march-5'],
  [/long\s*march\s*7a/, 'long-march-7a'],
  [/long\s*march\s*8a/, 'long-march-8a'],
  [/long\s*march\s*6a/, 'long-march-6a'],
  [/long\s*march\s*12b/, 'long-march-12b'],
  [/long\s*march\s*12a/, 'long-march-12a'],
  [/long\s*march\s*12/, 'long-march-12'],
  [/long\s*march\s*11/, 'long-march-11'],
  [/long\s*march\s*4c/, 'long-march-4c'],
  [/long\s*march\s*4b/, 'long-march-4b'],
  [/long\s*march\s*3be/, 'long-march-3be'],
  [/long\s*march\s*2d/, 'long-march-2d'],
  [/long\s*march\s*2c/, 'long-march-2c'],
  [/\bsls\b|space launch system/, 'sls'],
  [/electron/, 'electron'],
  [/vulcan/, 'vulcan']
]

const CN_NUM = {
  十一: '11',
  十二: '12',
  一: '1',
  二: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
  十: '10'
}

function replaceCnDigits(input) {
  let t = String(input || '')
  const keys = Object.keys(CN_NUM).sort((a, b) => b.length - a.length)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    t = t.split(k).join(CN_NUM[k])
  }
  return t
}

function normalizeRocketKey(name) {
  let t = String(name || '').trim().toLowerCase()
  if (!t) return ''
  t = t.replace(/猎鹰重型/g, 'falcon heavy')
  t = t.replace(/猎鹰/g, 'falcon ')
  t = t.replace(/星舰/g, 'starship')
  t = t.replace(/超重助推/g, 'super heavy')
  t = t.replace(/朱雀/g, 'zhuque ')
  t = t.replace(/谷神星/g, 'ceres ')
  t = t.replace(/捷龙/g, 'jielong ')
  t = t.replace(/快舟/g, 'kuaizhou ')
  t = t.replace(/引力/g, 'gravity ')
  t = t.replace(/双曲线/g, 'hyperbola ')
  t = t.replace(/火箭全系列|全系列/g, 'series')
  t = t.replace(/[甲改]/g, 'a')
  t = t.replace(/乙/g, 'b')
  t = t.replace(/长五/g, 'long march 5')
  t = t.replace(/长征/g, 'long march ')
  t = replaceCnDigits(t)
  t = t.replace(/号/g, ' ')
  t = t.replace(/[._/\\-]+/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  // 五号乙 / 5 B → 5b，避免和长五串到同一 slug
  t = t.replace(/(\d)\s+([a-z])\b/g, '$1$2')
  return t
}

function resolveSlug(name) {
  const key = normalizeRocketKey(name)
  if (!key) return ''
  if (SLUG_ALIASES[key]) return SLUG_ALIASES[key]
  const compact = key.replace(/\s+/g, '')
  if (SLUG_ALIASES[compact]) return SLUG_ALIASES[compact]
  for (let i = 0; i < SUBSTRING_RULES.length; i++) {
    if (SUBSTRING_RULES[i][0].test(key)) return SUBSTRING_RULES[i][1]
  }
  const dashed = key.replace(/\s+/g, '-')
  if (isValidRocket3dSlug(dashed)) return dashed
  if (/^long march/.test(key)) {
    const rest = key.replace(/^long march\s*/, '').replace(/\s+/g, '-')
    const specific = ('long-march-' + rest).replace(/-+/g, '-').replace(/^-|-$/g, '')
    if (isValidRocket3dSlug(specific)) return specific
  }
  return ''
}

function parseRocket3dGlbKey(key) {
  const raw = String(key || '').replace(/\\/g, '/').split('?')[0]
  const m = /^models\/rockets\/([a-z0-9]+(?:-[a-z0-9]+)*)\.glb$/i.exec(raw)
  return m ? m[1].toLowerCase() : ''
}

function isValidRocket3dSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug || ''))
}

module.exports = {
  MODEL_PREFIX,
  SERIES_SLUG,
  SLUG_ALIASES,
  normalizeRocketKey,
  resolveSlug,
  parseRocket3dGlbKey,
  isValidRocket3dSlug,
  isLongMarchMemberSlug,
  isLongMarchFamilyName
}
