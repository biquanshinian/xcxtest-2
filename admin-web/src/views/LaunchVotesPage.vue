<template>
  <div>
    <!-- 全局竞猜配置 -->
    <el-card style="margin-bottom:16px;">
      <template #header>
        <span>全局竞猜配置</span>
        <el-tag size="small" :type="globalConfig.enabled ? 'success' : 'info'" style="margin-left:8px;">
          {{ globalConfig.enabled ? '准时已启用' : '准时已关闭' }}
        </el-tag>
        <el-tag size="small" :type="globalConfig.outcomeEnabled ? 'success' : 'info'" style="margin-left:8px;">
          {{ globalConfig.outcomeEnabled ? '成败已启用' : '成败已关闭' }}
        </el-tag>
      </template>
      <el-form :inline="true" :model="globalConfig">
        <el-form-item label="准时开关">
          <el-switch v-model="globalConfig.enabled" />
        </el-form-item>
        <el-form-item label="准时问题">
          <el-input v-model="globalConfig.customQuestion" placeholder="会准时吗？" style="width:220px;" />
        </el-form-item>
        <el-form-item label="鸽文案">
          <el-input v-model="globalConfig.geLabel" placeholder="鸽" style="width:90px;" />
        </el-form-item>
        <el-form-item label="不鸽文案">
          <el-input v-model="globalConfig.bugeLabel" placeholder="不鸽" style="width:90px;" />
        </el-form-item>
      </el-form>
      <el-form :inline="true" :model="globalConfig" style="margin-top:4px;">
        <el-form-item label="成败开关">
          <el-switch v-model="globalConfig.outcomeEnabled" />
        </el-form-item>
        <el-form-item label="成败问题">
          <el-input v-model="globalConfig.outcomeQuestion" placeholder="会成功吗？" style="width:220px;" />
        </el-form-item>
        <el-form-item label="失败文案">
          <el-input v-model="globalConfig.failureLabel" placeholder="失败" style="width:90px;" />
        </el-form-item>
        <el-form-item label="成功文案">
          <el-input v-model="globalConfig.successLabel" placeholder="成功" style="width:90px;" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="globalSaving" @click="saveGlobalConfig">保存全局配置</el-button>
        </el-form-item>
      </el-form>
      <div style="color:var(--t-text-muted, #86868b);font-size:12px;margin-top:4px;">
        开启后，所有未单独配置竞猜的任务都会显示对应题型。下方可为特定任务创建独立竞猜（会覆盖全局配置）。成败结算：成功/载荷部署→成功；失败/部分失败/取消等→失败。
      </div>
    </el-card>

    <!-- 单任务竞猜管理 -->
    <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>发射竞猜管理</span>
        <el-button type="primary" @click="openCreate">新建竞猜</el-button>
      </div>
    </template>

    <el-table :data="list" stripe>
      <el-table-column prop="missionName" label="任务名称" min-width="140" />
      <el-table-column prop="rocketName" label="火箭型号" width="120" />
      <el-table-column label="题型" width="90">
        <template #default="scope">
          <el-tag :type="scope.row.voteType === 'outcome' ? 'warning' : ''" size="small">
            {{ scope.row.voteType === 'outcome' ? '成败' : '准时' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="发射时间" width="170">
        <template #default="scope">{{ fmt(scope.row.launchTime) }}</template>
      </el-table-column>
      <el-table-column label="票数" width="120">
        <template #default="scope">
          <span v-if="scope.row.voteType === 'outcome'">
            败 {{ scope.row.failureCount || 0 }} / 成 {{ scope.row.successCount || 0 }}
          </span>
          <span v-else>
            鸽 {{ scope.row.geCount || 0 }} / 不鸽 {{ scope.row.buGeCount || 0 }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="customQuestion" label="自定义问题" min-width="140" show-overflow-tooltip />
      <el-table-column label="启用状态" width="90">
        <template #default="scope">
          <el-tag :type="scope.row.enabled ? 'success' : 'info'" size="small">
            {{ scope.row.enabled ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="结算结果" width="110">
        <template #default="scope">
          <template v-if="scope.row.voteType === 'outcome'">
            <el-tag v-if="scope.row.result === 'success'" type="success" size="small">成功</el-tag>
            <el-tag v-else-if="scope.row.result === 'failure'" type="danger" size="small">失败</el-tag>
            <el-tag v-else type="info" size="small">未结算</el-tag>
          </template>
          <template v-else>
            <el-tag v-if="scope.row.result === 'ge'" type="warning" size="small">鸽了</el-tag>
            <el-tag v-else-if="scope.row.result === 'buge'" type="success" size="small">没鸽</el-tag>
            <el-tag v-else type="info" size="small">未结算</el-tag>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="当前轮次" width="90">
        <template #default="scope">
          <el-tag size="small">第{{ scope.row.currentRound || 1 }}轮</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="scope">
          <el-button size="small" @click="openEdit(scope.row)">编辑</el-button>
          <el-button size="small" type="danger" @click="onDelete(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="query.page"
      v-model:page-size="query.pageSize"
      :total="total"
      :page-sizes="[10, 20, 50]"
      layout="total, sizes, prev, pager, next"
      style="margin-top:16px;"
      @current-change="load"
      @size-change="load"
    />

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑竞猜' : '新建竞猜'" width="640px">
      <el-form :model="form" label-width="120px">
        <el-form-item label="竞猜题型">
          <el-radio-group v-model="form.voteType" :disabled="!!editing">
            <el-radio-button label="ontime">准时竞猜</el-radio-button>
            <el-radio-button label="outcome">成败竞猜</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="关联发射ID">
          <el-input v-model="form.launchId" placeholder="发射任务ID" :disabled="!!editing" />
        </el-form-item>
        <el-form-item label="任务名称">
          <el-input v-model="form.missionName" placeholder="任务名称" />
        </el-form-item>
        <el-form-item label="火箭型号">
          <el-input v-model="form.rocketName" placeholder="火箭型号" />
        </el-form-item>
        <el-form-item label="发射时间">
          <el-date-picker v-model="form.launchTime" type="datetime" placeholder="选择发射时间" style="width:100%;" />
        </el-form-item>
        <template v-if="form.voteType === 'outcome'">
          <el-form-item label="失败票数">
            <el-input-number v-model="form.failureCount" :min="0" />
          </el-form-item>
          <el-form-item label="成功票数">
            <el-input-number v-model="form.successCount" :min="0" />
          </el-form-item>
          <el-form-item label="自定义问题">
            <el-input v-model="form.customQuestion" placeholder="默认：会成功吗？" />
          </el-form-item>
          <el-form-item label="失败文案">
            <el-input v-model="form.failureLabel" placeholder="失败" />
          </el-form-item>
          <el-form-item label="成功文案">
            <el-input v-model="form.successLabel" placeholder="成功" />
          </el-form-item>
          <el-form-item label="结算结果">
            <el-select v-model="form.result" placeholder="选择结算结果" style="width:100%;" clearable>
              <el-option label="未结算" value="" />
              <el-option label="失败" value="failure" />
              <el-option label="成功" value="success" />
            </el-select>
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="鸽票数">
            <el-input-number v-model="form.geCount" :min="0" />
          </el-form-item>
          <el-form-item label="不鸽票数">
            <el-input-number v-model="form.buGeCount" :min="0" />
          </el-form-item>
          <el-form-item label="自定义问题">
            <el-input v-model="form.customQuestion" placeholder="默认：会准时吗？" />
          </el-form-item>
          <el-form-item label="结算结果">
            <el-select v-model="form.result" placeholder="选择结算结果" style="width:100%;" clearable>
              <el-option label="未结算" value="" />
              <el-option label="鸽了" value="ge" />
              <el-option label="没鸽" value="buge" />
            </el-select>
          </el-form-item>
        </template>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
        <el-form-item label="结算备注">
          <el-input v-model="form.resultNote" type="textarea" :rows="2" placeholder="结算备注" />
        </el-form-item>
        <el-form-item label="当前轮次" v-if="form.voteType !== 'outcome'">
          <el-input-number v-model="form.currentRound" :min="1" />
          <span style="margin-left:8px;color:#86868b;font-size:12px;">推迟后系统自动递增，也可手动调整</span>
        </el-form-item>
        <el-form-item label="历史轮次" v-if="form.voteType !== 'outcome' && form.rounds && form.rounds.length">
          <div v-for="(r, idx) in form.rounds" :key="idx" style="margin-bottom:4px;font-size:13px;color:#606266;">
            第{{ r.round }}轮：{{ r.launchTime || '未知时间' }} → {{ r.result === 'ge' ? '鸽了' : r.result === 'buge' ? '没鸽' : '未结算' }}
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const fmt = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-')

// 全局竞猜配置
const globalConfig = reactive({
  enabled: false,
  customQuestion: '会准时吗？',
  geLabel: '鸽',
  bugeLabel: '不鸽',
  outcomeEnabled: true,
  outcomeQuestion: '会成功吗？',
  successLabel: '成功',
  failureLabel: '失败'
})
const globalSaving = ref(false)

const loadGlobalConfig = async () => {
  try {
    const res = await api.getVoteConfig()
    if (res) {
      globalConfig.enabled = res.enabled !== false
      globalConfig.customQuestion = res.customQuestion || '会准时吗？'
      globalConfig.geLabel = res.geLabel || '鸽'
      globalConfig.bugeLabel = res.bugeLabel || '不鸽'
      globalConfig.outcomeEnabled = res.outcomeEnabled !== false
      globalConfig.outcomeQuestion = res.outcomeQuestion || '会成功吗？'
      globalConfig.successLabel = res.successLabel || '成功'
      globalConfig.failureLabel = res.failureLabel || '失败'
    }
  } catch (e) {}
}

const saveGlobalConfig = async () => {
  globalSaving.value = true
  try {
    await api.updateVoteConfig({
      enabled: globalConfig.enabled,
      customQuestion: globalConfig.customQuestion,
      geLabel: globalConfig.geLabel,
      bugeLabel: globalConfig.bugeLabel,
      outcomeEnabled: globalConfig.outcomeEnabled,
      outcomeQuestion: globalConfig.outcomeQuestion,
      successLabel: globalConfig.successLabel,
      failureLabel: globalConfig.failureLabel
    })
    ElMessage.success('全局配置已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    globalSaving.value = false
  }
}

const list = ref([])
const total = ref(0)
const dialogVisible = ref(false)
const editing = ref(null)
const saving = ref(false)
const query = reactive({ page: 1, pageSize: 20 })

const defaultForm = {
  launchId: '',
  voteType: 'ontime',
  missionName: '',
  rocketName: '',
  launchTime: '',
  geCount: 0,
  buGeCount: 0,
  successCount: 0,
  failureCount: 0,
  customQuestion: '会准时吗？',
  successLabel: '成功',
  failureLabel: '失败',
  enabled: true,
  result: '',
  resultNote: '',
  currentRound: 1,
  rounds: []
}

const form = reactive({ ...defaultForm })

watch(() => form.voteType, (vt) => {
  if (editing.value) return
  if (vt === 'outcome') {
    if (!form.customQuestion || form.customQuestion === '会准时吗？') {
      form.customQuestion = '会成功吗？'
    }
    if (form.result === 'ge' || form.result === 'buge') form.result = ''
  } else if (!form.customQuestion || form.customQuestion === '会成功吗？' || form.customQuestion === '本次发射会成功吗？') {
    form.customQuestion = '会准时吗？'
    if (form.result === 'success' || form.result === 'failure') form.result = ''
  }
})

const load = async () => {
  try {
    const res = await api.listLaunchVotes({
      page: query.page,
      pageSize: query.pageSize
    })
    list.value = res?.list ?? []
    total.value = res?.total ?? 0
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  }
}

const resetForm = () => {
  Object.assign(form, { ...defaultForm })
}

const openCreate = () => {
  editing.value = null
  resetForm()
  dialogVisible.value = true
}

const openEdit = (row) => {
  editing.value = row
  Object.assign(form, {
    launchId: row.launchId ?? '',
    voteType: row.voteType === 'outcome' ? 'outcome' : 'ontime',
    missionName: row.missionName ?? '',
    rocketName: row.rocketName ?? '',
    launchTime: row.launchTime ?? '',
    geCount: row.geCount ?? 0,
    buGeCount: row.buGeCount ?? 0,
    successCount: row.successCount ?? 0,
    failureCount: row.failureCount ?? 0,
    customQuestion: row.customQuestion ?? (row.voteType === 'outcome' ? '会成功吗？' : '会准时吗？'),
    successLabel: row.successLabel ?? '成功',
    failureLabel: row.failureLabel ?? '失败',
    enabled: row.enabled !== false,
    result: row.result ?? '',
    resultNote: row.resultNote ?? '',
    currentRound: row.currentRound ?? 1,
    rounds: row.rounds ?? []
  })
  dialogVisible.value = true
}

const onSubmit = async () => {
  saving.value = true
  try {
    const payload = { ...form }
    if (payload.launchTime instanceof Date) {
      payload.launchTime = payload.launchTime.toISOString()
    }
    const id = editing.value?._id ?? editing.value?.id
    if (id) {
      await api.updateLaunchVote(id, payload)
      ElMessage.success('更新成功')
    } else {
      await api.createLaunchVote(payload)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const onDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确认删除该竞猜吗？', '提示', { type: 'warning' })
    await api.deleteLaunchVote(row._id ?? row.id)
    ElMessage.success('删除成功')
    await load()
  } catch (e) {}
}

onMounted(() => {
  loadGlobalConfig()
  load()
})
</script>
