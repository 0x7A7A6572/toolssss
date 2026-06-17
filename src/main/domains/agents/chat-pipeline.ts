// 聊天流式管道
// 编排：RAG 检索 → 消息构建 → 流式生成 → 结果收集

import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { AgentMessage, AgentConfig } from '@shared/agents'
import type { AppSettings } from '@shared/settings'
import {
  createChatModel,
  resolveAiModelConfig,
  resolveApiKey,
  streamText
} from '@main-core/ai-service'
import { retrieveFromKnowledgeBase, buildRagContextPrompt, type RagContext } from './rag-engine'

/** 管道输入参数 */
export interface ChatPipelineInput {
  agent: AgentConfig
  conversationMessages: AgentMessage[]
  newUserMessage: string
  settings: AppSettings
  signal: AbortSignal
  onDelta: (delta: string) => void
  onStatus: (status: string) => void
}

/** 管道输出 */
export interface ChatPipelineOutput {
  fullText: string
  ragContext?: RagContext
}

/** 执行聊天管道 */
export async function runChatPipeline(input: ChatPipelineInput): Promise<ChatPipelineOutput> {
  const {
    agent,
    conversationMessages,
    newUserMessage,
    settings,
    signal,
    onDelta,
    onStatus
  } = input

  // 1. RAG 检索
  let ragContext: RagContext | undefined
  if (agent.knowledgeBaseId) {
    onStatus('rag_loading')
    ragContext = await retrieveFromKnowledgeBase({
      query: newUserMessage,
      kbId: agent.knowledgeBaseId,
      settings
    })
  }

  // 2. 构建 LangChain 消息列表
  const messages: BaseMessage[] = []

  // 系统提示词 + RAG 上下文
  const systemContent = agent.systemPrompt.trim() || '你是一个智能助手。'
  const ragSupplement = ragContext ? buildRagContextPrompt(ragContext) : ''
  messages.push(new SystemMessage(systemContent + ragSupplement))

  // 对话历史（截断以控制上下文窗口）
  const MAX_HISTORY = 20
  const recentMessages = conversationMessages.slice(-MAX_HISTORY)
  for (const msg of recentMessages) {
    if (msg.role === 'user') {
      messages.push(new HumanMessage(msg.content))
    } else if (msg.role === 'assistant') {
      messages.push(new AIMessage(msg.content))
    }
    // system 角色的消息不纳入历史上下文
  }

  // 当前用户消息
  messages.push(new HumanMessage(newUserMessage))

  // 3. 创建模型并流式生成
  onStatus('thinking')

  const config = resolveAiModelConfig(settings)
  const apiKey = resolveApiKey(config.profileId)
  const model = createChatModel(config, apiKey, {
    temperature: 0.7,
    maxTokens: 16384
  })

  onStatus('streaming')
  const fullText = await streamText(model, messages, signal, (delta) => {
    onDelta(delta)
  })

  return { fullText, ragContext }
}
