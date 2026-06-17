// 智能体相关共享类型和 IPC 事件常量

/** 消息角色 */
export type AgentMessageRole = 'user' | 'assistant' | 'system'

/** 流式状态 */
export type AgentStreamStatus = 'thinking' | 'streaming' | 'searching' | 'rag_loading'

/** RAG 命中文档片段 */
export interface AgentRagChunk {
  chunkId: string
  docId: string
  docTitle: string
  text: string
  score: number
}

/** 对话消息 */
export interface AgentMessage {
  id: string
  role: AgentMessageRole
  content: string
  ragChunks?: AgentRagChunk[]
  timestamp: number
}

/** 对话会话 */
export interface AgentConversation {
  id: string
  agentId: string
  title: string
  messages: AgentMessage[]
  createdAt: number
  updatedAt: number
}

/** 知识库文档 */
export interface AgentKnowledgeDoc {
  id: string
  kbId: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

/** 知识库配置摘要 */
export interface KnowledgeBaseConfig {
  id: string
  name: string
  docCount: number
  indexedAt: number | null
}

/** 智能体配置 */
export interface AgentConfig {
  id: string
  name: string
  systemPrompt: string
  knowledgeBaseId: string | null
  createdAt: number
  updatedAt: number
}

/** IPC 事件常量 */
export const AGENT_EVENTS = {
  // 对话管理
  CONVERSATION_LIST: 'agent:conversation:list',
  CONVERSATION_GET: 'agent:conversation:get',
  CONVERSATION_CREATE: 'agent:conversation:create',
  CONVERSATION_DELETE: 'agent:conversation:delete',
  CONVERSATION_RENAME: 'agent:conversation:rename',
  CONVERSATION_CLEAR: 'agent:conversation:clear',

  // 知识库管理
  KB_LIST: 'agent:kb:list',
  KB_SAVE: 'agent:kb:save',
  KB_DELETE: 'agent:kb:delete',
  KB_DOC_LIST: 'agent:kb:doc:list',
  KB_DOC_SAVE: 'agent:kb:doc:save',
  KB_DOC_DELETE: 'agent:kb:doc:delete',
  KB_REINDEX: 'agent:kb:reindex',

  // 流式聊天
  CHAT_STREAM: 'agent:chat:stream',
  CHAT_CHUNK: 'agent:chat:chunk',
  CHAT_DONE: 'agent:chat:done',
  CHAT_ERROR: 'agent:chat:error',
  CHAT_CANCEL: 'agent:chat:cancel',
  CHAT_STATUS: 'agent:chat:status'
} as const

/** 聊天流式请求参数 */
export interface AgentChatStreamPayload {
  conversationId: string
  agentId: string
  message: string
}

/** 聊天 chunk 推送 */
export interface AgentChatChunkPayload {
  conversationId: string
  delta: string
}

/** 聊天完成推送 */
export interface AgentChatDonePayload {
  conversationId: string
  assistantMessage: AgentMessage
  fullText: string
}

/** 聊天错误推送 */
export interface AgentChatErrorPayload {
  conversationId: string
  message: string
}

/** 聊天状态推送 */
export interface AgentChatStatusPayload {
  conversationId: string
  status: AgentStreamStatus
}

/** 对话重命名参数 */
export interface AgentConversationRenamePayload {
  id: string
  title: string
}

/** 对话清空参数 */
export interface AgentConversationClearPayload {
  id: string
}

export interface AgentKnowledgeBaseSavePayload {
  id: string
  name: string
}

export interface AgentKnowledgeBaseDeletePayload {
  id: string
}

export interface AgentKnowledgeDocListPayload {
  kbId: string
}

export interface AgentKnowledgeDocSavePayload {
  kbId: string
  doc: Omit<AgentKnowledgeDoc, 'kbId'> & Partial<Pick<AgentKnowledgeDoc, 'kbId'>>
}

export interface AgentKnowledgeDocDeletePayload {
  kbId: string
  docId: string
}
