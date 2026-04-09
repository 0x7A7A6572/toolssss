<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '@shared/settings'
import ShortcutInput from '../../components/ShortcutInput.vue'
import { Delete, FolderOpen } from 'lucide-vue-next'
import { AI_PROVIDERS } from '../../constants/aiProviders'
import { Languages } from '@renderer/utils/bean'

const settings = ref<AppSettings>(structuredClone(DEFAULT_SETTINGS))
const saving = ref(false)
const appPaths = ref<{ userData: string; pictures: string } | null>(null)
const aiApiKeyDraft = ref('')
const version = ref('')

const shortcutLabels: Record<string, string> = {
  toggleEye: '开启/关闭护眼模式',
  translateSelection: '划词翻译弹窗',
  toggleTopmost: '窗口置顶',
  stickyNotesPopup: '弹出快捷便签',
  snipStart: '开始截图',
  stickerPaste: '剪贴板贴图',
  stickersToggleHidden: '隐藏/显示所有贴图',
  stashLeft: '收纳到左侧',
  stashTop: '收纳到上侧',
  stashRight: '收纳到右侧',
  stashBottom: '收纳到下侧'
}

type ShortcutConflictItem = { key: string; label: string }
type ShortcutConflictState = {
  targetKey: string
  targetLabel: string
  value: string
  conflicts: ShortcutConflictItem[]
}

const shortcutConflict = ref<ShortcutConflictState | null>(null)

const translateProviderItems: Array<{
  title: string
  value: AppSettings['translate']['provider']
}> = [
  { title: '百度翻译', value: 'baidu' },
  { title: '必应翻译（Microsoft Translator）', value: 'bing' },
  { title: 'AI 翻译（OpenAI Compatible）', value: 'ai' }
]

const translateSourceItems: Array<{ title: string; value: string }> = [
  { title: '自动识别', value: 'auto' },
  ...Languages
]

const translateTargetItems: Array<{ title: string; value: string }> = [...Languages]

const aiProviderItems: Array<{ title: string; value: AppSettings['ai']['provider'] }> = [
  { title: 'OpenAI', value: 'openai' },
  { title: 'Google Gemini', value: 'gmini' },
  { title: 'Kimi (Moonshot)', value: 'kimi' },
  { title: '阿里通义（DashScope）', value: 'qwen' },
  { title: 'Custom', value: 'custom' }
]

function getShortcutLabel(key: string): string {
  return shortcutLabels[key] ?? key
}

function isShortcutEnabled(key: string): boolean {
  const se = (settings.value as unknown as { shortcutsEnabled?: unknown }).shortcutsEnabled
  if (!se || typeof se !== 'object') return true
  const v = (se as Record<string, unknown>)[key]
  return typeof v === 'boolean' ? v : true
}

async function onShortcutEnabledChange(key: string, enabled: boolean): Promise<void> {
  await update({ shortcutsEnabled: { [key]: enabled } }).catch(() => null)
}

function findShortcutConflicts(targetKey: string, value: string): ShortcutConflictItem[] {
  const shortcuts = settings.value.shortcuts ?? {}
  const conflicts: ShortcutConflictItem[] = []
  for (const [k, v] of Object.entries(shortcuts)) {
    if (k === targetKey) continue
    if (!isShortcutEnabled(k)) continue
    if (v !== value) continue
    conflicts.push({ key: k, label: getShortcutLabel(k) })
  }
  return conflicts
}

function closeShortcutConflict(): void {
  shortcutConflict.value = null
}

async function applyShortcutReplace(): Promise<void> {
  const state = shortcutConflict.value
  if (!state) return
  const patch: Record<string, string> = { [state.targetKey]: state.value }
  for (const c of state.conflicts) patch[c.key] = ''
  shortcutConflict.value = null
  await update({ shortcuts: patch }).catch(() => null)
}

async function onShortcutChange(targetKey: string, nextValue: string): Promise<void> {
  const v = nextValue.trim()
  const current = (settings.value.shortcuts?.[targetKey] ?? '').trim()
  if (v === current) return

  if (!v) {
    await update({ shortcuts: { [targetKey]: '' } }).catch(() => null)
    return
  }

  const conflicts = findShortcutConflicts(targetKey, v)
  if (!conflicts.length) {
    await update({ shortcuts: { [targetKey]: v } }).catch(() => null)
    return
  }

  shortcutConflict.value = {
    targetKey,
    targetLabel: getShortcutLabel(targetKey),
    value: v,
    conflicts
  }
}

