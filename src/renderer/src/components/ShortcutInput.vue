<script setup lang="ts">
import { computed, ref } from 'vue'
import { Pencil } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const isRecording = ref(false)
const recordedKeys = ref<Set<string>>(new Set())
const displayKeys = ref<string[]>([])

// Mapping from DOM key to Electron Accelerator
const KEY_MAP: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Space: 'Space',
  Meta: 'Super', // Windows key
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift'
}

// Keys to ignore as main triggers (modifiers are handled separately)
const IGNORED_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])

const currentShortcutDisplay = computed(() => {
  if (!props.modelValue) return []
  return props.modelValue.split('+')
})

function onDisplayClick(): void {
  if (props.disabled) return
  startRecording()
}

function startRecording(): void {
  isRecording.value = true
  recordedKeys.value.clear()
  displayKeys.value = []
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
}

function stopRecording(): void {
  isRecording.value = false
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
}

function onKeyDown(e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()

  const keys = new Set<string>()
  if (e.metaKey) keys.add('Super')
  if (e.ctrlKey) keys.add('Ctrl')
  if (e.altKey) keys.add('Alt')
  if (e.shiftKey) keys.add('Shift')

  // Handle main key
  let mainKey = ''
  if (!IGNORED_KEYS.has(e.key)) {
    if (KEY_MAP[e.code]) {
      mainKey = KEY_MAP[e.code]
    } else if (e.code.startsWith('Key')) {
      mainKey = e.code.slice(3)
    } else if (e.code.startsWith('Digit')) {
      mainKey = e.code.slice(5)
    } else if (e.code.startsWith('F') && e.code.length <= 3) {
      mainKey = e.code
    } else {
      // Fallback for special chars
      const key = e.key.toUpperCase()
      mainKey = KEY_MAP[key] || key
    }
  }

  if (mainKey) keys.add(mainKey)

  // Update display
  displayKeys.value = Array.from(keys)
  recordedKeys.value = keys
}

function onKeyUp(e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()
  // We only care about keydown for combo composition
}

function save(): void {
  if (recordedKeys.value.size > 0) {
    // Sort keys: Modifiers first, then main key
    const modifiers = ['Super', 'Ctrl', 'Alt', 'Shift']
    const sorted = Array.from(recordedKeys.value).sort((a, b) => {
      const ia = modifiers.indexOf(a)
      const ib = modifiers.indexOf(b)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return 0
    })

    // Electron prefers 'CommandOrControl' for cross-platform
    // But here we just save what user pressed.
    // If user pressed Ctrl on Windows, we save Ctrl.
    // If user pressed Command on Mac, we save Cmd (or Super/Meta).
    // For simplicity, let's map Ctrl to CommandOrControl if on Mac?
    // No, let's stick to explicit keys for now to match the user's physical input.
    // However, if we want cross-platform defaults, we might use CommandOrControl.
    // Let's replace 'Ctrl' with 'CommandOrControl' only if it's the only modifier?
    // No, keep it simple: exact keys.

    // Special handling: if user presses 'Super' (Windows key), Electron might not support it well in all cases,
    // but 'Super' is the accelerator for it.

    emit('update:modelValue', sorted.join('+'))
  }
  stopRecording()
}

function cancel(): void {
  stopRecording()
}

function clear(): void {
  emit('update:modelValue', '')
  stopRecording()
}
</script>

<template>
  <div class="shortcut-input">
    <div class="display" :class="{ disabled: props.disabled }" @click="onDisplayClick">
      <template v-if="currentShortcutDisplay.length > 0">
        <span v-for="k in currentShortcutDisplay" :key="k" class="key-badge small">{{ k }}</span>
      </template>
      <span v-else class="placeholder">{{ placeholder || '点击设置快捷键' }}</span>
      <span class="edit-icon">
        <Pencil :size="12" />
      </span>
    </div>

    <Teleport to="body">
      <div v-if="isRecording" class="modal-overlay" @click.self="cancel">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">激活快捷键</div>
            <div class="modal-subtitle">按组合键以更改此快捷键</div>
          </div>

          <div class="modal-body">
            <div class="keys-display">
              <span v-if="displayKeys.length === 0" class="waiting">按下键盘...</span>
              <span v-for="k in displayKeys" :key="k" class="key-badge large">{{ k }}</span>
            </div>
            <div class="hint">只有以 Windows 键、Ctrl、Alt 或 Shift 开头的快捷键才有效。</div>
          </div>

          <div class="modal-footer">
            <button class="btn primary" @click="save">保存</button>
            <button class="btn" @click="clear">重置</button>
            <button class="btn" @click="cancel">取消</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.shortcut-input {
  display: inline-block;
}

.display {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  cursor: pointer;
  /* min-width: 120px; */
  min-height: 32px;
  justify-content: flex-end;
}

.display:hover {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(255, 255, 255, 0.04);
}

.display.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.display.disabled:hover {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
}

.placeholder {
  color: rgba(255, 255, 255, 0.3);
  font-size: 12px;
  margin-right: auto;
}

.edit-icon {
  font-size: 12px;
  opacity: 0.5;
  margin-left: 8px;
}

.key-badge {
  background: var(--color-text); /* Cyan-ish */
  color: #000;
  font-weight: 600;
  border-radius: 4px;
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.key-badge.small {
  font-size: 12px;
  padding: 2px 6px;
  min-width: 20px;
}

.key-badge.large {
  font-size: 24px;
  padding: 12px 20px;
  min-width: 60px;
  border-radius: 8px;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal {
  background: #1e293b;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  width: 480px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
}

.modal-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.modal-title {
  font-size: 20px;
  font-weight: 600;
  color: #fff;
}

.modal-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
}

.modal-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 20px 0;
}

.keys-display {
  display: flex;
  gap: 12px;
  min-height: 60px;
  align-items: center;
  justify-content: center;
}

.waiting {
  color: rgba(255, 255, 255, 0.2);
  font-size: 16px;
  font-style: italic;
}

.hint {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
}

.modal-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.btn.primary {
  background: var(--color-text);
  color: #000;
  border-color: transparent;
  font-weight: 600;
}

.btn.primary:hover {
  background: #22e6ea;
}
</style>
