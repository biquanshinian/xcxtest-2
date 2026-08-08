<template>
  <div class="oa-page">
    <el-card>
      <template #header>
        <div class="hdr">
          <span>公众号日更流水线</span>
          <div class="acts">
            <el-button @click="openJobs">任务记录</el-button>
            <el-button @click="loadTopics" :loading="loadingTopics">刷新选题</el-button>
            <el-button type="warning" @click="onRunDaily" :loading="runningDaily">执行日更</el-button>
            <el-button type="primary" @click="onBatchGenerate" :loading="generating">批量生成选中</el-button>
          </div>
        </div>
      </template>

      <el-alert
        type="info"
        :closable="false"
        style="margin-bottom:12px"
        title="选题列表为实时拉取（发射/星舰事件/手写稿/采集），不会在流水线里堆积残留。生成结果进「草稿箱」；日更时会按发稿设置清理过期已发布/已拒绝草稿。"
      />

      <el-form inline style="margin-bottom:12px">
        <el-form-item label="发稿号" required>
          <el-select v-model="brandKey" placeholder="请选择发稿号" style="width:180px">
            <el-option
              v-for="b in brands"
              :key="b.key"
              :label="`${b.name}（槽 ${b.credentialSlot || '1'}）`"
              :value="b.key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="策略">
          <el-select v-model="strategyKey" clearable placeholder="自动匹配" style="width:200px">
            <el-option label="自动匹配（按正文）" value="auto" />
            <el-option v-for="s in strategies" :key="s.key || s._id" :label="s.name" :value="s.key || s._id" />
          </el-select>
        </el-form-item>
        <el-form-item label="手动素材">
          <el-input v-model="manualTitle" placeholder="标题" style="width:180px" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="manualText" type="textarea" :rows="1" placeholder="粘贴文章 URL 或原文，走洗稿" style="width:320px" />
        </el-form-item>
        <el-form-item>
          <el-button @click="onManualGenerate" :loading="generating">生成一篇</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="topics" stripe v-loading="loadingTopics" @selection-change="onSelect">
        <el-table-column type="selection" width="48" />
        <el-table-column label="配图" width="88">
          <template #default="{ row }">
            <div v-if="topicCover(row)" class="thumb-wrap">
              <el-image
                :src="topicCover(row)"
                :preview-src-list="topicImages(row)"
                fit="cover"
                class="topic-thumb"
                preview-teleported
              />
              <span v-if="topicVideos(row).length" class="vid-badge" :title="hasLongVideo(row) ? '含长视频（封面截图）' : '含视频（封面截图）'">▶</span>
            </div>
            <span v-else class="no-img">无图</span>
          </template>
        </el-table-column>
        <el-table-column prop="sourceType" label="来源" width="120" />
        <el-table-column prop="title" label="标题" min-width="200" />
        <el-table-column prop="summary" label="摘要" min-width="240" show-overflow-tooltip />
        <el-table-column label="媒体" width="110">
          <template #default="{ row }">
            <span>{{ mediaLabel(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="onGenerateOne(row)">生成</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer v-model="jobsVisible" title="任务记录（日更 / 追踪）" size="46%">
      <div class="jobs-toolbar">
        <el-select v-model="jobsType" clearable placeholder="全部类型" style="width:140px" @change="loadJobs">
          <el-option label="日更" value="daily" />
          <el-option label="作者追踪" value="track" />
        </el-select>
        <el-select v-model="jobsStatus" clearable placeholder="全部状态" style="width:140px" @change="loadJobs">
          <el-option label="进行中" value="running" />
          <el-option label="成功" value="done" />
          <el-option label="失败" value="failed" />
        </el-select>
        <el-button @click="loadJobs" :loading="jobsLoading">刷新</el-button>
      </div>
      <el-table :data="jobs" stripe v-loading="jobsLoading" size="small">
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ jobTypeLabel(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="jobStatusType(row.status)">{{ jobStatusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="结果" min-width="220">
          <template #default="{ row }">
            <div class="job-result">{{ jobResult(row) }}</div>
            <el-button
              v-for="id in jobDraftIds(row)"
              :key="id"
              link
              type="primary"
              size="small"
              @click="gotoDraft(id)"
            >打开草稿 {{ id.slice(-6) }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElNotification } from 'element-plus'
import { api } from '../api/client'

const router = useRouter()

const topics = ref([])
const strategies = ref([])
const selected = ref([])
const loadingTopics = ref(false)
const generating = ref(false)
const runningDaily = ref(false)
const strategyKey = ref('auto')
const brandKey = ref('')
const brands = ref([])
const manualTitle = ref('')
const manualText = ref('')

const BRAND_LS_KEY = 'oa_content_brand_key'

// —— 任务记录抽屉 ——
const jobsVisible = ref(false)
const jobs = ref([])
const jobsLoading = ref(false)
const jobsType = ref('')
const jobsStatus = ref('')

const fmtTime = (t) => (t ? new Date(t).toLocaleString() : '-')
const jobTypeLabel = (t) => ({ daily: '日更', track: '追踪' }[t] || t || '—')
const jobStatusLabel = (s) => ({ running: '进行中', done: '成功', failed: '失败' }[s] || s || '—')
const jobStatusType = (s) => ({ running: 'info', done: 'success', failed: 'danger' }[s] || 'info')

const jobResult = (row) => {
  if (row.error) return row.error
  const r = row.result || {}
  if (typeof r === 'string') return r
  if (r.summary) return r.summary
  const parts = []
  if (r.count != null) parts.push(`生成 ${r.count} 篇`)
  if (r.cleaned && (r.cleaned.drafts || r.cleaned.jobs)) {
    parts.push(`清理草稿 ${r.cleaned.drafts || 0} / 任务 ${r.cleaned.jobs || 0}`)
  }
  return parts.join('；') || '—'
}

const jobDraftIds = (row) => {
  const r = row.result || {}
  return Array.isArray(r.draftIds) ? r.draftIds.slice(0, 5) : []
}

const gotoDraft = (id) => {
  router.push({ path: '/oa-content/drafts', query: { id } })
}

const loadJobs = async () => {
  jobsLoading.value = true
  try {
    const res = await api.listOaJobs({
      pageSize: 30,
      type: jobsType.value || undefined,
      status: jobsStatus.value || undefined
    })
    jobs.value = res?.list || []
  } catch (e) {
    ElMessage.error(e.message || '加载任务记录失败')
  } finally {
    jobsLoading.value = false
  }
}

const openJobs = () => {
  jobsVisible.value = true
  loadJobs()
}

/** 生成成功提示：可点击直达草稿编辑 */
const notifyGenerated = (raw, fallbackText) => {
  // 后端返回 { results: [...] }（批量壳）或单条 { _id, ... }
  const res =
    raw && Array.isArray(raw.results) && raw.results.length === 1 ? raw.results[0] : raw || {}
  const id = res && res._id
  if (!id) {
    ElMessage.success(fallbackText)
    return
  }
  const fell = res.status === 'needs_review'
  const strat =
    res.strategyName || res.strategyKey
      ? ` · ${res.strategyName || res.strategyKey}${res.strategyAuto ? '（自动）' : ''}`
      : ''
  ElNotification({
    title: fell ? 'AI 生成失败，已写入素材整理稿' : fallbackText,
    message: fell
      ? `《${(res.title || '未命名').slice(0, 24)}》原因：${(res.llmError || '未知').slice(0, 120)}。点击打开草稿改写`
      : `《${(res.title || '未命名').slice(0, 24)}》${strat} 点击打开草稿编辑`,
    type: fell ? 'warning' : 'success',
    duration: fell ? 12000 : 6000,
    onClick: () => gotoDraft(id)
  })
}

const persistBrand = () => {
  try {
    if (brandKey.value) localStorage.setItem(BRAND_LS_KEY, brandKey.value)
  } catch (e) {}
}

const requireBrand = () => {
  if (!brandKey.value) {
    ElMessage.warning('请先选择发稿号（槽1 / 槽2）')
    return false
  }
  return true
}

const topicImages = (row) => {
  const list = []
  const push = (u) => {
    const s = String(u || '').trim()
    if (/^https?:\/\//i.test(s) && !list.includes(s)) list.push(s)
  }
  ;(row?.imageUrls || []).forEach(push)
  push(row?.coverUrl)
  return list
}

const topicCover = (row) => topicImages(row)[0] || ''

const topicVideos = (row) =>
  Array.isArray(row?.videos)
    ? row.videos.filter((v) => v && (v.posterUrl || v.url || v.pageUrl))
    : []

const hasLongVideo = (row) => topicVideos(row).some((v) => v.isLong)

/** 媒体列：图数（含视频封面截图）+ 视频数（长视频标注） */
const mediaLabel = (row) => {
  const imgs = topicImages(row).length
  const vids = topicVideos(row).length
  const parts = []
  if (imgs) parts.push(`${imgs}图`)
  if (vids) parts.push(`${vids}视频${hasLongVideo(row) ? '(长)' : ''}`)
  return parts.join(' · ') || '-'
}

const loadTopics = async () => {
  loadingTopics.value = true
  try {
    const res = await api.listOaTopics({ limit: 20 })
    topics.value = res?.list || []
  } catch (e) {
    ElMessage.error(e.message || '加载选题失败')
  } finally {
    loadingTopics.value = false
  }
}

const loadStrategies = async () => {
  try {
    const res = await api.listOaStrategies({ pageSize: 50 })
    strategies.value = res?.list || []
  } catch (e) {}
}

const loadBrands = async () => {
  try {
    const cfg = await api.getOaContentConfig()
    brands.value = (cfg?.brands || []).filter((b) => b.enabled !== false)
    const saved = localStorage.getItem(BRAND_LS_KEY) || ''
    brandKey.value =
      (saved && brands.value.some((b) => b.key === saved) && saved) ||
      cfg?.defaultBrandKey ||
      brands.value[0]?.key ||
      ''
  } catch (e) {
    brands.value = []
  }
}

const onSelect = (rows) => {
  selected.value = rows
}

const onGenerateOne = async (row) => {
  if (!requireBrand()) return
  generating.value = true
  try {
    const res = await api.generateOaContent({
      topic: row,
      strategyKey: strategyKey.value || undefined,
      brandKey: brandKey.value
    })
    persistBrand()
    notifyGenerated(res, '已生成到草稿箱')
  } catch (e) {
    ElMessage.error(e.message || '生成失败')
  } finally {
    generating.value = false
  }
}

const onBatchGenerate = async () => {
  if (!requireBrand()) return
  if (!selected.value.length) {
    ElMessage.warning('请先勾选题')
    return
  }
  generating.value = true
  try {
    await api.generateOaContent({
      topics: selected.value,
      strategyKey: strategyKey.value || undefined,
      brandKey: brandKey.value
    })
    persistBrand()
    ElMessage.success(`已提交 ${selected.value.length} 篇`)
  } catch (e) {
    ElMessage.error(e.message || '批量生成失败')
  } finally {
    generating.value = false
  }
}

const looksLikeUrl = (s) => /^https?:\/\/[^\s]+$/i.test(String(s || '').trim())

const onManualGenerate = async () => {
  if (!requireBrand()) return
  if (!manualText.value && !manualTitle.value) {
    ElMessage.warning('请填写标题或素材')
    return
  }
  generating.value = true
  try {
    const text = String(manualText.value || '').trim()
    const payload = {
      title: manualTitle.value,
      strategyKey: strategyKey.value || undefined,
      brandKey: brandKey.value
    }
    if (looksLikeUrl(text)) {
      payload.sourceUrl = text
      payload.manualText = text
    } else {
      payload.manualText = manualText.value
    }
    const res = await api.generateOaContent(payload)
    persistBrand()
    notifyGenerated(res, looksLikeUrl(text) ? '已抓取外链并生成到草稿箱' : '已生成到草稿箱')
    manualText.value = ''
  } catch (e) {
    ElMessage.error(e.message || '生成失败')
  } finally {
    generating.value = false
  }
}

const onRunDaily = async () => {
  runningDaily.value = true
  try {
    const res = await api.runOaDaily()
    if (res?.skipped) {
      ElMessage.success('日更已关闭（skipped）')
    } else {
      const c = res?.cleaned || {}
      ElMessage.success(
        `日更完成 ${res?.count || 0} 篇` +
          (c.drafts || c.jobs ? `（清理草稿 ${c.drafts || 0} / 任务 ${c.jobs || 0}）` : '')
      )
    }
  } catch (e) {
    ElMessage.error(e.message || '日更失败')
  } finally {
    runningDaily.value = false
  }
}

onMounted(() => {
  loadTopics()
  loadStrategies()
  loadBrands()
})
</script>

<style scoped>
.hdr { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
.acts { display:flex; gap:8px; flex-wrap:wrap; }
.topic-thumb { width:56px; height:42px; border-radius:4px; display:block; }
.thumb-wrap { position:relative; display:inline-block; line-height:0; }
.vid-badge {
  position:absolute; right:3px; bottom:3px;
  width:16px; height:16px; line-height:16px;
  font-size:9px; text-align:center; color:#fff;
  background:rgba(0,0,0,0.62); border-radius:50%;
  pointer-events:none;
}
.no-img { font-size:12px; color:#909399; }
.jobs-toolbar { display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
.job-result { font-size:12px; color:var(--el-text-color-secondary); word-break:break-all; }
</style>
