<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { watch, onBeforeUnmount, nextTick, onMounted, ref } from 'vue'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  SquareCode,
  Quote,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Pilcrow,
  Undo2,
  Redo2,
  ImagePlus
} from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string
  editable?: boolean
  imageMaxHeight?: number
  autofocus?: boolean
  showToolbar?: boolean
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

const fileInputRef = ref<HTMLInputElement | null>(null)
const toolbarTick = ref(0)

function focus(): void {
  editor.value?.chain().focus().run()
}

function toggleBold(): void {
  editor.value?.chain().focus().toggleBold().run()
}

function toggleItalic(): void {
  editor.value?.chain().focus().toggleItalic().run()
}

function toggleStrike(): void {
  editor.value?.chain().focus().toggleStrike().run()
}

function toggleCode(): void {
  editor.value?.chain().focus().toggleCode().run()
}

function toggleHeading(level: 1 | 2): void {
  editor.value?.chain().focus().toggleHeading({ level }).run()
}

function setParagraph(): void {
  editor.value?.chain().focus().setParagraph().run()
}

function toggleBulletList(): void {
  editor.value?.chain().focus().toggleBulletList().run()
}

function toggleOrderedList(): void {
  editor.value?.chain().focus().toggleOrderedList().run()
}

function toggleBlockquote(): void {
  editor.value?.chain().focus().toggleBlockquote().run()
}

function toggleCodeBlock(): void {
  editor.value?.chain().focus().toggleCodeBlock().run()
}

function undo(): void {
  editor.value?.chain().focus().undo().run()
}

function redo(): void {
  editor.value?.chain().focus().redo().run()
}

function openImagePicker(): void {
  if (!fileInputRef.value) return
  fileInputRef.value.click()
}

function onPickImages(e: Event): void {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (files && files.length > 0) {
    insertImagesFromFiles(files).catch(() => null)
  }
  input.value = ''
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
  onSelectionUpdate: () => {
    toolbarTick.value += 1
  },
  onTransaction: () => {
    toolbarTick.value += 1
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
      if (val) {
        nextTick(() => focus())
      }
    }
  }
)

onMounted(() => {
  if (props.autofocus) {
    nextTick(() => focus())
  }
})

defineExpose({ focus })

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
    <input
      v-if="showToolbar && editor?.isEditable"
      ref="fileInputRef"
      class="file-input"
      type="file"
      accept="image/*"
      multiple
      @change="onPickImages"
    />
    <div v-if="showToolbar && editor?.isEditable" class="toolbar" :data-tick="toolbarTick">
      <div class="group">
        <button
          type="button"
          class="tool"
          :disabled="!editor?.can().chain().focus().undo().run()"
          @click="undo"
        >
          <Undo2 :size="16" />
        </button>
        <button
          type="button"
          class="tool"
          :disabled="!editor?.can().chain().focus().redo().run()"
          @click="redo"
        >
          <Redo2 :size="16" />
        </button>
      </div>

      <div class="divider" />

      <div class="group">
        <button
          type="button"
          class="tool"
          :class="{ active: editor?.isActive('paragraph') }"
          :disabled="!editor?.can().chain().focus().setParagraph().run()"
          @click="setParagraph"
        >
          <Pilcrow :size="16" />
        </button>
        <button
          type="button"
          class="tool"
          :class="{ active: editor?.isActive('heading', { level: 1 }) }"
          :disabled="!editor?.can().chain().focus().toggleHeading({ level: 1 }).run()"
          @click="toggleHeading(1)"
        >
          <Heading1 :size="16" />
        </button>
        <button
          type="button"
          class="tool"
          :class="{ active: editor?.isActive('heading', { level: 2 }) }"
          :disabled="!editor?.can().chain().focus().toggleHeading({ level: 2 }).run()"
          @click="toggleHeading(2)"
        >
          <Heading2 :size="16" />
        </button>
      </div>

      <div class="divider" />

      <div class="group">
        <button
          type="button"
          class="tool"
          :class="{ active: editor?.isActive('bold') }"
          :disabled="!editor?.can().chain().focus().toggleBold().run()"
          @click="toggleBold"
        >
          <Bold :size="16" />
        </button>
        <button
          type="button"
          class="tool"
          :class="{ active: editor?.isActive('italic') }"
          :disabled="!editor?.can().chain().focus().toggleItalic().run()"
          @click="toggleItalic"
        >
          <Italic :size="16" />
        </button>
        <button
          type="button"
          class="tool"
          :class="{ active: editor?.isActive('strike') }"
          :disabled="!editor?.can().chain().focus().toggleStrike().run()"
          @click="toggleStrike"
        >
          <Strikethrough :size="16" />
        </button>
        <button
          type="button"
          class="tool"
          :class="{ active: editor?.isActive('code') }"
          :disabled="!editor?.can().chain().focus().toggleCode().run()"
          @click="toggleCode"
        >
          <Code :size="16" />
        </button>
      </div>

      <div class="divider" />

      <div class="group">
        <button
          type="button"
          class="tool"
          :class="{ active: editor?.isActive('bulletList') }"
          :disabled="!editor?.can().chain().focus().toggleBulletList().run()"
          @click="toggleBulletList"
        >
          <List :size="16" />
        </button>
        <button
          type="button"
          class="tool"
          :class="{ active: editor?.isActive('orderedList') }"
          :disabled="!editor?.can().chain().focus().toggleOrderedList().run()"
          @click="toggleOrderedList"
        >
          <ListOrdered :size="16" />
        </button>
        <button
          type="button"
          class="tool"
          :class="{ active: editor?.isActive('blockquote') }"
          :disabled="!editor?.can().chain().focus().toggleBlockquote().run()"
          @click="toggleBlockquote"
        >
          <Quote :size="16" />
        </button>
        <button
          type="button"
          class="tool"
          :class="{ active: editor?.isActive('codeBlock') }"
          :disabled="!editor?.can().chain().focus().toggleCodeBlock().run()"
          @click="toggleCodeBlock"
        >
          <SquareCode :size="16" />
        </button>
      </div>

      <div class="divider" />

      <div class="group">
        <button type="button" class="tool" @click="openImagePicker">
          <ImagePlus :size="16" />
        </button>
      </div>
    </div>
    <editor-content :editor="editor" />
  </div>
</template>

<style scoped>
.note-editor {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}

.toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(10px);
  margin-bottom: 10px;
  overflow-x: auto;
}

.file-input {
  display: none;
}

.group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.divider {
  width: 1px;
  height: 20px;
  background: rgba(0, 0, 0, 0.14);
}

.tool.active {
  border-color: rgba(59, 130, 246, 0.6);
  background: rgba(59, 130, 246, 0.14);
}

.tool {
  height: 30px;
  width: 30px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: rgba(255, 255, 255, 0.7);
  color: rgba(17, 24, 39, 0.86);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.tool:hover {
  background: rgba(255, 255, 255, 0.92);
}

.tool:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
