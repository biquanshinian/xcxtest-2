/**
 * 邀请得月卡 — 简洁邀请详情页
 * 规则：好友点开分享卡片即计 1 次有效邀请（每人一生只计一次、自邀不算），
 * 每满 15 人云端自动发放 30 天星际通行证，可无限叠加。
 */
const { getUiShellLayout } = require('../../../utils/layout.js')
const { getThemeClassSync, isLightSync } = require('../../../utils/theme.js')
const { getInviteState } = require('../../../utils/invite.js')
const { getMembershipState } = require('../../../utils/membership.js')

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 云端 serverDate 经 callFunction 序列化后可能是 ISO 字符串或 { $date } 对象，统一转毫秒 */
function toMs(v) {
  if (!v) return 0
  if (typeof v === 'object' && v.$date != null) v = v.$date
  const ms = new Date(v).getTime()
  return isNaN(ms) ? 0 : ms
}

function fmtTime(ms) {
  if (!ms) return '时间未知'
  const d = new Date(ms)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

Page({
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    themeClass: '',
    themeLight: false,
    loading: true,
    errorMessage: '',
    openid: '',
    validCount: 0,
    cardsGranted: 0,
    threshold: 15,
    cardDays: 30,
    totalDays: 0,
    roundCount: 0,       // 本轮进度 N（0~14）
    progressPercent: 0,  // 本轮进度条百分比
    records: []
  },

  onLoad() {
    const layout = getUiShellLayout()
    this.setData({
      statusBarHeight: layout.statusBarHeight,
      navPlaceholderHeight: layout.navPlaceholderHeight,
      themeClass: getThemeClassSync(),
      themeLight: isLightSync()
    })
    this.loadState()
    // 预先绘制分享海报（用户点分享时缩略图已就绪）
    setTimeout(() => this._buildSharePoster(), 300)
  },

  onShow() {
    // 二次进入时刷新进度；顺带强刷会员状态，让自动到账的月卡立刻反映出来
    if (this._loadedOnce) this.loadState()
    getMembershipState(true).catch(() => {})
  },

  async loadState() {
    if (!this.data.records.length) this.setData({ loading: true, errorMessage: '' })
    try {
      const r = await getInviteState()
      const threshold = Number(r.threshold) || 15
      const cardDays = Number(r.cardDays) || 30
      const validCount = Number(r.validCount) || 0
      const cardsGranted = Number(r.cardsGranted) || 0
      const roundCount = validCount % threshold
      this._loadedOnce = true
      this.setData({
        loading: false,
        errorMessage: '',
        openid: r.openid || '',
        validCount,
        cardsGranted,
        threshold,
        cardDays,
        totalDays: cardsGranted * cardDays,
        roundCount,
        progressPercent: Math.round(roundCount / threshold * 100),
        records: (r.records || []).map((it, i) => ({
          id: i,
          timeText: fmtTime(toMs(it.createdAt))
        }))
      })
    } catch (e) {
      this.setData({ loading: false, errorMessage: '加载失败，请稍后再试' })
    }
  },

  onRetry() {
    this.loadState()
  },

  onShareAppMessage() {
    const path = this.data.openid
      ? '/pages/index/index?inviter=' + this.data.openid
      : '/pages/index/index'
    return {
      title: '送你一张太空探索邀请函，实时追踪全球火箭发射',
      path,
      // 自绘邀请海报（5:4）；绘制未就绪时留空走默认截图兜底
      imageUrl: this._posterPath || ''
    }
  },

  /**
   * 绘制分享海报（Canvas 2D，750×600 = 微信分享卡片 5:4）：
   * 深空星野 + 升空火箭 + 金色通行证卡片，全矢量绘制不依赖外部图片
   */
  _buildSharePoster() {
    if (this._posterPath || this._posterBuilding) return
    this._posterBuilding = true
    wx.createSelectorQuery().in(this)
      .select('#sharePoster')
      .fields({ node: true })
      .exec((res) => {
        const canvas = res && res[0] && res[0].node
        if (!canvas) { this._posterBuilding = false; return }
        try {
          const W = 750
          const H = 600
          canvas.width = W
          canvas.height = H
          const ctx = canvas.getContext('2d')

          // ── 深空背景 ──
          const bg = ctx.createLinearGradient(0, 0, 0, H)
          bg.addColorStop(0, '#0B1233')
          bg.addColorStop(0.55, '#151038')
          bg.addColorStop(1, '#05060F')
          ctx.fillStyle = bg
          ctx.fillRect(0, 0, W, H)

          // 星云光晕（右上暖光 + 左下冷光）
          let neb = ctx.createRadialGradient(620, 120, 0, 620, 120, 360)
          neb.addColorStop(0, 'rgba(255, 170, 0, 0.14)')
          neb.addColorStop(1, 'rgba(255, 170, 0, 0)')
          ctx.fillStyle = neb
          ctx.fillRect(0, 0, W, H)
          neb = ctx.createRadialGradient(120, 520, 0, 120, 520, 320)
          neb.addColorStop(0, 'rgba(88, 120, 255, 0.12)')
          neb.addColorStop(1, 'rgba(88, 120, 255, 0)')
          ctx.fillStyle = neb
          ctx.fillRect(0, 0, W, H)

          // ── 星点（伪随机固定种子，保证每次绘制一致） ──
          let seed = 42
          const rnd = () => {
            seed = (seed * 9301 + 49297) % 233280
            return seed / 233280
          }
          for (let i = 0; i < 90; i++) {
            const x = rnd() * W
            const y = rnd() * H
            const r = rnd() * 1.6 + 0.4
            ctx.globalAlpha = 0.25 + rnd() * 0.6
            ctx.fillStyle = '#FFFFFF'
            ctx.beginPath()
            ctx.arc(x, y, r, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.globalAlpha = 1

          // ── 右侧升空火箭（整体平移 + 微倾斜） ──
          ctx.save()
          ctx.translate(565, 265)
          ctx.rotate(-0.1)

          // 尾焰光晕
          let glow = ctx.createRadialGradient(0, 175, 0, 0, 175, 130)
          glow.addColorStop(0, 'rgba(255, 190, 60, 0.5)')
          glow.addColorStop(1, 'rgba(255, 190, 60, 0)')
          ctx.fillStyle = glow
          ctx.beginPath()
          ctx.arc(0, 175, 130, 0, Math.PI * 2)
          ctx.fill()

          // 尾焰（双层）
          const flameOuter = ctx.createLinearGradient(0, 120, 0, 260)
          flameOuter.addColorStop(0, '#FFAA00')
          flameOuter.addColorStop(1, 'rgba(255, 80, 0, 0)')
          ctx.fillStyle = flameOuter
          ctx.beginPath()
          ctx.moveTo(-30, 120)
          ctx.quadraticCurveTo(0, 255, 0, 255)
          ctx.quadraticCurveTo(0, 255, 30, 120)
          ctx.closePath()
          ctx.fill()
          const flameInner = ctx.createLinearGradient(0, 120, 0, 205)
          flameInner.addColorStop(0, '#FFF3C4')
          flameInner.addColorStop(1, 'rgba(255, 212, 102, 0)')
          ctx.fillStyle = flameInner
          ctx.beginPath()
          ctx.moveTo(-14, 120)
          ctx.quadraticCurveTo(0, 205, 0, 205)
          ctx.quadraticCurveTo(0, 205, 14, 120)
          ctx.closePath()
          ctx.fill()

          // 箭体
          const body = ctx.createLinearGradient(-38, 0, 38, 0)
          body.addColorStop(0, '#C9D4E8')
          body.addColorStop(0.45, '#FFFFFF')
          body.addColorStop(1, '#9AA8C4')
          ctx.fillStyle = body
          ctx.beginPath()
          ctx.moveTo(0, -160)
          ctx.quadraticCurveTo(38, -95, 38, -10)
          ctx.lineTo(38, 95)
          ctx.quadraticCurveTo(38, 120, 24, 120)
          ctx.lineTo(-24, 120)
          ctx.quadraticCurveTo(-38, 120, -38, 95)
          ctx.lineTo(-38, -10)
          ctx.quadraticCurveTo(-38, -95, 0, -160)
          ctx.closePath()
          ctx.fill()

          // 鼻锥
          const nose = ctx.createLinearGradient(-20, -160, 20, -100)
          nose.addColorStop(0, '#FFD466')
          nose.addColorStop(1, '#FFAA00')
          ctx.fillStyle = nose
          ctx.beginPath()
          ctx.moveTo(0, -160)
          ctx.quadraticCurveTo(30, -110, 34, -72)
          ctx.quadraticCurveTo(0, -92, -34, -72)
          ctx.quadraticCurveTo(-30, -110, 0, -160)
          ctx.closePath()
          ctx.fill()

          // 舷窗
          ctx.fillStyle = '#1B2A4A'
          ctx.beginPath()
          ctx.arc(0, -18, 22, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#FFD466'
          ctx.lineWidth = 5
          ctx.stroke()
          ctx.fillStyle = 'rgba(140, 190, 255, 0.65)'
          ctx.beginPath()
          ctx.arc(-6, -24, 9, 0, Math.PI * 2)
          ctx.fill()

          // 尾翼
          ctx.fillStyle = '#FF8A00'
          ctx.beginPath()
          ctx.moveTo(-38, 40)
          ctx.quadraticCurveTo(-78, 95, -68, 130)
          ctx.lineTo(-38, 105)
          ctx.closePath()
          ctx.fill()
          ctx.beginPath()
          ctx.moveTo(38, 40)
          ctx.quadraticCurveTo(78, 95, 68, 130)
          ctx.lineTo(38, 105)
          ctx.closePath()
          ctx.fill()
          ctx.restore()

          // ── 左侧文案 ──
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'left'
          // 主标题（两行，带金色光晕）
          ctx.shadowColor = 'rgba(255, 170, 0, 0.55)'
          ctx.shadowBlur = 22
          ctx.fillStyle = '#FFFFFF'
          ctx.font = 'bold 72px sans-serif'
          ctx.fillText('太空探索', 56, 150)
          ctx.fillText('邀请函', 56, 240)
          ctx.shadowBlur = 0
          // 副标题
          ctx.fillStyle = '#FFD98A'
          ctx.font = '30px sans-serif'
          ctx.fillText('邀你实时追踪全球火箭发射', 58, 312)

          // ── 金色通行证卡片 ──
          const cardX = 56
          const cardY = 372
          const cardW = 330
          const cardH = 104
          const cardR = 20
          ctx.save()
          ctx.shadowColor = 'rgba(255, 170, 0, 0.45)'
          ctx.shadowBlur = 26
          const cardBg = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH)
          cardBg.addColorStop(0, '#FFAA00')
          cardBg.addColorStop(1, '#FFD466')
          ctx.fillStyle = cardBg
          ctx.beginPath()
          ctx.moveTo(cardX + cardR, cardY)
          ctx.arcTo(cardX + cardW, cardY, cardX + cardW, cardY + cardH, cardR)
          ctx.arcTo(cardX + cardW, cardY + cardH, cardX, cardY + cardH, cardR)
          ctx.arcTo(cardX, cardY + cardH, cardX, cardY, cardR)
          ctx.arcTo(cardX, cardY, cardX + cardW, cardY, cardR)
          ctx.closePath()
          ctx.fill()
          ctx.restore()
          ctx.fillStyle = '#241300'
          ctx.font = 'bold 40px sans-serif'
          ctx.fillText('星际通行证', cardX + 28, cardY + 38)
          ctx.font = '26px sans-serif'
          ctx.fillStyle = 'rgba(60, 32, 0, 0.85)'
          ctx.fillText('30 天 · 邀好友免费得', cardX + 28, cardY + 76)

          // ── 底部提示胶囊 ──
          const pillY = 524
          ctx.strokeStyle = 'rgba(255, 212, 102, 0.55)'
          ctx.lineWidth = 2
          ctx.fillStyle = 'rgba(255, 170, 0, 0.12)'
          const pillW = 470
          const pillH = 54
          const pillX = 56
          const pillR = 27
          ctx.beginPath()
          ctx.moveTo(pillX + pillR, pillY)
          ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillH, pillR)
          ctx.arcTo(pillX + pillW, pillY + pillH, pillX, pillY + pillH, pillR)
          ctx.arcTo(pillX, pillY + pillH, pillX, pillY, pillR)
          ctx.arcTo(pillX, pillY, pillX + pillW, pillY, pillR)
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = '#FFE3A8'
          ctx.font = '26px sans-serif'
          ctx.fillText('点开即帮好友集火箭 · 月卡自动到账', pillX + 30, pillY + pillH / 2 + 1)

          // ── 导出 ──
          wx.canvasToTempFilePath({
            canvas,
            destWidth: W,
            destHeight: H,
            fileType: 'jpg',
            quality: 0.9,
            success: (r) => { this._posterPath = r.tempFilePath },
            complete: () => { this._posterBuilding = false }
          }, this)
        } catch (e) {
          this._posterBuilding = false
        }
      })
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/profile/profile' })
    }
  }
})
