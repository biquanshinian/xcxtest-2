<template>
  <div class="tw-edit" v-loading="loading">
    <div class="tw-titlebar">
      <div class="tw-titlebar__name">订单信息</div>
      <div class="tw-titlebar__ops">
        <button type="button" class="tw-tb-btn" :disabled="locked" @click="addLine">新增行</button>
        <button type="button" class="tw-tb-btn" :disabled="saving || locked" :title="locked ? '已收款订单不可修改' : 'Ctrl+S 保存'" @click="onSave">保存</button>
        <button type="button" class="tw-tb-btn is-ok" :disabled="payDisabled" :title="payTitle" @click="payOpen = true">收款</button>
        <button type="button" class="tw-tb-btn" @click="openOrderPreview">打印预览</button>
        <button type="button" class="tw-tb-btn" @click="openQuotePreview('1')">内部比价</button>
        <button type="button" class="tw-tb-btn" @click="onPrint">打印</button>
        <button type="button" class="tw-tb-btn" :disabled="!!exporting" @click="onExport('pdf')">{{ exporting === 'pdf' ? '…' : 'PDF' }}</button>
        <button type="button" class="tw-tb-btn" :disabled="!!exporting" @click="onExport('jpg')">{{ exporting === 'jpg' ? '…' : 'JPG' }}</button>
        <button type="button" class="tw-tb-btn" :disabled="!!exporting" @click="onExport('xlsx')">{{ exporting === 'xlsx' ? '…' : 'Excel' }}</button>
        <button type="button" class="tw-tb-btn" @click="onClose">关闭</button>
      </div>
    </div>
    <div class="order-form-card">
      <div class="order-form-grid">
        <div class="order-form-grid__full order-form-customer-row">
          <span class="order-form-label">客户名称</span>
          <TwUnitPicker
            class="tw-customer-picker"
            variant="field"
            :columns="1"
            :allow-manual="false"
            :model-value="form.customerId"
            :options="customerSelectOptions"
            :disabled="locked"
            placeholder="手动输入"
            @update:model-value="onCustomerId"
          />
          <input v-if="!form.customerId" v-model="form.customerName" :disabled="locked" placeholder="请输入客户名称" />
          <label class="order-form-check" title="勾选后即使姓名相同也新建客户档案">
            <input v-model="form.isNewCustomer" type="checkbox" :disabled="locked" @change="onNewCustomerToggle" /> 新客户
          </label>
        </div>
        <label class="order-form-grid__full order-form-check" title="需在设置里上传收款码">
          <input v-model="form.showPaymentQrOnPrint" type="checkbox" />
          <span>本单打印单显示收款码</span>
        </label>
        <div class="order-form-field">
          <span class="order-form-label">开单日期</span>
          <TwDatePicker v-model="form.orderDate" :disabled="locked" />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">联系人</span>
          <input v-model="form.contact" :disabled="locked" />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">订单编号</span>
          <input :value="form.orderNo || '保存后生成'" readonly />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">单据名称</span>
          <input v-model="form.printDocTitle" maxlength="20" :placeholder="defaultDocTitle" />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">联系电话</span>
          <input v-model="form.phone" inputmode="tel" :disabled="locked" />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">交付方式</span>
          <TwUnitPicker
            variant="field"
            :columns="1"
            :allow-manual="false"
            v-model="form.deliveryMethod"
            :options="deliveryOptions"
            :disabled="locked"
            placeholder="请选择"
          />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">交付时间</span>
          <TwDatePicker v-model="form.deliveryDate" :disabled="locked" />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">结账方式</span>
          <TwUnitPicker
            variant="field"
            :columns="1"
            :allow-manual="false"
            v-model="form.settlementMethod"
            :options="settlementOptions"
            :disabled="locked"
            placeholder="请选择"
          />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">状态</span>
          <TwUnitPicker
            variant="field"
            :columns="1"
            :allow-manual="false"
            v-model="form.status"
            :options="statusOptions"
            :disabled="locked"
          />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">业务员</span>
          <input v-model="form.salesperson" :disabled="locked" />
        </div>
        <div class="order-form-grid__full order-form-field">
          <span class="order-form-label">地址</span>
          <input v-model="form.address" :disabled="locked" />
        </div>
      </div>
    </div>

    <div class="tw-line-block">
      <div class="tw-line-tools">
        <button type="button" class="tw-mini-btn tw-dup-action" :disabled="locked" @click="addLine">增加</button>
        <button type="button" class="tw-mini-btn tw-dup-action" :disabled="saving || locked" @click="onSave">保存</button>
        <button type="button" class="tw-mini-btn" :disabled="locked" @click="removeLast">删末行</button>
        <button type="button" class="tw-mini-btn" @click="colOpen = true">列设置</button>
        <button type="button" class="tw-mini-btn" :disabled="locked" @click="toggleSelectAll">{{ allSelected ? '取消全选' : '全选' }}</button>
        <button type="button" class="tw-mini-btn" :disabled="locked" :title="locked ? '已收款订单不可修改明细' : ''" @click="copySelected">复制明细</button>
        <button type="button" class="tw-mini-btn" :disabled="locked" @click="pasteLines">粘贴明细</button>
      </div>

      <TwLineTable
        v-model:lines="form.lines"
        v-model:selected-ids="selectedLineIds"
        :columns="visibleCols"
        :settings="printSettings"
        :disabled="locked"
        select-enabled
      />
    </div>

    <div class="order-finance">
      <div class="order-finance__row">
        <div class="order-form-field">
          <span class="order-form-label">金额合计</span>
          <input :value="formatMoney(totals.subtotal)" readonly />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">优惠</span>
          <input v-model.number="form.discount" type="number" :disabled="locked" />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">票据类型</span>
          <TwUnitPicker
            variant="field"
            :columns="1"
            :allow-manual="false"
            v-model="form.invoiceType"
            :options="invoiceOptions"
            :disabled="locked"
            placeholder="请选择"
          />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">税率 %</span>
          <input v-model.number="form.taxRate" type="number" :disabled="locked" />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">税费</span>
          <input :value="formatMoney(totals.tax)" readonly />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">应收</span>
          <input :value="formatMoney(totals.receivable)" readonly />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">预付款</span>
          <input v-model.number="form.prepay" type="number" :disabled="locked" />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">本次付款</span>
          <input :value="form.currentPayment" type="number" readonly title="由顶部「收款」或对账单登记，避免重复记账" />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">付款方式</span>
          <TwUnitPicker
            variant="field"
            :columns="1"
            :allow-manual="false"
            v-model="form.paymentMethod"
            :options="paymentOptions"
            :disabled="locked"
            placeholder="请选择"
          />
        </div>
        <div class="order-form-field">
          <span class="order-form-label">未结</span>
          <input :value="formatMoney(totals.balance)" readonly :class="totals.balance > 0 ? 'is-due' : 'is-ok'" />
        </div>
      </div>
      <div class="order-finance__note order-form-field">
        <span class="order-form-label">整单备注</span>
        <input v-model="form.note" :disabled="locked" />
      </div>
    </div>

    <div class="tw-quote-card">
      <div class="tw-quote-card__head">
        <div>
          <div class="tw-quote-card__title">内部比价方案</div>
        </div>
        <div class="tw-quote-card__ops">
          <button type="button" class="tw-mini-btn" :disabled="locked" @click="fillQuoteTiers">按本单生成三档</button>
          <button type="button" class="tw-mini-btn" @click="openQuotePreview('compare')">预览对照表</button>
        </div>
      </div>
      <div class="tw-quote-table-wrap">
        <table class="tw-quote-table">
          <thead>
            <tr>
              <th>方案档位</th>
              <th>公司名称</th>
              <th>版式</th>
              <th>单价</th>
              <th>总价</th>
              <th>备注</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(plan, i) in form.quotePlans" :key="plan.id">
              <td><input v-model="plan.name" maxlength="20" :disabled="locked" /></td>
              <td><input v-model="plan.companyName" maxlength="40" :disabled="locked" :placeholder="defaultQuoteCompany" /></td>
              <td class="tw-quote-style">{{ quoteStyleOf(i).styleLabel }}</td>
              <td><input v-model.number="plan.unitPrice" type="number" min="0" step="0.01" :disabled="locked" @change="onQuoteUnitPrice(plan)" /></td>
              <td><input :value="plan.total" type="number" readonly tabindex="-1" /></td>
              <td><input v-model="plan.note" maxlength="80" :disabled="locked" /></td>
              <td><button type="button" class="tw-mini-btn" @click="openQuotePreview(String(i))">预览</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div v-if="form.lastPaymentRemark" class="tw-pay-note">
      <div class="tw-muted">最近一次收款备注</div>
      <div>{{ form.lastPaymentRemark }}</div>
      <div v-if="(form.lastPaymentRemarkImages || []).length" class="tw-pay-imgs">
        <a v-for="(url, i) in form.lastPaymentRemarkImages" :key="i" :href="url" target="_blank" rel="noreferrer">
          <img :src="url" alt="" />
        </a>
      </div>
    </div>
    <div v-if="form.id" class="tw-danger-row">
      <el-button size="small" type="danger" plain @click="onDelete">删除订单</el-button>
    </div>

    <TwColumnSettings v-model="colOpen" :settings="printSettings" @save="onSaveColumns" />

    <el-dialog v-model="payOpen" title="收款" width="420px" append-to-body class="tw-mobile-dialog">
      <p class="tw-muted">订单号：{{ form.orderNo }}　客户：{{ form.customerName }}　未结 {{ formatMoney(totals.balance) }}</p>
      <el-form label-position="top">
        <el-form-item label="本次收款金额（元）">
          <el-input v-model="payForm.amount" type="number" />
        </el-form-item>
        <el-form-item label="付款方式">
          <el-select v-model="payForm.method" style="width:100%" clearable placeholder="请选择">
            <el-option v-for="m in RECEIVE_METHODS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="payForm.remark" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="附图（可粘贴）">
          <TwSampleCell v-model="payForm.image" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="payOpen = false">取消</el-button>
        <el-button type="primary" :disabled="!form.id" @click="confirmPay">确认收款</el-button>
      </template>
    </el-dialog>

    <div v-if="previewOpen" class="tw-preview" @click.self="closePreview">
      <div class="tw-preview__bar">
        <strong>{{ previewTitle }}</strong>
        <div class="tw-preview__ops">
          <button type="button" class="tw-mini-btn" @click="onPrint">打印</button>
          <button type="button" class="tw-mini-btn" :disabled="!!exporting" @click="onExport('pdf')">{{ exporting === 'pdf' ? '…' : '另存 PDF' }}</button>
          <button type="button" class="tw-mini-btn" :disabled="!!exporting" @click="onExport('jpg')">{{ exporting === 'jpg' ? '…' : '另存图片' }}</button>
          <button type="button" class="tw-mini-btn is-danger" @click="closePreview">关闭</button>
        </div>
      </div>
      <div class="tw-preview__body" :class="{ 'tw-preview__body--quote': previewKind === 'quote' }">
        <aside :class="{ 'tw-preview__aside--quote': previewKind === 'quote' }">
          <template v-if="previewKind === 'quote'">
            <div class="tw-muted" style="font-size:12px;margin-bottom:8px">报价档</div>
            <button
              v-for="(def, i) in quotePlanDefs"
              :key="def.id"
              type="button"
              class="tw-tpl"
              :class="{ 'is-on': quoteView === String(i) }"
              @click="quoteView = String(i)"
            >
              <b>{{ form.quotePlans[i] && form.quotePlans[i].name || def.name }}</b>
              <small>{{ (form.quotePlans[i] && form.quotePlans[i].companyName) || defaultQuoteCompany }} · {{ def.styleLabel }}</small>
            </button>
            <button type="button" class="tw-tpl" :class="{ 'is-on': quoteView === 'compare' }" @click="quoteView = 'compare'">
              <b>内部对照表</b>
              <small>三档对照 · 仅内部</small>
            </button>
            <button type="button" class="tw-tpl" @click="openOrderPreview">
              <b>返回业务单</b>
              <small>原打印预览</small>
            </button>
            <div v-if="currentQuotePlan" class="tw-quote-editor">
              <div class="tw-quote-editor__title">本页可改，右侧即时预览</div>
              <div class="tw-quote-editor__row">
                <label>单据标题
                  <input v-model="currentQuotePlan.docTitle" maxlength="20" :disabled="locked" placeholder="报价单" />
                </label>
                <label>公司名称
                  <input v-model="currentQuotePlan.companyName" maxlength="40" :disabled="locked" :placeholder="defaultQuoteCompany" />
                </label>
              </div>
              <label>客户名称
                <input v-model="currentQuotePlan.customerName" maxlength="80" :disabled="locked" />
              </label>
              <div class="tw-quote-editor__row">
                <label>联系人
                  <input v-model="currentQuotePlan.contact" maxlength="40" :disabled="locked" />
                </label>
                <label>联系电话
                  <input v-model="currentQuotePlan.phone" maxlength="30" :disabled="locked" />
                </label>
              </div>
              <div class="tw-quote-editor__row">
                <label>报价日期
                  <TwDatePicker v-model="currentQuotePlan.orderDate" :disabled="locked" />
                </label>
                <label>交货日期
                  <TwDatePicker v-model="currentQuotePlan.deliveryDate" :disabled="locked" />
                </label>
              </div>
              <label>关联单号
                <input v-model="currentQuotePlan.orderNo" maxlength="40" :disabled="locked" />
              </label>
              <label>客户地址
                <input v-model="currentQuotePlan.address" maxlength="120" :disabled="locked" />
              </label>
              <label>备注
                <input v-model="currentQuotePlan.note" maxlength="80" :disabled="locked" />
              </label>
              <div class="tw-quote-editor__items-head">
                <span>报价明细</span>
                <span class="tw-muted">合计 {{ formatMoney(currentQuotePlan.total) }}</span>
              </div>
              <div class="tw-quote-editor__items">
                <table>
                  <thead>
                    <tr>
                      <th>项目</th>
                      <th>规格</th>
                      <th>材质</th>
                      <th>{{ dimWidthLabel }}</th>
                      <th>{{ dimHeightLabel }}</th>
                      <th>数量</th>
                      <th>单位</th>
                      <th>单价</th>
                      <th>金额</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(item, ii) in currentQuotePlan.items" :key="item.id || ii">
                      <td><input v-model="item.projectName" :disabled="locked" /></td>
                      <td><input v-model="item.spec" :disabled="locked" /></td>
                      <td><input v-model="item.material" :disabled="locked" /></td>
                      <td><input :value="dimShow(item.widthMm)" type="number" min="0" :step="dimStep" :disabled="locked" @change="setItemDim(item, 'widthMm', $event.target.value)" /></td>
                      <td><input :value="dimShow(item.heightMm)" type="number" min="0" :step="dimStep" :disabled="locked" @change="setItemDim(item, 'heightMm', $event.target.value)" /></td>
                      <td><input v-model.number="item.qty" type="number" min="1" step="1" :disabled="locked" @input="touchQuotePlan" /></td>
                      <td><input v-model="item.unitLabel" :disabled="locked" /></td>
                      <td><input v-model.number="item.unitPrice" type="number" min="0" step="0.01" :disabled="locked" @input="touchQuotePlan" /></td>
                      <td class="tw-quote-editor__amt">{{ formatMoney(lineAmountOf(item)) }}</td>
                      <td><button type="button" class="tw-mini-btn is-danger" :disabled="locked" @click="removeQuoteItem(ii)">删</button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="tw-quote-editor__ops">
                <button type="button" class="tw-mini-btn" :disabled="locked" @click="addQuoteItem">加一行</button>
                <button type="button" class="tw-mini-btn" :disabled="locked" @click="resetQuoteFromOrder">从本单带入</button>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="tw-muted" style="font-size:12px;margin-bottom:8px">模板</div>
            <button
              v-for="tpl in PRINT_TEMPLATES"
              :key="tpl.id"
              type="button"
              class="tw-tpl"
              :class="{ 'is-on': templateId === tpl.id }"
              @click="templateId = tpl.id"
            >
              <b>{{ tpl.label }}</b>
              <small>{{ tpl.hint }}</small>
            </button>
          </template>
        </aside>
        <div class="tw-preview__stage" @click.stop>
          <div ref="sheetRef" class="tw-preview__sheet" v-html="previewHtml"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, auth } from '../../api/client'
