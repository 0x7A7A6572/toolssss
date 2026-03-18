<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Extension } from '@tiptap/core'
import { common, createLowlight } from 'lowlight'
import { watch, onBeforeUnmount, nextTick, onMounted, ref, computed } from 'vue'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link2,
  SquareCode,
  Quote,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Pilcrow,
  Undo2,
  Redo2,
  ImagePlus,
  ListTodo
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
const linkHrefInputRef = ref<HTMLInputElement | null>(null)
const toolbarTick = ref(0)

const lowlight = createLowlight(common)
const languageAliases: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  html: 'xml'
}

const codeBlockLanguageItems: Array<{ title: string; value: string }> = [
  { title: 'Text', value: '' },
  { title: 'JavaScript', value: 'javascript' },
  { title: 'TypeScript', value: 'typescript' },
  { title: 'JSON', value: 'json' },
  { title: 'Bash', value: 'bash' },
  { title: 'Python', value: 'python' },
  { title: 'HTML', value: 'xml' },
  { title: 'CSS', value: 'css' },
  { title: 'SQL', value: 'sql' }
]

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

function toggleTaskList(): void {
  editor.value?.chain().focus().toggleTaskList().run()
}

const isInCodeBlock = computed(() => editor.value?.isActive('codeBlock') ?? false)

const codeBlockLanguage = computed(() => {
  if (!editor.value) return ''
  const v = editor.value.getAttributes('codeBlock') as { language?: unknown }
  if (typeof v.language !== 'string') return ''
  return languageAliases[v.language] ?? v.language
})

