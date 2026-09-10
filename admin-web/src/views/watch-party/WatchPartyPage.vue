<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span>观礼场次总览（{{ total }}场）</span>
      </div>
    </template>

    <el-alert
      type="info"
      :closable="false"
      style="margin-bottom:14px"
      title="场次由商家在小程序端自建与维护（停车点、通行证、大屏、发射成功等）。本页仅作总览与应急：全局关停、查看详情/预约/统计、物料码、启停与删除。"
    />

    <!-- 全局开关：终止合作一键关停整个观礼服务 -->
    <div
      class="global-switch-bar"
      :style="{
        display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
        padding: '12px 16px', marginBottom: '14px', borderRadius: '6px',
        background: globalConfig.enabled ? 'rgba(52, 211, 153, 0.10)' : 'rgba(239, 68, 68, 0.12)',
        border: '1px solid ' + (globalConfig.enabled ? 'rgba(52, 211, 153, 0.35)' : 'rgba(239, 68, 68, 0.40)')
      }"
      v-loading="globalLoading"
    >
      <el-switch
        v-model="globalConfig.enabled"
        active-text="观礼服务已开启"
        inactive-text="观礼服务已关停"
        :before-change="beforeGlobalToggle"
      />
      <el-input
        v-model="globalConfig.closedNotice"
        placeholder="关停后小程序端提示文案（默认：观礼服务暂未开放，感谢关注）"
        maxlength="200"
        style="flex:1;min-width:280px;max-width:520px"
        size="small"
      />
      <el-button size="small" @click="saveGlobalConfig()">保存文案</el-button>
      <span style="color:#909399;font-size:12px">
        关停后：小程序入口隐藏、预约/抽奖/大屏全部下线，用户已抽奖品记录保留；生效延迟最多约 30 秒。
        送审请用「全局配置中心 → 火箭观礼 / 一键过审」关 enableWatchParty（本开关仅运营临时关停）。
      </span>
    </div>

    <!-- 入驻商家员工免全站会员门控 -->
    <div
      class="global-switch-bar"
      style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;margin-bottom:14px;border-radius:6px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.28)"
      v-loading="globalLoading"
    >
      <el-switch
        v-model="globalConfig.merchantStaffGateBypass"
        active-text="入驻商家免整个门控"
        inactive-text="入驻商家仍走会员门控"
        :before-change="beforeMerchantBypassToggle"
      />
      <span style="color:#909399;font-size:12px;line-height:1.5">
        开启后：状态为「合作中」且已绑定微信的商家员工，小程序内会员功能门控全部放行（含预拉/AI 次数，视同 Pro）。暂停/终止合作或解绑后失效；商家需重新打开商家中心同步。
      </span>
    </div>

    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column label="短码" prop="code" width="90" />
      <el-table-column label="场次标题" prop="title" min-width="180" show-overflow-tooltip />
      <el-table-column label="商家" width="130" show-overflow-tooltip>
        <template #default="{ row }">
          <span>{{ row.merchantName || '（未挂靠）' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="关联任务" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <span>{{ row.rocketName }}{{ row.missionName ? ' · ' + row.missionName : '' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="发射时间" width="170">
        <template #default="{ row }">
          <span>{{ formatTime(row.launchTime) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="200">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
          <el-tag :type="row.status === 'open' ? '' : 'warning'" size="small" style="margin-left:4px">
            {{ row.status === 'open' ? '可预约' : '停止预约' }}
          </el-tag>
          <el-tag v-if="row.passEnabled" type="success" size="small" effect="plain" style="margin-left:4px">
            通行证{{ row.passHours || 12 }}h
          </el-tag>
          <el-tag v-if="row.prizeDrawEnabled" type="warning" size="small" effect="plain" style="margin-left:4px">现场抽奖</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="360" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openDetail(row)">详情</el-button>
          <el-button size="small" @click="openReservations(row)">预约名单</el-button>
          <el-button size="small" @click="openStats(row)">统计</el-button>
          <el-button size="small" @click="openWxacode(row)">物料码</el-button>
          <el-button
            size="small"
            :type="row.enabled ? 'warning' : 'success'"
            plain
            @click="onToggleEnabled(row)"
          >{{ row.enabled ? '停用' : '启用' }}</el-button>
          <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-if="total > pageSize"
      style="margin-top:16px;justify-content:center"
      layout="prev, pager, next"
      :total="total"
      :page-size="pageSize"
      :current-page="page"
      @current-change="p => { page = p; load() }"
    />

    <!-- 只读详情 -->
    <el-drawer v-model="detailVisible" :title="detail?.title || '场次详情'" size="480px" destroy-on-close>
      <el-descriptions v-if="detail" :column="1" border>
        <el-descriptions-item label="短码">{{ detail.code || '-' }}</el-descriptions-item>
        <el-descriptions-item label="商家">{{ detail.merchantName || '（未挂靠）' }}</el-descriptions-item>
        <el-descriptions-item label="任务">
          {{ detail.rocketName || '-' }}{{ detail.missionName ? ' · ' + detail.missionName : '' }}
        </el-descriptions-item>
        <el-descriptions-item label="发射时间">{{ formatTime(detail.launchTime) }}</el-descriptions-item>
        <el-descriptions-item label="地址">{{ detail.address || '-' }}</el-descriptions-item>
        <el-descriptions-item label="坐标">
          {{ detail.lat && detail.lng ? `${detail.lat}, ${detail.lng}` : '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="停车点">
          <template v-if="(detail.parkingSpots || []).length">
            <div v-for="(p, i) in detail.parkingSpots" :key="i" style="margin-bottom:4px">
              {{ p.name }}{{ p.walkMinutes ? ` · 步行${p.walkMinutes}分钟` : '' }}{{ p.note ? `（${p.note}）` : '' }}
            </div>
          </template>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="预约容量">{{ detail.capacity ? detail.capacity : '不限制' }}</el-descriptions-item>
        <el-descriptions-item label="服务套餐">
          <template v-if="serviceLabels(detail).length">
            <el-tag
              v-for="label in serviceLabels(detail)"
              :key="label"
              size="small"
              effect="plain"
              style="margin:0 6px 6px 0"
            >{{ label }}</el-tag>
          </template>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="微信群码">
          <el-image
            v-if="detail.wechatGroupQr"
            :src="detail.wechatGroupQr"
            fit="contain"
            style="width:96px;height:96px;border-radius:6px;background:#fff"
            :preview-src-list="[detail.wechatGroupQr]"
            preview-teleported
          />
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="车辆预约网址">
          <a
            v-if="detail.vehicleBookingUrl"
            :href="detail.vehicleBookingUrl"
            target="_blank"
            rel="noopener"
            style="word-break:break-all"
          >{{ detail.vehicleBookingUrl }}</a>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="通行证">
          {{ detail.passEnabled ? `已开启 · ${detail.passHours || 12} 小时` : '关闭（商家在小程序配置）' }}
        </el-descriptions-item>
        <el-descriptions-item label="现场抽奖">
          <template v-if="!detail.prizeDrawEnabled">关闭</template>
          <template v-else-if="detail.successUnlocked || detail.successUnlockedAt">已开启 · 已确认发射成功（可抽）</template>
          <template v-else>已开启 · 待确认发射成功</template>
        </el-descriptions-item>
        <el-descriptions-item label="奖品配置" v-if="detail.prizeDrawEnabled || (detail.prizes || []).length">
          <div v-if="(detail.prizes || []).length" style="width:100%">
            <div
              v-for="(p, i) in detail.prizes"
              :key="p.id || i"
              style="display:flex;gap:10px;align-items:center;margin-bottom:8px"
            >
              <el-image
                v-if="p.image"
                :src="p.image"
                fit="cover"
                style="width:48px;height:48px;border-radius:6px;flex-shrink:0"
                :preview-src-list="[p.image]"
                preview-teleported
              />
              <div style="min-width:0;flex:1;font-size:13px;line-height:1.4">
                <div>{{ i + 1 }}. {{ p.name }}</div>
                <div style="color:#909399">
                  剩余 {{ p.remaining }} / {{ p.stock }}
                  <template v-if="p.valueYuan != null"> · 价值 ¥{{ p.valueYuan }}</template>
                </div>
              </div>
            </div>
          </div>
          <span v-else style="color:#909399">暂无奖品</span>
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          {{ detail.enabled !== false ? '启用' : '停用' }} · {{ detail.status === 'open' ? '可预约' : '停止预约' }}
        </el-descriptions-item>
        <el-descriptions-item label="介绍">
          <div style="white-space:pre-wrap;max-height:160px;overflow:auto">{{ detail.intro || '-' }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="须知">
          <div style="white-space:pre-wrap;max-height:160px;overflow:auto">{{ detail.notice || '-' }}</div>
        </el-descriptions-item>
      </el-descriptions>
      <p style="margin-top:16px;font-size:12px;color:#909399;line-height:1.6">
        场次与奖品由商家在小程序配置；后台仅作总览与应急启停/删除。
      </p>
    </el-drawer>

    <!-- 预约名单 -->
    <el-dialog v-model="reserveVisible" :title="`预约名单 · ${currentSession?.title || ''}`" width="820px" destroy-on-close>
      <el-table :data="reservations" v-loading="reserveLoading" stripe max-height="480">
        <el-table-column label="姓名" prop="name" width="120" />
        <el-table-column label="手机号" prop="phone" width="130" />
        <el-table-column label="人数" prop="headcount" width="70" />
        <el-table-column label="渠道" prop="channel" width="90" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'checked_in' ? 'success' : (row.status === 'cancelled' ? 'info' : '')" size="small">
              {{ row.status === 'checked_in' ? '已核销' : (row.status === 'cancelled' ? '已取消' : '待到场') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="预约时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" size="small" type="success" @click="onCheckIn(row)">核销</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-if="reserveTotal > 50"
        style="margin-top:12px;justify-content:center"
        layout="prev, pager, next"
        :total="reserveTotal"
        :page-size="50"
        :current-page="reservePage"
        @current-change="p => { reservePage = p; loadReservations() }"
      />
    </el-dialog>

    <!-- 数据统计 -->
    <el-dialog v-model="statsVisible" :title="`场次统计 · ${currentSession?.title || ''}`" width="560px" destroy-on-close>
      <div v-loading="statsLoading">
        <el-descriptions :column="2" border v-if="stats">
          <el-descriptions-item label="有效预约">{{ stats.reservations }}</el-descriptions-item>
          <el-descriptions-item label="已核销到场">{{ stats.checkedIn }}</el-descriptions-item>
          <el-descriptions-item label="扫码解锁人数">{{ stats.scanUsers }}</el-descriptions-item>
          <el-descriptions-item label="奖品发放">{{ stats.draws }}</el-descriptions-item>
          <el-descriptions-item label="通行证发放">{{ stats.passGranted != null ? stats.passGranted : '-' }}</el-descriptions-item>
          <el-descriptions-item label="到场转化">{{ stats.reservations ? Math.round((stats.checkedIn / stats.reservations) * 100) + '%' : '-' }}</el-descriptions-item>
          <el-descriptions-item label="奖品库存" :span="2">
            <template v-if="(stats.prizes || []).length">
              <div v-for="(p, i) in stats.prizes" :key="p.id || i" style="margin-bottom:4px">
                {{ p.name }}：剩 {{ p.remaining }} / {{ p.stock }}
                <template v-if="p.valueYuan != null">（¥{{ p.valueYuan }}）</template>
              </div>
            </template>
            <span v-else style="color:#909399">未配置或未开启抽奖</span>
          </el-descriptions-item>
          <el-descriptions-item label="当前周期" :span="2">
            <span v-if="stats.missionName || stats.rocketName">
              {{ stats.rocketName || '' }}{{ stats.missionName ? ' · ' + stats.missionName : '' }}
            </span>
            <span v-else style="color:#909399">未绑定任务</span>
            <span v-if="stats.currentCycleId" style="color:#909399;margin-left:8px;font-size:12px">{{ stats.currentCycleId }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="渠道分布" :span="2">
            <el-tag v-for="(count, ch) in stats.channelCount" :key="ch" size="small" style="margin-right:6px">
              {{ ch }}: {{ count }}
            </el-tag>
            <span v-if="!Object.keys(stats.channelCount || {}).length" style="color:#909399">暂无数据</span>
          </el-descriptions-item>
        </el-descriptions>
        <div v-if="(stats.cycles || []).length" style="margin-top:14px">
          <div style="font-size:13px;color:#909399;margin-bottom:8px">任务周期账本（当前 + 历史）</div>
          <el-table :data="stats.cycles" size="small" max-height="240">
            <el-table-column label="任务" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.missionName || row.title || '-' }}
                <el-tag v-if="row.current" size="small" type="success" style="margin-left:4px">当前</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="扫码" prop="scanUsers" width="64" align="center" />
            <el-table-column label="预约" prop="reservations" width="64" align="center" />
            <el-table-column label="核销" prop="checkedIn" width="64" align="center" />
            <el-table-column label="发放" prop="draws" width="64" align="center" />
          </el-table>
        </div>
      </div>
    </el-dialog>

    <!-- 物料小程序码 -->
    <el-dialog v-model="wxacodeVisible" :title="`现场物料码 · ${currentSession?.title || ''}`" width="480px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="渠道标识">
          <el-input v-model="wxacodeChannel" placeholder="如 poster1 / hotel-a / driver（≤20字符）" maxlength="20" />
        </el-form-item>
        <el-form-item label="版本">
          <el-radio-group v-model="wxacodeEnv">
            <el-radio label="release">正式版</el-radio>
            <el-radio label="trial">体验版</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <div style="text-align:center">
        <el-button type="primary" :loading="wxacodeLoading" @click="onGenerateWxacode">生成小程序码</el-button>
      </div>
      <div v-if="wxacodeImage" style="text-align:center;margin-top:16px">
        <img :src="wxacodeImage" style="width:280px;height:280px" alt="小程序码" />
        <div style="color:#909399;font-size:12px;margin-top:8px">scene: {{ wxacodeScene }}<br />扫码进入抽奖页并按渠道统计；右键/长按图片保存用于印刷</div>
      </div>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api/client'

const SERVICE_LABELS = {
  viewing: '发射观礼',
  viewing_factory: '发射观礼+火箭工厂参观',
  viewing_factory_stay: '发射观礼+火箭工厂参观+住宿',
  charter: '包车服务'
}

function serviceLabels(detail) {
  const raw = (detail && detail.services) || []
  return raw.map((s) => {
    if (typeof s === 'string') return SERVICE_LABELS[s] || s
    if (s && s.label) return s.label
    if (s && s.id) return SERVICE_LABELS[s.id] || s.id
    return ''
  }).filter(Boolean)
}

const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20

const globalLoading = ref(false)
const globalConfig = reactive({
  enabled: true,
  closedNotice: '',
  merchantStaffGateBypass: false
})

const detailVisible = ref(false)
const detail = ref(null)

const currentSession = ref(null)

const reserveVisible = ref(false)
const reserveLoading = ref(false)
const reservations = ref([])
const reserveTotal = ref(0)
const reservePage = ref(1)

const statsVisible = ref(false)
const statsLoading = ref(false)
const stats = ref(null)

const wxacodeVisible = ref(false)
const wxacodeLoading = ref(false)
const wxacodeChannel = ref('site')
const wxacodeEnv = ref('release')
const wxacodeImage = ref('')
const wxacodeScene = ref('')

function formatTime(v) {
  if (!v) return '-'
  const d = new Date(typeof v === 'number' ? v : String(v))
  if (isNaN(d.getTime())) return '-'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    const res = await api.listWatchPartySessions({ page: page.value, pageSize })
    list.value = res?.list || []
    total.value = res?.total || 0
  } catch (e) {
    ElMessage.error('加载失败: ' + (e.message || e))
  } finally {
    loading.value = false
  }
}

async function loadGlobalConfig() {
  globalLoading.value = true
  try {
    const res = await api.getWatchPartyGlobalConfig()
    globalConfig.enabled = res?.enabled !== false
    globalConfig.closedNotice = res?.closedNotice || ''
    globalConfig.merchantStaffGateBypass = res?.merchantStaffGateBypass === true
  } catch (e) {
    ElMessage.error('加载全局开关失败: ' + (e.message || e))
  } finally {
    globalLoading.value = false
  }
}

function beforeGlobalToggle() {
  const turningOff = globalConfig.enabled
  return new Promise((resolve, reject) => {
    ElMessageBox.confirm(
      turningOff
        ? '确认一键关停观礼服务？小程序入口、预约、抽奖、大屏将全部下线（用户已抽奖品记录保留），可随时重新开启。'
        : '确认重新开启观礼服务？启用中的场次将恢复对小程序端可见。',
      turningOff ? '关停观礼服务' : '开启观礼服务',
      { type: 'warning', confirmButtonText: turningOff ? '确认关停' : '确认开启' }
    ).then(() => {
      saveGlobalConfig({ enabled: !turningOff }).then(resolve, reject)
    }).catch(() => reject())
  })
}

function beforeMerchantBypassToggle() {
  const turningOn = !globalConfig.merchantStaffGateBypass
  return new Promise((resolve, reject) => {
    ElMessageBox.confirm(
      turningOn
        ? '确认开启？合作中且已绑定微信的入驻商家员工，将免除小程序内全部会员功能门控（视同 Pro）。请仅在运营确认后开启。'
        : '确认关闭？商家员工将恢复正常会员门控；已打开商家中心的员工下次同步后失效。',
      turningOn ? '开启商家免门控' : '关闭商家免门控',
      { type: 'warning', confirmButtonText: turningOn ? '确认开启' : '确认关闭' }
    ).then(() => {
      saveGlobalConfig({ merchantStaffGateBypass: turningOn }).then(resolve, reject)
    }).catch(() => reject())
  })
}

async function saveGlobalConfig(patch = {}) {
  globalLoading.value = true
  try {
    const enabled = patch.enabled !== undefined ? patch.enabled : globalConfig.enabled
    const merchantStaffGateBypass = patch.merchantStaffGateBypass !== undefined
      ? patch.merchantStaffGateBypass
      : globalConfig.merchantStaffGateBypass
    await api.updateWatchPartyGlobalConfig({
      enabled,
      closedNotice: globalConfig.closedNotice,
      merchantStaffGateBypass
    })
    // 开关由 el-switch 在 before-change resolve 后自行翻转；此处勿再写回，避免双重切换
    if (patch.merchantStaffGateBypass !== undefined) {
      ElMessage.success(merchantStaffGateBypass ? '已开启入驻商家免门控' : '已关闭入驻商家免门控')
    } else if (patch.enabled !== undefined) {
      ElMessage.success(enabled ? '观礼服务已开启' : '观礼服务已关停')
    } else {
      ElMessage.success('已保存')
    }
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.message || e))
    throw e
  } finally {
    globalLoading.value = false
  }
}

function openDetail(row) {
  detail.value = row
  detailVisible.value = true
}

/** 透传完整场次文档更新，避免 normalizeSessionBody 误清空商家配置 */
async function patchSession(row, patch) {
  await api.updateWatchPartySession(row._id, { ...row, ...patch })
}

async function onToggleEnabled(row) {
  const next = row.enabled === false
  try {
    await ElMessageBox.confirm(
      next
        ? `确认启用场次「${row.title}」？将对小程序端重新可见（商家仍为合作中时）。`
        : `确认停用场次「${row.title}」？小程序端立即隐藏该场次入口。`,
      next ? '启用场次' : '停用场次',
      { type: 'warning' }
    )
    await patchSession(row, { enabled: next })
    ElMessage.success(next ? '已启用' : '已停用')
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('操作失败: ' + (e.message || e))
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除场次「${row.title}」？预约与奖品发放记录不会删除。`, '确认删除', { type: 'warning' })
    await api.deleteWatchPartySession(row._id)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

function openReservations(row) {
  currentSession.value = row
  reservePage.value = 1
  reserveVisible.value = true
  loadReservations()
}

async function loadReservations() {
  reserveLoading.value = true
  try {
    const res = await api.listWatchPartyReservations({
      sessionId: currentSession.value._id,
      page: reservePage.value,
      pageSize: 50
    })
    reservations.value = res?.list || []
    reserveTotal.value = res?.total || 0
  } catch (e) {
    ElMessage.error('加载名单失败: ' + (e.message || e))
  } finally {
    reserveLoading.value = false
  }
}

async function onCheckIn(row) {
  try {
    await api.checkInWatchPartyReservation(row._id)
    ElMessage.success('已核销')
    loadReservations()
  } catch (e) {
    ElMessage.error('核销失败: ' + (e.message || e))
  }
}

function openStats(row) {
  currentSession.value = row
  statsVisible.value = true
  stats.value = null
  statsLoading.value = true
  api.getWatchPartyStats(row._id).then((res) => {
    stats.value = res
  }).catch((e) => {
    ElMessage.error('加载统计失败: ' + (e.message || e))
  }).finally(() => {
    statsLoading.value = false
  })
}

function openWxacode(row) {
  currentSession.value = row
  wxacodeVisible.value = true
  wxacodeImage.value = ''
  wxacodeScene.value = ''
}

async function onGenerateWxacode() {
  const channel = (wxacodeChannel.value || 'site').trim()
  wxacodeLoading.value = true
  try {
    const res = await api.generateWatchPartyWxacode({
      code: currentSession.value.code,
      channel,
      envVersion: wxacodeEnv.value
    })
    wxacodeImage.value = `data:${res.contentType || 'image/jpeg'};base64,${res.base64}`
    wxacodeScene.value = res.scene
  } catch (e) {
    ElMessage.error('生成失败: ' + (e.message || e))
  } finally {
    wxacodeLoading.value = false
  }
}

onMounted(() => {
  load()
  loadGlobalConfig()
})
</script>
