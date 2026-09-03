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
  falcon9block5: '猎鹰9号第5型',
  falcon9block4: '猎鹰9号第4型',
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

  // Falcon 9 Block 5 / Full Thrust 等：构型后缀一律汉化，禁止残留 Block
  if (/^falcon9/.test(key)) {
    const block = raw.match(/block\s*(\d+)/i)
    if (block) return '猎鹰9号第' + block[1] + '型'
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
  if (/^kosmos|^cosmos/.test(key)) {
    const kCode = raw.match(/11k\s*(\d+)/i)
    const num = raw.match(/(?:kosmos|cosmos)[-\s]*(\d+[a-z]*)/i)
    if (kCode && !num) return '宇宙号 11K' + kCode[1]
    if (num && kCode) return '宇宙-' + num[1].toUpperCase() + '（11K' + kCode[1] + '）'
    if (num) return '宇宙-' + num[1].toUpperCase()
    return '宇宙号'
  }
  if (/^molniya/.test(key)) {
    const rest = raw.replace(/^molniya[-\s]*/i, '').trim()
    return rest ? '闪电-' + rest.toUpperCase() : '闪电号'
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

const CZ_CN_NUMERALS = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  十: 10, 十一: 11, 十二: 12
}
const CZ_LETTER_FROM_ZH = { 甲: 'a', 乙: 'b', 丙: 'c', 丁: 'd' }

/**
 * 火箭型号身份键：长征十号乙 / Long March 10B / CZ-10B → cz10b
 * 供环绕全景等同型号匹配（中英显示名不能靠字符串包含）。
 */
function rocketIdentityKey(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  if (/starship|super\s*heavy|星舰|超重/i.test(raw)) return 'starship'
  if (/zhuque\s*-?\s*3|zq\s*-?\s*3|朱雀\s*[三3]\s*号/i.test(raw)) return 'zhuque3'

  const zhCz = raw.match(/长征\s*(十一|十二|十|[一二三四五六七八九]|\d{1,2})\s*号?\s*([甲乙丙丁]|[a-dA-D])?/)
  if (zhCz) {
    const numPart = zhCz[1]
    const num = Object.prototype.hasOwnProperty.call(CZ_CN_NUMERALS, numPart)
      ? CZ_CN_NUMERALS[numPart]
      : Number(numPart)
    const sfxRaw = zhCz[2] || ''
    const sfx = CZ_LETTER_FROM_ZH[sfxRaw] || String(sfxRaw).toLowerCase()
    if (Number.isFinite(num) && num > 0) return 'cz' + num + sfx
  }

  const key = normKey(
    raw.toLowerCase().replace(/long\s*march/g, 'cz').replace(/chang\s*zheng/g, 'cz')
  )
  const cz = parseCzKey(key)
  if (cz) return 'cz' + cz.num + (cz.letters || '')
  return key
}

function missionRocketTexts(mission) {
  if (!mission || typeof mission !== 'object') return []
  const pack = mission._langPack || {}
  const rocket = mission.rocket
  const nested = (rocket && typeof rocket === 'object')
    ? [rocket.name, rocket.configuration && rocket.configuration.name]
    : [rocket]
  return [
    mission.rocketName,
    mission.rocketNameEn,
    mission.rocketNameZh,
    mission.rocketConfigName,
    pack.rocketNameEn,
    pack.rocketNameZh,
    mission.vehicleName,
    nested[0],
    nested[1],
    mission.missionName,
    mission.name,
    mission.translatedName,
    pack.nameEn,
    pack.nameZh
  ].map((s) => String(s || '').trim()).filter(Boolean)
}

/** 环绕全景用家族键：Falcon 9 Block 5 / 猎鹰9号 → falcon9，不和重型混 */
function orbitPanoRocketFamilyKey(name) {
  const raw = String(name || '')
  if (/falcon\s*heavy|猎鹰重型/i.test(raw)) return 'falconheavy'
  if (/falcon\s*9|猎鹰\s*9/i.test(raw)) return 'falcon9'
  const key = rocketIdentityKey(raw)
  if (key === 'falconheavy') return 'falconheavy'
  if (key === 'falcon9' || /^falcon9/.test(key)) return 'falcon9'
  return key
}

/** 后台锁定的型号 vs 任务详情（含中英切换后的显示名） */
function matchOrbitPanoRocket(itemRocket, mission) {
  const stored = String(itemRocket || '').trim()
  if (!stored) return false
  const texts = missionRocketTexts(mission)
  if (!texts.length) return false
  const storedKey = rocketIdentityKey(stored)
  const storedFamily = orbitPanoRocketFamilyKey(stored)
  if (storedKey) {
    for (let i = 0; i < texts.length; i++) {
      if (rocketIdentityKey(texts[i]) === storedKey) return true
      if (storedFamily && orbitPanoRocketFamilyKey(texts[i]) === storedFamily) return true
    }
  }
  const blob = texts.join(' ')
  if (/starship|super\s*heavy|星舰|超重/i.test(stored) && /starship|super\s*heavy|星舰|超重/i.test(blob)) return true
  if (/zhuque\s*-?\s*3|zq\s*-?\s*3|朱雀\s*[三3]\s*号/i.test(stored) && /zhuque\s*-?\s*3|zq\s*-?\s*3|朱雀\s*[三3]\s*号/i.test(blob)) return true
  const lower = stored.toLowerCase()
  if (lower && blob.toLowerCase().indexOf(lower) >= 0) return true
  const zh = translateRocketName(stored)
  if (zh && zh !== stored && blob.indexOf(zh) >= 0) return true
  return false
}

/** 环绕全景工位匹配（仅小程序 / 后台客户端，云函数副本不必同步） */
const ORBIT_PANO_PAD_LABELS = {
  'slc-40': 'SLC-40',
  'lc-39a': 'LC-39A',
  'slc-4e': 'SLC-4E',
  starbase: '星舰基地',
  'starbase-a': '星舰基地 A 工位',
  'starbase-b': '星舰基地 B 工位',
  vandenberg: '范登堡'
}

function isOrbitPanoStarship(name) {
  return /starship|super\s*heavy|星舰|超重/i.test(String(name || ''))
}

function isStarbaseOrbitPanoPad(padKey) {
  const k = String(padKey || '')
  return k === 'starbase' || k === 'starbase-a' || k === 'starbase-b'
}

function rocketNeedsOrbitPanoPad(name) {
  const raw = String(name || '')
  if (/falcon\s*heavy|猎鹰重型/i.test(raw)) return true
  if (/falcon\s*9|猎鹰\s*9/i.test(raw)) return true
  const key = rocketIdentityKey(raw)
  return key === 'falconheavy' || key === 'falcon9' || /^falcon9/.test(key)
}

function rocketNeedsOrbitPanoRecovery(source) {
  if (!source) return false
  if (typeof source === 'string') return rocketNeedsOrbitPanoPad(source)
  return rocketNeedsOrbitPanoPad(missionRocketTexts(source).join(' '))
}

const ORBIT_PANO_RECOVERY_TYPES = {
  RTLS: 1,
  ASDS: 1,
  VL: 1,
  TOWER_CATCH: 1,
  NET_CATCH: 1,
  HELICOPTER_CATCH: 1,
  LANDSPACE: 1,
  BO_LZ: 1
}

function orbitPanoLandingType(info) {
  return String((info && info.landingType) || '').toUpperCase()
}

function looksLikeOrbitPanoAsdsLocation(loc) {
  return /ASOG|OCISLY|JRTI|\bASDS\b|A SHORTFALL|OF COURSE I STILL|JUST READ THE INSTRUCTIONS|DRONESHIP|无人船/i.test(String(loc || ''))
}

function looksLikeOrbitPanoRtlsLocation(loc) {
  return /LZ-?\d|LANDING ZONE|陆地回收/i.test(String(loc || ''))
}

function looksLikeOrbitPanoRecoveryLocation(loc) {
  return looksLikeOrbitPanoAsdsLocation(loc) || looksLikeOrbitPanoRtlsLocation(loc)
}

const ORBIT_PANO_RECOVERY_LABELS = {
  rtls: '陆地回收',
  asds: '海上回收',
  expended: '不回收'
}

function looksLikeOrbitPanoExpendedText(info) {
  const t = [
    info && info.landingTypeLabel,
    info && info.landingDescription,
    info && info.landingDisplayText
  ].filter(Boolean).join(' ')
  return /expended|will not (be )?(recovered|land)|no landing attempt|一次性使用/i.test(t)
}

function collectOrbitPanoLandingSources(mission) {
  if (!mission || typeof mission !== 'object') return []
  const out = []
  if (mission.landingType || mission.landingLocation || mission.recoveryKey) {
    out.push({
      landingType: mission.landingType,
      landingLocation: mission.landingLocation,
      thisMissionLandingAttempt: mission.thisMissionLandingAttempt
    })
  }
  if (mission.boosterInfo) out.push(mission.boosterInfo)
  const stages = Array.isArray(mission.boosterStages) ? mission.boosterStages : []
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]
    if (stage && !stage.isPayloadReturn) out.push(stage)
  }
  const first = mission.stageInfo && mission.stageInfo.firstStage
  if (first) out.push(first)
  const extra = mission.stageInfoExtra && mission.stageInfoExtra.firstStage
  if (extra) out.push(extra)
  return out
}

