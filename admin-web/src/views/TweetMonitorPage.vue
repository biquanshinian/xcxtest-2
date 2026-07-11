<template>
  <!-- 追踪账号管理 -->
  <el-card class="tm-card" style="margin-bottom:12px;">
    <template #header>
      <div class="tm-header">
        <div class="tm-header-left">
          <span class="tm-title">追踪账号管理</span>
          <span class="tm-subtle">{{ accounts.length }} 个账号 · {{ enabledAccountCount }} 启用</span>
        </div>
        <el-button type="primary" size="small" @click="showAddDialog = true">添加账号</el-button>
      </div>
    </template>
    <div v-loading="accountsLoading" class="tm-account-grid">
      <div
        v-for="row in accounts"
        :key="row._id"
        class="tm-account-chip"
        :class="{ 'is-disabled': !row.enabled }"
      >
        <el-avatar :size="28" :src="row.avatarCosUrl || row.avatarUrl" v-if="row.avatarCosUrl || row.avatarUrl" />
        <el-avatar :size="28" v-else>{{ (row.label || '?')[0] }}</el-avatar>
        <div class="tm-account-info">
          <div class="tm-account-name">{{ row.label || row.screenName }}</div>
          <div class="tm-account-handle">@{{ row.screenName }}</div>
        </div>
        <el-switch v-model="row.enabled" size="small" @change="onToggleAccount(row)" />
        <el-button class="tm-account-del" type="danger" size="small" link @click="onDeleteAccount(row)">删除</el-button>
      </div>
      <el-empty v-if="!accountsLoading && !accounts.length" description="暂无追踪账号" :image-size="56" />
    </div>

    <el-dialog v-model="showAddDialog" title="添加追踪账号" width="400px">
      <el-form label-width="80px">
        <el-form-item label="账号">
          <el-input v-model="newAccount.screenName" placeholder="Twitter/X handle，如 elonmusk" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="newAccount.label" placeholder="可选，如 Elon Musk" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="onAddAccount" :loading="addLoading">添加</el-button>
      </template>
    </el-dialog>
  </el-card>

  <!-- 推文同步监控 -->
  <el-card class="tm-card">
    <template #header>
      <div class="tm-header">
        <div class="tm-header-left">
          <span class="tm-title">推文同步监控</span>
          <el-tag :type="syncStatus.lastSyncAt ? 'success' : 'info'" size="small" effect="dark" round>
            {{ syncStatus.lastSyncAt ? `上次同步 ${fmt(syncStatus.lastSyncAt)}` : '尚未同步' }}
          </el-tag>
          <el-tag size="small" effect="plain" round>自动同步 {{ syncStatus.totalAutoSynced ?? 0 }}</el-tag>
          <el-tag v-if="syncStatus.lastItem" size="small" effect="plain" round>
            最新：{{ truncate(syncStatus.lastItem?.title || syncStatus.lastItem?.id, 30) }}
          </el-tag>
        </div>
        <div class="tm-header-actions">
          <el-select v-model="query.source" placeholder="来源" size="small" clearable style="width:120px" @change="load">
            <el-option label="全部" value="" />
            <el-option label="auto_sync" value="auto_sync" />
            <el-option label="manual" value="manual" />
          </el-select>
          <el-button size="small" @click="load">刷新</el-button>
          <el-button type="primary" size="small" @click="onTriggerSync" :loading="syncLoading">触发同步</el-button>
        </div>
      </div>
    </template>

    <el-table :data="list" v-loading="loading" size="small">
      <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
      <el-table-column label="内容" min-width="280" show-overflow-tooltip>
        <template #default="scope">{{ truncate(scope.row.content, 80) }}</template>
      </el-table-column>
      <el-table-column prop="source" label="来源" width="110" />
      <el-table-column prop="status" label="状态" width="90" />
      <el-table-column label="发布时间" width="170">
        <template #default="scope">{{ fmt(scope.row.publishedAt) }}</template>
      </el-table-column>
      <el-empty v-if="!loading && !list.length" description="暂无推文数据" :image-size="56" />
    </el-table>

    <div style="display:flex;justify-content:flex-end;margin-top:8px;">
      <el-pagination
        background
        small
        layout="total, prev, pager, next"
        :total="total"
        :page-size="query.pageSize"
        :current-page="query.page"
        @current-change="onPageChange"
      />
    </div>
  </el-card>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const fmt = (t) => (t ? new Date(t).toLocaleString() : '-')
