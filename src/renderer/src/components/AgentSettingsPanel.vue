<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import type { AppSettings, SettingsPatch } from '@shared/settings'
import { type AgentConfig, type AgentKnowledgeDoc, type KnowledgeBaseConfig } from '@shared/agents'
import AppSwitch from './AppSwitch.vue'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-vue-next'
import { useSettingsStore } from '@renderer/state/settings'
import { useAgentBackend } from '@renderer/composables/useAgentBackend'

const settingsStore = useSettingsStore()
const settings = settingsStore.settings
const backend = useAgentBackend()

const knowledgeBases = ref<KnowledgeBaseConfig[]>([])
const reindexingKbIds = ref<Set<string>>(new Set())
const kbDocs = ref<Record<string, AgentKnowledgeDoc[]>>({})

const embeddingAiProfiles = computed(() => {
  // TODO: 后续重构 —— 从 Python API 获取 embedding 模型列表
  return [] as Array<{ id: string; name: string; model: string }>
})

const embeddingProfileOptions = computed(() => {
  return embeddingAiProfiles.value.map((item) => ({
    value: item.id,
    label: `${item.name} · ${item.model}`
  }))
})

async function update(patch: SettingsPatch): Promise<void> {
  await settingsStore.update(patch)
}

async function loadKnowledgeBases(): Promise<void> {
  knowledgeBases.value = await backend.listKnowledgeBases()

  const entries = await Promise.all(
    knowledgeBases.value.map(async (kb) => {
      const docs = await backend.listDocuments(kb.id)
      return [kb.id, docs] as const
    })
  )

  kbDocs.value = Object.fromEntries(entries)
}

async function refreshKnowledgeBases(): Promise<void> {
  await Promise.all([loadKnowledgeBases(), settingsStore.refresh()])
}

async function updateEmbedding(_patch: Record<string, unknown>): Promise<void> {
  // TODO: 后续重构 —— 从 Python API 管理 embedding 配置
}

async function onEmbeddingProfileChange(raw: string | number | undefined): Promise<void> {
  const profileId = String(raw ?? '').trim()
  // TODO: 后续重构 —— 从 Python API 校验 embedding profile
  await updateEmbedding({
    profileId,
    model: ''
  })
}

async function updateRag(patch: Partial<AppSettings['agents']['rag']>): Promise<void> {
  await update({
    agents: {
      rag: {
        ...settings.value.agents.rag,
        ...patch
      }
    }
  })
}

async function reindexKb(kbId: string): Promise<void> {
  reindexingKbIds.value = new Set(reindexingKbIds.value).add(kbId)
  try {
    await backend.reindexKnowledgeBase(kbId)
    await refreshKnowledgeBases()
    message.success('索引重建成功')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '索引重建失败')
  } finally {
    const next = new Set(reindexingKbIds.value)
    next.delete(kbId)
    reindexingKbIds.value = next
  }
}

const agentModalOpen = ref(false)
const agentEditing = ref<AgentConfig | null>(null)
const agentDraftName = ref('')
const agentDraftPrompt = ref('')
const agentDraftKbId = ref<string | null>(null)

function openAddAgentModal(): void {
  agentEditing.value = null
  agentDraftName.value = ''
  agentDraftPrompt.value = ''
  agentDraftKbId.value = null
  agentModalOpen.value = true
}

function openEditAgentModal(agent: AgentConfig): void {
  agentEditing.value = agent
  agentDraftName.value = agent.name
  agentDraftPrompt.value = agent.systemPrompt
  agentDraftKbId.value = agent.knowledgeBaseId
  agentModalOpen.value = true
}

function closeAgentModal(): void {
  agentModalOpen.value = false
  agentEditing.value = null
}

