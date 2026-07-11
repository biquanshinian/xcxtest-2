const { getUiShellLayout } = require('../../../utils/layout.js')
const { getThemeClassSync, isLightSync, getPageBgSync } = require('../../../utils/theme.js')
const { listMyOrders, deleteMyOrder } = require('../../../utils/membership.js')

/** 订单状态 → 展示文案 + 颜色类（未知状态兜底为「处理中」，数据驱动不写死枚举） */
const STATUS_MAP = {
  pending: { text: '待支付', cls: 'pending' },
  paid: { text: '已完成', cls: 'paid' },
  refund_pending: { text: '退款中', cls: 'refunding' },
  refunded: { text: '已退款', cls: 'refunded' },
  refund_failed: { text: '退款异常', cls: 'failed' },
  failed: { text: '支付失败', cls: 'failed' },
  cancelled: { text: '已取消', cls: 'refunded' }
}

const PLAN_TEXT = { monthly: '月卡订阅', yearly: '年卡订阅', permanent: '永久买断' }

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

/** 分转元：整数元省略小数（30.0 → 30） */
function fenToYuan(fen) {
  const yuan = Number(fen || 0) / 100
  return yuan % 1 === 0 ? String(yuan) : yuan.toFixed(2)
}

/** 原始订单 → 展示模型 */
function formatOrder(raw) {
  const status = STATUS_MAP[raw.status] || { text: '处理中', cls: 'pending' }
  const createdMs = toMs(raw.createdAt)

  let typeText
  if (raw.orderType === 'subscription') {
    typeText = PLAN_TEXT[raw.planId] || '订阅'
  } else {
    typeText = '功能解锁'
  }

  // 退款订单补充退款金额与到账时间
  let refundText = ''
  if (raw.status === 'refunded') {
    const refundMs = toMs(raw.refundedAt)
    refundText = '已退 ¥' + fenToYuan(raw.refundFee != null ? raw.refundFee : raw.amount) +
      (refundMs ? '（' + fmtTime(refundMs) + '）' : '')
  } else if (raw.status === 'refund_pending') {
    refundText = '退款处理中，1-3 个工作日到账'
  }

  return {
    id: raw._id,
    name: raw.description || '会员商品',
    orderType: raw.orderType === 'subscription' ? 'subscription' : 'product',
    typeText: typeText,
    amountText: fenToYuan(raw.amount),
    statusText: status.text,
    statusClass: status.cls,
    isPaid: raw.status === 'paid',
    amountFen: Number(raw.amount || 0),
    createdMs: createdMs,
    timeText: fmtTime(createdMs),
    refundText: refundText
  }
}

/** 按「2026年7月」分组（云端已按时间倒序，这里顺序遍历即可保持组内有序） */
function groupByMonth(items) {
  const groups = []
  let current = null
  items.forEach(function (it) {
    const d = it.createdMs ? new Date(it.createdMs) : null
    const month = d ? d.getFullYear() + '年' + (d.getMonth() + 1) + '月' : '时间未知'
    if (!current || current.month !== month) {
      current = { month: month, items: [] }
      groups.push(current)
    }
    current.items.push(it)
  })
  return groups
}

Page({
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    loading: true,
    errorMessage: '',
    orders: [],
    groups: [],
    summary: { total: 0, paidCount: 0, paidAmountText: '0' }
  },

  onLoad() {
    const layout = getUiShellLayout()
    this.setData({
      statusBarHeight: layout.statusBarHeight,
      navPlaceholderHeight: layout.navPlaceholderHeight,
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: getPageBgSync()
    })
    this.loadOrders()
  },

  async loadOrders() {
    this.setData({ loading: true, errorMessage: '' })
    const res = await listMyOrders()
    if (!res.success) {
      this.setData({ loading: false, errorMessage: res.error || '加载失败' })
      return
    }

    this._applyOrders((res.orders || []).map(formatOrder))
  },

  /** 列表 → 分组 + 汇总（加载与删除后共用） */
  _applyOrders(items) {
    // 汇总：已完成单数 + 实际净支出（已支付金额，剔除已退款订单）
    let paidCount = 0
    let paidFen = 0
    items.forEach(function (it) {
      if (it.isPaid) {
        paidCount++
        paidFen += it.amountFen
      }
    })

    this.setData({
      loading: false,
      orders: items,
      groups: groupByMonth(items),
      summary: {
        total: items.length,
        paidCount: paidCount,
        paidAmountText: fenToYuan(paidFen)
      }
    })
  },

  /** 长按订单卡片：确认后删除记录（云端校验本人所有，退款中订单会被拒绝） */
  onOrderLongPress(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    if (!id || this._deleting) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    const self = this
    wx.showModal({
      title: '删除订单记录',
      content: `确定删除「${ds.name || '该订单'}」的记录吗？订单号是售后凭证，删除后不可恢复。`,
      confirmText: '删除',
      confirmColor: '#FF4444',
      cancelText: '保留',
      success(res) {
        if (!res.confirm) return
        self._doDeleteOrder(id)
      }
    })
  },

  async _doDeleteOrder(id) {
    this._deleting = true
    wx.showLoading({ title: '删除中...', mask: true })
    const res = await deleteMyOrder(id)
    wx.hideLoading()
    this._deleting = false
    if (!res.success) {
      wx.showToast({ title: res.error || '删除失败', icon: 'none' })
      return
    }
    this._applyOrders(this.data.orders.filter(function (it) { return it.id !== id }))
    wx.showToast({ title: '已删除', icon: 'none' })
  },

  onRetry() {
    this.loadOrders()
  },

  onCopyOrderNo(e) {
    const no = e.currentTarget.dataset.no
    if (!no) return
    wx.setClipboardData({
      data: String(no),
      success: function () {
        wx.showToast({ title: '订单号已复制', icon: 'none' })
      }
    })
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.navigateTo({ url: '/subpackages/profile-extra/membership/membership' })
    }
  }
})
