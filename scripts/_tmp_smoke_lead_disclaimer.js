/* 文首提示语冒烟：纯文/转义/剥离幂等（限流策略：不挂文字小程序链） */
const path = require('path')
const wx = require(path.join(__dirname, '../cloudfunctions/adminGateway/oaWechatApi.js'))

let failed = 0
const check = (name, ok, detail) => {
  console.log(ok ? '  OK ' : '  FAIL', name, ok ? '' : detail || '')
  if (!ok) failed++
}

const TEXT =
  '本文详情信息仅供参考，有关火箭发射预报小程序【火星探索日志】可以查看火箭发射信息及相关资讯，感谢阅读，记得点赞支持'

const html = wx.buildLeadDisclaimerHtml({ text: TEXT, path: 'pages/index/index' })
console.log('lead html:\n', html, '\n')

check('has data-oa-lead marker', /data-oa-lead="1"/.test(html))
check('no miniprogram text anchor', !/<a\b/i.test(html))
check('no miniprogram appid attr', !/data-miniprogram-appid/.test(html))
check('keeps 【火星探索日志】 as plain text', html.includes('【火星探索日志】'))
check('text preserved', html.includes('本文详情信息仅供参考') && html.includes('记得点赞支持'))

// 无【】时纯文本
const plain = wx.buildLeadDisclaimerHtml({ text: '仅供参考，无跳转', path: 'pages/index/index' })
check('plain text ok', !/<a /.test(plain) && plain.includes('仅供参考'))

// 空文案返回空
check('empty text → empty', wx.buildLeadDisclaimerHtml({ text: '', path: 'p' }) === '')

// XSS 转义
const xss = wx.buildLeadDisclaimerHtml({ text: '<script>alert(1)</script>【名】x', path: 'pages/index/index' })
check('escapes html in text', !/<script>/.test(xss) && /&lt;script&gt;/.test(xss))

// 剥离幂等
const doc = html + '<p>正文</p>' + '<img src="http://x/a.jpg" />'
const stripped = wx.stripLeadDisclaimer(doc)
check('strip removes lead only', !/data-oa-lead/.test(stripped) && stripped.includes('<p>正文</p>'))
check('strip idempotent', wx.stripLeadDisclaimer(stripped) === stripped)
// 防重复：strip 后再加只有一份
const rebuilt = wx.buildLeadDisclaimerHtml({ text: TEXT, path: 'pages/index/index' }) + stripped
check('rebuild single lead', (rebuilt.match(/data-oa-lead/g) || []).length === 1)

// stripMiniprogramCta 不误伤 lead
check('cta strip keeps lead', /data-oa-lead/.test(wx.stripMiniprogramCta(html + '<p data-oa-cta="1">cta</p>')))
// wrapAllImagesWithMiniprogram 只包图，前言 section 内仍无文字锚点
const wrapped = wx.wrapAllImagesWithMiniprogram(html + '<img src="http://x/a.jpg" />', { path: 'pages/index/index' })
const leadOnly = (wrapped.match(/<section\b[^>]*data-oa-lead[^>]*>[\s\S]*?<\/section>/i) || [])[0] || ''
check('img wrap keeps lead plain', !!leadOnly && !/<a\b/i.test(leadOnly))
check('img wrap adds mp anchor on img', /data-miniprogram-appid="[^"]+"[^>]*>\s*<img\b/i.test(wrapped))

console.log(failed ? `\nFAILED ${failed}` : '\nALL OK')
process.exit(failed ? 1 : 0)