type ShortcutConflictGroup = {
  value: string
  items: ShortcutConflictItem[]
}

const shortcutConflictGroups = computed<ShortcutConflictGroup[]>(() => {
  const shortcuts = settings.value.shortcuts ?? {}
  const accToKeys = new Map<string, string[]>()
  for (const [k, v] of Object.entries(shortcuts)) {
    if (!isShortcutEnabled(k)) continue
    const acc = v.trim()
    if (!acc) continue
    const list = accToKeys.get(acc)
    if (list) list.push(k)
    else accToKeys.set(acc, [k])
  }

  const groups: ShortcutConflictGroup[] = []
  for (const [acc, keys] of accToKeys.entries()) {
    if (keys.length <= 1) continue
    groups.push({
      value: acc,
      items: keys.map((k) => ({ key: k, label: getShortcutLabel(k) }))
    })
  }

  groups.sort((a, b) => a.value.localeCompare(b.value))
  return groups
})

const shortcutConflictKeySet = computed(() => {
  const set = new Set<string>()
  for (const g of shortcutConflictGroups.value) {
    for (const it of g.items) set.add(it.key)
  }
  return set
})

function hasExistingShortcutConflict(key: string): boolean {
  return shortcutConflictKeySet.value.has(key)
}

function joinPath(base: string, tail: string): string {
  const b = base.trim().replace(/[\\/]+$/, '')
  const t = tail.trim().replace(/^[\\/]+/, '')
  const sep = b.includes('\\') ? '\\' : '/'
  return `${b}${sep}${t}`
}

const snipPlaceholder = computed(() => {
  const pictures = appPaths.value?.pictures
  if (typeof pictures === 'string' && pictures.trim()) {
    return `默认：${joinPath(joinPath(pictures, 'toolssss'), 'screenshots')}`
  }
  return '默认：系统图片目录/toolssss/screenshots'
})

const stickyNotesPlaceholder = computed(() => {
  const userData = appPaths.value?.userData
  if (typeof userData === 'string' && userData.trim()) {
    return `默认：${joinPath(userData, 'sticky-notes.json')}`
  }
  return '默认：应用数据目录/sticky-notes.json'
})

const aiBaseUrlPlaceholder = computed(() => {
  const p = settings.value.ai.provider
  const preset = (AI_PROVIDERS as Record<string, { baseUrl: string }>)[p]
  if (preset && preset.baseUrl) return `默认：${preset.baseUrl}`
  return '默认：https://api.openai.com'
})

const aiModelsForProvider = computed(() => {
  const p = settings.value.ai.provider
  const preset = (AI_PROVIDERS as Record<string, { models?: string[] }>)[p]
  return Array.isArray(preset?.models) ? preset!.models! : []
})

function onTranslateProviderChange(value: AppSettings['translate']['provider']): void {
  update({ translate: { provider: value } }).catch(() => null)
}

function onTranslateSourceChange(value: string): void {
  update({ translate: { defaultSource: value } }).catch(() => null)
}

function onTranslateTargetChange(value: string): void {
  update({ translate: { defaultTarget: value } }).catch(() => null)
}

function onAiProviderChange(value: AppSettings['ai']['provider']): void {
  const preset = (AI_PROVIDERS as Record<string, { baseUrl: string; models?: string[] }>)[value]
  if (preset) {
    const models = Array.isArray(preset.models) ? preset.models : []
    const next: SettingsPatch = { ai: { provider: value, baseUrl: preset.baseUrl } }
    if (!models.includes(settings.value.ai.model) && models[0]) {
      next.ai!.model = models[0]
    }
    update(next).catch(() => null)
  } else {
    update({ ai: { provider: value } }).catch(() => null)
  }
}

function onAiModelChange(value: string): void {
  update({ ai: { model: value } }).catch(() => null)
}

async function refresh(): Promise<void> {
  const result = await window.electron.ipcRenderer.invoke('settings:get')
  settings.value = result as AppSettings
}

async function update(patch: SettingsPatch): Promise<void> {
  saving.value = true
  try {
    const result = await window.electron.ipcRenderer.invoke('settings:update', patch)
    settings.value = result as AppSettings
  } finally {
    saving.value = false
  }
}

