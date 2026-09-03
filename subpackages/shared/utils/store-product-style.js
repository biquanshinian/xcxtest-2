/**
 * 微信小店 store-product 的 custom-style（官方格式）
 * 文档：https://developers.weixin.qq.com/miniprogram/dev/component/store-product.html
 *
 * 合法键：card / title / price / buy-button / buy-button-disabled
 * 切勿传 CSS 字符串（如 "width:100%"），基础库 customStyleChanged 会读 null.card 崩溃。
 */

const ALLOWED_KEYS = Object.freeze([
  'card',
  'title',
  'price',
  'buy-button',
  'buy-button-disabled'
])

const ALLOWED_PROPS = Object.freeze({
  card: Object.freeze(['background-color']),
  title: Object.freeze(['color']),
  price: Object.freeze(['color']),
  'buy-button': Object.freeze(['width', 'border-radius', 'color', 'background-color']),
  'buy-button-disabled': Object.freeze(['width', 'border-radius', 'color', 'background-color'])
})

/** @param {'light'|'dark'|boolean} themeOrLight */
function buildStoreProductCustomStyle(themeOrLight) {
  const light = themeOrLight === true || themeOrLight === 'light'
  // 与 styles/tokens.wxss 卡片底 / 正文色对齐；价格与按钮沿用官方示例强调色
  return {
    card: {
      'background-color': light ? '#FAFAFA' : '#1C1C1E'
    },
    title: {
      color: light ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.92)'
    },
    price: {
      color: '#FF6146'
    },
    'buy-button': {
      width: '100px',
      'border-radius': '30px',
      'background-color': light ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.14)',
      color: '#FFD48D'
    },
    'buy-button-disabled': {
      width: '100px',
      'border-radius': '30px',
      'background-color': light ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.06)',
      color: 'rgba(255, 212, 141, 0.55)'
    }
  }
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 校验是否为官方合法 custom-style（至少含 card，且无非法键/属性）
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateStoreProductCustomStyle(style) {
  if (typeof style === 'string') {
    return { ok: false, reason: 'custom-style 不能是 CSS 字符串，须为官方对象' }
  }
  if (style == null) {
    return { ok: false, reason: 'custom-style 不能为 null/undefined（会触发 reading card）' }
  }
  if (!isPlainObject(style)) {
    return { ok: false, reason: 'custom-style 须为 plain object' }
  }
  if (!isPlainObject(style.card)) {
    return { ok: false, reason: '缺少官方必需结构 card: { background-color }' }
  }
  for (const key of Object.keys(style)) {
    if (ALLOWED_KEYS.indexOf(key) < 0) {
      return { ok: false, reason: '非法键: ' + key }
    }
    const node = style[key]
    if (!isPlainObject(node)) {
      return { ok: false, reason: key + ' 须为对象' }
    }
    const allow = ALLOWED_PROPS[key] || []
    for (const prop of Object.keys(node)) {
      if (allow.indexOf(prop) < 0) {
        return { ok: false, reason: key + ' 含非法属性: ' + prop }
      }
    }
  }
  return { ok: true }
}

module.exports = {
  ALLOWED_KEYS,
  ALLOWED_PROPS,
  buildStoreProductCustomStyle,
  validateStoreProductCustomStyle
}