import {
  DELIVERY_METHODS,
  INVOICE_TYPES,
  ORDER_STATUSES,
  QUOTE_PLAN_DEFAULTS,
  RECEIVE_METHODS,
  SETTLEMENT_METHODS,
  cloneClipboardLines,
  contentLines,
  copyLinesToClipboard,
  dimensionColumnLabel,
  dimensionInputStep,
  dimensionToMm,
  dimensionUnitOf,
  emptyLine,
  emptyOrder,
  emptyQuoteItem,
  ensureQuotePlansReady,
  formatMoney,
  isMoneySettled,
  isPaidDisplay,
  lineAmount,
  lineAreaM2,
  mmToDimension,
  normalizeQuotePlans,
  orderBalance,
  orderReceivable,
  orderSubtotal,
  orderTax,
  orderDocTitle,
  quoteCompanyOf,
  quoteDocTitleOf,
  readLinesClipboard,
  recaclQuotePlan,
  applyQuoteUnitPrice,
  seedQuotePlanFromOrder,
  suggestQuotePlans,
  todayDate,
  visibleLineColumnsOf
} from '../../utils/tuwen-yewu.js'
import {
  PRINT_TEMPLATES,
  exportOrderExcel,
  exportOrderJpg,
  orderSheetHtml,
  printOrderSheet,
  printQuoteView,
  quotePreviewHtml
} from '../../utils/tuwen-print.js'
import TwLineTable from './TwLineTable.vue'
import TwColumnSettings from './TwColumnSettings.vue'
import TwSampleCell from './TwSampleCell.vue'
import TwUnitPicker from './TwUnitPicker.vue'
import TwDatePicker from './TwDatePicker.vue'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const exporting = ref('')
const form = reactive(emptyOrder())
const baseline = ref('')
const allowLeave = ref(false)
const skipPersist = ref(false)
let persistInFlight = null
const customers = ref([])
const printSettings = ref({})
const selectedLineIds = ref([])
const colOpen = ref(false)
const payOpen = ref(false)
const previewOpen = ref(false)
const previewKind = ref('order')
const quoteView = ref('compare')
const templateId = ref('a4-1')
const sheetRef = ref(null)
const payForm = reactive({ amount: '', method: '', remark: '', image: '' })
const quotePlanDefs = QUOTE_PLAN_DEFAULTS

