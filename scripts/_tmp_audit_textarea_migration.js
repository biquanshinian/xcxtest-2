/**
 * input→textarea 迁移专项审计
 * 1. 全包扫描：不允许残留 <input（观礼分包所有 wxml）
 * 2. 单行 textarea（data-single）属性完整性：
 *    必备 value/maxlength/bindinput/confirm-type/show-confirm-bar/disable-default-padding
 *    禁止 type=/always-embed/auto-height
 * 3. 多行 textarea 不得带 data-single（否则粘贴换行被滤）
 * 4. wxss 高度公式：height == padding-top + line-height + padding-bottom（border-box）
 * 5. behavior 逻辑单测：strip 只滤换行、不并空格、多行不 strip、码框保空格
 */
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'subpackages', 'watch-party')
let problems = 0
const bad = (msg) => { problems++; console.log('  ✗ ' + msg) }
const ok = (msg) => console.log('  ✓ ' + msg)

// ── 1+2+3：wxml 扫描 ──
console.log('── WXML 扫描 ──')
const wxmls = fs.readdirSync(DIR).filter((f) => f.endsWith('.wxml'))
let singles = 0
let multis = 0
for (const f of wxmls) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8')
  const inputs = src.match(/<input\b/g) || []
  if (inputs.length) bad(`${f}: 残留 ${inputs.length} 个 <input>`)
  const tas = src.match(/<textarea\b[\s\S]*?\/>/g) || []
  for (const t of tas) {
    const isSingle = /data-single="1"/.test(t)
    const idm = t.match(/id="([^"]*)"/)
    const id = (idm && idm[1]) || t.slice(0, 60).replace(/\s+/g, ' ')
    if (isSingle) {
      singles++
      for (const attr of ['maxlength=', 'bindinput=', 'confirm-type=', 'show-confirm-bar="{{false}}"', 'disable-default-padding="{{true}}"', 'value=']) {
        if (t.indexOf(attr) < 0) bad(`${f} ${id}: 单行缺 ${attr}`)
      }
      if (/[\s"](type)="(?!2d)/.test(t)) bad(`${f} ${id}: 单行残留 type=`)
      if (/always-embed/.test(t)) bad(`${f} ${id}: 残留 always-embed`)
      if (/auto-height/.test(t)) bad(`${f} ${id}: 单行不应有 auto-height`)
    } else {
      multis++
      if (/confirm-type="(done|next|go|send|search)"/.test(t)) bad(`${f} ${id}: 多行不应设非 return 的 confirm-type（回车要能换行）`)
    }
  }
}
ok(`单行 textarea ${singles} 个（预期 27），多行 ${multis} 个（预期 4：介绍/须知/科普/合作补充）`)
if (singles !== 27) bad(`单行数量 ${singles} ≠ 27`)
if (multis !== 4) bad(`多行数量 ${multis} ≠ 4`)

