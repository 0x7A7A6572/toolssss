<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { watch, onBeforeUnmount } from 'vue'

const props = defineProps<{
  modelValue: string
  editable?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const editor = useEditor({
  content: props.modelValue,
  editable: props.editable ?? true,
  extensions: [StarterKit],
  onUpdate: () => {
    if (editor.value) {
      emit('update:modelValue', editor.value.getHTML())
    }
  },
  editorProps: {
    attributes: {
      class: 'prose prose-invert max-w-none focus:outline-none min-h-[100px]'
    }
  }
})

watch(
  () => props.modelValue,
  (newValue) => {
    if (editor.value && editor.value.getHTML() !== newValue) {
      editor.value.commands.setContent(newValue)
    }
  }
)

watch(
  () => props.editable,
  (val) => {
    if (editor.value) {
      editor.value.setEditable(val ?? true)
    }
  }
)

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<template>
  <div class="note-editor">
    <editor-content :editor="editor" />
  </div>
</template>

<style scoped>
.note-editor {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}

:deep(.ProseMirror) {
  outline: none;
  min-height: 100px;
  color: inherit;
}

:deep(p) {
  margin: 0.5em 0;
}

:deep(ul),
:deep(ol) {
  padding-left: 1.5em;
  margin: 0.5em 0;
}

:deep(blockquote) {
  border-left: 3px solid rgba(255, 255, 255, 0.3);
  padding-left: 1em;
  margin: 0.5em 0;
  opacity: 0.8;
}

:deep(code) {
  background: rgba(255, 255, 255, 0.1);
  padding: 0.2em 0.4em;
  border-radius: 4px;
  font-family: monospace;
}
</style>
