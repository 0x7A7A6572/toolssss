/**
 * Agent Python API 包装层
 *
 * 统一封装智能体相关的 Python API 调用。
 * 如果 Python 服务不可用，直接抛错，不再暴露任何“后端模式”概念。
 */

import {
  agentApi,
  knowledgeBaseApi,
  isPythonServerAvailable,
  type AgentKnowledgeDoc,
  type AgentConversation,
  type ConversationListItem,
  type KnowledgeBaseConfig,
  type CustomEventSource
} from '@renderer/utils/python-api'

let pythonReady = false
let detectPromise: Promise<void> | null = null

async function ensurePythonReady(force: boolean = false): Promise<void> {
  if (pythonReady && !force) return
  if (detectPromise && !force) return detectPromise
  detectPromise = (async () => {
    try {
      pythonReady = await isPythonServerAvailable()
    } catch {
      pythonReady = false
    }
  })()
  await detectPromise
  if (pythonReady) return
  await ensurePythonReady(true)
  if (pythonReady) return
  throw new Error('Python 智能体服务不可用，请先确认 Python 后端已正常启动')
}

// =============================================================================
// Composable
// =============================================================================

export function useAgentBackend() {
  void ensurePythonReady()

  // ---- 对话 API ----

  async function listConversations(): Promise<ConversationListItem[]> {
    await ensurePythonReady()
    return agentApi.listConversations()
  }

  async function getConversation(id: string): Promise<AgentConversation> {
    await ensurePythonReady()
    return agentApi.getConversation(id)
  }

  async function createConversation(
    agentId: string,
    title: string = '新对话'
  ): Promise<AgentConversation> {
    await ensurePythonReady()
    return agentApi.createConversation(agentId, title)
  }

  async function deleteConversation(id: string): Promise<void> {
    await ensurePythonReady()
    return agentApi.deleteConversation(id)
  }

  async function renameConversation(id: string, title: string): Promise<AgentConversation> {
    await ensurePythonReady()
    return agentApi.renameConversation(id, title)
  }

  async function clearConversation(id: string): Promise<AgentConversation> {
    await ensurePythonReady()
    return agentApi.clearConversation(id)
  }

  async function chatStream(
    conversationId: string,
    agentId: string,
    message: string
  ): Promise<CustomEventSource> {
    await ensurePythonReady()
    return agentApi.chatStream(conversationId, agentId, message)
  }

  async function cancelChatStream(conversationId: string): Promise<void> {
    await ensurePythonReady()
    return agentApi.cancelStream(conversationId)
  }

  // ---- 知识库 API ----

  async function listKnowledgeBases(): Promise<KnowledgeBaseConfig[]> {
    await ensurePythonReady()
    return knowledgeBaseApi.list()
  }

  async function saveKnowledgeBase(id: string, name: string): Promise<KnowledgeBaseConfig> {
    await ensurePythonReady()
    return knowledgeBaseApi.save(id, name)
  }

  async function deleteKnowledgeBase(id: string): Promise<void> {
    await ensurePythonReady()
    return knowledgeBaseApi.delete(id)
  }

  async function listDocuments(kbId: string): Promise<AgentKnowledgeDoc[]> {
    await ensurePythonReady()
    return knowledgeBaseApi.listDocuments(kbId)
  }

  async function saveDocument(
    kbId: string,
    doc: Omit<AgentKnowledgeDoc, 'kbId'> & Partial<Pick<AgentKnowledgeDoc, 'kbId'>>
  ): Promise<AgentKnowledgeDoc> {
    await ensurePythonReady()
    return knowledgeBaseApi.saveDocument(kbId, doc)
  }

  async function deleteDocument(kbId: string, docId: string): Promise<void> {
    await ensurePythonReady()
    return knowledgeBaseApi.deleteDocument(kbId, docId)
  }

  async function reindexKnowledgeBase(kbId: string): Promise<KnowledgeBaseConfig> {
    await ensurePythonReady()
    return knowledgeBaseApi.reindex(kbId)
  }

  return {
    // 对话 CRUD
    listConversations,
    getConversation,
    createConversation,
    deleteConversation,
    renameConversation,
    clearConversation,
    chatStream,
    cancelChatStream,
    // 知识库 CRUD
    listKnowledgeBases,
    saveKnowledgeBase,
    deleteKnowledgeBase,
    listDocuments,
    saveDocument,
    deleteDocument,
    reindexKnowledgeBase
  }
}
