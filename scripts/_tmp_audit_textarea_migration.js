/**
 * 输入组件混合架构专项审计
 * 架构约定（iOS 同层渲染限制的最优解）：
 *   - 静态渲染区（页面加载即存在/一次性 wx:if）：单行 textarea（同层稳定不漂移）
 *   - wx:for 动态区（停车点/奖品，反复增删移）：input（动态 textarea 同层易失败
 *     → 整组件退化原生浮层：不显示+内容乱飘）；且必须无 always-embed（强制同层
 *     在实例多时静默失败），必须有稳定 wx:key="_k"
 * 校验：
 * 1. input 只允许出现在 merchant-edit 动态区，恰 6 个，无 always-embed/textarea 专属属性
 * 2. 单行 textarea（data-single）属性完整性；多行 textarea 不带 data-single、可换行
 * 3. wxss 高度公式：height == padding-top + line-height + padding-bottom（border-box）
 * 4. wx:for 行 key 为 _k（稳定 key，防原生组件状态串行）
 * 5. behavior 逻辑单测：strip 只滤换行、不并空格、多行不 strip、码框保空格
 */
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'subpackages', 'watch-party')
let problems = 0
const bad = (msg) => { problems++; console.log('  ✗ ' + msg) }
const ok = (msg) => console.log('  ✓ ' + msg)

// ── 1+2：wxml 扫描 ──
console.log('── WXML 扫描 ──')
const wxmls = fs.readdirSync(DIR).filter((f) => f.endsWith('.wxml'))
let singles = 0
let multis = 0
let dynInputs = 0
for (const f of wxmls) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8')
  const inputs = src.match(/<input\b[\s\S]*?\/>/g) || []
  if (f === 'merchant-edit.wxml') {
    for (const t of inputs) {
      dynInputs++
      const idm = t.match(/id="([^"]*)"/)
      const id = (idm && idm[1]) || t.slice(0, 50)
      if (!/\{\{index\}\}/.test(String((idm && idm[1]) || ''))) bad(`${f} ${id}: input 只允许用于 wx:for 动态行（id 应含 {{index}}）`)
      if (/always-embed/.test(t)) bad(`${f} ${id}: 动态区 input 不得用 always-embed（强制同层在实例多时静默失败）`)
      for (const attr of ['show-confirm-bar', 'disable-default-padding', 'data-single', 'auto-height']) {
        if (t.indexOf(attr) >= 0) bad(`${f} ${id}: input 带 textarea 专属属性 ${attr}`)
      }
      for (const attr of ['maxlength=', 'bindinput=', 'value=', 'cursor-spacing=']) {
        if (t.indexOf(attr) < 0) bad(`${f} ${id}: input 缺 ${attr}`)
      }
    }
  } else if (inputs.length) {
    bad(`${f}: 不应有 <input>（静态区应为单行 textarea），共 ${inputs.length} 个`)
  }
  // 多行 textarea 用 auto-height 时高度随内容变，静态区可接受；单行禁用已在下方校验

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
      // 小程序无焦点链，next/go 等点击后只收键盘 → 双端语义误导，只许 done
      if (/confirm-type="(?!done)/.test(t)) bad(`${f} ${id}: 单行 confirm-type 应为 done`)
      if (/[\s"](type)="(?!2d)/.test(t)) bad(`${f} ${id}: 单行残留 type=`)
      if (/always-embed/.test(t)) bad(`${f} ${id}: 残留 always-embed`)
      if (/auto-height/.test(t)) bad(`${f} ${id}: 单行不应有 auto-height`)
      if (/\{\{index\}\}/.test(String((idm && idm[1]) || ''))) bad(`${f} ${id}: wx:for 动态行不得用 textarea（iOS 同层易失败）`)
    } else {
      multis++
      if (/confirm-type="(done|next|go|send|search)"/.test(t)) bad(`${f} ${id}: 多行不应设非 return 的 confirm-type（回车要能换行）`)
    }
  }
}
// 数量仅作信息展示（并行开发中会增减），架构规则已逐个校验
ok(`静态单行 textarea ${singles} 个，多行 ${multis} 个，动态区 input ${dynInputs} 个`)
if (dynInputs !== 6) bad(`动态 input 数量 ${dynInputs} ≠ 6（停车点 3 + 奖品 3）`)

