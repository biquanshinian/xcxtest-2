<template>
  <div ref="wrapRef" class="tw-line-wrap">
    <table class="tw-line-table">
      <colgroup>
        <col v-for="(w, i) in colPercents" :key="i" :style="{ width: w }">
      </colgroup>
      <thead>
        <tr>
          <th v-if="selectEnabled" class="is-center tw-line-table__sel">
            <input type="checkbox" :checked="allSelected" :indeterminate.prop="someSelected && !allSelected" @change="toggleAll" />
          </th>
          <th v-for="col in columns" :key="col.key" :class="alignClass(col)">{{ col.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(line, index) in lines"
          :key="line.id"
          @dragover.prevent="onRowDragOver"
          @drop.prevent="onRowDrop(index)"
        >
          <td v-if="selectEnabled" class="is-center tw-line-table__sel tw-cell-check" @mousedown="onCellActivate">
            <input type="checkbox" :checked="selected.has(line.id)" :disabled="disabled" @change="toggleOne(line.id)" />
          </td>
          <td v-for="col in columns" :key="col.key" :class="tdClass(col)" @mousedown="onCellActivate">
            <template v-if="col.key === 'seq'">
              <span
                class="tw-drag"
                :draggable="!disabled && lines.length > 1"
                :title="disabled ? '' : '拖动排序'"
                @dragstart="onRowDragStart(index, $event)"
                @dragend="onRowDragEnd"
              >{{ index + 1 }}</span>
            </template>
            <template v-else-if="col.key === 'outsource'">
              <input type="checkbox" :checked="!!line.outsource" :disabled="disabled" @change="patch(index, { outsource: $event.target.checked })" />
            </template>
            <template v-else-if="col.key === 'code'">
              <textarea class="tw-line-text" rows="1" v-model="line.code" :disabled="disabled" @focus="autosize($event.target)" @input="autosize($event.target)" />
            </template>
            <template v-else-if="col.key === 'projectName'">
              <textarea class="tw-line-text" rows="1" v-model="line.projectName" :disabled="disabled" placeholder="项目名称" @focus="autosize($event.target)" @input="autosize($event.target)" />
            </template>
            <template v-else-if="col.key === 'productName'">
              <textarea class="tw-line-text" rows="1" v-model="line.productName" :disabled="disabled" placeholder="产品名称" @focus="autosize($event.target)" @input="autosize($event.target)" />
            </template>
            <template v-else-if="col.key === 'spec'">
              <textarea class="tw-line-text" rows="1" v-model="line.spec" :disabled="disabled" :title="presetHint(specPresets)" @focus="autosize($event.target)" @input="autosize($event.target)" />
            </template>
            <template v-else-if="col.key === 'material'">
              <textarea class="tw-line-text" rows="1" v-model="line.material" :disabled="disabled" :title="presetHint(materialPresets)" @focus="autosize($event.target)" @input="autosize($event.target)" />
            </template>
            <template v-else-if="col.key === 'widthMm'">
              <input type="number" min="0" :step="dimStep" :value="dimDisplay(line.widthMm)" :disabled="disabled" @change="onDim(index, 'widthMm', $event)" />
            </template>
            <template v-else-if="col.key === 'heightMm'">
              <input type="number" min="0" :step="dimStep" :value="dimDisplay(line.heightMm)" :disabled="disabled" @change="onDim(index, 'heightMm', $event)" />
            </template>
            <template v-else-if="col.key === 'area'">
              <span class="tw-muted">{{ areaText(line) }}</span>
            </template>
            <template v-else-if="col.key === 'qty'">
              <input type="number" min="0" step="any" :value="line.qty" :disabled="disabled" @change="onNum(index, 'qty', $event, 0)" />
            </template>
            <template v-else-if="col.key === 'unit'">
              <TwUnitPicker
                :model-value="unitSelectValue(line)"
                :options="unitOptions"
                :disabled="disabled"
                :columns="2"
                allow-manual
                @update:model-value="onUnitSelect(index, line, $event)"
              />
            </template>
            <template v-else-if="col.key === 'unitPrice'">
              <input type="number" min="0" step="0.01" :value="numOrBlank(line.unitPrice)" :disabled="disabled" @change="onNum(index, 'unitPrice', $event)" />
            </template>
            <template v-else-if="col.key === 'amount'">
              <input
                type="number"
                min="0"
                step="any"
                :disabled="disabled"
                :value="amountDisplay(line)"
                :title="'按计价方式在金额、单价、数量、尺寸中互推'"
                @change="onAmount(index, line, $event)"
              />
            </template>
            <template v-else-if="col.key === 'sample'">
              <TwSampleCell :model-value="line.sampleImageDataUrl" :disabled="disabled" @update:model-value="patch(index, { sampleImageDataUrl: $event })" />
            </template>
            <template v-else-if="col.key === 'remark'">
              <textarea class="tw-line-text" rows="1" v-model="line.remark" :disabled="disabled" @focus="autosize($event.target)" @input="autosize($event.target)" />
            </template>
            <template v-else-if="col.key === 'actions'">
              <div class="tw-line-ops">
                <button type="button" class="tw-mini-btn" :disabled="disabled" @click="copyLine(index)">复制</button>
                <button type="button" class="tw-mini-btn is-danger" :disabled="disabled || lines.length <= 1" @click="removeLine(index)">删除</button>
              </div>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import TwSampleCell from './TwSampleCell.vue'
import TwUnitPicker from './TwUnitPicker.vue'
import {
  applyUnitToLine,
  colWidthPercents,
  columnAlignClass,
  dimensionInputStep,
  dimensionToMm,
  dimensionUnitOf,
  emptyLine,
  formatQty,
  lineAmount,
  lineAreaM2,
  lineLengthCm,
  lineLengthM,
  mmToDimension,
  reverseFromAmount,
  unitOptionsFromSettings
} from '../../utils/tuwen-yewu.js'

const props = defineProps({
  lines: { type: Array, default: () => [] },
  columns: { type: Array, default: () => [] },
  settings: { type: Object, default: () => ({}) },
  disabled: { type: Boolean, default: false },
  selectedIds: { type: Array, default: () => [] },
  selectEnabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:lines', 'update:selectedIds'])

const wrapRef = ref(null)
const dragFrom = ref(-1)
const colPercents = computed(() => colWidthPercents(props.columns, props.selectEnabled ? [28] : []))
const unitOptions = computed(() => unitOptionsFromSettings(props.settings))
const specPresets = computed(() => props.settings.orderLineSpecPresets || [])
const materialPresets = computed(() => props.settings.orderLineMaterialPresets || [])
const selected = computed(() => new Set(props.selectedIds || []))
const allSelected = computed(() => props.lines.length > 0 && props.lines.every((l) => selected.value.has(l.id)))
const someSelected = computed(() => props.lines.some((l) => selected.value.has(l.id)))
const dimUnit = computed(() => dimensionUnitOf(props.settings))
const dimStep = computed(() => dimensionInputStep(dimUnit.value))

function presetHint(list) {
  return (Array.isArray(list) ? list : []).filter(Boolean).join(' / ')
}

function alignClass(col) {
  return columnAlignClass(col && col.align)
}

const EDIT_KEYS = new Set(['code', 'projectName', 'productName', 'spec', 'material', 'widthMm', 'heightMm', 'qty', 'unit', 'unitPrice', 'amount', 'remark'])
const CHECK_KEYS = new Set(['outsource'])

function tdClass(col) {
  const align = alignClass(col)
  const key = col && col.key
  if (EDIT_KEYS.has(key)) return `${align} tw-cell-edit`.trim()
  if (CHECK_KEYS.has(key)) return `${align} tw-cell-check`.trim()
  return align
}

function onCellActivate(e) {
  if (e.target !== e.currentTarget) return
  if (props.disabled && !e.currentTarget.classList.contains('tw-cell-check')) return
  const td = e.currentTarget
  const check = td.querySelector('input[type="checkbox"]')
  if (check && !check.disabled) {
    check.click()
    return
  }
  const field = td.querySelector('input:not([type="checkbox"]), textarea')
  if (field && !field.disabled) {
    field.focus()
    return
  }
  const unit = td.querySelector('.tw-unit-picker__btn, .tw-unit-picker__input')
  if (unit && !unit.disabled) unit.click()
}

function patch(index, extra) {
  const cur = props.lines[index]
  if (!cur) return
  Object.assign(cur, extra)
}

function numOrBlank(n) {
  const v = Number(n) || 0
  return v ? v : ''
}

function dimDisplay(mm) {
  const v = mmToDimension(mm, dimUnit.value)
  return v ? v : ''
}

function autosize(el) {
  if (!el || el.tagName !== 'TEXTAREA') return
  el.style.height = 'auto'
  el.style.height = `${Math.max(32, el.scrollHeight)}px`
}

function resizeAll() {
  if (!wrapRef.value) return
  wrapRef.value.querySelectorAll('.tw-line-text').forEach(autosize)
}

function onNum(index, key, e, min = 0) {
  let v = Number(e.target.value)
  if (!Number.isFinite(v)) v = min
  if (v < min) v = min
  patch(index, { [key]: v })
}

function onDim(index, key, e) {
  patch(index, { [key]: dimensionToMm(e.target.value, dimUnit.value) })
}

function unitSelectValue(line) {
  return line.unitLabel || '平方米'
}

function onUnitSelect(index, line, value) {
  if (value === '__manual__') return
  patch(index, applyUnitToLine(line, value))
}

function areaText(line) {
  const areaD = Number(props.settings.areaDecimals) || 3
  const lenD = Number(props.settings.lengthDecimals) || 3
  if (line.pricingMode === 'by_area') {
    const v = lineAreaM2(line)
    return v > 0 ? formatQty(v, areaD) : ''
  }
  if (line.pricingMode === 'by_length') {
    const v = lineLengthM(line)
    return v > 0 ? formatQty(v, lenD) : ''
  }
  if (line.pricingMode === 'by_cm') {
    const v = lineLengthCm(line)
    return v > 0 ? `${formatQty(v, lenD)} cm` : ''
  }
  return ''
}

function amountDisplay(line) {
  const n = lineAmount(line)
  return n > 1e-12 ? Number(n.toFixed(Number(props.settings.moneyDecimals) || 2)) : ''
}

function onAmount(index, line, e) {
  const raw = Number(e.target.value)
  const next = reverseFromAmount(line, raw)
  patch(index, next)
}

function copyLine(index) {
  const src = props.lines[index]
  const next = [...props.lines]
  next.splice(index + 1, 0, { ...emptyLine(), ...src, id: emptyLine().id })
  emit('update:lines', next)
}

function removeLine(index) {
  if (props.lines.length <= 1) return
  emit('update:lines', props.lines.filter((_, i) => i !== index))
}

function toggleOne(id) {
  const set = new Set(props.selectedIds || [])
  if (set.has(id)) set.delete(id)
  else set.add(id)
  emit('update:selectedIds', [...set])
}

function toggleAll() {
  if (allSelected.value) emit('update:selectedIds', [])
  else emit('update:selectedIds', props.lines.map((l) => l.id))
}

function onRowDragStart(index, e) {
  if (props.disabled || props.lines.length < 2) {
    e.preventDefault()
    return
  }
  dragFrom.value = index
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', String(index))
}

function onRowDragOver(e) {
  if (dragFrom.value < 0) return
  e.dataTransfer.dropEffect = 'move'
}

function onRowDrop(index) {
  const from = dragFrom.value
  dragFrom.value = -1
  if (from < 0 || from === index) return
  const next = [...props.lines]
  const [row] = next.splice(from, 1)
  next.splice(index, 0, row)
  emit('update:lines', next)
}

function onRowDragEnd() {
  dragFrom.value = -1
}

watch(() => props.lines.map((l) => l.id).join(','), () => nextTick(resizeAll), { immediate: true })
</script>
