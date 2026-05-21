<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  AiProfile,
  AiProfileSource,
  AiProvider,
  AppSettings,
  SettingsPatch
} from '@shared/settings'
import ShortcutInput from '../../components/ShortcutInput.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import { FolderOpen, Plus, Trash2 } from 'lucide-vue-next'
import { AI_PROVIDERS } from '../../constants/aiProviders'
import { Languages } from '@renderer/utils/bean'
import { useSettingsStore } from '@renderer/state/settings'

const settingsStore = useSettingsStore()
const settings = settingsStore.settings
const saving = ref(false)
const appPaths = ref<{ userData: string; pictures: string } | null>(null)
const version = ref('')
const aiConfigModalOpen = ref(false)
const aiConfigMode = ref<AiProfileSource>('provider')
const aiConfigSaving = ref(false)
const aiConfigError = ref('')
const aiSelectorOpen = ref(false)

type AiModelOptionValue = `profile:${string}`
type AiConfigDraft = {
  id: string
  name: string
  provider: AiProvider
  baseUrl: string
  model: string
  apiKey: string
}

const shortcutLabels: Record<string, string> = {
  toggleEye: '开启/关闭护眼模式',
  translateSelection: '划词翻译弹窗',
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

const aiProviderItems: Array<{ title: string; value: Exclude<AiProvider, 'custom'> }> =
  Object.values(AI_PROVIDERS).map((item) => ({ title: item.title, value: item.value }))

function toSelectOptions<T extends string>(
  items: Array<{ title: string; value: T }>
): Array<{ label: string; value: T }> {
  return items.map((i) => ({ label: i.title, value: i.value }))
}

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

function createAiConfigDraft(provider: Exclude<AiProvider, 'custom'> = 'openai'): AiConfigDraft {
  const preset = AI_PROVIDERS[provider]
  return {
    id: '',
    name: '',
    provider,
    baseUrl: preset.baseUrl,
    model: preset.models[0] ?? '',
    apiKey: ''
  }
}

const aiConfigDraft = ref<AiConfigDraft>(createAiConfigDraft())

const aiProviderLabelMap = computed(() => {
  return {
    ...Object.fromEntries(aiProviderItems.map((item) => [item.value, item.title])),
    custom: '自定义'
  } as Record<AiProvider, string>
})

const activeAiProfile = computed(() => {
  const activeId = settings.value.ai.activeProfileId.trim()
  if (!activeId) return null
  return settings.value.ai.profiles.find((item) => item.id === activeId) ?? null
})

const serviceAiProfiles = computed(() => {
  return settings.value.ai.profiles.filter((item) => item.source === 'provider')
})

const customAiProfiles = computed(() => {
  return settings.value.ai.profiles.filter((item) => item.source === 'custom')
})

type AiSelectorItem = {
  id: string
  label: string
  value: AiModelOptionValue
  isActive: boolean
}

const serviceAiSelectorItems = computed<AiSelectorItem[]>(() => {
  return serviceAiProfiles.value.map((item) => ({
    id: item.id,
    label: item.name,
    value: `profile:${item.id}` as AiModelOptionValue,
    isActive: item.id === settings.value.ai.activeProfileId
  }))
})

const customAiSelectorItems = computed<AiSelectorItem[]>(() => {
  return customAiProfiles.value.map((item) => ({
    id: item.id,
    label: item.name,
    value: `profile:${item.id}` as AiModelOptionValue,
    isActive: item.id === settings.value.ai.activeProfileId
  }))
})

const aiSelectorGroups = computed(() => {
  const groups: Array<{ label: string; options: AiSelectorItem[] }> = []
  if (serviceAiSelectorItems.value.length) {
    groups.push({ label: '服务商模型', options: serviceAiSelectorItems.value })
  }
  if (customAiSelectorItems.value.length) {
    groups.push({ label: '自定义模型', options: customAiSelectorItems.value })
  }
  return groups
})

const aiModelSelectOptions = computed(() => {
  const groups: Array<{
    label: string
    options: Array<{ label: string; value: AiModelOptionValue }>
  }> = []
  if (serviceAiProfiles.value.length) {
    groups.push({
      label: '服务商模型',
      options: serviceAiProfiles.value.map((item) => ({
        label: item.name,
        value: `profile:${item.id}` as AiModelOptionValue
      }))
    })
  }
  if (customAiProfiles.value.length) {
    groups.push({
      label: '自定义模型',
      options: customAiProfiles.value.map((item) => ({
        label: item.name,
        value: `profile:${item.id}` as AiModelOptionValue
      }))
    })
  }
  return groups
})

const activeAiModelValue = computed<AiModelOptionValue | undefined>(() => {
  return activeAiProfile.value ? `profile:${activeAiProfile.value.id}` : undefined
})

const aiCurrentModelSummary = computed(() => {
  if (activeAiProfile.value) {
    return {
      title: activeAiProfile.value.name,
      subtitle: `${aiProviderLabelMap.value[activeAiProfile.value.provider]} · ${activeAiProfile.value.baseUrl}`
    }
  }
  return {
    title: '未配置模型',
    subtitle: '先添加服务商模型或自定义模型'
  }
})

const aiConfigProviderModelOptions = computed(() => {
  if (aiConfigMode.value !== 'provider' || aiConfigDraft.value.provider === 'custom') return []
  return AI_PROVIDERS[aiConfigDraft.value.provider].models.map((item) => ({
    label: item,
    value: item
  }))
})

const aiConfigActionLabel = computed(() => {
  return aiConfigDraft.value.id ? '保存配置' : '添加模型'
})

const aiCanEditCurrentProfile = computed(() => Boolean(activeAiProfile.value))

const aiDraftProfile = computed(() => {
  const id = aiConfigDraft.value.id.trim()
  if (!id) return null
  return settings.value.ai.profiles.find((item) => item.id === id) ?? null
})

const aiCanClearDraftApiKey = computed(() => Boolean(aiDraftProfile.value?.apiKeySet))

const aiConfigTitle = computed(() => {
  return aiConfigDraft.value.id ? '编辑模型' : '添加模型'
})

const aiConfigSubtitle = computed(() => {
  return aiConfigMode.value === 'provider'
    ? '按服务商保存一个独立配置，每个配置使用自己的密钥'
    : '录入兼容 OpenAI 的自定义模型配置，每个配置使用自己的密钥'
})

function createAiConfigId(): string {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function parseAiModelValue(value: string): { kind: 'profile'; id: string } | null {
  if (value.startsWith('profile:')) {
    const id = value.slice('profile:'.length).trim()
    return id ? { kind: 'profile', id } : null
  }
  return null
}

function buildProviderProfileName(provider: Exclude<AiProvider, 'custom'>, model: string): string {
  return `${AI_PROVIDERS[provider].title} · ${model}`
}

function upsertAiProfile(list: AiProfile[], next: AiProfile): AiProfile[] {
  const index = list.findIndex((item) => item.id === next.id)
  if (index < 0) return [next, ...list]
  return list.map((item, idx) => (idx === index ? next : item))
}

function syncAiConfigProviderDraft(): void {
  if (aiConfigDraft.value.provider === 'custom') aiConfigDraft.value.provider = 'openai'
  const preset = AI_PROVIDERS[aiConfigDraft.value.provider]
  aiConfigDraft.value.baseUrl = preset.baseUrl
  if (!preset.models.includes(aiConfigDraft.value.model)) {
    aiConfigDraft.value.model = preset.models[0] ?? ''
  }
}

function openAddAiConfigModal(mode: AiProfileSource = 'provider'): void {
  aiSelectorOpen.value = false
  aiConfigError.value = ''
  aiConfigMode.value = mode
  aiConfigDraft.value = createAiConfigDraft()
  if (mode === 'custom') {
    aiConfigDraft.value.provider = 'custom'
    aiConfigDraft.value.baseUrl = ''
    aiConfigDraft.value.model = ''
  } else {
    syncAiConfigProviderDraft()
  }
  aiConfigModalOpen.value = true
}

function openEditAiConfigModal(): void {
  const profile = activeAiProfile.value
  if (!profile) return
  aiConfigError.value = ''
  aiConfigMode.value = profile.source
  aiConfigDraft.value = {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey: ''
  }
  if (profile.source === 'provider' && profile.provider !== 'custom') syncAiConfigProviderDraft()
  aiConfigModalOpen.value = true
}

function closeAiConfigModal(): void {
  if (aiConfigSaving.value) return
  aiConfigModalOpen.value = false
  aiConfigError.value = ''
  aiConfigDraft.value = createAiConfigDraft()
}

function forceCloseAiConfigModal(): void {
  aiConfigModalOpen.value = false
  aiConfigError.value = ''
  aiConfigDraft.value = createAiConfigDraft()
}

function setAiConfigMode(mode: AiProfileSource): void {
  aiConfigMode.value = mode
  aiConfigError.value = ''
  if (mode === 'provider') {
    if (aiConfigDraft.value.provider === 'custom') aiConfigDraft.value.provider = 'openai'
    syncAiConfigProviderDraft()
    return
  }
  if (!aiConfigDraft.value.id) aiConfigDraft.value.name = aiConfigDraft.value.model
  aiConfigDraft.value.provider = 'custom'
}

function onAiConfigProviderChange(value: Exclude<AiProvider, 'custom'>): void {
  aiConfigDraft.value.provider = value
  syncAiConfigProviderDraft()
}

function onTranslateProviderChange(value: AppSettings['translate']['provider']): void {
  update({ translate: { provider: value } }).catch(() => null)
}

function onTranslateSourceChange(value: string): void {
  update({ translate: { defaultSource: value } }).catch(() => null)
}

function onTranslateTargetChange(value: string): void {
  update({ translate: { defaultTarget: value } }).catch(() => null)
}

async function onAiModelChange(value: string): Promise<void> {
  const parsed = parseAiModelValue(value)
  if (!parsed) return
  const profile = settings.value.ai.profiles.find((item) => item.id === parsed.id)
  if (!profile) return
  await update({
    ai: {
      activeProfileId: profile.id,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKeySet: profile.apiKeySet
    }
  }).catch(() => null)
  aiSelectorOpen.value = false
}

async function removeAiProfile(profileId: string): Promise<void> {
  const id = profileId.trim()
  if (!id || id === settings.value.ai.activeProfileId) return
  const nextProfiles = settings.value.ai.profiles.filter((item) => item.id !== id)
  await update({ ai: { profiles: nextProfiles } }).catch(() => null)
  const result = await window.electron.ipcRenderer.invoke('ai:apiKey:clear', { profileId: id })
  settingsStore.replace(result as AppSettings)
}

async function refresh(): Promise<void> {
  await settingsStore.refresh()
}

async function update(patch: SettingsPatch): Promise<void> {
  saving.value = true
  try {
    await settingsStore.update(patch)
  } finally {
    saving.value = false
  }
}

async function submitAiConfig(): Promise<void> {
  aiConfigError.value = ''
  aiConfigSaving.value = true
  try {
    if (aiConfigMode.value === 'provider') {
      if (aiConfigDraft.value.provider === 'custom') throw new Error('请选择模型服务商')
      const provider = aiConfigDraft.value.provider
      const preset = AI_PROVIDERS[provider]
      const model = aiConfigDraft.value.model.trim()
      if (!model) throw new Error('请选择模型')
      const id = aiConfigDraft.value.id || createAiConfigId()
      const existingProfile = settings.value.ai.profiles.find((item) => item.id === id) ?? null
      const nextApiKey = aiConfigDraft.value.apiKey.trim()
      const hasExistingApiKey = nextApiKey ? true : Boolean(existingProfile?.apiKeySet)
      if (!hasExistingApiKey) throw new Error('请填写 API Key')
      const nextProfile: AiProfile = {
        id,
        name: buildProviderProfileName(provider, model),
        source: 'provider',
        provider,
        baseUrl: preset.baseUrl,
        model,
        apiKeySet: hasExistingApiKey
      }
      const nextProfiles = upsertAiProfile(settings.value.ai.profiles, nextProfile)
      await update({
        ai: {
          activeProfileId: id,
          provider,
          baseUrl: preset.baseUrl,
          model,
          apiKeySet: hasExistingApiKey,
          profiles: nextProfiles
        }
      })
      if (nextApiKey) {
        const result = await window.electron.ipcRenderer.invoke('ai:apiKey:set', {
          profileId: id,
          apiKey: nextApiKey
        })
        settingsStore.replace(result as AppSettings)
      }
      forceCloseAiConfigModal()
      return
    }

    const id = aiConfigDraft.value.id || createAiConfigId()
    const name = aiConfigDraft.value.name.trim()
    const baseUrl = aiConfigDraft.value.baseUrl.trim()
    const model = aiConfigDraft.value.model.trim()
    if (!name) throw new Error('请填写模型名称')
    if (!baseUrl) throw new Error('请填写 Base URL')
    if (!model) throw new Error('请填写模型 ID')
    const existingProfile = settings.value.ai.profiles.find((item) => item.id === id) ?? null
    const nextApiKey = aiConfigDraft.value.apiKey.trim()
    const hasApiKey = nextApiKey ? true : Boolean(existingProfile?.apiKeySet)
    if (!hasApiKey) throw new Error('请填写 API Key')
    const nextProfile: AiProfile = {
      id,
      name,
      source: 'custom',
      provider: 'custom',
      baseUrl,
      model,
      apiKeySet: hasApiKey
    }
    const nextProfiles = upsertAiProfile(settings.value.ai.profiles, nextProfile)
    await update({
      ai: {
        activeProfileId: id,
        provider: 'custom',
        baseUrl,
        model,
        apiKeySet: hasApiKey,
        profiles: nextProfiles
      }
    })
    if (nextApiKey) {
      const result = await window.electron.ipcRenderer.invoke('ai:apiKey:set', {
        profileId: id,
        apiKey: nextApiKey
      })
      settingsStore.replace(result as AppSettings)
    }
    forceCloseAiConfigModal()
  } catch (error) {
    aiConfigError.value = error instanceof Error ? error.message : '保存失败'
  } finally {
    aiConfigSaving.value = false
  }
}

async function clearAiConfigApiKey(): Promise<void> {
  const profile = aiDraftProfile.value
  if (!profile) return
  aiConfigSaving.value = true
  try {
    const result = await window.electron.ipcRenderer.invoke('ai:apiKey:clear', {
      profileId: profile.id
    })
    settingsStore.replace(result as AppSettings)
    aiConfigDraft.value.apiKey = ''
  } finally {
    aiConfigSaving.value = false
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
        <AppSwitch
          :model-value="settings.general.autoStart"
          @update:model-value="update({ general: { autoStart: $event } })"
        />
      </div>

      <div class="row">
        <div class="label">关闭时最小化到托盘</div>
        <AppSwitch
          :model-value="settings.general.minimizeToTray"
          @update:model-value="update({ general: { minimizeToTray: $event } })"
        />
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
            class="flex px-[6px] py-[4px] rounded-[4px] bg-[#99999933] border-none"
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
            class="flex px-[6px] py-[4px] rounded-[4px] bg-[#99999933] border-none"
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
        <AppSwitch
          :model-value="settings.snip.enabled"
          @update:model-value="update({ snip: { enabled: $event } })"
        />
      </div>

      <div class="row">
        <div class="label">截图时隐藏护眼遮罩</div>
        <AppSwitch
          :model-value="settings.snip.suspendEyeOverlay"
          :disabled="!settings.snip.enabled"
          @update:model-value="update({ snip: { suspendEyeOverlay: $event } })"
        />
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
          <AppSwitch
            :model-value="isShortcutEnabled('toggleEye')"
            @update:model-value="onShortcutEnabledChange('toggleEye', $event)"
          />
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
          <AppSwitch
            :model-value="isShortcutEnabled('translateSelection')"
            @update:model-value="onShortcutEnabledChange('translateSelection', $event)"
          />
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
          <AppSwitch
            :model-value="isShortcutEnabled('stickyNotesPopup')"
            @update:model-value="onShortcutEnabledChange('stickyNotesPopup', $event)"
          />
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
          <AppSwitch
            :model-value="isShortcutEnabled('snipStart')"
            @update:model-value="onShortcutEnabledChange('snipStart', $event)"
          />
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
          <AppSwitch
            :model-value="isShortcutEnabled('stickerPaste')"
            @update:model-value="onShortcutEnabledChange('stickerPaste', $event)"
          />
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
          <AppSwitch
            :model-value="isShortcutEnabled('stickersToggleHidden')"
            @update:model-value="onShortcutEnabledChange('stickersToggleHidden', $event)"
          />
        </div>
      </div>

      <div class="shortcut-group">
        <div class="shortcut-group-title">窗口收纳</div>

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
            <AppSwitch
              :model-value="isShortcutEnabled('stashLeft')"
              @update:model-value="onShortcutEnabledChange('stashLeft', $event)"
            />
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
            <AppSwitch
              :model-value="isShortcutEnabled('stashTop')"
              @update:model-value="onShortcutEnabledChange('stashTop', $event)"
            />
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
            <AppSwitch
              :model-value="isShortcutEnabled('stashRight')"
              @update:model-value="onShortcutEnabledChange('stashRight', $event)"
            />
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
            <AppSwitch
              :model-value="isShortcutEnabled('stashBottom')"
              @update:model-value="onShortcutEnabledChange('stashBottom', $event)"
            />
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
        <a-select
          class="select"
          :value="settings.translate.provider"
          :options="toSelectOptions(translateProviderItems)"
          @change="onTranslateProviderChange"
        />
      </div>

      <template v-if="settings.translate.provider === 'baidu'">
        <div class="row">
          <div class="label">Base URL</div>
          <a-input
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
        <a-alert
          message="使用下方「AI 服务」配置的 Base URL / Model / API Key，进行翻译。"
          type="info"
          show-icon
        >
        </a-alert>
      </template>

      <div class="row">
        <div class="label">默认源语言</div>
        <a-select
          class="select"
          :value="settings.translate.defaultSource"
          :options="toSelectOptions(translateSourceItems)"
          @change="onTranslateSourceChange"
        />
      </div>

      <div class="row">
        <div class="label">默认目标语言</div>
        <a-select
          class="select"
          :value="settings.translate.defaultTarget"
          :options="toSelectOptions(translateTargetItems)"
          @change="onTranslateTargetChange"
        />
      </div>

      <!-- <a-alert
        message="百度翻译接口：/api/trans/vip/translate；必应翻译接口：/translate?api-version=3.0；AI：/v1/chat/completions"
        type="info"
        show-icon
        closable
      >
      </a-alert> -->
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">AI 服务</div>
      </div>

      <div class="row">
        <div class="label">启用</div>
        <AppSwitch
          :model-value="settings.ai.enabled"
          @update:model-value="update({ ai: { enabled: $event } })"
        />
      </div>

      <div class="row">
        <div class="label">
          <div class="ai-model-label">当前模型</div>
          <!-- <div class="ai-model-hint">{{ aiCurrentModelSummary.subtitle }}</div> -->
        </div>

        <div class="ai-model-actions">
          <a-select
            v-model:value="activeAiModelValue"
            v-model:open="aiSelectorOpen"
            class="select ai-model-select"
            placeholder="选择模型"
            :options="aiModelSelectOptions"
            :z-index="900"
            @blur="aiSelectorOpen = false"
            @change="onAiModelChange"
            @click="aiSelectorOpen = !aiSelectorOpen"
          >
            <template #dropdownRender>
              <div class="selector-groups">
                <div v-if="!aiSelectorGroups.length" class="selector-empty">暂无模型配置</div>
                <div v-for="group in aiSelectorGroups" :key="group.label" class="selector-group">
                  <div class="selector-group-title">{{ group.label }}</div>
                  <div v-for="item in group.options" :key="item.id" class="selector-item">
                    <button
                      class="selector-item-main"
                      :class="{
                        active: item.isActive
                      }"
                      type="button"
                      @click="onAiModelChange(item.value)"
                    >
                      <span class="selector-item-label">{{ item.label }}</span>
                      <!-- <span v-if="item.isActive" class="selector-item-badge">当前</span> -->
                    </button>
                    <button
                      v-if="!item.isActive"
                      class="selector-item-delete"
                      type="button"
                      title="删除"
                      aria-label="删除"
                      @click.stop="removeAiProfile(item.id)"
                    >
                      <Trash2 :size="14" />
                    </button>
                  </div>
                </div>
              </div>
              <a-divider style="margin: 4px 0" />
              <a-space style="padding: 4px 8px">
                <a-button type="primary" @click="openAddAiConfigModal('provider')">
                  <template #icon>
                    <Plus :size="14" />
                  </template>
                  添加模型
                </a-button>
              </a-space>
            </template>
          </a-select>
          <!-- <a-button
            class="ai-model-add-btn"
            type="primary"
            @click="openAddAiConfigModal('provider')"
          >
            <template #icon>
              <Plus :size="14" />
            </template>
            添加模型
          </a-button> -->
          <!-- <a-button
            class="ai-model-add-btn"
            :disabled="!aiCanEditCurrentProfile"
            @click="openEditAiConfigModal"
          >
            编辑
          </a-button> -->
        </div>
      </div>

      <div class="ai-current-model">
        <div class="ai-current-model-title">{{ aiCurrentModelSummary.title }}</div>
        <div class="ai-current-model-meta">
          <span>{{ settings.ai.apiKeySet ? '已配置密钥' : '未配置密钥' }}</span>
          <span>{{ settings.ai.enabled ? '已启用' : '未启用' }}</span>
        </div>
        <a-button
          class="ai-model-add-btn"
          :disabled="!aiCanEditCurrentProfile"
          @click="openEditAiConfigModal"
        >
          编辑
        </a-button>
      </div>
    </section>

    <footer class="footer">
      <!-- <div class="version">{{ version }}</div>
      <div class="status">{{ saving ? '保存中…' : '已保存' }}</div> -->
    </footer>

    <a-modal
      :open="Boolean(shortcutConflict)"
      centered
      :footer="null"
      @cancel="closeShortcutConflict"
    >
      <div v-if="shortcutConflict" class="conflict-modal">
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
          <a-button type="primary" @click="applyShortcutReplace">替换</a-button>
          <a-button @click="closeShortcutConflict">取消</a-button>
        </div>
      </div>
    </a-modal>

    <a-modal
      :open="aiConfigModalOpen"
      :footer="null"
      centered
      destroy-on-close
      width="640px"
      @cancel="closeAiConfigModal"
    >
      <div class="ai-config-modal">
        <div class="ai-config-header">
          <div>
            <div class="ai-config-title">{{ aiConfigTitle }}</div>
            <div class="ai-config-subtitle">{{ aiConfigSubtitle }}</div>
          </div>
          <!-- <button
            class="ai-config-close"
            type="button"
            aria-label="关闭"
            @click="closeAiConfigModal"
          >
            <X :size="18" />
          </button> -->
        </div>

        <div class="ai-config-mode">
          <button
            class="ai-config-mode-btn"
            :class="{ 'is-active': aiConfigMode === 'provider' }"
            type="button"
            @click="setAiConfigMode('provider')"
          >
            服务商模型
          </button>
          <button
            class="ai-config-mode-btn"
            :class="{ 'is-active': aiConfigMode === 'custom' }"
            type="button"
            @click="setAiConfigMode('custom')"
          >
            自定义配置
          </button>
        </div>

        <div v-if="aiConfigMode === 'provider'" class="ai-config-form">
          <div class="ai-config-field">
            <div class="ai-config-field-label">服务商</div>
            <a-select
              class="select ai-config-select"
              :value="aiConfigDraft.provider === 'custom' ? undefined : aiConfigDraft.provider"
              :options="toSelectOptions(aiProviderItems)"
              @change="onAiConfigProviderChange"
            />
          </div>

          <div class="ai-config-field">
            <div class="ai-config-field-label">模型</div>
            <a-select
              class="select ai-config-select"
              :value="aiConfigDraft.model"
              :options="aiConfigProviderModelOptions"
              @change="aiConfigDraft.model = $event"
            />
          </div>

          <div class="ai-config-field">
            <div class="ai-config-field-label">Base URL</div>
            <input
              class="text ai-config-input"
              type="text"
              :value="aiConfigDraft.baseUrl"
              disabled
            />
          </div>

          <div class="ai-config-field">
            <div class="ai-config-field-label">API Key</div>
            <input
              v-model="aiConfigDraft.apiKey"
              class="text ai-config-input"
              type="password"
              :placeholder="aiConfigDraft.id ? '留空则保留已保存的 Key' : '输入 API Key'"
            />
            <a-button
              v-if="aiCanClearDraftApiKey"
              class="ai-config-key-clear"
              danger
              @click="clearAiConfigApiKey"
            >
              清除当前密钥
            </a-button>
          </div>
        </div>

        <div v-else class="ai-config-form">
          <div class="ai-config-field">
            <div class="ai-config-field-label">模型名称</div>
            <input
              v-model="aiConfigDraft.name"
              class="text ai-config-input"
              type="text"
              placeholder="例如：DeepSeek Reasoner"
            />
          </div>

          <div class="ai-config-field">
            <div class="ai-config-field-label">Base URL</div>
            <input
              v-model="aiConfigDraft.baseUrl"
              class="text ai-config-input"
              type="text"
              placeholder="例如：https://api.openai.com/v1"
            />
          </div>

          <div class="ai-config-field">
            <div class="ai-config-field-label">模型 ID</div>
            <input
              v-model="aiConfigDraft.model"
              class="text ai-config-input"
              type="text"
              placeholder="例如：deepseek-reasoner"
            />
          </div>

          <div class="ai-config-field">
            <div class="ai-config-field-label">API Key</div>
            <input
              v-model="aiConfigDraft.apiKey"
              class="text ai-config-input"
              type="password"
              :placeholder="aiConfigDraft.id ? '留空则保留已保存的 Key' : '输入 API Key'"
            />
            <a-button
              v-if="aiCanClearDraftApiKey"
              class="ai-config-key-clear"
              danger
              @click="clearAiConfigApiKey"
            >
              清除当前密钥
            </a-button>
          </div>
        </div>

        <a-alert
          v-if="aiConfigError"
          class="ai-config-alert"
          :message="aiConfigError"
          type="error"
          show-icon
        />

        <div class="ai-config-footer">
          <a-button @click="closeAiConfigModal">取消</a-button>
          <a-button type="primary" :loading="aiConfigSaving" @click="submitAiConfig">
            {{ aiConfigActionLabel }}
          </a-button>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<style lang="scss" scoped>
.page-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* height: 100%; */
}

// :deep(.page-content) {
//   .z-index-select {
//     z-index: 900;
//   }
// }

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
  /* border: 1px solid rgba(255, 255, 255, 0.08); */
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

.ai-model-label {
  font-size: 13px;
  color: var(--ev-c-text-2);
}

.ai-model-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ev-c-text-3);
  line-height: 1.4;
}

