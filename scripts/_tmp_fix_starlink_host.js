const fs = require('fs')
const p = 'pages/monitor/monitor.js'
let s = fs.readFileSync(p, 'utf8')

if (!s.includes('_getStarlinkHost')) {
  s = s.replace(
    '// ========== Starlink 卫星实时分布 ==========',
    `// ========== Starlink 卫星实时分布 ==========
  /** canvas 在 monitor-core-sections 分包组件内，查询/观察须挂组件实例 */
  _getStarlinkHost() {
    return (
      this.selectComponent('#monitorCoreSections') ||
      this.selectComponent('monitor-core-sections') ||
      this
    )
  },
`
  )
}

s = s.replace(
  'await starlinkRenderer.bindCanvas(this)',
  'await starlinkRenderer.bindCanvas(this._getStarlinkHost())'
)

s = s.replace(
  `const observer = wx.createIntersectionObserver(this)
      observer.relativeToViewport().observe('#starlinkCanvas', (res) => {`,
  `const host = this._getStarlinkHost()
      const observer = wx.createIntersectionObserver(host)
      observer.relativeToViewport().observe('#starlinkCanvas', (res) => {`
)

fs.writeFileSync(p, s)

let wxml = fs.readFileSync('pages/monitor/monitor.wxml', 'utf8')
if (!wxml.includes('id="monitorCoreSections"')) {
  wxml = wxml.replace(
    '<monitor-core-sections\n',
    '<monitor-core-sections\n      id="monitorCoreSections"\n'
  )
  fs.writeFileSync('pages/monitor/monitor.wxml', wxml)
}

// carousel id for video context
let iw = fs.readFileSync('pages/index/index.wxml', 'utf8')
if (!iw.includes('id="indexCarousel"') && iw.includes('<index-carousel')) {
  iw = iw.replace('<index-carousel\n', '<index-carousel\n      id="indexCarousel"\n')
  fs.writeFileSync('pages/index/index.wxml', iw)
}
let cu = fs.readFileSync('subpackages/index-extra/utils/index-carousel.js', 'utf8')
cu = cu.replace(
  /this\.selectComponent\("index-carousel"\) \|\| this\.selectComponent\("\.index-carousel"\)/g,
  'this.selectComponent("#indexCarousel") || this.selectComponent("index-carousel")'
)
fs.writeFileSync('subpackages/index-extra/utils/index-carousel.js', cu)
console.log('starlink+carousel host ok')
