/**
 * 观礼商家线下打印物料海报：小程序码 + 商家名称 + 用途说明（防裸码乱用）
 * Canvas 2D，导出 JPG 后由页面存入相册。
 */

const POSTER_W = 750
const POSTER_H = 1180

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function wrapText(ctx, text, maxWidth) {
  const src = String(text || '')
  const lines = []
  let current = ''
  for (let i = 0; i < src.length; i++) {
    const test = current + src[i]
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current)
      current = src[i]
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

function loadImage(canvas, src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('empty image'))
      return
    }
    wx.getImageInfo({
      src,
      success: (info) => {
        const img = canvas.createImage()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('image load fail'))
        img.src = info.path
      },
      fail: () => reject(new Error('image info fail'))
    })
  })
}

function queryCanvas(page, selector) {
  return new Promise((resolve) => {
    wx.createSelectorQuery()
      .in(page)
      .select(selector)
      .fields({ node: true, size: true })
      .exec((res) => {
        const node = res && res[0] && res[0].node
        resolve(node || null)
      })
  })
}

/**
 * @param {WechatMiniprogram.Page.Instance} page
 * @param {string} selector canvas 选择器，如 #materialPosterCanvas
 * @param {object} material merchantGetSessionMaterial 返回
 * @returns {Promise<string>} tempFilePath
 */
function renderMaterialPoster(page, selector, material) {
  const m = material || {}
  return queryCanvas(page, selector).then((canvas) => {
    if (!canvas) return Promise.reject(new Error('canvas missing'))
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(3, (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2)
    canvas.width = POSTER_W * dpr
    canvas.height = POSTER_H * dpr
    ctx.scale(dpr, dpr)

    // 背景
    const bg = ctx.createLinearGradient(0, 0, 0, POSTER_H)
    bg.addColorStop(0, '#0B1220')
    bg.addColorStop(0.55, '#0B0C0E')
    bg.addColorStop(1, '#111827')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, POSTER_W, POSTER_H)

    // 顶条
    ctx.fillStyle = 'rgba(59, 130, 246, 0.18)'
    ctx.fillRect(0, 0, POSTER_W, 88)
    ctx.fillStyle = '#93C5FD'
    ctx.font = '28px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('火星探索日志 · 火箭观礼', POSTER_W / 2, 44)

    // 商家名称（强制展示，防乱用）
    const merchantName = String(m.merchantName || '观礼商家').trim() || '观礼商家'
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 48px sans-serif'
    ctx.textAlign = 'center'
    const nameLines = wrapText(ctx, merchantName, POSTER_W - 96)
    let y = 140
    nameLines.slice(0, 2).forEach((line) => {
      ctx.fillText(line, POSTER_W / 2, y)
      y += 56
    })

    // 用途标题胶囊
    const purposeTitle = String(m.purposeTitle || '现场观礼物料码')
    ctx.font = 'bold 30px sans-serif'
    const purposeW = Math.min(POSTER_W - 120, ctx.measureText(purposeTitle).width + 64)
    const purposeX = (POSTER_W - purposeW) / 2
    const purposeY = y + 12
    ctx.fillStyle = 'rgba(251, 191, 36, 0.16)'
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)'
    ctx.lineWidth = 2
    roundRect(ctx, purposeX, purposeY, purposeW, 52, 26)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#FBBF24'
    ctx.textBaseline = 'middle'
    ctx.fillText(purposeTitle, POSTER_W / 2, purposeY + 26)

    // 用途明细
    const purposeLines = Array.isArray(m.purposeLines) && m.purposeLines.length
      ? m.purposeLines
      : ['扫码抽现场奖品', '免费预约登记与到场核销']
    y = purposeY + 88
    ctx.fillStyle = 'rgba(245, 247, 255, 0.88)'
    ctx.font = '30px sans-serif'
    purposeLines.slice(0, 3).forEach((line) => {
      ctx.fillText('· ' + String(line || ''), POSTER_W / 2, y)
      y += 42
    })

    // 二维码白底区
    const qrSize = 420
    const qrPad = 28
    const boxSize = qrSize + qrPad * 2
    const boxX = (POSTER_W - boxSize) / 2
    const boxY = y + 20
    ctx.fillStyle = '#FFFFFF'
    roundRect(ctx, boxX, boxY, boxSize, boxSize, 24)
    ctx.fill()

    return loadImage(canvas, m.qrCodeUrl).then((img) => {
      ctx.drawImage(img, boxX + qrPad, boxY + qrPad, qrSize, qrSize)

      // 长期线下物料：不印场次标题 / 火箭 / 任务（避免换发射后海报过期）
      // 大屏与扫码后页仍展示当前任务，不受此处影响
      let footY = boxY + boxSize + 48

      if (m.code) {
        ctx.fillStyle = 'rgba(245, 247, 255, 0.55)'
        ctx.font = '24px sans-serif'
        ctx.fillText('场次短码 ' + String(m.code).toUpperCase() + '（扫码失败时可手输）', POSTER_W / 2, footY + 8)
        footY += 40
      }

      ctx.fillStyle = 'rgba(245, 247, 255, 0.45)'
      ctx.font = '24px sans-serif'
      const note = String(m.usageNote || '本点位长期物料 · 扫码进入当前观礼活动')
      wrapText(ctx, note, POSTER_W - 80).slice(0, 2).forEach((line) => {
        ctx.fillText(line, POSTER_W / 2, Math.min(POSTER_H - 48, footY + 16))
        footY += 34
      })

      return new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas,
          destWidth: POSTER_W * 2,
          destHeight: POSTER_H * 2,
          fileType: 'jpg',
          quality: 0.92,
          success: (res) => resolve(res.tempFilePath),
          fail: (err) => reject(err || new Error('export fail'))
        }, page)
      })
    })
  })
}

module.exports = {
  POSTER_W,
  POSTER_H,
  renderMaterialPoster
}