function setCodeBlockLanguage(value: string): void {
  if (!editor.value) return
  editor.value
    .chain()
    .focus()
    .setCodeBlock({ language: String(value || '') })
    .run()
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

const isLinkModalOpen = ref(false)
const linkHrefDraft = ref('')
const linkTextDraft = ref('')

const isInLink = computed(() => editor.value?.isActive('link') ?? false)

function normalizeHref(href: string): string {
  const v = href.trim()
  if (!v) return ''
  if (v.includes('://')) return v
  if (v.startsWith('mailto:')) return v
  if (v.startsWith('tel:')) return v
  if (v.startsWith('#')) return v
  return `https://${v}`
}

function openLinkModal(): void {
  if (!editor.value) return
  const attrs = editor.value.getAttributes('link') as { href?: unknown }
  linkHrefDraft.value = typeof attrs.href === 'string' ? attrs.href : ''
  const { from, to } = editor.value.state.selection
  linkTextDraft.value = from === to ? '' : editor.value.state.doc.textBetween(from, to, ' ')
  isLinkModalOpen.value = true
  nextTick(() => linkHrefInputRef.value?.focus())
}

function closeLinkModal(): void {
  isLinkModalOpen.value = false
}

function removeLink(): void {
  if (!editor.value) return
  editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
  closeLinkModal()
}

function applyLink(): void {
  if (!editor.value) return
  const href = normalizeHref(linkHrefDraft.value)
  if (!href) return

  const { from, to } = editor.value.state.selection
  const text = linkTextDraft.value.trim()

  if (from === to && text) {
    editor.value
      .chain()
      .focus()
      .insertContent(text)
      .setTextSelection({ from, to: from + text.length })
      .setLink({ href })
      .run()
    closeLinkModal()
    return
  }

  editor.value.chain().focus().extendMarkRange('link').setLink({ href }).run()
  closeLinkModal()
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
    StarterKit.configure({ codeBlock: false }),
    CodeBlockLowlight.configure({
      lowlight,
      HTMLAttributes: {
        spellcheck: 'false',
        'data-gramm': 'false',
        'data-gramm_editor': 'false',
        'data-enable-grammarly': 'false',
        'data-ms-editor': 'false'
      }
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: true
    }),
    Extension.create({
      addKeyboardShortcuts() {
        return {
          Tab: () => {
            if (!this.editor.isActive('codeBlock')) return false
            return this.editor.commands.insertContent('\t')
          },
          'Shift-Tab': () => {
            if (!this.editor.isActive('codeBlock')) return false
            return this.editor.commands.insertContent('  ')
          }
        }
      }
    }),
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
  onCreate: ({ editor }) => {
    editor.commands.command(({ tr, state, dispatch }) => {
      const codeBlock = state.schema.nodes['codeBlock']
      if (!codeBlock) return false
      let changed = false
      state.doc.descendants((node, pos) => {
        if (node.type !== codeBlock) return
        const raw = node.attrs['language']
        if (typeof raw !== 'string') return
        const next = languageAliases[raw]
        if (!next || next === raw) return
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: next })
        changed = true
      })
      if (changed && dispatch) dispatch(tr)
      return changed
    })
  },
  editorProps: {
    attributes: {
      class: 'prose note-prose'
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
        <button type="button" class="tool" :class="{ active: isInLink }" @click="openLinkModal">
          <Link2 :size="16" />
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
        <v-select
          v-if="isInCodeBlock"
          class="lang"
          :items="codeBlockLanguageItems"
          item-title="title"
          item-value="value"
          :model-value="codeBlockLanguage"
          variant="solo-filled"
          @update:model-value="setCodeBlockLanguage"
        />
        <button type="button" class="tool" @click="openImagePicker">
          <ImagePlus :size="16" />
        </button>
        <button
          type="button"
          class="tool"
          :class="{ active: editor?.isActive('taskList') }"
          :disabled="!editor?.can().chain().focus().toggleTaskList().run()"
          @click="toggleTaskList"
        >
          <ListTodo :size="16" />
        </button>
      </div>
    </div>
    <input
      v-if="showToolbar && editor?.isEditable"
      ref="fileInputRef"
      class="file-input"
      type="file"
      accept="image/*"
      multiple
      @change="onPickImages"
    />
    <Teleport to="body">
      <div
        v-if="isLinkModalOpen && editor?.isEditable"
        class="modal-overlay"
        @click.self="closeLinkModal"
      >
        <div class="modal" @keydown.esc="closeLinkModal">
          <div class="modal-header">
            <div class="modal-title">链接</div>
          </div>
          <div class="modal-body">
            <div class="field">
              <div class="label">URL</div>
              <input
                ref="linkHrefInputRef"
                v-model="linkHrefDraft"
                class="input"
                type="text"
                inputmode="url"
                placeholder="https://example.com"
                @keydown.enter.prevent="applyLink"
              />
            </div>
            <div
              v-if="editor && editor.state.selection.from === editor.state.selection.to"
              class="field"
            >
              <div class="label">文本</div>
              <input
                v-model="linkTextDraft"
                class="input"
                type="text"
                placeholder="显示文本（可选）"
                @keydown.enter.prevent="applyLink"
              />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn primary" @click="applyLink">应用</button>
            <button v-if="isInLink" class="btn danger" @click="removeLink">移除</button>
            <button class="btn" @click="closeLinkModal">取消</button>
          </div>
        </div>
      </div>
    </Teleport>
    <editor-content style="padding: 0 18px" :editor="editor" />
  </div>
</template>

<style scoped>
.note-editor {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  /* 隐藏滚动条 */
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
}

.note-editor::-webkit-scrollbar {
  display: none; /* Chrome/Safari */
}

.toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  /* border: 1px solid rgba(0, 0, 0, 0.12); */
  /* border-radius: 12px; */
  background: rgba(255, 255, 255, 0.394);
  /* backdrop-filter: blur(10px); */
  margin-bottom: 10px;
  overflow-x: auto;
}

.file-input {
  display: none;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.modal {
  width: min(520px, calc(100vw - 32px));
  border-radius: 12px;
  background: rgba(17, 24, 39, 0.9);
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 14px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.modal-title {
  font-weight: 800;
  font-size: 14px;
}

.modal-body {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.field {
  display: grid;
  gap: 6px;
}

.label {
  font-size: 12px;
  opacity: 0.8;
}

.input {
  height: 34px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255, 255, 255, 0.92);
  padding: 0 10px;
  outline: none;
}

.input:focus {
  border-color: rgba(59, 130, 246, 0.6);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn {
  height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92);
  cursor: pointer;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.btn.primary {
  border-color: rgba(59, 130, 246, 0.6);
  background: rgba(59, 130, 246, 0.22);
}

.btn.danger {
  border-color: rgba(248, 113, 113, 0.6);
  background: rgba(248, 113, 113, 0.14);
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
  border: none;
  /* border: 1px solid rgba(0, 0, 0, 0.14); */
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

.lang {
  width: 160px;
  flex: none;
}

.lang :deep(.v-field) {
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.7);
  color: rgba(17, 24, 39, 0.86);
  font-weight: 700;
  font-size: 13px;
}

.lang :deep(.v-field__input) {
  min-height: 30px;
  padding-top: 0;
  padding-bottom: 0;
}

:deep(pre) {
  background: rgba(17, 24, 39, 0.86);
  color: rgba(235, 235, 245, 0.92);
  padding: 12px 14px;
  border-radius: 10px;
  overflow: auto;
  margin: 0.6em 0;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 13px;
  line-height: 1.5;
}

:deep(pre code) {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-family: inherit;
}

:deep(.hljs-comment),
:deep(.hljs-quote) {
  color: rgba(148, 163, 184, 0.8);
  font-style: italic;
}

:deep(.hljs-keyword),
:deep(.hljs-selector-tag),
:deep(.hljs-subst) {
  color: rgba(139, 92, 246, 0.95);
}

:deep(.hljs-string),
:deep(.hljs-selector-attr),
:deep(.hljs-selector-pseudo),
:deep(.hljs-addition),
:deep(.hljs-template-tag),
:deep(.hljs-template-variable) {
  color: rgba(34, 197, 94, 0.95);
}

:deep(.hljs-number),
:deep(.hljs-literal),
:deep(.hljs-symbol),
:deep(.hljs-bullet) {
  color: rgba(245, 158, 11, 0.95);
}

:deep(.hljs-title),
:deep(.hljs-section),
:deep(.hljs-function .hljs-title),
:deep(.hljs-attr),
:deep(.hljs-attribute),
:deep(.hljs-name),
:deep(.hljs-tag) {
  color: rgba(96, 165, 250, 0.95);
}

:deep(.hljs-variable),
:deep(.hljs-params),
:deep(.hljs-type),
:deep(.hljs-built_in) {
  color: rgba(251, 113, 133, 0.95);
}

:deep(.hljs-meta),
:deep(.hljs-doctag) {
  color: rgba(203, 213, 225, 0.85);
}

:deep(.hljs-emphasis) {
  font-style: italic;
}

:deep(.hljs-strong) {
  font-weight: 800;
}

:deep(.note-prose) {
  outline: none;
  min-height: 100px;
  color: inherit;
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
