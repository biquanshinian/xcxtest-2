<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span>星舰状态管理</span>
        <div style="display:flex;align-items:center;gap:16px;">
          <el-tooltip content="开启后，云端每 6 小时从 Next Spaceflight 自动跟进当前飞船/助推器的编号、状态与主图；关闭则完全手动维护" placement="bottom">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:13px;opacity:0.75;">NSF 自动跟进</span>
              <el-switch v-model="nsfAutoSync" />
            </div>
          </el-tooltip>
          <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
        </div>
      </div>
    </template>

    <el-tabs v-model="activeTab">
      <!-- Booster Tab -->
      <el-tab-pane label="Booster (助推器)" name="booster">
        <StarshipNodeForm v-model="form.booster" label="助推器" />
      </el-tab-pane>

      <!-- Ship Tab -->
      <el-tab-pane label="Ship (星舰)" name="ship">
        <StarshipNodeForm v-model="form.ship" label="星舰" />
      </el-tab-pane>

      <!-- 进度页：LL2 时间线 + 星舰动态追踪 + NSF（封路下方） -->
      <el-tab-pane label="进度页 LL2 / 清单" name="flight-readiness">
        <el-divider content-position="left">Launch Library</el-divider>
        <el-form label-width="140px" style="max-width:860px;margin-bottom:20px;">
          <el-form-item label="跟踪发射 UUID">
            <el-input v-model="ll2TrackedLaunchId" placeholder="留空自动跟踪" clearable />
          </el-form-item>
          <el-form-item label="显示 LL2 区块">
            <el-switch v-model="showLaunchLibraryUpdates" />
          </el-form-item>
        </el-form>
        <el-divider content-position="left">Next Spaceflight 清单</el-divider>
        <p v-if="nsfMeta.fetchError" style="color:var(--el-color-danger);font-size:13px;margin:0 0 12px;">
          抓取异常：{{ nsfMeta.fetchError }}
        </p>
        <el-alert
          v-if="nsfMeta.parserMeta && nsfMeta.parserMeta.ok !== false && nsfMeta.parserMeta.strategy"
          type="success"
          :closable="false"
          :show-icon="false"
          class="nsf-status-card nsf-status-card--ok"
          style="max-width:960px;margin-bottom:12px;"
        >
          <div class="nsf-status-row">
            <div class="nsf-status-icon nsf-status-icon--ok">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
            </div>
            <div class="nsf-status-body">
              <div class="nsf-status-title">解析正常</div>
              <div class="nsf-status-meta">
                <code class="nsf-status-strategy">{{ nsfMeta.parserMeta.strategy }}</code>
                <span class="nsf-status-flow">
                  原始 <strong>{{ nsfMeta.parserMeta.matchedRawCount }}</strong>
                  <span class="nsf-status-arrow">→</span>
                  入库 <strong>{{ nsfMeta.parserMeta.enrichedCount }}</strong>
                </span>
              </div>
            </div>
          </div>
        </el-alert>
        <el-alert
          v-else-if="nsfMeta.parserMeta && nsfMeta.parserMeta.ok === false"
          type="error"
          :closable="false"
          :show-icon="false"
          class="nsf-status-card nsf-status-card--err"
          style="max-width:960px;margin-bottom:12px;"
        >
          <div class="nsf-status-row">
            <div class="nsf-status-icon nsf-status-icon--err">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2 1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z"/></svg>
            </div>
            <div class="nsf-status-body">
              <div class="nsf-status-title">解析失败</div>
              <div class="nsf-status-meta">{{ nsfMeta.parserMeta.error || '未知错误' }}</div>
            </div>
          </div>
        </el-alert>
        <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;">
          <el-button size="small" @click="loadNsfChecklist" :loading="nsfLoading">刷新</el-button>
          <el-button type="primary" size="small" @click="saveNsfOverrides" :loading="nsfSaving">保存</el-button>
          <span v-if="nsfMeta.sourceLastFetch" style="font-size:12px;opacity:0.65;">更新：{{ nsfMeta.sourceLastFetch }}</span>
          <span v-if="nsfMeta.overridesUpdatedAtMs" style="font-size:12px;opacity:0.65;">
            覆盖：{{ formatTime(nsfMeta.overridesUpdatedAtMs) }}{{ nsfMeta.overridesUpdatedBy ? ' · ' + nsfMeta.overridesUpdatedBy : '' }}
          </span>
        </div>
        <el-table :data="nsfRows" stripe v-loading="nsfLoading" style="max-width:960px;margin-bottom:20px;" empty-text="暂无数据">
          <el-table-column prop="id" label="ID" width="72" />
          <el-table-column prop="titleEn" label="英文原文" min-width="180" show-overflow-tooltip />
          <el-table-column label="中文显示" min-width="220">
            <template #default="scope">
              <el-input v-model="scope.row.titleZh" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" placeholder="" />
            </template>
          </el-table-column>
          <el-table-column label="抓取" width="90">
            <template #default="scope">
              <el-tag :type="scope.row.doneWeb ? 'success' : 'info'" size="small">{{ scope.row.doneWeb ? '是' : '否' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="手动勾选" width="156">
            <template #default="scope">
              <el-select v-model="scope.row.manualMode" size="small" style="width:148px">
                <el-option label="跟随抓取" value="follow" />
                <el-option label="标为已完成" value="force_true" />
                <el-option label="标为未完成" value="force_false" />
              </el-select>
            </template>
          </el-table-column>
        </el-table>
        <el-divider content-position="left">人工飞行检查清单</el-divider>
        <div style="margin-bottom:16px;">
          <el-button type="primary" size="small" @click="addFlightReadinessItem">添加条目</el-button>
        </div>
        <draggable
          v-if="flightReadinessChecklist.length"
          v-model="flightReadinessChecklist"
          item-key="id"
          handle=".flight-readiness-drag-handle"
          :animation="200"
        >
          <template #item="{ element: row, index }">
            <el-card shadow="never" class="checklist-card" :key="row.id" style="margin-bottom:12px;border-left:3px solid #67C23A">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <span class="flight-readiness-drag-handle" style="cursor:grab;margin-right:8px;font-size:18px;user-select:none">⠿</span>
                <strong style="flex:1;color:var(--el-text-color-primary)">条目 {{ index + 1 }}</strong>
                <el-button type="danger" size="small" text @click="removeFlightReadinessItem(index)">删除</el-button>
              </div>
              <el-form label-width="100px">
                <el-form-item label="标题">
                  <el-input v-model="row.title" />
                </el-form-item>
                <el-form-item label="分组">
                  <el-input v-model="row.category" />
                </el-form-item>
                <el-form-item label="已完成">
                  <el-switch v-model="row.done" />
                </el-form-item>
                <el-form-item label="详情链接">
                  <el-input v-model="row.detailUrl" />
                </el-form-item>
              </el-form>
            </el-card>
          </template>
        </draggable>
        <el-empty v-if="!flightReadinessChecklist.length" description="暂无条目" :image-size="60" />
      </el-tab-pane>

      <!-- Checklist History Tab -->
      <el-tab-pane label="清单历史" name="history">
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <el-select v-model="historyFilter" style="width:160px" @change="loadHistory">
            <el-option label="全部" value="" />
            <el-option label="Booster 助推器" value="booster" />
            <el-option label="Ship 星舰" value="ship" />
          </el-select>
          <el-button @click="loadHistory">刷新</el-button>
        </div>

        <el-table :data="historyList" stripe v-loading="historyLoading">
          <el-table-column label="类型" width="120">
            <template #default="scope">
              <el-tag :type="scope.row.type === 'ship' ? 'primary' : 'warning'" size="small">
                {{ scope.row.type === 'ship' ? '星舰' : '助推器' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="vehicleId" label="编号" width="100" />
          <el-table-column prop="statusText" label="当时状态" width="100" />
          <el-table-column label="清单项数" width="90">
            <template #default="scope">{{ (scope.row.checklist || []).length }} 项</template>
          </el-table-column>
          <el-table-column label="清单内容" min-width="280">
            <template #default="scope">
              <div v-for="(c, i) in (scope.row.checklist || []).slice(0, 3)" :key="i" style="font-size:12px;line-height:1.6;">
                {{ i + 1 }}. {{ c.title || '(无标题)' }}<span v-if="c.date" style="opacity:0.6;margin-left:4px;">{{ c.date }}</span>
              </div>
              <div v-if="(scope.row.checklist || []).length > 3" style="font-size:12px;opacity:0.5;">
                ...还有 {{ scope.row.checklist.length - 3 }} 项
              </div>
            </template>
          </el-table-column>
          <el-table-column label="归档时间" width="170">
            <template #default="scope">{{ formatTime(scope.row.archivedAt) }}</template>
          </el-table-column>
          <el-table-column prop="archivedBy" label="操作人" width="100" />
          <el-table-column label="操作" width="160">
            <template #default="scope">
              <el-button size="small" @click="restoreChecklist(scope.row)">恢复</el-button>
              <el-button size="small" type="danger" @click="deleteHistory(scope.row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="historyTotal > historyPageSize" style="margin-top:12px;display:flex;justify-content:center;">
          <el-pagination
            v-model:current-page="historyPage"
            :page-size="historyPageSize"
            :total="historyTotal"
            layout="prev, pager, next"
            @current-change="loadHistory"
          />
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<script setup>
import { defineComponent, h, onMounted, reactive, ref, watch, toRaw } from 'vue'
import { ElMessage, ElMessageBox, ElAlert, ElButton, ElForm, ElFormItem, ElInput, ElInputNumber, ElSelect, ElOption, ElSwitch, ElDivider, ElCard, ElEmpty, ElRow, ElCol } from 'element-plus'
import { api } from '../api/client'
import CosUpload from '../components/CosUpload.vue'
import draggable from 'vuedraggable'

const StarshipNodeForm = defineComponent({
  name: 'StarshipNodeForm',
  props: {
    modelValue: { type: Object, default: () => ({}) },
    label: { type: String, default: '' }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const node = reactive(normalizeNode(props.modelValue))

    watch(() => props.modelValue, (val) => {
      if (!val) return
      const fresh = normalizeNode(val)
      Object.keys(fresh).forEach(k => {
        if (k === 'detail') {
          Object.keys(fresh.detail).forEach(dk => {
            node.detail[dk] = fresh.detail[dk]
          })
        } else {
          node[k] = fresh[k]
        }
      })
    }, { deep: true })

    function sync() {
      emit('update:modelValue', JSON.parse(JSON.stringify(node)))
    }

    function addChecklistItem() {
      node.detail.checklist.push({ id: `item_${Date.now()}`, title: '', location: '', date: '', description: '', status: 'normal' })
      sync()
    }

    function removeChecklistItem(index) {
      node.detail.checklist.splice(index, 1)
      sync()
    }

    return () => h(ElForm, { modelValue: node, labelWidth: '90px', style: 'max-width:1080px' }, () => [
      h(ElDivider, { contentPosition: 'left' }, () => '基本信息'),
      h(ElRow, { gutter: 16 }, () => [
        h(ElCol, { span: 8 }, () =>
          h(ElFormItem, { label: '编号' }, () =>
            h(ElInput, { modelValue: node.id, 'onUpdate:modelValue': v => { node.id = v; sync() }, placeholder: '如 B19、S39' })
          )
        ),
        h(ElCol, { span: 8 }, () =>
          h(ElFormItem, { label: '状态' }, () =>
            h(ElSelect, { modelValue: node.status, 'onUpdate:modelValue': v => { node.status = v; sync() }, style: 'width:100%', filterable: true, allowCreate: true }, () => [
              h(ElOption, { label: 'ACTIVE', value: 'ACTIVE' }),
              h(ElOption, { label: 'In Production', value: 'In Production' }),
              h(ElOption, { label: 'DESTROYED', value: 'DESTROYED' }),
              h(ElOption, { label: 'EXPENDED', value: 'EXPENDED' }),
              h(ElOption, { label: 'RETIRED', value: 'RETIRED' })
            ])
          )
        ),
        h(ElCol, { span: 8 }, () =>
          h(ElFormItem, { label: '进度' }, () =>
            h(ElInputNumber, { modelValue: node.progress, 'onUpdate:modelValue': v => { node.progress = v; sync() }, min: 0, max: 100, style: 'width:100%' })
          )
        )
      ]),

      h(ElDivider, { contentPosition: 'left' }, () => '图片'),
      h(ElRow, { gutter: 16 }, () => [
        h(ElCol, { span: 12 }, () =>
          h(ElFormItem, { label: '主图' }, () =>
            h(CosUpload, { modelValue: node.image, 'onUpdate:modelValue': v => { node.image = v; sync() }, pathPrefix: 'admin-uploads/starship/', accept: 'image/*', buttonText: '上传主图', placeholder: '卡片展示图URL' })
          )
        ),
        h(ElCol, { span: 12 }, () =>
          h(ElFormItem, { label: '头图' }, () =>
            h(CosUpload, { modelValue: node.detail.heroImage, 'onUpdate:modelValue': v => { node.detail.heroImage = v; sync() }, pathPrefix: 'admin-uploads/starship/', accept: 'image/*', buttonText: '上传头图', placeholder: '弹窗头图URL' })
          )
        )
      ]),

      h(ElDivider, { contentPosition: 'left' }, () => '详情弹窗'),
      h(ElRow, { gutter: 16 }, () => [
        h(ElCol, { span: 8 }, () =>
          h(ElFormItem, { label: '标题' }, () =>
            h(ElInput, { modelValue: node.detail.title, 'onUpdate:modelValue': v => { node.detail.title = v; sync() }, placeholder: '助推器19、星舰39' })
          )
        ),
        h(ElCol, { span: 8 }, () =>
          h(ElFormItem, { label: '副标题' }, () =>
            h(ElInput, { modelValue: node.detail.subtitle, 'onUpdate:modelValue': v => { node.detail.subtitle = v; sync() }, placeholder: 'SUPER HEAVY、STARSHIP' })
          )
        ),
        h(ElCol, { span: 8 }, () =>
          h(ElFormItem, { label: '状态文本' }, () =>
            h(ElSelect, { modelValue: node.detail.statusText, 'onUpdate:modelValue': v => { node.detail.statusText = v; sync() }, style: 'width:100%', filterable: true, allowCreate: true }, () => [
              h(ElOption, { label: '活跃', value: '活跃' }),
              h(ElOption, { label: '生产中', value: '生产中' }),
              h(ElOption, { label: '测试中', value: '测试中' }),
              h(ElOption, { label: '待发射', value: '待发射' }),
              h(ElOption, { label: '已发射', value: '已发射' }),
              h(ElOption, { label: '已损毁', value: '已损毁' }),
              h(ElOption, { label: '已消耗', value: '已消耗' }),
              h(ElOption, { label: '已退役', value: '已退役' })
            ])
          )
        )
      ]),
      h(ElFormItem, { label: '摘要' }, () =>
        h(ElInput, { modelValue: node.detail.summary, 'onUpdate:modelValue': v => { node.detail.summary = v; sync() }, type: 'textarea', rows: 3 })
      ),

      h(ElDivider, { contentPosition: 'left' }, () => '清单'),
      h('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:12px;' }, [
        h(ElSwitch, { modelValue: node.detail.showChecklist, 'onUpdate:modelValue': v => { node.detail.showChecklist = v; sync() } }),
        h('span', { style: 'font-size:13px;opacity:0.75;' }, '显示清单'),
        ...(node.detail.showChecklist ? [
          h(ElButton, { type: 'primary', size: 'small', onClick: addChecklistItem }, () => '添加清单项')
        ] : [])
      ]),
      ...(node.detail.showChecklist ? [
        ...(node.detail.checklist && node.detail.checklist.length ? [
          h(draggable, {
            modelValue: node.detail.checklist,
            'onUpdate:modelValue': (val) => {
              node.detail.checklist.splice(0, node.detail.checklist.length, ...val)
              sync()
            },
            itemKey: 'id',
            animation: 200,
            handle: '.checklist-drag-handle'
          }, {
            item: ({ element: item, index }) => h(ElCard, {
              shadow: 'never',
              class: 'checklist-card',
              key: item.id || index,
              style: `border-left: 3px solid ${item.status === 'error' ? '#F56C6C' : item.status === 'warning' ? '#E6A23C' : '#67C23A'};margin-bottom:10px;`,
              bodyStyle: 'padding:12px 14px;'
            }, () =>
              h(ElForm, { labelWidth: '64px' }, () => [
                h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' }, [
                  h('span', { class: 'checklist-drag-handle', style: 'cursor:grab;margin-right:8px;font-size:18px;user-select:none' }, '⠿'),
                  h('strong', { style: 'color:var(--el-text-color-primary);flex:1' }, `#${index + 1}`),
                  h(ElButton, { type: 'danger', size: 'small', text: true, onClick: () => removeChecklistItem(index) }, () => '删除')
                ]),
                h(ElRow, { gutter: 12 }, () => [
                  h(ElCol, { span: 12 }, () =>
                    h(ElFormItem, { label: '标题' }, () =>
                      h(ElInput, { modelValue: item.title, 'onUpdate:modelValue': v => { item.title = v; sync() } })
                    )
                  ),
                  h(ElCol, { span: 6 }, () =>
                    h(ElFormItem, { label: '地点' }, () =>
                      h(ElInput, { modelValue: item.location, 'onUpdate:modelValue': v => { item.location = v; sync() } })
                    )
                  ),
                  h(ElCol, { span: 6 }, () =>
                    h(ElFormItem, { label: '日期' }, () =>
                      h(ElInput, { modelValue: item.date, 'onUpdate:modelValue': v => { item.date = v; sync() } })
                    )
                  )
                ]),
                h(ElRow, { gutter: 12 }, () => [
                  h(ElCol, { span: 18 }, () =>
                    h(ElFormItem, { label: '描述' }, () =>
                      h(ElInput, { modelValue: item.description, 'onUpdate:modelValue': v => { item.description = v; sync() }, type: 'textarea', autosize: { minRows: 1, maxRows: 3 } })
                    )
                  ),
                  h(ElCol, { span: 6 }, () =>
                    h(ElFormItem, { label: '状态' }, () =>
                      h(ElSelect, {
                        modelValue: item.status || 'normal',
                        'onUpdate:modelValue': v => { item.status = v; sync() },
                        style: 'width:100%'
                      }, () => [
                        h(ElOption, { label: '🟢 正常', value: 'normal' }),
                        h(ElOption, { label: '🟠 异常', value: 'warning' }),
                        h(ElOption, { label: '🔴 失败', value: 'error' })
                      ])
                    )
                  )
                ])
              ])
            )
          })
        ] : []),
        ...(!(node.detail.checklist || []).length ? [h(ElEmpty, { description: '暂无清单项', imageSize: 60 })] : [])
      ] : [])
    ])
  }
})

function normalizeNode(raw = {}) {
  return {
    id: raw.id || '',
    status: raw.status || 'ACTIVE',
    progress: Number(raw.progress || 0),
    image: raw.image || '',
    images: Array.isArray(raw.images) ? raw.images : [],
    previewImages: Array.isArray(raw.previewImages) ? raw.previewImages : [],
    thumbnailMediaKey: raw.thumbnailMediaKey || '',
    thumbnailFallback: raw.thumbnailFallback || '',
    detail: {
      title: (raw.detail || {}).title || '',
      subtitle: (raw.detail || {}).subtitle || '',
      statusText: (raw.detail || {}).statusText || '',
      summary: (raw.detail || {}).summary || '',
      heroImage: (raw.detail || {}).heroImage || '',
      heroMediaKey: (raw.detail || {}).heroMediaKey || '',
      heroFallback: (raw.detail || {}).heroFallback || '',
      showChecklist: !!(raw.detail || {}).showChecklist,
      checklist: Array.isArray((raw.detail || {}).checklist) ? (raw.detail || {}).checklist.map(c => ({
        id: c.id || `item_${Math.random().toString(36).slice(2)}`,
        title: c.title || '',
        location: c.location || '',
        date: c.date || '',
        description: c.description || '',
        status: c.status || 'normal'
      })) : []
    }
  }
}

function formatTime(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const activeTab = ref('booster')
const saving = ref(false)

const flightReadinessChecklist = ref([])

const ll2TrackedLaunchId = ref('')
const showLaunchLibraryUpdates = ref(true)
const nsfAutoSync = ref(true)

const nsfRows = ref([])
const nsfLoading = ref(false)
const nsfSaving = ref(false)
const nsfMeta = reactive({
  sourceLastFetch: '',
  fetchError: '',
  overridesUpdatedAtMs: 0,
  overridesUpdatedBy: '',
  parserMeta: null
})

function normalizeFlightReadinessRow(raw = {}, i) {
  return {
    id: raw.id || `fr_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 9)}`,
    title: raw.title || '',
    done: !!raw.done,
    detailUrl: raw.detailUrl || '',
    category: raw.category || ''
  }
}

function normalizeFlightReadinessList(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((r, i) => normalizeFlightReadinessRow(r, i))
}

function addFlightReadinessItem() {
  flightReadinessChecklist.value.push({
    id: `fr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    title: '',
    done: false,
    detailUrl: '',
    category: ''
  })
}

function removeFlightReadinessItem(index) {
  flightReadinessChecklist.value.splice(index, 1)
}

const form = reactive({
  booster: normalizeNode(),
  ship: normalizeNode()
})

const historyList = ref([])
const historyLoading = ref(false)
const historyFilter = ref('')
const historyPage = ref(1)
const historyPageSize = 10
const historyTotal = ref(0)

const load = async () => {
  const data = await api.getStarshipStatus()
  if (data) {
    form.booster = normalizeNode(data.booster)
    form.ship = normalizeNode(data.ship)
    flightReadinessChecklist.value = normalizeFlightReadinessList(data.flightReadinessChecklist)
    ll2TrackedLaunchId.value = typeof data.ll2TrackedLaunchId === 'string' ? data.ll2TrackedLaunchId : ''
    showLaunchLibraryUpdates.value = data.showLaunchLibraryUpdates !== false
    nsfAutoSync.value = data.nsfAutoSync !== false
  }
}

const loadHistory = async () => {
  historyLoading.value = true
  try {
    const res = await api.listChecklistHistory({ type: historyFilter.value, page: historyPage.value, pageSize: historyPageSize })
    historyList.value = res.list || []
    historyTotal.value = res.total || 0
  } catch (e) {
    historyList.value = []
  } finally {
    historyLoading.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'history' && !historyList.value.length) loadHistory()
  if (tab === 'flight-readiness') loadNsfChecklist()
})

const restoreChecklist = async (row) => {
  try {
    await ElMessageBox.confirm(
      `将 ${row.type === 'ship' ? '星舰' : '助推器'}（${row.vehicleId}）的清单恢复为此历史版本（${(row.checklist || []).length} 项），当前清单将被覆盖。确认恢复？`,
      '恢复清单',
      { type: 'warning' }
    )
    const target = row.type === 'ship' ? form.ship : form.booster
    target.detail.checklist = (row.checklist || []).map(c => ({
      id: c.id || `item_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      title: c.title || '',
      location: c.location || '',
      date: c.date || '',
      description: c.description || '',
      status: c.status || 'normal'
    }))
    target.detail.showChecklist = true
    activeTab.value = row.type
    ElMessage.success('清单已恢复到编辑区，请点击"保存"提交')
  } catch (e) {}
}

