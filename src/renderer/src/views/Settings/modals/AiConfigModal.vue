<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AI_MODEL_TYPE_LABELS } from '@shared/settings'
import { aiModelApi, type ProviderInfo } from '@renderer/utils/python-api'

const props = defineProps<{
  open: boolean
  modelId?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'close'): void
}>()

type ConfigMode = 'provider' | 'custom'

interface Draft {
  name: string
  provider: string
  baseUrl: string
  apiKey: string
  modelId: string
  modelType: string
}

const saving = ref(false)
const error = ref('')
const configMode = ref<ConfigMode>('provider')
const draft = ref<Draft>(createDraft())
const providers = ref<ProviderInfo[]>([])
const providersLoading = ref(false)

const providerSelectItems = computed(() =>
  providers.value.map((p) => ({ label: p.title, value: p.provider }))
)

const selectedProviderInfo = computed(() => {
  if (draft.value.provider === 'custom') return null
  return providers.value.find((p) => p.provider === draft.value.provider) ?? null
})

const providerModelOptions = computed(() => {
  const info = selectedProviderInfo.value
  if (!info || !info.models.length) return []
  return info.models.map((m) => ({ label: m, value: m }))
})

const title = computed(() => (props.modelId ? '编辑模型' : '添加模型'))

const subtitle = computed(() =>
  configMode.value === 'provider'
    ? '按服务商保存一个独立配置，每个配置使用自己的密钥'
    : '录入兼容 OpenAI 的自定义模型配置，每个配置使用自己的密钥'
)

const actionLabel = computed(() => (props.modelId ? '保存配置' : '添加模型'))

const aiModelTypeOptions = computed(() =>
  (Object.entries(AI_MODEL_TYPE_LABELS) as Array<[string, string]>).map(([value, label]) => ({
    value,
    label
  }))
)

function createDraft(): Draft {
  return { name: '', provider: 'openai', baseUrl: '', apiKey: '', modelId: '', modelType: 'llm' }
}

function resetForm(): void {
  error.value = ''
  saving.value = false
  configMode.value = 'provider'
  draft.value = createDraft()
  syncProviderDraft()
}

async function loadProviders(): Promise<void> {
  if (providers.value.length) return
  providersLoading.value = true
  try {
    const raw = await aiModelApi.listProviders()
    providers.value = raw.map((p) => ({
      ...p,
      baseUrl: ((p as unknown as Record<string, unknown>).base_url as string) ?? p.baseUrl
    }))
  } catch {
    providers.value = []
  } finally {
    providersLoading.value = false
  }
}

async function loadModel(modelId: string): Promise<void> {
  try {
    const m = await aiModelApi.get(modelId)
    const isProvider = m.provider !== 'custom'
    configMode.value = isProvider ? 'provider' : 'custom'
    draft.value = {
      name: m.name,
      provider: m.provider,
      baseUrl: m.baseUrl,
      apiKey: m.apiKey,
      modelId: m.modelId,
      modelType: m.modelType
    }
  } catch {
    resetForm()
  }
}

function syncProviderDraft(): void {
  if (draft.value.provider === 'custom') return
  const info = providers.value.find((p) => p.provider === draft.value.provider)
  if (info) {
    draft.value.baseUrl = info.baseUrl
    if (!info.models.includes(draft.value.modelId)) {
      draft.value.modelId = info.models[0] ?? ''
    }
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    await loadProviders()
    if (props.modelId) {
      await loadModel(props.modelId)
    } else {
      resetForm()
    }
  }
)

function onModeChange(mode: ConfigMode): void {
  configMode.value = mode
  error.value = ''
  if (mode === 'provider') {
    if (draft.value.provider === 'custom') {
      draft.value.provider = providers.value[0]?.provider ?? 'openai'
    }
    syncProviderDraft()
  } else {
    draft.value.provider = 'custom'
    draft.value.baseUrl = ''
    draft.value.modelId = ''
  }
}

function onProviderChange(value: string): void {
  draft.value.provider = value
  syncProviderDraft()
}

function close(): void {
  if (saving.value) return
  emit('update:open', false)
  emit('close')
}

