/**
 * 生成环绕全景 Earth Studio 用 KML：发射点 + 回收点 + 贴地大圆弧。
 * node docs/orbit-pano-kml/gen-kml.js
 */
const fs = require('fs')
const path = require('path')

const ROUTES = [
  {
    file: '01-f9-slc40-rtls.kml',
    name: '猎鹰9 · SLC-40 · 陆地回收',
    lock: 'Falcon 9 · SLC-40 · 陆地回收',
    color: 'ff2d7dff',
    start: { name: 'SLC-40', lat: 28.56186, lon: -80.57737 },
    end: { name: 'LZ-40', lat: 28.56190, lon: -80.57720 }
  },
  {
    file: '02-f9-slc40-asds.kml',
    name: '猎鹰9 · SLC-40 · 海上回收',
    lock: 'Falcon 9 · SLC-40 · 海上回收',
    color: 'ffffc14a',
    start: { name: 'SLC-40', lat: 28.56186, lon: -80.57737 },
    end: { name: 'ASOG 示意（东约600km）', lat: 28.56, lon: -74.45 }
  },
  {
    file: '03-f9-lc39a-rtls.kml',
    name: '猎鹰9 · LC-39A · 陆地回收',
    lock: 'Falcon 9 · LC-39A · 陆地回收',
    color: 'ff2d7dff',
    start: { name: 'LC-39A', lat: 28.60839, lon: -80.60433 },
    end: { name: 'LZ-40', lat: 28.56190, lon: -80.57720 }
  },
  {
    file: '04-f9-lc39a-asds.kml',
    name: '猎鹰9 · LC-39A · 海上回收',
    lock: 'Falcon 9 · LC-39A · 海上回收',
    color: 'ffffc14a',
    start: { name: 'LC-39A', lat: 28.60839, lon: -80.60433 },
    end: { name: 'ASOG 示意（东约600km）', lat: 28.56, lon: -74.45 }
  },
  {
    file: '05-f9-slc4e-rtls.kml',
    name: '猎鹰9 · SLC-4E · 陆地回收',
    lock: 'Falcon 9 · SLC-4E · 陆地回收',
    color: 'ff2d7dff',
    start: { name: 'SLC-4E', lat: 34.63209, lon: -120.61083 },
    end: { name: 'LZ-4', lat: 34.63300, lon: -120.61300 }
  },
  {
    file: '06-f9-slc4e-asds.kml',
    name: '猎鹰9 · SLC-4E · 海上回收',
    lock: 'Falcon 9 · SLC-4E · 海上回收',
    color: 'ffffc14a',
    start: { name: 'SLC-4E', lat: 34.63209, lon: -120.61083 },
    end: { name: 'OCISLY 示意（南约600km）', lat: 29.24, lon: -120.61 }
  },
  {
    file: '07-fh-lc39a-asds.kml',
    name: '猎鹰重型 · LC-39A · 海上回收',
    lock: 'Falcon Heavy · LC-39A · 海上回收',
    color: 'ff4ad2ff',
    start: { name: 'LC-39A', lat: 28.60839, lon: -80.60433 },
    end: { name: 'ASOG 示意（中央芯）', lat: 28.56, lon: -74.45 }
  },
  {
    file: '08-fh-lc39a-rtls.kml',
    name: '猎鹰重型 · LC-39A · 陆地回收（可选）',
    lock: 'Falcon Heavy · LC-39A · 陆地回收',
    color: 'ff2d7dff',
    start: { name: 'LC-39A', lat: 28.60839, lon: -80.60433 },
    end: { name: 'LZ-1', lat: 28.48583, lon: -80.54444 },
    extra: { name: 'LZ-2', lat: 28.4878, lon: -80.5467 }
  }
]

