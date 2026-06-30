<script setup lang="ts">
import { computed, ref } from 'vue'
import ShortcutInput from '@renderer/components/ShortcutInput.vue'
import AppSwitch from '@renderer/components/AppSwitch.vue'
import ShortcutConflictModal from '../modals/ShortcutConflictModal.vue'
import { useSettingsForm } from '../composables/useSettingsForm'

const { settings, update } = useSettingsForm()

type ShortcutConflictItem = { key: string; label: string }

const shortcutLabels: Record<string, string> = {
  toggleEye: '开启/关闭护眼模式',
  translateSelection: '划词翻译弹窗',
  stickyNotesPopup: '弹出快捷便签',
  snipStart: '开始截图',
  stickerPaste: '剪贴板贴图',
  stickersToggleHidden: '隐藏/显示所有贴图',
  stashLeft: '收纳到左侧',
  stashTop: '收纳到上侧',
  stashRight: '收纳到右侧',
  stashBottom: '收纳到下侧',
  toggleTopmostWindow: '置顶/取消置顶（鼠标指向窗口）'
}

const shortcutConflict = ref<{
  targetKey: string
  targetLabel: string
  value: string
  conflicts: ShortcutConflictItem[]
} | null>(null)

function getShortcutLabel(key: string): string {
  return shortcutLabels[key] ?? key
}

function isShortcutEnabled(key: string): boolean {
  const se = (settings.value as unknown as { shortcutsEnabled?: unknown }).shortcutsEnabled
  if (!se || typeof se !== 'object') return true
  const v = (se as Record<string, unknown>)[key]
  return typeof v === 'boolean' ? v : true
}

async function onShortcutEnabledChange(key: string, enabled: boolean): Promise<void> {
  await update({ shortcutsEnabled: { [key]: enabled } }).catch(() => null)
}

function findShortcutConflicts(targetKey: string, value: string): ShortcutConflictItem[] {
  const sc = settings.value.shortcuts ?? {}
  const conflicts: ShortcutConflictItem[] = []
  for (const [k, v] of Object.entries(sc)) {
    if (k === targetKey) continue
    if (!isShortcutEnabled(k)) continue
    if (v !== value) continue
    conflicts.push({ key: k, label: getShortcutLabel(k) })
  }
  return conflicts
}

async function applyShortcutReplace(): Promise<void> {
  const state = shortcutConflict.value
  if (!state) return
  const patch: Record<string, string> = { [state.targetKey]: state.value }
  for (const c of state.conflicts) patch[c.key] = ''
  shortcutConflict.value = null
  await update({ shortcuts: patch }).catch(() => null)
}

async function onShortcutChange(targetKey: string, nextValue: string): Promise<void> {
  const v = nextValue.trim()
  const current = (settings.value.shortcuts?.[targetKey] ?? '').trim()
  if (v === current) return

  if (!v) {
    await update({ shortcuts: { [targetKey]: '' } }).catch(() => null)
    return
  }

  const conflicts = findShortcutConflicts(targetKey, v)
  if (!conflicts.length) {
    await update({ shortcuts: { [targetKey]: v } }).catch(() => null)
    return
  }

  shortcutConflict.value = {
    targetKey,
    targetLabel: getShortcutLabel(targetKey),
    value: v,
    conflicts
  }
}

type ShortcutConflictGroup = {
  value: string
  items: ShortcutConflictItem[]
}

const shortcutConflictGroups = computed<ShortcutConflictGroup[]>(() => {
  const sc = settings.value.shortcuts ?? {}
  const accToKeys = new Map<string, string[]>()
  for (const [k, v] of Object.entries(sc)) {
    if (!isShortcutEnabled(k)) continue
    const acc = v.trim()
    if (!acc) continue
    const list = accToKeys.get(acc)
    if (list) list.push(k)
    else accToKeys.set(acc, [k])
  }

  const groups: ShortcutConflictGroup[] = []
  for (const [acc, keys] of accToKeys.entries()) {
    if (keys.length <= 1) continue
    groups.push({
      value: acc,
      items: keys.map((k) => ({ key: k, label: getShortcutLabel(k) }))
    })
  }

  groups.sort((a, b) => a.value.localeCompare(b.value))
  return groups
})

const shortcutConflictKeySet = computed(() => {
  const set = new Set<string>()
  for (const g of shortcutConflictGroups.value) {
    for (const it of g.items) set.add(it.key)
  }
  return set
})

function hasExistingShortcutConflict(key: string): boolean {
  return shortcutConflictKeySet.value.has(key)
}

const shortcutKeys = Object.keys(shortcutLabels)
</script>

<template>
  <div class="settings-section">
    <div class="section-card">
      <div class="card-head">
        <div class="card-title">全局快捷键</div>
      </div>

      <a-alert message="点击快捷键进行录制，支持 Ctrl, Alt, Shift 组合" type="info" show-icon />

      <div v-if="shortcutConflictGroups.length" class="conflict-summary">
        <div class="conflict-summary-title">检测到快捷键冲突</div>
        <div v-for="g in shortcutConflictGroups" :key="g.value" class="conflict-summary-item">
          <div class="conflict-summary-key">{{ g.value }}</div>
          <div class="conflict-summary-actions">
            <span v-for="it in g.items" :key="it.key" class="conflict-summary-action">
              {{ it.label }}
            </span>
          </div>
        </div>
      </div>

      <div v-for="key in shortcutKeys" :key="key" class="row">
        <div class="label shortcut-label">
          <span>{{ shortcutLabels[key] }}</span>
          <span v-if="hasExistingShortcutConflict(key)" class="conflict-badge">冲突</span>
        </div>
        <div class="shortcut-actions">
          <ShortcutInput
            :model-value="(settings.shortcuts as Record<string, string>)[key] ?? ''"
            :disabled="!isShortcutEnabled(key)"
            placeholder="未设置"
            @update:model-value="onShortcutChange(key, $event)"
          />
          <AppSwitch
            :model-value="isShortcutEnabled(key)"
            @update:model-value="onShortcutEnabledChange(key, $event)"
          />
        </div>
      </div>
    </div>

    <ShortcutConflictModal
      :open="shortcutConflict !== null"
      :target-label="shortcutConflict?.targetLabel ?? ''"
      :value="shortcutConflict?.value ?? ''"
      :conflicts="shortcutConflict?.conflicts ?? []"
      @replace="applyShortcutReplace"
      @cancel="shortcutConflict = null"
    />
  </div>
</template>

<style lang="scss" scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-card {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ev-c-text-1);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
}

.label {
  font-size: 13px;
  color: var(--ev-c-text-2);
  flex: 1;
}

.shortcut-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.shortcut-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.conflict-badge {
  font-size: 12px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.14);
  color: rgba(255, 255, 245, 0.92);
}

.conflict-summary {
  border: 1px solid rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conflict-summary-title {
  font-size: 12px;
  font-weight: 900;
  color: rgba(255, 255, 245, 0.92);
}

.conflict-summary-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.conflict-summary-key {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 900;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.12);
  color: rgba(255, 255, 245, 0.92);
  padding: 2px 8px;
  border-radius: 999px;
}

.conflict-summary-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.conflict-summary-action {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.12);
  color: rgba(255, 255, 245, 0.9);
}
</style>
