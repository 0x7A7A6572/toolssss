<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title?: string
    message: string
    confirmText?: string
    cancelText?: string
  }>(),
  {
    title: '确认操作',
    confirmText: '确定',
    cancelText: '取消'
  }
)
const emit = defineEmits<{
  (e: 'close', ok: boolean): void
}>()
function onCancel(): void {
  emit('close', false)
}
function onConfirm(): void {
  emit('close', true)
}
</script>

<template>
  <div class="confirm-overlay" @click.self="onCancel">
    <div class="confirm-card">
      <div class="confirm-title">{{ props.title }}</div>
      <div class="confirm-message">{{ props.message }}</div>
      <div class="confirm-actions">
        <button class="btn" type="button" @click="onCancel">{{ props.cancelText }}</button>
        <button class="btn primary" type="button" @click="onConfirm">
          {{ props.confirmText }}
        </button>
      </div>
    </div>
  </div>
  <div class="confirm-backdrop" />
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 10000;
}
.confirm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 9999;
}
.confirm-card {
  width: min(420px, calc(100vw - 64px));
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 18px;
  background: rgba(17, 24, 39, 0.9);
  color: var(--ev-c-text-1);
  z-index: 10001;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.confirm-title {
  font-size: 16px;
  font-weight: 700;
}
.confirm-message {
  font-size: 14px;
  color: var(--ev-c-text-2);
  line-height: 1.6;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.btn {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: var(--ev-c-text-1);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}
.btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.btn.primary {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}
.btn.primary:hover {
  background: #2563eb;
  border-color: #2563eb;
}
</style>
