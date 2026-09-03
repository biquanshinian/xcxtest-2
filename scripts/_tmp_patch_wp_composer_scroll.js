const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const src = fs.readFileSync(path.join(ROOT, 'subpackages/watch-party/utils/composer-input-behavior.js'), 'utf8')
const shared = src
  .replace(
    '星问 AI 对话输入协议 —— 观礼分包副本（避免主包闲置 JS / 避免依赖整个 shared）',
    '星问 AI 对话输入协议（成熟源）——页面 / 组件共用 Behavior'
  )
  .replace(
    '成熟源：subpackages/shared/utils/composer-input-behavior.js（改协议时两边同步）',
    '观礼分包有同步副本：subpackages/watch-party/utils/composer-input-behavior.js'
  )
fs.writeFileSync(path.join(ROOT, 'subpackages/shared/utils/composer-input-behavior.js'), shared)

function patchWxml(rel) {
  const full = path.join(ROOT, rel)
  let s = fs.readFileSync(full, 'utf8')
  s = s.replace(/<scroll-view([^>]*class="page-scroll"[^>]*)>/g, (m, attrs) => {
    let a = attrs
    if (!/bindscroll=/.test(a)) a += ' bindscroll="onComposerScroll"'
    if (!/scroll-with-animation/.test(a)) a += ' scroll-with-animation="{{true}}"'
    if (!/scroll-top=/.test(a)) a += ' scroll-top="{{composerScrollTop}}"'
    return '<scroll-view' + a + '>'
  })
  let n = 0
  const base = path.basename(rel, '.wxml').replace(/-/g, '_')
  s = s.replace(/<(input|textarea)(\s+)([\s\S]*?)(\/?)>/g, (m, tag, sp, body, slash) => {
    if (/\bid\s*=/.test(body)) return m
    if (!/bindfocus="onInputFocus"/.test(body)) return m
    n += 1
    const pm = body.match(/data-path="([^"]+)"/)
    let id
    if (pm) {
      // parkingSpots[{{index}}].name → c_parkingSpots_{{index}}_name（列表项 id 唯一）
      id = 'c_' + pm[1]
        .replace(/\[\{\{index\}\}\]/g, '_{{index}}_')
        .replace(/[^A-Za-z0-9_{}]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
    } else {
      id = 'c_' + base + '_' + n
    }
    return '<' + tag + sp + 'id="' + id + '" ' + body + slash + '>'
  })
  fs.writeFileSync(full, s)
  console.log('patched', rel, 'focusable=', n)
}

;['watch-party', 'gacha', 'merchant', 'merchant-edit'].forEach((p) => {
  patchWxml('subpackages/watch-party/' + p + '.wxml')
})
