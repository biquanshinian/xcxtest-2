<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <span>缓存管理</span>
        <div style="display:flex;gap:8px;">
          <el-button @click="reload">刷新</el-button>
          <el-button type="danger" @click="onCleanAll">清理全部缓存</el-button>
        </div>
      </div>
    </template>

    <!-- Summary row -->
    <div class="cache-summary">
      <el-text type="info">
        缓存条数：<strong>{{ total }}</strong>
        预估总大小：<strong>{{ formatKB(estimatedTotalSize) }}</strong>
      </el-text>
    </div>

    <!-- Filter row -->
    <div class="cache-filters">
      <el-select v-model="query.type" placeholder="类型筛选" clearable style="width:160px;" @change="reload">
        <el-option label="全部" value="" />
        <el-option label="空值" value="empty" />
        <el-option label="upcoming" value="upcoming" />
        <el-option label="completed" value="completed" />
        <el-option label="previous" value="previous" />
      </el-select>
      <el-select v-model="query.pageSize" placeholder="每页条数" style="width:120px;" @change="onPageSizeChange">
        <el-option :label="10" :value="10" />
        <el-option :label="20" :value="20" />
        <el-option :label="50" :value="50" />
        <el-option :label="100" :value="100" />
      </el-select>
    </div>

    <el-table :data="list" v-loading="loading" stripe empty-text="暂无缓存数据">
      <el-table-column label="名称" prop="name" min-width="200" />
      <el-table-column label="类型" width="120">
        <template #default="{ row }">
          <el-tag size="small">{{ row.type || '-' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="数据大小" width="120">
        <template #default="{ row }">
          {{ formatKB(row.dataSize) }}
        </template>
      </el-table-column>
      <el-table-column label="更新时间" width="180">
        <template #default="{ row }">
          {{ fmt(row.updatedAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div style="margin-top:16px;display:flex;justify-content:flex-end;">
      <el-pagination
        v-model:current-page="query.page"
        :page-size="query.pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="reload"
        @size-change="onPageSizeChange"
      />
    </div>
  </el-card>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const fmt = (t) => (t ? new Date(t).toLocaleString() : '-')

function formatKB(size) {
  if (size == null || size === undefined) return '0 KB'
  return (size / 1024).toFixed(1) + ' KB'
}

const loading = ref(false)
const list = ref([])
const total = ref(0)
const query = reactive({
  page: 1,
  pageSize: 20,
  type: ''
})

const estimatedTotalSize = ref(0)

async function reload() {
  loading.value = true
  try {
    const q = {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.type ? { type: query.type } : {})
    }
    const data = await api.listCacheEntries(q)
    list.value = data.list || []
    total.value = data.total ?? 0
    estimatedTotalSize.value = data.totalSize ?? (data.list || []).reduce((sum, it) => sum + (it.dataSize || 0), 0)
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function onPageSizeChange() {
  query.page = 1
  reload()
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除缓存 "${row.name || row._id}" 吗？`, '确认删除', { type: 'warning' })
    await api.deleteCacheEntry(row._id)
    ElMessage.success('已删除')
    reload()
  } catch (e) {
    if (e !== 'cancel' && e?.action !== 'cancel' && e?.message !== 'cancel') {
      ElMessage.error(e.message || '删除失败')
    }
  }
}

async function onCleanAll() {
  try {
    await ElMessageBox.confirm('确认清理全部缓存？此操作不可撤销。', '确认清理', { type: 'warning' })
    await api.cleanAllCache()
    ElMessage.success('已清理全部缓存')
    reload()
  } catch (e) {
    if (e !== 'cancel' && e?.action !== 'cancel' && e?.message !== 'cancel') {
      ElMessage.error(e.message || '清理失败')
    }
  }
}

onMounted(reload)
</script>

<style scoped>
.cache-summary {
  padding: 12px 16px;
  margin-bottom: 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.cache-summary strong {
  margin-right: 16px;
}

.cache-filters {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
</style>
