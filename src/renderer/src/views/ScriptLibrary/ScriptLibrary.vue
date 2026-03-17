<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Copy, FilePlus2, FolderOpen, Play, RefreshCw, Save, Trash2, Upload } from 'lucide-vue-next'
import confirm from '../../utils/confirm'

type ScriptMeta = {
  name: string
  filePath: string
  ext: 'bat' | 'sh'
  mtimeMs: number
  size: number
}

type RunResult = {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  error?: string
}

const scripts = ref<ScriptMeta[]>([])
const loading = ref(false)

const selected = ref<ScriptMeta | null>(null)
const isNew = ref(false)
const draftName = ref('')
const draftExt = ref<'bat' | 'sh'>(
  navigator.userAgent.toLowerCase().includes('windows') ? 'bat' : 'sh'
)
const content = ref('')
const loadedContent = ref('')
const dirty = ref(false)
const errorText = ref('')

const extItems: Array<{ title: string; value: 'bat' | 'sh' }> = [
  { title: 'bat', value: 'bat' },
  { title: 'sh', value: 'sh' }
]

const running = ref(false)
const runResult = ref<RunResult | null>(null)

const selectedTitle = computed(() => {
  if (isNew.value) return '新脚本'
  return selected.value ? selected.value.name : '未选择'
})

const canSave = computed(() => {
  if (running.value) return false
  if (isNew.value) return Boolean(draftName.value.trim())
  return Boolean(selected.value) && dirty.value
})

async function refresh(): Promise<void> {
  loading.value = true
  errorText.value = ''
  try {
    const result = await window.electron.ipcRenderer.invoke('script-library:list')
    scripts.value = Array.isArray(result) ? (result as ScriptMeta[]) : []
    if (!selected.value) return
    const next = scripts.value.find((s) => s.filePath === selected.value?.filePath) ?? null
    selected.value = next
    if (!next) {
      isNew.value = false
      content.value = ''
      dirty.value = false
      runResult.value = null
    }
  } catch {
    scripts.value = []
  } finally {
    loading.value = false
  }
}

async function selectScript(s: ScriptMeta): Promise<void> {
  if (running.value) return
  if (dirty.value) {
    const ok = await confirm('当前脚本内容未保存，切换会丢失修改。', { title: '切换脚本' })
    if (!ok) return
  }
  errorText.value = ''
  isNew.value = false
  selected.value = s
  draftName.value = ''
  content.value = ''
  dirty.value = false
  runResult.value = null
  const raw = await window.electron.ipcRenderer.invoke('script-library:read', s.filePath)
  const v = typeof raw === 'string' ? raw : ''
  content.value = v
  loadedContent.value = v
}

function newScript(): void {
  if (running.value) return
  errorText.value = ''
  selected.value = null
  isNew.value = true
  draftName.value = ''
  content.value = ''
  loadedContent.value = ''
  dirty.value = false
  runResult.value = null
}

async function importScript(): Promise<void> {
  if (running.value) return
  errorText.value = ''
  const picked = await window.electron.ipcRenderer.invoke('script-library:import:choose')
  if (typeof picked !== 'string' || !picked.trim()) return
  const imported = await window.electron.ipcRenderer.invoke('script-library:import', picked)
  if (!imported || typeof imported !== 'object') {
    errorText.value = '导入失败'
    return
  }
  await refresh()
  const meta = imported as ScriptMeta
  const next = scripts.value.find((s) => s.filePath === meta.filePath) ?? meta
  await selectScript(next)
}

async function saveScript(): Promise<void> {
  if (!canSave.value) return
  errorText.value = ''
  const payload = isNew.value
    ? { name: draftName.value, ext: draftExt.value, content: content.value, overwrite: false }
    : {
        name: selected.value?.name ?? '',
        ext: selected.value?.ext ?? 'bat',
        content: content.value,
        overwrite: true
      }
  const saved = await window.electron.ipcRenderer.invoke('script-library:save', payload)
  if (!saved || typeof saved !== 'object') {
    errorText.value = isNew.value ? '保存失败：文件已存在或名称不合法' : '保存失败'
    return
  }
  isNew.value = false
  draftName.value = ''
  loadedContent.value = content.value
  dirty.value = false
  runResult.value = null
  await refresh()
  const meta = saved as ScriptMeta
  const next = scripts.value.find((s) => s.filePath === meta.filePath) ?? meta
  selected.value = next
}

