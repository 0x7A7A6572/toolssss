<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted } from 'vue'
import type { StickyNote } from '@shared/sticky-notes'
import { STICKY_NOTES_EVENTS } from '@shared/sticky-notes'
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
  offStickyNotesChanged = window.electron.ipcRenderer.on('sticky-notes:changed', onChanged)
})

let offStickyNotesChanged = (): void => {}

onBeforeUnmount(() => {
  offStickyNotesChanged()
})
</script>

<template>
  <div class="sticky-notes-page">
    <header class="header">
      <span class="title">便签</span>
      <button class="add-btn" @click="addNote"><Plus :size="14" /></button>
    </header>

    <div class="content-area">
      <div v-if="notes.length > 0" class="notes-list">
        <NoteCard
          v-for="item in notes"
          :key="item.id"
          :note="item"
          @update="updateNote"
          @delete="deleteNote"
          @fullscreen="openFullscreen"
        />
      </div>

      <div v-else-if="!loading" class="empty-state">
        <StickyNoteIcon :size="32" />
        <span>暂无便签</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sticky-notes-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  color: rgba(235, 235, 245, 0.85);
  overflow: hidden;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 12px 8px;
  flex-shrink: 0;
}

.title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.3px;
}

.add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(235, 235, 245, 0.7);
  cursor: pointer;
  transition: all 0.2s;
}

.add-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.3);
}

.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
  scrollbar-width: none;
}

.content-area::-webkit-scrollbar {
  display: none;
}

.notes-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  opacity: 0.4;
  font-size: 13px;
  color: rgba(235, 235, 245, 0.6);
}
</style>