async function setAiApiKey(): Promise<void> {
  const v = aiApiKeyDraft.value.trim()
  if (!v) return
  saving.value = true
  try {
    const result = await window.electron.ipcRenderer.invoke('ai:apiKey:set', v)
    settings.value = result as AppSettings
    aiApiKeyDraft.value = ''
  } finally {
    saving.value = false
  }
}

async function clearAiApiKey(): Promise<void> {
  saving.value = true
  try {
    const result = await window.electron.ipcRenderer.invoke('ai:apiKey:clear')
    settings.value = result as AppSettings
    aiApiKeyDraft.value = ''
  } finally {
    saving.value = false
  }
}

async function chooseSnipSaveDir(): Promise<void> {
  const p = await window.electron.ipcRenderer.invoke('snip:saveDir:choose')
  if (typeof p !== 'string' || !p.trim()) return
  update({ snip: { saveDir: p } }).catch(() => null)
}

async function chooseStickyNotesSaveDir(): Promise<void> {
  const p = await window.electron.ipcRenderer.invoke('sticky-notes:saveDir:choose')
  if (typeof p !== 'string' || !p.trim()) return
  update({ stickyNotes: { saveDir: p } }).catch(() => null)
}

onMounted(() => {
  refresh().catch(() => null)
  window.electron.ipcRenderer
    .invoke('app:paths')
    .then((v: unknown) => {
      if (!v || typeof v !== 'object') return
      const p = v as { userData?: unknown; pictures?: unknown }
      if (typeof p.userData !== 'string' || typeof p.pictures !== 'string') return
      appPaths.value = { userData: p.userData, pictures: p.pictures }
    })
    .catch(() => null)
  window.electron.ipcRenderer
    .invoke('app:version')
    .then((v: unknown) => {
      version.value = typeof v === 'string' ? v : ''
    })
    .catch(() => null)
  window.electron.ipcRenderer.on('settings:changed', (_: unknown, s: unknown) => {
    settings.value = s as AppSettings
  })
})
</script>

