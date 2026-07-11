<template>
  <el-card>
    <template #header>
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;">
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          <span>文章管理（小程序「航天事件」手写稿）</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:13px;color:#606266;white-space:nowrap;">小程序展示手写稿</span>
            <el-switch v-model="manualEnabled" :loading="configSaving" @change="saveManualConfig" />
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <el-input v-model="query.keyword" placeholder="关键词" style="width:220px" @keyup.enter="load" />
          <el-select v-model="query.published" placeholder="发布状态" style="width:140px" clearable>
            <el-option label="已发布" value="true" />
            <el-option label="未发布" value="false" />
          </el-select>
          <el-button @click="load">查询</el-button>
          <el-button type="primary" @click="openCreate">新建</el-button>
        </div>
      </div>
    </template>

    <el-table :data="list" stripe>
      <el-table-column prop="title" label="标题" min-width="260" />
      <el-table-column prop="publishedAt" label="时间" width="180" />
      <el-table-column label="图片" width="80">
        <template #default="scope">
          <img
            v-if="(scope.row.images && scope.row.images[0]) || scope.row.image"
            :src="(scope.row.images && scope.row.images[0]) || scope.row.image"
            style="width:40px;height:28px;object-fit:cover;border-radius:3px;cursor:pointer;"
            @click="openPreview((scope.row.images && scope.row.images[0]) || scope.row.image)"
          />
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column prop="weight" label="权重" width="80" />
      <el-table-column label="发布" width="90">
        <template #default="scope">
          <el-tag :type="scope.row.published ? 'success' : 'info'">{{ scope.row.published ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220">
        <template #default="scope">
          <el-button size="small" @click="openEdit(scope.row)">编辑</el-button>
          <el-button size="small" type="danger" @click="onDelete(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div style="display:flex;justify-content:flex-end;margin-top:12px;">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="query.pageSize"
        :current-page="query.page"
        @current-change="onPageChange"
      />
    </div>
  </el-card>

  <el-dialog
    v-model="dialogVisible"
    :title="editing ? '编辑手写稿' : '新建手写稿'"
    width="80%"
    style="max-width:1080px;"
    top="6vh"
    append-to-body
    destroy-on-close
  >
    <el-form :model="form" label-width="96px" class="article-form">
      <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
      <el-form-item label="摘要"><el-input v-model="form.summary" type="textarea" :rows="3" /></el-form-item>
      <el-form-item label="正文">
        <ArticleRichEditor v-model="form.content" :max-images="MAX_BODY_IMAGES" />
      </el-form-item>
      <el-form-item label="来源/栏目"><el-input v-model="form.newsSite" placeholder="列表角标，如 官方" /></el-form-item>
      <el-form-item label="作者"><el-input v-model="form.author" placeholder="留空则显示「火星探索日志」" /></el-form-item>
      <el-form-item label="外链"><el-input v-model="form.url" placeholder="可选" /></el-form-item>
      <el-form-item label="权重"><el-input-number v-model="form.weight" :min="0" :max="9999" /></el-form-item>
      <el-form-item label="发布">
        <el-switch v-model="form.published" />
        <el-text type="info" size="small" style="margin-left:12px;">发布时间将使用此刻保存的时间</el-text>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="previewVisible" title="预览" width="860px">
    <div style="display:flex;justify-content:center">
      <img v-if="previewCurrent" :src="previewCurrent" style="max-width:100%;max-height:70vh;object-fit:contain" />
    </div>
  </el-dialog>
</template>

<style scoped>
.article-form :deep(.el-dialog__body) {
  padding-top: 12px;
}

.article-form .el-form-item {
  margin-bottom: 18px;
}
</style>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import ArticleRichEditor from '../components/ArticleRichEditor.vue'

const MAX_BODY_IMAGES = 5

function extractImagesFromHtml(html) {
  const imgs = []
  const re = /<img[^>]+src=["']([^"']+)["']/gi
  let m
  const s = html || ''
  while ((m = re.exec(s)) !== null) {
    const u = (m[1] || '').trim()
    if (u && !imgs.includes(u)) imgs.push(u)
    if (imgs.length >= MAX_BODY_IMAGES) break
  }
  return imgs
}

const list = ref([])
const total = ref(0)
const saving = ref(false)
const dialogVisible = ref(false)
const previewVisible = ref(false)
const previewCurrent = ref('')
const editing = ref(null)

const query = reactive({ page: 1, pageSize: 20, keyword: '', published: '' })
const form = reactive({
  title: '',
  summary: '',
  content: '',
  newsSite: '',
  author: '',
  publishedAt: '',
  image: '',
  images: [],
  url: '',
  weight: 0,
  published: false
})

const manualEnabled = ref(false)
const configSaving = ref(false)

const resetForm = () => {
  Object.assign(form, {
    title: '',
    summary: '',
    content: '',
    newsSite: '',
    author: '',
    publishedAt: '',
    image: '',
    images: [],
    url: '',
    weight: 0,
    published: false
  })
}

const loadManualConfig = async () => {
  try {
    const d = await api.getNewsManualConfig()
    manualEnabled.value = !!(d && d.enabled)
  } catch (e) {
    manualEnabled.value = false
  }
}

const saveManualConfig = async () => {
  configSaving.value = true
  try {
    await api.updateNewsManualConfig({ enabled: manualEnabled.value })
    ElMessage.success('开关已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
    await loadManualConfig()
  } finally {
    configSaving.value = false
  }
}

const load = async () => {
  const data = await api.listArticles(query)
  list.value = data.list || []
  total.value = data.total || 0
}

const onPageChange = (page) => {
  query.page = page
  load()
}

const openCreate = () => {
  editing.value = null
  resetForm()
  dialogVisible.value = true
}

const openEdit = (row) => {
  editing.value = row
  Object.assign(form, {
    title: row.title || '',
    summary: row.summary || '',
    content: row.content || '',
    newsSite: row.newsSite || '',
    author: row.author || '',
    publishedAt: row.publishedAt || '',
    image: row.image || '',
    images: Array.isArray(row.images) ? row.images.slice() : [],
    url: row.url || '',
    weight: Number(row.weight || 0),
    published: !!row.published
  })
  dialogVisible.value = true
}

const openPreview = (url) => {
  previewCurrent.value = url
  previewVisible.value = true
}

const onSubmit = async () => {
  saving.value = true
  try {
    const imgs = extractImagesFromHtml(form.content)
    if (imgs.length > MAX_BODY_IMAGES) {
      ElMessage.error(`正文插图不能超过 ${MAX_BODY_IMAGES} 张`)
      return
    }
    form.images = imgs
    form.image = imgs[0] || ''

    if (form.published && !form.publishedAt) {
      form.publishedAt = new Date().toISOString()
    }
    if (editing.value?._id || editing.value?.id) {
      await api.updateArticle(editing.value._id || editing.value.id, form)
    } else {
      await api.createArticle(form)
    }
    ElMessage.success('保存成功')
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
    await ElMessageBox.confirm('确认删除该条 Article 吗？', '提示', { type: 'warning' })
    await api.deleteArticle(row._id || row.id)
    ElMessage.success('删除成功')
    await load()
  } catch (e) {}
}

onMounted(async () => {
  await loadManualConfig()
  await load()
})
</script>
