<template>
  <el-dialog v-model="open" title="明细列与单位" width="720px" append-to-body destroy-on-close class="tw-col-dialog tw-mobile-dialog" @closed="emit('closed')">
    <p class="tw-muted" style="margin:0 0 10px;font-size:12px">关闭的列在开单、明细和打印中同步隐藏，可改对齐。</p>
    <el-form label-position="top" class="tw-form tw-col-unit">
      <el-form-item label="尺寸录入单位">
        <p class="tw-muted" style="margin:0 0 6px;font-size:12px">宽高按此单位录入，库内仍存毫米。</p>
        <el-select v-model="dimUnit" size="small" style="width:220px">
          <el-option v-for="u in DIMENSION_UNITS" :key="u.value" :label="u.label" :value="u.value" />
        </el-select>
      </el-form-item>
    </el-form>
    <div class="tw-col-list">
      <div class="tw-col-row tw-col-row--head">
        <span></span>
        <span>列名</span>
        <span>对齐</span>
      </div>
      <div v-for="col in cols" :key="col.key" class="tw-col-row">
        <el-checkbox v-model="col.visible" :disabled="locked(col.key)" />
        <el-input v-model="col.label" size="small" maxlength="40" />
        <el-select v-model="col.align" size="small">
          <el-option v-for="a in COLUMN_ALIGNS" :key="a.value" :label="a.label" :value="a.value" />
        </el-select>
      </div>
    </div>
    <el-form label-position="top" class="tw-form" style="margin-top:12px">
      <el-form-item label="规格快捷项（每行一项）">
        <el-input v-model="specText" type="textarea" :rows="3" placeholder="例如：&#10;10mm PVC+UV&#10;5mm 亚克力" />
      </el-form-item>
      <el-form-item label="材质快捷项（每行一项）">
        <el-input v-model="materialText" type="textarea" :rows="3" placeholder="例如：&#10;PVC&#10;亚克力" />
      </el-form-item>
      <el-form-item label="单位额外选项（每行一项，追加到快捷列表）">
        <p class="tw-muted" style="margin:0 0 6px;font-size:12px">仅名称一行即可；需要指定计价公式时写：名称|面积、名称|件、名称|米。</p>
        <el-input v-model="unitText" type="textarea" :rows="3" placeholder="例如：&#10;灯布卷|米&#10;水晶字|件" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button size="small" @click="resetCols">恢复默认列</el-button>
      <el-button size="small" @click="open = false">取消</el-button>
      <el-button size="small" type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import {
  COLUMN_ALIGNS,
  DIMENSION_UNITS,
  LINE_COLUMN_DEFS,
  applyDimensionColumnLabels,
  defaultLineColumns,
  dimensionUnitOf,
  normalizeColumnAlign,
  normalizeDimensionUnit,
  normalizeLineColumns,
  parsePresetLines
} from '../../utils/tuwen-yewu.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  settings: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['update:modelValue', 'save', 'closed'])

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})
const cols = ref(defaultLineColumns())
const specText = ref('')
const materialText = ref('')
const unitText = ref('')
const dimUnit = ref('mm')

function locked(key) {
  return !!(LINE_COLUMN_DEFS[key] && LINE_COLUMN_DEFS[key].lockVisible)
}

function asText(list) {
  return (Array.isArray(list) ? list : []).join('\n')
}

function hydrate() {
  dimUnit.value = dimensionUnitOf(props.settings)
  cols.value = applyDimensionColumnLabels(
    normalizeLineColumns(props.settings && props.settings.orderLineColumns).map((c) => ({
      ...c,
      align: normalizeColumnAlign(c.align)
    })),
    dimUnit.value
  )
  specText.value = asText(props.settings && props.settings.orderLineSpecPresets)
  materialText.value = asText(props.settings && props.settings.orderLineMaterialPresets)
  unitText.value = asText(props.settings && props.settings.orderLineUnitExtraLabels)
}

watch(() => props.modelValue, (v) => { if (v) hydrate() })
watch(dimUnit, (u) => {
  cols.value = applyDimensionColumnLabels(cols.value, u)
})

function resetCols() {
  cols.value = applyDimensionColumnLabels(defaultLineColumns(), dimUnit.value)
}

function save() {
  const unit = normalizeDimensionUnit(dimUnit.value)
  emit('save', {
    dimensionUnit: unit,
    orderLineColumns: applyDimensionColumnLabels(normalizeLineColumns(cols.value), unit),
    orderLineSpecPresets: parsePresetLines(specText.value, 120, 80),
    orderLineMaterialPresets: parsePresetLines(materialText.value, 120, 80),
    orderLineUnitExtraLabels: parsePresetLines(unitText.value, 40, 56)
  })
  open.value = false
}
</script>
