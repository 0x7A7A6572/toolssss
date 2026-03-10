<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { StickyNote } from '@shared/sticky-notes'
import { STICKY_NOTES_EVENTS } from '@shared/sticky-notes'
import { MasonryWall } from '@yeger/vue-masonry-wall'
import NoteCard from './components/NoteCard.vue'
import NoteEditor from './components/NoteEditor.vue'
import { Plus, Check, X, Trash2, StickyNote as StickyNoteIcon } from 'lucide-vue-next'
import confirm from '../../utils/confirm'

const notes = ref<StickyNote[]>([])
const loading = ref(true)
const fullscreenNote = ref<StickyNote | null>(null)
const fullscreenContent = ref('')
const fullscreenSaving = ref(false)

function sortNotes(): void {
  notes.value.sort((a, b) => b.updatedAt - a.updatedAt)
}

// A palette of nice sticky note colors
const colors = [
  '#FFF8B8', // Yellow
  '#E2F0CB', // Green
  '#F0E6EF', // Purple
  '#E0F7FA', // Blue
  '#FFCCBC', // Orange
  '#FFCDD2', // Red
  '#F5F5F5' // White
]

async function loadNotes(): Promise<void> {
  loading.value = true
  try {
    const result = await window.electron.ipcRenderer.invoke(STICKY_NOTES_EVENTS.GET_ALL)
    notes.value = result
    sortNotes()
  } catch (e) {
    console.error('Failed to load notes:', e)
  } finally {
    loading.value = false
  }
}

async function addNote(): Promise<void> {
  const newNote: StickyNote = {
    id: crypto.randomUUID(),
    content: '',
    color: colors[Math.floor(Math.random() * colors.length)],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  // Optimistic update
  notes.value.unshift(newNote)
  sortNotes()

  try {
    const updatedNotes = await window.electron.ipcRenderer.invoke(STICKY_NOTES_EVENTS.SAVE, newNote)
    // We update the list from server to ensure sync, but we might want to keep the local optimistic one if user is editing immediately?
    // Actually the save returns the full list.
    notes.value = updatedNotes
    sortNotes()
  } catch (e) {
    console.error('Failed to add note:', e)
    // Revert if failed
    notes.value = notes.value.filter((n) => n.id !== newNote.id)
    sortNotes()
  }
}

async function updateNote(note: StickyNote): Promise<void> {
  // Find and update locally first
  const index = notes.value.findIndex((n) => n.id === note.id)
  if (index !== -1) {
    notes.value[index] = note
    sortNotes()
  }

  try {
    const updatedNotes = await window.electron.ipcRenderer.invoke(STICKY_NOTES_EVENTS.SAVE, note)
    notes.value = updatedNotes
    sortNotes()
  } catch (e) {
    console.error('Failed to update note:', e)
    loadNotes() // Revert to server state
  }
}

async function deleteNote(id: string): Promise<void> {
  const ok = await confirm('确定要删除这个便签吗？', { title: '删除便签' })
  if (!ok) return

  // Optimistic update
  notes.value = notes.value.filter((n) => n.id !== id)
  sortNotes()

  try {
    const updatedNotes = await window.electron.ipcRenderer.invoke(STICKY_NOTES_EVENTS.DELETE, id)
    notes.value = updatedNotes
    sortNotes()
  } catch (e) {
    console.error('Failed to delete note:', e)
    loadNotes() // Revert to server state
  }
}

function openFullscreen(payload: { note: StickyNote; content: string }): void {
  fullscreenNote.value = { ...payload.note }
  fullscreenContent.value = payload.content
}

function closeFullscreen(): void {
  fullscreenNote.value = null
  fullscreenContent.value = ''
  fullscreenSaving.value = false
}

async function saveFullscreen(): Promise<void> {
  if (!fullscreenNote.value) return
  fullscreenSaving.value = true
  try {
    await updateNote({ ...fullscreenNote.value, content: fullscreenContent.value })
    closeFullscreen()
  } finally {
    fullscreenSaving.value = false
  }
}

async function deleteFullscreen(): Promise<void> {
  if (!fullscreenNote.value) return
  await deleteNote(fullscreenNote.value.id)
  closeFullscreen()
}

onMounted(() => {
  loadNotes()
})
</script>

<template>
  <div class="sticky-notes-page">
    <header class="header">
      <h1 class="title">我的便签</h1>
      <button class="add-btn" @click="addNote"><Plus :size="18" /> 新建便签</button>
    </header>

    <div class="content-area">
      <MasonryWall :items="notes" :ssr-columns="1" :column-width="280" :gap="16">
        <template #default="{ item }">
          <NoteCard
            :note="item"
            @update="updateNote"
            @delete="deleteNote"
            @fullscreen="openFullscreen"
          />
        </template>
      </MasonryWall>

      <div v-if="notes.length === 0 && !loading" class="empty-state">
        <div class="empty-icon">
          <StickyNoteIcon :size="148" />
        </div>
        <p>还没有便签</p>
        <p class="sub-text">点击右上角创建一个吧</p>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="fullscreenNote" class="fullscreen-overlay">
      <div class="fullscreen-modal" :style="{ backgroundColor: fullscreenNote.color }">
        <header class="fullscreen-header">
          <div class="fullscreen-title">便签编辑</div>
          <div class="fullscreen-actions">
            <button
              class="fs-btn primary"
              type="button"
              :disabled="fullscreenSaving"
              @click="saveFullscreen"
            >
              <Check :size="18" />
              保存
            </button>
            <button
              class="fs-btn danger"
              type="button"
              :disabled="fullscreenSaving"
              @click="deleteFullscreen"
            >
              <Trash2 :size="18" />
              删除
            </button>
            <button
              class="fs-btn"
              type="button"
              :disabled="fullscreenSaving"
              @click="closeFullscreen"
            >
              <X :size="18" />
              关闭
            </button>
          </div>
        </header>

        <div class="fullscreen-body">
          <NoteEditor v-model="fullscreenContent" :editable="true" :image-max-height="600" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sticky-notes-page {
  height: 100vh;
  display: flex;
  flex-direction: column;

  color: var(--color-text);
  overflow: hidden;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
  flex-shrink: 0;
}

.title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.add-btn {
  background: var(--ev-c-theme);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  transition: background-color 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.add-btn:hover {
  background: #2563eb; /* Blue-600 */
}

.content-area {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 40px;
  /* Hide scrollbar for cleaner look */
  scrollbar-width: none;
  padding-top: 20px;
}

.content-area::-webkit-scrollbar {
  display: none;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60%;
  opacity: 0.6;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.sub-text {
  font-size: 14px;
  margin-top: 8px;
  opacity: 0.7;
}

.fullscreen-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  z-index: 9999;
}

.fullscreen-modal {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  color: #111827;
}

.fullscreen-header {
  flex-shrink: 0;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}

.fullscreen-title {
  font-size: 16px;
  font-weight: 800;
}

.fullscreen-actions {
  display: flex;
  gap: 10px;
}

.fs-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  background: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  font-weight: 700;
}

.fs-btn:hover {
  background: rgba(255, 255, 255, 0.8);
}

.fs-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.fs-btn.primary {
  background: rgba(34, 197, 94, 0.18);
  border-color: rgba(34, 197, 94, 0.35);
}

.fs-btn.primary:hover {
  background: rgba(34, 197, 94, 0.25);
}

.fs-btn.danger {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.3);
}

.fs-btn.danger:hover {
  background: rgba(239, 68, 68, 0.22);
}

.fullscreen-body {
  flex: 1;
  padding: 18px 20px 24px;
  overflow: auto;
}
</style>
