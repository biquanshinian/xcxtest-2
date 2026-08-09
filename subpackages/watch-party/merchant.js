/**
 * 观礼商家中心
 * - 未绑定：输入运营发放的商家编号绑定微信
 * - 已绑定：名下场次列表（新建/编辑/大屏/删除），全程小程序端自助，无需后台
 */
const pageBase = require('../../utils/page-base.js')
const composerInput = require('./utils/composer-input-behavior.js')
const watchParty = require('./utils/api.js')
const { getRocketImage } = require('../../utils/util.js')
const rocketArtUtil = require('../../utils/rocket-config-art.js')
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
  // 优先用落库的 rocketImageName（自动获取任务时锁定），手动改火箭名不换图
  const lockName = session && session.rocketImageName ? String(session.rocketImageName).trim() : ''
  const name = lockName || (session && session.rocketName ? String(session.rocketName).trim() : '')
  return name ? (getRocketImage(name) || '') : ''
}

/** 与云端 MERCHANT_SESSIONS_MAX 对齐：单商家最多同时持有的场次数 */
const SESSIONS_MAX = 10

/** 商家头像大小上限：2M */
const AVATAR_MAX_BYTES = 2 * 1024 * 1024

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
    /** 「我也有观礼点位，想合作」：提交即自动入驻并绑定当前微信（免审核） */
    coopOpen: false,
    coopSubmitting: false,
    coopForm: { name: '', contactName: '', phone: '', wechatQr: '', location: '', note: '' },
    coopQrUploading: false,
    /** 入驻资料编辑（名称/联系人/联系电话/微信好友二维码/地址） */
    profileOpen: false,
    profileSaving: false,
    /** 商家头像上传/保存中（防重复点按） */
    avatarUploading: false,
    profileQrUploading: false,
    profileForm: { name: '', contactName: '', contactPhone: '', contactWechatQr: '', address: '' },
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
    // 管理页不允许从右上角菜单转发（防误分享商家中心）；
    // 场次卡「转发到群」按钮（open-type=share）不受影响
    try { wx.hideShareMenu({ fail: () => {} }) } catch (e) {}
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
    rocketArtUtil.applyRocketConfigArtIfNeeded(this)
  },

  refreshRocketConfigArt() {
    const sessions = this.data.sessions
    if (!Array.isArray(sessions) || !sessions.length) return
    let mutated = false
    const next = sessions.map((s) => {
      if (!s) return s
      const img = resolveSessionRocketImage(s)
      if (img === s.rocketImage) return s
      mutated = true
      return Object.assign({}, s, { rocketImage: img })
    })
    if (mutated) this._safeSetData({ sessions: next })
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

  // ── 入驻资料编辑 ──

  onProfileToggle() {
    if (this.data.profileOpen) {
      this.setData({ profileOpen: false })
      return
    }
    const m = this.data.merchant || {}
    this.setData({
      profileOpen: true,
      profileForm: {
        name: m.name || '',
        contactName: m.contactName || '',
        contactPhone: m.contactPhone || '',
        contactWechatQr: m.contactWechatQr || '',
        address: m.address || ''
      }
    })
  },

  onSaveProfile() {
    if (this.data.profileSaving) return
    const f = this.data.profileForm || {}
    const name = String(f.name || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写商家/观礼点名称', icon: 'none' })
      return
    }
    const contactPhone = String(f.contactPhone || '').trim()
    if (contactPhone && contactPhone.replace(/\D/g, '').length < 6) {
      wx.showToast({ title: '联系电话格式不正确', icon: 'none' })
      return
    }
    this.setData({ profileSaving: true })
    watchParty.merchantUpdateProfile({
      name,
      contactName: String(f.contactName || '').trim(),
      contactPhone,
      contactWechatQr: String(f.contactWechatQr || '').trim(),
      address: String(f.address || '').trim()
    }).then(() => {
      // 改名会体现在顾客页「观礼点由 xx 提供」，本地入口缓存一并失效
      try { watchParty.invalidateEntryCache() } catch (e) {}
      try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch (e) {}
      if (this._unloaded) return
      this._safeSetData({ profileSaving: false, profileOpen: false })
      wx.showToast({ title: '资料已更新', icon: 'success' })
      this.loadMe()
    }).catch((err) => {
      this._safeSetData({ profileSaving: false })
      wx.showToast({ title: (err && err.message) || '保存失败，请重试', icon: 'none' })
    })
  },

  /** 资料内上传/更换微信好友二维码（先落本地 profileForm，保存资料时一并提交） */
  onUploadProfileWechatQr() {
    this._uploadContactWechatQr({
      flagKey: 'profileQrUploading',
      onDone: (fileID) => this._safeSetData({ 'profileForm.contactWechatQr': fileID })
    })
  },

  onRemoveProfileWechatQr() {
    this.setData({ 'profileForm.contactWechatQr': '' })
  },

  onUploadCoopWechatQr() {
    this._uploadContactWechatQr({
      flagKey: 'coopQrUploading',
      onDone: (fileID) => this._safeSetData({ 'coopForm.wechatQr': fileID })
    })
  },

  onRemoveCoopWechatQr() {
    this.setData({ 'coopForm.wechatQr': '' })
  },

  _uploadContactWechatQr({ flagKey, onDone }) {
    if (this.data[flagKey]) return
    if (typeof wx.chooseMedia !== 'function') {
      wx.showToast({ title: '当前微信版本不支持选图', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        if (this._unloaded) return
        const f = res && res.tempFiles && res.tempFiles[0]
        if (!f || !f.tempFilePath) return
        if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
          wx.showToast({ title: '云能力不可用', icon: 'none' })
          return
        }
        this._safeSetData({ [flagKey]: true })
        wx.showLoading({ title: '上传中…', mask: true })
        const extMatch = /\.(\w+)$/.exec(f.tempFilePath || '')
        const ext = (extMatch && extMatch[1].toLowerCase()) || 'jpg'
        wx.cloud.uploadFile({
          cloudPath: `watch_party/contact_wechat_qr/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
          filePath: f.tempFilePath,
          success: (up) => {
            try { wx.hideLoading() } catch (e) {}
            if (this._unloaded) return
            const fileID = (up && up.fileID) || ''
            this._safeSetData({ [flagKey]: false })
            if (!fileID) {
              wx.showToast({ title: '上传失败，请重试', icon: 'none' })
              return
            }
            if (typeof onDone === 'function') onDone(fileID)
            wx.showToast({ title: '二维码已上传', icon: 'success' })
          },
          fail: () => {
            try { wx.hideLoading() } catch (e) {}
            if (this._unloaded) return
            this._safeSetData({ [flagKey]: false })
            wx.showToast({ title: '上传失败，请重试', icon: 'none' })
          }
        })
      },
      fail: (err) => {
        if (this._unloaded) return
        const msg = (err && err.errMsg) || ''
        if (/cancel/i.test(msg)) return
        wx.showToast({ title: '选图失败，请重试', icon: 'none' })
      }
    })
  },

  // ── 商家头像（≤2M：相册选图 → 云存储 → 云端存 fileID，顾客选商家页圆形展示） ──

  onAvatarTap() {
    if (this.data.avatarUploading) return
    const hasAvatar = !!(this.data.merchant && this.data.merchant.avatar)
    if (!hasAvatar) {
      this._chooseAvatar()
      return
    }
    wx.showActionSheet({
      itemList: ['更换头像', '移除头像'],
      success: (r) => {
        if (this._unloaded) return
        if (r.tapIndex === 0) this._chooseAvatar()
        else if (r.tapIndex === 1) this._confirmRemoveAvatar()
      },
      fail: () => {}
    })
  },

  /** 移除头像前二次确认：说明影响 + 宽心提示（删除类操作统一需确认） */
  _confirmRemoveAvatar() {
    wx.showModal({
      title: '移除头像吗',
      content: '移除后，顾客在选择商家时会看到默认样式。之后随时可以再上传新头像。',
      confirmText: '移除',
      cancelText: '再想想',
      confirmColor: '#EF4444',
      success: (res) => {
        if (this._unloaded) return
        if (res.confirm) this._saveAvatar('')
      }
    })
  },

  _chooseAvatar() {
    if (typeof wx.chooseMedia !== 'function') {
      wx.showToast({ title: '当前微信版本不支持选图', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        if (this._unloaded) return
        const f = res && res.tempFiles && res.tempFiles[0]
        if (!f || !f.tempFilePath) return
        if (Number(f.size) > AVATAR_MAX_BYTES) {
          wx.showToast({ title: '头像需小于 2M，请换一张或压缩后再传', icon: 'none' })
          return
        }
        this._uploadAvatar(f.tempFilePath)
      },
      fail: (err) => {
        if (this._unloaded) return
        const msg = (err && err.errMsg) || ''
        if (/cancel/i.test(msg)) return
        if (/privacy agreement|not declared|privacy/i.test(msg) || (err && Number(err.errno) === 112)) {
          wx.showModal({
            title: '选图接口未声明',
            content: '请在微信公众平台 → 用户隐私保护指引中声明「收集你选中的照片或视频信息」（对应 wx.chooseMedia），审核通过后再试。',
            showCancel: false,
            confirmText: '知道了'
          })
          return
        }
        wx.showToast({ title: '选图失败，请重试', icon: 'none' })
      }
    })
  },

  _uploadAvatar(filePath) {
    if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      wx.showToast({ title: '云能力不可用', icon: 'none' })
      return
    }
    this._safeSetData({ avatarUploading: true })
    wx.showLoading({ title: '上传中…', mask: true })
    const extMatch = /\.(\w+)$/.exec(filePath || '')
    const ext = (extMatch && extMatch[1].toLowerCase()) || 'jpg'
    wx.cloud.uploadFile({
      cloudPath: `watch_party/merchant_avatar/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
      filePath,
      success: (res) => {
        const fileID = (res && res.fileID) || ''
        if (!fileID) {
          try { wx.hideLoading() } catch (e) {}
          this._safeSetData({ avatarUploading: false })
          wx.showToast({ title: '上传失败，请重试', icon: 'none' })
          return
        }
        this._saveAvatar(fileID, { keepLoading: true })
      },
      fail: () => {
        try { wx.hideLoading() } catch (e) {}
        if (this._unloaded) return
        this._safeSetData({ avatarUploading: false })
        wx.showToast({ title: '上传失败，请重试', icon: 'none' })
      }
    })
  },

  /** 保存头像 fileID（空串 = 移除）；成功后本地即时生效并清入口缓存 */
  _saveAvatar(avatar, opts = {}) {
    if (!opts.keepLoading) {
      this._safeSetData({ avatarUploading: true })
      wx.showLoading({ title: avatar ? '保存中…' : '移除中…', mask: true })
    }
    watchParty.merchantUpdateAvatar(avatar).then(() => {
      try { wx.hideLoading() } catch (e) {}
      if (this._unloaded) return
      this._safeSetData({ avatarUploading: false, 'merchant.avatar': avatar })
      try { watchParty.invalidateEntryCache() } catch (e) {}
      try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch (e) {}
      wx.showToast({ title: avatar ? '头像已更新' : '已移除头像', icon: 'success' })
    }).catch((err) => {
      try { wx.hideLoading() } catch (e) {}
      if (this._unloaded) return
      this._safeSetData({ avatarUploading: false })
      wx.showToast({ title: (err && err.message) || '保存失败，请重试', icon: 'none' })
    })
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
      try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch (e) {}
      wx.showToast({ title: '绑定成功', icon: 'success' })
      this._safeSetData({ binding: false, codeInput: '' })
      this.loadMe()
    }).catch((err) => {
      this._safeSetData({ binding: false })
      wx.showToast({ title: (err && err.message) || '绑定失败，请重试', icon: 'none' })
    })
  },

  // ── 合作申请（未绑定视图）：与 merchant-apply 页同一云端链路，提交即自动入驻 ──

  onCoopToggle() {
    this.setData({ coopOpen: !this.data.coopOpen })
  },

  onSubmitCoop() {
    const { coopForm, coopSubmitting } = this.data
    if (coopSubmitting) return
    const name = String(coopForm.name || '').trim()
    const contactName = String(coopForm.contactName || '').trim()
    const phone = String(coopForm.phone || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写商家/观礼点名称', icon: 'none' })
      return
    }
    if (!contactName) {
      wx.showToast({ title: '请填写联系人姓名', icon: 'none' })
      return
    }
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请填写正确的手机号', icon: 'none' })
      return
    }
    this.setData({ coopSubmitting: true })
    watchParty.applyMerchantCooperation({
      name,
      contactName,
      phone,
      wechatQr: String(coopForm.wechatQr || '').trim(),
      location: String(coopForm.location || '').trim(),
      note: String(coopForm.note || '').trim()
    }).then((res) => {
      try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch (e) {}
      this._safeSetData({
        coopSubmitting: false,
        coopOpen: false,
        coopForm: { name: '', contactName: '', phone: '', wechatQr: '', location: '', note: '' }
      })
      const code = (res && res.merchantCode) || ''
      const needPay = !!(res && res.membershipNeedPay)
      const payNotice = (res && res.membershipPayNotice) || '请联系运营人员缴费开通商家会员'
      wx.showModal({
        title: needPay ? '入驻成功 · 待缴费开通' : '入驻成功',
        content: needPay
          ? `您已成为观礼合作商家（编号 ${code || '见商家中心'}）。${payNotice}`
          : `您已成为观礼合作商家（编号 ${code || '见商家中心'}），当前微信已自动绑定。现在就创建第一个观礼场次吧！`,
        showCancel: false,
        confirmText: needPay ? '知道了' : '开始使用'
      })
      // 自动通过审核，直接刷新为已绑定的商家中心视图
      this.loadMe()
    }).catch((err) => {
      this._safeSetData({ coopSubmitting: false })
      const msg = (err && err.message) || '提交失败，请重试'
      // 已绑定商家 / 手机号重复等业务拦截：弹窗展示完整原因
      if (err && err.code === 4002) {
        wx.showModal({
          title: '无法提交',
          content: msg,
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }
      wx.showToast({ title: msg, icon: 'none' })
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
    if ((this.data.sessions || []).length >= SESSIONS_MAX) {
      wx.showToast({ title: `最多同时保留 ${SESSIONS_MAX} 个场次，请先删除不用的场次`, icon: 'none' })
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
      // confirmText 最多 4 个汉字；超长时部分基础库会静默失败，表现为点击无反应
      confirmText: '确认开启',
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

  /**
   * 场次转发（群通知顾客填预约）：
   * - 「转发到群」按钮（open-type=share）带 dataset，精确分享该场次的顾客详情页
   * - 「推荐给同行」按钮（data-share=peer）：分享入驻申请页，带本商家推荐归属
   * - 右上角菜单转发兜底：分享第一个可预约场次；无场次时分享商家列表页
   * - 任何情况都不会把商家管理页本身分享出去
   */
  onShareAppMessage(e) {
    const ds = (e && e.from === 'button' && e.target && e.target.dataset) || {}
    // 推荐给同行：落地入驻申请页，ref 供服务端反查归属（refName 仅展示）
    if (ds.share === 'peer') {
      const m = this.data.merchant || {}
      const mid = String(m.merchantId || '').trim()
      const mname = String(m.name || '').trim()
      let path = '/subpackages/watch-party/merchant-apply?channel=peer_share'
      if (mid) path += '&ref=' + encodeURIComponent(mid)
      if (mname) path += '&refName=' + encodeURIComponent(mname)
      return {
        title: (mname ? mname + ' 邀请你' : '邀请你') + '入驻火箭观礼商家｜推荐成功送1个月商家会员',
        path
      }
    }
    let sessionId = ds.id || ''
    let title = ds.title || ''
    let img = ds.img || ''
    if (!sessionId) {
      const sessions = this.data.sessions || []
      const best = sessions.find((s) => s && s.enabled && s.status === 'open') || sessions[0]
      if (best) {
        sessionId = best.sessionId
        title = best.title || ''
        img = best.rocketImage || ''
      }
    }
    const m = this.data.merchant
    const merchantName = (m && m.name) ? String(m.name).trim() : ''
    if (!sessionId) {
      return {
        title: '火箭发射现场观礼 · 免费预约',
        path: '/subpackages/watch-party/merchant-list?channel=merchant_share'
      }
    }
    const share = {
      title: (merchantName ? merchantName + '·' : '') + (title || '火箭发射观礼') + '｜点开填预约信息',
      path: '/subpackages/watch-party/watch-party?sessionId=' + encodeURIComponent(sessionId) + '&channel=merchant_share'
    }
    if (img) share.imageUrl = img
    return share
  },

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
          try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch (e) {}
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
      title: '删除这个场次吗',
      content: `删除「${title}」后：顾客将不能再查看和预约本场次；已上传的图片、视频等资料会一并清理；短码和物料码会作废（已打印的海报需要重新打印）。顾客的预约记录和已抽中的奖品记录都会保留，不受影响。`,
      confirmText: '删除',
      cancelText: '再想想',
      confirmColor: '#EF4444',
      success: (res) => {
        if (!res.confirm) return
        watchParty.merchantDeleteSession(id).then(() => {
          if (this._unloaded) return
          try { watchParty.invalidateEntryCache() } catch (e) {}
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
