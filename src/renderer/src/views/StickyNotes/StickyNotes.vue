<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { StickyNote } from '@shared/sticky-notes'
import { STICKY_NOTES_EVENTS } from '@shared/sticky-notes'
import { MasonryWall } from '@yeger/vue-masonry-wall'
import NoteCard from './components/NoteCard.vue'
import { Plus, StickyNote as StickyNoteIcon } from 'lucide-vue-next'
import confirm from '../../utils/confirm'

const notes = ref<StickyNote[]>([])
const loading = ref(true)

function onChanged(_: unknown, payload: unknown): void {
  const list = payload as StickyNote[]
  if (Array.isArray(list)) {
    notes.value = list
    sortNotes()
  }
}

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
  window.electron.ipcRenderer
    .invoke('sticky-editor:open', { id: payload.note.id })
    .catch(() => null)
}

onMounted(() => {
  loadNotes()
  window.electron.ipcRenderer.on('sticky-notes:changed', onChanged)
})

// onBeforeUnmount(() => {
//   window.electron.ipcRenderer.removeListener('sticky-notes:changed', onChanged)
// })
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
</style>
