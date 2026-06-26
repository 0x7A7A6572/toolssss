<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import {
  Plus,
  Settings,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
  Copy,
  RefreshCw,
  BookText,
  MoreHorizontal
} from 'lucide-vue-next'
import { Actions, BubbleList, Sender } from 'ant-design-x-vue'
import type { ActionItem } from 'ant-design-x-vue'
import { useSettingsStore } from '@renderer/state/settings'
import { useAgentChat } from './composables/useAgentChat'
import type { AgentMessage, AgentRagChunk } from '@shared/agents'
import AgentSettingsPanel from '@renderer/components/AgentSettingsPanel.vue'

const settingsStore = useSettingsStore()

const {
  conversations,
  currentConversation,
  currentAgentId,
  messages,
  streaming,
  streamStatus,
  error,
  loadConversations,
  selectConversation,
  selectAgent,
  createConversation,
  deleteConversation,
  renameConversation,
  clearConversation,
  sendMessage,
  cancelStream
} = useAgentChat()

// 可用智能体列表
const agents = computed(() => settingsStore.settings.value.agents.configs)

// 当前智能体名称
const currentAgentName = computed(() => {
  if (!currentAgentId.value) return ''
  return agents.value.find((a) => a.id === currentAgentId.value)?.name ?? ''
})

// 侧栏折叠状态
const sidebarCollapsed = ref(false)

function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

const settingsModalOpen = ref(false)

function openSettingsModal(): void {
  settingsModalOpen.value = true
}

function closeSettingsModal(): void {
  settingsModalOpen.value = false
}

// Sender 输入值
const senderValue = ref<string>('')

// ===== 语音识别 ============================================

/* eslint-disable @typescript-eslint/no-explicit-any */
/** 浏览器 SpeechRecognition 构造函数（可能为 webkit 前缀） */
const SpeechRecognitionAPI: (new () => any) | null =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null

let recognitionInstance: any = null
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 语音录制中 */
const speechRecording = ref(false)

/** 停止语音识别并清理 */
function stopRecognition(): void {
  if (recognitionInstance) {
    try {
      recognitionInstance.stop()
    } catch {
      // 忽略 stop 错误
    }
    recognitionInstance = null
  }
  speechRecording.value = false
}