function generateAgentId(): string {
  return `agent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

async function saveAgent(): Promise<void> {
  const name = agentDraftName.value.trim()
  if (!name) return

  const now = Date.now()
  const config: AgentConfig = agentEditing.value
    ? {
        ...agentEditing.value,
        name,
        systemPrompt: agentDraftPrompt.value,
        knowledgeBaseId: agentDraftKbId.value,
        updatedAt: now
      }
    : {
        id: generateAgentId(),
        name,
        systemPrompt: agentDraftPrompt.value,
        knowledgeBaseId: agentDraftKbId.value,
        createdAt: now,
        updatedAt: now
      }

  const configs = agentEditing.value
    ? settings.value.agents.configs.map((agent) => (agent.id === config.id ? config : agent))
    : [...settings.value.agents.configs, config]

  await update({ agents: { configs } })
  closeAgentModal()
}

async function deleteAgent(agent: AgentConfig): Promise<void> {
  const configs = settings.value.agents.configs.filter((item) => item.id !== agent.id)
  await update({ agents: { configs } })
}

const kbModalOpen = ref(false)
const kbEditing = ref<KnowledgeBaseConfig | null>(null)
const kbDraftName = ref('')

const docModalOpen = ref(false)
const docEditingKb = ref<KnowledgeBaseConfig | null>(null)
const docEditing = ref<AgentKnowledgeDoc | null>(null)
const docDraftTitle = ref('')
const docDraftContent = ref('')

function generateKbId(): string {
  return `kb-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function generateDocId(): string {
  return `doc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function openAddKbModal(): void {
  kbEditing.value = null
  kbDraftName.value = ''
  kbModalOpen.value = true
}

function openEditKbModal(kb: KnowledgeBaseConfig): void {
  kbEditing.value = kb
  kbDraftName.value = kb.name
  kbModalOpen.value = true
}

function closeKbModal(): void {
  kbModalOpen.value = false
  kbEditing.value = null
}

async function saveKb(): Promise<void> {
  const name = kbDraftName.value.trim()
  if (!name) return

  await backend.saveKnowledgeBase(kbEditing.value?.id ?? generateKbId(), name)
  await refreshKnowledgeBases()
  closeKbModal()
}

async function deleteKb(kb: KnowledgeBaseConfig): Promise<void> {
  await backend.deleteKnowledgeBase(kb.id)
  await refreshKnowledgeBases()
}

function openAddDocModal(kb: KnowledgeBaseConfig): void {
  docEditingKb.value = kb
  docEditing.value = null
  docDraftTitle.value = ''
  docDraftContent.value = ''
  docModalOpen.value = true
}

function openEditDocModal(kb: KnowledgeBaseConfig, doc: AgentKnowledgeDoc): void {
  docEditingKb.value = kb
  docEditing.value = doc
  docDraftTitle.value = doc.title
  docDraftContent.value = doc.content
  docModalOpen.value = true
}

function closeDocModal(): void {
  docModalOpen.value = false
  docEditing.value = null
  docEditingKb.value = null
}

async function saveDoc(): Promise<void> {
  const title = docDraftTitle.value.trim()
  if (!title || !docEditingKb.value) return

  const now = Date.now()
  await backend.saveDocument(
    docEditingKb.value.id,
    docEditing.value
      ? {
          ...docEditing.value,
          title,
          content: docDraftContent.value,
          updatedAt: now
        }
      : {
          id: generateDocId(),
          title,
          content: docDraftContent.value,
          createdAt: now,
          updatedAt: now
        }
  )
  await refreshKnowledgeBases()
  closeDocModal()
}

async function deleteDoc(kb: KnowledgeBaseConfig, doc: AgentKnowledgeDoc): Promise<void> {
  await backend.deleteDocument(kb.id, doc.id)
  await refreshKnowledgeBases()
}

onMounted(() => {
  loadKnowledgeBases().catch(() => null)
})
</script>

<template>
  <div class="agent-settings-panel">
    <section class="card">
      <div class="card-head">
        <div class="card-title">智能体设置</div>
        <a-button
          class="icon-action-btn"
          type="text"
          size="small"
          title="添加智能体"
          aria-label="添加智能体"
          @click="openAddAgentModal"
        >
          <template #icon><Plus :size="14" /></template>
        </a-button>
      </div>

      <div v-if="!settings.agents.configs.length" class="empty-hint">
        暂无智能体，点击「添加」创建一个
      </div>

      <div v-for="agent in settings.agents.configs" :key="agent.id" class="agent-item">
        <div class="agent-item-info">
          <div class="agent-item-name">{{ agent.name }}</div>
          <div class="agent-item-meta">
            <span>{{ agent.knowledgeBaseId ? '已关联知识库' : '未关联知识库' }}</span>
            <span>{{ agent.systemPrompt ? '已配置提示词' : '未配置提示词' }}</span>
          </div>
        </div>
        <div class="agent-item-actions">
          <a-button
            class="icon-action-btn"
            type="text"
            size="small"
            title="编辑智能体"
            aria-label="编辑智能体"
            @click="openEditAgentModal(agent)"
          >
            <template #icon><Pencil :size="14" /></template>
          </a-button>
          <a-popconfirm
            title="确定删除此智能体？"
            ok-text="删除"
            cancel-text="取消"
            @confirm="deleteAgent(agent)"
          >
            <a-button
              class="icon-action-btn danger"
              type="text"
              size="small"
              danger
              title="删除智能体"
              aria-label="删除智能体"
            >
              <template #icon><Trash2 :size="14" /></template>
            </a-button>
          </a-popconfirm>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">RAG 设置</div>
      </div>

      <div class="row">
        <div class="label">启用 Embedding</div>
        <AppSwitch
          :model-value="false"
          @update:model-value="updateEmbedding({ enabled: $event })"
        />
      </div>

      <div class="row">
        <div class="label">Embedding Profile</div>
        <a-select
          class="select"
          :value="undefined"
          :options="embeddingProfileOptions"
          placeholder="选择向量模型配置"
          style="width: 280px"
          @change="onEmbeddingProfileChange"
        />
      </div>

      <div class="row">
        <div class="label">Embedding Dimensions</div>
        <input
          class="text"
          type="number"
          min="1"
          :value="'0'"
          @change="
            updateEmbedding({
              dimensions: Number(($event.target as HTMLInputElement).value) || 1536
            })
          "
        />
      </div>

      <div class="row">
        <div class="label">Top K</div>
        <input
          class="text"
          type="number"
          min="1"
          max="20"
          :value="String(settings.agents.rag.topK)"
          @change="
            updateRag({
              topK: Number(($event.target as HTMLInputElement).value) || 4
            })
          "
        />
      </div>

      <div class="row">
        <div class="label">Chunk Size</div>
        <input
          class="text"
          type="number"
          min="100"
          :value="String(settings.agents.rag.chunkSize)"
          @change="
            updateRag({
              chunkSize: Number(($event.target as HTMLInputElement).value) || 700
            })
          "
        />
      </div>

      <div class="row">
        <div class="label">Chunk Overlap</div>
        <input
          class="text"
          type="number"
          min="0"
          :value="String(settings.agents.rag.chunkOverlap)"
          @change="
            updateRag({
              chunkOverlap: Number(($event.target as HTMLInputElement).value) || 120
            })
          "
        />
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">知识库设置</div>
        <a-button
          class="icon-action-btn"
          type="text"
          size="small"
          title="添加知识库"
          aria-label="添加知识库"
          @click="openAddKbModal"
        >
          <template #icon><Plus :size="14" /></template>
        </a-button>
      </div>

      <div v-if="!knowledgeBases.length" class="empty-hint">暂无知识库，点击「添加」创建一个</div>

      <div v-for="kb in knowledgeBases" :key="kb.id" class="kb-item">
        <div class="kb-item-header">
          <div class="kb-item-info">
            <div class="kb-item-name">{{ kb.name }}</div>
            <div class="kb-item-count">
              {{ kb.docCount }} 篇文档
              <span v-if="kb.indexedAt"> · 已索引</span>
              <span v-else> · 未索引</span>
            </div>
          </div>
          <div class="kb-item-actions">
            <a-button
              class="icon-action-btn"
              type="text"
              size="small"
              title="重命名知识库"
              aria-label="重命名知识库"
              @click="openEditKbModal(kb)"
            >
              <template #icon><Pencil :size="14" /></template>
            </a-button>
            <a-button
              class="icon-action-btn"
              type="text"
              size="small"
              title="添加文档"
              aria-label="添加文档"
              @click="openAddDocModal(kb)"
            >
              <template #icon><Plus :size="14" /></template>
            </a-button>
            <a-button
              class="icon-action-btn"
              type="text"
              size="small"
              :loading="reindexingKbIds.has(kb.id)"
              title="重建索引"
              aria-label="重建索引"
              @click="reindexKb(kb.id)"
            >
              <template #icon><RefreshCw :size="14" /></template>
            </a-button>
            <a-popconfirm
              title="确定删除此知识库？关联的智能体将取消关联。"
              ok-text="删除"
              cancel-text="取消"
              @confirm="deleteKb(kb)"
            >
              <a-button
                class="icon-action-btn danger"
                type="text"
                size="small"
                danger
                title="删除知识库"
                aria-label="删除知识库"
              >
                <template #icon><Trash2 :size="14" /></template>
              </a-button>
            </a-popconfirm>
          </div>
        </div>

        <div v-if="kbDocs[kb.id]?.length" class="doc-list">
          <div v-for="doc in kbDocs[kb.id] ?? []" :key="doc.id" class="doc-item">
            <div class="doc-item-info">
              <div class="doc-item-title">{{ doc.title }}</div>
              <div class="doc-item-preview">
                {{ doc.content.slice(0, 80) }}{{ doc.content.length > 80 ? '...' : '' }}
              </div>
            </div>
            <div class="doc-item-actions">
              <a-button
                class="icon-action-btn"
                type="text"
                size="small"
                title="编辑文档"
                aria-label="编辑文档"
                @click="openEditDocModal(kb, doc)"
              >
                <template #icon><Pencil :size="14" /></template>
              </a-button>
              <a-popconfirm
                title="确定删除此文档？"
                ok-text="删除"
                cancel-text="取消"
                @confirm="deleteDoc(kb, doc)"
              >
                <a-button
                  class="icon-action-btn danger"
                  type="text"
                  size="small"
                  danger
                  title="删除文档"
                  aria-label="删除文档"
                >
                  <template #icon><Trash2 :size="14" /></template>
                </a-button>
              </a-popconfirm>
            </div>
          </div>
        </div>
      </div>
    </section>

    <a-modal
      :open="agentModalOpen"
      :footer="null"
      centered
      destroy-on-close
      width="560px"
      @cancel="closeAgentModal"
    >
      <div class="agent-modal">
        <div class="agent-modal-title">
          {{ agentEditing ? '编辑智能体' : '添加智能体' }}
        </div>

        <div class="agent-modal-field">
          <div class="agent-modal-label">名称</div>
          <input
            v-model="agentDraftName"
            class="text agent-modal-input"
            type="text"
            placeholder="例如：技术助手"
          />
        </div>

        <div class="agent-modal-field">
          <div class="agent-modal-label">系统提示词</div>
          <a-textarea
            v-model:value="agentDraftPrompt"
            :rows="6"
            placeholder="例如：你是一个专业的技术助手，擅长解答编程问题..."
          />
        </div>

        <div class="agent-modal-field">
          <div class="agent-modal-label">关联知识库（可选）</div>
          <a-select
            v-model:value="agentDraftKbId"
            class="select"
            placeholder="不关联知识库"
            allow-clear
            :options="knowledgeBases.map((item) => ({ value: item.id, label: item.name }))"
            style="width: 100%"
          />
        </div>

        <div class="agent-modal-footer">
          <a-button @click="closeAgentModal">取消</a-button>
          <a-button type="primary" :disabled="!agentDraftName.trim()" @click="saveAgent">
            {{ agentEditing ? '保存' : '添加' }}
          </a-button>
        </div>
      </div>
    </a-modal>

    <a-modal
      :open="kbModalOpen"
      :footer="null"
      centered
      destroy-on-close
      width="400px"
      @cancel="closeKbModal"
    >
      <div class="agent-modal">
        <div class="agent-modal-title">
          {{ kbEditing ? '重命名知识库' : '添加知识库' }}
        </div>

        <div class="agent-modal-field">
          <div class="agent-modal-label">名称</div>
          <input
            v-model="kbDraftName"
            class="text agent-modal-input"
            type="text"
            placeholder="例如：技术文档"
          />
        </div>

        <div class="agent-modal-footer">
          <a-button @click="closeKbModal">取消</a-button>
          <a-button type="primary" :disabled="!kbDraftName.trim()" @click="saveKb">
            {{ kbEditing ? '保存' : '添加' }}
          </a-button>
        </div>
      </div>
    </a-modal>

    <a-modal
      :open="docModalOpen"
      :footer="null"
      centered
      destroy-on-close
      width="600px"
      @cancel="closeDocModal"
    >
      <div class="agent-modal">
        <div class="agent-modal-title">
          {{ docEditing ? '编辑文档' : '添加文档' }}
          <span v-if="docEditingKb" class="agent-modal-subtitle">
            知识库：{{ docEditingKb.name }}
          </span>
        </div>

        <div class="agent-modal-field">
          <div class="agent-modal-label">文档标题</div>
          <input
            v-model="docDraftTitle"
            class="text agent-modal-input"
            type="text"
            placeholder="标题"
          />
        </div>

        <div class="agent-modal-field">
          <div class="agent-modal-label">文档内容</div>
          <a-textarea
            v-model:value="docDraftContent"
            :rows="8"
            placeholder="输入知识库文档内容..."
          />
        </div>

        <div class="agent-modal-footer">
          <a-button @click="closeDocModal">取消</a-button>
          <a-button type="primary" :disabled="!docDraftTitle.trim()" @click="saveDoc">
            {{ docEditing ? '保存' : '添加' }}
          </a-button>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<style lang="scss" scoped>
.agent-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
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

.empty-hint {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  padding: 8px 0;
}

.agent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.14);
}

.agent-item-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.agent-item-name {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.agent-item-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.agent-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.kb-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.14);
}

.kb-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.kb-item-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.kb-item-name {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.kb-item-count {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.kb-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.doc-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 8px;
  border-left: 2px solid rgba(255, 255, 255, 0.08);
}

.doc-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.1);
}

.doc-item-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.doc-item-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.doc-item-preview {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-item-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.agent-modal {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.agent-modal-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--ev-c-text-1);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-modal-subtitle {
  font-size: 13px;
  font-weight: 400;
  color: var(--ev-c-text-2);
}

.agent-modal-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-modal-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--ev-c-text-1);
}

.agent-modal-input {
  width: 100%;
}

.agent-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.icon-action-btn {
  padding-inline: 4px;
  color: rgba(255, 255, 255, 0.58);
  border: none;
  background: transparent;
  box-shadow: none;
}

.icon-action-btn:hover,
.icon-action-btn:focus-visible {
  color: rgba(255, 255, 255, 0.92);
  background: transparent;
}

.icon-action-btn.ant-btn-text:not(:disabled):hover,
.icon-action-btn.ant-btn-text:not(:disabled):focus {
  background: transparent;
}

.icon-action-btn.ant-btn-dangerous {
  color: rgba(255, 255, 255, 0.48);
}

.icon-action-btn.ant-btn-dangerous:not(:disabled):hover,
.icon-action-btn.ant-btn-dangerous:not(:disabled):focus-visible {
  color: #ff6b6b;
}
</style>
