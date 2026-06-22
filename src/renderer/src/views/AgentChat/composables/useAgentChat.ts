// 智能体聊天状态管理
// 管理对话列表、当前对话、消息流式收发

import { ref, computed, onBeforeUnmount, type Ref } from 'vue'
import type {
  AgentConversation,
  AgentMessage,
  AgentStreamStatus,
  AgentChatDonePayload,
  AgentChatChunkPayload,
  AgentChatErrorPayload,
  AgentChatStatusPayload
} from '@shared/agents'
import { useAgentBackend } from '@renderer/composables/useAgentBackend'
import type { CustomEventSource, ConversationListItem } from '@renderer/utils/python-api'

/** 流式消息的临时 ID，用于在流式过程中显示占位消息 */
const STREAMING_TEMP_ID = '__streaming__'

export interface UseAgentChatReturn {
  conversations: Ref<AgentConversation[]>
  currentConversation: Ref<AgentConversation | null>
  currentAgentId: Ref<string>
  messages: Ref<AgentMessage[]>
  streamingContent: Ref<string>
  streamStatus: Ref<AgentStreamStatus | null>
  streaming: Ref<boolean>
  error: Ref<string | null>
  loadConversations: () => Promise<void>
  selectConversation: (id: string) => Promise<void>
  selectAgent: (agentId: string) => void
  createConversation: (title?: string) => Promise<AgentConversation | null>
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  clearConversation: (id: string) => Promise<void>
  sendMessage: (message: string) => Promise<void>
  cancelStream: () => Promise<void>
}

