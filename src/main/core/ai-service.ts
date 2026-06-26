import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai'
import type { BaseMessage } from '@langchain/core/messages'
import { AIMessageChunk } from '@langchain/core/messages'
import type { AppSettings, AiProfile } from '@shared/settings'
import { getAiApiKeyFromSecrets } from './secrets'

// 从 settings.ai 提取并校验 AI 模型配置
export interface AiModelConfig {
  baseUrl: string
  model: string
  profileId: string
}

// Embedding 与聊天模型拆开配置，避免把生成模型和向量模型绑死在一起
export interface EmbeddingModelConfig {
  baseUrl: string
  model: string
  profileId: string
  provider: AiProfile['provider']
  dimensions?: number
}

function isRerankModel(model: string): boolean {
  return /rerank/i.test(model)
}

function isLikelyNonTextEmbeddingModel(model: string): boolean {
  return /(vision|multimodal|image|video|audio|\bvl\b)/i.test(model)
}

function assertEmbeddingChainSupported(profile: AiProfile, model: string): void {
  if (profile.modelType !== 'embedding') {
    throw new Error(
      `当前选择的模型「${profile.name}」类型为「${profile.modelType}」，不是向量模型，不能用于 RAG 索引。`
    )
  }

  if (isRerankModel(model)) {
    throw new Error(`当前模型「${model}」是重排模型，不是向量模型，不能用于 RAG 索引。`)
  }

  if (isLikelyNonTextEmbeddingModel(model)) {
    throw new Error(
      `当前模型「${model}」属于视觉或多模态向量模型，现有 RAG 链路只支持 OpenAI-compatible 文本向量模型；如需使用该模型，需要补 provider-native 适配。`
    )
  }
}

export function formatEmbeddingChainError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message
    if (
      /Unsupported model/i.test(msg) ||
      /model_not_supported/i.test(msg) ||
      /MODEL_NOT_FOUND/i.test(msg)
    ) {
      return `当前所选向量模型不支持现有 RAG 链路。请在 AI 设置中为 RAG 选择可走 OpenAI-compatible embeddings 的文本向量模型，例如 text-embedding-v3。原始错误：${msg}`
    }
    return msg
  }
  return '当前所选向量模型不支持现有 RAG 链路，请检查 AI 设置中的 RAG 模型配置。'
}

// 创建 ChatModel 时的可选参数
export interface ChatModelOptions {
  temperature?: number
  maxTokens?: number
}

// 将用户配置的 baseUrl 规范化为 ChatOpenAI.configuration.baseURL 格式
// ChatOpenAI 内部会在 baseURL 后追加 /chat/completions
export function normalizeBaseUrlForChatOpenAI(baseUrl: string): string {
  const base = baseUrl.trim()
  if (!base) throw new Error('未配置 AI Base URL，请到「全局设置」完善。')
  const normalized = base.replace(/\/+$/, '')
  // 如果 URL 已经以 /chat/completions 结尾，去掉它（LangChain 会自动追加）
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized.replace(/\/chat\/completions$/i, '')
  }
  // /openai 结尾（Gemini 等），保持不变
  if (/\/openai$/i.test(normalized)) return normalized
  // /v1 结尾，保持不变
  if (/\/v1$/i.test(normalized)) return normalized
  // 其他情况，追加 /v1
  return `${normalized}/v1`
}

// 校验并提取 AI 模型配置，未配置时抛中文错误
export function resolveAiModelConfig(settings: AppSettings): AiModelConfig {
  if (!settings.ai.enabled) throw new Error('AI 未启用，请到「全局设置」开启。')
  const baseUrl = settings.ai.baseUrl.trim()
  if (!baseUrl) throw new Error('未配置 AI Base URL，请到「全局设置」完善。')
  const model = settings.ai.model.trim()
  if (!model) throw new Error('未配置 AI Model，请到「全局设置」完善。')
  return {
    baseUrl,
    model,
    profileId: settings.ai.activeProfileId
  }
}

