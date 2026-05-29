<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    disabled?: boolean
    ariaLabel?: string
  }>(),
  {
    disabled: false,
    ariaLabel: ''
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'change', value: boolean): void
}>()

const checked = ref(Boolean(props.modelValue))

watch(
  () => props.modelValue,
  (v) => {
    checked.value = Boolean(v)
  }
)

function onChange(e: Event): void {
  const v = Boolean((e.target as HTMLInputElement | null)?.checked)
  checked.value = v
  emit('update:modelValue', v)
  emit('change', v)
}
</script>

<template>
  <label class="app-switch" :class="{ 'app-switch--disabled': disabled }">
    <input
      type="checkbox"
      :checked="checked"
      :disabled="disabled"
      :aria-label="ariaLabel || undefined"
      @change="onChange"
    />
    <span class="app-switch__slider" />
  </label>
</template>

<style scoped>
.app-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 20px;
  justify-self: end;
}

.app-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.app-switch__slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(90deg, #8989898e 30%, transparent);
  transition: 0.2s;
  border-radius: 15%;
}

.app-switch__slider:before {
  position: absolute;
  content: '';
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background: #d5d5d5;
  transition: 0.2s;
  border-radius: 15%;
}

.app-switch input:checked + .app-switch__slider {
  background: linear-gradient(267deg, var(--ev-c-theme) 30%, transparent);
}

.app-switch input:checked + .app-switch__slider:before {
  transform: translateX(20px);
  background: white;
}

.app-switch--disabled .app-switch__slider {
  cursor: not-allowed;
}

.app-switch input:disabled + .app-switch__slider {
  opacity: var(--ev-control-disabled-opacity);
  cursor: not-allowed;
}
</style>