// wx:for 行稳定 key
{
  const src = fs.readFileSync(path.join(DIR, 'merchant-edit.wxml'), 'utf8')
  const parks = src.match(/wx:for="\{\{(parkingSpots|prizes)\}\}"\s+wx:key="([^"]*)"/g) || []
  if (parks.length !== 2) bad(`停车点/奖品 wx:for 应有 2 处，实际 ${parks.length}`)
  for (const p of parks) {
    if (!/wx:key="_k"/.test(p)) bad(`动态行 key 非 _k: ${p}`)
  }
  if (parks.length === 2 && parks.every((p) => /wx:key="_k"/.test(p))) ok('停车点/奖品 wx:for 均用稳定 key _k')
  const js = fs.readFileSync(path.join(DIR, 'merchant-edit.js'), 'utf8')
  const kCount = (js.match(/_k: nextRowKey\(\)/g) || []).length
  kCount === 4 ? ok('_k 注入 4 处（加载×2 + 新增×2）') : bad(`_k 注入 ${kCount} 处 ≠ 4`)
  if (/_k/.test(js.slice(js.indexOf('const prizes = (this.data.prizes'), js.indexOf('const prizes = (this.data.prizes') + 500))) bad('提交清洗疑似带 _k')
  else ok('提交清洗不带 _k（不进云端）')
}

// 键盘垫高平台开关：behavior 源码必须有 iOS 判定（Android 垫高会放大聚焦滚动）
{
  const src = fs.readFileSync(path.join(DIR, 'utils', 'composer-input-behavior.js'), 'utf8')
  if (/isIOS/.test(src) && /if \(!isIOS\) return/.test(src)) ok('键盘垫高带 iOS 平台开关（Android 关闭）')
  else bad('键盘垫高缺 iOS 平台开关')
}

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
  ['merchant.wxss', '.wpm-coop-input', 88],
  ['merchant-apply.wxss', '.wpa-input', 88],
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
const behaviorPath = path.join(DIR, 'utils', 'composer-input-behavior.js')
const loadBehavior = (platform) => {
  delete require.cache[require.resolve(behaviorPath)]
  global.wx = { getDeviceInfo: () => ({ platform }) }
  return require(behaviorPath)
}
const behavior = loadBehavior('ios')
const makeCtxOf = (b, data) => {
  const setCalls = []
  return {
    data,
    setData(p) { setCalls.push(p); Object.assign(this.data, p) },
    _readDataPath: b.methods._readDataPath,
    onTextInput: b.methods.onTextInput,
    onCodeInput: b.methods.onCodeInput,
    onInputKeyboardHeightChange: b.methods.onInputKeyboardHeightChange,
    onInputBlur: b.methods.onInputBlur,
    _scheduleKbPadReset: b.methods._scheduleKbPadReset,
    setCalls
  }
}
const makeCtx = (data) => makeCtxOf(behavior, data)
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
// 5.6 键盘垫高：iOS 弹起立即垫、归零走延迟、切框清延迟；Android 完全不垫
{
  const ca = makeCtxOf(loadBehavior('android'), { keyboardHeight: 0 })
  ca.onInputKeyboardHeightChange({ detail: { height: 306 } })
  ca.data.keyboardHeight === 0 && ca.setCalls.length === 0
    ? ok('Android 不垫高（防聚焦时页面猛上滚）')
    : bad(`Android 误垫高: ${ca.data.keyboardHeight}`)
  const behaviorIos = loadBehavior('ios')
  const c = makeCtxOf(behaviorIos, { keyboardHeight: 0 })
  c.onInputKeyboardHeightChange({ detail: { height: 306 } })
  c.data.keyboardHeight === 306 ? ok('iOS 键盘弹起立即垫高') : bad(`垫高失败: ${c.data.keyboardHeight}`)
  c.onInputKeyboardHeightChange({ detail: { height: 0 } })
  c.data.keyboardHeight === 306 && c._kbPadTimer ? ok('归零走延迟回收（不立即闪跳）') : bad('归零处理异常')
  c.onInputKeyboardHeightChange({ detail: { height: 306 } })
  !c._kbPadTimer ? ok('切换输入框时清除回收定时器') : bad('回收定时器未清除')
  c.onInputBlur()
  c._kbPadTimer ? ok('失焦兜底安排回收') : bad('失焦未安排回收')
  clearTimeout(c._kbPadTimer)
  setTimeout(() => {
    const c2 = makeCtx({ keyboardHeight: 306 })
    c2._scheduleKbPadReset()
    setTimeout(() => {
      c2.data.keyboardHeight === 0 ? ok('延迟后垫高归零') : bad(`延迟归零失败: ${c2.data.keyboardHeight}`)
      console.log(problems ? `\n结果：${problems} 个问题` : '\n审计通过：0 问题')
      process.exit(problems ? 1 : 0)
    }, 320)
  }, 0)
}