/** 开始语音识别 */
function startRecognition(): void {
  if (!SpeechRecognitionAPI) return

  // 先停止上一个实例
  stopRecognition()

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const recognition = new SpeechRecognitionAPI()
  recognition.lang = 'zh-CN'
  recognition.interimResults = false
  recognition.continuous = false

  recognition.onstart = () => {
    speechRecording.value = true
  }
  recognition.onend = () => {
    speechRecording.value = false
    recognitionInstance = null
  }
  recognition.onresult = (event: any) => {
    const result = event.results[0]
    if (result && result[0] && result[0].transcript) {
      const prefix = senderValue.value.trim() ? ' ' : ''
      senderValue.value = senderValue.value + prefix + result[0].transcript
    }
  }
  recognition.onerror = (event: any) => {
    console.error('语音识别错误:', event.error, event.message)
    speechRecording.value = false
    recognitionInstance = null
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  recognitionInstance = recognition
  try {
    recognition.start()
  } catch (err) {
    console.error('启动语音识别失败:', err)
    speechRecording.value = false
    recognitionInstance = null
  }
}

/** Sender 语音按钮回调：受控模式下切换录音状态 */
function onSpeechRecordingChange(toggle: boolean): void {
  if (toggle) {
    startRecognition()
  } else {
    stopRecognition()
  }
}

/** 受控语音配置 */
const allowSpeechConfig = computed(() => ({
  recording: speechRecording.value,
  onRecordingChange: onSpeechRecordingChange
}))

/** 浏览器是否支持语音识别 */
const speechSupported = SpeechRecognitionAPI !== null

// ===== BubbleList 配置 ============================================

/** 气泡角色预设样式 */
const bubbleRoles = {
  user: {
    placement: 'end' as const,
    variant: 'filled' as const,
    classNames: { content: 'bubble-content' }
  },
  assistant: {
    placement: 'start' as const,
    variant: 'outlined' as const,
    avatar: () => h(Bot),
    classNames: { content: 'bubble-content' },
    messageRender: (content: string) => h('div', { innerHTML: marked.parse(content) as string })
  }
}

/** 消息 → BubbleList items */
const bubbleItems = computed(() => {
  return messages.value.map((msg: AgentMessage, index: number) => {
    const isLastAssistant = msg.role === 'assistant' && index === messages.value.length - 1
    return {
      key: msg.id,
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
      ragChunks: msg.ragChunks ?? [],
      typing: isLastAssistant && streaming.value ? { step: 1, interval: 30 } : undefined
    }
  })
})

// ===== Conversations 配置 ==========================================

/** 对话列表项 */
const conversationItems = computed(() => {
  return conversations.value.map((c) => ({
    key: c.id,
    label: c.title,
    timestamp: c.updatedAt
  }))
})

/** 当前选中 */
const activeConversationKey = ref<string>('')
watch(
  () => currentConversation.value?.id,
  (id) => {
    activeConversationKey.value = id ?? ''
  }
)

function handleConversationMenu(key: string, title: string, action: string): void {
  switch (action) {
    case 'rename': {
      const nextTitle = window.prompt('新名称', title)
      if (nextTitle && nextTitle.trim()) {
        void renameConversation(key, nextTitle.trim())
      }
      break
    }
    case 'clear':
      void clearConversation(key)
      break
    case 'delete':
      void deleteConversation(key)
      if (activeConversationKey.value === key) {
        activeConversationKey.value = ''
      }
      break
  }
}

function formatConversationTime(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (isSameDay) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  })
}

// ===== 事件处理 ============================================

function handleConversationSelect(key: string): void {
  selectConversation(key)
}

async function handleSend(value: string): Promise<void> {
  senderValue.value = ''
  await sendMessage(value)
}

function handleCancel(): void {
  cancelStream()
}

async function handleNewConversation(): Promise<void> {
  if (!currentAgentId.value) return
  await createConversation()
}

// ===== 气泡操作按钮 ============================================

/** 复制消息文本 */
async function handleCopy(content: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(content)
  } catch {
    // 忽略复制失败
  }
}

/** 重新发送（将消息文本填入输入框并聚焦） */
function handleRetry(content: string): void {
  senderValue.value = content
}

type BubbleFooterItem = {
  key?: string | number
  role?: string
  content?: string
  ragChunks?: AgentRagChunk[]
}

/** 根据气泡角色返回对应的操作项 */
function getActionsForItem(item: BubbleFooterItem): ActionItem[] {
  const content = typeof item.content === 'string' ? item.content : ''
  const actions: ActionItem[] = [
    {
      key: 'copy',
      label: '复制',
      icon: h(Copy, { size: 14 }),
      onItemClick: () => handleCopy(content)
    }
  ]
  if (item.role === 'user') {
    actions.push({
      key: 'retry',
      label: '重试',
      icon: h(RefreshCw, { size: 14 }),
      onItemClick: () => handleRetry(content)
    })
  }
  return actions
}

function formatRagChunkText(text: string, maxLength: number = 220): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function formatRagScore(score: number): string {
  return `${Math.round(score * 100)}%`
}

function getRagChunksForItem(item: BubbleFooterItem): AgentRagChunk[] {
  return Array.isArray(item.ragChunks) ? item.ragChunks : []
}

const ragDrawerOpen = ref(false)
const activeRagDrawer = ref<{ itemKey: string; chunks: AgentRagChunk[] } | null>(null)

