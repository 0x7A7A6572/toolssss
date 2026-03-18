<script setup lang="ts">
import { ref, watch } from 'vue'
import type { StickyNote } from '@shared/sticky-notes'
import { Trash2, Edit2, Check, X, Maximize2 } from 'lucide-vue-next'
import NoteEditor from './NoteEditor.vue'

const props = defineProps<{
  note: StickyNote
}>()

const emit = defineEmits<{
  (e: 'update', note: StickyNote): void
  (e: 'delete', id: string): void
  (e: 'fullscreen', payload: { note: StickyNote; content: string }): void
}>()

const isEditing = ref(false)
const localContent = ref(props.note.content)

function onEditorUpdate(val: string): void {
  if (isEditing.value) {
    localContent.value = val
  }
}

watch(
  () => props.note.content,
  (val) => {
    if (!isEditing.value) {
      localContent.value = val
    }
  }
)

function startEdit(): void {
  localContent.value = props.note.content
  isEditing.value = true
}

function saveEdit(): void {
  emit('update', { ...props.note, content: localContent.value })
  isEditing.value = false
}

function cancelEdit(): void {
  localContent.value = props.note.content
  isEditing.value = false
}

function openFullscreen(): void {
  emit('fullscreen', { note: props.note, content: localContent.value })
  isEditing.value = false
}
</script>

<template>
  <div class="note-card" :style="{ backgroundColor: note.color }">
    <div class="note-header">
      <span class="date">{{ new Date(note.updatedAt).toLocaleString() }}</span>
      <div class="actions">
        <button class="btn-icon" title="全屏编辑" @click="openFullscreen">
          <Maximize2 :size="16" />
        </button>
        <template v-if="isEditing">
          <button class="btn-icon save" title="保存" @click="saveEdit">
            <Check :size="16" />
          </button>
          <button class="btn-icon cancel" title="取消" @click="cancelEdit">
            <X :size="16" />
          </button>
        </template>
        <template v-else>
          <button class="btn-icon" title="编辑" @click="startEdit">
            <Edit2 :size="16" />
          </button>
          <button class="btn-icon delete" title="删除" @click="$emit('delete', note.id)">
            <Trash2 :size="16" />
          </button>
        </template>
      </div>
    </div>

    <div class="note-body">
      <NoteEditor
        :model-value="isEditing ? localContent : note.content"
        :editable="isEditing"
        :image-max-height="220"
        @update:model-value="onEditorUpdate"
      />
    </div>
  </div>
</template>

<style scoped>
.note-card {
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
  color: #1a1a1a; /* Dark text for light notes */
}

.note-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.note-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  opacity: 0.7;
}

.actions {
  display: flex;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.2s;
}

.note-card:hover .actions,
.note-card:focus-within .actions {
  opacity: 1;
}

.btn-icon {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  border-radius: 4px;
  padding: 4px;
  cursor: pointer;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.4);
}

.btn-icon.delete:hover {
  background: rgba(255, 0, 0, 0.2);
  color: #d32f2f;
}

.btn-icon.save:hover {
  background: rgba(0, 200, 0, 0.2);
  color: #2e7d32;
}

.note-body {
  flex: 1;
  min-height: 100px;
  max-height: 300px;
  overflow-y: auto;
  /* 滑动条透明 */
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.418) transparent;
}

.note-body::-webkit-scrollbar {
  width: 6px;
  background: transparent;
}
</style>
