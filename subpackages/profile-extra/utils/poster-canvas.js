/**
 * 海报 Canvas 绘制模块
 * 共享基础设施：简报分享海报 + 时间线旅程海报
 * 使用 Canvas 2D API（type="2d"）
 */

var QR_CODE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E4%BA%8C%E7%BB%B4%E7%A0%81/1778753659235_wk29pe.png'
var BG_IMAGE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%A4%AA%E7%A9%BA%E6%8E%A2%E7%B4%A2%E7%94%9F%E6%88%90%E8%83%8C%E6%99%AF%E5%9B%BE/1778756833253_3c6qm2.png'

/**
 * 下载并绘制背景图到 canvas（铺满）
 */
function drawBgImage(canvas, ctx, width, height) {
  return new Promise(function (resolve) {
    wx.getImageInfo({
      src: BG_IMAGE_URL,
      success: function (info) {
        var img = canvas.createImage()
        img.onload = function () {
          ctx.drawImage(img, 0, 0, width, height)
          resolve(true)
        }
        img.onerror = function () {
          resolve(false)
        }
        img.src = info.path
      },
      fail: function () {
        resolve(false)
      }
    })
  })
}

/**
 * 下载并绘制小程序二维码到 canvas
 * @param {Object} canvas - Canvas 2D 实例
 * @param {Object} ctx - canvas context
 * @param {number} x - 绘制 x 坐标
 * @param {number} y - 绘制 y 坐标
 * @param {number} size - 二维码尺寸
 * @returns {Promise}
 */
function drawQRCode(canvas, ctx, x, y, size) {
  return new Promise(function (resolve) {
    wx.getImageInfo({
      src: QR_CODE_URL,
      success: function (info) {
        var img = canvas.createImage()
        img.onload = function () {
          ctx.drawImage(img, x, y, size, size)
          resolve(true)
        }
        img.onerror = function () {
          resolve(false)
        }
        img.src = info.path
      },
      fail: function () {
        resolve(false)
      }
    })
  })
}

/**
 * 在右上角绘制会员身份徽章（FREE / PRO）
 * @param {Object} canvas
 * @param {Object} ctx
 * @param {number} x - 徽章左上角 x
 * @param {number} y - 徽章左上角 y
 * @param {string} iconUrl - FREE/PRO 图标远程 URL
 * @param {string} text - 'FREE' 或 'PRO'
 */
function drawMemberBadge(canvas, ctx, x, y, iconUrl, text) {
  var isPro = text === 'PRO'
  var w = 56
  var h = 64
  var iconSize = 30
  var iconX = x + (w - iconSize) / 2
  var iconY = y + 8

  ctx.save()
  ctx.fillStyle = isPro ? 'rgba(60, 36, 0, 0.78)' : 'rgba(0, 30, 50, 0.7)'
  roundRect(ctx, x, y, w, h, 8)
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = isPro ? 'rgba(255, 196, 92, 0.85)' : 'rgba(120, 200, 255, 0.65)'
  roundRect(ctx, x, y, w, h, 8)
  ctx.stroke()
  ctx.restore()

  return new Promise(function (resolve) {
    function drawText() {
      ctx.save()
      ctx.fillStyle = isPro ? '#FFD27A' : '#9DD8FF'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(text, x + w / 2, y + h - 10)
      ctx.restore()
      resolve(true)
    }
    if (!iconUrl) {
      drawText()
      return
    }
    wx.getImageInfo({
      src: iconUrl,
      success: function (info) {
        var img = canvas.createImage()
        img.onload = function () {
          ctx.drawImage(img, iconX, iconY, iconSize, iconSize)
          drawText()
        }
        img.onerror = function () {
          drawText()
        }
        img.src = info.path
      },
      fail: function () {
        drawText()
      }
    })
  })
}

/**
 * 绘制时间线旅程海报
 * @param {Object} canvas - Canvas 2D 实例
 * @param {Object} data - { nickname, avatarUrl, stats, milestones }
 * @param {number} width - 画布宽度 px
 * @param {number} height - 画布高度 px
 */
