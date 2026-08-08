function fixSplashPosterUrl(url) {
  if (!url || typeof url !== 'string') return ''
  let u = url.trim()
  if (!/ci-process=snapshot/i.test(u)) return u
  u = u.replace(/([?&])scaletype=[^&]*/gi, '$1')
  if (/[?&]width=\d+/i.test(u) && /[?&]height=[1-9]\d*/i.test(u)) {
    u = u.replace(/([?&])height=[1-9]\d*/i, '$1height=0')
  }
  u = u.replace(/\?&/g, '?').replace(/&&/g, '&').replace(/[?&]$/g, '')
  return u
}
function needs(url) {
  const u = String(url || '')
  if (!u) return true
  if (!/ci-process=snapshot/i.test(u)) return true
  if (/[?&]scaletype=/i.test(u)) return true
  const hm = u.match(/[?&]height=(\d+)/i)
  if (hm && Number(hm[1]) > 0) return true
  return false
}
const old = 'https://x/a.mp4?ci-process=snapshot&time=0.5&format=jpg&width=720&height=1280&scaletype=cover'
const neu = 'https://x/a.mp4?ci-process=snapshot&time=0.5&format=jpg&width=1080&height=0'
const fixed = fixSplashPosterUrl(old)
let pass = 0, fail = 0
function check(n, a, e) {
  const ok = Object.is(a, e)
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + ': ' + JSON.stringify(a))
  ok ? pass++ : fail++
}
check('改写 height=0', /height=0/.test(fixed), true)
check('去掉 scaletype', /scaletype/i.test(fixed), false)
check('旧 URL 需刷新', needs(old), true)
check('新 URL 不需刷新', needs(neu), false)
check('保留 width', /width=720/.test(fixed), true)
console.log(pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