function openRagDrawerForItem(item: BubbleFooterItem): void {
  const chunks = getRagChunksForItem(item)
  if (chunks.length === 0) return
  activeRagDrawer.value = {
    itemKey: String(item.key ?? ''),
    chunks
  }
  ragDrawerOpen.value = true
}

function closeRagDrawer(): void {
  ragDrawerOpen.value = false
  activeRagDrawer.value = null
}

function getRagHitLabel(count: number): string {
  return `命中 ${count} 条`
}

onMounted(async () => {
  await loadConversations()
  if (!currentAgentId.value && agents.value.length > 0) {
    selectAgent(agents.value[0].id)
  }
})

onBeforeUnmount(() => {
  stopRecognition()
})
</script>

<template>
  <div class="agent-chat-layout">
    <!-- 左侧边栏 -->
    <aside class="agent-sidebar" :class="{ collapsed: sidebarCollapsed }">
      <!-- 顶部操作栏：智能体选择 + 新建对话 + 折叠 -->
      <div class="sidebar-top-row">
        <a-select
          v-if="!sidebarCollapsed"
          :value="currentAgentId"
          placeholder="选择智能体"
          :options="agents.map((a) => ({ value: a.id, label: a.name }))"
          class="agent-select"
          @change="selectAgent"
        >
          <template #notFoundContent>
            <div class="agent-empty-hint">
              <span>暂无智能体</span>
              <a-button type="link" size="small" @click="openSettingsModal">去设置中添加</a-button>
            </div>
          </template>
        </a-select>

        <a-tooltip title="新对话">
          <a-button
            class="icon-btn"
            :border="false"
            :disabled="!currentAgentId || streaming"
            @click="handleNewConversation"
          >
            <Plus :size="16" />
          </a-button>
        </a-tooltip>

        <a-tooltip :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'">
          <a-button class="icon-btn" @click="toggleSidebar">
            <PanelLeftClose v-if="!sidebarCollapsed" :size="16" />
            <PanelLeftOpen v-else :size="16" />
          </a-button>
        </a-tooltip>
      </div>

      <!-- 对话列表（含右键菜单） -->
      <div v-if="!sidebarCollapsed" class="conversations-wrapper">
        <div v-if="conversationItems.length > 0" class="conversation-list">
          <div
            v-for="conv in conversationItems"
            :key="conv.key"
            :class="['conversation-list-item', { active: activeConversationKey === conv.key }]"
            @click="handleConversationSelect(String(conv.key))"
          >
            <div class="conversation-list-main">
              <div class="conversation-list-title">{{ conv.label }}</div>
              <div class="conversation-list-time">
                {{ formatConversationTime(conv.timestamp) }}
              </div>
            </div>
            <a-dropdown :trigger="['click']">
              <a-button class="conversation-list-more" type="text" size="small" @click.stop>
                <template #icon>
                  <MoreHorizontal :size="14" />
                </template>
              </a-button>
              <template #overlay>
                <a-menu
                  @click="
                    ({ key }) =>
                      handleConversationMenu(
                        String(conv.key),
                        String(conv.label ?? ''),
                        String(key)
                      )
                  "
                >
                  <a-menu-item key="rename">重命名</a-menu-item>
                  <a-menu-item key="clear">清空消息</a-menu-item>
                  <a-menu-item key="delete" danger>删除</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>
        </div>
        <div v-else class="no-conversations">
          {{ currentAgentId ? '暂无对话记录' : '请先选择智能体' }}
        </div>
      </div>

      <div class="sidebar-bottom-actions">
        <a-tooltip :title="sidebarCollapsed ? '智能体设置' : ''">
          <a-button class="sidebar-settings-btn" @click="openSettingsModal">
            <template #icon>
              <Settings :size="16" />
            </template>
            <!-- <span v-if="!sidebarCollapsed">设置</span> -->
          </a-button>
        </a-tooltip>
      </div>
    </aside>

    <!-- 右侧聊天区域 -->
    <main class="agent-main">
      <!-- 顶部信息栏 -->
      <header v-if="currentAgentName" class="chat-header">
        <div class="chat-header-info">
          <Bot :size="18" class="header-bot-icon" />
          <span class="agent-name">{{ currentAgentName }}</span>
          <span v-if="currentConversation" class="conversation-title">
            · {{ currentConversation.title }}
          </span>
        </div>
      </header>

      <!-- 状态提示栏 -->
      <div v-if="streamStatus" class="stream-status-bar">
        <span v-if="streamStatus === 'rag_loading'">🔍 正在检索知识库...</span>
        <span v-else-if="streamStatus === 'thinking'">💭 正在思考...</span>
        <span v-else-if="streamStatus === 'streaming'">📝 正在回复...</span>
      </div>

      <!-- 错误提示栏 -->
      <div v-if="error" class="error-bar">
        <span>{{ error }}</span>
        <a-button type="link" size="small" @click="error = null">关闭</a-button>
      </div>

      <!-- 消息区域 -->
      <div class="messages-area">
        <!-- 空状态：未选择智能体 -->
        <div v-if="!currentAgentId" class="empty-state">
          <Bot :size="48" class="empty-icon" />
          <p class="empty-text">选择或创建一个智能体开始对话</p>
          <a-button type="primary" @click="openSettingsModal">
            <template #icon>
              <Settings :size="14" />
            </template>
            打开智能体设置
          </a-button>
        </div>

        <!-- 空状态：未创建对话 -->
        <div v-else-if="!currentConversation" class="empty-state">
          <Bot :size="48" class="empty-icon" />
          <p class="empty-text">
            开始与 <strong>{{ currentAgentName }}</strong> 对话
          </p>
          <a-button type="primary" @click="handleNewConversation">
            <template #icon>
              <Plus :size="14" />
            </template>
            新对话
          </a-button>
        </div>

        <!-- 消息气泡列表 -->
        <BubbleList v-else :items="bubbleItems" :roles="bubbleRoles" auto-scroll>
          <template #footer="{ item }">
            <div :class="['bubble-footer', `bubble-footer--${item.role ?? 'assistant'}`]">
              <div class="bubble-actions">
                <Actions :items="getActionsForItem(item)" variant="borderless" />
                <button
                  v-if="getRagChunksForItem(item).length > 0"
                  type="button"
                  class="rag-hit-trigger"
                  @click="openRagDrawerForItem(item)"
                >
                  <BookText :size="14" />
                  <span class="rag-hit-trigger-label">知识库</span>
                  <span class="rag-hit-trigger-summary">
                    {{ getRagHitLabel(getRagChunksForItem(item).length) }}
                  </span>
                </button>
              </div>
            </div>
          </template>
        </BubbleList>
      </div>

      <!-- 输入区域 -->
      <div class="sender-area">
        <Sender
          :value="senderValue"
          :loading="streaming"
          :disabled="!currentAgentId"
          :allow-speech="speechSupported ? allowSpeechConfig : false"
          :placeholder="
            currentAgentId ? '输入消息，Enter 发送，Shift+Enter 换行...' : '请先选择智能体'
          "
          @change="(val: string) => (senderValue = val)"
          @submit="handleSend"
          @cancel="handleCancel"
        />
      </div>
    </main>

    <a-modal
      :open="settingsModalOpen"
      :footer="null"
      width="700px"
      centered
      destroy-on-close
      @cancel="closeSettingsModal"
    >
      <div class="agent-settings-modal">
        <div class="agent-settings-modal-head">
          <div class="agent-settings-modal-title">智能体设置</div>
          <div class="agent-settings-modal-subtitle">管理智能体、RAG 参数和知识库内容</div>
        </div>
        <AgentSettingsPanel />
      </div>
    </a-modal>

    <a-drawer
      :open="ragDrawerOpen"
      placement="right"
      :closable="false"
      :width="440"
      @close="closeRagDrawer"
    >
      <div v-if="activeRagDrawer" class="rag-drawer">
        <div class="rag-drawer-meta">
          <span>{{ getRagHitLabel(activeRagDrawer.chunks.length) }}</span>
        </div>
        <div class="rag-context-panel">
          <div class="rag-context-list">
            <div
              v-for="(chunk, chunkIndex) in activeRagDrawer.chunks"
              :key="`${activeRagDrawer.itemKey}-rag-${chunkIndex}`"
              class="rag-context-item"
            >
              <div class="rag-context-item-head">
                <span class="rag-context-doc">{{ chunk.docTitle }}</span>
                <span class="rag-context-score">匹配度 {{ formatRagScore(chunk.score) }}</span>
              </div>
              <div class="rag-context-text">{{ formatRagChunkText(chunk.text) }}</div>
            </div>
          </div>
        </div>
      </div>
    </a-drawer>
  </div>
