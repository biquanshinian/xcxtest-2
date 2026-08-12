/**
 * 火箭名中英显示（主包列表卡 / 倒计时共用）
 * 中文模式：词典命中或长征通用转写；英文模式由调用方直接用 LL2 原名。
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
  falcon1: '猎鹰1号',
  falcon9: '猎鹰9号',
  falcon9block5: '猎鹰9号 Block 5',
  falcon9block4: '猎鹰9号 Block 4',
  falcon9v10: '猎鹰9号 v1.0',
  falcon9v11: '猎鹰9号 v1.1',
  falcon9fullthrust: '猎鹰9号全推力版',
  falconheavy: '猎鹰重型',
  starship: '星舰',
  superheavy: '超重型助推器',
  // 商业/国际可回收或族谱常见
  electron: '电子号',
  neutron: '中子号',
  newglenn: '新格伦',
  newshepard: '新谢泼德',
  ariane5: '阿丽亚娜5',
  ariane5eca: '阿丽亚娜5 ECA',
  ariane5es: '阿丽亚娜5 ES',
  ariane6: '阿丽亚娜6',
  ariane62: '阿丽亚娜62',
  ariane64: '阿丽亚娜64',
  arianenext: '阿丽亚娜下一代',
  themis: '忒弥斯',
  vegac: '织女星-C',
  atlasv: '阿特拉斯5',
  vulcancentaur: '火神半人马',
  vulcan: '火神',
  deltaivheavy: '德尔塔4重型',
  deltaiv: '德尔塔4',
  antares: '安塔瑞斯',
  angara12: '安加拉1.2',
  angaraa5: '安加拉A5',
  soyuz21a: '联盟-2.1a',
  soyuz21b: '联盟-2.1b',
  h3: 'H3',
  h322: 'H3-22',
  h324: 'H3-24',
  h330: 'H3-30',
  h2a: 'H-IIA',
  h2b: 'H-IIB',
  pslv: '极地卫星运载火箭',
  gslv: '地球同步卫星运载火箭',
  fireflyalpha: '萤火虫阿尔法',
  fireflyalphablock2: '萤火虫阿尔法 Block 2',
  terranr: '特兰R',
  terran1: '特兰1',
  miura1: '米乌拉1',
  miura5: '米乌拉5',
  rfaone: 'RFA One',
  spectrum: '光谱号',
  eris: '厄里斯',
  eris1: '厄里斯-1',
  erisblock1: '厄里斯 Block 1',
  nova: '新星号',
  rs1: 'RS1',
  callisto: '卡利斯托',
  prometheus: '普罗米修斯',
  // 中国民营 / 型号
  zhuque2: '朱雀二号', zq2: '朱雀二号',
  zhuque2e: '朱雀二号改', zq2e: '朱雀二号改',
  zhuque3: '朱雀三号', zq3: '朱雀三号',
  ceres1: '谷神星一号', ceres1s: '谷神星一号海射型',
  ceres2: '谷神星二号',
  gravity1: '引力一号', gravity2: '引力二号',
  kuaizhou1a: '快舟一号甲', kz1a: '快舟一号甲',
  kuaizhou11: '快舟十一号', kz11: '快舟十一号',
  jielong3: '捷龙三号', smartdragon3: '捷龙三号',
  jielong1: '捷龙一号', smartdragon1: '捷龙一号',
  kinetica1: '力箭一号', lijian1: '力箭一号',
  kinetica2: '力箭二号', lijian2: '力箭二号',
  hyperbola1: '双曲线一号',
  hyperbola2: '双曲线二号',
  hyperbola3: '双曲线三号',
  tianlong2: '天龙二号', tianlong3: '天龙三号',
  nebula1: '星云一号',
  pallas1: '智神星一号',
  kaituozhe1: '开拓者一号',
  kaituozhe: '开拓者',
  fengbao1: '风暴一号'
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

  // Falcon 9 Block 5 / Full Thrust 等：保留构型后缀便于族谱区分
  if (/^falcon9/.test(key)) {
    const block = raw.match(/block\s*(\d+)/i)
    if (block) return '猎鹰9号 Block ' + block[1]
    if (/full\s*thrust/i.test(raw)) return '猎鹰9号全推力版'
    const ver = raw.match(/\bv\s*(1\.\d)\b/i)
    if (ver) return '猎鹰9号 v' + ver[1]
    return '猎鹰9号'
  }
  if (/^falconheavy/.test(key)) return '猎鹰重型'
  if (/^superheavy/.test(key)) return '超重型助推器'
  if (/^starship/.test(key)) return '星舰'
  if (/^angara12/.test(key)) return '安加拉1.2'
  if (/^angara/.test(key)) return '安加拉'
  if (/^antares/.test(key)) {
    const m = raw.match(/antares\s*([0-9]+[+]?)/i)
    return m ? '安塔瑞斯 ' + m[1] : '安塔瑞斯'
  }
  if (/^soyuz/.test(key)) return '联盟号'
  if (/^ariane6/.test(key)) return '阿丽亚娜6'
  if (/^ariane5/.test(key)) return '阿丽亚娜5'
  if (/^ariane/.test(key)) return '阿丽亚娜'
  if (/^vulcan/.test(key)) return '火神'
  if (/^atlasv/.test(key)) {
    const m = raw.match(/atlas\s*v\s*([0-9a-z]+)/i)
    return m ? '阿特拉斯5 ' + m[1].toUpperCase() : '阿特拉斯5'
  }
  if (/^newglenn/.test(key)) return '新格伦'
  if (/^newshepard/.test(key)) return '新谢泼德'
  if (/^electron/.test(key)) return '电子号'
  if (/^neutron/.test(key)) return '中子号'
  if (/^fireflyalpha/.test(key)) return '萤火虫阿尔法'
  if (/^hyperbola/.test(key)) {
    const m = raw.match(/hyperbola[-\s]*(\d+)/i)
    return m ? '双曲线' + (CZ_NUM_ZH[Number(m[1])] || m[1]) + '号' : '双曲线'
  }
  if (/^zhuque|^zq\d/.test(key)) {
    const m = raw.match(/(?:zhuque|zq)[-\s]*(\d+)\s*([a-z]?)/i)
    if (m) {
      return '朱雀' + (CZ_NUM_ZH[Number(m[1])] || m[1]) + '号' + (m[2] === 'e' || m[2] === 'E' ? '改' : '')
    }
  }
  if (/^tianlong/.test(key)) {
    const m = raw.match(/tianlong[-\s]*(\d+)/i)
    return m ? '天龙' + (CZ_NUM_ZH[Number(m[1])] || m[1]) + '号' : '天龙'
  }
  if (/^gravity/.test(key)) {
    const m = raw.match(/gravity[-\s]*(\d+)/i)
    return m ? '引力' + (CZ_NUM_ZH[Number(m[1])] || m[1]) + '号' : '引力'
  }
  if (/^kinetica|^lijian/.test(key)) {
    const m = raw.match(/(?:kinetica|lijian)[-\s]*(\d+)/i)
    return m ? '力箭' + (CZ_NUM_ZH[Number(m[1])] || m[1]) + '号' : '力箭'
  }
  if (/^ceres/.test(key)) {
    if (/ceres[-\s]*1s/i.test(raw)) return '谷神星一号海射型'
    const m = raw.match(/ceres[-\s]*(\d+)/i)
    return m ? '谷神星' + (CZ_NUM_ZH[Number(m[1])] || m[1]) + '号' : '谷神星'
  }
  if (/^h3-?/.test(key) || key === 'h3') {
    const m = raw.match(/h3[-\s]*(\d+[a-z]?)/i)
    return m ? 'H3-' + m[1].toUpperCase() : 'H3'
  }

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
