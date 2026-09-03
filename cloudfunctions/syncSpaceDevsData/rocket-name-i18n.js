/**
 * 火箭名中英显示（主包列表卡 / 倒计时共用）
 * 中文模式：词典命中或长征通用转写；英文模式由调用方直接用 LL2 原名。
 * 副本：与 utils/rocket-name-i18n.js 保持同步（云函数不可跨包 require 主包）。
 */

const CZ_NUM_ZH = {
  1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六',
  7: '七', 8: '八', 9: '九', 10: '十', 11: '十一', 12: '十二'
}

const CZ_LETTER_ZH = { a: '甲', b: '乙', c: '丙', d: '丁' }

const CZ_SPECIAL = {
  cz2f: '长征二号F',
  cz2fg: '长征二号F',
  cz3be: '长征三号乙改',
  cz5b: '长征五号B',
  cz6a: '长征六号改',
  cz7a: '长征七号改',
  cz8a: '长征八号甲',
  cz11h: '长征十一号海射型',
  cz12a: '长征十二号甲'
}

/** 非长征常见型号（键为 normKey） */
const EXACT_ZH = {
  // SpaceX
  falcon9: '猎鹰9号',
  falcon9block5: '猎鹰9号',
  falconheavy: '猎鹰重型',
  starship: '星舰',
  superheavy: '超重型助推器',
  // 商业/国际
  electron: '电子号',
  neutron: '中子号',
  newglenn: '新格伦',
  newshepard: '新谢泼德',
  ariane5: '阿丽亚娜5',
  ariane6: '阿丽亚娜6',
  vegac: '织女星-C',
  atlasv: '阿特拉斯5',
  vulcancentaur: '火神半人马',
  vulcan: '火神',
  deltaivheavy: '德尔塔4重型',
  antares: '安塔瑞斯',
  angara12: '安加拉1.2',
  angaraa5: '安加拉A5',
  soyuz21a: '联盟-2.1a',
  soyuz21b: '联盟-2.1b',
  h3: 'H3',
  h2a: 'H-IIA',
  pslv: '极地卫星运载火箭',
  gslv: '地球同步卫星运载火箭',
  // 中国民营 / 型号
  zhuque2: '朱雀二号', zq2: '朱雀二号',
  zhuque2e: '朱雀二号改', zq2e: '朱雀二号改',
  zhuque3: '朱雀三号', zq3: '朱雀三号',
  ceres1: '谷神星一号', ceres1s: '谷神星一号海射型',
  gravity1: '引力一号', gravity2: '引力二号',
  kuaizhou1a: '快舟一号甲', kz1a: '快舟一号甲',
  kuaizhou11: '快舟十一号', kz11: '快舟十一号',
  jielong3: '捷龙三号', smartdragon3: '捷龙三号',
  jielong1: '捷龙一号', smartdragon1: '捷龙一号',
  kinetica1: '力箭一号', lijian1: '力箭一号',
  kinetica2: '力箭二号', lijian2: '力箭二号',
  hyperbola1: '双曲线一号',
  tianlong2: '天龙二号', tianlong3: '天龙三号',
  nebula1: '星云一号',
  pallas1: '智神星一号'
}

function normKey(name) {
  return String(name || '').toLowerCase().replace(/[·・.\/_\-\s]+/g, '')
}

function parseCzKey(key) {
  const m = String(key || '').match(/^(?:longmarch|changzheng|cz)(\d{1,2})([a-z]{0,2})$/)
  if (!m) return null
  return { num: Number(m[1]), letters: m[2] || '' }
}

/**
 * 火箭英文/原文名 → 中文显示名；已含中文或无法识别时原样返回。
 */
function translateRocketName(name) {
  let raw = String(name || '').trim()
  if (!raw) return ''
  // 机翻误译：Zhuque → 麻雀（须先纠偏，否则会原样返回）
  if (raw.indexOf('麻雀') >= 0) {
    raw = raw
      .replace(/麻雀\s*二\s*号?\s*[改eE]/g, '朱雀二号改')
      .replace(/麻雀\s*[-–]?\s*(\d+)\s*([eE])\b/g, (_, n, e) => {
        const num = CZ_NUM_ZH[Number(n)] || n
        return '朱雀' + num + '号' + (String(e).toLowerCase() === 'e' ? '改' : '')
      })
      .replace(/麻雀\s*[-–]?\s*(\d+)号?(?=\s|[|｜]|$|[^\d号])/g, (_, n) => '朱雀' + (CZ_NUM_ZH[Number(n)] || n) + '号')
      .replace(/麻雀\s*([一二三四五六七八九十]+)\s*号/g, '朱雀$1号')
  }
  if (/[\u4e00-\u9fff]/.test(raw)) return raw

  const key = normKey(raw)
  if (!key) return raw

  if (EXACT_ZH[key]) return EXACT_ZH[key]

  // Falcon 9 Block 5 等带后缀
  if (/^falcon9/.test(key)) return '猎鹰9号'
  if (/^falconheavy/.test(key)) return '猎鹰重型'
  if (/^starship/.test(key)) return '星舰'
  if (/^angara12/.test(key)) return '安加拉1.2'
  if (/^angara/.test(key)) return '安加拉'
  if (/^soyuz/.test(key)) return '联盟号'
  if (/^ariane6/.test(key)) return '阿丽亚娜6'
  if (/^ariane5/.test(key)) return '阿丽亚娜5'
  if (/^vulcan/.test(key)) return '火神'
  if (/^atlasv/.test(key)) return '阿特拉斯5'
  if (/^newglenn/.test(key)) return '新格伦'
  if (/^electron/.test(key)) return '电子号'
  if (/^neutron/.test(key)) return '中子号'

  const cz = parseCzKey(key)
  if (cz) {
    const code = 'cz' + cz.num + cz.letters
    if (CZ_SPECIAL[code]) return CZ_SPECIAL[code]
    const numZh = CZ_NUM_ZH[cz.num] || String(cz.num)
    let suffix = ''
    for (let i = 0; i < cz.letters.length; i++) {
      const ch = cz.letters[i]
      suffix += CZ_LETTER_ZH[ch] || ch.toUpperCase()
    }
    return '长征' + numZh + '号' + suffix
  }

  if (EXACT_ZH[key]) return EXACT_ZH[key]
  return raw
}

/**
 * 将标题里的火箭英文名替换为中文（如 "Falcon Heavy | Roman…" → "猎鹰重型 | Roman…"）
 */
function localizeRocketInTitle(title, rocketNameEn, rocketNameZh) {
  const raw = String(title || '').trim()
  if (!raw) return ''
  if (/[\u4e00-\u9fff]/.test(raw)) return raw
  const en = String(rocketNameEn || '').trim()
  const zh = String(rocketNameZh || '').trim()
  if (!en || !zh || en === zh) return raw
  if (raw.indexOf(en) >= 0) return raw.split(en).join(zh)
  // 尝试配置短名（去掉 Block 5 等）
  const shortEn = en.replace(/\s*Block\s*\d+/i, '').trim()
  if (shortEn && shortEn !== en && raw.indexOf(shortEn) >= 0) {
    return raw.split(shortEn).join(zh)
  }
  return raw
}

module.exports = {
  translateRocketName,
  localizeRocketInTitle
}