const isNew = computed(() => route.params.id == null || route.path.endsWith('/new'))
const lockAtLoad = ref(false)
const locked = computed(() => lockAtLoad.value)

function rememberLock(order) {
  lockAtLoad.value = isPaidDisplay(order || form, printSettings.value.moneyDecimals)
}
const totals = computed(() => ({
  subtotal: orderSubtotal(form),
  tax: orderTax(form),
  receivable: orderReceivable(form),
  balance: orderBalance(form)
}))
const visibleCols = computed(() => visibleLineColumnsOf(printSettings.value))
const dimUnit = computed(() => dimensionUnitOf(printSettings.value))
const dimStep = computed(() => dimensionInputStep(dimUnit.value))
const dimWidthLabel = computed(() => dimensionColumnLabel('widthMm', dimUnit.value))
const dimHeightLabel = computed(() => dimensionColumnLabel('heightMm', dimUnit.value))
function choiceOptions(list) {
  return [{ value: '', label: '请选择' }, ...list.map((m) => ({ value: m, label: m }))]
}
const customerSelectOptions = computed(() => [
  { value: '', label: '手动输入' },
  ...customers.value.map((c) => ({
    value: c.id,
    label: c.starred ? `★ ${c.name}` : c.name
  }))
])
const deliveryOptions = computed(() => choiceOptions(DELIVERY_METHODS))
const settlementOptions = computed(() => choiceOptions(SETTLEMENT_METHODS))
const invoiceOptions = computed(() => choiceOptions(INVOICE_TYPES))
const paymentOptions = computed(() => choiceOptions(RECEIVE_METHODS))
const statusOptions = computed(() => Object.entries(ORDER_STATUSES).map(([value, label]) => ({ value, label })))
const allSelected = computed(() => form.lines.length > 0 && form.lines.every((l) => selectedLineIds.value.includes(l.id)))
const currentTpl = computed(() => PRINT_TEMPLATES.find((t) => t.id === templateId.value) || PRINT_TEMPLATES[0])
const defaultQuoteCompany = computed(() => quoteCompanyOf({}, printSettings.value))
const defaultDocTitle = computed(() => orderDocTitle({}, printSettings.value))
const currentQuotePlan = computed(() => {
  if (previewKind.value !== 'quote' || quoteView.value === 'compare') return null
  const i = Math.max(0, Math.min(2, Number(quoteView.value) || 0))
  return form.quotePlans[i] || null
})
const previewHtml = computed(() => {
  if (previewKind.value === 'quote') return quotePreviewHtml(form, printSettings.value, quoteView.value)
  return orderSheetHtml(form, printSettings.value, templateId.value)
})
const previewTitle = computed(() => {
  if (previewKind.value !== 'quote') return `打印预览 · ${currentTpl.value.label}`
  if (quoteView.value === 'compare') return '内部方案对照表'
  const plan = currentQuotePlan.value || {}
  const company = quoteCompanyOf(plan, printSettings.value)
  return `${quoteDocTitleOf(plan)} · ${company}`
})
const payDisabled = computed(() => isNew.value || locked.value)
const payTitle = computed(() => {
  if (isNew.value) return '请先保存订单后再收款'
  if (locked.value) return '本单已在收款流程中确认，无需再次收款'
  if (isMoneySettled(form, printSettings.value.moneyDecimals)) return '预付款已结清，点此确认收款并锁单'
  return ''
})

