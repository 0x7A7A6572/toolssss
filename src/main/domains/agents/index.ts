// 智能体 Domain 工厂
// 提供对话管理、流式聊天、知识库检索的 IPC 处理程序

import { ipcMain } from 'electron'
import type { AppSettings } from '@shared/settings'
import type { AgentMessage, AgentConversation, AgentKnowledgeDoc } from '@shared/agents'
import { AGENT_EVENTS } from '@shared/agents'
import type {
  AgentChatStreamPayload,
  AgentConversationRenamePayload,
  AgentConversationClearPayload,
  AgentKnowledgeBaseSavePayload,
  AgentKnowledgeBaseDeletePayload,
  AgentKnowledgeDocListPayload,
  AgentKnowledgeDocSavePayload,
  AgentKnowledgeDocDeletePayload
} from '@shared/agents'
import { createAiStreamId } from '@main-core/ai-client'
import { createEmbeddingsModelFromSettings, formatEmbeddingChainError } from '@main-core/ai-service'
import {
  listConversations,
  loadConversation,
  saveConversation,
  deleteConversation,
  generateId
} from './conversation-store'
import { runChatPipeline } from './chat-pipeline'
import { createKnowledgeBaseStore } from './knowledge-base-store'
import { rebuildKnowledgeBaseIndex } from './kb-indexer'
import { saveKnowledgeBaseIndex } from './kb-index-store'

/** 追踪活跃的流式请求，用于取消 */
const activeStreams = new Map<string, AbortController>()
const knowledgeBaseStore = createKnowledgeBaseStore()

type Deps = {
  getSettings: () => AppSettings
  commitSettings: (next: AppSettings) => void
}

/** 验证字符串参数 */
function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`参数 ${name} 无效`)
  }
  return value.trim()
}