async function deleteSelected(): Promise<void> {
  if (!selected.value || running.value) return
  const ok = await confirm(`将删除脚本：${selected.value.name}`, { title: '删除脚本' })
  if (!ok) return
  errorText.value = ''
  const done = await window.electron.ipcRenderer.invoke(
    'script-library:delete',
    selected.value.filePath
  )
  if (!done) {
    errorText.value = '删除失败'
    return
  }
  selected.value = null
  content.value = ''
  loadedContent.value = ''
  dirty.value = false
  runResult.value = null
  await refresh()
}

async function revealSelected(): Promise<void> {
  if (!selected.value) return
  window.electron.ipcRenderer
    .invoke('script-library:reveal', selected.value.filePath)
    .catch(() => null)
}

async function copyText(): Promise<void> {
  const v = content.value
  if (!v.trim()) return
  window.electron.ipcRenderer.invoke('clipboard:write-text', v).catch(() => null)
}

async function copyPath(): Promise<void> {
  const v = selected.value?.filePath ?? ''
  if (!v.trim()) return
  window.electron.ipcRenderer.invoke('clipboard:write-text', v).catch(() => null)
}

async function runSelected(): Promise<void> {
  if (!selected.value || running.value) return
  running.value = true
  errorText.value = ''
  runResult.value = null
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'script-library:run',
      selected.value.filePath
    )
    runResult.value = result && typeof result === 'object' ? (result as RunResult) : null
  } finally {
    running.value = false
  }
}

watch(
  () => content.value,
  () => {
    if (isNew.value || !selected.value) {
      dirty.value = false
      return
    }
    dirty.value = content.value !== loadedContent.value
  }
)

onMounted(() => {
  refresh().catch(() => null)
})
</script>

<template>
  <div class="page-content">
    <header class="header">
      <div class="title">脚本库</div>
      <div class="subtitle">管理 bat / sh，支持执行、复制、导入</div>
    </header>

    <div class="grid">
      <section class="card list-card">
        <div class="card-head">
          <div class="card-title">脚本</div>
          <div class="card-actions">
            <button
              class="btn icon-btn"
              type="button"
              title="导入"
              aria-label="导入"
              @click="importScript"
            >
              <Upload :size="16" />
            </button>
            <button
              class="btn icon-btn"
              type="button"
              title="新建"
              aria-label="新建"
              @click="newScript"
            >
              <FilePlus2 :size="16" />
            </button>
            <button
              class="btn icon-btn"
              type="button"
              title="刷新"
              aria-label="刷新"
              :disabled="loading"
              @click="refresh"
            >
              <RefreshCw :size="16" />
            </button>
          </div>
        </div>

        <div v-if="loading" class="hint">加载中…</div>
        <div v-else-if="scripts.length === 0" class="hint">暂无脚本。点击右上角“新建/导入”。</div>

        <div v-else class="list">
          <button
            v-for="s in scripts"
            :key="s.filePath"
            class="list-item"
            :class="{ active: selected?.filePath === s.filePath && !isNew }"
            type="button"
            @click="selectScript(s)"
          >
            <div class="list-name">{{ s.name }}</div>
            <div class="list-meta">
              {{ s.ext.toUpperCase() }} · {{ Math.round(s.size / 1024) }} KB
            </div>
          </button>
        </div>
      </section>

      <section class="card editor-card">
        <div class="card-head">
          <div class="card-title">{{ selectedTitle }}</div>
          <div class="card-actions">
            <button
              class="btn icon-btn"
              type="button"
              title="复制内容"
              aria-label="复制内容"
              :disabled="!content.trim()"
              @click="copyText"
            >
              <Copy :size="16" />
            </button>
            <button
              class="btn icon-btn"
              type="button"
              title="复制路径"
              aria-label="复制路径"
              :disabled="!selected"
              @click="copyPath"
            >
              <FolderOpen :size="16" />
            </button>
            <button
              class="btn icon-btn"
              type="button"
              title="执行"
              aria-label="执行"
              :disabled="!selected || running"
              @click="runSelected"
            >
              <Play :size="16" />
            </button>
            <button
              class="btn icon-btn"
              type="button"
              title="保存"
              aria-label="保存"
              :disabled="!canSave"
              @click="saveScript"
            >
              <Save :size="16" />
            </button>
            <button
              class="btn icon-btn danger"
              type="button"
              title="删除"
              aria-label="删除"
              :disabled="!selected || running"
              @click="deleteSelected"
            >
              <Trash2 :size="16" />
            </button>
          </div>
        </div>

        <div v-if="isNew" class="new-row">
          <input
            v-model="draftName"
            class="text name"
            type="text"
            placeholder="脚本名称（不含扩展名）"
          />
          <v-select
            v-model="draftExt"
            class="select"
            :items="extItems"
            item-title="title"
            item-value="value"
          />
        </div>

        <div v-if="errorText" class="error">{{ errorText }}</div>

        <textarea
          v-model="content"
          class="editor"
          spellcheck="false"
          placeholder="在这里输入脚本内容…"
        ></textarea>

        <div v-if="runResult" class="run-card">
          <div class="run-head">
            <div class="run-title">执行结果</div>
            <div class="run-meta" :class="{ bad: !runResult.ok }">
              {{ runResult.ok ? 'OK' : 'FAILED'
              }}{{ runResult.code !== null ? ` · code ${runResult.code}` : '' }}
            </div>
          </div>
          <pre v-if="runResult.error" class="run-pre">{{ runResult.error }}</pre>
          <pre v-else class="run-pre">{{
            (runResult.stdout + (runResult.stderr ? '\n' + runResult.stderr : '')).trim()
          }}</pre>
          <div class="hint">Windows 下执行 .sh 需要系统可用的 bash（例如 Git Bash / WSL）。</div>
        </div>

        <div v-if="selected" class="hint hint-row">
          <button class="link" type="button" @click="revealSelected">在文件管理器中打开</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title {
  font-size: 24px;
  font-weight: 700;
  line-height: 28px;
}

