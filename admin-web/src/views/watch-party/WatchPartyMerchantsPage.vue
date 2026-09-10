<template>
  <div>
  <!-- 商家会员收费：试行默认关；开启后新入驻需缴费，未缴费宽限至下月1号 -->
  <el-card style="margin-bottom:16px" v-loading="billingLoading">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <el-switch
        v-model="billingEnabled"
        active-text="商家会员收费已开启"
        inactive-text="商家会员试行中（暂不收费）"
        :before-change="beforeBillingToggle"
      />
      <span style="color:var(--cx-text-3);font-size:12px;line-height:1.5;flex:1;min-width:220px">
        开启后新入驻需缴费（{{ membershipPriceYuan }}元/月）；未缴费合作商家宽限至下月1日。推荐成功仍赠 1 个月；续费在商家「更多」里操作。
      </span>
      <el-button size="small" plain :loading="sweepLoading" @click="onSweepMemberships">立即清扫到期</el-button>
    </div>
  </el-card>

  <!-- 主业：合作申请审核 -->
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <span>合作申请（{{ leadTotal }}条<template v-if="pendingLeadCount">，{{ pendingLeadCount }} 条待跟进</template>）</span>
        <el-radio-group v-model="leadStatusFilter" size="small" @change="loadLeads">
          <el-radio-button label="">全部</el-radio-button>
          <el-radio-button label="pending">待跟进</el-radio-button>
          <el-radio-button label="contacted">已联系</el-radio-button>
          <el-radio-button label="approved">已入驻</el-radio-button>
          <el-radio-button label="rejected">已婉拒</el-radio-button>
        </el-radio-group>
      </div>
    </template>

    <el-alert
      type="info"
      :closable="false"
      style="margin-bottom:14px"
      title="后台重心：审核合作申请 → 通过入驻 → 复制商家编号发给对方。商家在小程序「观礼页 → 商家管理」绑定后，自行建场次、配停车点/通行证、开大屏；运营一般无需再进场次编辑。"
    />

    <el-table :data="leads" v-loading="leadsLoading" stripe>
      <el-table-column label="商家/观礼点" prop="name" min-width="150" show-overflow-tooltip />
      <el-table-column label="联系人" width="160">
        <template #default="{ row }">
          <span>{{ row.contactName }} · {{ row.phone }}</span>
        </template>
      </el-table-column>
      <el-table-column label="微信码" width="90" align="center">
        <template #default="{ row }">
          <el-image
            v-if="row.wechatQr || row.contactWechatQr"
            :src="row.wechatQr || row.contactWechatQr"
            style="width:36px;height:36px;border-radius:4px"
            fit="cover"
            :preview-src-list="[row.wechatQr || row.contactWechatQr]"
            preview-teleported
          />
          <span v-else style="color:var(--cx-text-3)">-</span>
        </template>
      </el-table-column>
      <el-table-column label="位置" prop="location" min-width="160" show-overflow-tooltip />
      <el-table-column label="推荐商家" width="130" show-overflow-tooltip>
        <template #default="{ row }">
          <span>{{ row.referrerMerchantName || '（自然流量）' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="补充说明" prop="note" min-width="140" show-overflow-tooltip />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="leadStatusTag(row.status)" size="small">{{ leadStatusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="160">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status === 'pending' || row.status === 'contacted'">
            <el-button v-if="row.status === 'pending'" size="small" @click="onLeadStatus(row, 'contacted')">已联系</el-button>
            <el-button size="small" type="success" @click="onLeadApprove(row)">通过入驻</el-button>
            <el-button size="small" type="danger" plain @click="onLeadStatus(row, 'rejected')">婉拒</el-button>
          </template>
          <span v-else style="color:var(--cx-text-3);font-size:12px">{{ row.status === 'approved' ? '已转为商家' : '已关闭' }}</span>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <!-- 已入驻商家档案 -->
  <el-card style="margin-top:16px">
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span>已入驻商家（{{ total }}家）</span>
        <el-button @click="openDialog()">手动入驻</el-button>
      </div>
    </template>

    <div class="merchant-tip">
      <span>复制编号发给商家，点位与场次由小程序维护；扫码赠证需后台与场次双开。</span>
      <el-tooltip
        placement="bottom-end"
        :show-after="200"
        content="「扫码赠通行证」默认关闭，需在下表按商家开通、商家再在场次里开启才生效。「手动入驻」仅用于线下签约兜底。"
      >
        <el-button text type="primary" size="small" class="merchant-tip-more">说明</el-button>
      </el-tooltip>
    </div>

    <el-table :data="list" v-loading="loading" stripe class="merchant-table">
      <el-table-column label="商家" min-width="200">
        <template #default="{ row }">
          <div class="merchant-cell">
            <div class="merchant-cell-name" :title="row.name">{{ row.name || '-' }}</div>
            <div class="merchant-cell-code">
              <template v-if="row.merchantCode">
                <code>{{ row.merchantCode }}</code>
                <el-button size="small" text type="primary" @click="onCopyCode(row)">复制</el-button>
              </template>
              <el-button v-else size="small" text type="primary" @click="onGenCode(row)">生成编号</el-button>
            </div>
            <div v-if="row.note" class="merchant-cell-note" :title="row.note">备注：{{ row.note }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="联系" width="168">
        <template #default="{ row }">
          <div class="contact-cell">
            <el-image
              v-if="row.contactWechatQr"
              :src="row.contactWechatQr"
              class="contact-qr"
              fit="cover"
              :preview-src-list="[row.contactWechatQr]"
              preview-teleported
            />
            <div class="contact-meta">
              <div class="contact-name">{{ row.contactName || '-' }}</div>
              <div class="contact-phone">{{ row.contactPhone || '-' }}</div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="地址" prop="address" min-width="140" show-overflow-tooltip />
      <el-table-column label="状态" width="148">
        <template #default="{ row }">
          <div class="status-cell">
            <div class="status-tags">
              <el-tag :type="statusTag(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
              <el-tag
                v-if="row.terminatedReason === 'membership_unpaid'"
                type="danger"
                size="small"
                effect="plain"
              >未缴费终止</el-tag>
            </div>
            <div v-if="row.membershipExpireAt && row.membershipExpireAt > Date.now()" class="status-sub">
              <span>会员至 {{ formatDateOnly(row.membershipExpireAt) }}</span>
              <span class="status-muted">{{ row.membershipPaid ? '已缴费' : '含推荐赠送' }}</span>
            </div>
            <div v-else-if="billingEnabled" class="status-sub">
              <el-tag type="warning" size="small" effect="plain">未缴费</el-tag>
              <span v-if="row.membershipGraceUntil" class="status-muted">
                宽限至 {{ formatDateOnly(row.membershipGraceUntil) }}
              </span>
            </div>
            <div v-else class="status-muted">试行免费</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column width="96" align="center">
        <template #header>
          <el-tooltip content="默认关闭。开通后商家还需在小程序场次里自行开启「扫码赠通行证」，双开才对现场扫码用户发临时免会员通行证" placement="top">
            <span>扫码赠证 <el-icon class="tip-icon"><QuestionFilled /></el-icon></span>
          </el-tooltip>
        </template>
        <template #default="{ row }">
          <el-switch
            :model-value="row.passGrantEnabled === true"
            :loading="passGrantSavingId === row._id"
            @change="(v) => onPassGrantChange(row, v)"
          />
        </template>
      </el-table-column>
      <el-table-column label="推荐" width="120" show-overflow-tooltip>
        <template #default="{ row }">
          <div class="ref-cell">
            <span>{{ row.referrerMerchantName || '—' }}</span>
            <el-tag v-if="referredCount(row._id)" type="success" size="small" effect="plain">
              荐出 {{ referredCount(row._id) }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <div class="row-actions">
            <el-button size="small" plain @click="openStats(row)">走单统计</el-button>
            <el-button size="small" @click="openDialog(row)">编辑</el-button>
            <el-dropdown trigger="click" @command="(cmd) => onMerchantMore(row, cmd)">
              <el-button size="small">
                更多 <el-icon class="btn-caret"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="renew:month">续费 1 个月（{{ membershipPriceYuan }}元）</el-dropdown-item>
                  <el-dropdown-item command="renew:quarter">续费 1 季度（{{ membershipPriceYuan * 3 }}元）</el-dropdown-item>
                  <el-dropdown-item command="renew:year">续费 1 年（{{ membershipPriceYuan * 12 }}元）</el-dropdown-item>
                  <el-dropdown-item
                    v-if="row.status === 'active'"
                    command="status:paused"
                    divided
                  >暂停合作</el-dropdown-item>
                  <el-dropdown-item
                    v-if="row.status === 'paused'"
                    command="status:active"
                    divided
                  >恢复合作</el-dropdown-item>
                  <el-dropdown-item
                    v-if="row.status !== 'terminated'"
                    command="status:terminated"
                    :divided="row.status !== 'active' && row.status !== 'paused'"
                  >
                    <span class="danger-item">终止合作</span>
                  </el-dropdown-item>
                  <el-dropdown-item command="delete" divided>
                    <span class="danger-item">删除</span>
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑商家' : '手动入驻'" width="560px" destroy-on-close>
      <el-form :model="form" label-width="110px">
        <el-form-item label="商家/观礼点" required>
          <el-input v-model="form.name" placeholder="例：龙楼镇 ×× 观礼楼（对用户展示为「由 xx 提供」）" maxlength="40" />
        </el-form-item>
        <el-form-item label="联系人">
          <el-input v-model="form.contactName" placeholder="姓名" maxlength="20" style="width:160px" />
          <el-input v-model="form.contactPhone" placeholder="电话" maxlength="20" style="width:200px;margin-left:8px" />
        </el-form-item>
        <el-form-item label="微信好友码">
          <el-input v-model="form.contactWechatQr" placeholder="cloud:// 或 https 图片地址（小程序端上传优先）" maxlength="600" />
          <el-image
            v-if="form.contactWechatQr"
            :src="form.contactWechatQr"
            style="width:72px;height:72px;margin-top:8px;border-radius:6px"
            fit="cover"
            :preview-src-list="[form.contactWechatQr]"
            preview-teleported
          />
        </el-form-item>
        <el-form-item label="合作备注">
          <el-input v-model="form.note" type="textarea" :rows="2" placeholder="分成方式、协议编号等，仅后台可见" maxlength="500" />
        </el-form-item>
        <el-form-item label="合作状态">
          <el-radio-group v-model="form.status">
            <el-radio label="active">合作中</el-radio>
            <el-radio label="paused">暂停</el-radio>
            <el-radio label="terminated">已终止</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="观礼点地址、坐标、停车点、介绍须知由商家在小程序端维护，后台不再填写。"
        />
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="statsVisible" :title="`走单统计 · ${stats?.merchant?.name || ''}`" width="860px" destroy-on-close>
      <div v-loading="statsLoading">
        <template v-if="stats">
          <el-row :gutter="12" style="margin-bottom:16px">
            <el-col :span="4" v-for="item in statsCards" :key="item.label">
              <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:14px 12px;text-align:center">
                <div style="font-size:24px;font-weight:700;color:var(--cx-text-1, rgba(255,255,255,0.92))">{{ item.value }}</div>
                <div style="font-size:12px;color:var(--cx-text-3, #909399);margin-top:4px">{{ item.label }}</div>
              </div>
            </el-col>
          </el-row>

          <el-alert
            type="success"
            :closable="false"
            style="margin-bottom:14px"
            title="口径说明：「到场扫码」按现场扫码人数计（每人每任务周期记 1 单）；场次合计含历史周期。商家点「开启下一场」后按发射任务分账，物料码不变。"
          />

          <div v-if="Object.keys(stats.channelCount || {}).length" style="margin-bottom:14px">
            <span style="font-size:13px;color:var(--cx-text-2, rgba(255,255,255,0.72));margin-right:8px">扫码渠道分布（哪些铺码点位在带人）：</span>
            <el-tag
              v-for="(count, ch) in stats.channelCount"
              :key="ch"
              size="small"
              effect="plain"
              style="margin-right:6px"
            >{{ channelLabel(ch) }} {{ count }}</el-tag>
          </div>

          <div style="font-size:13px;color:var(--cx-text-2);margin:0 0 8px">场次合计（含历史任务周期）</div>
          <el-table :data="stats.sessions" stripe size="small" max-height="220">
            <el-table-column label="场次" prop="title" min-width="160" show-overflow-tooltip />
            <el-table-column label="归档周期" width="90" align="center">
              <template #default="{ row }">{{ row.cycleHistoryCount || 0 }}</template>
            </el-table-column>
            <el-table-column label="到场扫码" prop="scanUsers" width="90" align="center" />
            <el-table-column label="预约" prop="reservations" width="80" align="center" />
            <el-table-column label="核销" prop="checkedIn" width="80" align="center" />
            <el-table-column label="奖品发放" prop="draws" width="90" align="center" />
            <el-table-column label="通行证" prop="passGranted" width="80" align="center" />
          </el-table>

          <div style="font-size:13px;color:var(--cx-text-2);margin:16px 0 8px">按任务周期分账</div>
          <el-table :data="stats.cycles || []" stripe size="small" max-height="280">
            <el-table-column label="任务" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.missionName || row.title || '-' }}
                <el-tag v-if="row.current" size="small" type="success" style="margin-left:6px">当前</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="火箭" prop="rocketName" width="100" show-overflow-tooltip />
            <el-table-column label="发射时间" width="140">
              <template #default="{ row }">{{ row.launchTime ? String(row.launchTime).replace('T', ' ').slice(0, 16) : '-' }}</template>
            </el-table-column>
            <el-table-column label="扫码" prop="scanUsers" width="70" align="center" />
            <el-table-column label="预约" prop="reservations" width="70" align="center" />
            <el-table-column label="发放" prop="draws" width="70" align="center" />
          </el-table>
          <div v-if="!stats.sessions.length" style="text-align:center;color:var(--cx-text-3);padding:20px 0;font-size:13px">
            该商家名下暂无场次；商家在小程序自建场次后即可开始计数
          </div>
        </template>
      </div>
    </el-dialog>
  </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { QuestionFilled, ArrowDown } from '@element-plus/icons-vue'
import { api } from '../../api/client'

const loading = ref(false)
const list = ref([])
const total = ref(0)

const billingLoading = ref(false)
const billingEnabled = ref(false)
const membershipPriceYuan = ref(188)
const sweepLoading = ref(false)
const renewingId = ref('')

const dialogVisible = ref(false)
const editing = ref(null)
const saving = ref(false)
/** 表单仅展示联系与状态；地址/坐标等字段透传，避免编辑时误清空商家小程序已填资料 */
const form = reactive({
  name: '',
  contactName: '',
  contactPhone: '',
  contactWechatQr: '',
  address: '',
  lat: 0,
  lng: 0,
  parkingSpots: [],
  intro: '',
  notice: '',
  note: '',
  status: 'active'
})

const statsVisible = ref(false)
const statsLoading = ref(false)
const stats = ref(null)

const statsCards = computed(() => {
  const t = stats.value?.totals || {}
  return [
    { label: '合作场次', value: t.sessions || 0 },
    { label: '到场扫码（单）', value: t.scanUsers || 0 },
    { label: '预约组数', value: t.reservations || 0 },
    { label: '预约核销', value: t.checkedIn || 0 },
    { label: '奖品发放', value: t.draws || 0 },
    { label: '通行证发放', value: t.passGranted || 0 }
  ]
})

const CHANNEL_LABELS = {
  site: '现场码',
  app: '小程序内',
  screen: '大屏码',
  card: '卡片分享',
  album: '奖品分享'
}
function channelLabel(ch) {
  return CHANNEL_LABELS[ch] || ch
}

async function openStats(row) {
  statsVisible.value = true
  statsLoading.value = true
  stats.value = null
  try {
    stats.value = await api.getWatchPartyMerchantStats(row._id)
  } catch (e) {
    ElMessage.error('统计加载失败: ' + (e.message || e))
    statsVisible.value = false
  } finally {
    statsLoading.value = false
  }
}

const leads = ref([])
const leadTotal = ref(0)
const leadsLoading = ref(false)
const leadStatusFilter = ref('pending')

function statusLabel(s) {
  return { active: '合作中', paused: '已暂停', terminated: '已终止' }[s] || s
}

function statusTag(s) {
  return { active: 'success', paused: 'warning', terminated: 'info' }[s] || ''
}

function referredCount(merchantId) {
  return list.value.filter(m => m.referrerMerchantId === merchantId).length
}

function onMerchantMore(row, cmd) {
  const [kind, value] = String(cmd || '').split(':')
  if (kind === 'renew') return onRenewMembership(row, value)
  if (kind === 'status') return onChangeStatus(row, value)
  if (kind === 'delete') return onDelete(row)
}

async function onCopyCode(row) {
  const text = `【火箭观礼商家编号】${row.merchantCode}\n打开小程序「火箭观礼」页 → 底部「商家管理」→ 输入编号绑定微信，即可自助创建观礼场次。`
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制编号与使用说明，可直接发给商家')
  } catch (e) {
    ElMessage.warning('复制失败，请手动复制：' + row.merchantCode)
  }
}

async function onGenCode(row) {
  try {
    const res = await api.generateWatchPartyMerchantCode(row._id)
    ElMessage.success('编号已生成：' + (res?.merchantCode || ''))
    load()
  } catch (e) {
    ElMessage.error('生成失败: ' + (e.message || e))
  }
}

/** 按商家授权「扫码赠通行证」：与商家小程序场次开关双开才发证 */
const passGrantSavingId = ref('')

async function onPassGrantChange(row, enabled) {
  const on = enabled === true
  passGrantSavingId.value = row._id
  try {
    await api.updateWatchPartyMerchantPassGrant(row._id, on)
    row.passGrantEnabled = on
    ElMessage.success(on
      ? `已为「${row.name}」开通扫码赠通行证，商家在小程序场次里开启后即生效`
      : `已关闭「${row.name}」的扫码赠通行证，其场次扫码不再赠通行证`)
  } catch (e) {
    ElMessage.error('操作失败: ' + (e.message || e))
  } finally {
    passGrantSavingId.value = ''
  }
}

const pendingLeadCount = computed(() => {
  if (leadStatusFilter.value === 'pending') return leadTotal.value
  return leads.value.filter(l => l.status === 'pending').length
})

function leadStatusLabel(s) {
  return { pending: '待跟进', contacted: '已联系', approved: '已入驻', rejected: '已婉拒' }[s] || s
}

function leadStatusTag(s) {
  return { pending: 'warning', contacted: '', approved: 'success', rejected: 'info' }[s] || ''
}

function formatTime(v) {
  if (!v) return '-'
  const d = new Date(typeof v === 'number' ? v : String(v))
  if (isNaN(d.getTime())) return '-'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatDateOnly(v) {
  if (!v) return '-'
  const d = new Date(typeof v === 'number' ? v : String(v))
  if (isNaN(d.getTime())) return '-'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function loadBillingConfig() {
  billingLoading.value = true
  try {
    const res = await api.getWatchPartyGlobalConfig()
    billingEnabled.value = res?.merchantMembershipBillingEnabled === true
    if (Number(res?.merchantMembershipPriceYuan) > 0) {
      membershipPriceYuan.value = Number(res.merchantMembershipPriceYuan)
    }
  } catch (e) {
    ElMessage.error('加载收费开关失败: ' + (e.message || e))
  } finally {
    billingLoading.value = false
  }
}

function beforeBillingToggle() {
  const turningOn = !billingEnabled.value
  return new Promise((resolve, reject) => {
    ElMessageBox.confirm(
      turningOn
        ? `确认开启商家会员收费（${membershipPriceYuan.value}元/月）？开启后：新入驻需联系运营缴费；当前未缴费的合作商家将宽限至下月1日，逾期自动终止合作。推荐成功仍赠推荐人1个月会员。`
        : '确认关闭收费、恢复试行免费？已写入的会员截止日期与宽限期保留，但不再自动因未缴费终止。',
      turningOn ? '开启商家会员收费' : '关闭商家会员收费',
      { type: 'warning', confirmButtonText: turningOn ? '确认开启收费' : '确认关闭' }
    ).then(() => {
      billingLoading.value = true
      api.updateWatchPartyGlobalConfig({ merchantMembershipBillingEnabled: turningOn })
        .then((res) => {
          const seeded = Number(res?.graceSeeded || 0)
          ElMessage.success(
            turningOn
              ? (seeded > 0
                ? `已开启收费，已为 ${seeded} 家未缴费商家写入下月1日宽限`
                : '已开启商家会员收费')
              : '已关闭收费，恢复试行'
          )
          load()
          resolve()
        })
        .catch((e) => {
          ElMessage.error('操作失败: ' + (e.message || e))
          reject()
        })
        .finally(() => { billingLoading.value = false })
    }).catch(() => reject())
  })
}

async function onRenewMembership(row, plan) {
  const labels = { month: '1 个月', quarter: '1 季度', year: '1 年' }
  const months = { month: 1, quarter: 3, year: 12 }[plan] || 0
  const price = membershipPriceYuan.value * months
  try {
    await ElMessageBox.confirm(
      `确认为「${row.name}」续费${labels[plan] || plan}（${price}元）？系统将从当前有效截止日（或今天）自动叠加截止日期${row.status === 'terminated' && row.terminatedReason === 'membership_unpaid' ? '，并恢复为合作中' : ''}。`,
      '确认续费',
      { type: 'info', confirmButtonText: '确认续费' }
    )
    renewingId.value = row._id
    const res = await api.renewWatchPartyMerchantMembership(row._id, plan)
    ElMessage.success(`已续费至 ${res?.membershipExpireText || formatDateOnly(res?.membershipExpireAt)}`)
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('续费失败: ' + (e.message || e))
  } finally {
    renewingId.value = ''
  }
}

async function onSweepMemberships() {
  try {
    await ElMessageBox.confirm(
      '立即清扫：收费开启时，将终止「无有效会员期且宽限已过」的合作中/已暂停商家。确定执行？',
      '清扫到期商家',
      { type: 'warning' }
    )
    sweepLoading.value = true
    const res = await api.sweepWatchPartyMerchantMemberships()
    if (res?.skipped) {
      ElMessage.info('当前未开启收费，无需清扫')
    } else {
      ElMessage.success(`清扫完成，终止 ${res?.terminated || 0} 家`)
      load()
    }
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('清扫失败: ' + (e.message || e))
  } finally {
    sweepLoading.value = false
  }
}

async function loadLeads() {
  leadsLoading.value = true
  try {
    const query = { page: 1, pageSize: 100 }
    if (leadStatusFilter.value) query.status = leadStatusFilter.value
    const res = await api.listWatchPartyMerchantLeads(query)
    leads.value = res?.list || []
    leadTotal.value = res?.total || 0
  } catch (e) {
    ElMessage.error('加载合作申请失败: ' + (e.message || e))
  } finally {
    leadsLoading.value = false
  }
}

async function onLeadStatus(row, status) {
  try {
    if (status === 'rejected') {
      await ElMessageBox.confirm(`确定婉拒「${row.name}」的合作申请？`, '确认操作', { type: 'warning' })
    }
    await api.updateWatchPartyMerchantLead(row._id, { status, adminNote: row.adminNote || '' })
    ElMessage.success('已更新')
    loadLeads()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('操作失败: ' + (e.message || e))
  }
}

async function onLeadApprove(row) {
  try {
    await ElMessageBox.confirm(
      `确认通过「${row.name}」的合作申请？将自动创建商家档案（合作中）${row.referrerMerchantName ? '，推荐来源记为「' + row.referrerMerchantName + '」' : ''}。通过后请复制商家编号发给对方，由对方在小程序完善点位并自建场次。`,
      '通过入驻',
      { type: 'info', confirmButtonText: '通过并入驻' }
    )
    await api.approveWatchPartyMerchantLead(row._id)
    ElMessage.success('已入驻，请在下方商家列表复制编号发给对方')
    leadStatusFilter.value = 'pending'
    loadLeads()
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('操作失败: ' + (e.message || e))
  }
}

async function load() {
  loading.value = true
  try {
    const res = await api.listWatchPartyMerchants({ page: 1, pageSize: 100 })
    list.value = res?.list || []
    total.value = res?.total || 0
  } catch (e) {
    ElMessage.error('加载失败: ' + (e.message || e))
  } finally {
    loading.value = false
  }
}

function openDialog(row) {
  editing.value = row || null
  form.name = row?.name || ''
  form.contactName = row?.contactName || ''
  form.contactPhone = row?.contactPhone || ''
  form.contactWechatQr = row?.contactWechatQr || ''
  // 透传商家小程序已维护字段，保存时不误清空
  form.address = row?.address || ''
  form.lat = row?.lat || 0
  form.lng = row?.lng || 0
  form.parkingSpots = (row?.parkingSpots || []).map(p => ({ ...p }))
  form.intro = row?.intro || ''
  form.notice = row?.notice || ''
  form.note = row?.note || ''
  form.status = row?.status || 'active'
  dialogVisible.value = true
}

async function onSave() {
  if (!form.name) return ElMessage.warning('请填写商家/观礼点名称')
  const qr = String(form.contactWechatQr || '').trim()
  if (qr && !/^(cloud|https):\/\//.test(qr)) {
    return ElMessage.warning('微信好友码需为 cloud:// 或 https 图片地址')
  }
  form.contactWechatQr = qr
  saving.value = true
  try {
    const body = { ...form, parkingSpots: form.parkingSpots.filter(p => p.name) }
    if (editing.value) {
      await api.updateWatchPartyMerchant(editing.value._id, body)
      ElMessage.success('更新成功')
    } else {
      await api.createWatchPartyMerchant(body)
      ElMessage.success('入驻成功，请复制商家编号发给对方，由小程序端自建场次')
    }
    dialogVisible.value = false
    load()
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.message || e))
  } finally {
    saving.value = false
  }
}

async function onChangeStatus(row, status) {
  const tips = {
    paused: `暂停「${row.name}」后，其名下全部场次立即对小程序端下线（预约/抽奖同步关闭），可随时恢复。`,
    active: `恢复「${row.name}」合作，其名下启用中的场次将重新对小程序端可见。`,
    terminated: `终止与「${row.name}」的合作后，其名下全部场次永久下线。历史预约与用户已抽奖品记录保留。`
  }
  try {
    await ElMessageBox.confirm(tips[status], '确认操作', {
      type: status === 'active' ? 'info' : 'warning'
    })
    await api.updateWatchPartyMerchant(row._id, { ...row, status })
    ElMessage.success('已更新')
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('操作失败: ' + (e.message || e))
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除商家「${row.name}」？名下还有场次时会被拒绝（请先删场次或改为终止合作）。`,
      '确认删除',
      { type: 'warning' }
    )
    await api.deleteWatchPartyMerchant(row._id)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败: ' + (e.message || e))
  }
}

onMounted(() => {
  loadBillingConfig()
  loadLeads()
  load()
})
</script>

<style scoped>
.merchant-tip {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 14px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(52, 211, 153, 0.28);
  background: rgba(16, 185, 129, 0.08);
  color: var(--cx-text-2);
  font-size: 12px;
  line-height: 1.5;
}
.merchant-tip-more {
  flex-shrink: 0;
  margin-left: auto;
}
.merchant-table :deep(.el-table__cell) {
  vertical-align: top;
  padding-top: 12px;
  padding-bottom: 12px;
}
.merchant-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.merchant-cell-name {
  font-weight: 600;
  color: var(--cx-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.merchant-cell-code {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 24px;
}
.merchant-cell-code code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  letter-spacing: 0.5px;
  color: var(--cx-text-2);
}
.merchant-cell-note {
  margin-top: 2px;
  font-size: 12px;
  color: var(--cx-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.contact-cell {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}
.contact-qr {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  flex-shrink: 0;
}
.contact-meta {
  min-width: 0;
  line-height: 1.35;
}
.contact-name {
  font-size: 13px;
  color: var(--cx-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.contact-phone {
  font-size: 12px;
  color: var(--cx-text-3);
}
.status-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  line-height: 1.4;
}
.status-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.status-sub {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--cx-text-2);
}
.status-muted {
  color: var(--cx-text-3);
  font-size: 12px;
}
.ref-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  font-size: 12px;
  color: var(--cx-text-2);
}
.row-actions {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
}
.btn-caret {
  margin-left: 2px;
}
.tip-icon {
  vertical-align: -2px;
}
.danger-item {
  color: var(--el-color-danger);
}
</style>