function collectOrbitPanoRecoveryModes(mission) {
  const modes = { rtls: false, asds: false, expended: false }
  if (!mission) return modes
  const preset = String(mission.recoveryKey || '').trim().toLowerCase()
  if (preset === 'asds' || preset === 'rtls' || preset === 'expended') modes[preset] = true
  const sources = collectOrbitPanoLandingSources(mission)
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]
    const type = orbitPanoLandingType(src)
    const loc = src && src.landingLocation
    const label = [
      src && src.landingTypeLabel,
      src && src.landingDisplayText,
      src && src.landingDescription
    ].filter(Boolean).join(' ')
    if (type === 'ASDS' || looksLikeOrbitPanoAsdsLocation(loc) || /海上回收|无人船/.test(label)) {
      modes.asds = true
    }
    if (type === 'RTLS' || type === 'VL' || type === 'LANDSPACE' || looksLikeOrbitPanoRtlsLocation(loc) || /陆地回收/.test(label)) {
      modes.rtls = true
    }
    if (type === 'EXPENDED' || (src && src.thisMissionLandingAttempt === false) || looksLikeOrbitPanoExpendedText(src)) {
      modes.expended = true
    }
  }
  return modes
}

function inferOrbitPanoRecoveryKey(mission) {
  const modes = collectOrbitPanoRecoveryModes(mission)
  if (modes.asds) return 'asds'
  if (modes.rtls) return 'rtls'
  if (modes.expended) return 'expended'
  return ''
}