.subtitle {
  font-size: 13px;
  color: var(--ev-c-text-2);
}

.grid {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 14px;
  min-height: 0;
  flex: 1;
}

.card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.card-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ev-c-text-1);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 245, 0.92);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.icon-btn {
  padding: 7px;
  display: inline-grid;
  place-items: center;
  min-width: 34px;
  line-height: 1;
}

.danger {
  border-color: rgba(239, 68, 68, 0.28);
  background: rgba(239, 68, 68, 0.08);
}

.danger:hover {
  background: rgba(239, 68, 68, 0.14);
}

.hint {
  font-size: 12px;
  color: var(--ev-c-text-3);
}

.error {
  font-size: 12px;
  color: rgba(239, 68, 68, 0.9);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  min-height: 0;
}

.list-item {
  width: 100%;
  text-align: left;
  border-radius: 10px;
  padding: 10px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.18);
  color: rgba(235, 235, 245, 0.86);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.list-item:hover {
  border-color: rgba(59, 130, 246, 0.35);
}

.list-item.active {
  border-color: rgba(59, 130, 246, 0.55);
  background: rgba(59, 130, 246, 0.12);
}

.list-name {
  font-size: 13px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-meta {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.55);
}

.new-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.text {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  color: var(--ev-c-text-1);
  outline: none;
  font-size: 13px;
}

.text:focus {
  border-color: rgba(59, 130, 246, 0.5);
}

.name {
  flex: 1;
  min-width: 0;
}

.select {
  width: 100px;
}

.editor {
  width: 100%;
  flex: 1;
  min-height: 140px;
  resize: none;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.18);
  color: rgba(235, 235, 245, 0.9);
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 12px;
  line-height: 1.5;
  outline: none;
}

.editor:focus {
  border-color: rgba(59, 130, 246, 0.45);
}

.run-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.18);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.run-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.run-title {
  font-size: 13px;
  font-weight: 800;
  color: rgba(235, 235, 245, 0.9);
}

.run-meta {
  font-size: 12px;
  color: rgba(34, 197, 94, 0.9);
  font-weight: 800;
}

.run-meta.bad {
  color: rgba(239, 68, 68, 0.9);
}

.run-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(235, 235, 245, 0.86);
  max-height: 220px;
  overflow: auto;
  user-select: text;
}

.hint-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.link {
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: rgba(59, 130, 246, 0.9);
  font-size: 12px;
  font-weight: 700;
}

.link:hover {
  text-decoration: underline;
}
</style>