<template>
  <div class="page-content">
    <header class="header">
      <div class="title">全局设置</div>
      <div class="subtitle">应用行为与快捷键配置</div>
    </header>

    <section class="card">
      <div class="card-head">
        <div class="card-title">系统行为</div>
      </div>

      <div class="row">
        <div class="label">开机自启</div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settings.general.autoStart"
            @change="
              update({
                general: { autoStart: ($event.target as HTMLInputElement).checked }
              })
            "
          />
          <span class="slider" />
        </label>
      </div>

      <div class="row">
        <div class="label">关闭时最小化到托盘</div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settings.general.minimizeToTray"
            @change="
              update({
                general: { minimizeToTray: ($event.target as HTMLInputElement).checked }
              })
            "
          />
          <span class="slider" />
        </label>
      </div>

      <div class="row">
        <div class="label">截图保存目录</div>
        <div class="path-row">
          <input
            class="text path"
            type="text"
            :value="settings.snip.saveDir"
            :placeholder="snipPlaceholder"
            @change="
              update({
                snip: { saveDir: ($event.target as HTMLInputElement).value }
              })
            "
          />
          <button
            class="btn icon-btn"
            type="button"
            title="选择目录"
            aria-label="选择目录"
            @click="chooseSnipSaveDir"
          >
            <FolderOpen :size="16" />
          </button>
        </div>
      </div>

      <div class="row">
        <div class="label">便签保存目录</div>
        <div class="path-row">
          <input
            class="text path"
            type="text"
            :value="settings.stickyNotes.saveDir"
            :placeholder="stickyNotesPlaceholder"
            @change="
              update({
                stickyNotes: { saveDir: ($event.target as HTMLInputElement).value }
              })
            "
          />
          <button
            class="btn icon-btn"
            type="button"
            title="选择目录"
            aria-label="选择目录"
            @click="chooseStickyNotesSaveDir"
          >
            <FolderOpen :size="16" />
          </button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">其他设置</div>
      </div>

      <div class="row">
        <div class="label">启用截屏贴图</div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settings.snip.enabled"
            @change="
              update({
                snip: { enabled: ($event.target as HTMLInputElement).checked }
              })
            "
          />
          <span class="slider" />
        </label>
      </div>

      <div class="row">
        <div class="label">截图时隐藏护眼遮罩</div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settings.snip.suspendEyeOverlay"
            :disabled="!settings.snip.enabled"
            @change="
              update({
                snip: { suspendEyeOverlay: ($event.target as HTMLInputElement).checked }
              })
            "
          />
          <span class="slider" />
        </label>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">全局快捷键</div>
      </div>

      <div v-if="shortcutConflictGroups.length" class="conflict-summary">
        <div class="conflict-summary-title">检测到快捷键冲突</div>
        <div v-for="g in shortcutConflictGroups" :key="g.value" class="conflict-summary-item">
          <div class="conflict-summary-key">{{ g.value }}</div>
          <div class="conflict-summary-actions">
            <span v-for="it in g.items" :key="it.key" class="conflict-summary-action">
              {{ it.label }}
            </span>
          </div>
        </div>
      </div>

      <div class="row">
        <div class="label shortcut-label">
          <span>开启/关闭护眼模式</span>
          <span v-if="hasExistingShortcutConflict('toggleEye')" class="conflict-badge">冲突</span>
        </div>
        <div class="shortcut-actions">
          <ShortcutInput
            :model-value="settings.shortcuts.toggleEye"
            :disabled="!isShortcutEnabled('toggleEye')"
            placeholder="未设置"
            @update:model-value="onShortcutChange('toggleEye', $event)"
          />
          <label class="switch">
            <input
              type="checkbox"
              :checked="isShortcutEnabled('toggleEye')"
              @change="
                onShortcutEnabledChange('toggleEye', ($event.target as HTMLInputElement).checked)
              "
            />
            <span class="slider" />
          </label>
        </div>
      </div>

      <div class="row">
        <div class="label shortcut-label">
          <span>划词翻译弹窗</span>
          <span v-if="hasExistingShortcutConflict('translateSelection')" class="conflict-badge"
            >冲突</span
          >
        </div>
        <div class="shortcut-actions">
          <ShortcutInput
            :model-value="settings.shortcuts.translateSelection"
            :disabled="!isShortcutEnabled('translateSelection')"
            placeholder="未设置"
            @update:model-value="onShortcutChange('translateSelection', $event)"
          />
          <label class="switch">
            <input
              type="checkbox"
              :checked="isShortcutEnabled('translateSelection')"
              @change="
                onShortcutEnabledChange(
                  'translateSelection',
                  ($event.target as HTMLInputElement).checked
                )
              "
            />
            <span class="slider" />
          </label>
        </div>
      </div>

      <div class="row">
        <div class="label shortcut-label">
          <span>弹出快捷便签</span>
          <span v-if="hasExistingShortcutConflict('stickyNotesPopup')" class="conflict-badge"
            >冲突</span
          >
        </div>
        <div class="shortcut-actions">
          <ShortcutInput
            :model-value="settings.shortcuts.stickyNotesPopup"
            :disabled="!isShortcutEnabled('stickyNotesPopup')"
            placeholder="未设置"
            @update:model-value="onShortcutChange('stickyNotesPopup', $event)"
          />
          <label class="switch">
            <input
              type="checkbox"
              :checked="isShortcutEnabled('stickyNotesPopup')"
              @change="
                onShortcutEnabledChange(
                  'stickyNotesPopup',
                  ($event.target as HTMLInputElement).checked
                )
              "
            />
            <span class="slider" />
          </label>
        </div>
      </div>

      <div class="row">
        <div class="label shortcut-label">
          <span>开始截图</span>
          <span v-if="hasExistingShortcutConflict('snipStart')" class="conflict-badge">冲突</span>
        </div>
        <div class="shortcut-actions">
          <ShortcutInput
            :model-value="settings.shortcuts.snipStart"
            :disabled="!isShortcutEnabled('snipStart')"
            placeholder="未设置"
            @update:model-value="onShortcutChange('snipStart', $event)"
          />
          <label class="switch">
            <input
              type="checkbox"
              :checked="isShortcutEnabled('snipStart')"
              @change="
                onShortcutEnabledChange('snipStart', ($event.target as HTMLInputElement).checked)
              "
            />
            <span class="slider" />
          </label>
        </div>
      </div>

      <div class="row">
        <div class="label shortcut-label">
          <span>剪贴板贴图</span>
          <span v-if="hasExistingShortcutConflict('stickerPaste')" class="conflict-badge"
            >冲突</span
          >
        </div>
        <div class="shortcut-actions">
          <ShortcutInput
            :model-value="settings.shortcuts.stickerPaste"
            :disabled="!isShortcutEnabled('stickerPaste')"
            placeholder="未设置"
            @update:model-value="onShortcutChange('stickerPaste', $event)"
          />
          <label class="switch">
            <input
              type="checkbox"
              :checked="isShortcutEnabled('stickerPaste')"
              @change="
                onShortcutEnabledChange('stickerPaste', ($event.target as HTMLInputElement).checked)
              "
            />
            <span class="slider" />
          </label>
        </div>
      </div>

      <div class="row">
        <div class="label shortcut-label">
          <span>隐藏/显示所有贴图</span>
          <span v-if="hasExistingShortcutConflict('stickersToggleHidden')" class="conflict-badge">
            冲突
          </span>
        </div>
        <div class="shortcut-actions">
          <ShortcutInput
            :model-value="settings.shortcuts.stickersToggleHidden"
            :disabled="!isShortcutEnabled('stickersToggleHidden')"
            placeholder="未设置"
            @update:model-value="onShortcutChange('stickersToggleHidden', $event)"
          />
          <label class="switch">
            <input
              type="checkbox"
              :checked="isShortcutEnabled('stickersToggleHidden')"
              @change="
                onShortcutEnabledChange(
                  'stickersToggleHidden',
                  ($event.target as HTMLInputElement).checked
                )
              "
            />
            <span class="slider" />
          </label>
        </div>
      </div>

      <div class="shortcut-group">
        <div class="shortcut-group-title">窗口收纳</div>

        <div class="row">
          <div class="label shortcut-label">
            <span>窗口置顶</span>
            <span v-if="hasExistingShortcutConflict('toggleTopmost')" class="conflict-badge"
              >冲突</span
            >
          </div>
          <div class="shortcut-actions">
            <ShortcutInput
              :model-value="settings.shortcuts.toggleTopmost"
              :disabled="!isShortcutEnabled('toggleTopmost')"
              placeholder="未设置"
              @update:model-value="onShortcutChange('toggleTopmost', $event)"
            />
            <label class="switch">
              <input
                type="checkbox"
                :checked="isShortcutEnabled('toggleTopmost')"
                @change="
                  onShortcutEnabledChange(
                    'toggleTopmost',
                    ($event.target as HTMLInputElement).checked
                  )
                "
              />
              <span class="slider" />
            </label>
          </div>
        </div>

        <div class="row">
          <div class="label shortcut-label">
            <span>收纳到左侧</span>
            <span v-if="hasExistingShortcutConflict('stashLeft')" class="conflict-badge">冲突</span>
          </div>
          <div class="shortcut-actions">
            <ShortcutInput
              :model-value="settings.shortcuts.stashLeft"
              :disabled="!isShortcutEnabled('stashLeft')"
              placeholder="未设置"
              @update:model-value="onShortcutChange('stashLeft', $event)"
            />
            <label class="switch">
              <input
                type="checkbox"
                :checked="isShortcutEnabled('stashLeft')"
                @change="
                  onShortcutEnabledChange('stashLeft', ($event.target as HTMLInputElement).checked)
                "
              />
              <span class="slider" />
            </label>
          </div>
        </div>

        <div class="row">
          <div class="label shortcut-label">
            <span>收纳到上侧</span>
            <span v-if="hasExistingShortcutConflict('stashTop')" class="conflict-badge">冲突</span>
          </div>
          <div class="shortcut-actions">
            <ShortcutInput
              :model-value="settings.shortcuts.stashTop"
              :disabled="!isShortcutEnabled('stashTop')"
              placeholder="未设置"
              @update:model-value="onShortcutChange('stashTop', $event)"
            />
            <label class="switch">
              <input
                type="checkbox"
                :checked="isShortcutEnabled('stashTop')"
                @change="
                  onShortcutEnabledChange('stashTop', ($event.target as HTMLInputElement).checked)
                "
              />
              <span class="slider" />
            </label>
          </div>
        </div>

        <div class="row">
          <div class="label shortcut-label">
            <span>收纳到右侧</span>
            <span v-if="hasExistingShortcutConflict('stashRight')" class="conflict-badge"
              >冲突</span
            >
          </div>
          <div class="shortcut-actions">
            <ShortcutInput
              :model-value="settings.shortcuts.stashRight"
              :disabled="!isShortcutEnabled('stashRight')"
              placeholder="未设置"
              @update:model-value="onShortcutChange('stashRight', $event)"
            />
            <label class="switch">
              <input
                type="checkbox"
                :checked="isShortcutEnabled('stashRight')"
                @change="
                  onShortcutEnabledChange('stashRight', ($event.target as HTMLInputElement).checked)
                "
              />
              <span class="slider" />
            </label>
          </div>
        </div>

        <div class="row">
          <div class="label shortcut-label">
            <span>收纳到下侧</span>
            <span v-if="hasExistingShortcutConflict('stashBottom')" class="conflict-badge"
              >冲突</span
            >
          </div>
          <div class="shortcut-actions">
            <ShortcutInput
              :model-value="settings.shortcuts.stashBottom"
              :disabled="!isShortcutEnabled('stashBottom')"
              placeholder="未设置"
              @update:model-value="onShortcutChange('stashBottom', $event)"
            />
            <label class="switch">
              <input
                type="checkbox"
                :checked="isShortcutEnabled('stashBottom')"
                @change="
                  onShortcutEnabledChange(
                    'stashBottom',
                    ($event.target as HTMLInputElement).checked
                  )
                "
              />
              <span class="slider" />
            </label>
          </div>
        </div>
      </div>

      <div class="hint">点击上方快捷键进行录制，支持 Ctrl, Alt, Shift, Meta 组合</div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">翻译服务</div>
      </div>

      <div class="row">
        <div class="label">Provider</div>
        <v-select
          class="select"
          :items="translateProviderItems"
          item-title="title"
          item-value="value"
          :model-value="settings.translate.provider"
          density="compact"
          single-line
          variant="outlined"
          hide-details
          @update:model-value="onTranslateProviderChange"
        />
      </div>

      <template v-if="settings.translate.provider === 'baidu'">
        <div class="row">
          <div class="label">Base URL</div>
          <input
            class="text"
            type="text"
            :value="settings.translate.baidu.baseUrl"
            placeholder="默认：https://fanyi-api.baidu.com"
            @change="
              update({
                translate: { baidu: { baseUrl: ($event.target as HTMLInputElement).value } }
              })
            "
          />
        </div>

        <div class="row">
          <div class="label">App ID</div>
          <input
            class="text"
            type="text"
            :value="settings.translate.baidu.appId"
            placeholder="百度翻译开放平台 appid"
            @change="
              update({
                translate: { baidu: { appId: ($event.target as HTMLInputElement).value } }
              })
            "
          />
        </div>

        <div class="row">
          <div class="label">Secret</div>
          <input
            class="text"
            type="password"
            :value="settings.translate.baidu.secret"
            placeholder="百度翻译开放平台 secret"
            @change="
              update({
                translate: { baidu: { secret: ($event.target as HTMLInputElement).value } }
              })
            "
          />
        </div>
      </template>

      <template v-else-if="settings.translate.provider === 'bing'">
        <div class="row">
          <div class="label">Base URL</div>
          <input
            class="text"
            type="text"
            :value="settings.translate.bing.baseUrl"
            placeholder="默认：https://api.cognitive.microsofttranslator.com"
            @change="
              update({
                translate: { bing: { baseUrl: ($event.target as HTMLInputElement).value } }
              })
            "
          />
        </div>

        <div class="row">
          <div class="label">Key</div>
          <input
            class="text"
            type="password"
            :value="settings.translate.bing.key"
            placeholder="Microsoft Translator key"
            @change="
              update({
                translate: { bing: { key: ($event.target as HTMLInputElement).value } }
              })
            "
          />
        </div>

        <div class="row">
          <div class="label">Region</div>
          <input
            class="text"
            type="text"
            :value="settings.translate.bing.region"
            placeholder="例如：eastasia / westeurope"
            @change="
              update({
                translate: { bing: { region: ($event.target as HTMLInputElement).value } }
              })
            "
          />
        </div>
      </template>

      <template v-else>
        <div class="hint">
          使用下方「AI 服务」配置的 Base URL / Model / API Key，通过 /v1/chat/completions 进行翻译。
        </div>
      </template>

      <div class="row">
        <div class="label">默认源语言</div>
        <v-select
          class="select"
          :items="translateSourceItems"
          item-title="title"
          item-value="value"
          :model-value="settings.translate.defaultSource"
          density="compact"
          single-line
          variant="outlined"
          hide-details
          @update:model-value="onTranslateSourceChange"
        />
      </div>

      <div class="row">
        <div class="label">默认目标语言</div>
        <v-select
          class="select"
          :items="translateTargetItems"
          item-title="title"
          item-value="value"
          :model-value="settings.translate.defaultTarget"
          density="compact"
          single-line
          variant="outlined"
          hide-details
          @update:model-value="onTranslateTargetChange"
        />
      </div>

      <div class="hint">
        百度翻译接口：/api/trans/vip/translate；必应翻译接口：/translate?api-version=3.0；AI：/v1/chat/completions
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">AI 服务</div>
      </div>

      <div class="row">
        <div class="label">启用</div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settings.ai.enabled"
            @change="
              update({
                ai: { enabled: ($event.target as HTMLInputElement).checked }
              })
            "
          />
          <span class="slider" />
        </label>
      </div>

      <div class="row">
        <div class="label">Provider</div>
        <v-select
          class="select"
          :items="aiProviderItems"
          item-title="title"
          item-value="value"
          :model-value="settings.ai.provider"
          density="compact"
          single-line
          variant="outlined"
          hide-details
          @update:model-value="onAiProviderChange"
        />
      </div>

      <div class="row">
        <div class="label">Base URL</div>
        <input
          class="text"
          type="text"
          :value="settings.ai.baseUrl"
          :placeholder="aiBaseUrlPlaceholder"
          @change="
            update({
              ai: { baseUrl: ($event.target as HTMLInputElement).value }
            })
          "
        />
      </div>

      <template v-if="aiModelsForProvider.length">
        <div class="row">
          <div class="label">模型选择</div>
          <v-select
            class="select"
            :items="aiModelsForProvider"
            :model-value="aiModelsForProvider.includes(settings.ai.model) ? settings.ai.model : ''"
            placeholder="选择模型"
            density="compact"
            single-line
            variant="outlined"
            hide-details
            @update:model-value="onAiModelChange"
          />
        </div>
      </template>

      <div class="row">
        <div class="label">API Key</div>
        <div class="api-key-field">
          <input
            v-model="aiApiKeyDraft"
            class="api-key-input"
            type="password"
            :placeholder="settings.ai.apiKeySet ? '已保存（输入新 Key 覆盖）' : '未设置'"
            @change="setAiApiKey"
          />
          <button
            class="api-key-action"
            type="button"
            title="清除"
            aria-label="清除"
            :disabled="!settings.ai.apiKeySet"
            @click="clearAiApiKey"
          >
            <Delete :size="20" />
          </button>
        </div>
      </div>

      <div class="row">
        <div class="label">Model</div>
        <input
          class="text"
          type="text"
          :value="settings.ai.model"
          placeholder="例如：gpt-4o-mini"
          @change="
            update({
              ai: { model: ($event.target as HTMLInputElement).value }
            })
          "
        />
      </div>

      <div class="hint">预留配置：后续 AI 能力工具将复用此处设置</div>
    </section>

    <footer class="footer">
      <!-- <div class="version">{{ version }}</div>
      <div class="status">{{ saving ? '保存中…' : '已保存' }}</div> -->
    </footer>

    <Teleport to="body">
      <div v-if="shortcutConflict" class="conflict-overlay" @click.self="closeShortcutConflict">
        <div class="conflict-modal">
          <div class="conflict-header">
            <div class="conflict-title">快捷键冲突</div>
            <div class="conflict-subtitle">{{ shortcutConflict.value }} 已被占用</div>
          </div>

          <div class="conflict-body">
            <div class="conflict-section-title">当前占用</div>
            <div class="conflict-list">
              <div v-for="c in shortcutConflict.conflicts" :key="c.key" class="conflict-item">
                {{ c.label }}
              </div>
            </div>

            <div class="conflict-section-title">将要设置为</div>
            <div class="conflict-target">{{ shortcutConflict.targetLabel }}</div>
            <div class="conflict-hint">选择「替换」会清除上面所有占用项的绑定。</div>
          </div>

          <div class="conflict-footer">
            <button class="btn primary" type="button" @click="applyShortcutReplace">替换</button>
            <button class="btn" type="button" @click="closeShortcutConflict">取消</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
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