function orbitPanoRecoveryLabel(key, fallback) {
  return ORBIT_PANO_RECOVERY_LABELS[key] || String(fallback || '').trim() || key
}

function matchOrbitPanoRecovery(itemRecoveryKey, mission) {
  const want = String(itemRecoveryKey || '').trim().toLowerCase()
  if (!want) return false
  const modes = collectOrbitPanoRecoveryModes(mission)
  if (want === 'asds') return !!modes.asds
  if (want === 'rtls') return !!modes.rtls
  return false
}

/**
 * 猎鹰 9 / 重型：明确不回收则不展示环绕全景（Earth Studio 是发射→回收轨迹）。
 * 任一芯/助推有回收计划即显示；重型仅中央芯一次性、侧助推仍回收时保持显示。
 * 尚无回收数据时先显示，避免即将发射缺字段被误藏。
 */
function orbitPanoMissionAttemptsRecovery(mission) {
  if (!rocketNeedsOrbitPanoRecovery(mission)) return true
  const sources = collectOrbitPanoLandingSources(mission)
  let recovery = 0
  let expended = 0
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]
    const type = orbitPanoLandingType(src)
    if (ORBIT_PANO_RECOVERY_TYPES[type] || looksLikeOrbitPanoRecoveryLocation(src && src.landingLocation)) {
      recovery++
      continue
    }
    const thisAttempt = src && src.thisMissionLandingAttempt
    if (type === 'EXPENDED' || thisAttempt === false || looksLikeOrbitPanoExpendedText(src)) expended++
  }
  if (recovery > 0) return true
  if (expended > 0) {
    const blob = missionRocketTexts(mission).join(' ')
    if (/falcon\s*heavy|猎鹰重型/i.test(blob) && sources.length < 2) return true
    return false
  }
  return true
}

