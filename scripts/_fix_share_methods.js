/**
 * 仅恢复被截坏的 onShareAppMessage（onShareTimeline / onAddToFavorites 完好）
 */
const fs = require('fs')
const { execSync } = require('child_process')

const indexPath = 'pages/index/index.js'
let s = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n')

const head = execSync('git show HEAD:pages/index/index.js', {
  encoding: 'utf8',
  maxBuffer: 30 * 1024 * 1024
}).replace(/\r\n/g, '\n')

// 从 HEAD 提取完整 onShareAppMessage（含前置 JSDoc）
const shareStart = head.lastIndexOf('\n  /**\n   * 分享给好友', head.indexOf('\n  onShareAppMessage('))
const shareMethodStart = head.indexOf('\n  onShareAppMessage(')
const timelineStart = head.indexOf('\n  /**\n   * 分享到朋友圈', shareMethodStart)
if (shareStart < 0 || shareMethodStart < 0 || timelineStart < 0) {
  throw new Error('cannot locate onShareAppMessage in HEAD')
}
let shareBlock = head.slice(shareStart + 1, timelineStart).trimEnd()
if (!shareBlock.endsWith(',')) shareBlock += ','

// 当前文件：noop 之后到 onShareTimeline JSDoc 之前整段替换
const curNoopEnd = s.indexOf('\n  noop() {},') + '\n  noop() {},'.length
const curTimelineDoc = s.indexOf('\n  /**\n   * 分享到朋友圈')
if (curNoopEnd < 10 || curTimelineDoc < 0) {
  // fallback: onShareTimeline method
  const alt = s.indexOf('\n  onShareTimeline(')
  if (alt < 0) throw new Error('cannot locate timeline in current')
  // find JSDoc before it
  const doc = s.lastIndexOf('\n  /**', alt)
  const cutTo = doc >= 0 && alt - doc < 500 ? doc : alt
  s = s.slice(0, curNoopEnd) + '\n\n' + shareBlock + '\n' + s.slice(cutTo)
} else {
  s = s.slice(0, curNoopEnd) + '\n\n' + shareBlock + '\n' + s.slice(curTimelineDoc)
}

if ((s.match(/onShareAppMessage\s*\(/g) || []).length !== 1) {
  throw new Error('onShareAppMessage count=' + (s.match(/onShareAppMessage\s*\(/g) || []).length)
}
if ((s.match(/onShareTimeline\s*\(/g) || []).length !== 1) {
  throw new Error('onShareTimeline count wrong')
}
if ((s.match(/\bresetVoteData\s*\(/g) || []).length > 0 && !s.includes('VOTE_METHODS')) {
  // resetVoteData should only be in delegate list string or not in Page body
}
// ensure vote methods weren't re-injected into Page body as real methods
const pageBody = s.slice(s.indexOf('Page({'))
if (/\n  resetVoteData\s*\([^)]*\)\s*\{/.test(pageBody)) {
  throw new Error('accidentally re-injected resetVoteData method body')
}

fs.writeFileSync(indexPath, s)
new Function(s)
console.log('fixed OK', (s.length / 1024).toFixed(1) + 'KB')
console.log('has onShareAppMessage', /onShareAppMessage\s*\(/.test(s))
