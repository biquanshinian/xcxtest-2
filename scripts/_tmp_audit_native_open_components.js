/**
 * 原生开放能力组件官方格式审计
 * - store-product.custom-style 必须是官方对象（含 card），禁止 CSS 字符串 / null
 * - official-account-publish 仅允许文档属性
 * - channel-live 必须具备 feed-id + finder-user-name
 *
 * 运行：node scripts/_tmp_audit_native_open_components.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SKIP_DIRS = new Set([
  'node_modules',
  'cloudfunctions',
  'scripts',
  '.git',
  'admin-web',
  'miniprogram_npm',
  'dist',
  'workers',
  'tools',
  'docs',
  '_error_report_extract'
])

const {
  buildStoreProductCustomStyle,
  validateStoreProductCustomStyle
} = require('../utils/store-product-style.js')

const OA_PUBLISH_ALLOWED_ATTRS = new Set([
  'topic',
  'limit',
  'background-color',
  'color-unity',
  'placeholder',
  'show-related',
  'recommend-path',
  'recommend-title',
  'class',
  'style',
  'id',
  'hidden',
  'binderror',
  'bindempty',
  'bindpublishsuccess',
  'bindpublishfail',
  'catcherror',
  'catchempty',
  'catchpublishsuccess',
  'catchpublishfail'
])

const problems = []
const passes = []

function check(name, ok, detail) {
  if (ok) passes.push(name)
  else problems.push(detail ? `${name}：${detail}` : name)
}

function walk(dir, out, exts) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    let st
    try { st = fs.statSync(full) } catch (e) { continue }
    if (st.isDirectory()) walk(full, out, exts)
    else if (exts.some((e) => name.endsWith(e))) out.push(full)
  }
  return out
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/')
}

function stripComments(src, kind) {
  if (kind === 'js') {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')
  }
  // wxml：去掉注释，避免审计命中注释里的示例
  return src.replace(/<!--[\s\S]*?-->/g, '')
}

function extractTags(wxml, tagName) {
  // 标签名后必须是空白、/、>，避免把 official-account-publish-panel 当成 publish
  const re = new RegExp(`<${tagName}(?=[\\s/>])([\\s\\S]*?)(?:\\/>|>)`, 'g')
  const tags = []
  let m
  while ((m = re.exec(wxml))) {
    tags.push({ attrs: m[1] || '', index: m.index, raw: m[0] })
  }
  return tags
}

function attrNames(attrBlob) {
  const names = []
  const re = /([A-Za-z_][\w:-]*)\s*=/g
  let m
  while ((m = re.exec(attrBlob))) names.push(m[1])
  return names
}

function hasAttr(attrBlob, name) {
  return new RegExp(`(?:^|\\s)${name}\\s*=`).test(attrBlob)
}

function attrValue(attrBlob, name) {
  const m = attrBlob.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`))
  return m ? m[1] : null
}

// ---------- 1) util 自检 ----------
;(() => {
  const dark = buildStoreProductCustomStyle(false)
  const light = buildStoreProductCustomStyle(true)
  check('build dark custom-style', validateStoreProductCustomStyle(dark).ok, validateStoreProductCustomStyle(dark).reason)
  check('build light custom-style', validateStoreProductCustomStyle(light).ok, validateStoreProductCustomStyle(light).reason)
  check('reject CSS string', !validateStoreProductCustomStyle('width:100%;').ok)
  check('reject null', !validateStoreProductCustomStyle(null).ok)
  check('reject missing card', !validateStoreProductCustomStyle({ title: { color: '#fff' } }).ok)
  check('reject illegal prop', !validateStoreProductCustomStyle({
    card: { 'background-color': '#000', width: '100%' }
  }).ok)
})()

// ---------- 2) 全仓扫描 ----------
const wxmlFiles = walk(ROOT, [], ['.wxml'])
const jsFiles = walk(ROOT, [], ['.js'])

let storeProductCount = 0
let storeHomeCount = 0
let storeCouponCount = 0
let storeGiftCount = 0
let channelLiveCount = 0
let oaPublishCount = 0

wxmlFiles.forEach((file) => {
  const src = stripComments(fs.readFileSync(file, 'utf8'), 'wxml')
  const r = rel(file)

  // store-home（小店首页 / 精选展示位所在页；只需 appid，不要改内部样式）
  extractTags(src, 'store-home').forEach((tag, i) => {
    storeHomeCount += 1
    const id = `${r} <store-home>#${i + 1}`
    check(`${id} 有 appid`, hasAttr(tag.attrs, 'appid'), '缺少 appid')
  })

  // store-coupon
  extractTags(src, 'store-coupon').forEach((tag, i) => {
    storeCouponCount += 1
    const id = `${r} <store-coupon>#${i + 1}`
    check(`${id} 有 appid`, hasAttr(tag.attrs, 'appid'), '缺少 appid')
    check(`${id} 有 coupon-id`, hasAttr(tag.attrs, 'coupon-id'), '缺少 coupon-id')
    if (hasAttr(tag.attrs, 'custom-style')) {
      const v = attrValue(tag.attrs, 'custom-style')
      check(`${id} custom-style 使用绑定`, !!(v && /\{\{/.test(v)), v ? `字面量非法: ${v}` : '缺少绑定')
    }
  })

  // store-gift
  extractTags(src, 'store-gift').forEach((tag, i) => {
    storeGiftCount += 1
    const id = `${r} <store-gift>#${i + 1}`
    check(`${id} 有 present-order-id`, hasAttr(tag.attrs, 'present-order-id'), '缺少 present-order-id')
    check(`${id} 有 open-id`, hasAttr(tag.attrs, 'open-id'), '缺少 open-id')
  })

  // store-product
  extractTags(src, 'store-product').forEach((tag, i) => {
    storeProductCount += 1
    const id = `${r} <store-product>#${i + 1}`
    check(`${id} 有 appid`, hasAttr(tag.attrs, 'appid'), '缺少 appid')
    check(`${id} 有 product-id`, hasAttr(tag.attrs, 'product-id'), '缺少 product-id')

    if (hasAttr(tag.attrs, 'custom-style')) {
      const v = attrValue(tag.attrs, 'custom-style')
      // 必须是数据绑定对象，禁止字面量 CSS 字符串
      if (v != null && !/\{\{/.test(v)) {
        check(`${id} custom-style 官方对象绑定`, false, `字面量非法: ${v}`)
      } else {
        check(`${id} custom-style 使用绑定`, true)
      }
      // 绑定变量名应来自 storeCustomStyle（本仓约定）
      if (v && !/storeCustomStyle/.test(v)) {
        check(`${id} custom-style 变量名`, false, `期望绑定 storeCustomStyle，实际: ${v}`)
      } else if (v) {
        check(`${id} custom-style 变量名 storeCustomStyle`, true)
      }
    }
  })

  // 禁止任何 custom-style="width:..." 残留
  if (/custom-style\s*=\s*["'][^"']*width\s*:/.test(src) || /custom-style\s*=\s*["']\{\{[^}]*\}\}["']/.test(src) && /storeCustomStyle:\s*['"][^'"]*width\s*:/.test(src)) {
    // 上面第二段在 wxml 检测不到 js；这里只抓字面量
  }
  if (/custom-style\s*=\s*["'][^"'{}]*:/.test(src)) {
    check(`${r} 无 CSS 字符串 custom-style`, false, '发现 custom-style 字面量 CSS')
  } else {
    check(`${r} 无 CSS 字符串 custom-style`, true)
  }

  // official-account-publish
  extractTags(src, 'official-account-publish').forEach((tag, i) => {
    oaPublishCount += 1
    const id = `${r} <official-account-publish>#${i + 1}`
    const names = attrNames(tag.attrs)
    const bad = names.filter((n) => !OA_PUBLISH_ALLOWED_ATTRS.has(n))
    check(`${id} 属性均在官方列表`, bad.length === 0, bad.length ? `非法属性: ${bad.join(', ')}` : '')
    check(`${id} 无废弃 path`, !hasAttr(tag.attrs, 'path'), '仍使用非文档属性 path，应改 recommend-path')
    if (hasAttr(tag.attrs, 'recommend-path')) {
      check(`${id} 有 recommend-title`, hasAttr(tag.attrs, 'recommend-title'), '设置了 recommend-path 建议同时设 recommend-title')
    }
  })

  // channel-live
  extractTags(src, 'channel-live').forEach((tag, i) => {
    channelLiveCount += 1
    const id = `${r} <channel-live>#${i + 1}`
    check(`${id} 有 feed-id`, hasAttr(tag.attrs, 'feed-id'), '缺少 feed-id')
    check(`${id} 有 finder-user-name`, hasAttr(tag.attrs, 'finder-user-name'), '缺少 finder-user-name')
  })
})

// JS：禁止把 custom-style 设成 CSS 字符串
jsFiles.forEach((file) => {
  const src = stripComments(fs.readFileSync(file, 'utf8'), 'js')
  const r = rel(file)
  if (/storeCustomStyle\s*:\s*['"][^'"]*[:;]/.test(src)) {
    check(`${r} storeCustomStyle 非 CSS 字符串`, false, 'storeCustomStyle 仍是 CSS 字符串')
  }
  if (/customStyle\s*:\s*['"][^'"]*width\s*:/.test(src) && /store-product|storeCustomStyle|custom-style/.test(src)) {
    check(`${r} 无 store 相关 CSS customStyle`, false, '发现疑似 CSS 字符串 customStyle')
  }
})

// popup-ad 专项
;(() => {
  const jsPath = path.join(ROOT, 'components/popup-ad/popup-ad.js')
  const wxmlPath = path.join(ROOT, 'components/popup-ad/popup-ad.wxml')
  const js = fs.readFileSync(jsPath, 'utf8')
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  check('popup-ad 引用 store-product-style', /store-product-style/.test(js))
  check('popup-ad 使用 buildStoreProductCustomStyle', /buildStoreProductCustomStyle/.test(js))
  check('popup-ad 使用 validateStoreProductCustomStyle', /validateStoreProductCustomStyle/.test(js))
  check('popup-ad 关闭先卸 store-product', /showStoreProduct:\s*false/.test(js) && /leaving:\s*true/.test(js))
  check('popup-ad wxml 有官方 custom-style 绑定', /custom-style="\{\{storeCustomStyle\}\}"/.test(wxml))
  check('popup-ad 低版本无 custom-style 分支', /wx:if="\{\{useCustomStyle\}\}"/.test(wxml) && /wx:else/.test(wxml))
  check('popup-ad 无 CSS 字符串 storeCustomStyle', !/storeCustomStyle:\s*['"][^'"]*width/.test(js))
})()

// 我的页微信小店首页（store-home，含精选展示位；不必选商品）
;(() => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/profile/profile.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(ROOT, 'pages/profile/profile.js'), 'utf8')
  const json = fs.readFileSync(path.join(ROOT, 'pages/profile/profile.json'), 'utf8')
  check('我的页有 store-home', /<store-home[\s>]/.test(wxml))
  check('我的页微信小店作标题', /section-title-text">微信小店/.test(wxml))
  check('我的页微信小店标题带官方图标', /ic-wechat-shop\.svg/.test(wxml))
  check('我的页店铺卡左右铺黑白底', /class="pf-shop-blend"/.test(wxml))
  check('我的页无商城侧卡', !/class="pf-shop-side"/.test(wxml) && !/正版周边/.test(wxml))
  check('我的页仅店铺卡', !/<store-product[\s>]/.test(wxml) && !/<store-coupon[\s>]/.test(wxml) && !/<store-gift[\s>]/.test(wxml))
  check('我的页 store-home 绑定 appid', /appid="\{\{profileShopAppid\}\}"/.test(wxml))
  check('我的页 store-home 受开关控制', /wx:if="\{\{showProfileShop\}\}"/.test(wxml))
  check('我的页不引用旧 profile-shop 组件', !/"profile-shop"/.test(json))
  check('我的页加载 store-home 配置', /loadProfileShopHome\(true/.test(js))
  const leftover = path.join(ROOT, 'components/profile-shop/index.wxml')
  check('已移除旧 profile-shop 商品卡组件', !fs.existsSync(leftover))
})()

// official-account-publish-panel 专项
;(() => {
  const wxml = fs.readFileSync(
    path.join(ROOT, 'subpackages/shared/components/official-account-publish-panel/index.wxml'),
    'utf8'
  )
  const js = fs.readFileSync(
    path.join(ROOT, 'subpackages/shared/components/official-account-publish-panel/index.js'),
    'utf8'
  )
  const panelWxml = stripComments(wxml, 'wxml')
  // 只禁独立 path=，不要误伤 recommend-path=
  check('贴图面板无废弃 path 属性', !/(?:^|[\s"'])path\s*=/.test(panelWxml))
  check('贴图面板使用 recommend-path', /recommend-path=/.test(wxml))
  check('贴图面板使用 recommend-title', /recommend-title=/.test(wxml))
  check('贴图面板 topic 截断 20 字', /TOPIC_MAX_LEN\s*=\s*20/.test(js) && /slice\(0,\s*TOPIC_MAX_LEN\)/.test(js))
  check('贴图面板 limit 上限 10', /Math\.min\(\s*10/.test(js))
})()

console.log(`扫描 wxml ${wxmlFiles.length} / js ${jsFiles.length}`)
console.log(`组件计数：store-product=${storeProductCount}, store-home=${storeHomeCount}, store-coupon=${storeCouponCount}, store-gift=${storeGiftCount}, channel-live=${channelLiveCount}, official-account-publish=${oaPublishCount}`)
console.log(`通过 ${passes.length} 项`)
if (!problems.length) {
  console.log('PASS：原生开放能力组件官方格式审计全绿')
  process.exit(0)
}
console.log(`FAIL ${problems.length} 项：`)
problems.forEach((p) => console.log('  - ' + p))
process.exit(1)