const truncate = (str, len) => {
  if (!str) return '-'
  const s = String(str)
  return s.length > len ? s.slice(0, len) + '...' : s
}

// 追踪账号管理
const accounts = ref([])
const accountsLoading = ref(false)
const showAddDialog = ref(false)
const addLoading = ref(false)
const newAccount = reactive({ screenName: '', label: '' })

const enabledAccountCount = computed(() => accounts.value.filter(a => a.enabled).length)

const loadAccounts = async () => {
  accountsLoading.value = true
  try {
    const data = await api.listTweetAccounts()
    accounts.value = data || []
  } catch (e) {
    ElMessage.error('加载账号列表失败')
  } finally {
    accountsLoading.value = false
  }
}

const onAddAccount = async () => {
  if (!newAccount.screenName.trim()) return ElMessage.warning('请输入账号')
  addLoading.value = true
  try {
    await api.addTweetAccount({ screenName: newAccount.screenName.trim(), label: newAccount.label.trim() })
    ElMessage.success('添加成功')
    showAddDialog.value = false
    newAccount.screenName = ''
    newAccount.label = ''
    await loadAccounts()
  } catch (e) {
    ElMessage.error(e.message || '添加失败')
  } finally {
    addLoading.value = false
  }
}

const onDeleteAccount = async (row) => {
  try {
    await ElMessageBox.confirm(`确定删除 @${row.screenName}？`, '删除确认', { type: 'warning' })
    await api.deleteTweetAccount(row._id)
    ElMessage.success('已删除')
    await loadAccounts()
  } catch {}
}

const onToggleAccount = async (row) => {
  try {
    await api.toggleTweetAccount(row._id, row.enabled)
    ElMessage.success(row.enabled ? '已启用' : '已禁用')
  } catch (e) {
    row.enabled = !row.enabled
    ElMessage.error('操作失败')
  }
}

const list = ref([])
const total = ref(0)
const loading = ref(false)
const syncLoading = ref(false)
const syncStatus = reactive({ lastSyncAt: null, totalAutoSynced: null, lastItem: null })

const query = reactive({ source: '', page: 1, pageSize: 20 })

const load = async () => {
  loading.value = true
  try {
    const data = await api.listTweetMonitor(query)
    list.value = data.list || []
    total.value = data.total || 0
  } catch (e) {
    ElMessage.error(e.message || '加载数据失败')
  } finally {
    loading.value = false
  }
}

const loadStatus = async () => {
  try {
    const data = await api.getTweetSyncStatus()
    syncStatus.lastSyncAt = data.lastSyncAt ?? null
    syncStatus.totalAutoSynced = data.totalAutoSynced ?? null
    syncStatus.lastItem = data.lastItem ?? null
  } catch (e) {}
}

const onPageChange = (page) => {
  query.page = page
  load()
}

const onTriggerSync = async () => {
  syncLoading.value = true
  try {
    await api.syncTweets()
    ElMessage.success('同步已触发')
    loadStatus()
    load()
  } catch (e) {
    ElMessage.error(e.message || '同步失败')
  } finally {
    syncLoading.value = false
  }
}

onMounted(() => {
  loadAccounts()
  loadStatus()
  load()
})
</script>

<style scoped>
.tm-card :deep(.el-card__header) {
  padding: 12px 16px;
}
.tm-card :deep(.el-card__body) {
  padding: 12px 16px 14px;
}
.tm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.tm-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.tm-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.tm-title {
  font-size: 15px;
  font-weight: 600;
}
.tm-subtle {
  font-size: 12px;
  color: var(--cx-text-3, rgba(255,255,255,0.5));
}

/* 账号 chip 网格 */
.tm-account-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
}
.tm-account-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.02);
  transition: border-color .15s, background .15s;
}
.tm-account-chip:hover {
  border-color: rgba(139,92,246,0.35);
  background: rgba(139,92,246,0.05);
}
.tm-account-chip.is-disabled {
  opacity: 0.55;
}
.tm-account-info {
  flex: 1;
  min-width: 0;
}
.tm-account-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tm-account-handle {
  font-size: 11px;
  color: var(--cx-text-3, rgba(255,255,255,0.5));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tm-account-del {
  padding: 0 6px !important;
  height: 22px !important;
  font-size: 12px;
}
</style>
