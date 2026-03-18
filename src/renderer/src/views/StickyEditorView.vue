<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { StickyNote } from '@shared/sticky-notes'
import { STICKY_NOTES_EVENTS } from '@shared/sticky-notes'
import NoteEditor from './StickyNotes/components/NoteEditor.vue'
import { Check, X } from 'lucide-vue-next'

const AUTO_SAVE_INTERVAL_MS = 5000
const PRESET_COLORS = [
  '#FFF8B8',
  '#E2F0CB',
  '#F0E6EF',
  '#E0F7FA',
  '#FFCCBC',
  '#FFCDD2',
  '#F5F5F5',
  '#FFE4B5',
  '#D6E4FF',
  '#E6FFFA'
] as const

const params = new URLSearchParams(window.location.search)
const noteId = params.get('id') ?? ''

const note = ref<StickyNote | null>(null)
const content = ref('')
const saving = ref(false)
const lastSavedState = ref<{ content: string; color: string }>({ content: '', color: '' })
let autoSaveTimer: number | null = null
let pendingSave = false
let activeSave: Promise<void> | null = null

function hasUnsavedChanges(): boolean {
  if (!note.value) return false
  return (
    content.value !== lastSavedState.value.content ||
    note.value.color !== lastSavedState.value.color
  )
}

function setColor(color: string): void {
  if (!note.value) return
  if (note.value.color === color) return
  note.value = { ...note.value, color }
}

async function load(): Promise<void> {
  if (!noteId) {
    close()
    return
  }
  try {
    const result = (await window.electron.ipcRenderer.invoke(
      STICKY_NOTES_EVENTS.GET_ALL
    )) as StickyNote[]
    const found = result.find((n) => n.id === noteId) ?? null
    note.value = found
    content.value = found?.content ?? ''
    lastSavedState.value = { content: content.value, color: found?.color ?? '' }
    if (!found) {
      close()
    }
  } catch {
    close()
  }
}

function requestClose(): void {
  // window.close()
  window.electron.ipcRenderer.invoke('sticky-editor:close', { id: noteId }).catch((err) => {
    console.error('关闭便签编辑窗口失败', err)
  })
}

async function saveNow(): Promise<void> {
  if (!note.value) return
  if (activeSave) {
    if (hasUnsavedChanges()) pendingSave = true
    await activeSave.catch(() => null)
    if (pendingSave) {
      pendingSave = false
      await saveNow()
    }
    return
  }

  if (!hasUnsavedChanges()) return

  const base = note.value
  const nextContent = content.value
  const nextColor = base.color
  const updated: StickyNote = {
    ...base,
    content: nextContent,
    color: nextColor,
    updatedAt: Date.now()
  }

  saving.value = true
  activeSave = window.electron.ipcRenderer.invoke(STICKY_NOTES_EVENTS.SAVE, updated).then(() => {
    note.value = updated
    lastSavedState.value = { content: nextContent, color: nextColor }
  })

  try {
    await activeSave
  } finally {
    activeSave = null
    saving.value = false
  }

  if (pendingSave) {
    pendingSave = false
    await saveNow()
  }
}

async function saveAndClose(): Promise<void> {
  if (!note.value) {
    requestClose()
    return
  }
  await saveNow()
  requestClose()
}

async function close(): Promise<void> {
  if (note.value) await saveNow().catch(() => null)
  requestClose()
}

// async function remove(): Promise<void> {
//   if (!note.value) return
//   const ok = await confirm('确定要删除这个便签吗？', { title: '删除便签' })
//   if (!ok) return
//   await window.electron.ipcRenderer.invoke(STICKY_NOTES_EVENTS.DELETE, note.value.id)
//   close()
// }

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    saveAndClose()
  }
}

onMounted(() => {
  load().catch(() => null)
  window.addEventListener('keydown', onKeyDown)
  autoSaveTimer = window.setInterval(() => {
    saveNow().catch(() => null)
  }, AUTO_SAVE_INTERVAL_MS)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (autoSaveTimer !== null) {
    window.clearInterval(autoSaveTimer)
    autoSaveTimer = null
  }
  saveNow().catch(() => null)
})

watch(
  content,
  () => {
    if (activeSave) pendingSave = true
  },
  { flush: 'sync' }
)

watch(
  () => note.value?.color,
  () => {
    if (activeSave) pendingSave = true
  },
  { flush: 'sync' }
)
</script>

<template>
  <div v-if="note" class="wrap" :style="{ backgroundColor: note.color }">
    <div class="content">
      <header class="header">
        <div class="title">便签编辑</div>
        <div class="actions">
          <div class="palette">
            <button
              v-for="c in PRESET_COLORS"
              :key="c"
              type="button"
              class="swatch"
              :class="{ active: note.color === c }"
              :style="{ backgroundColor: c }"
              :title="c"
              @click="setColor(c)"
            />
          </div>
          <!-- <button class="btn danger" type="button" :disabled="saving" @click="remove">
            <Trash2 :size="18" />
          </button> -->
          <button class="btn primary" type="button" :disabled="saving" @click="saveAndClose">
            <Check :size="18" />
            <!-- 保存 -->
          </button>
          <button class="btn" type="button" :disabled="saving" @click="close">
            <X :size="18" />
            <!-- 关闭 -->
          </button>
        </div>
      </header>
      <div class="body">
        <NoteEditor
          v-model="content"
          :editable="true"
          :image-max-height="600"
          :show-toolbar="true"
          :autofocus="true"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  color: #111827;
}

.content {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  margin: 0 auto;
}

.header {
  flex-shrink: 0;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  -webkit-app-region: drag;
}
.title {
  font-size: 16px;
  font-weight: 800;
}
.actions {
  display: flex;
  gap: 10px;
  -webkit-app-region: no-drag;
}
.palette {
  display: flex;
  align-items: center;
  gap: 8px;
}
.swatch {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  border: 2px solid rgba(0, 0, 0, 0.22);
  padding: 0;
  cursor: pointer;
  opacity: 0.9;
}
.swatch:hover {
  opacity: 1;
}
.swatch.active {
  border-color: rgba(37, 99, 235, 0.75);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.25);
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  /* border: 1px solid rgba(0, 0, 0, 0.15); */
  /* background: rgba(255, 255, 255, 0.6); */
  background-color: transparent;
  border: none;
  color: #111827b3;
  cursor: pointer;
  font-weight: 700;
  -webkit-app-region: no-drag;
}
.btn:hover {
  background: rgba(255, 255, 255, 0.8);
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
/* .btn.primary {
  background: rgba(34, 197, 94, 0.18);
  border-color: rgba(34, 197, 94, 0.35);
}
.btn.primary:hover {
  background: rgba(34, 197, 94, 0.25);
}
.btn.danger {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.3);
}
.btn.danger:hover {
  background: rgba(239, 68, 68, 0.22);
} */
.body {
  flex: 1;
  min-height: 0;
  padding: 0 0 24px 0;
  overflow: auto;
}
</style>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
}
</style>