</template>

<style scoped>
.agent-chat-layout {
  display: flex;
  height: 100%;
  gap: 0;
  overflow: hidden;
}

/* ===== 左侧边栏 ===== */

.agent-sidebar {
  width: 260px;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  transition:
    width 0.2s ease,
    min-width 0.2s ease;
}

.agent-sidebar.collapsed {
  width: 56px;
  min-width: 56px;
}

/* 顶部操作栏 */
.sidebar-top-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-sidebar.collapsed .sidebar-top-row {
  flex-direction: column;
  align-items: center;
}

.agent-select {
  flex: 1;
  min-width: 0;
}

.icon-btn {
  flex-shrink: 0;
  width: 34px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
}

.conversations-wrapper {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.conversation-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.conversation-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease;
}

.conversation-list-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.conversation-list-item.active {
  background: rgba(59, 130, 246, 0.14);
}

.conversation-list-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.conversation-list-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.86);
}

.conversation-list-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.42);
}

.conversation-list-more {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.56);
}

.conversation-list-more:hover,
.conversation-list-more:focus-visible {
  color: rgba(255, 255, 255, 0.9);
  background: transparent;
}

.sidebar-bottom-actions {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.sidebar-settings-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
}

.agent-sidebar.collapsed .sidebar-settings-btn {
  width: 34px;
  padding: 0;
}

