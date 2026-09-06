<template>
  <div class="tw-unit-picker" :class="{ 'tw-unit-picker--field': variant === 'field' }">
    <input
      v-if="manual"
      ref="inputRef"
      class="tw-unit-picker__input"
      :value="modelValue"
      placeholder="输入单位"
      :disabled="disabled"
      @input="emit('update:modelValue', $event.target.value)"
      @blur="onManualBlur"
      @keydown.enter.prevent="onManualBlur"
      @keydown.escape.prevent="onManualBlur"
    />
    <button
      v-else
      ref="btnRef"
      type="button"
      class="tw-unit-picker__btn"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="tw-unit-picker__text">{{ displayLabel }}</span>
      <span class="tw-unit-picker__caret">▾</span>
    </button>
    <Teleport to="body">
      <div v-if="open" class="tw-unit-picker__layer">
        <div class="tw-unit-picker__mask" @mousedown.prevent="close"></div>
        <div class="tw-unit-picker__panel" :style="panelStyle" @mousedown.stop>
          <div class="tw-unit-picker__grid" :style="gridStyle">
            <button
              v-for="(u, i) in displayOptions"
              :key="`${optValue(u)}-${i}`"
              type="button"
              class="tw-unit-picker__item"
              :class="{ 'is-on': String(optValue(u)) === String(modelValue) }"
              :title="optLabel(u)"
              @click="pick(u)"
            >{{ optLabel(u) }}</button>
          </div>
          <button v-if="allowManual" type="button" class="tw-unit-picker__manual" @click="startManual">── 手动输入 ──</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  columns: { type: Number, default: 2 },
  allowManual: { type: Boolean, default: true },
  placeholder: { type: String, default: '请选择' },
  variant: { type: String, default: 'cell' }
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const manual = ref(false)
const btnRef = ref(null)
const inputRef = ref(null)
const panelStyle = ref({})

function optLabel(u) {
  if (u == null) return ''
  if (typeof u === 'string' || typeof u === 'number') return String(u)
  return String(u.label ?? u.value ?? '')
}

function optValue(u) {
  if (u == null) return ''
  if (typeof u === 'string' || typeof u === 'number') return String(u)
  if (u.value != null) return u.value
  return u.label ?? ''
}

const displayOptions = computed(() => {
  const list = Array.isArray(props.options) ? [...props.options] : []
  const cur = props.modelValue
  if (cur !== '' && cur != null && !list.some((u) => String(optValue(u)) === String(cur))) {
    list.push({ label: String(cur), value: cur })
  }
  return list
})

const colCount = computed(() => Math.max(1, Number(props.columns) || 1))

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${colCount.value}, minmax(0, 1fr))`
}))

const displayLabel = computed(() => {
  const hit = displayOptions.value.find((u) => String(optValue(u)) === String(props.modelValue))
  if (hit) return optLabel(hit)
  const cur = String(props.modelValue ?? '').trim()
  return cur || props.placeholder
})

function close() {
  open.value = false
}

function place() {
  const el = btnRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const cols = colCount.value
  const width = cols >= 2 ? Math.max(300, rect.width) : Math.max(rect.width, 180)
  let left = rect.left
  if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8)
  const below = window.innerHeight - rect.bottom - 10
  const above = rect.top - 10
  const openUp = below < 220 && above > below
  const maxH = Math.min(360, Math.max(160, openUp ? above : below))
  panelStyle.value = {
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${maxH}px`,
    ...(openUp
      ? { bottom: `${window.innerHeight - rect.top + 4}px`, top: 'auto' }
      : { top: `${rect.bottom + 4}px`, bottom: 'auto' })
  }
}

function toggle() {
  if (props.disabled) return
  if (open.value) {
    close()
    return
  }
  place()
  open.value = true
}

function pick(u) {
  emit('update:modelValue', optValue(u))
  close()
}

async function startManual() {
  close()
  manual.value = true
  await nextTick()
  inputRef.value && inputRef.value.focus()
}

function onManualBlur() {
  manual.value = false
}

function onWin() {
  if (open.value) place()
}

function onKey(e) {
  if (e.key === 'Escape' && open.value) close()
}

window.addEventListener('resize', onWin)
window.addEventListener('scroll', onWin, true)
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWin)
  window.removeEventListener('scroll', onWin, true)
  window.removeEventListener('keydown', onKey)
})
</script>