function namedLines() {
  return contentLines(form.lines)
}

function canSave() {
  return !!(String(form.customerName || '').trim() && namedLines().length)
}

function snapKey(src) {
  const lines = (src.lines || []).map((l) => ({
    id: String(l.id || ''),
    projectName: String(l.projectName || ''),
    productName: String(l.productName || ''),
    code: String(l.code || ''),
    spec: String(l.spec || ''),
    material: String(l.material || ''),
    qty: Number(l.qty) || 1,
    unitLabel: String(l.unitLabel || ''),
    unitPrice: Number(l.unitPrice) || 0,
    pricingMode: String(l.pricingMode || ''),
    widthMm: Number(l.widthMm) || 0,
    heightMm: Number(l.heightMm) || 0,
    remark: String(l.remark || ''),
    sampleNote: String(l.sampleNote || ''),
    sampleImageDataUrl: String(l.sampleImageDataUrl || ''),
    outsource: !!l.outsource
  }))
  return JSON.stringify({
    customerName: String(src.customerName || '').trim(),
    customerId: String(src.customerId || ''),
    contact: String(src.contact || ''),
    phone: String(src.phone || ''),
    address: String(src.address || ''),
    salesperson: String(src.salesperson || ''),
    orderDate: String(src.orderDate || ''),
    deliveryDate: String(src.deliveryDate || ''),
    status: String(src.status || ''),
    paymentMethod: String(src.paymentMethod || ''),
    deliveryMethod: String(src.deliveryMethod || ''),
    settlementMethod: String(src.settlementMethod || ''),
    invoiceType: String(src.invoiceType || ''),
    isNewCustomer: !!src.isNewCustomer,
    prepay: Number(src.prepay) || 0,
    currentPayment: Number(src.currentPayment) || 0,
    discount: Number(src.discount) || 0,
    taxRate: Number(src.taxRate) || 0,
    note: String(src.note || ''),
    showPaymentQrOnPrint: src.showPaymentQrOnPrint !== false,
    printDocTitle: String(src.printDocTitle || '').trim(),
    quotePlans: normalizeQuotePlans(src.quotePlans),
    lines
  })
}

