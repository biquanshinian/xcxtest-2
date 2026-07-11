<template>
  <div>
    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <el-tab-pane label="签到里程碑" name="checkin" />
      <el-tab-pane label="问答里程碑" name="quiz" />
      <el-tab-pane label="发射竞猜里程碑" name="vote" />
      <el-tab-pane label="领奖记录" name="claims" />
    </el-tabs>

    <!-- 里程碑配置列表 -->
    <el-card v-if="activeTab !== 'claims'">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>{{ activeTab === 'checkin' ? '签到' : activeTab === 'quiz' ? '问答' : '发射竞猜' }}里程碑配置</span>
          <el-button type="primary" @click="openDialog()">新增里程碑</el-button>
        </div>
      </template>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="达标数值" prop="threshold" width="100" />
        <el-table-column label="弹窗标题" prop="title" min-width="180" />
        <el-table-column label="奖品描述" prop="description" min-width="180" show-overflow-tooltip />
        <el-table-column label="奖品图片" width="100">
          <template #default="{ row }">
            <el-image v-if="row.prizeImage" :src="row.prizeImage" style="width:50px;height:50px;border-radius:6px" fit="cover" :preview-src-list="[row.prizeImage]" />
            <span v-else style="color:#999">无</span>
          </template>
        </el-table-column>
        <el-table-column label="排序" prop="sortOrder" width="80" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '禁用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDialog(row)">编辑</el-button>
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
    </el-card>

    <!-- 领奖记录 -->
    <el-card v-if="activeTab === 'claims'">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>领奖记录</span>
          <el-select v-model="claimStatusFilter" placeholder="全部状态" clearable style="width:140px" @change="loadClaims">
            <el-option label="待发货" value="pending" />
            <el-option label="已发货" value="shipped" />
            <el-option label="已完成" value="completed" />
          </el-select>
        </div>
      </template>

      <el-table :data="claims" v-loading="claimsLoading" stripe>
        <el-table-column label="用户" width="120">
          <template #default="{ row }">
            <span style="font-size:12px">{{ (row.openid || '').slice(0, 10) }}...</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type === 'checkin' ? '' : row.type === 'quiz' ? 'warning' : 'success'">{{ row.type === 'checkin' ? '签到' : row.type === 'quiz' ? '问答' : '发射竞猜' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="达标值" prop="threshold" width="80" />
        <el-table-column label="奖品" prop="prizeTitle" min-width="140" show-overflow-tooltip />
        <el-table-column label="收件人" prop="name" width="100" />
        <el-table-column label="电话" prop="phone" width="130" />
        <el-table-column label="用户选择" min-width="120">
          <template #default="{ row }">
            <span v-if="row.selections && Object.keys(row.selections).length">
              <span v-for="(val, key) in row.selections" :key="key" style="margin-right:8px;font-size:12px">{{ key }}: {{ val }}</span>
            </span>
            <span v-else-if="row.size" style="font-size:12px">尺码: {{ row.size }}</span>
            <span v-else style="color:#999;font-size:12px">-</span>
          </template>
        </el-table-column>
        <el-table-column label="地址" prop="address" min-width="200" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'pending' ? 'warning' : row.status === 'shipped' ? '' : 'success'" size="small">
              {{ row.status === 'pending' ? '待发货' : row.status === 'shipped' ? '已发货' : '已完成' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="物流单号" prop="trackingNumber" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.trackingNumber">{{ row.trackingNumber }}</span>
            <span v-else style="color:#999">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" size="small" type="primary" @click="onShip(row)">发货</el-button>
            <el-button v-if="row.status === 'shipped' || row.status === 'completed'" size="small" @click="onEditTracking(row)">改单号</el-button>
            <el-button v-if="row.status === 'shipped'" size="small" type="success" @click="onComplete(row)">完成</el-button>
            <el-button size="small" type="danger" @click="onDeleteClaim(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="claimsTotal > claimsPageSize"
        style="margin-top:16px;justify-content:center"
        layout="prev, pager, next"
        :total="claimsTotal"
        :page-size="claimsPageSize"
        :current-page="claimsPage"
        @current-change="p => { claimsPage = p; loadClaims() }"
      />
    </el-card>

    <!-- 编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑里程碑' : '新增里程碑'" width="560px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="类型">
          <el-radio-group v-model="form.type" :disabled="!!editing">
            <el-radio value="checkin">签到天数</el-radio>
            <el-radio value="quiz">问答正确数</el-radio>
            <el-radio value="vote">发射竞猜猜对数</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="达标数值">
          <el-input-number v-model="form.threshold" :min="1" :max="9999" />
          <span style="margin-left:8px;color:#999;font-size:12px">{{ form.type === 'checkin' ? '累计签到天数' : form.type === 'quiz' ? '累计答对题数' : '累计猜对发射次数' }}</span>
        </el-form-item>
        <el-form-item label="弹窗标题">
          <el-input v-model="form.title" placeholder="例：恭喜达成30天签到！" />
        </el-form-item>
        <el-form-item label="奖品描述">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="例：T恤一件，运费到付" />
        </el-form-item>
        <el-form-item label="奖品图片">
          <el-input v-model="form.prizeImage" placeholder="图片URL" />
          <el-image v-if="form.prizeImage" :src="form.prizeImage" style="width:80px;height:80px;margin-top:8px;border-radius:8px" fit="cover" />
        </el-form-item>
        <el-form-item label="金蛋图片">
          <el-input v-model="form.eggImage" placeholder="可选，留空使用默认金蛋" />
        </el-form-item>
        <el-form-item label="自定义选项">
          <div v-for="(opt, idx) in form.customOptions" :key="idx" style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
            <el-input v-model="opt.label" placeholder="选项标题（如：尺码）" style="width:120px" />
            <el-input v-model="opt.optionsStr" placeholder="选项列表，逗号分隔（如：S,M,L,XL）" style="flex:1" />
            <el-checkbox v-model="opt.required" label="必选" />
            <el-button type="danger" size="small" text @click="form.customOptions.splice(idx, 1)">删除</el-button>
          </div>
          <el-button size="small" @click="form.customOptions.push({ label: '', optionsStr: '', required: true })">+ 添加选项组</el-button>
        </el-form-item>
        <el-form-item label="备注文字">
          <el-input v-model="form.customNote" placeholder="可选，如：颜色随机发放，不支持指定颜色" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const activeTab = ref('checkin')
const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20

const claimsLoading = ref(false)
const claims = ref([])
const claimsTotal = ref(0)
const claimsPage = ref(1)
const claimsPageSize = 20
const claimStatusFilter = ref('')

const dialogVisible = ref(false)
const editing = ref(null)
const saving = ref(false)
const form = reactive({
  type: 'checkin',
  threshold: 30,
  title: '',
  description: '',
  prizeImage: '',
  eggImage: '',
  sortOrder: 0,
  enabled: true,
  customOptions: [],
  customNote: ''
})

function formatTime(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN')
}

async function load(type) {
  const t = type || activeTab.value
  loading.value = true
  try {
    const res = await api.listMilestoneRewards({ page: page.value, pageSize, type: t })
    list.value = res?.list || []
    total.value = res?.total || 0
  } catch (e) {
    ElMessage.error('加载失败: ' + (e.message || e))
  } finally {
    loading.value = false
  }
}

async function loadClaims() {
  claimsLoading.value = true
  try {
    const q = { page: claimsPage.value, pageSize: claimsPageSize }
    if (claimStatusFilter.value) q.status = claimStatusFilter.value
    const res = await api.listMilestoneClaims(q)
    claims.value = res?.list || []
    claimsTotal.value = res?.total || 0
  } catch (e) {
    ElMessage.error('加载失败: ' + (e.message || e))
  } finally {
    claimsLoading.value = false
  }
}

function onTabChange(tabName) {
  page.value = 1
  claimsPage.value = 1
  if (tabName === 'claims') {
    loadClaims()
  } else {
    load(tabName)
  }
}

function openDialog(row) {
  editing.value = row || null
  form.type = row?.type || activeTab.value
  form.threshold = row?.threshold || 30
  form.title = row?.title || ''
  form.description = row?.description || ''
  form.prizeImage = row?.prizeImage || ''
  form.eggImage = row?.eggImage || ''
  form.sortOrder = row?.sortOrder || 0
  form.enabled = row?.enabled !== false
  form.customNote = row?.customNote || ''
  form.customOptions = (row?.customOptions || []).map(o => ({
    label: o.label || '',
    optionsStr: (o.options || []).join(', '),
    required: o.required !== false
  }))
  dialogVisible.value = true
}

async function onSave() {
  if (!form.title || !form.threshold) {
    return ElMessage.warning('请填写标题和达标数值')
  }
  saving.value = true
  try {
    const payload = { ...form }
    // 将 optionsStr 转为 options 数组
    payload.customOptions = (form.customOptions || [])
      .filter(o => o.label && o.optionsStr)
      .map(o => ({ label: o.label.trim(), options: o.optionsStr.split(/[,，]/).map(s => s.trim()).filter(Boolean), required: !!o.required }))
    if (editing.value) {
      await api.updateMilestoneReward(editing.value._id, payload)
      ElMessage.success('更新成功')
    } else {
      await api.createMilestoneReward(payload)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    load()
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.message || e))
  } finally {
    saving.value = false
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.title}」？`, '确认删除', { type: 'warning' })
    await api.deleteMilestoneReward(row._id)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

async function onShip(row) {
  try {
    const { value } = await ElMessageBox.prompt('请输入物流单号', '标记发货', {
      confirmButtonText: '确认发货',
      cancelButtonText: '取消',
      inputPlaceholder: '快递单号',
      inputValidator: (v) => !!v?.trim() || '请输入物流单号'
    })
    await api.updateMilestoneClaimStatus(row._id, { status: 'shipped', trackingNumber: value.trim() })
    ElMessage.success('已发货')
    loadClaims()
  } catch (e) {
    if (e === 'cancel' || e?.toString?.().includes('cancel')) return
    ElMessage.error('操作失败')
  }
}

async function onEditTracking(row) {
  try {
    const { value } = await ElMessageBox.prompt('修改物流单号', '编辑物流', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: row.trackingNumber || '',
      inputPlaceholder: '快递单号',
      inputValidator: (v) => !!v?.trim() || '请输入物流单号'
    })
    await api.updateMilestoneClaimStatus(row._id, { status: row.status, trackingNumber: value.trim() })
    ElMessage.success('已更新')
    loadClaims()
  } catch (e) {
    if (e === 'cancel' || e?.toString?.().includes('cancel')) return
    ElMessage.error('操作失败')
  }
}

async function onComplete(row) {
  try {
    await ElMessageBox.confirm('确认标记为已完成？', '提示')
    await api.updateMilestoneClaimStatus(row._id, { status: 'completed' })
    ElMessage.success('已完成')
    loadClaims()
  } catch (e) {
    if (e === 'cancel' || e?.toString?.().includes('cancel')) return
    ElMessage.error('操作失败')
  }
}

async function onDeleteClaim(row) {
  try {
    await ElMessageBox.confirm(`确定删除该领奖记录？（用户: ${(row.openid || '').slice(0, 10)}...，奖品: ${row.prizeTitle || '-'}）`, '确认删除', { type: 'warning' })
    await api.deleteMilestoneClaim(row._id)
    ElMessage.success('已删除')
    loadClaims()
  } catch (e) {
    if (e === 'cancel' || e?.toString?.().includes('cancel')) return
    ElMessage.error('删除失败: ' + (e.message || e))
  }
}

onMounted(load)
</script>
