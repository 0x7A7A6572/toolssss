<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { AI_MODEL_TYPE_LABELS, AI_MODEL_TYPE_COLORS } from '@shared/settings'
import AppSwitch from '@renderer/components/AppSwitch.vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { aiModelApi, type AiModelInfo, type ProviderInfo } from '@renderer/utils/python-api'
import AiConfigModal from '../modals/AiConfigModal.vue'

const models = ref<AiModelInfo[]>([])
const loading = ref(false)
const loadError = ref('')

const aiConfigModalOpen = ref(false)
const editingModelId = ref<string | undefined>(undefined)
const aiEnabled = ref(false)

const aiProviderLabelMap = computed(() => {
  const map: Record<string, string> = { custom: '自定义' }
  for (const p of providerMap.value.values()) {
    map[p.provider] = p.title
  }
  return map
})

const providerMap = ref<Map<string, ProviderInfo>>(new Map())

const serviceModels = computed(() => models.value.filter((m) => m.provider !== 'custom'))
const customModels = computed(() => models.value.filter((m) => m.provider === 'custom'))

const currentModelSummary = computed(() => {
  if (!models.value.length) {
    return { title: '未配置模型', subtitle: '添加服务商模型或自定义模型' }
  }
  if (!aiEnabled.value) {
    return { title: `${models.value.length} 个模型已配置`, subtitle: 'AI 服务已禁用' }
  }
  const first = models.value[0]
  return {
    title: first.name || first.modelId,
    subtitle: `${aiProviderLabelMap.value[first.provider] ?? first.provider} · ${first.baseUrl || '—'}`
  }
})

async function loadModels(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const [modelList, providerList] = await Promise.all([
      aiModelApi.list().catch(() => [] as AiModelInfo[]),
      aiModelApi.listProviders().catch(() => [] as ProviderInfo[])
    ])
    models.value = modelList
    providerMap.value = new Map(providerList.map((p) => [p.provider, p]))
  } catch {
    loadError.value = '加载模型列表失败'
  } finally {
    loading.value = false
  }
}

function getModelTypeTagStyle(modelType: string): Record<string, string> {
  const color = AI_MODEL_TYPE_COLORS[modelType as keyof typeof AI_MODEL_TYPE_COLORS] ?? '#3b82f6'
  return { color, borderColor: color, backgroundColor: `${color}1a` }
}

function openAddModal(): void {
  editingModelId.value = undefined
  aiConfigModalOpen.value = true
}

function openEditModal(modelId: string): void {
  editingModelId.value = modelId
  aiConfigModalOpen.value = true
}

async function removeModel(modelId: string): Promise<void> {
  try {
    await aiModelApi.delete(modelId)
  } catch {
    // ignore
  }
  models.value = models.value.filter((m) => m.modelId !== modelId)
}

function onConfigClose(): void {
  aiConfigModalOpen.value = false
  editingModelId.value = undefined
  loadModels()
}

onMounted(() => {
  loadModels()
})
</script>

<template>
  <div class="settings-section">
    <div class="section-card">
      <div class="card-head">
        <div class="card-title">基础设置</div>
      </div>

      <div class="row">
        <div class="label">启用 AI 服务</div>
        <AppSwitch v-model:model-value="aiEnabled" />
      </div>

      <div class="row">
        <div class="label">
          <div class="ai-model-label">已配置模型</div>
        </div>
        <a-button class="ai-model-add-btn" type="primary" @click="openAddModal">
          <template #icon>
            <Plus :size="14" />
          </template>
          添加模型
        </a-button>
      </div>

      <div v-if="loading" class="ai-loading">加载中...</div>
      <div v-else-if="loadError" class="ai-error">{{ loadError }}</div>

      <template v-else>
        <!-- 服务商模型 -->
        <div v-if="serviceModels.length" class="selector-group-section">
          <div class="selector-group-title">服务商模型</div>
          <div v-for="item in serviceModels" :key="item.modelId" class="selector-item">
            <button class="selector-item-main" type="button" @click="openEditModal(item.modelId)">
              <span class="selector-item-label">{{ item.name || item.modelId }}</span>
              <span class="model-type-tag" :style="getModelTypeTagStyle(item.modelType)">
                {{
                  AI_MODEL_TYPE_LABELS[item.modelType as keyof typeof AI_MODEL_TYPE_LABELS] ??
                  item.modelType
                }}
              </span>
            </button>
            <button
              class="selector-item-delete"
              type="button"
              title="删除"
              aria-label="删除"
              @click.stop="removeModel(item.modelId)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <!-- 自定义模型 -->
        <div v-if="customModels.length" class="selector-group-section">
          <div class="selector-group-title">自定义模型</div>
          <div v-for="item in customModels" :key="item.modelId" class="selector-item">
            <button class="selector-item-main" type="button" @click="openEditModal(item.modelId)">
              <span class="selector-item-label">{{ item.name || item.modelId }}</span>
              <span class="model-type-tag" :style="getModelTypeTagStyle(item.modelType)">
                {{
                  AI_MODEL_TYPE_LABELS[item.modelType as keyof typeof AI_MODEL_TYPE_LABELS] ??
                  item.modelType
                }}
              </span>
            </button>
            <button
              class="selector-item-delete"
              type="button"
              title="删除"
              aria-label="删除"
              @click.stop="removeModel(item.modelId)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <div v-if="!models.length" class="selector-empty">暂无模型配置</div>
      </template>

      <div class="ai-current-model">
        <div class="ai-current-model-title">
          {{ currentModelSummary.title }}
        </div>
        <div class="ai-current-model-meta">
          <span>{{ aiEnabled ? '已启用' : '未启用' }}</span>
        </div>
      </div>
    </div>

    <AiConfigModal
      :open="aiConfigModalOpen"
      :model-id="editingModelId"
      @update:open="aiConfigModalOpen = $event"
      @close="onConfigClose"
    />
  </div>
</template>

<style lang="scss" scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-card {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ev-c-text-1);
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

.ai-model-add-btn {
  flex-shrink: 0;
}

.ai-loading,
.ai-error {
  font-size: 13px;
  color: var(--ev-c-text-2);
  text-align: center;
  padding: 12px 0;
}

.ai-error {
  color: rgba(239, 68, 68, 0.92);
}

.selector-group-section {
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
  color: var(--ev-c-text-1);
  padding: 9px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
  text-align: left;
}

.selector-item-main:hover {
  color: rgba(255, 255, 255, 0.4);
}

.selector-item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-type-tag {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid;
  white-space: nowrap;
}

.selector-item-delete {
  height: 34px;
  width: 34px;
  border: 0;
  border-radius: 10px;
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
</style>
