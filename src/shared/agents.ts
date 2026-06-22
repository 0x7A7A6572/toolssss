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
