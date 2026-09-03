// progress 拆分一致性校验：
// 1) wxml 所有 bind*/catch* 处理器必须在 progress.js（含委托）中存在
// 2) 委托列表方法必须在 progress-lazy.js 中定义
// 3) progress.js 中 this.xxx( 调用的方法必须在页面或委托中存在
// 4) progress-lazy.js 中 this.xxx( 调用的方法必须在 lazy 或页面中存在
const fs = require('fs')
const pj = fs.readFileSync('pages/progress/progress.js', 'utf8')
const lz = fs.readFileSync('subpackages/progress-extra/utils/progress-lazy.js', 'utf8')
const wxml = fs.readFileSync('pages/progress/progress.wxml', 'utf8')

function methodNames(src) {
  const names = new Set()
  const re = /^  (async )?([A-Za-z_$][\w$]*)\s*\(/gm
  let m
  while ((m = re.exec(src))) names.add(m[2])
  return names
}
const pageMethods = methodNames(pj)
const lazyMethods = methodNames(lz)
const delegates = [...(pj.match(/PROGRESS_LAZY_METHODS = \[([\s\S]*?)\]/)[1].matchAll(/'([\w$]+)'/g))].map((m) => m[1])

// 1) wxml handlers
const handlers = [...new Set([...wxml.matchAll(/(?:bind|catch|mut-bind)[:\w-]*?="([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]))]
const missingHandlers = handlers.filter((h) => !pageMethods.has(h) && !delegates.includes(h) && !/^\{\{/.test(h))
console.log('wxml 处理器:', handlers.length, '| 缺失:', missingHandlers.join(', ') || '(无)')

// 2) delegates in lazy
const missingDelegates = delegates.filter((d) => !lazyMethods.has(d))
console.log('委托方法:', delegates.length, '| lazy 缺失:', missingDelegates.join(', ') || '(无)')

// 3) & 4) this.xxx( 调用
function thisCalls(src) {
  return [...new Set([...src.matchAll(/this\.([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]))]
}
const known = new Set([...pageMethods, ...lazyMethods, ...delegates, 'setData', 'getTabBar', 'createSelectorQuery', 'triggerEvent', 'selectComponent', 'getOpenerEventChannel', 'animate'])
const badPage = thisCalls(pj).filter((c) => !known.has(c))
const badLazy = thisCalls(lz).filter((c) => !known.has(c))
console.log('progress.js 未知 this 调用:', badPage.join(', ') || '(无)')
console.log('progress-lazy.js 未知 this 调用:', badLazy.join(', ') || '(无)')