function markClean() {
  baseline.value = snapKey(form)
}

function isDirty() {
  return snapKey(form) !== baseline.value
}

function hasDraftContent() {
  return !!(String(form.customerName || '').trim() || namedLines().length || String(form.phone || '').trim() || String(form.note || '').trim())
}

function onCustomerId(id) {
  form.customerId = id
  const c = customers.value.find((x) => x.id === id)
  if (c) {
    form.customerName = c.name
    form.phone = c.phone || form.phone
    form.contact = c.contact || form.contact
    form.address = c.address || form.address
    form.isNewCustomer = false
  }
}

function onNewCustomerToggle() {
  if (form.isNewCustomer) form.customerId = ''
}

function onQuoteUnitPrice(plan) {
  applyQuoteUnitPrice(plan, plan.unitPrice)
}

async function saveOrder({ silent, stay, applyResult = true, toast } = {}) {
  if (locked.value) return true
  if (!canSave()) {
    ElMessage.warning(String(form.customerName || '').trim() ? '请至少填写一行明细' : '请填写客户名称')
    return false
  }
  saving.value = true
  try {
    const payload = {
      ...form,
      lines: namedLines()
    }
    const data = await api.saveTuwenOrder(payload)
    if (data && data.order && data.order.id) {
      form.id = data.order.id
      if (data.order.orderNo) form.orderNo = data.order.orderNo
    }
    if (applyResult && data && data.order) assignOrder(data.order)
    markClean()
    if (toast !== false) {
      if (!silent) {
        ElMessage.success(payload.id ? '已保存' : `已新建 ${data.order.orderNo}`)
      } else {
        ElMessage.success(payload.id ? '已自动保存' : `已自动新建 ${data.order.orderNo}`)
      }
    }
    if (!stay && applyResult && isNew.value && data.order && data.order.id) {
      allowLeave.value = true
      await router.replace(`/tuwen/orders/${encodeURIComponent(data.order.id)}`)
      allowLeave.value = false
      markClean()
    }
    return true
  } catch (e) {
    ElMessage.error((e && e.message) || '保存失败')
    return false
  } finally {
    saving.value = false
  }
}