// ── 4：wxss 高度公式 ──
console.log('── WXSS 高度公式（height = pt + line-height + pb）──')
const RPX = (s) => {
  const m = String(s || '').match(/([\d.]+)rpx/)
  return m ? parseFloat(m[1]) : NaN
}
const checks = [
  ['merchant-edit.wxss', '.wpe-form-input', 88],
  ['merchant-edit.wxss', '.wpe-form-input--block', 88],
  ['merchant.wxss', '.wpm-profile-input', 84],
  ['merchant.wxss', '.wpm-bind-input', 96],
  ['watch-party.wxss', '.wp-form-input', 88],
  ['watch-party.wxss', '.wp-input', 80],
  ['gacha.wxss', '.gc-code-input', 76]
]
for (const [file, cls, expectH] of checks) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8')
  const re = new RegExp(cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')
  const m = src.match(re)
  if (!m) { bad(`${file} ${cls}: 找不到规则`); continue }
  const body = m[1]
  const h = RPX((body.match(/[^-]height:\s*([^;]+);/) || [])[1])
  const lh = RPX((body.match(/line-height:\s*([^;]+);/) || [])[1])
  const pad = (body.match(/padding:\s*([^;]+);/) || [])[1] || ''
  const parts = pad.trim().split(/\s+/).map(RPX)
  let pt = 0
  if (parts.length >= 1 && !isNaN(parts[0])) pt = parts[0]
  const pb = parts.length >= 3 && !isNaN(parts[2]) ? parts[2] : pt
  const sum = pt + lh + pb
  if (isNaN(lh)) { bad(`${file} ${cls}: line-height 非 rpx 值`); continue }
  if (h !== expectH) bad(`${file} ${cls}: height ${h} ≠ 预期 ${expectH}`)
  if (Math.abs(sum - h) > 0.5) bad(`${file} ${cls}: padding(${pt}/${pb}) + line-height(${lh}) = ${sum} ≠ height ${h}`)
  else ok(`${cls}: ${pt} + ${lh} + ${pb} = ${h}`)
}
// 叠加类 wpe-prize-num（72 高覆盖）
{
  const src = fs.readFileSync(path.join(DIR, 'merchant-edit.wxss'), 'utf8')
  const m = src.match(/\.wpe-prize-num\s*\{([^}]*)\}/)
  if (!m) bad('.wpe-prize-num 找不到')
  else {
    const h = RPX((m[1].match(/[^-]height:\s*([^;]+);/) || [])[1])
    const pad = (m[1].match(/padding:\s*([^;]+);/) || [])[1] || ''
    const pt = RPX(pad.trim().split(/\s+/)[0])
    const sum = pt + 40 + pt
    if (Math.abs(sum - h) > 0.5) bad(`.wpe-prize-num: ${pt}+40+${pt}=${sum} ≠ height ${h}`)
    else ok(`.wpe-prize-num: ${pt} + 40 + ${pt} = ${h}（行高继承基类 40）`)
  }
}
// placeholder 类不得残留大行高 hack
for (const [file, cls] of [['merchant.wxss', '.wpm-ph'], ['watch-party.wxss', '.wp-form-ph']]) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8')
  const re = new RegExp(cls.replace('.', '\\.') + '\\s*\\{([^}]*)\\}')
  const m = src.match(re)
  if (m && /line-height/.test(m[1])) bad(`${file} ${cls}: 仍有 line-height hack`)
  else ok(`${cls}: 无 line-height hack`)
}

// ── 5：behavior 逻辑单测 ──
console.log('── behavior 单测 ──')
global.Behavior = (def) => def
const behavior = require(path.join(DIR, 'utils', 'composer-input-behavior.js'))
const makeCtx = (data) => {
  const setCalls = []
  return {
    data,
    setData(p) { setCalls.push(p); Object.assign(this.data, p) },
    _readDataPath: behavior.methods._readDataPath,
    onTextInput: behavior.methods.onTextInput,
    onCodeInput: behavior.methods.onCodeInput,
    setCalls
  }
}
const ev = (value, ds) => ({ detail: { value }, currentTarget: { dataset: ds } })

// 5.1 单行粘贴换行 → 替空格
{
  const c = makeCtx({ form: { title: '' } })
  c.onTextInput(ev('abc\ndef\r\nxyz', { path: 'form.title', single: '1' }))
  const got = c.data['form.title']
  got === 'abc def xyz' ? ok('单行换行→空格') : bad(`单行换行处理错: ${JSON.stringify(got)}`)
}
// 5.2 单行连续空格不合并、不回写多余 setData
{
  const c = makeCtx({ form: { title: 'a ' } })
  c.onTextInput(ev('a  ', { path: 'form.title', single: '1' }))
  const got = c.data['form.title']
  got === 'a  ' ? ok('连续空格保留（不改写受控值）') : bad(`连续空格被误改: ${JSON.stringify(got)}`)
}
// 5.3 多行不 strip
{
  const c = makeCtx({ form: { intro: '' } })
  c.onTextInput(ev('第一行\n第二行', { path: 'form.intro' }))
  const got = c.data['form.intro']
  got === '第一行\n第二行' ? ok('多行保留换行') : bad(`多行被误滤: ${JSON.stringify(got)}`)
}
// 5.4 码框：空格保留、换行滤除
{
  const c = makeCtx({ codeInput: '' })
  c.onCodeInput(ev('ab cd', {}))
  c.data.codeInput === 'ab cd' ? ok('码框空格保留（输入法安全）') : bad(`码框空格被滤: ${JSON.stringify(c.data.codeInput)}`)
  c.onCodeInput(ev('ab\ncd', {}))
  c.data.codeInput === 'abcd' ? ok('码框换行滤除') : bad(`码框换行处理错: ${JSON.stringify(c.data.codeInput)}`)
}
// 5.5 同值跳过仍生效
{
  const c = makeCtx({ form: { title: 'same' } })
  c.onTextInput(ev('same', { path: 'form.title', single: '1' }))
  c.setCalls.length === 0 ? ok('同值跳过 setData') : bad('同值仍触发 setData')
}

console.log(problems ? `\n结果：${problems} 个问题` : '\n审计通过：0 问题')
process.exit(problems ? 1 : 0)
