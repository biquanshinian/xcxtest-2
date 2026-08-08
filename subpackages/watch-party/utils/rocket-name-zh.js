/**
 * 火箭名中文显示适配（观礼分包·纯展示层）
 * 输入是场次落库的 rocketName（LL2 configuration 名，与「商家选任务」单链路同源），
 * 只做显示转写、不改数据字段：词典未命中走长征通用转写，再不行原样返回。
 * 范围：仅适配中国境内发射的火箭（观礼场景只发生在境内）；
 * 国外火箭（猎鹰/星舰/电子号等）不做转写，一律原样显示。
 */

/** 长征系列数字 → 中文（超出范围回退阿拉伯数字） */
const CZ_NUM_ZH = {
  1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六',
  7: '七', 8: '八', 9: '九', 10: '十', 11: '十一', 12: '十二'
}

/** 长征通用后缀：甲乙丙丁按惯例转天干，其余保留大写拉丁字母 */
const CZ_LETTER_ZH = { a: '甲', b: '乙', c: '丙', d: '丁' }

/** 长征不规则型号（官方/主流媒体叫法优先，覆盖通用转写） */
const CZ_SPECIAL = {
  cz2f: '长征二号F',
  cz2fg: '长征二号F',
  cz3be: '长征三号乙改',
  cz5b: '长征五号B',
  cz6a: '长征六号改',
  cz7a: '长征七号改',
  cz8a: '长征八号甲',
  cz11h: '长征十一号海射型'
}

/** 非长征常见型号（键为 normKey 归一形态） */
const EXACT_ZH = {
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

/** 归一键：小写并去掉空格/连字符/斜杠等分隔符（Long March 3B/E → longmarch3be） */
function normKey(name) {
  return String(name || '').toLowerCase().replace(/[·・.\/_\-\s]+/g, '')
}

/** 长征系列解析：longmarch7a / cz7a / changzheng7a → { num, letters } */
function parseCzKey(key) {
  const m = String(key || '').match(/^(?:longmarch|changzheng|cz)(\d{1,2})([a-z]{0,2})$/)
  if (!m) return null
  return { num: Number(m[1]), letters: m[2] || '' }
}

/**
 * 火箭名 → 中文显示名（仅中国境内发射的火箭）。
 * 已含中文、国外火箭或无法识别时原样返回（trim 后）。
 */
function rocketNameZh(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  if (/[\u4e00-\u9fff]/.test(raw)) return raw

  const key = normKey(raw)
  if (!key) return raw

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

module.exports = {
  rocketNameZh
}