.ai-model-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1.6;
  justify-content: flex-end;
}

.ai-model-select {
  min-width: 320px;
}

.ai-model-add-btn {
  flex-shrink: 0;
}

.selector-groups {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.selector-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.selector-group-title {
  padding: 6px 8px 2px;
  font-size: 11px;
  font-weight: 700;
  color: var(--ev-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.selector-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.selector-item-main {
  flex: 1;
  min-width: 0;
  border: 0;
  border-radius: 10px;
  background: none;
  // background: rgba(255, 255, 255, 0.04);
  color: var(--ev-c-text-1);
  padding: 9px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
  text-align: left;

  &.active {
    color: var(--ev-c-theme);
  }
}

.selector-item-main:hover {
  // background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.404);
}

.selector-item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selector-item-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.14);
  color: #86efac;
}

.selector-item-delete {
  height: 34px;
  width: 34px;
  border: 0;
  border-radius: 10px;
  // background: rgba(239, 68, 68, 0.1);
  background: none;
  color: rgba(248, 113, 113, 0.92);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.selector-item-delete:hover {
  background: rgba(239, 68, 68, 0.18);
}

.selector-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--ev-c-text-3);
  text-align: center;
}

.ai-current-model {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.14);
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ai-current-model-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ev-c-text-1);
}

.ai-current-model-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--ev-c-text-2);
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

.ai-config-modal {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ai-config-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.ai-config-title {
  font-size: 22px;
  font-weight: 800;
  color: var(--ev-c-text-1);
}

.ai-config-subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: var(--ev-c-text-2);
}

.ai-config-close {
  height: 32px;
  width: 32px;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--ev-c-text-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.ai-config-close:hover {
  background: rgba(255, 255, 255, 0.12);
}

.ai-config-mode {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
}

.ai-config-mode-btn {
  height: 42px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ev-c-text-2);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease;
}

.ai-config-mode-btn.is-active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--ev-c-text-1);
}

.ai-config-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ai-config-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-config-field-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--ev-c-text-1);
}

.ai-config-input,
.ai-config-select {
  width: 100%;
}

.ai-config-alert {
  margin-top: -2px;
}

.ai-config-key-clear {
  align-self: flex-start;
}

.ai-config-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* .text {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  color: var(--ev-c-text-1);
  outline: none;
  font-size: 13px;
  width: 200px;
  text-align: right;
} */

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

.icon-btn {
  padding: 7px;
  display: inline-grid;
  place-items: center;
  min-width: 34px;
  line-height: 1;
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
</style>