.no-conversations {
  text-align: center;
  color: rgba(255, 255, 255, 0.35);
  font-size: 13px;
  padding: 32px 0;
}

.agent-empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
}

/* ===== 右侧聊天区域 ===== */

.agent-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  min-height: 44px;
}

.chat-header-info {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.header-bot-icon {
  opacity: 0.6;
  flex-shrink: 0;
}

.agent-name {
  font-weight: 600;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
}

.conversation-title {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 状态栏 ===== */

.stream-status-bar {
  padding: 6px 20px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(59, 130, 246, 0.06);
  border-bottom: 1px solid rgba(59, 130, 246, 0.1);
}

.error-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  font-size: 13px;
  color: rgba(239, 68, 68, 0.9);
  background: rgba(239, 68, 68, 0.08);
  border-bottom: 1px solid rgba(239, 68, 68, 0.12);
}

/* ===== 消息区域 ===== */

.messages-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  min-height: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
}

.empty-icon {
  opacity: 0.3;
}

.empty-text {
  color: rgba(255, 255, 255, 0.4);
  font-size: 14px;
  margin: 0;
}

/* ===== 气泡内容换行 ===== */

:deep(.bubble-content) {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
}

/* ===== Markdown 渲染样式 ===== */

:deep(.bubble-content h1),
:deep(.bubble-content h2),
:deep(.bubble-content h3),
:deep(.bubble-content h4),
:deep(.bubble-content h5),
:deep(.bubble-content h6) {
  margin: 16px 0 8px;
  font-weight: 600;
  line-height: 1.35;
}