// Embedding 走 LangChain 的 OpenAIEmbeddings，它需要的是 provider 根 URL，而不是完整 /embeddings 端点
export function resolveEmbeddingModelConfig(settings: AppSettings): EmbeddingModelConfig {
  if (!settings.ai.embedding.enabled) {
    throw new Error('未启用知识库 Embedding 配置，请到「全局设置」完善。')
  }

  const profileId = settings.ai.embedding.profileId.trim()
  if (!profileId) {
    throw new Error('未选择 Embedding Profile，请到「全局设置」完善。')
  }

  const profile = settings.ai.profiles.find((item) => item.id === profileId)
  if (!profile) {
    throw new Error('未找到 Embedding Profile，请到「全局设置」完善。')
  }

  const model = profile.model.trim() || settings.ai.embedding.model.trim()
  if (!model) {
    throw new Error('未配置 Embedding Model，请到「全局设置」完善。')
  }

  assertEmbeddingChainSupported(profile, model)

  return {
    baseUrl: profile.baseUrl,
    model,
    profileId,
    provider: profile.provider,
    dimensions: settings.ai.embedding.dimensions > 0 ? settings.ai.embedding.dimensions : undefined
  }
}

// 从 secrets 解密并返回 API Key，未配置时抛中文错误
export function resolveApiKey(profileId: string): string {
  const apiKey = getAiApiKeyFromSecrets(profileId)
  if (!apiKey) throw new Error('未配置 AI API Key，请到「全局设置」完善。')
  return apiKey
}

// 创建 LangChain ChatOpenAI 实例
export function createChatModel(
  config: AiModelConfig,
  apiKey: string,
  options?: ChatModelOptions
): ChatOpenAI {
  // LangChain ChatOpenAI 负责拼装 OpenAI-compatible chat/completions 请求
  return new ChatOpenAI({
    model: config.model,
    apiKey,
    temperature: options?.temperature ?? 0.7,
    maxTokens: options?.maxTokens,
    configuration: {
      baseURL: normalizeBaseUrlForChatOpenAI(config.baseUrl)
    },
    // 关闭流式 token 用量统计，兼容非 OpenAI 提供商
    streamUsage: false
  })
}

// LangChain OpenAIEmbeddings 负责 embeddings 请求；后续检索链路只依赖这个模型做向量化
export function createEmbeddingsModel(
  config: EmbeddingModelConfig,
  apiKey: string
): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    model: config.model,
    apiKey,
    dimensions: config.dimensions,
    configuration: {
      baseURL: normalizeBaseUrlForChatOpenAI(config.baseUrl)
    }
  })
}

// 快捷方法：一步创建 ChatModel 实例
export function createModelFromSettings(
  settings: AppSettings,
  options?: ChatModelOptions
): { model: ChatOpenAI; profileId: string } {
  const config = resolveAiModelConfig(settings)
  const apiKey = resolveApiKey(config.profileId)
  const model = createChatModel(config, apiKey, options)
  return { model, profileId: config.profileId }
}

export function createEmbeddingsModelFromSettings(settings: AppSettings): {
  model: OpenAIEmbeddings
  profileId: string
} {
  const config = resolveEmbeddingModelConfig(settings)
  const apiKey = resolveApiKey(config.profileId)
  const model = createEmbeddingsModel(config, apiKey)
  return { model, profileId: config.profileId }
}

// 流式生成文本，通过 onDelta 回调推送每个文本块
// signal 来自 AbortController，LangChain 会转发给底层 fetch
export async function streamText(
  model: ChatOpenAI,
  messages: BaseMessage[],
  signal: AbortSignal,
  onDelta: (delta: string) => void
): Promise<string> {
  const stream = await model.stream(messages, { signal })
  let full = ''
  for await (const chunk of stream) {
    const content = (chunk as AIMessageChunk).content
    if (typeof content === 'string' && content) {
      full += content
      onDelta(content)
    }
  }
  return full
}

// 非流式生成文本，返回完整结果
// content 为空时抛「AI 未返回有效内容」错误
export async function invokeText(
  model: ChatOpenAI,
  messages: BaseMessage[],
  signal: AbortSignal
): Promise<string> {
  const result = await model.invoke(messages, { signal })
  const content = result.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI 未返回有效内容')
  }
  return content
}