/** 国产可回收：酒泉航区回收 / 海南海上网系。工位取 LL2，回收场取公开航区坐标。 */
const CN_ROUTES = [
  {
    file: '09-zq3-jiuquan-minqin.kml',
    name: '朱雀三号 · 酒泉 LC-96B · 民勤航区回收',
    lock: 'Zhuque-3 · 酒泉 LC-96B · 民勤回收',
    color: 'ff7a4dff',
    note: '发射：东风商业航天创新试验区 LC-96B（LL2 40.92017, 100.25129）。回收：民勤方形场坪，东南约 390km（38.445, 103.481）。不是返回发射台。',
    start: { name: '酒泉 LC-96B', lat: 40.92017, lon: 100.25129 },
    end: { name: '民勤回收场', lat: 38.445, lon: 103.481 }
  },
  {
    file: '10-cz12a-jiuquan-minqin.kml',
    name: '长征十二号甲 · 酒泉商火工位 · 民勤航区回收',
    lock: '长征十二号甲 · 酒泉商火 · 民勤回收',
    color: 'ff5ac8fa',
    note: '发射：东风试验区中国商火工位（LL2 Long March 12 series Pad 40.891596, 100.217289）。回收：民勤圆形场，东南约 250km（39.044, 101.923）。海南商发 2 号为后续场，甲烷设施就绪后再补片。',
    start: { name: '酒泉商火工位', lat: 40.891596, lon: 100.217289 },
    end: { name: '民勤回收场', lat: 39.044, lon: 101.923 }
  },
  {
    file: '11-cz10b-hainan-net.kml',
    name: '长征十号乙 · 海南商发 2 号 · 海上网系回收',
    lock: '长征十号乙 · 海南商发2号 · 网系回收',
    color: 'ffff9f0a',
    note: '发射：海南商业航天发射场 2 号工位（LL2 Commercial LC-2 19.59755, 110.936481）。回收：领航者号网系平台，用首飞驻位 16.60417, 113.52867，后续任务船位会变。',
    start: { name: '海南商发 2 号工位', lat: 19.59755, lon: 110.936481 },
    end: { name: '领航者号（首飞驻位）', lat: 16.60417, lon: 113.52867 }
  }
]

function toRad(d) {
  return (d * Math.PI) / 180
}

function toDeg(r) {
  return (r * 180) / Math.PI
}

function haversineKm(a, b) {
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

function greatCircle(start, end, steps) {
  const φ1 = toRad(start.lat)
  const λ1 = toRad(start.lon)
  const φ2 = toRad(end.lat)
  const λ2 = toRad(end.lon)
  const Δ = 2 * Math.asin(Math.min(1, Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  )))
  const out = []
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    if (Δ < 1e-12) {
      out.push({ lat: start.lat, lon: start.lon })
      continue
    }
    const x = (Math.sin((1 - f) * Δ) / Math.sin(Δ))
    const y = Math.sin(f * Δ) / Math.sin(Δ)
    const x3 = x * Math.cos(φ1) * Math.cos(λ1) + y * Math.cos(φ2) * Math.cos(λ2)
    const y3 = x * Math.cos(φ1) * Math.sin(λ1) + y * Math.cos(φ2) * Math.sin(λ2)
    const z3 = x * Math.sin(φ1) + y * Math.sin(φ2)
    out.push({
      lat: toDeg(Math.atan2(z3, Math.sqrt(x3 * x3 + y3 * y3))),
      lon: toDeg(Math.atan2(y3, x3))
    })
  }
  return out
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function coord(p) {
  return `${p.lon.toFixed(6)},${p.lat.toFixed(6)},0`
}

function lookAt(start, end, km) {
  const midLat = (start.lat + end.lat) / 2
  const midLon = (start.lon + end.lon) / 2
  const range = Math.max(8000, Math.round(km * 2200))
  return `      <LookAt>
        <longitude>${midLon.toFixed(6)}</longitude>
        <latitude>${midLat.toFixed(6)}</latitude>
        <altitude>0</altitude>
        <heading>0</heading>
        <tilt>45</tilt>
        <range>${range}</range>
        <altitudeMode>relativeToGround</altitudeMode>
      </LookAt>`
}

function pointPlacemark(id, title, p, color) {
  return `    <Placemark id="${id}">
      <name>${esc(title)}</name>
      <styleUrl>#pin-${id.includes('start') ? 'start' : 'end'}</styleUrl>
      <Point>
        <coordinates>${coord(p)}</coordinates>
      </Point>
    </Placemark>`
}

