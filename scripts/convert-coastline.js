/**
 * 将 Natural Earth 110m GeoJSON 转换为小程序可用的简化海岸线数据
 * 使用 Douglas-Peucker 算法进一步抽稀
 */
const https = require('https')
const fs = require('fs')
const path = require('path')

const URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson'
const OUTPUT = path.join(__dirname, '..', 'utils', 'world-coastline.js')

// Douglas-Peucker 简化算法
function perpendicularDist(pt, lineStart, lineEnd) {
  const dx = lineEnd[0] - lineStart[0]
  const dy = lineEnd[1] - lineStart[1]
  const mag = Math.sqrt(dx * dx + dy * dy)
  if (mag === 0) return Math.sqrt((pt[0] - lineStart[0]) ** 2 + (pt[1] - lineStart[1]) ** 2)
  const u = ((pt[0] - lineStart[0]) * dx + (pt[1] - lineStart[1]) * dy) / (mag * mag)
  const ix = lineStart[0] + u * dx
  const iy = lineStart[1] + u * dy
  return Math.sqrt((pt[0] - ix) ** 2 + (pt[1] - iy) ** 2)
}

function douglasPeucker(points, epsilon) {
  if (points.length <= 2) return points
  let maxDist = 0, maxIdx = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], points[0], points[points.length - 1])
    if (d > maxDist) { maxDist = d; maxIdx = i }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon)
    const right = douglasPeucker(points.slice(maxIdx), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [points[0], points[points.length - 1]]
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'coastline-converter/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject)
      }
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function main() {
  console.log('Downloading Natural Earth 110m land GeoJSON...')
  const raw = await fetch(URL)
  const geojson = JSON.parse(raw)
  
  console.log(`Features: ${geojson.features.length}`)
  
  const EPSILON = 0.8  // 简化阈值（度），越大越简化
  const MIN_POINTS = 4  // 最少保留点数
  
  const polygons = []
  let totalOriginal = 0
  let totalSimplified = 0
  
  for (const feature of geojson.features) {
    const geom = feature.geometry
    let rings = []
    
    if (geom.type === 'Polygon') {
      rings = geom.coordinates
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        rings = rings.concat(poly)
      }
    }
    
    for (const ring of rings) {
      totalOriginal += ring.length
      // 简化
      let simplified = douglasPeucker(ring, EPSILON)
      if (simplified.length < MIN_POINTS) continue
      
      // 四舍五入到 1 位小数
      simplified = simplified.map(p => [
        Math.round(p[0] * 10) / 10,
        Math.round(p[1] * 10) / 10
      ])
      
      totalSimplified += simplified.length
      polygons.push(simplified)
    }
  }
  
  // 按面积/点数排序，大的在前
  polygons.sort((a, b) => b.length - a.length)
  
  console.log(`Original points: ${totalOriginal}`)
  console.log(`Simplified points: ${totalSimplified}`)
  console.log(`Polygons: ${polygons.length}`)
  
  // 生成 JS 文件
  let js = '/**\n * 世界海岸线轮廓数据（基于 Natural Earth 110m）\n * 自动生成，请勿手动编辑\n * 格式：[[lng,lat], ...] 闭合多边形数组\n */\nmodule.exports = [\n'
  
  for (let i = 0; i < polygons.length; i++) {
    const pts = polygons[i]
    const ptsStr = pts.map(p => `[${p[0]},${p[1]}]`).join(',')
    js += `  [${ptsStr}]`
    if (i < polygons.length - 1) js += ','
    js += '\n'
  }
  
  js += ']\n'
  
  fs.writeFileSync(OUTPUT, js, 'utf-8')
  console.log(`Written to ${OUTPUT} (${(js.length / 1024).toFixed(1)} KB)`)
}

main().catch(console.error)
