<script setup lang="ts">
type ShortcutConflictItem = { key: string; label: string }

defineProps<{
  open: boolean
  targetLabel: string
  value: string
  conflicts: ShortcutConflictItem[]
}>()

const emit = defineEmits<{
  (e: 'replace'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <a-modal :open="open" centered :footer="null" @cancel="emit('cancel')">
    <div class="conflict-modal">
      <div class="conflict-header">
        <div class="conflict-title">快捷键冲突</div>
        <div class="conflict-subtitle">{{ value }} 已被占用</div>
      </div>

      <div class="conflict-body">
        <div class="conflict-section-title">当前占用</div>
        <div class="conflict-list">
          <div v-for="c in conflicts" :key="c.key" class="conflict-item">
            {{ c.label }}
          </div>
        </div>

        <div class="conflict-section-title">将要设置为</div>
        <div class="conflict-target">{{ targetLabel }}</div>
        <div class="conflict-hint">选择「替换」会清除上面所有占用项的绑定。</div>
      </div>

      <div class="conflict-footer">
        <a-button type="primary" @click="emit('replace')">替换</a-button>
        <a-button @click="emit('cancel')">取消</a-button>
      </div>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
.conflict-modal {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.conflict-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.conflict-title {
  font-size: 16px;
  font-weight: 800;
  color: rgba(255, 255, 245, 0.92);
}

.conflict-subtitle {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.65);
}

.conflict-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conflict-section-title {
  font-size: 12px;
  font-weight: 800;
  color: rgba(235, 235, 245, 0.82);
}

.conflict-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.conflict-item {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.18);
  font-size: 13px;
  color: rgba(255, 255, 245, 0.9);
}

.conflict-target {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(34, 230, 234, 0.25);
  background: rgba(34, 230, 234, 0.08);
  font-size: 13px;
  font-weight: 800;
  color: rgba(255, 255, 245, 0.92);
}

.conflict-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
}

.conflict-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}
</style>
