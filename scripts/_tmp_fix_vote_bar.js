const fs = require('fs')

let page = fs.readFileSync('pages/index/index.wxml', 'utf8')
const s = page.indexOf('<view class="vote-bar-row"')
if (s < 0) {
  console.log('no vote-bar-row in page')
  process.exit(0)
}

let depth = 0
let end = -1
const slice = page.slice(s)
const re = /<\/?view\b[^>]*>/g
let m
while ((m = re.exec(slice))) {
  if (m[0].startsWith('</view')) {
    depth--
    if (depth === 0) {
      end = s + m.index + m[0].length
      break
    }
  } else if (!/\/>$/.test(m[0])) {
    depth++
  }
}

const bar = page.slice(s, end)
const barComp = bar
  .replace(/voteTotal/g, 'total')
  .replace(/voteGePct/g, 'gePct')
  .replace(/voteBugePct/g, 'bugePct')

const compPath = 'subpackages/index-extra/components/index-vote-box/index.wxml'
let comp = fs.readFileSync(compPath, 'utf8')
if (!comp.includes('vote-bar-row')) {
  comp = comp.trimEnd() + '\n' + barComp + '\n'
  fs.writeFileSync(compPath, comp)
}

let removeStart = page.lastIndexOf('<!-- 投票比例条', s)
if (removeStart < 0) removeStart = s
let removeEnd = end
while (removeEnd < page.length && (page[removeEnd] === '\n' || page[removeEnd] === ' ')) removeEnd++
page = page.slice(0, removeStart) + page.slice(removeEnd)
fs.writeFileSync('pages/index/index.wxml', page)
console.log('ok, page KB', (page.length / 1024).toFixed(1))