const deleteHistory = async (row) => {
  try {
    await ElMessageBox.confirm('确认删除此历史记录？', '提示', { type: 'warning' })
    await api.deleteChecklistHistory(row._id)
    ElMessage.success('已删除')
    await loadHistory()
  } catch (e) {}
}

const onSave = async () => {
  saving.value = true
  try {
    await api.updateStarshipStatus({
      booster: JSON.parse(JSON.stringify(form.booster)),
      ship: JSON.parse(JSON.stringify(form.ship)),
      flightReadinessChecklist: JSON.parse(JSON.stringify(flightReadinessChecklist.value)),
      ll2TrackedLaunchId: String(ll2TrackedLaunchId.value || '').trim(),
      showLaunchLibraryUpdates: !!showLaunchLibraryUpdates.value,
      nsfAutoSync: !!nsfAutoSync.value
    })
    ElMessage.success('星舰状态保存成功')
    if (activeTab.value === 'history') loadHistory()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const loadNsfChecklist = async () => {
  nsfLoading.value = true
  try {
    const data = await api.getNsfChecklistAdmin()
    nsfRows.value = (data.items || []).map((r) => ({ ...r }))
    nsfMeta.sourceLastFetch = data.sourceLastFetch || ''
    nsfMeta.fetchError = data.fetchError || ''
    nsfMeta.overridesUpdatedAtMs = data.overridesUpdatedAtMs || 0
    nsfMeta.overridesUpdatedBy = data.overridesUpdatedBy || ''
    nsfMeta.parserMeta = data.parserMeta || null
  } catch (e) {
    ElMessage.error(e.message || '加载 NSF 清单失败')
    nsfRows.value = []
  } finally {
    nsfLoading.value = false
  }
}

const saveNsfOverrides = async () => {
  nsfSaving.value = true
  try {
    await api.updateNsfChecklistOverrides({
      items: nsfRows.value.map((r) => ({
        id: r.id,
        titleZhAuto: r.titleZhAuto,
        titleZh: r.titleZh,
        manualMode: r.manualMode
      }))
    })
    ElMessage.success('已保存覆盖配置')
    await loadNsfChecklist()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    nsfSaving.value = false
  }
}

onMounted(load)
</script>