.card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
}

.label {
  font-size: 13px;
  color: var(--ev-c-text-2);
  flex: 1;
}

.shortcut-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conflict-badge {
  font-size: 12px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.14);
  color: rgba(255, 255, 245, 0.92);
}

.conflict-summary {
  border: 1px solid rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conflict-summary-title {
  font-size: 12px;
  font-weight: 900;
  color: rgba(255, 255, 245, 0.92);
}

.conflict-summary-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.conflict-summary-key {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 900;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.12);
  color: rgba(255, 255, 245, 0.92);
  padding: 2px 8px;
  border-radius: 999px;
}

.conflict-summary-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.conflict-summary-action {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.12);
  color: rgba(255, 255, 245, 0.9);
}

.shortcut-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.switch {
  position: relative;
  display: inline-block;
  width: 46px;
  height: 26px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.12);
  transition: 0.2s;
  border-radius: 999px;
}

.slider:before {
  position: absolute;
  content: '';
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: rgba(255, 255, 255, 0.9);
  transition: 0.2s;
  border-radius: 50%;
}

.switch input:checked + .slider {
  background-color: rgba(59, 130, 246, 0.65);
}

.switch input:checked + .slider:before {
  transform: translateX(20px);
}

.text {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  color: var(--ev-c-text-1);
  outline: none;
  font-size: 13px;
  width: 200px;
  text-align: right;
}