:deep(.bubble-content h1:first-child),
:deep(.bubble-content h2:first-child),
:deep(.bubble-content h3:first-child),
:deep(.bubble-content h4:first-child),
:deep(.bubble-content h5:first-child),
:deep(.bubble-content h6:first-child) {
  margin-top: 0;
}

:deep(.bubble-content h1) {
  font-size: 20px;
}

:deep(.bubble-content h2) {
  font-size: 17px;
}

:deep(.bubble-content h3) {
  font-size: 15px;
}

:deep(.bubble-content p) {
  margin: 4px 0;
}

:deep(.bubble-content p:first-child) {
  margin-top: 0;
}

:deep(.bubble-content p:last-child) {
  margin-bottom: 0;
}

:deep(.bubble-content ul),
:deep(.bubble-content ol) {
  margin: 6px 0;
  padding-left: 20px;
}

:deep(.bubble-content li) {
  margin: 2px 0;
}

:deep(.bubble-content code) {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 13px;
  font-family: 'Cascadia Code', Consolas, monospace;
}

:deep(.bubble-content pre) {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 10px 0;
  overflow-x: auto;
}

:deep(.bubble-content pre code) {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: 13px;
}

:deep(.bubble-content blockquote) {
  border-left: 3px solid rgba(59, 130, 246, 0.5);
  padding-left: 12px;
  margin: 8px 0;
  color: rgba(255, 255, 255, 0.6);
}

:deep(.bubble-content table) {
  width: 100%;
  margin: 8px 0;
  border-collapse: collapse;
  font-size: 13px;
}

:deep(.bubble-content th),
:deep(.bubble-content td) {
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px 10px;
  text-align: left;
}

:deep(.bubble-content th) {
  background: rgba(255, 255, 255, 0.04);
  font-weight: 600;
}

:deep(.bubble-content hr) {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin: 12px 0;
}

:deep(.bubble-content a) {
  color: rgba(59, 130, 246, 0.9);
  text-decoration: none;
}

:deep(.bubble-content a:hover) {
  text-decoration: underline;
}

/* ===== 气泡操作按钮 ===== */

.bubble-footer {
  display: flex;
  transition:
    opacity 0.2s ease,
    max-height 0.2s ease,
    margin-top 0.2s ease;
}

.bubble-footer--assistant {
  opacity: 1;
  max-height: 72px;
}

.bubble-footer--user {
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  pointer-events: none;
}

.rag-context-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(59, 130, 246, 0.18);
  border-radius: 10px;
  background: rgba(59, 130, 246, 0.06);
}

.rag-context-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rag-context-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
}

.rag-context-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.rag-context-doc {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.rag-context-score {
  font-size: 11px;
  color: rgba(191, 219, 254, 0.75);
  white-space: nowrap;
}

.rag-context-text {
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.72);
  white-space: pre-wrap;
  word-break: break-word;
}

.bubble-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.rag-hit-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  cursor: pointer;
  border: none;
  background: none;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    color 0.2s ease;
}

.rag-hit-trigger:hover {
  color: rgba(219, 234, 254, 0.98);
}

.rag-hit-trigger-label,
.rag-hit-trigger-summary {
  font-size: 12px;
  line-height: 1;
}

.rag-hit-trigger-summary {
  color: rgba(100, 170, 255, 0.72);
}

.rag-drawer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rag-drawer-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.52);
}

:deep(.ant-bubble):hover .bubble-footer--user {
  opacity: 1;
  max-height: 72px;
  margin-top: 6px;
  pointer-events: auto;
}

/* ===== 输入区域 ===== */

.sender-area {
  padding: 12px 20px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.agent-settings-modal {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 75vh;
  overflow: hidden;
}

.agent-settings-modal-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-settings-modal-title {
  font-size: 20px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.92);
}

.agent-settings-modal-subtitle {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}

.agent-settings-modal :deep(.agent-settings-panel) {
  overflow-y: auto;
  padding-right: 4px;
}
</style>