function missionPadBlob(source) {
  if (!source) return ''
  if (typeof source === 'string') return source
  const pad = source.padDetail && typeof source.padDetail === 'object' ? source.padDetail : {}
  const pack = source._langPack && typeof source._langPack === 'object' ? source._langPack : {}
  return [
    source.padKey,
    source.padName,
    source.pad,
    source.padLocation,
    source.launchSite,
    pad.padName,
    pad.locationName,
    pack.padLocationEn,
    pack.padLocationZh,
    pack.launchSiteEn,
    pack.launchSiteZh,
    pack.padNameEn,
    pack.padNameZh,
    source.missionName,
    source.name
  ].filter(Boolean).join(' ')
}

function inferStarbaseOrbitPanoPadKey(s) {
  if (!/starbase|boca\s*chica|博卡奇卡|星舰基地/.test(s)) return ''
  if (/orbital launch (?:pad|mount)\s*(?:2|b)\b|olm[-\s]?b|\bpad\s*[b2]\b|launch pad [b2]|olp[-\s]?2|工位\s*[b2]|[b2]\s*工位/.test(s)) {
    return 'starbase-b'
  }
  if (/orbital launch (?:pad|mount)\s*(?:1|a)\b|olm[-\s]?a|\bpad\s*[a1]\b|launch pad [a1]|olp[-\s]?1|工位\s*[a1]|[a1]\s*工位|\bolm\b/.test(s)) {
    return 'starbase-a'
  }
  return 'starbase'
}

function inferOrbitPanoPadKey(source) {
  const s = missionPadBlob(source).toLowerCase()
  if (!s) return ''
  const rocketBlob = typeof source === 'string' ? '' : missionRocketTexts(source).join(' ')
  const starship = isOrbitPanoStarship(rocketBlob)
  if (/slc[-\s]?40|space launch complex\s*40/.test(s)) return 'slc-40'
  if (/lc[-\s]?39a|launch complex\s*39a|\b39a\b/.test(s)) return 'lc-39a'
  if (starship) {
    if (/slc[-\s]?6|space launch complex\s*6|vandenberg|范登堡/.test(s)) return 'vandenberg'
    if (/kennedy|肯尼迪/.test(s)) return 'lc-39a'
    return inferStarbaseOrbitPanoPadKey(s)
  }
  if (/slc[-\s]?4e|space launch complex\s*4e/.test(s)) return 'slc-4e'
  if (/vandenberg|范登堡/.test(s)) return 'slc-4e'
  if (/kennedy|肯尼迪/.test(s)) return 'lc-39a'
  if (/cape\s*canaveral|卡纳维拉尔/.test(s)) return 'slc-40'
  return inferStarbaseOrbitPanoPadKey(s)
}

function matchOrbitPanoPad(itemPadKey, mission) {
  const want = String(itemPadKey || '').trim()
  const got = inferOrbitPanoPadKey(mission)
  if (!want || !got) return false
  if (want === got) return true
  if (want === 'starbase' && isStarbaseOrbitPanoPad(got)) return true
  return false
}

