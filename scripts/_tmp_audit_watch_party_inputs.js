/**
 * 观礼输入审计：必须复用星问 AI composer-input-behavior，旧滑动收键盘逻辑不得残留
 * 运行：node scripts/_tmp_audit_watch_party_inputs.js
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
let issues = 0
let warns = 0

function issue(msg) { issues++; console.log('  ✗ [问题] ' + msg) }
function warn(msg) { warns++; console.log('  ⚠ [提示] ' + msg) }
function pass(msg) { console.log('  ✓ ' + msg) }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }

const PAGES = ['watch-party', 'gacha', 'merchant', 'merchant-edit']
const ALL = ['watch-party', 'gacha', 'album', 'screen', 'merchant', 'merchant-edit']

console.log('── 共享 Behavior（星问同源）──')
const beh = read('subpackages/shared/utils/composer-input-behavior.js')
const behWp = read('subpackages/watch-party/utils/composer-input-behavior.js')
if (!/module\.exports = Behavior/.test(beh)) issue('composer-input-behavior 非 Behavior')
else pass('composer-input-behavior 已导出')
if (beh.replace(/\r\n/g, '\n').replace(/^\/\*\*[\s\S]*?\*\/\n/, '') !==
    behWp.replace(/\r\n/g, '\n').replace(/^\/\*\*[\s\S]*?\*\/\n/, '')) {
  issue('shared 与 watch-party 的 composer-input-behavior 实现不一致')
} else pass('composer-input-behavior 两边实现一致')
for (const key of [
  '_updateKeyboardLayout',
  'onInputFocus',
  'onInputKeyboardHeightChange',
  'onInputBlur',
  'dismissKeyboard',
  'onComposerScroll',
  '_composerScrollAnchorIntoView',
  'onTextInput',
  'onCodeInput',
  'wx.onKeyboardHeightChange'
]) {
  if (!beh.includes(key)) issue('behavior 缺 ' + key)
  else pass('behavior 含 ' + key)
}
if (!/composerScrollTop/.test(beh)) issue('behavior 缺 composerScrollTop')
else pass('behavior 含 composerScrollTop')

const ai = read('subpackages/shared/components/ai-chat/index.js')
if (!/composer-input-behavior/.test(ai) || !/behaviors:\s*\[composerInput\]/.test(ai)) {
  issue('星问 AI 组件未挂载 composerInput behavior')
} else pass('星问 AI 组件已挂载 composerInput')
if (!/_applyComposerKeyboard/.test(ai)) issue('星问缺 _applyComposerKeyboard 半屏/详情适配')
else pass('星问保留 _applyComposerKeyboard 适配')
if (/wx\.onKeyboardHeightChange\(this\._kbHandler\)/.test(ai) && !/composer-input-behavior/.test(ai)) {
  issue('星问仍自行挂键盘监听（应走 behavior）')
} else pass('星问键盘监听收口到 behavior')

console.log('── 语法检查 ──')
for (const p of ALL) {
  try {
    execSync(`node --check "${path.join(ROOT, 'subpackages/watch-party', p + '.js')}"`, { stdio: 'pipe' })
    pass(p + '.js 语法通过')
  } catch (e) {
    issue(p + '.js 语法错误')
  }
}
try {
  execSync(`node --check "${path.join(ROOT, 'subpackages/shared/utils/composer-input-behavior.js')}"`, { stdio: 'pipe' })
  execSync(`node --check "${path.join(ROOT, 'subpackages/watch-party/utils/composer-input-behavior.js')}"`, { stdio: 'pipe' })
  pass('composer-input-behavior.js 语法通过')
} catch (e) {
  issue('composer-input-behavior.js 语法错误')
}

console.log('── 观礼页挂载 + 删除旧逻辑 ──')
for (const p of PAGES) {
  const js = read(`subpackages/watch-party/${p}.js`)
  if (!/composer-input-behavior/.test(js) || !/composerInput/.test(js)) {
    issue(p + '.js 未挂载 composerInput')
  } else pass(p + '.js 已挂载 composerInput')
  if (/onFormDragStart|onFormScroll/.test(js)) {
    issue(p + '.js 仍残留旧滑动收键盘命名（应走 onComposerScroll）')
  } else pass(p + '.js 无旧滑动收键盘命名')
}

const mejs = read('subpackages/watch-party/merchant-edit.js')
if (!/_onTextInputPatch/.test(mejs)) issue('merchant-edit 缺火箭缩略图 _onTextInputPatch')
else pass('merchant-edit _onTextInputPatch 保留')
if (/onTextInput\s*\(e\)\s*\{/.test(mejs)) issue('merchant-edit 仍自定义 onTextInput（应走 behavior）')
else pass('merchant-edit 无重复 onTextInput')

const wpjs = read('subpackages/watch-party/watch-party.js')
if (/onTextInput\s*\(e\)\s*\{/.test(wpjs)) issue('watch-party 仍自定义 onTextInput')
else pass('watch-party 无重复 onTextInput')

for (const p of ['gacha', 'merchant']) {
  const js = read(`subpackages/watch-party/${p}.js`)
  if (/onCodeInput\s*\(e\)\s*\{/.test(js)) issue(p + ' 仍自定义 onCodeInput')
  else pass(p + ' 无重复 onCodeInput')
}

console.log('── WXML：星问输入属性协议 ──')
const need = [
  ['adjust-position="{{false}}"', 'adjust-position=false'],
  ['hold-keyboard="{{true}}"', 'hold-keyboard'],
  ['cursor-spacing="24"', 'cursor-spacing=24'],
  ['bindfocus="onInputFocus"', 'bindfocus'],
  ['bindblur="onInputBlur"', 'bindblur'],
  ['bindkeyboardheightchange="onInputKeyboardHeightChange"', 'keyboardheightchange']
]
for (const p of PAGES) {
  const wxml = read(`subpackages/watch-party/${p}.wxml`)
  const inputs = (wxml.match(/<(input|textarea)\b[\s\S]*?>/g) || [])
  if (!inputs.length) {
    warn(p + ' 无 input/textarea')
    continue
  }
  let ok = true
  for (const tag of inputs) {
    for (const [frag, label] of need) {
      if (!tag.includes(frag)) {
        issue(p + ' 某控件缺 ' + label)
        ok = false
        break
      }
    }
    if (!ok) break
  }
  if (ok) pass(p + ': ' + inputs.length + ' 个控件属性对齐星问')
  if (!/padding-bottom:\s*\{\{keyboardHeight\}\}px/.test(wxml)) {
    issue(p + ' 根节点未用 keyboardHeight padding 上收')
  } else pass(p + ' keyboardHeight padding 上收')
  if (!/bindscroll="onComposerScroll"/.test(wxml)) {
    issue(p + ' scroll-view 未 bindscroll=onComposerScroll')
  } else pass(p + ' 滑动收键盘 bindscroll')
  if (!/scroll-top="\{\{composerScrollTop\}\}"/.test(wxml)) {
    issue(p + ' scroll-view 未绑 composerScrollTop')
  } else pass(p + ' scroll-top 滚入可视区')
  const focusables = (wxml.match(/<(input|textarea)\b[\s\S]*?>/g) || [])
    .filter((tag) => /bindfocus="onInputFocus"/.test(tag))
  const noId = focusables.filter((tag) => !/\bid\s*=/.test(tag))
  if (noId.length) issue(p + ' 有 ' + noId.length + ' 个聚焦控件缺 id')
  else pass(p + ' 聚焦控件均有 id')
  if (/cursor-spacing="220"/.test(wxml)) issue(p + ' 仍用旧 cursor-spacing=220')
  else pass(p + ' 无旧 cursor-spacing=220')
}

console.log('── 结果 ──')
console.log(`问题 ${issues} · 提示 ${warns}`)
if (issues > 0) process.exit(1)
