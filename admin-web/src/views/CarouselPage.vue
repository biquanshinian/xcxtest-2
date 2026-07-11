<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="display:flex;align-items:center;gap:16px;">
          <span>轮播图管理</span>
          <el-switch v-model="globalEnabled" @change="onToggleGlobal" :loading="globalLoading" active-text="已启用" inactive-text="已关闭" />
          <el-tag v-if="autoCount > 0" type="warning" size="small">自动 {{ autoCount }}/10</el-tag>
        </div>
        <div style="display:flex;gap:8px;">
          <el-button :loading="syncing" @click="onSyncAuto">同步推文视频</el-button>
          <el-button type="primary" @click="openCreate">新建</el-button>
        </div>
      </div>
    </template>

    <el-table :data="list" stripe>
      <el-table-column label="预览" width="100">
        <template #default="scope">
          <video v-if="scope.row.type === 'video' && scope.row.url" :src="scope.row.url" style="width:60px;height:36px;object-fit:cover;border-radius:4px;cursor:pointer;" muted @click="openPreview(scope.row.url, scope.row.type)" />
          <img v-else-if="scope.row.url" :src="scope.row.url" style="width:60px;height:36px;object-fit:cover;border-radius:4px;cursor:pointer;" @click="openPreview(scope.row.url, scope.row.type)" />
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column prop="key" label="Key" min-width="240" />
      <el-table-column label="类型" width="80">
        <template #default="scope">
          <el-tag :type="scope.row.type === 'video' ? 'danger' : ''" size="small">{{ scope.row.type === 'video' ? '视频' : '图片' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="120">
        <template #default="scope">
          <el-tag v-if="scope.row.sourceTag === 'auto-carousel'" type="warning" size="small">自动（推文）</el-tag>
          <el-tag v-else type="success" size="small">手动</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="sort" label="排序" width="80" />
      <el-table-column label="启用" width="80">
        <template #default="scope">
          <el-tag :type="scope.row.enabled ? 'success' : 'info'">{{ scope.row.enabled ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220">
        <template #default="scope">
          <el-button v-if="scope.row.sourceTag !== 'auto-carousel'" size="small" @click="openEdit(scope.row)">编辑</el-button>
          <el-button size="small" type="danger" @click="onDelete(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editing ? '编辑轮播' : '新建轮播'" width="640px">
    <el-form :model="form" label-width="100px">
      <el-form-item label="Key">
        <el-input v-model="form.key" placeholder="如：轮播图4.jpg（会自动加前缀 首页轮播图/）" />
        <div style="font-size:12px;color:var(--t-text-muted,#999);margin-top:4px;">
          小程序通过此 Key 解析图片，格式为 <code>首页轮播图/文件名</code>
        </div>
      </el-form-item>
      <el-form-item label="轮播图片">
        <CosUpload v-model="form.url" path-prefix="首页轮播图/" accept="image/*" button-text="上传图片" placeholder="图片 COS URL" />
      </el-form-item>
      <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" :max="9999" /></el-form-item>
      <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="previewVisible" title="预览" width="860px">
    <div style="display:flex;justify-content:center">
      <video v-if="previewType === 'video' && previewUrl" :src="previewUrl" controls autoplay style="max-width:100%;max-height:70vh;" />
      <img v-else-if="previewUrl" :src="previewUrl" style="max-width:100%;max-height:70vh;object-fit:contain" />
    </div>
  </el-dialog>
</template>

<script setup>
import { onMounted, reactive, ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import CosUpload from '../components/CosUpload.vue'

const list = ref([])
const dialogVisible = ref(false)
const previewVisible = ref(false)
const previewUrl = ref('')
const previewType = ref('image')
const editing = ref(null)
const saving = ref(false)
const globalEnabled = ref(true)
const globalLoading = ref(false)
const syncing = ref(false)

const autoCount = computed(() => list.value.filter(r => r.sourceTag === 'auto-carousel').length)

const form = reactive({
  key: '',
  url: '',
  sort: 0,
  enabled: true
})

const resetForm = () => {
  Object.assign(form, { key: '', url: '', sort: 0, enabled: true })
}

const load = async () => {
  list.value = await api.listCarousel()
}

const openCreate = () => {
  editing.value = null
  resetForm()
  dialogVisible.value = true
}

const openEdit = (row) => {
  editing.value = row
  Object.assign(form, {
    key: row.key || '',
    url: row.url || '',
    sort: Number(row.sort || 0),
    enabled: !!row.enabled
  })
  dialogVisible.value = true
}

const openPreview = (url, type) => {
  previewUrl.value = url
  previewType.value = type || 'image'
  previewVisible.value = true
}

const onSubmit = async () => {
  if (!form.key && !form.url) {
    ElMessage.warning('请填写 Key 或上传图片')
    return
  }
  saving.value = true
  try {
    if (editing.value?._id || editing.value?.id) {
      await api.updateCarousel(editing.value._id || editing.value.id, { ...form })
    } else {
      await api.createCarousel({ ...form })
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
    await ElMessageBox.confirm('确认删除该条轮播吗？', '提示', { type: 'warning' })
    await api.deleteCarousel(row._id || row.id)
    ElMessage.success('删除成功')
    await load()
  } catch (e) {}
}

const loadGlobalEnabled = async () => {
  try {
    const res = await api.getCarouselGlobalEnabled()
    globalEnabled.value = res.enabled !== false
  } catch (e) {}
}

const onToggleGlobal = async (val) => {
  globalLoading.value = true
  try {
    await api.setCarouselGlobalEnabled({ enabled: val })
    ElMessage.success(val ? '轮播图已启用' : '轮播图已关闭')
  } catch (e) {
    globalEnabled.value = !val
    ElMessage.error('操作失败')
  } finally {
    globalLoading.value = false
  }
}

const onSyncAuto = async () => {
  syncing.value = true
  try {
    const res = await api.syncAutoCarousel()
    const msg = res && res.ok !== false
      ? `同步完成：新增 ${res.added || 0}，移除 ${res.removed || 0}，当前自动 ${res.currentAutoCount || 0} 条`
      : '同步失败: ' + (res?.error || '未知错误')
    ElMessage.success(msg)
    await load()
  } catch (e) {
    ElMessage.error('同步失败: ' + (e.message || '未知错误'))
  } finally {
    syncing.value = false
  }
}

onMounted(() => {
  load()
  loadGlobalEnabled()
})
</script>