function orbitPanoItemHasVideo(item) {
  return !!(item && item.enabled !== false && String(item.videoUrl || item.mediaUrl || '').trim())
}

function matchOrbitPanoLaunchId(item, mission) {
  if (!item || item.rocketName) return false
  const mid = String((mission && (mission.id || mission.launchId)) || '').trim()
  return !!(item.launchId && mid && String(item.launchId).trim() === mid)
}

function matchOrbitPanoItem(item, mission) {
  if (!orbitPanoItemHasVideo(item) || !mission) return false
  if (!orbitPanoMissionAttemptsRecovery(mission)) return false
  if (!matchOrbitPanoRocket(item.rocketName, mission)) {
    return matchOrbitPanoLaunchId(item, mission)
  }
  if (rocketNeedsOrbitPanoPad(item.rocketName)) {
    const padKey = String(item.padKey || '').trim()
    const recKey = String(item.recoveryKey || '').trim()
    if (!padKey || !recKey) return false
    return matchOrbitPanoPad(padKey, mission) && matchOrbitPanoRecovery(recKey, mission)
  }
  if (isOrbitPanoStarship(item.rocketName)) {
    const padKey = String(item.padKey || '').trim()
    if (padKey) return matchOrbitPanoPad(padKey, mission)
    return true
  }
  const padKey = String(item.padKey || '').trim()
  if (padKey) return matchOrbitPanoPad(padKey, mission)
  return true
}

function pickOrbitPanoItem(items, mission) {
  if (!mission || !Array.isArray(items)) return null
  if (!orbitPanoMissionAttemptsRecovery(mission)) return null
  const primaryRecovery = inferOrbitPanoRecoveryKey(mission)
  const recoveryKnown = primaryRecovery === 'asds' || primaryRecovery === 'rtls'
  const missionPad = inferOrbitPanoPadKey(mission)
  let padRecoveryAlt = null
  let starshipSite = null
  let rocketOnly = null
  let launchIdHit = null
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!orbitPanoItemHasVideo(item)) continue
    if (matchOrbitPanoRocket(item.rocketName, mission)) {
      if (rocketNeedsOrbitPanoPad(item.rocketName)) {
        const padKey = String(item.padKey || '').trim()
        const recKey = String(item.recoveryKey || '').trim()
        if (!padKey || !recKey) continue
        if (!matchOrbitPanoPad(padKey, mission)) continue
        if (recoveryKnown && !matchOrbitPanoRecovery(recKey, mission)) continue
        if (recoveryKnown && recKey === primaryRecovery) return item
        if (!padRecoveryAlt) padRecoveryAlt = item
        continue
      }
      if (isOrbitPanoStarship(item.rocketName)) {
        const padKey = String(item.padKey || '').trim()
        if (padKey) {
          if (!matchOrbitPanoPad(padKey, mission)) continue
          if (padKey === missionPad) return item
          if (!starshipSite) starshipSite = item
          continue
        }
        if (!rocketOnly) rocketOnly = item
        continue
      }
      if (!rocketOnly) rocketOnly = item
      continue
    }
    if (!launchIdHit && matchOrbitPanoLaunchId(item, mission)) launchIdHit = item
  }
  return padRecoveryAlt || starshipSite || rocketOnly || launchIdHit
}

module.exports = {
  translateRocketName,
  localizeRocketInTitle,
  rocketIdentityKey,
  matchOrbitPanoRocket,
  ORBIT_PANO_PAD_LABELS,
  ORBIT_PANO_RECOVERY_LABELS,
  isOrbitPanoStarship,
  rocketNeedsOrbitPanoPad,
  rocketNeedsOrbitPanoRecovery,
  inferOrbitPanoPadKey,
  inferOrbitPanoRecoveryKey,
  orbitPanoRecoveryLabel,
  orbitPanoMissionAttemptsRecovery,
  matchOrbitPanoItem,
  pickOrbitPanoItem
}
