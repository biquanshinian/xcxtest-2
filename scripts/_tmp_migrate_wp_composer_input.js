/**
 * 观礼页输入迁移到星问 AI composer-input 协议（跑一次）
 * node scripts/_tmp_migrate_wp_composer_input.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DIR = path.join(ROOT, 'subpackages/watch-party')
const ATTR =
  'cursor-spacing="24" hold-keyboard="{{true}}" adjust-position="{{false}}" ' +
  'bindfocus="onInputFocus" bindblur="onInputBlur" bindkeyboardheightchange="onInputKeyboardHeightChange"'

function patchAttrs(attrs) {
  let a = attrs
  a = a.replace(/\s+hold-keyboard(?:=(?:"[^"]*"|'\{\{[^}]*\}\}'|\{\{[^}]*\}\}))?/g, '')
  a = a.replace(/\s+adjust-position(?:=(?:"[^"]*"|'\{\{[^}]*\}\}'|\{\{[^}]*\}\}))?/g, '')
  a = a.replace(/\s+cursor-spacing="[^"]*"/g, '')
  a = a.replace(/\s+bindfocus="[^"]*"/g, '')
  a = a.replace(/\s+bindblur="[^"]*"/g, '')
  a = a.replace(/\s+bindkeyboardheightchange="[^"]*"/g, '')
  return a.replace(/\s+$/, '') + ' ' + ATTR
}

function patchFile(name) {
  const rel = path.join(DIR, name)
  let s = fs.readFileSync(rel, 'utf8')
  const before = s
  s = s.replace(
    /<view class="page \{\{themeClass\}\}">/,
    '<view class="page {{themeClass}}" style="padding-bottom: {{keyboardHeight}}px;">'
  )
  s = s.replace(/ binddragstart="onFormDragStart"/g, '')
  s = s.replace(/ bindscroll="onFormScroll"/g, '')
  s = s.replace(/<input([^>]*?)(\s*\/?>)/g, (_, attrs, end) => '<input' + patchAttrs(attrs) + end)
  s = s.replace(/<textarea([^>]*?)(\s*\/?>)/g, (_, attrs, end) => '<textarea' + patchAttrs(attrs) + end)
  s = s.replace(
    /预约表单：与商家编辑页同一套 data-path \+ onTextInput；滑动收键盘防光标飘/,
    '预约表单：复用星问 AI composer-input（data-path + onTextInput）'
  )
  if (s !== before) {
    fs.writeFileSync(rel, s)
    console.log('patched', name)
  } else {
    console.log('nochange', name)
  }
}

;['watch-party.wxml', 'merchant-edit.wxml', 'gacha.wxml', 'merchant.wxml'].forEach(patchFile)