export function createAgentDomain(deps: Deps) {
  function syncKnowledgeBaseSummaries(
    transform: (settings: AppSettings) => {
      knowledgeBases: AppSettings['agents']['knowledgeBases']
      configs?: AppSettings['agents']['configs']
    }
  ): void {
    const current = deps.getSettings()
    const result = transform(current)
    deps.commitSettings({
      ...current,
      agents: {
        ...current.agents,
        knowledgeBases: result.knowledgeBases,
        configs: result.configs ?? current.agents.configs
      }
    })
  }

  async function reindexKnowledgeBase(kbId: string): Promise<void> {
    try {
      const settings = deps.getSettings()
      const docs = knowledgeBaseStore.listDocuments(kbId)
      const { model } = createEmbeddingsModelFromSettings(settings)
      const index = await rebuildKnowledgeBaseIndex({
        kbId,
        docs,
        rag: settings.agents.rag,
        embeddings: model
      })
      saveKnowledgeBaseIndex(index)
      knowledgeBaseStore.updateKnowledgeBase(kbId, {
        docCount: docs.length,
        indexedAt: index.indexedAt
      })

      syncKnowledgeBaseSummaries(() => ({
        knowledgeBases: knowledgeBaseStore.listKnowledgeBases()
      }))
    } catch (error) {
      throw new Error(formatEmbeddingChainError(error))
    }
  }

  function registerIpcHandlers(): void {
    // ===== 对话 CRUD ====================================================

    // 获取所有对话列表
    ipcMain.handle(AGENT_EVENTS.CONVERSATION_LIST, () => {
      return listConversations()
    })

    // 获取单个对话
    ipcMain.handle(AGENT_EVENTS.CONVERSATION_GET, (_event, payload: unknown) => {
      const id = requireString(
        (payload as { id?: unknown } | undefined)?.id,
        'id'
      )
      return loadConversation(id)
    })

    // 创建新对话
    ipcMain.handle(AGENT_EVENTS.CONVERSATION_CREATE, (_event, payload: unknown) => {
      const agentId = requireString(
        (payload as { agentId?: unknown } | undefined)?.agentId,
        'agentId'
      )
      const title =
        typeof (payload as { title?: unknown } | undefined)?.title === 'string'
          ? (payload as { title: string }).title
          : '新对话'
      const conv: AgentConversation = {
        id: generateId('conv'),
        agentId,
        title: title.trim() || '新对话',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      saveConversation(conv)
      return conv
    })

    // 删除对话
    ipcMain.handle(AGENT_EVENTS.CONVERSATION_DELETE, (_event, payload: unknown) => {
      const id = requireString(
        (payload as { id?: unknown } | undefined)?.id,
        'id'
      )
      return deleteConversation(id)
    })

    // 重命名对话
    ipcMain.handle(
      AGENT_EVENTS.CONVERSATION_RENAME,
      (_event, payload: unknown) => {
        const data = payload as AgentConversationRenamePayload | undefined
        const id = requireString(data?.id, 'id')
        const title = requireString(data?.title, 'title')
        const conv = loadConversation(id)
        if (!conv) throw new Error('对话不存在')
        conv.title = title
        saveConversation(conv)
        return conv
      }
    )

    // 清空对话消息
    ipcMain.handle(
      AGENT_EVENTS.CONVERSATION_CLEAR,
      (_event, payload: unknown) => {
        const data = payload as AgentConversationClearPayload | undefined
        const id = requireString(data?.id, 'id')
        const conv = loadConversation(id)
        if (!conv) throw new Error('对话不存在')
        conv.messages = []
        saveConversation(conv)
        return conv
      }
    )

    // ===== 知识库 CRUD ==================================================

    ipcMain.handle(AGENT_EVENTS.KB_LIST, () => {
      return knowledgeBaseStore.listKnowledgeBases()
    })

    ipcMain.handle(AGENT_EVENTS.KB_SAVE, (_event, payload: unknown) => {
      const data = payload as AgentKnowledgeBaseSavePayload | undefined
      const saved = knowledgeBaseStore.saveKnowledgeBase({
        id: requireString(data?.id, 'id'),
        name: requireString(data?.name, 'name')
      })
      syncKnowledgeBaseSummaries(() => ({
        knowledgeBases: knowledgeBaseStore.listKnowledgeBases()
      }))
      return saved
    })

    ipcMain.handle(AGENT_EVENTS.KB_DELETE, (_event, payload: unknown) => {
      const data = payload as AgentKnowledgeBaseDeletePayload | undefined
      const kbId = requireString(data?.id, 'id')
      knowledgeBaseStore.deleteKnowledgeBase(kbId)
      syncKnowledgeBaseSummaries((current) => ({
        knowledgeBases: knowledgeBaseStore.listKnowledgeBases(),
        configs: current.agents.configs.map((agent) =>
          agent.knowledgeBaseId === kbId ? { ...agent, knowledgeBaseId: null } : agent
        )
      }))
      return true
    })

    ipcMain.handle(AGENT_EVENTS.KB_DOC_LIST, (_event, payload: unknown) => {
      const data = payload as AgentKnowledgeDocListPayload | undefined
      const kbId = requireString(data?.kbId, 'kbId')
      return knowledgeBaseStore.listDocuments(kbId)
    })

    ipcMain.handle(AGENT_EVENTS.KB_DOC_SAVE, async (_event, payload: unknown) => {
      const data = payload as AgentKnowledgeDocSavePayload | undefined
      const kbId = requireString(data?.kbId, 'kbId')
      const doc = (data?.doc ?? {}) as Partial<AgentKnowledgeDoc>
      const saved = knowledgeBaseStore.saveDocument(kbId, {
        id: requireString(doc.id, 'doc.id'),
        title: requireString(doc.title, 'doc.title'),
        content: typeof doc.content === 'string' ? doc.content : '',
        createdAt: typeof doc.createdAt === 'number' ? doc.createdAt : Date.now(),
        updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : Date.now()
      })
      await reindexKnowledgeBase(kbId)
      return saved
    })

    ipcMain.handle(AGENT_EVENTS.KB_DOC_DELETE, async (_event, payload: unknown) => {
      const data = payload as AgentKnowledgeDocDeletePayload | undefined
      const kbId = requireString(data?.kbId, 'kbId')
      const docId = requireString(data?.docId, 'docId')
      knowledgeBaseStore.deleteDocument(kbId, docId)
      await reindexKnowledgeBase(kbId)
      return true
    })

    ipcMain.handle(AGENT_EVENTS.KB_REINDEX, async (_event, payload: unknown) => {
      const kbId = requireString(
        (payload as { kbId?: unknown } | undefined)?.kbId,
        'kbId'
      )
      await reindexKnowledgeBase(kbId)
      return knowledgeBaseStore.listKnowledgeBases().find((item) => item.id === kbId) ?? null
    })

    // ===== 流式聊天 ====================================================

    // 发起流式聊天请求
    ipcMain.handle(AGENT_EVENTS.CHAT_STREAM, async (event, payload: unknown) => {
      const data = payload as AgentChatStreamPayload | undefined
      const conversationId = requireString(data?.conversationId, 'conversationId')
      const agentId = requireString(data?.agentId, 'agentId')
      const message = requireString(data?.message, 'message')

      // 加载或创建对话
      let conv = loadConversation(conversationId)
      if (!conv) {
        conv = {
          id: conversationId,
          agentId,
          title: message.slice(0, 50),
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      }

      // 保存用户消息
      const userMsg: AgentMessage = {
        id: generateId('msg'),
        role: 'user',
        content: message,
        timestamp: Date.now()
      }
      conv.messages.push(userMsg)
      saveConversation(conv)

      // 获取智能体配置
      const settings = deps.getSettings()
      const agent = settings.agents.configs.find((a) => a.id === agentId)
      if (!agent) throw new Error('智能体不存在')

      // 创建 AbortController 用于取消
      const streamId = createAiStreamId()
      const controller = new AbortController()
      activeStreams.set(streamId, controller)

      // 异步执行管道，通过事件推送结果
      runChatPipeline({
        agent,
        conversationMessages: conv.messages.filter((m) => m.role !== 'system'),
        newUserMessage: message,
        settings,
        signal: controller.signal,
        onDelta: (delta) => {
          event.sender.send(AGENT_EVENTS.CHAT_CHUNK, {
            conversationId,
            delta
          })
        },
        onStatus: (status) => {
          event.sender.send(AGENT_EVENTS.CHAT_STATUS, {
            conversationId,
            status
          })
        }
      })
        .then(({ fullText, ragContext }) => {
          // 流已被取消，不再保存
          if (!activeStreams.has(streamId)) return

          const assistantMsg: AgentMessage = {
            id: generateId('msg'),
            role: 'assistant',
            content: fullText,
            ragChunks: ragContext?.chunks.length ? ragContext.chunks : undefined,
            timestamp: Date.now()
          }
          conv.messages.push(assistantMsg)
          // 首次对话自动取标题
          if (conv.messages.length === 2) {
            conv.title = fullText.slice(0, 50)
          }
          saveConversation(conv)

          event.sender.send(AGENT_EVENTS.CHAT_DONE, {
            conversationId,
            assistantMessage: assistantMsg,
            fullText
          })
        })
        .catch((e: unknown) => {
          if (e instanceof Error && e.name === 'AbortError') return
          const msg = e instanceof Error ? e.message : 'AI 请求失败'
          event.sender.send(AGENT_EVENTS.CHAT_ERROR, {
            conversationId,
            message: msg
          })
        })
        .finally(() => {
          activeStreams.delete(streamId)
        })

      return { conversationId, streamId }
    })

    // 取消流式请求
    ipcMain.handle(AGENT_EVENTS.CHAT_CANCEL, (_event, payload: unknown) => {
      const streamId =
        typeof (payload as { streamId?: unknown } | undefined)?.streamId === 'string'
          ? (payload as { streamId: string }).streamId
          : ''
      if (!streamId) return false
      const controller = activeStreams.get(streamId)
      if (!controller) return false
      controller.abort()
      activeStreams.delete(streamId)
      return true
    })
  }

  return { registerIpcHandlers }
}
