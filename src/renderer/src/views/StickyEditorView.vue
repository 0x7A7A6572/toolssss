<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { StickyNote } from '@shared/sticky-notes'
import { STICKY_NOTES_EVENTS } from '@shared/sticky-notes'
import NoteEditor from './StickyNotes/components/NoteEditor.vue'
import { Check, X } from 'lucide-vue-next'

const params = new URLSearchParams(window.location.search)
const noteId = params.get('id') ?? ''

const note = ref<StickyNote | null>(null)
const content = ref('')
const saving = ref(false)

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
    if (!found) {
      close()
    }
  } catch {
    close()
  }
}

function close(): void {
  // window.close()
  window.electron.ipcRenderer.invoke('sticky-editor:close', { id: noteId }).catch((err) => {
    console.error('关闭便签编辑窗口失败', err)
  })
}

async function save(): Promise<void> {
  if (!note.value) return
  saving.value = true
  try {
    const updated: StickyNote = { ...note.value, content: content.value, updatedAt: Date.now() }
    await window.electron.ipcRenderer.invoke(STICKY_NOTES_EVENTS.SAVE, updated)
    close()
  } finally {
    saving.value = false
  }
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
    save()
  }
}

onMounted(() => {
  load().catch(() => null)
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div v-if="note" class="wrap" :style="{ backgroundColor: note.color }">
    <div class="content">
      <header class="header">
        <div class="title">便签编辑</div>
        <div class="actions">
          <!-- <button class="btn danger" type="button" :disabled="saving" @click="remove">
            <Trash2 :size="18" />
          </button> -->
          <button class="btn primary" type="button" :disabled="saving" @click="save">
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
        <NoteEditor v-model="content" :editable="true" :image-max-height="600" />
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
  padding: 18px 20px 24px;
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