function routeKml(route) {
  const km = haversineKm(route.start, route.end)
  const steps = km < 2 ? 8 : km < 30 ? 16 : 32
  const line = greatCircle(route.start, route.end, steps)
  const extra = route.extra
    ? `
    <Placemark id="extra">
      <name>${esc(route.extra.name)}</name>
      <styleUrl>#pin-end</styleUrl>
      <Point>
        <coordinates>${coord(route.extra)}</coordinates>
      </Point>
    </Placemark>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(route.name)}</name>
    <description>后台锁定：${esc(route.lock)}。搜索请用「纬度, 经度」。${esc(route.note || '海上终点为常规 600km 示意驻位，不是某次任务精确落点。')}</description>
    <Style id="line">
      <LineStyle>
        <color>${route.color}</color>
        <width>${km < 2 ? 6 : 4}</width>
      </LineStyle>
    </Style>
    <Style id="pin-start">
      <IconStyle>
        <color>ff34c759</color>
        <scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>1</scale></LabelStyle>
    </Style>
    <Style id="pin-end">
      <IconStyle>
        <color>${route.color}</color>
        <scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-circle.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>1</scale></LabelStyle>
    </Style>
${lookAt(route.start, route.end, km)}
${pointPlacemark('start', `发射 · ${route.start.name}`, route.start)}
${pointPlacemark('end', `回收 · ${route.end.name}`, route.end)}
${extra}
    <Placemark id="route">
      <name>${esc(route.name)} · 航迹</name>
      <styleUrl>#line</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>
          ${line.map(coord).join('\n          ')}
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>
`
}

function allKml(routes, title, desc) {
  const folders = routes.map((route) => {
    const km = haversineKm(route.start, route.end)
    const steps = km < 2 ? 8 : km < 30 ? 16 : 32
    const line = greatCircle(route.start, route.end, steps)
    const extra = route.extra
      ? `
      <Placemark>
        <name>${esc(route.extra.name)}</name>
        <styleUrl>#pin-end</styleUrl>
        <Point><coordinates>${coord(route.extra)}</coordinates></Point>
      </Placemark>`
      : ''
    return `    <Folder>
      <name>${esc(route.name)}</name>
      <Placemark>
        <name>发射 · ${esc(route.start.name)}</name>
        <styleUrl>#pin-start</styleUrl>
        <Point><coordinates>${coord(route.start)}</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>回收 · ${esc(route.end.name)}</name>
        <styleUrl>#pin-end</styleUrl>
        <Point><coordinates>${coord(route.end)}</coordinates></Point>
      </Placemark>${extra}
      <Placemark>
        <name>航迹</name>
        <Style>
          <LineStyle><color>${route.color}</color><width>${km < 2 ? 6 : 4}</width></LineStyle>
        </Style>
        <LineString>
          <tessellate>1</tessellate>
          <altitudeMode>clampToGround</altitudeMode>
          <coordinates>
            ${line.map(coord).join('\n            ')}
          </coordinates>
        </LineString>
      </Placemark>
    </Folder>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(title || '环绕全景 · 猎鹰9 / 重型航迹')}</name>
    <description>${esc(desc || '8 条片：猎鹰9 三场×陆地/海上 + 重型海上（及可选陆地）。导入 Earth Studio：Overlays → Import KML。做单条片时请用对应编号文件，避免线叠在一起。')}</description>
    <Style id="pin-start">
      <IconStyle>
        <color>ff34c759</color>
        <scale>1.05</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href></Icon>
      </IconStyle>
    </Style>
    <Style id="pin-end">
      <IconStyle>
        <scale>1.05</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-circle.png</href></Icon>
      </IconStyle>
    </Style>
${folders}
  </Document>
</kml>
`
}

const outDir = __dirname
const allRoutes = ROUTES.concat(CN_ROUTES)
for (const route of allRoutes) {
  fs.writeFileSync(path.join(outDir, route.file), routeKml(route), 'utf8')
}
fs.writeFileSync(path.join(outDir, '00-all-routes.kml'), allKml(ROUTES), 'utf8')
fs.writeFileSync(path.join(outDir, '00-cn-routes.kml'), allKml(
  CN_ROUTES,
  '环绕全景 · 朱雀三号 / 长十二甲 / 长十乙',
  '3 条片：朱雀三号酒泉→民勤、长十二甲酒泉商火→民勤、长十乙海南商发2号→领航者号。导入 Earth Studio：Overlays → Import KML。做单条片时请用对应编号文件。'
), 'utf8')
console.log('wrote', allRoutes.length + 2, 'kml files to', outDir)
