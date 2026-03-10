<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { watch, onBeforeUnmount } from 'vue'

const props = defineProps<{
  modelValue: string
  editable?: boolean
  imageMaxHeight?: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = (e) => reject(e)
    reader.readAsDataURL(file)
  })
}

async function insertImagesFromFiles(files: FileList | File[]): Promise<void> {
  if (!editor.value) return
  const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
  if (list.length === 0) return
  for (const file of list) {
    const dataUrl = await readFileAsDataURL(file)
    editor.value.chain().focus().setImage({ src: dataUrl }).run()
  }
}

const editor = useEditor({
  content: props.modelValue,
  editable: props.editable ?? true,
  extensions: [
    StarterKit,
    Image.configure({
      allowBase64: true
    })
  ],
  onUpdate: () => {
    if (editor.value) {
      emit('update:modelValue', editor.value.getHTML())
    }
  },
  editorProps: {
    attributes: {
      class: 'prose prose-invert max-w-none focus:outline-none min-h-[100px]'
    },
    handleDOMEvents: {
      paste: (_view, event) => {
        const e = event as ClipboardEvent
        const files = e.clipboardData?.files
        if (files && files.length > 0) {
          e.preventDefault()
          insertImagesFromFiles(files).catch(() => null)
          return true
        }
        return false
      },
      drop: (_view, event) => {
        const e = event as DragEvent
        const files = e.dataTransfer?.files
        if (files && files.length > 0) {
          e.preventDefault()
          insertImagesFromFiles(files).catch(() => null)
          return true
        }
        return false
      }
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
  <div
    class="note-editor"
    :style="{
      '--note-img-max-height': `${imageMaxHeight ?? 260}px`
    }"
  >
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

:deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  max-height: var(--note-img-max-height);
  object-fit: contain;
  border-radius: 8px;
  margin: 10px 0;
}
</style>
