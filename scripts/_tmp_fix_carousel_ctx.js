const fs = require('fs')
const p = 'subpackages/index-extra/utils/index-carousel.js'
let s = fs.readFileSync(p, 'utf8')

function hostExpr(idExpr) {
  return (
    'const host = (typeof this.selectComponent === "function" && (this.selectComponent("index-carousel") || this.selectComponent(".index-carousel"))) || this;\n' +
    `    const ctx = wx.createVideoContext(\`carousel-video-\${${idExpr}}\`, host)`
  )
}

s = s.replace(
  /const ctx = wx\.createVideoContext\(`carousel-video-\$\{index\}`, this\)/g,
  hostExpr('index')
)
s = s.replace(
  /const ctx = wx\.createVideoContext\(`carousel-video-\$\{current\}`, this\)/g,
  hostExpr('current')
)

if (!s.includes('const ds = (e && e.detail)')) {
  s = s.replace(
    'onCarouselImageError(e) {\n    if (this.data.carouselLoadFailed) return\n\n    const index = Number(e.currentTarget.dataset.index)',
    'onCarouselImageError(e) {\n    if (this.data.carouselLoadFailed) return\n\n    const ds = (e && e.detail) || {}\n    const index = Number(ds.index != null ? ds.index : e.currentTarget.dataset.index)'
  )
  s = s.replace(
    'previewCarouselImage(e) {\n    const current = e.currentTarget.dataset.url',
    'previewCarouselImage(e) {\n    const ds = (e && e.detail) || {}\n    const current = ds.url != null ? ds.url : e.currentTarget.dataset.url'
  )
}

fs.writeFileSync(p, s)
console.log('ok')