async function submit(): Promise<void> {
  error.value = ''
  saving.value = true
  try {
    // 服务商模式：自动生成名称（与后端 _generate_name 逻辑一致）
    let name = draft.value.name
    if (configMode.value === 'provider' && !name.trim()) {
      const info = selectedProviderInfo.value
      name = info ? `${info.title} · ${draft.value.modelId}` : draft.value.modelId
    }

    const payload = {
      name,
      provider: draft.value.provider,
      baseUrl: draft.value.baseUrl,
      apiKey: draft.value.apiKey,
      modelId: draft.value.modelId.trim(),
      modelType: draft.value.modelType
    }

    if (!payload.modelId) throw new Error('请选择或填写模型 ID')
    if (configMode.value === 'custom') {
      if (!payload.baseUrl.trim()) throw new Error('请填写 Base URL')
    }
    if (!props.modelId && !payload.apiKey.trim()) throw new Error('请填写 API Key')

    if (props.modelId) {
      await aiModelApi.update(props.modelId, payload)
    } else {
      await aiModelApi.create(payload)
    }

    emit('update:open', false)
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <a-modal :open="open" :footer="null" centered destroy-on-close width="640px" @cancel="close">
    <div class="ai-config-modal">
      <div class="ai-config-header">
        <div>
          <div class="ai-config-title">{{ title }}</div>
          <div class="ai-config-subtitle">{{ subtitle }}</div>
        </div>
      </div>

      <div class="ai-config-mode">
        <button
          class="ai-config-mode-btn"
          :class="{ 'is-active': configMode === 'provider' }"
          type="button"
          @click="onModeChange('provider')"
        >
          服务商模型
        </button>
        <button
          class="ai-config-mode-btn"
          :class="{ 'is-active': configMode === 'custom' }"
          type="button"
          @click="onModeChange('custom')"
        >
          自定义配置
        </button>
      </div>

      <div v-if="configMode === 'provider'" class="ai-config-form">
        <div class="ai-config-field">
          <div class="ai-config-field-label">服务商</div>
          <a-select
            class="select ai-config-select"
            :value="draft.provider === 'custom' ? undefined : draft.provider"
            :options="providerSelectItems"
            :loading="providersLoading"
            @change="onProviderChange"
          />
        </div>

        <div class="ai-config-field">
          <div class="ai-config-field-label">模型</div>
          <a-select
            class="select ai-config-select"
            :value="draft.modelId"
            :options="providerModelOptions"
            @change="draft.modelId = $event"
          />
        </div>

        <div class="ai-config-field">
          <div class="ai-config-field-label">模型类型</div>
          <a-select
            class="select ai-config-select"
            :value="draft.modelType"
            :options="aiModelTypeOptions"
            @change="draft.modelType = $event"
          />
        </div>

        <div class="ai-config-field">
          <div class="ai-config-field-label">Base URL</div>
          <input class="text ai-config-input" type="text" :value="draft.baseUrl" disabled />
        </div>

        <div class="ai-config-field">
          <div class="ai-config-field-label">API Key</div>
          <input
            v-model="draft.apiKey"
            class="text ai-config-input"
            type="password"
            :placeholder="props.modelId ? '留空则保留已保存的 Key' : '输入 API Key'"
          />
        </div>
      </div>

      <div v-else class="ai-config-form">
        <div class="ai-config-field">
          <div class="ai-config-field-label">模型名称</div>
          <input
            v-model="draft.name"
            class="text ai-config-input"
            type="text"
            placeholder="例如：DeepSeek Reasoner"
          />
        </div>

        <div class="ai-config-field">
          <div class="ai-config-field-label">Base URL</div>
          <input
            v-model="draft.baseUrl"
            class="text ai-config-input"
            type="text"
            placeholder="例如：https://api.openai.com/v1"
          />
        </div>

        <div class="ai-config-field">
          <div class="ai-config-field-label">模型 ID</div>
          <input
            v-model="draft.modelId"
            class="text ai-config-input"
            type="text"
            placeholder="例如：deepseek-reasoner"
          />
        </div>

        <div class="ai-config-field">
          <div class="ai-config-field-label">模型类型</div>
          <a-select
            class="select ai-config-select"
            :value="draft.modelType"
            :options="aiModelTypeOptions"
            @change="draft.modelType = $event"
          />
        </div>

        <div class="ai-config-field">
          <div class="ai-config-field-label">API Key</div>
          <input
            v-model="draft.apiKey"
            class="text ai-config-input"
            type="password"
            :placeholder="props.modelId ? '留空则保留已保存的 Key' : '输入 API Key'"
          />
        </div>
      </div>

      <a-alert v-if="error" class="ai-config-alert" :message="error" type="error" show-icon />

      <div class="ai-config-footer">
        <a-button @click="close">取消</a-button>
        <a-button type="primary" :loading="saving" @click="submit">
          {{ actionLabel }}
        </a-button>
      </div>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
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

.ai-config-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