function flushPendingInputs() {
  const el = document.activeElement
  if (!el || el === document.body || typeof el.dispatchEvent !== 'function') return
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

async function saveIfNeeded({ toast = true, applyResult = false } = {}) {
  if (locked.value || skipPersist.value) return true
  if (!isDirty()) return true
  if (!canSave()) {
    if (!hasDraftContent()) return true
    ElMessage.warning('有未保存的内容，请填写客户名称和至少一行明细')
    return false
  }
  return saveOrder({ silent: true, stay: true, applyResult, toast })
}

function persistOnLeave() {
  if (persistInFlight) return persistInFlight
  persistInFlight = (async () => {
    try {
      flushPendingInputs()
      await nextTick()
      return await saveIfNeeded({ toast: true, applyResult: false })
    } finally {
      persistInFlight = null
    }
  })()
  return persistInFlight
}

function persistOnUnload() {
  if (locked.value || skipPersist.value) return
  flushPendingInputs()
  if (!isDirty() || !canSave()) return
  api.saveTuwenOrderKeepalive({ ...form, lines: namedLines() })
}

function shouldSkipSave(opts) {
  return !!(opts && typeof opts === 'object' && !(opts instanceof Event) && opts.skipSave)
}

async function goBack(opts) {
  if (shouldSkipSave(opts)) skipPersist.value = true
  else {
    const ok = await persistOnLeave()
    if (!ok) return
  }
  allowLeave.value = true
  router.push('/tuwen/orders')
}

async function onClose() {
  await goBack()
}

function assignOrder(order) {
  const next = {
    ...emptyOrder(),
    ...order,
    lastPaymentRemarkImages: Array.isArray(order.lastPaymentRemarkImages) ? order.lastPaymentRemarkImages : [],
    printDocTitle: String(order.printDocTitle || '').trim(),
    quotePlans: normalizeQuotePlans(order.quotePlans),
    lines: Array.isArray(order.lines) && order.lines.length
      ? order.lines.map((l) => ({ ...emptyLine(), ...l, id: l.id || emptyLine().id }))
      : [emptyLine()]
  }
  Object.assign(form, next)
  form.id = next.id || ''
  form.orderNo = next.orderNo || ''
}

function addLine() {
  form.lines = [...form.lines, emptyLine()]
}

function removeLast() {
  if (form.lines.length <= 1) return
  form.lines = form.lines.slice(0, -1)
}

function toggleSelectAll() {
  if (allSelected.value) selectedLineIds.value = []
  else selectedLineIds.value = form.lines.map((l) => l.id)
}

function copySelected() {
  const picked = selectedLineIds.value.length
    ? form.lines.filter((l) => selectedLineIds.value.includes(l.id))
    : form.lines
  const n = copyLinesToClipboard(picked, form.orderNo)
  ElMessage.success(n ? `已复制 ${n} 行明细` : '没有可复制的明细')
}

async function pasteLines() {
  const clip = readLinesClipboard()
  if (!clip || !clip.lines.length) {
    ElMessage.warning('剪贴板为空，请先在其它订单中点击「复制明细」')
    return
  }
  const incoming = cloneClipboardLines(clip)
  const hasContent = form.lines.some((l) => contentLines([l]).length)
  if (hasContent) {
    try {
      await ElMessageBox.confirm(`当前订单已有 ${form.lines.length} 行明细，是否在其后追加 ${incoming.length} 行？`, '粘贴明细', { confirmButtonText: '追加粘贴' })
    } catch {
      return
    }
    form.lines = [...form.lines, ...incoming]
  } else {
    form.lines = incoming
  }
  ElMessage.success(`已粘贴 ${incoming.length} 行明细${clip.sourceOrderNo ? `（来自 ${clip.sourceOrderNo}）` : ''}`)
}

async function onSaveColumns(payload) {
  try {
    const data = await api.saveTuwenSettings({ ...printSettings.value, ...payload })
    printSettings.value = (data && data.settings) || { ...printSettings.value, ...payload }
    ElMessage.success('列设置已保存')
  } catch (e) {
    ElMessage.error((e && e.message) || '保存列设置失败')
  }
}

function applyBootstrap(data, { resetForm = true } = {}) {
  if (!data) return
  customers.value = data.customers || customers.value || []
  if (data.settings) printSettings.value = data.settings
  if (!resetForm) return
  if (isNew.value) {
    assignOrder(emptyOrder())
    const user = auth.getUser()
    if (user && user.username && !form.salesperson) form.salesperson = user.username
    if (printSettings.value.defaultTaxRate) form.taxRate = Number(printSettings.value.defaultTaxRate) || 0
    const src = data.copied ? data.order : null
    if (src) {
      assignOrder({
        ...src,
        id: '',
        orderNo: '',
        orderDate: todayDate(),
        status: 'pending',
        prepay: 0,
        currentPayment: 0,
        paymentModalConfirmedAt: '',
        lastPaymentRemark: '',
        lastPaymentRemarkImages: [],
        quotePlans: normalizeQuotePlans(src.quotePlans).map((p) => ({ ...p, orderDate: todayDate() })),
        lines: (src.lines || []).map((l) => ({ ...l, id: emptyLine().id }))
      })
    }
  } else if (data.order) {
    assignOrder(data.order)
  }
  rememberLock(form)
  markClean()
}

async function load() {
  const query = {
    id: isNew.value ? '' : String(route.params.id || ''),
    copyFrom: isNew.value ? String(route.query.copyFrom || '') : ''
  }
  const cached = api.peekTuwenOrderEdit(query)
  if (cached) {
    applyBootstrap(cached, { resetForm: true })
    loading.value = false
  } else {
    loading.value = true
  }
  try {
    const data = await api.getTuwenOrderEdit(query)
    if (data && data.unchanged) return
    if (cached && isDirty()) {
      applyBootstrap(data, { resetForm: false })
      return
    }
    applyBootstrap(data, { resetForm: true })
  } catch (e) {
    if (cached) return
    ElMessage.error((e && e.message) || '订单不存在')
    goBack({ skipSave: true })
  } finally {
    loading.value = false
  }
}

async function onSave() {
  await saveOrder({ silent: false })
}

async function ensureSaved() {
  flushPendingInputs()
  await nextTick()
  if (isDirty() && canSave()) await saveOrder({ silent: true, stay: true, applyResult: true })
}

async function onPrint() {
  await ensureSaved()
  if (previewOpen.value && previewKind.value === 'quote') {
    printQuoteView(form, printSettings.value, quoteView.value)
    return
  }
  printOrderSheet(form, printSettings.value, templateId.value)
}

async function onExport(kind) {
  await ensureSaved()
  exporting.value = kind
  try {
    if (kind === 'xlsx') exportOrderExcel(form, printSettings.value)
    else if (kind === 'jpg') await exportOrderJpg(form, printSettings.value, templateId.value, sheetRef.value)
    else if (previewOpen.value && previewKind.value === 'quote') printQuoteView(form, printSettings.value, quoteView.value)
    else printOrderSheet(form, printSettings.value, templateId.value)
  } catch (e) {
    ElMessage.error((e && e.message) || '导出失败')
  } finally {
    exporting.value = ''
  }
}

function quoteStyleOf(index) {
  return quotePlanDefs[index] || quotePlanDefs[0]
}

function fillQuoteTiers() {
  const next = suggestQuotePlans(form, form.quotePlans)
  form.quotePlans.splice(0, form.quotePlans.length, ...next)
  ElMessage.success('已按本单明细生成经济 / 标准 / 加急三档，可在内部比价里改价格')
}

function openOrderPreview() {
  previewKind.value = 'order'
  previewOpen.value = true
}

function openQuotePreview(view) {
  ensureQuotePlansReady(form)
  quoteView.value = view == null ? '1' : String(view)
  previewKind.value = 'quote'
  previewOpen.value = true
}

function touchQuotePlan() {
  const plan = currentQuotePlan.value
  if (plan) recaclQuotePlan(plan)
}

function lineAmountOf(item) {
  return lineAmount(item)
}

function dimShow(mm) {
  const v = mmToDimension(mm, dimUnit.value)
  return v ? v : ''
}

function setItemDim(item, key, raw) {
  item[key] = dimensionToMm(raw, dimUnit.value)
  touchQuotePlan()
}

function addQuoteItem() {
  const plan = currentQuotePlan.value
  if (!plan || locked.value) return
  if (!Array.isArray(plan.items)) plan.items = []
  plan.items.push(emptyQuoteItem())
  recaclQuotePlan(plan)
}

function removeQuoteItem(index) {
  const plan = currentQuotePlan.value
  if (!plan || locked.value || !Array.isArray(plan.items)) return
  plan.items.splice(index, 1)
  recaclQuotePlan(plan)
}

function resetQuoteFromOrder() {
  const plan = currentQuotePlan.value
  if (!plan || locked.value) return
  plan.items = []
  plan.customerName = ''
  plan.contact = ''
  plan.phone = ''
  plan.address = ''
  plan.orderDate = ''
  plan.deliveryDate = ''
  plan.orderNo = ''
  seedQuotePlanFromOrder(form, plan, 1)
}

function closePreview() {
  previewOpen.value = false
  previewKind.value = 'order'
}

watch(quoteView, () => {
  if (previewOpen.value && previewKind.value === 'quote') ensureQuotePlansReady(form)
})

watch(payOpen, (v) => {
  if (v) {
    payForm.amount = String(totals.value.balance || '')
    payForm.method = form.paymentMethod || '微信'
    payForm.remark = ''
    payForm.image = ''
  }
})

async function confirmPay() {
  const amount = Number(payForm.amount)
  if (totals.value.balance > 0 && !(amount > 0)) {
    ElMessage.warning('请填写大于 0 的金额')
    return
  }
  try {
    const data = await api.payTuwenOrder(form.id, {
      amount,
      paymentMethod: payForm.method,
      remark: payForm.remark,
      images: payForm.image ? [payForm.image] : []
    })
    if (data && data.order) assignOrder(data.order)
    rememberLock(data && data.order)
    markClean()
    payOpen.value = false
    ElMessage.success('已登记收款')
  } catch (e) {
    ElMessage.error((e && e.message) || '收款失败')
  }
}

async function onDelete() {
  if (!form.id) return
  try {
    await ElMessageBox.confirm(`删除订单 ${form.orderNo || ''}？此操作不可恢复。`, '删除订单', { type: 'warning' })
    await api.deleteTuwenOrder(form.id)
    ElMessage.success('已删除')
    markClean()
    goBack({ skipSave: true })
  } catch (e) {
    if (e !== 'cancel') ElMessage.error((e && e.message) || '删除失败')
  }
}

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
    e.preventDefault()
    onSave()
  }
}

function onPageHide() {
  persistOnUnload()
}

function onVisibilityChange() {
  if (document.hidden) persistOnUnload()
}

onMounted(() => {
  load()
  window.addEventListener('keydown', onKey)
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pagehide', onPageHide)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
function isOrderEditPath(path) {
  return /^\/tuwen\/orders\/(new|[^/]+)$/.test(String(path || ''))
}

watch(() => (isNew.value ? 'new' : String(route.params.id || '')), (cur, prev) => {
  if (cur === prev) return
  if (allowLeave.value || skipPersist.value) return
  if (!isOrderEditPath(route.path)) return
  load()
})
onBeforeRouteLeave(async (to) => {
  if (allowLeave.value || skipPersist.value) return true
  if (String(to.path || '') === String(route.path || '')) return true
  return persistOnLeave()
})
</script>
