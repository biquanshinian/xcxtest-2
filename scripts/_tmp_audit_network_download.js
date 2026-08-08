/**
 * 网络性能：downloadFile / 外链 / 双通道预热 回归审计
 */
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) {
    pass += 1
    console.log('PASS  ' + name)
  } else {
    fail += 1
    console.log('FAIL  ' + name + (extra ? ' → ' + extra : ''))
  }
}

const failCache = fs.readFileSync(path.join(ROOT, 'utils/download-fail-cache.js'), 'utf8')
check('软退避 shouldSkipDownload', /shouldSkipDownload/.test(failCache) && /SOFT_FAIL_TTL_MS/.test(failCache))
check('非 404 走软退避', /markDownloadSoftFailed/.test(failCache))

const icon = fs.readFileSync(path.join(ROOT, 'utils/icon-cache.js'), 'utf8')
check('media 仅自有 CDN 可落盘', /isOwnCdnUrl\(u\)/.test(icon) && /isRemoteCacheableImageUrl/.test(icon))
check('外链 getCachedMediaImage 走代理', /proxiedImageUrl\(raw\)/.test(icon))
check('火箭后台下载禁外链', /_downloadRocketInBackground[\s\S]*!isOwnCdnUrl/.test(icon))
check('preload 拆分 badge/avatar', /badgeUrls/.test(icon) && /avatarUrls/.test(icon))
check('preload 不再双通道同一批 urls', !/preloadMediaImages\(urls[\s\S]{0,40}preloadIcons\(urls\)/.test(icon))

const imgCfg = fs.readFileSync(path.join(ROOT, 'utils/image-config.js'), 'utf8')
check('火箭不再 wrapCosHttpsUrl 双套', /getCachedRocketConfig\(toCdnUrl\(u\)\)/.test(imgCfg))
check('火箭无 wrapCosHttpsUrl 嵌套', !/getCachedRocketConfig\(wrapCosHttpsUrl/.test(imgCfg))

const agency = fs.readFileSync(path.join(ROOT, 'utils/agency-logo-cache.js'), 'utf8')
check('logo 外链代理', /proxiedImageUrl/.test(agency))
check('logo 落盘仅自有 CDN', /persistAgencyLogoAfterRemoteLoad[\s\S]*!isOwnCdnUrl\(u\)/.test(agency))

// 运行时：软退避逻辑
const mod = require('../utils/download-fail-cache.js')
mod.markDownloadSoftFailed('https://example.com/a.jpg')
check('runtime soft fail', mod.shouldSkipDownload('https://example.com/a.jpg'))
mod.markDownloadFailed('https://example.com/b.jpg', 0)
check('runtime status 0 soft', mod.shouldSkipDownload('https://example.com/b.jpg'))
check('runtime 404 permanent', (mod.markDownloadFailed('https://example.com/c.jpg', 404), mod.isDownloadBlacklisted('https://example.com/c.jpg')))

const { isOwnCdnUrl, proxiedImageUrl } = require('../utils/ll2-image.js')
check('DO 非自有', !isOwnCdnUrl('https://thespacedevs-prod.nyc3.digitaloceanspaces.com/x.jpg'))
check('COS 自有', isOwnCdnUrl('https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/x.jpg'))
const proxied = proxiedImageUrl('https://thespacedevs-prod.nyc3.digitaloceanspaces.com/x.jpg')
check('DO 可代理', /api\.marsx\.com\.cn\/image\?url=/.test(proxied))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
