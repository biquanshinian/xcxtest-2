<template>
  <el-date-picker
    class="tw-date-picker"
    popper-class="tw-date-popper"
    type="date"
    format="YYYY-MM-DD"
    value-format="YYYY-MM-DD"
    :model-value="modelValue || null"
    :placeholder="placeholder"
    :disabled="disabled"
    :clearable="clearable"
    :size="size"
    :editable="false"
    @update:model-value="onInput"
  />
</template>

<script setup>
defineProps({
  modelValue: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  clearable: { type: Boolean, default: true },
  placeholder: { type: String, default: '选择日期' },
  size: { type: String, default: 'default' }
})
const emit = defineEmits(['update:modelValue', 'change'])

function onInput(v) {
  const next = v ? String(v) : ''
  emit('update:modelValue', next)
  emit('change', next)
}
</script>
