/**
 * 观礼商家中心
 * - 未绑定：输入运营发放的商家编号绑定微信
 * - 已绑定：名下场次列表（新建/编辑/大屏/删除），全程小程序端自助，无需后台
 */
const pageBase = require('../../utils/page-base.js')
const composerInput = require('./utils/composer-input-behavior.js')
const watchParty = require('./utils/api.js')
const { getRocketImage } = require('../../utils/util.js')
const { renderMaterialPoster } = require('./utils/material-poster.js')
const { guardWatchPartyPage } = require('../../utils/watch-party-feature.js')

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function formatLaunchTime(iso) {
  if (!iso) return '发射时间待定'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '发射时间待定'
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function resolveSessionRocketImage(session) {
  const name = session && session.rocketName ? String(session.rocketName).trim() : ''
  return name ? (getRocketImage(name) || '') : ''
}

Page({
  behaviors: [pageBase, composerInput],
  _fallbackTab: '/pages/index/index',

  data: {
    loading: true,
    error: '',
    bound: false,
    merchant: null,
    merchantCodeMasked: '••••••••',
    codeVisible: false,
    sessions: [],
    codeInput: '',
    binding: false,
    materialVisible: false,
    materialBuilding: false,
    materialSaving: false,
    materialPreview: '',
    materialSessionId: '',
    /** 预览区尺寸 px：对齐简报弹窗量级，随窗口等比缩放 */
    materialPreviewMaxH: 240,
    materialPreviewMaxW: 152,
    materialSpinnerSize: 36
  },

  onLoad() {
    this.initUiShell()
    this.setData(this._calcMaterialPreviewLayout())
    this._featureAllowed = false
    guardWatchPartyPage(this).then((ok) => {
      this._featureAllowed = !!ok
      if (ok && !this._unloaded) this.loadMe()
    })
  },

  onShow() {
    // 回前台默认重新掩码，降低截图/录屏误泄编号风险
    if (this.data.codeVisible) this.setData({ codeVisible: false })
    if (this._featureAllowed) this.loadMe()
  },

  onHide() {
    if (this.data.codeVisible) this.setData({ codeVisible: false })
  },

  onResize() {
    if (!this.data.materialVisible) return
    this.setData(this._calcMaterialPreviewLayout())
  },

  _safeSetData(patch) {
    if (this._unloaded) return
    this.setData(patch)
  },

  onUnload() {
    this._unloaded = true
  },

  /**
   * 物料弹层预览布局：整体量级对齐简报弹窗（约 70vh / 内容区 ~40% 屏高），
   * 海报与加载图标随窗口等比缩放；保存到相册仍用离屏 canvas 高清原图。
   */
  _calcMaterialPreviewLayout() {
    let wh = 667
    let ww = 375
    try {
      const info = (typeof wx.getWindowInfo === 'function')
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync()
      wh = Number(info.windowHeight) || wh
      ww = Number(info.windowWidth) || ww
    } catch (e) {}
    const short = wh <= 700
    // 弹层总高目标 ≈ 简报（矮屏 0.68 / 常屏 0.70）
    const popupRatio = short ? 0.68 : 0.70
    const popupH = Math.floor(wh * popupRatio)
    // 标题 + 说明 + 底栏按钮（与收紧后的 wxss 对齐）
    const chromePx = short ? 148 : 160
    // 预览区硬顶：约为屏高 36%～40%（旧版可到 64%，过大）
    const previewCap = Math.floor(wh * (short ? 0.36 : 0.40))
    let previewH = Math.min(popupH - chromePx, previewCap)
    if (previewH < 160) previewH = Math.max(140, Math.floor(wh * 0.30))

    // sheet：宽 92%、max 360px（720rpx）；预览左右再留内边距
    const sheetW = Math.min(Math.floor(ww * 0.92), 360)
    const contentW = Math.max(120, sheetW - 48)
    // 海报比例 750×1180，按高反推宽，再与内容宽取小
    let previewW = Math.floor(previewH * (750 / 1180))
    if (previewW > contentW) {
      previewW = contentW
      previewH = Math.floor(previewW * (1180 / 750))
    }
    // 加载转圈随预览宽等比（约 22%）
    const spinner = Math.max(28, Math.min(48, Math.round(previewW * 0.22)))
    return {
      materialPreviewMaxH: previewH,
      materialPreviewMaxW: previewW,
      materialSpinnerSize: spinner
    }
  },

  loadMe() {
    // 已有数据时静默刷新，避免从编辑页返回时整页闪加载态
    if (!this.data.bound && !this.data.sessions.length) {
      this.setData({ loading: true, error: '' })
    } else {
      this.setData({ error: '' })
    }
    watchParty.fetchMerchantMe().then((res) => {
      const prevShow = {}
      ;(this.data.sessions || []).forEach((s) => {
        if (s && s.sessionId && s._showCycles) prevShow[s.sessionId] = true
      })
      const sessions = (res.sessions || []).map((s) => ({
        ...s,
        stats: s.stats || { reservations: 0, scanUsers: 0, draws: 0, checkedIn: 0 },
        cycleHistory: Array.isArray(s.cycleHistory) ? s.cycleHistory : [],
        cycleHistoryCount: Number(s.cycleHistoryCount || 0) || 0,
        _showCycles: !!prevShow[s.sessionId],
        launchTimeText: formatLaunchTime(s.launchTime),
        rocketImage: resolveSessionRocketImage(s)
      }))
      const code = res.merchant && res.merchant.merchantCode
        ? String(res.merchant.merchantCode)
        : ''
      const merchantCodeMasked = code ? '•'.repeat(Math.max(code.length, 6)) : '••••••••'
      this._safeSetData({
        loading: false,
        bound: true,
        merchant: res.merchant,
        merchantCodeMasked,
        codeVisible: false,
        sessions
      })
    }).catch((err) => {
      if (err && err.code === 4011) {
        // 尚未绑定：展示编号绑定表单，并清掉员工免门控本地标记
        try { require('../../utils/merchant-staff-bypass.js').clear() } catch (e) {}
        this._safeSetData({
          loading: false,
          bound: false,
          merchant: null,
          merchantCodeMasked: '••••••••',
          codeVisible: false,
          sessions: []
        })
        return
      }
      this._safeSetData({ loading: false, error: (err && err.message) || '加载失败，请重试' })
    })
  },

  onRetry() {
    this.loadMe()
  },

  toggleCodeVisible() {
    this.setData({ codeVisible: !this.data.codeVisible })
  },

  // ── 绑定 ──

  // onCodeInput：composer-input-behavior（大小写仅提交时变换）

  onBind() {
    const code = String(this.data.codeInput || '').trim().toUpperCase()
    if (!code) {
      wx.showToast({ title: '请输入商家编号', icon: 'none' })
      return
    }
    if (this.data.binding) return
    this.setData({ binding: true })
    watchParty.merchantBind(code).then(() => {
      try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch {}
      wx.showToast({ title: '绑定成功', icon: 'success' })
      this._safeSetData({ binding: false, codeInput: '' })
      this.loadMe()
    }).catch((err) => {
      this._safeSetData({ binding: false })
      wx.showToast({ title: (err && err.message) || '绑定失败，请重试', icon: 'none' })
    })
  },

  onUnbind() {
    wx.showModal({
      title: '解绑商家',
      content: '解绑后此微信将无法管理场次，商家数据不受影响，可随时重新绑定。确定解绑吗？',
      success: (res) => {
        if (!res.confirm) return
        watchParty.merchantUnbind().then(() => {
          wx.showToast({ title: '已解绑', icon: 'none' })
          this.loadMe()
        }).catch(() => {
          wx.showToast({ title: '解绑失败，请重试', icon: 'none' })
        })
      }
    })
  },

  // ── 场次操作 ──

  onCreateSession() {
    const m = this.data.merchant
    if (m && m.status !== 'active') {
      wx.showToast({ title: '商家合作已暂停，暂不能新建场次', icon: 'none' })
      return
    }
    if ((this.data.sessions || []).length > 0) {
      wx.showToast({ title: '已有场次，请编辑或开启下一场', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/subpackages/watch-party/merchant-edit' })
  },

  onToggleCycleHistory(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    if (!id) return
    const sessions = (this.data.sessions || []).map((s) => {
      if (s.sessionId !== id) return s
      return Object.assign({}, s, { _showCycles: !s._showCycles })
    })
    this.setData({ sessions })
  },

  /** 归档本场任务账本，开启下一发射周期（物料码不变） */
  onStartNextCycle(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    const title = ds.title || '本场观礼'
    if (!id) return
    if (this._startingCycle) return
    wx.showModal({
      title: '开启下一场发射？',
      content: `将归档「${title}」的扫码/预约/抽奖统计，并重置「确认发射成功」。线下物料码不变；用户需再扫码才有新任务抽奖资格。确定后请编辑下一发任务。`,
      confirmText: '开启下一场',
      confirmColor: '#B45309',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm || this._unloaded) return
        this._startingCycle = true
        wx.showLoading({ title: '归档中…', mask: true })
        watchParty.merchantStartNextCycle(id).then(() => {
          if (this._unloaded) return
          try { wx.hideLoading() } catch (e) {}
          this._startingCycle = false
          wx.showToast({ title: '已开启下一场', icon: 'success' })
          this.loadMe()
          setTimeout(() => {
            if (this._unloaded) return
            wx.navigateTo({
              url: '/subpackages/watch-party/merchant-edit?sessionId=' + encodeURIComponent(id)
            })
          }, 400)
        }).catch((err) => {
          if (this._unloaded) return
          try { wx.hideLoading() } catch (e) {}
          this._startingCycle = false
          wx.showToast({
            title: (err && err.message) || '操作失败，请重试',
            icon: 'none'
          })
        })
      }
    })
  },

  onEditSession(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    if (!id) return
    wx.navigateTo({ url: `/subpackages/watch-party/merchant-edit?sessionId=${encodeURIComponent(id)}` })
  },

  onOpenScreen(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    if (!id) return
    wx.navigateTo({ url: `/subpackages/watch-party/screen?sessionId=${encodeURIComponent(id)}` })
  },

  /** 本场预约名单明细 */
  onOpenReservations(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    if (!id) return
    const title = String(ds.title || '').trim()
    const q = 'sessionId=' + encodeURIComponent(id) +
      (title ? '&title=' + encodeURIComponent(title) : '')
    wx.navigateTo({ url: '/subpackages/watch-party/merchant-reservations?' + q })
  },

  /**
   * 确认发射成功 → 开放本场现场奖品抽奖（用户仍须扫物料码）。
   * 二次确认，避免误点；已确认则仅提示。
   */
  onUnlockSuccess(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    const title = ds.title || '本场观礼'
    if (!id) return
    if (ds.unlocked === true || ds.unlocked === 'true') {
      wx.showToast({ title: '已开放抽奖，请引导用户扫物料码', icon: 'none' })
      return
    }
    if (this._unlockingSuccess) return
    wx.showModal({
      title: '确认发射成功？',
      content: `确认「${title}」火箭已发射成功？确认后现场扫码用户可抽取奖品，此操作不可撤销。`,
      confirmText: '确认成功',
      confirmColor: '#B45309',
      cancelText: '再想想',
      success: (res) => {
        if (!res.confirm || this._unloaded) return
        this._unlockingSuccess = true
        wx.showLoading({ title: '开放中…', mask: true })
        watchParty.merchantUnlockSessionSuccess(id).then((r) => {
          if (this._unloaded) return
          try { wx.hideLoading() } catch (e) {}
          this._unlockingSuccess = false
          wx.showToast({
            title: (r && r.already) ? '此前已开放' : '抽奖已开放',
            icon: 'success'
          })
          this.loadMe()
        }).catch((err) => {
          if (this._unloaded) return
          try { wx.hideLoading() } catch (e) {}
          this._unlockingSuccess = false
          wx.showToast({
            title: (err && err.message) || '操作失败，请重试',
            icon: 'none'
          })
        })
      }
    })
  },

  noop() {},

  onCloseMaterial() {
    this._safeSetData({
      materialVisible: false,
      materialBuilding: false,
      materialSaving: false,
      materialPreview: '',
      materialSessionId: ''
    })
    this._materialPath = ''
  },

  /** 生成带商家名 + 用途标注的线下打印物料海报 */
  onSaveMaterial(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    if (!id || this.data.materialBuilding) return
    this._safeSetData({
      materialVisible: true,
      materialBuilding: true,
      materialSaving: false,
      materialPreview: '',
      materialSessionId: id,
      ...this._calcMaterialPreviewLayout()
    })
    this._materialPath = ''

    watchParty.fetchMerchantSessionMaterial(id).then((mat) => {
      if (this._unloaded) return
      // 等弹层与离屏 canvas 挂载后再画
      setTimeout(() => {
        if (this._unloaded) return
        renderMaterialPoster(this, '#materialPosterCanvas', mat).then((path) => {
          if (this._unloaded) return
          this._materialPath = path
          this._safeSetData({
            materialBuilding: false,
            materialPreview: path,
            // 若此前未就绪，刷新列表状态
          })
          this.loadMe()
        }).catch(() => {
          if (this._unloaded) return
          this._safeSetData({ materialVisible: false, materialBuilding: false })
          wx.showToast({ title: '生成海报失败，请重试', icon: 'none' })
        })
      }, 80)
    }).catch((err) => {
      if (this._unloaded) return
      this._safeSetData({ materialVisible: false, materialBuilding: false })
      let title = (err && err.message) || '物料码获取失败'
      if (err && Number(err.code) === 4010 && /未授权|登录已过期/.test(title)) {
        title = '云函数未更新，请先部署 adminGateway'
      }
      wx.showToast({ title, icon: 'none', duration: 2800 })
    })
  },

  onConfirmSaveMaterial() {
    if (this.data.materialSaving || !this._materialPath) return
    const filePath = this._materialPath
    const app = typeof getApp === 'function' ? getApp() : null
    const doSave = () => {
      this._safeSetData({ materialSaving: true })
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => {
          if (this._unloaded) return
          this._safeSetData({ materialSaving: false })
          try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch {}
          wx.showToast({ title: '已保存到相册', icon: 'success' })
        },
        fail: (err) => {
          if (this._unloaded) return
          this._safeSetData({ materialSaving: false })
          const msg = (err && err.errMsg) || ''
          if (/auth deny|authorize|privacy/i.test(msg)) {
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许保存图片到相册，以便打印线下物料。',
              confirmText: '去设置',
              success: (r) => {
                if (r.confirm) wx.openSetting({})
              }
            })
            return
          }
          wx.showToast({ title: '保存失败，请重试', icon: 'none' })
        }
      })
    }

    const run = () => {
      if (app && typeof app.ensurePrivacyAuthorized === 'function') {
        Promise.resolve(app.ensurePrivacyAuthorized()).then((privacyRes) => {
          if (privacyRes && privacyRes.ok === false) {
            wx.showToast({ title: '请先同意隐私指引', icon: 'none' })
            return
          }
          doSave()
        }).catch(() => doSave())
        return
      }
      doSave()
    }
    run()
  },

  onDeleteSession(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    const title = ds.title || '该场次'
    if (!id) return
    wx.showModal({
      title: '删除场次',
      content: `确定删除「${title}」？短码与物料码将作废（已打印海报需重打），预约与奖品发放记录会保留。删除后可重新创建唯一场次。`,
      confirmColor: '#EF4444',
      success: (res) => {
        if (!res.confirm) return
        watchParty.merchantDeleteSession(id).then(() => {
          if (this._unloaded) return
          try { watchParty.invalidateEntryCache() } catch {}
          wx.showToast({ title: '已删除', icon: 'none' })
          this.loadMe()
        }).catch((err) => {
          if (this._unloaded) return
          wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
        })
      }
    })
  }
})
