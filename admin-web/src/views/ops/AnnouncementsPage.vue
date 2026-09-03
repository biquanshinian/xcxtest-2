<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>系统公告</span>
        <el-button type="primary" @click="openCreate">新建公告</el-button>
      </div>
    </template>

    <el-table :data="list" stripe>
      <el-table-column prop="title" label="标题" min-width="160" />
      <el-table-column prop="type" label="类型" width="100">
        <template #default="scope">
          <el-tag :type="tagType(scope.row.type)">{{ scope.row.type || 'info' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="version" label="版本" width="100" />
      <el-table-column label="投票" width="110">
        <template #default="scope">
          <el-tag v-if="scope.row.vote?.enabled" :type="voteStatusTag(scope.row.vote).type" size="small">
            {{ voteStatusTag(scope.row.vote).label }}
          </el-tag>
          <span v-else style="color:#909399;">-</span>
        </template>
      </el-table-column>
      <el-table-column label="强制更新" width="90">
        <template #default="scope">
          <el-tag :type="scope.row.forceUpdate ? 'warning' : 'info'" size="small">
            {{ scope.row.forceUpdate ? '是' : '否' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="维护模式" width="90">
        <template #default="scope">
          <el-tag :type="scope.row.maintenance ? 'danger' : 'info'" size="small">
            {{ scope.row.maintenance ? '是' : '否' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="scope">
          <el-tag :type="scope.row.active ? 'success' : 'info'">
            {{ scope.row.active ? '生效' : '失效' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="scope">{{ fmt(scope.row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="scope">
          <el-button v-if="scope.row.vote?.enabled" size="small" type="success" plain @click="openResult(scope.row)">结果</el-button>
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

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑公告' : '新建公告'" width="680px" top="4vh">
      <el-form :model="form" label-width="100px">
        <el-form-item label="标题">
          <el-input v-model="form.title" placeholder="公告标题" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.content" type="textarea" :rows="4" placeholder="公告内容" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" placeholder="选择类型" style="width:100%;">
            <el-option label="info" value="info" />
            <el-option label="warning" value="warning" />
            <el-option label="error" value="error" />
            <el-option label="success" value="success" />
          </el-select>
        </el-form-item>
        <el-form-item label="版本号">
          <el-input v-model="form.version" placeholder="如 1.2.0" />
        </el-form-item>
        <el-form-item label="强制更新">
          <el-switch v-model="form.forceUpdate" />
        </el-form-item>
        <el-form-item label="维护模式">
          <el-switch v-model="form.maintenance" />
        </el-form-item>
        <el-form-item label="生效">
          <el-switch v-model="form.active" />
        </el-form-item>

        <el-divider content-position="left">投票设置</el-divider>
        <el-form-item label="启用投票">
          <el-switch v-model="voteForm.enabled" />
          <span style="margin-left:12px;color:#909399;font-size:12px;">每个用户只能投一票，到期后自动公示结果</span>
        </el-form-item>

        <template v-if="voteForm.enabled">
          <el-form-item label="投票问题">
            <el-input v-model="voteForm.question" placeholder="例如：你最期待哪次发射？" />
          </el-form-item>
          <el-form-item label="投票介绍">
            <el-input v-model="voteForm.intro" type="textarea" :rows="2" placeholder="投票的背景说明（可选）" />
          </el-form-item>
          <el-form-item label="开始时间">
            <el-date-picker v-model="voteForm.startTime" type="datetime" placeholder="留空 = 立即开始" style="width:100%;" />
          </el-form-item>
          <el-form-item label="截止时间">
            <el-date-picker v-model="voteForm.endTime" type="datetime" placeholder="留空 = 不截止" style="width:100%;" />
          </el-form-item>
          <el-form-item label="结果公示语">
            <el-input v-model="voteForm.resultNote" type="textarea" :rows="2" placeholder="到期后展示给用户的结果说明（可选，可随时编辑补充）" />
          </el-form-item>

          <el-form-item label="投票选项">
            <div style="width:100%;">
              <div
                v-for="(opt, idx) in voteForm.options"
                :key="opt.id"
                style="border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:12px;margin-bottom:10px;"
              >
                <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
                  <span style="color:#909399;font-size:12px;white-space:nowrap;">选项 {{ idx + 1 }}</span>
                  <el-input v-model="opt.label" placeholder="选项文字" />
                  <el-button
                    size="small"
                    type="danger"
                    plain
                    :disabled="voteForm.options.length <= 2"
                    @click="removeOption(idx)"
                  >删除</el-button>
                </div>
                <CosUpload v-model="opt.image" path-prefix="公告投票/" accept="image/*" button-text="上传选项图片" placeholder="选项配图 URL（可选）" />
              </div>
              <el-button size="small" @click="addOption">+ 添加选项</el-button>
              <div style="color:#909399;font-size:12px;margin-top:4px;">至少 2 个选项；编辑已发布的投票时，保留的选项票数不会清零</div>
            </div>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resultVisible" title="投票结果" width="560px">
      <template v-if="resultRow?.vote">
        <div style="margin-bottom:12px;">
          <div style="font-weight:600;font-size:15px;">{{ resultRow.vote.question || resultRow.title }}</div>
          <div style="color:#909399;font-size:12px;margin-top:4px;">
            {{ voteTimeRange(resultRow.vote) }} ·
            <el-tag :type="voteStatusTag(resultRow.vote).type" size="small">{{ voteStatusTag(resultRow.vote).label }}</el-tag>
            · 共 {{ voteTotal(resultRow.vote) }} 票
          </div>
        </div>
        <div v-for="opt in resultRow.vote.options" :key="opt.id" style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
            <span style="display:flex;align-items:center;gap:6px;">
              <img v-if="opt.image" :src="opt.image" style="width:28px;height:28px;object-fit:cover;border-radius:4px;" />
              {{ opt.label }}
            </span>
            <span>{{ opt.count || 0 }} 票（{{ votePercent(resultRow.vote, opt) }}%）</span>
          </div>
          <el-progress :percentage="votePercent(resultRow.vote, opt)" :show-text="false" :stroke-width="10" />
        </div>
        <div v-if="resultRow.vote.resultNote" style="margin-top:12px;padding:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:6px;font-size:13px;">
          公示语：{{ resultRow.vote.resultNote }}
        </div>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api/client'
import CosUpload from '../../components/media/CosUpload.vue'

const fmt = (t) => (t ? new Date(t).toLocaleString() : '-')
const tagType = (t) => {
  const map = { info: 'primary', warning: 'warning', error: 'danger', success: 'success' }
  return map[t] || 'info'
}

const list = ref([])
const total = ref(0)
const dialogVisible = ref(false)
const editing = ref(null)
const saving = ref(false)
const resultVisible = ref(false)
const resultRow = ref(null)
const query = reactive({ page: 1, pageSize: 20 })

const form = reactive({
  title: '',
  content: '',
  type: 'info',
  version: '',
  forceUpdate: false,
  maintenance: false,
  active: true
})

const newOption = () => ({ id: `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, label: '', image: '' })

const voteForm = reactive({
  enabled: false,
  question: '',
  intro: '',
  startTime: null,
  endTime: null,
  resultNote: '',
  options: []
})

const voteTotal = (vote) => (vote?.options || []).reduce((s, o) => s + (Number(o.count) || 0), 0)
const votePercent = (vote, opt) => {
  const t = voteTotal(vote)
  return t > 0 ? Math.round(((Number(opt.count) || 0) / t) * 100) : 0
}
const voteStatusTag = (vote) => {
  const now = Date.now()
  if (vote.startTime && now < vote.startTime) return { type: 'info', label: '未开始' }
  if (vote.endTime && now >= vote.endTime) return { type: 'warning', label: '已公示' }
  return { type: 'success', label: '投票中' }
}
const voteTimeRange = (vote) => {
  const s = vote.startTime ? fmt(vote.startTime) : '立即开始'
  const e = vote.endTime ? fmt(vote.endTime) : '不截止'
  return `${s} ~ ${e}`
}

const load = async () => {
  try {
    const res = await api.listAnnouncements({
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
  Object.assign(form, {
    title: '',
    content: '',
    type: 'info',
    version: '',
    forceUpdate: false,
    maintenance: false,
    active: true
  })
  Object.assign(voteForm, {
    enabled: false,
    question: '',
    intro: '',
    startTime: null,
    endTime: null,
    resultNote: '',
    options: [newOption(), newOption()]
  })
}

const addOption = () => voteForm.options.push(newOption())
const removeOption = (idx) => voteForm.options.splice(idx, 1)

const openCreate = () => {
  editing.value = null
  resetForm()
  dialogVisible.value = true
}

const openEdit = (row) => {
  editing.value = row
  resetForm()
  Object.assign(form, {
    title: row.title ?? '',
    content: row.content ?? '',
    type: row.type ?? 'info',
    version: row.version ?? '',
    forceUpdate: !!row.forceUpdate,
    maintenance: !!row.maintenance,
    active: row.active !== false
  })
  const vote = row.vote
  if (vote?.enabled) {
    Object.assign(voteForm, {
      enabled: true,
      question: vote.question || '',
      intro: vote.intro || '',
      startTime: vote.startTime ? new Date(vote.startTime) : null,
      endTime: vote.endTime ? new Date(vote.endTime) : null,
      resultNote: vote.resultNote || '',
      options: (vote.options || []).map((o) => ({ id: o.id, label: o.label || '', image: o.image || '' }))
    })
    if (voteForm.options.length < 2) voteForm.options.push(newOption())
  }
  dialogVisible.value = true
}

const openResult = (row) => {
  resultRow.value = row
  resultVisible.value = true
}

const buildVotePayload = () => {
  if (!voteForm.enabled) return null
  const options = voteForm.options
    .map((o) => ({ id: o.id, label: (o.label || '').trim(), image: (o.image || '').trim() }))
    .filter((o) => o.label)
  if (options.length < 2) {
    throw new Error('投票至少需要 2 个有文字的选项')
  }
  const startTime = voteForm.startTime ? new Date(voteForm.startTime).getTime() : 0
  const endTime = voteForm.endTime ? new Date(voteForm.endTime).getTime() : 0
  if (startTime && endTime && endTime <= startTime) {
    throw new Error('截止时间必须晚于开始时间')
  }
  return {
    enabled: true,
    question: (voteForm.question || '').trim(),
    intro: (voteForm.intro || '').trim(),
    startTime,
    endTime,
    resultNote: (voteForm.resultNote || '').trim(),
    options
  }
}

const onSubmit = async () => {
  let vote
  try {
    vote = buildVotePayload()
  } catch (e) {
    ElMessage.warning(e.message)
    return
  }
  saving.value = true
  try {
    const id = editing.value?._id ?? editing.value?.id
    const body = { ...form, vote }
    if (id) {
      await api.updateAnnouncement(id, body)
      ElMessage.success('更新成功')
    } else {
      await api.createAnnouncement(body)
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
    await ElMessageBox.confirm('确认删除该公告吗？', '提示', { type: 'warning' })
    await api.deleteAnnouncement(row._id ?? row.id)
    ElMessage.success('删除成功')
    await load()
  } catch (e) {}
}

onMounted(load)
</script>