async function drawTimelinePoster(canvas, data, width, height) {
  var ctx = canvas.getContext('2d')
  var dpr = wx.getWindowInfo().pixelRatio || 2
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.scale(dpr, dpr)

  // 先填充兜底深色背景（防止图片加载失败时全白）
  ctx.fillStyle = '#0B0D1A'
  ctx.fillRect(0, 0, width, height)

  // 绘制 COS 背景图
  await drawBgImage(canvas, ctx, width, height)

  // 标题
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 20px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('我的太空旅程', width / 2, 44)

  // 用户昵称
  ctx.font = '14px sans-serif'
  ctx.fillStyle = '#A0A8D0'
  ctx.fillText(data.nickname || '太空探索者', width / 2, 68)

  // 用户ID
  if (data.userId) {
    ctx.font = '11px sans-serif'
    ctx.fillStyle = '#6B7199'
    ctx.fillText('ID: ' + data.userId, width / 2, 86)
  }

  // 右上角会员身份徽章
  if (data.memberBadgeText) {
    await drawMemberBadge(canvas, ctx, width - 56 - 16, 16, data.memberBadgeIcon, data.memberBadgeText)
  }

  // 数据摘要卡片（两行）
  var statsY = data.userId ? 100 : 92
  drawStatsCard(ctx, width, statsY, data.stats || {})

  // 精选里程碑（最多5个）
  var milestones = (data.milestones || []).slice(0, 5)
  var milestoneY = statsY + 160
  ctx.font = 'bold 14px sans-serif'
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'left'
  ctx.fillText('精选里程碑', 24, milestoneY)

  milestones.forEach(function (m, i) {
    var y = milestoneY + 30 + i * 44
    drawMilestoneItem(ctx, 24, y, width - 48, m)
  })

  // 底部：二维码 + 品牌文字
  var qrSize = 64
  var qrX = (width - qrSize) / 2
  var qrY = height - 110
  await drawQRCode(canvas, ctx, qrX, qrY, qrSize)

  var bottomY = height - 26
  ctx.fillStyle = '#6B7199'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('长按识别，开启探索之旅', width / 2, bottomY)
}

/**
 * 绘制每日简报海报
 * @param {Object} canvas - Canvas 2D 实例
 * @param {Object} data - { date, launches, results, fact, astroEvent }
 * @param {number} width - 画布宽度 px
 * @param {number} height - 画布高度 px
 */
async function drawBriefingPoster(canvas, data, width, height) {
  var ctx = canvas.getContext('2d')
  var dpr = wx.getWindowInfo().pixelRatio || 2
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.scale(dpr, dpr)

  // 深色背景
  var gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, '#0F1128')
  gradient.addColorStop(1, '#1C1F3A')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  drawStars(ctx, width, height)

  // 标题
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 18px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('每日太空简报', width / 2, 40)

  ctx.font = '13px sans-serif'
  ctx.fillStyle = '#8B92B8'
  ctx.fillText(data.date || '', width / 2, 62)

  var y = 90

  // 今日发射
  if (data.launches && data.launches.length > 0) {
    ctx.textAlign = 'left'
    ctx.fillStyle = '#4FC3F7'
    ctx.font = 'bold 13px sans-serif'
    ctx.fillText('🚀 今日发射', 24, y)
    y += 22
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '12px sans-serif'
    data.launches.slice(0, 3).forEach(function (l) {
      ctx.fillText((l.rocket || '') + ' | ' + (l.name || ''), 36, y)
      y += 20
    })
    y += 10
  }

  // 昨日回顾
  if (data.results && data.results.length > 0) {
    ctx.fillStyle = '#81C784'
    ctx.font = 'bold 13px sans-serif'
    ctx.fillText('✅ 昨日回顾', 24, y)
    y += 22
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '12px sans-serif'
    data.results.slice(0, 2).forEach(function (r) {
      var statusText = r.status === 'success' ? '成功' : '失败'
      ctx.fillText((r.rocket || '') + ' - ' + statusText, 36, y)
      y += 20
    })
    y += 10
  }

  // 太空冷知识
  if (data.fact) {
    ctx.fillStyle = '#FFD54F'
    ctx.font = 'bold 13px sans-serif'
    ctx.fillText('💡 太空冷知识', 24, y)
    y += 22
    ctx.fillStyle = '#E0E0E0'
    ctx.font = '11px sans-serif'
    var lines = wrapText(ctx, data.fact.fact || '', width - 60)
    lines.slice(0, 3).forEach(function (line) {
      ctx.fillText(line, 36, y)
      y += 16
    })
    y += 10
  }

  // 天文事件
  if (data.astroEvent) {
    ctx.fillStyle = '#CE93D8'
    ctx.font = 'bold 13px sans-serif'
    ctx.fillText('🌟 天文事件', 24, y)
    y += 22
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '12px sans-serif'
    ctx.fillText(data.astroEvent.title + ' - ' + data.astroEvent.desc, 36, y)
  }

  // 底部：二维码 + 品牌文字
  var qrSize = 56
  var qrX = (width - qrSize) / 2
  var qrY = height - 100
  await drawQRCode(canvas, ctx, qrX, qrY, qrSize)

  ctx.fillStyle = '#6B7199'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('长按识别小程序码，查看更多', width / 2, height - 34)
}

// ── 辅助绘制函数 ──