.path-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.api-key-field {
  position: relative;
  width: 200px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  color: var(--ev-c-text-1);
  display: flex;
  align-items: center;
}

.api-key-field:focus-within {
  border-color: rgba(59, 130, 246, 0.5);
}

.api-key-input {
  width: 100%;
  padding: 6px 38px 6px 10px;
  border: 0;
  background: transparent;
  color: inherit;
  outline: none;
  font-size: 13px;
  text-align: right;
}

.api-key-action {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  height: 26px;
  width: 26px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 245, 0.92);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.api-key-action:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.api-key-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.path {
  width: 360px;
  text-align: left;
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

.icon-btn {
  padding: 7px;
  display: inline-grid;
  place-items: center;
  min-width: 34px;
  line-height: 1;
}

.select {
  flex: 1;
}

.select :deep(.v-field__input) {
  justify-content: flex-end;
}

.select :deep(input) {
  text-align: right;
}

.select :deep(.v-select__selection-text) {
  text-align: right;
}

.text:focus {
  border-color: rgba(59, 130, 246, 0.5);
}

.hint {
  font-size: 12px;
  color: var(--ev-c-text-3);
  margin-top: -4px;
}

.shortcut-group {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.12);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.shortcut-group-title {
  font-size: 12px;
  color: var(--ev-c-text-2);
  font-weight: 700;
}

.shortcut-group .row {
  min-height: 30px;
}

.shortcut-group .label {
  color: rgba(235, 235, 245, 0.82);
}

.footer {
  margin-top: auto;
  padding-top: 8px;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--ev-c-text-3);
}

.status {
  font-size: 12px;
  color: var(--ev-c-text-3);
}

.conflict-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.conflict-modal {
  background: #1e293b;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  width: 520px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
}

.conflict-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.conflict-title {
  font-size: 16px;
  font-weight: 800;
  color: rgba(255, 255, 245, 0.92);
}

.conflict-subtitle {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.65);
}

.conflict-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conflict-section-title {
  font-size: 12px;
  font-weight: 800;
  color: rgba(235, 235, 245, 0.82);
}

.conflict-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.conflict-item {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.18);
  font-size: 13px;
  color: rgba(255, 255, 245, 0.9);
}

.conflict-target {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(34, 230, 234, 0.25);
  background: rgba(34, 230, 234, 0.08);
  font-size: 13px;
  font-weight: 800;
  color: rgba(255, 255, 245, 0.92);
}

.conflict-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
}

.conflict-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

.btn.primary {
  background: var(--color-text);
  color: #000;
  border-color: transparent;
}

.btn.primary:hover {
  background: #22e6ea;
}
</style>
