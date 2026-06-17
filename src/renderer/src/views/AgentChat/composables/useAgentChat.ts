// 智能体聊天状态管理
// 管理对话列表、当前对话、消息流式收发

import { ref, computed, onBeforeUnmount, type Ref } from 'vue'
import type {
  AgentConversation,
  AgentMessage,
  AgentStreamStatus,
  AgentChatChunkPayload,
  AgentChatDonePayload,
  AgentChatErrorPayload,
  AgentChatStatusPayload
} from '@shared/agents'
import { AGENT_EVENTS } from '@shared/agents'

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
  const conversations = ref<AgentConversation[]>([])
  const currentConversation = ref<AgentConversation | null>(null)
  const currentAgentId = ref<string>('')
  const streamingContent = ref<string>('')
  const streamStatus = ref<AgentStreamStatus | null>(null)
  const error = ref<string | null>(null)
  const pendingStreamId = ref<string | null>(null)

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

  // ===== IPC 事件监听 ===============================================

  function onChunk(_event: unknown, payload: unknown): void {
    const data = payload as AgentChatChunkPayload
    if (data?.conversationId === currentConversation.value?.id) {
      streamingContent.value += data.delta
    }
  }

  function onDone(_event: unknown, payload: unknown): void {
    const data = payload as AgentChatDonePayload
    if (data?.conversationId === currentConversation.value?.id && currentConversation.value) {
      // 用正式消息替换流式内容
      currentConversation.value.messages.push(data.assistantMessage)
      streamingContent.value = ''
      streamStatus.value = null
      pendingStreamId.value = null
    }
  }

  function onError(_event: unknown, payload: unknown): void {
    const data = payload as AgentChatErrorPayload
    if (data?.conversationId === currentConversation.value?.id) {
      error.value = data.message || '聊天请求失败'
      streamingContent.value = ''
      streamStatus.value = null
      pendingStreamId.value = null
    }
  }

  function onStatus(_event: unknown, payload: unknown): void {
    const data = payload as AgentChatStatusPayload
    if (data?.conversationId === currentConversation.value?.id) {
      streamStatus.value = data.status
    }
  }

  // 注册 IPC 监听
  try {
    window.electron.ipcRenderer.on(AGENT_EVENTS.CHAT_CHUNK, onChunk)
    window.electron.ipcRenderer.on(AGENT_EVENTS.CHAT_DONE, onDone)
    window.electron.ipcRenderer.on(AGENT_EVENTS.CHAT_ERROR, onError)
    window.electron.ipcRenderer.on(AGENT_EVENTS.CHAT_STATUS, onStatus)
  } catch {
    // preload 未就绪，忽略
  }

  onBeforeUnmount(() => {
    try {
      window.electron.ipcRenderer.removeListener(AGENT_EVENTS.CHAT_CHUNK, onChunk)
      window.electron.ipcRenderer.removeListener(AGENT_EVENTS.CHAT_DONE, onDone)
      window.electron.ipcRenderer.removeListener(AGENT_EVENTS.CHAT_ERROR, onError)
      window.electron.ipcRenderer.removeListener(AGENT_EVENTS.CHAT_STATUS, onStatus)
    } catch {
      // 忽略
    }
  })

  // ===== 对话 CRUD ================================================

  async function loadConversations(): Promise<void> {
    try {
      const list = await window.electron.ipcRenderer.invoke(AGENT_EVENTS.CONVERSATION_LIST)
      if (Array.isArray(list)) {
        conversations.value = list as AgentConversation[]
      }
    } catch {
      conversations.value = []
    }
  }

  async function selectConversation(id: string): Promise<void> {
    try {
      const conv = await window.electron.ipcRenderer.invoke(AGENT_EVENTS.CONVERSATION_GET, { id })
      if (conv) {
        currentConversation.value = conv as AgentConversation
        currentAgentId.value = (conv as AgentConversation).agentId
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
      const conv = (await window.electron.ipcRenderer.invoke(
        AGENT_EVENTS.CONVERSATION_CREATE,
        { agentId: currentAgentId.value, title }
      )) as AgentConversation
      conversations.value.unshift(conv)
      currentConversation.value = conv
      return conv
    } catch {
      return null
    }
  }

  async function deleteConversation(id: string): Promise<void> {
    try {
      await window.electron.ipcRenderer.invoke(AGENT_EVENTS.CONVERSATION_DELETE, { id })
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
      const updated = (await window.electron.ipcRenderer.invoke(
        AGENT_EVENTS.CONVERSATION_RENAME,
        { id, title }
      )) as AgentConversation
      const idx = conversations.value.findIndex((c) => c.id === id)
      if (idx !== -1) conversations.value[idx] = updated
      if (currentConversation.value?.id === id) {
        currentConversation.value = updated
      }
    } catch {
      // 忽略
    }
  }

  async function clearConversation(id: string): Promise<void> {
    try {
      const updated = (await window.electron.ipcRenderer.invoke(
        AGENT_EVENTS.CONVERSATION_CLEAR,
        { id }
      )) as AgentConversation
      const idx = conversations.value.findIndex((c) => c.id === id)
      if (idx !== -1) conversations.value[idx] = updated
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
      streamingContent.value = ''
      streamStatus.value = null

      const result = await window.electron.ipcRenderer.invoke(AGENT_EVENTS.CHAT_STREAM, {
        conversationId,
        agentId: currentAgentId.value,
        message
      })

      if (result && typeof result === 'object') {
        pendingStreamId.value = (result as { streamId?: string }).streamId ?? null
      }
    } catch (e: unknown) {
      // 发送失败时移除本地用户消息
      const idx = currentConversation.value.messages.findIndex((m) => m.id === userMsg.id)
      if (idx !== -1) currentConversation.value.messages.splice(idx, 1)
      error.value = e instanceof Error ? e.message : '发送失败'
    }
  }

  async function cancelStream(): Promise<void> {
    if (!pendingStreamId.value) return
    try {
      await window.electron.ipcRenderer.invoke(AGENT_EVENTS.CHAT_CANCEL, {
        streamId: pendingStreamId.value
      })
    } catch {
      // 忽略
    }
    streamingContent.value = ''
    streamStatus.value = null
    pendingStreamId.value = null
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