function drawStars(ctx, width, height) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
  for (var i = 0; i < 60; i++) {
    var x = Math.random() * width
    var y = Math.random() * height
    var r = Math.random() * 1.2 + 0.3
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawStatsCard(ctx, width, y, stats) {
  var cardW = width - 48
  var cardH = 130
  var cardX = 24

  // 半透明卡片背景
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
  roundRect(ctx, cardX, y, cardW, cardH, 10)
  ctx.fill()

  // 第一行：签到天数 / 成就解锁 / 见证发射
  var row1 = [
    { label: '签到天数', value: String(stats.checkinDays || 0) },
    { label: '成就解锁', value: String(stats.achievements || 0) },
    { label: '见证发射', value: String(stats.launches || 0) }
  ]
  var colW = cardW / 3
  row1.forEach(function (col, i) {
    var cx = cardX + colW * i + colW / 2
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 20px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(col.value, cx, y + 32)
    ctx.fillStyle = '#8B92B8'
    ctx.font = '10px sans-serif'
    ctx.fillText(col.label, cx, y + 50)
  })

  // 分隔线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(cardX + 16, y + 64)
  ctx.lineTo(cardX + cardW - 16, y + 64)
  ctx.stroke()

  // 第二行：订阅提醒 / 竞猜战绩 / 航天新闻（右列为资讯阅读篇数 newsReadCount）
  var voteTotal = stats.voteTotal || 0
  var voteSettled = stats.voteSettled != null ? stats.voteSettled : 0
  var voteCorrect = stats.voteCorrect != null ? stats.voteCorrect : 0
  var voteAccuracy = stats.voteAccuracy != null ? stats.voteAccuracy : 0

  var row2YVal = y + 88
  var row2YSub = y + 104
  var row2YLab = y + 120

  function drawRow2OuterCell(cx, valueStr, labelStr) {
    ctx.textAlign = 'center'
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 20px sans-serif'
    ctx.fillText(valueStr, cx, row2YVal)
    ctx.fillStyle = '#8B92B8'
    ctx.font = '10px sans-serif'
    ctx.fillText(labelStr, cx, row2YLab)
  }

  drawRow2OuterCell(cardX + colW * 0 + colW / 2, String(stats.subscriptions || 0), '订阅提醒')

  var midCx = cardX + colW + colW / 2
  ctx.textAlign = 'center'
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 20px sans-serif'
  var mainAcc = voteSettled > 0 ? String(voteAccuracy) + '%' : '—'
  ctx.fillText(mainAcc, midCx, row2YVal)
  ctx.fillStyle = '#A0A8D0'
  ctx.font = '9px sans-serif'
  var subLine = '猜对 ' + voteCorrect + ' · 已揭晓 ' + voteSettled
  if (voteTotal > 0) subLine += ' · 参与 ' + voteTotal + ' 场'
  ctx.fillText(subLine, midCx, row2YSub)
  ctx.fillStyle = '#8B92B8'
  ctx.font = '10px sans-serif'
  ctx.fillText('竞猜战绩', midCx, row2YLab)

  drawRow2OuterCell(cardX + colW * 2 + colW / 2, String(stats.newsRead || 0), '航天新闻')
}

function drawMilestoneItem(ctx, x, y, maxW, milestone) {
  // 圆点
  ctx.fillStyle = '#4FC3F7'
  ctx.beginPath()
  ctx.arc(x + 6, y + 6, 4, 0, Math.PI * 2)
  ctx.fill()

  // 标题
  ctx.fillStyle = '#FFFFFF'
  ctx.font = '13px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(milestone.name || '', x + 20, y + 10)

  // 时间
  ctx.fillStyle = '#6B7199'
  ctx.font = '11px sans-serif'
  var dateStr = milestone.timestamp ? formatPosterDate(milestone.timestamp) : ''
  ctx.fillText(dateStr, x + 20, y + 28)
}

function formatPosterDate(ts) {
  var d = new Date(ts)
  return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0')
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function wrapText(ctx, text, maxWidth) {
  var lines = []
  var current = ''
  for (var i = 0; i < text.length; i++) {
    var test = current + text[i]
    var metrics = ctx.measureText(test)
    if (metrics.width > maxWidth && current.length > 0) {
      lines.push(current)
      current = text[i]
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

/**
 * 将 canvas 导出为临时文件路径
 * @param {Object} canvas - Canvas 2D 实例
 * @param {number} width
 * @param {number} height
 * @returns {Promise<string>} tempFilePath
 */
function canvasToTempFile(canvas, width, height) {
  var dpr = wx.getWindowInfo().pixelRatio || 2
  return new Promise(function (resolve, reject) {
    wx.canvasToTempFilePath({
      canvas: canvas,
      x: 0,
      y: 0,
      width: width * dpr,
      height: height * dpr,
      destWidth: width * dpr,
      destHeight: height * dpr,
      success: function (res) { resolve(res.tempFilePath) },
      fail: function (err) { reject(err) }
    })
  })
}

module.exports = {
  drawTimelinePoster: drawTimelinePoster,
  drawBriefingPoster: drawBriefingPoster,
  canvasToTempFile: canvasToTempFile
}
