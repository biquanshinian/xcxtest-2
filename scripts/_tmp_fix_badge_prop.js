const fs = require('fs')

const p = 'subpackages/profile-extra/components/badge-modal/index.wxml'
let s = fs.readFileSync(p, 'utf8')
s = s.replace(/\{\{data\./g, '{{badge.')
fs.writeFileSync(p, s)

let page = fs.readFileSync('pages/profile/profile.wxml', 'utf8')
page = page.replace('data="{{badgeModalData}}"', 'badge="{{badgeModalData}}"')
fs.writeFileSync('pages/profile/profile.wxml', page)

for (const f of ['pages/profile/profile.wxml', 'pages/profile/profile.wxss']) {
  const b = fs.readFileSync(f)
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    fs.writeFileSync(f, b.slice(3))
    console.log('stripped BOM', f)
  } else {
    console.log('no BOM', f)
  }
}
console.log('done')
