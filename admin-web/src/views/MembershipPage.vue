<template>
  <div class="membership-page">
    <div class="page-header">
      <div>
        <div class="page-title">会员管理</div>
        <div class="page-subtitle">查看会员、订单与 PRO 白名单，所有数据实时刷新</div>
      </div>
      <div class="page-header-actions">
        <el-tag :type="membershipEnabled ? 'success' : 'info'" effect="dark" round>
          {{ membershipEnabled ? '会员系统已开启' : '会员系统已关闭' }}
        </el-tag>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <!-- 统计概览 -->
    <el-row :gutter="16" class="stat-row">
      <el-col :xs="12" :sm="6">
        <el-card class="stat-card stat-pro" shadow="never">
          <div class="stat-pro-badge">PRO</div>
          <div class="stat-pro-shine"></div>
          <div class="stat-label">尊贵会员数</div>
          <div class="stat-value">{{ proStats.total }}</div>
          <div class="stat-hint">白名单 {{ proStats.whitelist }} · 订阅 {{ proStats.paid }} · 单品 {{ proStats.product }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card class="stat-card" shadow="never">
          <div class="stat-label">已支付订单</div>
          <div class="stat-value">{{ stats.orderCount }}</div>
          <div class="stat-hint">含订阅与一次性购买</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card class="stat-card" shadow="never">
          <div class="stat-label">净收入（元）</div>
          <div class="stat-value">{{ stats.netRevenue.toFixed(2) }}</div>
          <div class="stat-hint">已支付 {{ stats.totalRevenue.toFixed(2) }} − 退款 {{ stats.refundedRevenue.toFixed(2) }}</div>
          <div v-if="stats.refundPendingRevenue > 0" class="stat-hint stat-warn">
            退款中 {{ stats.refundPendingRevenue.toFixed(2) }}
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card class="stat-card" shadow="never">
          <div class="stat-label">退款 / 待发货</div>
          <div class="stat-value">{{ stats.refundCount }} / {{ stats.pendingCount }}</div>
          <div class="stat-hint">退款单 {{ stats.refundCount }} 笔，待支付 {{ stats.pendingCount }} 笔</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- PRO 白名单 -->
    <el-card class="section-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <span class="section-title">PRO 白名单</span>
            <span class="section-hint">每行一个 OpenID，保存后立即生效（用户端缓存约 10 分钟）</span>
          </div>
          <el-tag v-if="proWhitelistOpenids.length" type="warning" size="small" round>
            {{ proWhitelistOpenids.length }} 个
          </el-tag>
        </div>
      </template>

      <el-input
        v-model="whitelistText"
        type="textarea"
        :rows="5"
        placeholder="每行一个用户 OpenID，可粘贴多行"
        :disabled="whitelistSaving"
      />
      <div class="whitelist-actions">
        <el-button type="primary" :loading="whitelistSaving" :icon="Check" @click="saveWhitelist">
          保存白名单
        </el-button>
        <el-button :disabled="whitelistSaving" :icon="RefreshLeft" @click="resetWhitelistFromServer">
          重新加载
        </el-button>
        <span v-if="whitelistDirty" class="whitelist-dirty">有未保存修改</span>
      </div>
    </el-card>

    <!-- PRO 会员列表 -->
    <el-card class="section-card pro-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <span class="section-title pro-title">
              <el-icon><Star /></el-icon>
              PRO 会员列表
            </span>
            <span class="section-hint">订阅 PRO、单独购买单品或加入白名单的用户</span>
          </div>
          <el-tag type="warning" effect="dark" size="small" round>{{ proMembers.length }} 人</el-tag>
        </div>
      </template>

      <el-table
        :data="proMembers"
        v-loading="loading"
        stripe
        empty-text="暂无 PRO 会员"
        style="width:100%"
      >
        <el-table-column prop="_id" label="OpenID" width="260" show-overflow-tooltip />
        <el-table-column label="来源" width="170">
          <template #default="{ row }">
            <el-tag v-if="row.proSource === 'whitelist'" type="warning" size="small">白名单</el-tag>
            <el-tag v-else-if="row.proSource === 'product'" type="primary" size="small">单品</el-tag>
            <template v-else>
              <el-tag v-for="t in row.acqTags" :key="t.label" :type="t.type" size="small" style="margin:2px;">
                {{ t.label }}
              </el-tag>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="套餐" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.planLabel" :type="row.planLabel === '永久' ? 'danger' : (row.planLabel === '年卡' ? 'warning' : 'success')" size="small" effect="plain">
              {{ row.planLabel }}
            </el-tag>
            <span v-else style="color:#999">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="expireAt" label="到期时间" width="180">
          <template #default="{ row }">
            <span v-if="row.proSource === 'whitelist' && !row.expireAt" style="color:#909399;">长期</span>
            <span v-else>{{ row.expireAt ? formatDate(row.expireAt) : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="purchases" label="已购产品" min-width="200">
          <template #default="{ row }">
            <el-tag v-for="p in (row.purchases || [])" :key="p" size="small" style="margin:2px;">
              {{ productName(p) }}
            </el-tag>
            <span v-if="!row.purchases || !row.purchases.length" style="color:#999">无</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="注册时间" width="160">
          <template #default="{ row }">
            {{ row.createdAt ? formatDate(row.createdAt) : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link @click="openGrantDialog(row._id)">续期/赠送</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 普通会员列表 -->
    <el-card class="section-card" shadow="never">
      <template #header>
        <div class="section-header" style="cursor:pointer;" @click="freeMembersExpanded = !freeMembersExpanded">
          <div>
            <span class="section-title">免费用户列表</span>
            <span class="section-hint">未购买 PRO 且不在白名单中的用户 · 按最近活跃排序，仅展示前 1000 条</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <el-tag type="info" size="small" round>
              {{ freeTotalCount > freeMembers.length ? `共 ${freeTotalCount} 人 · 展示 ${freeMembers.length}` : `${freeMembers.length} 人` }}
            </el-tag>
            <el-icon :class="['expand-arrow', freeMembersExpanded ? 'expand-arrow--open' : '']">
              <ArrowDown />
            </el-icon>
          </div>
        </div>
      </template>

      <el-table
        v-if="freeMembersExpanded"
        :data="freeMembers"
        v-loading="loading"
        stripe
        empty-text="暂无免费用户"
        style="width:100%"
      >
        <el-table-column prop="_id" label="OpenID" width="260" show-overflow-tooltip />
        <el-table-column label="类型" width="80">
          <template #default>
            <el-tag type="info" size="small">FREE</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="expireAt" label="到期时间" width="180">
          <template #default="{ row }">
            <span v-if="row.expireAt" style="color:#999">{{ formatDate(row.expireAt) }}（已过期）</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="purchases" label="历史已购" min-width="200">
          <template #default="{ row }">
            <el-tag v-for="p in (row.purchases || [])" :key="p" size="small" style="margin:2px;">
              {{ productName(p) }}
            </el-tag>
            <span v-if="!row.purchases || !row.purchases.length" style="color:#999">无</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="注册时间" width="160">
          <template #default="{ row }">
            {{ row.createdAt ? formatDate(row.createdAt) : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link @click="openGrantDialog(row._id)">赠送 PRO</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 订单列表 -->
    <el-card class="section-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <span class="section-title">订单记录</span>
            <span class="section-hint">支持按 OpenID / 状态 / 类型筛选，支持 CSV 导出与人工退款</span>
          </div>
          <el-tag size="small" round>共 {{ orderTotal }} 单</el-tag>
        </div>
      </template>

      <div class="order-toolbar">
        <el-input
          v-model="orderQuery.openid"
          placeholder="按 OpenID 搜索"
          clearable
          style="width:280px;"
          @keyup.enter="onOrderSearch"
        />
        <el-select v-model="orderQuery.status" placeholder="所有状态" clearable style="width:140px;">
          <el-option label="已支付" value="paid" />
          <el-option label="待支付" value="pending" />
          <el-option label="退款中" value="refund_pending" />
          <el-option label="已退款" value="refunded" />
          <el-option label="已失败" value="failed" />
        </el-select>
        <el-select v-model="orderQuery.orderType" placeholder="所有类型" clearable style="width:140px;">
          <el-option label="订阅" value="subscription" />
          <el-option label="单品" value="product" />
        </el-select>
        <el-button type="primary" @click="onOrderSearch">搜索</el-button>
        <el-button @click="onOrderReset">重置</el-button>
        <el-button @click="exportOrders">导出 CSV</el-button>
        <el-button :loading="recheckLoading" type="warning" @click="onRecheckPending">
          {{ recheckLoading ? '正在同步…' : '同步订单状态' }}
        </el-button>
      </div>

      <el-table :data="orderPage" v-loading="orderPageLoading" stripe empty-text="暂无订单" style="width:100%">
        <el-table-column prop="_id" label="订单号" width="220" show-overflow-tooltip />
        <el-table-column prop="openid" label="用户" width="220" show-overflow-tooltip />
        <el-table-column prop="description" label="商品" min-width="160" show-overflow-tooltip />
        <el-table-column prop="amount" label="金额" width="120">
          <template #default="{ row }">
            <span style="font-weight:600;">¥{{ ((row.amount || 0) / 100).toFixed(2) }}</span>
            <span style="color:#999;font-size:12px;margin-left:4px;">({{ row.amount }}分)</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.orderType === 'subscription' ? 'warning' : 'info'">
              {{ row.orderType === 'subscription' ? '订阅' : (row.orderType === 'product' ? '单品' : row.orderType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="vpayProductId" label="虚拟支付商品" width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.vpayProductId" style="font-family:monospace;">{{ row.vpayProductId }}</span>
            <span v-else style="color:#999">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="160">
          <template #default="{ row }">
            {{ row.createdAt ? formatDate(row.createdAt) : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'paid'"
              size="small"
              type="danger"
              link
              @click="openRefundDialog(row)"
            >退款</el-button>
            <el-button
              size="small"
              link
              @click="openGrantDialog(row.openid)"
            >赠送</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="order-pagination">
        <el-pagination
          background
          layout="total, prev, pager, next, sizes"
          :total="orderTotal"
          :current-page="orderQuery.page"
          :page-size="orderQuery.pageSize"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="onOrderPageChange"
          @size-change="(s) => { orderQuery.pageSize = s; orderQuery.page = 1; loadOrdersPage() }"
        />
      </div>
    </el-card>

    <!-- 虚拟支付配置 -->
    <el-card class="section-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <span class="section-title">虚拟支付配置</span>
            <span class="section-hint">offerId 与环境写入库后由 membership 下单签名读取（env=0 现网；env=1 沙箱，仅安卓）。AppKey 仍用云函数环境变量</span>
          </div>
        </div>
      </template>
      <el-form :model="vpayConfig" label-width="120px" style="max-width:560px;">
        <el-form-item label="OfferId">
          <el-input v-model="vpayConfig.offerId" placeholder="商户后台 → 基础配置 → offerid" />
        </el-form-item>
        <el-form-item label="环境">
          <el-radio-group v-model="vpayConfig.env">
            <el-radio :label="0">现网（env=0）</el-radio>
            <el-radio :label="1">沙箱（env=1，仅安卓）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="vpayConfigSaving" @click="saveVPayConfig">保存配置</el-button>
          <span style="color:#909399;margin-left:12px;font-size:12px;">保存后即时生效于下单签名；AppKey 仍由云函数环境变量 VPAY_APPKEY_PROD/SANDBOX 配置</span>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 商品价格 -->
    <el-card class="section-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <span class="section-title">商品价格</span>
            <span class="section-hint">单位：分（1 分 = 0.01 元）；只能修改价格，新增/删除 SKU 仍需发版</span>
          </div>
          <div>
            <el-button :loading="skuPricesLoading" @click="loadSkuPrices">刷新</el-button>
            <el-button type="primary" :disabled="!skuPriceDirty" :loading="skuPriceSaving" @click="onSavePrices">保存改动</el-button>
          </div>
        </div>
      </template>

      <el-alert
        type="error"
        :closable="false"
        title="重要：改价后必须同步商户后台"
        description="修改价格后，请同时在「微信公众平台 → 小程序 → 虚拟支付 → 道具管理」把对应 productId 的道具价格也改为相同金额并发布到现网。两边不一致会导致下单被微信拒绝。"
        show-icon
        style="margin-bottom: 12px;"
      />

      <el-table :data="skuPriceItems" v-loading="skuPricesLoading" stripe style="width:100%">
        <el-table-column prop="name" label="商品名" min-width="180" />
        <el-table-column prop="id" label="vpayProductId" width="240">
          <template #default="{ row }">
            <span style="font-family: monospace;">{{ row.id }}</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.kind === 'subscription' ? 'warning' : 'info'">
              {{ row.kind === 'subscription' ? '订阅' : '单品' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="默认价" width="140">
          <template #default="{ row }">
            <div>{{ row.defaultPrice }} 分</div>
            <div style="color:#909399;font-size:12px;">¥ {{ (row.defaultPrice / 100).toFixed(2) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="当前价（可修改）" min-width="240">
          <template #default="{ row }">
            <div style="display:flex;align-items:center;gap:8px;">
              <el-input-number
                v-model="row.editPrice"
                :min="1"
                :max="99999900"
                :step="10"
                size="small"
                style="width:160px;"
              />
              <span style="color:#606266;font-size:12px;">¥ {{ (row.editPrice / 100).toFixed(2) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="变动" width="130">
          <template #default="{ row }">
            <span v-if="row.editPrice === row.defaultPrice" style="color:#909399;">默认</span>
            <span v-else-if="row.editPrice > row.defaultPrice" style="color:#f56c6c;">
              ↑ {{ priceDeltaText(row) }}
            </span>
            <span v-else style="color:#67c23a;">
              ↓ {{ priceDeltaText(row) }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 赠送弹窗 -->
    <el-dialog v-model="grantDialog.visible" title="人工赠送 PRO" width="480">
      <el-form :model="grantDialog" label-width="90px">
        <el-form-item label="OpenID">
          <el-input v-model="grantDialog.openid" placeholder="目标用户 openid" />
        </el-form-item>
        <el-form-item label="永久会员">
          <el-switch v-model="grantDialog.permanent" />
        </el-form-item>
        <el-form-item label="天数" v-if="!grantDialog.permanent">
          <el-input-number v-model="grantDialog.days" :min="1" :max="36500" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="grantDialog.reason" type="textarea" :rows="2" placeholder="赠送原因（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="grantDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="grantDialog.saving" @click="submitGrant">确认赠送</el-button>
      </template>
    </el-dialog>

    <!-- 退款弹窗 -->
    <el-dialog v-model="refundDialog.visible" title="人工退款" width="480">
      <el-form :model="refundDialog" label-width="100px">
        <el-form-item label="订单号">
          <el-input v-model="refundDialog.outTradeNo" disabled />
        </el-form-item>
        <el-form-item label="原始金额">
          <span>¥{{ (refundDialog.amount / 100).toFixed(2) }}（{{ refundDialog.amount }} 分）</span>
        </el-form-item>
        <el-form-item label="退款金额(分)">
          <el-input-number v-model="refundDialog.refundFee" :min="1" :max="refundDialog.amount" />
        </el-form-item>
        <el-form-item label="退款原因">
          <el-select v-model="refundDialog.reason" placeholder="选择退款原因" style="width:100%;">
            <el-option label="0 - 暂无描述" value="0" />
            <el-option label="1 - 产品问题，影响使用或效果不佳" value="1" />
            <el-option label="2 - 售后问题，无法满足需求" value="2" />
            <el-option label="3 - 意愿问题，用户主动退款（重复支付/误下单）" value="3" />
            <el-option label="4 - 价格问题" value="4" />
            <el-option label="5 - 其他原因" value="5" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注（仅记录）">
          <el-input v-model="refundDialog.note" type="textarea" :rows="2" placeholder="选填，仅写入操作日志，不发送给微信" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="refundDialog.visible = false">取消</el-button>
        <el-button type="danger" :loading="refundDialog.saving" @click="submitRefund">确认退款</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Refresh, RefreshLeft, Star, ArrowDown } from '@element-plus/icons-vue'
import { api } from '../api/client'

const loading = ref(false)
const ordersLoading = ref(false)
const whitelistSaving = ref(false)
const membershipEnabled = ref(false)
const members = ref([])
const orders = ref([])
const memberTotal = ref(0)
const proWhitelistOpenids = ref([])
const whitelistText = ref('')
const stats = reactive({
  orderCount: 0,
  totalRevenue: 0,
  refundedRevenue: 0,
  refundPendingRevenue: 0,
  netRevenue: 0,
  refundCount: 0,
  pendingCount: 0
})

const PRODUCT_NAMES = {
  starlink_ar: '星链 AR',
  artemis_telemetry: 'Artemis 遥测',
  starlink_pro: '星链高级',
  starship_flight_checklist: '星舰检查清单'
}

function productName(id) {
  return PRODUCT_NAMES[id] || id
}

function openidsToText(arr) {
  return (arr || []).join('\n')
}

function parseWhitelistText(text) {
  return [...new Set(String(text || '').split(/[\s,;\n\r]+/).map((s) => s.trim()).filter(Boolean))]
}

function resetWhitelistFromServer() {
  whitelistText.value = openidsToText(proWhitelistOpenids.value)
}

const whitelistDirty = computed(() => {
  const a = parseWhitelistText(whitelistText.value).sort().join(',')
  const b = [...proWhitelistOpenids.value].sort().join(',')
  return a !== b
})

async function saveWhitelist() {
  const openids = parseWhitelistText(whitelistText.value)
  whitelistSaving.value = true
  try {
    const res = await api.updateMembershipProWhitelist(openids)
    const list = (res && res.proWhitelistOpenids) || openids
    proWhitelistOpenids.value = list
    whitelistText.value = openidsToText(list)
    ElMessage.success('白名单已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    whitelistSaving.value = false
  }
}

function formatDate(val) {
  if (!val) return '-'
  const d = new Date(val)
  if (isNaN(d.getTime())) return val
  return (
    d.getFullYear() +
    '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0') +
    ' ' + String(d.getHours()).padStart(2, '0') +
    ':' + String(d.getMinutes()).padStart(2, '0') +
    ':' + String(d.getSeconds()).padStart(2, '0')
  )
}

function isPaidPro(m) {
  if (!m || m.type !== 'pro') return false
  if (!m.expireAt) return false
  return new Date(m.expireAt).getTime() > Date.now()
}

function hasProducts(m) {
  return !!(m && Array.isArray(m.purchases) && m.purchases.length > 0)
}

/** planId → 套餐标签（月卡 / 年卡 / 永久） */
function planLabelOf(planId) {
  const p = String(planId || '')
  if (!p) return ''
  if (p.startsWith('permanent')) return '永久'
  if (p.startsWith('yearly')) return '年卡'
  if (p === 'monthly') return '月卡'
  if (p === 'custom') return '定制'
  return p
}

/**
 * 从订单流水推导每个 openid 的订阅获取方式与最新套餐：
 *   I* / grantReason=invite_reward → 邀请奖励；G* / grantBy → 人工赠送；其余已支付订阅 → 付费购买。
 * 订单已按 createdAt 降序，最先遇到的订阅单即最新套餐（作为 member.planId 缺失时的兜底）
 */
const memberSubMeta = computed(() => {
  const meta = new Map()
  for (const o of orders.value) {
    if (!o || o.orderType !== 'subscription' || o.status !== 'paid' || !o.openid) continue
    let entry = meta.get(o.openid)
    if (!entry) {
      entry = { sources: new Set(), latestPlanId: '' }
      meta.set(o.openid, entry)
    }
    const id = String(o._id || '')
    if (o.grantReason === 'invite_reward' || id.startsWith('I')) {
      entry.sources.add('invite')
    } else if (o.grantBy || id.startsWith('G')) {
      entry.sources.add('gift')
    } else {
      entry.sources.add('purchase')
    }
    if (!entry.latestPlanId && o.planId) entry.latestPlanId = o.planId
  }
  return meta
})

/** 获取方式 → 展示标签（可多个并存，如既买过又领过邀请奖励） */
function acqTagsOf(openid) {
  const entry = memberSubMeta.value.get(openid)
  if (!entry || !entry.sources.size) return [{ label: '付费', type: 'success' }]
  const tags = []
  if (entry.sources.has('purchase')) tags.push({ label: '付费购买', type: 'success' })
  if (entry.sources.has('invite')) tags.push({ label: '邀请奖励', type: 'danger' })
  if (entry.sources.has('gift')) tags.push({ label: '人工赠送', type: 'info' })
  return tags
}

const proMembers = computed(() => {
  const whitelist = new Set(proWhitelistOpenids.value || [])
  const list = []
  const seen = new Set()
  for (const m of members.value) {
    const inWhitelist = whitelist.has(m._id)
    if (isPaidPro(m) || inWhitelist || hasProducts(m)) {
      const proSource = inWhitelist ? 'whitelist' : (isPaidPro(m) ? 'paid' : 'product')
      const entry = memberSubMeta.value.get(m._id)
      list.push({
        ...m,
        proSource,
        acqTags: proSource === 'paid' ? acqTagsOf(m._id) : [],
        // 套餐优先取会员文档 planId（applyPaidOrder 实时回写），缺失时兜底最新订阅单
        planLabel: isPaidPro(m) ? planLabelOf(m.planId || (entry && entry.latestPlanId)) : ''
      })
      seen.add(m._id)
    }
  }
  // 白名单里但还没在 user_membership 注册的，补一行
  for (const openid of whitelist) {
    if (!seen.has(openid)) {
      list.push({ _id: openid, proSource: 'whitelist', purchases: [], expireAt: null, createdAt: null, acqTags: [], planLabel: '' })
    }
  }
  return list
})

const freeMembers = computed(() => {
  const whitelist = new Set(proWhitelistOpenids.value || [])
  return members.value.filter((m) => !isPaidPro(m) && !whitelist.has(m._id) && !hasProducts(m))
})
const freeMembersExpanded = ref(false)

/** 全库免费用户总数：user_membership 总数 − PRO 人数（列表本身只展示最近活跃 1000 条） */
const freeTotalCount = computed(() => {
  if (!memberTotal.value) return freeMembers.value.length
  return Math.max(freeMembers.value.length, memberTotal.value - proMembers.value.length)
})

const proStats = computed(() => {
  const whitelist = new Set(proWhitelistOpenids.value || [])
  const paid = members.value.filter(isPaidPro).length
  const product = members.value.filter((m) => !isPaidPro(m) && !whitelist.has(m._id) && hasProducts(m)).length
  const allWhitelist = whitelist.size
  const total = proMembers.value.length
  return { paid, product, whitelist: allWhitelist, total }
})

const load = async () => {
  loading.value = true
  ordersLoading.value = true
  try {
    const res = await api.getMembershipList()
    if (res) {
      members.value = res.members || []
      memberTotal.value = Number(res.memberTotal || 0)
      orders.value = res.orders || []
      membershipEnabled.value = !!res.enabled
      proWhitelistOpenids.value = res.proWhitelistOpenids || []
      whitelistText.value = openidsToText(proWhitelistOpenids.value)
      vpayConfig.env = Number((res.vpayConfig && res.vpayConfig.env) || 0)
      vpayConfig.offerId = String((res.vpayConfig && res.vpayConfig.offerId) || '')
      const allOrders = orders.value
      const paid = allOrders.filter((o) => o.status === 'paid')
      const refunded = allOrders.filter((o) => o.status === 'refunded')
      const refundPending = allOrders.filter((o) => o.status === 'refund_pending')
      const pending = allOrders.filter((o) => o.status === 'pending')
      stats.orderCount = paid.length
      // 已支付包含 refund_pending（钱实际还在账上，正在退款流程中）
      stats.totalRevenue = (
        paid.reduce((sum, o) => sum + (o.amount || 0), 0) +
        refundPending.reduce((sum, o) => sum + (o.amount || 0), 0)
      ) / 100
      stats.refundedRevenue = refunded.reduce((sum, o) => sum + (o.refundFee || o.amount || 0), 0) / 100
      stats.refundPendingRevenue = refundPending.reduce((sum, o) => sum + (o.refundFee || o.amount || 0), 0) / 100
      // 净收入按悲观估算：refund_pending 也已视为退款（一旦发起，到账概率极高）
      stats.netRevenue = stats.totalRevenue - stats.refundedRevenue - stats.refundPendingRevenue
      stats.refundCount = refunded.length + refundPending.length
      stats.pendingCount = pending.length
    }
  } catch (e) {
    ElMessage.error(e.message || '加载会员数据失败')
  } finally {
    loading.value = false
    ordersLoading.value = false
  }
  await loadOrdersPage()
}

// ── 订单分页/搜索 ──
const orderQuery = reactive({
  openid: '',
  status: '',
  orderType: '',
  page: 1,
  pageSize: 20
})
const orderPage = ref([])
const orderTotal = ref(0)
const orderPageLoading = ref(false)
async function loadOrdersPage() {
  orderPageLoading.value = true
  try {
    const params = {
      page: orderQuery.page,
      pageSize: orderQuery.pageSize
    }
    if (orderQuery.openid) params.openid = orderQuery.openid.trim()
    if (orderQuery.status) params.status = orderQuery.status
    if (orderQuery.orderType) params.orderType = orderQuery.orderType
    const res = await api.listMembershipOrders(params)
    if (res) {
      orderPage.value = res.list || []
      orderTotal.value = res.total || 0
    }
  } catch (e) {
    ElMessage.error(e.message || '查询订单失败')
  } finally {
    orderPageLoading.value = false
  }
}
function onOrderSearch() {
  orderQuery.page = 1
  loadOrdersPage()
}
function onOrderReset() {
  orderQuery.openid = ''
  orderQuery.status = ''
  orderQuery.orderType = ''
  orderQuery.page = 1
  loadOrdersPage()
}
function onOrderPageChange(p) {
  orderQuery.page = p
  loadOrdersPage()
}

async function exportOrders() {
  try {
    const params = {}
    if (orderQuery.openid) params.openid = orderQuery.openid.trim()
    if (orderQuery.status) params.status = orderQuery.status
    const res = await api.exportMembershipOrders(params)
    const list = (res && res.list) || []
    if (!list.length) {
      ElMessage.warning('没有可导出的订单')
      return
    }
    const headers = ['订单号', '用户 OpenID', '类型', '商品/计划', '金额(元)', '状态', '虚拟支付商品', '创建时间', '支付时间']
    const rows = list.map((o) => [
      o._id,
      o.openid,
      o.orderType,
      o.orderType === 'subscription' ? (o.planId || '') : (o.productId || ''),
      ((o.amount || 0) / 100).toFixed(2),
      o.status,
      o.vpayProductId || '',
      o.createdAt ? formatDate(o.createdAt) : '',
      o.paidAt ? formatDate(o.paidAt) : ''
    ])
    const csv = [headers, ...rows].map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'membership_orders_' + new Date().toISOString().slice(0, 10) + '.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    ElMessage.success('已导出 ' + list.length + ' 条订单')
  } catch (e) {
    ElMessage.error(e.message || '导出失败')
  }
}

const recheckLoading = ref(false)
async function onRecheckPending() {
  try {
    await ElMessageBox.confirm(
      '将批量回查所有「待支付」与「退款中」订单：<br/><br/>' +
        '• 微信侧已支付的：自动发货 + 升级 PRO<br/>' +
        '• 微信侧已退款到账的：自动标记为「已退款」<br/>' +
        '• 创建超过 24 小时仍未支付的：标记为「已取消」<br/>' +
        '• 24 小时内未支付 / 仍在退款流程中的：保留原状<br/><br/>' +
        '回查需要逐个调微信接口，可能耗时数十秒。继续？',
      '同步订单状态',
      { dangerouslyUseHTMLString: true, confirmButtonText: '开始同步', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return
  }
  recheckLoading.value = true
  try {
    const res = await api.recheckPendingMembershipOrders()
    const summary = (res && res.data) || res || {}
    ElMessageBox.alert(
      `共扫描 ${summary.scanned || 0} 笔订单：<br/>` +
        `<span style="color:#67c23a;">已发货 ${summary.paid || 0} 笔</span><br/>` +
        `<span style="color:#67c23a;">退款到账 ${summary.refunded || 0} 笔</span><br/>` +
        `<span style="color:#909399;">已取消 ${summary.cancelled || 0} 笔</span><br/>` +
        `<span style="color:#e6a23c;">仍在处理 ${summary.stillPending || 0} 笔</span><br/>` +
        `<span style="color:#f56c6c;">查询失败 ${summary.failed || 0} 笔</span>`,
      '同步完成',
      { dangerouslyUseHTMLString: true, confirmButtonText: '刷新数据' }
    )
    await load()
    await loadOrdersPage()
  } catch (e) {
    ElMessage.error(e.message || '重查失败')
  } finally {
    recheckLoading.value = false
  }
}

// ── 人工赠送 ──
const grantDialog = reactive({
  visible: false,
  openid: '',
  days: 30,
  permanent: false,
  reason: '',
  saving: false
})
function openGrantDialog(openid) {
  grantDialog.openid = String(openid || '')
  grantDialog.days = 30
  grantDialog.permanent = false
  grantDialog.reason = ''
  grantDialog.visible = true
}
async function submitGrant() {
  if (!grantDialog.openid) {
    ElMessage.error('请填写 openid')
    return
  }
  if (!grantDialog.permanent && (!grantDialog.days || grantDialog.days <= 0)) {
    ElMessage.error('请填写有效天数或勾选永久')
    return
  }
  grantDialog.saving = true
  try {
    await api.grantMembershipPro({
      openid: grantDialog.openid.trim(),
      days: grantDialog.permanent ? 0 : grantDialog.days,
      permanent: grantDialog.permanent,
      reason: grantDialog.reason
    })
    ElMessage.success('赠送成功')
    grantDialog.visible = false
    await load()
  } catch (e) {
    ElMessage.error(e.message || '赠送失败')
  } finally {
    grantDialog.saving = false
  }
}

// ── 人工退款 ──
const refundDialog = reactive({
  visible: false,
  outTradeNo: '',
  amount: 0,
  refundFee: 0,
  reason: '3',
  note: '',
  saving: false
})
function openRefundDialog(order) {
  refundDialog.outTradeNo = order._id
  refundDialog.amount = order.amount || 0
  refundDialog.refundFee = order.amount || 0
  refundDialog.reason = '3'
  refundDialog.note = ''
  refundDialog.visible = true
}
async function submitRefund() {
  if (!refundDialog.outTradeNo) return
  if (!refundDialog.refundFee || refundDialog.refundFee <= 0) {
    ElMessage.error('请填写退款金额（分）')
    return
  }
  if (!refundDialog.reason) {
    ElMessage.error('请选择退款原因')
    return
  }
  refundDialog.saving = true
  try {
    await api.refundMembershipOrder({
      outTradeNo: refundDialog.outTradeNo,
      refundFee: refundDialog.refundFee,
      reason: refundDialog.reason,
      note: refundDialog.note
    })
    ElMessage.success('退款已发起，等待微信回调')
    refundDialog.visible = false
    await load()
  } catch (e) {
    ElMessage.error(e.message || '退款失败')
  } finally {
    refundDialog.saving = false
  }
}

// ── 虚拟支付配置 ──
const vpayConfig = reactive({ env: 0, offerId: '' })
const vpayConfigSaving = ref(false)
async function saveVPayConfig() {
  vpayConfigSaving.value = true
  try {
    await api.updateVPayConfig({ env: Number(vpayConfig.env), offerId: vpayConfig.offerId })
    ElMessage.success('已保存虚拟支付配置')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    vpayConfigSaving.value = false
  }
}

const STATUS_TYPE = {
  paid: 'success',
  pending: 'warning',
  refunded: 'info',
  refund_pending: 'warning',
  refund_failed: 'danger',
  failed: 'danger'
}
const STATUS_TEXT = {
  paid: '已支付',
  pending: '待支付',
  refunded: '已退款',
  refund_pending: '退款中',
  refund_failed: '退款失败',
  failed: '已失败'
}
function statusText(s) { return STATUS_TEXT[s] || s }
function statusType(s) { return STATUS_TYPE[s] || 'info' }

// ── 商品价格管理 ──
const skuPriceItems = ref([])
const skuPricesLoading = ref(false)
const skuPriceSaving = ref(false)
const skuPriceDirty = computed(() =>
  skuPriceItems.value.some((it) => it.editPrice !== it.currentPrice)
)

async function loadSkuPrices() {
  skuPricesLoading.value = true
  try {
    const res = await api.getMembershipSkuPrices()
    const items = (res && res.items) || []
    skuPriceItems.value = items.map((it) => ({
      ...it,
      editPrice: it.currentPrice
    }))
  } catch (e) {
    ElMessage.error(e.message || '加载商品价格失败')
  } finally {
    skuPricesLoading.value = false
  }
}

function priceDeltaText(row) {
  if (!row.defaultPrice) return ''
  const delta = row.editPrice - row.defaultPrice
  const pct = ((delta / row.defaultPrice) * 100).toFixed(1)
  const yuan = (Math.abs(delta) / 100).toFixed(2)
  return `${Math.abs(Number(pct))}% (¥${yuan})`
}

async function onSavePrices() {
  const changed = skuPriceItems.value.filter((it) => it.editPrice !== it.currentPrice)
  if (!changed.length) {
    ElMessage.info('没有改动')
    return
  }
  const lines = changed
    .map((it) => `${it.name}：${(it.currentPrice / 100).toFixed(2)} → ${(it.editPrice / 100).toFixed(2)} 元`)
    .join('<br/>')
  try {
    await ElMessageBox.confirm(
      `<div style="line-height:1.7;">
         <p style="color:#f56c6c;font-weight:600;margin:0 0 8px;">务必确认你已经在「微信公众平台 → 小程序 → 虚拟支付 → 道具管理」把以下道具同步改价并发布到现网，否则下单会被微信拒绝：</p>
         <div style="background:#f8f8f8;padding:8px 10px;border-radius:4px;">${lines}</div>
       </div>`,
      '价格变更确认',
      {
        dangerouslyUseHTMLString: true,
        confirmButtonText: '我已在商户后台同步发布，提交',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch (e) {
    return
  }

  skuPriceSaving.value = true
  try {
    const prices = {}
    for (const it of changed) prices[it.id] = it.editPrice
    await api.updateMembershipSkuPrices(prices)
    ElMessage.success('价格已更新；30 秒内全端生效')
    await loadSkuPrices()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    skuPriceSaving.value = false
  }
}

onMounted(() => {
  load()
  loadSkuPrices()
})
</script>

<style scoped>
.membership-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  padding: 4px 4px 0;
}

.page-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
}

.page-subtitle {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.stat-row {
  margin: 0 !important;
}

.stat-row > .el-col {
  margin-bottom: 12px;
}

.stat-card {
  border: 1px solid var(--el-border-color-lighter);
  height: 100%;
  border-radius: 10px;
  overflow: hidden;
}

.stat-card :deep(.el-card__body) {
  overflow: hidden;
}

.stat-card.stat-pro {
  position: relative;
  overflow: hidden;
  border: none;
  border-radius: 12px;
  background:
    radial-gradient(circle at 12% 8%, rgba(255, 224, 158, 0.22), transparent 48%),
    radial-gradient(circle at 92% 105%, rgba(180, 128, 56, 0.20), transparent 55%),
    linear-gradient(135deg, #1d1610 0%, #2b1e12 30%, #1a120a 70%, #0a0705 100%);
  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.5),
    0 2px 8px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 224, 168, 0.25);
  color: #f5e9cf;
  transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.35s ease;
}

.stat-card.stat-pro:hover {
  transform: translateY(-2px);
  box-shadow:
    0 16px 36px rgba(0, 0, 0, 0.55),
    0 4px 12px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 224, 168, 0.32);
}

.stat-card.stat-pro :deep(.el-card__body) {
  position: relative;
  z-index: 2;
  overflow: hidden;
  padding: 22px 22px 20px;
}

.stat-card.stat-pro::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(
    135deg,
    rgba(255, 230, 168, 0.55) 0%,
    rgba(201, 161, 80, 0.35) 35%,
    rgba(120, 84, 32, 0.15) 65%,
    rgba(255, 220, 150, 0.45) 100%
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  pointer-events: none;
  z-index: 3;
}

.stat-card.stat-pro::after {
  content: '';
  position: absolute;
  top: -60%;
  left: -30%;
  width: 80%;
  height: 220%;
  background: linear-gradient(
    115deg,
    transparent 40%,
    rgba(255, 235, 180, 0.10) 48%,
    rgba(255, 240, 195, 0.22) 50%,
    rgba(255, 235, 180, 0.08) 52%,
    transparent 60%
  );
  transform: rotate(-14deg) translateX(0);
  pointer-events: none;
  z-index: 1;
  animation: pro-shine 6s ease-in-out infinite;
}

@keyframes pro-shine {
  0%, 100% { transform: rotate(-14deg) translateX(-20%); opacity: 0; }
  45%      { transform: rotate(-14deg) translateX(180%); opacity: 1; }
  60%      { transform: rotate(-14deg) translateX(220%); opacity: 0; }
}

.stat-card.stat-pro .stat-pro-shine {
  display: none;
}

.stat-card.stat-pro .stat-pro-badge {
  position: absolute;
  top: 14px;
  right: 14px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 2px;
  color: #2a1d0d;
  background: linear-gradient(135deg, #ffe9ad 0%, #f0c060 45%, #b07a22 100%);
  border-radius: 999px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.65),
    inset 0 -1px 0 rgba(80, 50, 10, 0.35),
    0 2px 6px rgba(0, 0, 0, 0.45);
  z-index: 4;
}

.stat-card.stat-pro .stat-label {
  color: rgba(245, 233, 207, 0.78);
  font-size: 13px;
  letter-spacing: 0.6px;
}

.stat-card.stat-pro .stat-value {
  background: linear-gradient(135deg, #fff5d6 0%, #f5d98a 35%, #d4a548 70%, #a8772a 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 34px;
  font-weight: 800;
  letter-spacing: 1px;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
}

.stat-card.stat-pro .stat-hint {
  color: rgba(245, 233, 207, 0.6);
  font-size: 12px;
  letter-spacing: 0.3px;
}

.stat-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.stat-value {
  font-size: 26px;
  font-weight: 600;
  margin: 6px 0 4px;
  line-height: 1.2;
}

.stat-hint {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}

.section-card {
  border: 1px solid var(--el-border-color-lighter);
}

.section-card.pro-card {
  border: 1px solid var(--el-color-warning-light-5);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  margin-right: 8px;
}

.section-title.pro-title {
  color: var(--el-color-warning);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.section-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.whitelist-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.whitelist-dirty {
  color: var(--el-color-warning);
  font-size: 12px;
}

.order-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}

.order-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.stat-warn {
  color: #e6a23c;
  margin-top: 4px;
}

.expand-arrow {
  transition: transform 0.25s ease;
  color: #909399;
  font-size: 16px;
}
.expand-arrow--open {
  transform: rotate(180deg);
}
</style>
