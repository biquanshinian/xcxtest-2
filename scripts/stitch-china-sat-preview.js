/**
 * 拼一张中国区卫星底图，给监控预览卡用（避免列表里塞原生 map）。
 * 瓦片：Esri World Imagery（与常见卫星图同源影像）。
 */
const fs = require('fs')
const https = require('https')
const path = require('path')
const sharp = require('sharp')

const Z = 5
const MIN_LON = 73.6
const MAX_LON = 135
const MIN_LAT = 18.2
const MAX_LAT = 53.5

function lon2x(lon, z) {
  return ((lon + 180) / 360) * Math.pow(2, z)
}
function lat2y(lat, z) {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z)
}

const x0 = Math.floor(lon2x(MIN_LON, Z))
const x1 = Math.floor(lon2x(MAX_LON, Z))
const y0 = Math.floor(lat2y(MAX_LAT, Z))
const y1 = Math.floor(lat2y(MIN_LAT, Z))
const cols = x1 - x0 + 1
const rows = y1 - y0 + 1
const tile = 256

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          if (res.statusCode >= 400) reject(new Error('HTTP ' + res.statusCode + ' ' + url))
          else resolve(Buffer.concat(chunks))
        })
      })
      .on('error', reject)
  })
}

async function main() {
  const outDir = path.join(__dirname, '..', 'subpackages', 'monitor-pages', 'images', 'space-notices')
  fs.mkdirSync(outDir, { recursive: true })
  const composites = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const url =
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' +
        Z +
        '/' +
        y +
        '/' +
        x
      process.stdout.write('tile ' + x + ',' + y + '\n')
      const buf = await get(url)
      composites.push({
        input: buf,
        left: (x - x0) * tile,
        top: (y - y0) * tile
      })
    }
  }
  const raw = await sharp({
    create: {
      width: cols * tile,
      height: rows * tile,
      channels: 3,
      background: { r: 7, g: 16, b: 24 }
    }
  })
    .composite(composites)
    .jpeg({ quality: 82 })
    .toBuffer()

  // 微信代码质量：图片解码体积宽×高×4 不得超过 200KB
  const MAX_DECODED = 199000
  const metaIn = await sharp(raw).metadata()
  const srcW = metaIn.width || cols * tile
  const srcH = metaIn.height || rows * tile
  const scale = Math.min(1, Math.sqrt(MAX_DECODED / 4 / (srcW * srcH)))
  let outW = Math.max(1, Math.floor(srcW * scale))
  let outH = Math.max(1, Math.round((outW * srcH) / srcW))
  while (outW * outH * 4 >= MAX_DECODED) {
    outW -= 1
    outH = Math.max(1, Math.round((outW * srcH) / srcW))
  }
  const preview = await sharp(raw)
    .resize({ width: outW, height: outH })
    .jpeg({ quality: 80 })
    .toFile(path.join(outDir, 'china-sat-preview.jpg'))

  const meta = {
    z: Z,
    x0,
    y0,
    x1,
    y1,
    minLon: MIN_LON,
    maxLon: MAX_LON,
    minLat: MIN_LAT,
    maxLat: MAX_LAT,
    width: preview.width,
    height: preview.height
  }
  fs.writeFileSync(
    path.join(__dirname, '..', 'subpackages', 'monitor-pages', 'components', 'china-notice-preview', 'sat-proj.js'),
    'module.exports = ' + JSON.stringify(meta, null, 2) + '\n'
  )
  console.log('wrote', meta)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