export function useAgentChat(): UseAgentChatReturn {
  const backend = useAgentBackend()
  const conversations = ref<AgentConversation[]>([])
  const currentConversation = ref<AgentConversation | null>(null)
  const currentAgentId = ref<string>('')
  const streamingContent = ref<string>('')
  const streamStatus = ref<AgentStreamStatus | null>(null)
  const error = ref<string | null>(null)
  let activePythonStream: CustomEventSource | null = null
  let pythonStreamCancelled = false

  function toConversationState(
    input: AgentConversation | ConversationListItem
  ): AgentConversation {
    return {
      id: input.id,
      agentId: input.agentId,
      title: input.title,
      messages: 'messages' in input && Array.isArray(input.messages) ? input.messages : [],
      createdAt: input.createdAt,
      updatedAt: input.updatedAt
    }
  }

  function upsertConversationSummary(input: AgentConversation | ConversationListItem): void {
    const summary = toConversationState(input)
    const idx = conversations.value.findIndex((item) => item.id === summary.id)
    if (idx === -1) {
      conversations.value.unshift(summary)
      return
    }
    conversations.value[idx] = {
      ...conversations.value[idx],
      ...summary,
      messages: conversations.value[idx]?.messages ?? summary.messages
    }
  }

  function clearStreamingState(): void {
    streamingContent.value = ''
    streamStatus.value = null
  }

  function closePythonStream(): void {
    if (!activePythonStream) return
    activePythonStream.close()
    activePythonStream = null
  }

  function bindPythonStream(eventSource: CustomEventSource, conversationId: string): void {
    pythonStreamCancelled = false
    activePythonStream = eventSource

    eventSource.addEventListener('status', ({ data }) => {
      const payload = JSON.parse(data) as AgentChatStatusPayload
      if (payload?.conversationId === currentConversation.value?.id) {
        streamStatus.value = payload.status
      }
    })

    eventSource.addEventListener('delta', ({ data }) => {
      const payload = JSON.parse(data) as AgentChatChunkPayload
      if (payload?.conversationId === currentConversation.value?.id) {
        streamingContent.value += payload.delta
      }
    })

    eventSource.addEventListener('completed', ({ data }) => {
      const payload = JSON.parse(data) as AgentChatDonePayload
      if (payload?.conversationId !== currentConversation.value?.id || !currentConversation.value) {
        return
      }
      currentConversation.value.messages.push(payload.assistantMessage)
      if (currentConversation.value.messages.length === 2) {
        currentConversation.value.title = payload.fullText.slice(0, 50)
      }
      upsertConversationSummary(currentConversation.value)
      clearStreamingState()
      activePythonStream = null
    })

    eventSource.addEventListener('error', ({ data }) => {
      if (pythonStreamCancelled) return
      const payload = JSON.parse(data) as AgentChatErrorPayload
      if (payload?.conversationId === conversationId) {
        error.value = payload.message || '聊天请求失败'
      }
      clearStreamingState()
      activePythonStream = null
    })
  }

  const messages = computed<AgentMessage[]>(() => {
    const msgs = currentConversation.value?.messages ?? []
    if (streamingContent.value) {
      return [
        ...msgs,
        {
          id: STREAMING_TEMP_ID,
          role: 'assistant' as const,
          content: streamingContent.value,
          timestamp: Date.now()
        }
      ]
    }
    return msgs
  })

  const streaming = computed<boolean>(() => streamStatus.value !== null)

  onBeforeUnmount(() => {
    try {
      closePythonStream()
    } catch {
      // 忽略
    }
  })

  // ===== 对话 CRUD ================================================

  async function loadConversations(): Promise<void> {
    try {
      const list = await backend.listConversations()
      conversations.value = Array.isArray(list) ? list.map((item) => toConversationState(item)) : []
    } catch {
      conversations.value = []
    }
  }

  async function selectConversation(id: string): Promise<void> {
    try {
      const conv = await backend.getConversation(id)
      if (conv) {
        currentConversation.value = conv
        currentAgentId.value = conv.agentId
        upsertConversationSummary(conv)
      }
    } catch {
      // 对话不存在
    }
  }

  function selectAgent(agentId: string): void {
    currentAgentId.value = agentId
  }

  async function createConversation(title?: string): Promise<AgentConversation | null> {
    if (!currentAgentId.value) return null
    try {
      const conv = await backend.createConversation(currentAgentId.value, title)
      upsertConversationSummary(conv)
      currentConversation.value = conv
      return conv
    } catch {
      return null
    }
  }

  async function deleteConversation(id: string): Promise<void> {
    try {
      await backend.deleteConversation(id)
      conversations.value = conversations.value.filter((c) => c.id !== id)
      if (currentConversation.value?.id === id) {
        currentConversation.value = null
      }
    } catch {
      // 忽略
    }
  }

  async function renameConversation(id: string, title: string): Promise<void> {
    try {
      const updated = await backend.renameConversation(id, title)
      upsertConversationSummary(updated)
      if (currentConversation.value?.id === id) {
        currentConversation.value = updated
      }
    } catch {
      // 忽略
    }
  }

  async function clearConversation(id: string): Promise<void> {
    try {
      const updated = await backend.clearConversation(id)
      upsertConversationSummary(updated)
      if (currentConversation.value?.id === id) {
        currentConversation.value = updated
      }
    } catch {
      // 忽略
    }
  }

  // ===== 消息收发 ================================================

  /** 生成简单唯一 ID */
  function localId(): string {
    return `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  }

  async function sendMessage(message: string): Promise<void> {
    if (!message.trim() || streaming.value) return
    error.value = null

    // 确保有当前对话
    if (!currentConversation.value) {
      const created = await createConversation()
      if (!created) return
    }

    if (!currentConversation.value || !currentAgentId.value) return

    const conversationId = currentConversation.value.id

    // 立即将用户消息追加到本地状态，确保 UI 即时显示
    const userMsg: AgentMessage = {
      id: localId(),
      role: 'user',
      content: message.trim(),
      timestamp: Date.now()
    }
    currentConversation.value.messages.push(userMsg)

    try {
      // 发送前清空流式状态
      clearStreamingState()
      streamStatus.value = 'thinking'

      const stream = await backend.chatStream(conversationId, currentAgentId.value, message)
      bindPythonStream(stream, conversationId)
    } catch (e: unknown) {
      // 发送失败时移除本地用户消息
      const idx = currentConversation.value.messages.findIndex((m) => m.id === userMsg.id)
      if (idx !== -1) currentConversation.value.messages.splice(idx, 1)
      error.value = e instanceof Error ? e.message : '发送失败'
    }
  }

  async function cancelStream(): Promise<void> {
    if (!activePythonStream) return
    pythonStreamCancelled = true
    if (currentConversation.value?.id) {
      await backend.cancelChatStream(currentConversation.value.id).catch(() => null)
    }
    closePythonStream()
    clearStreamingState()
  }

  return {
    conversations,
    currentConversation,
    currentAgentId,
    messages,
    streamingContent,
    streamStatus,
    streaming,
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
  }
}
