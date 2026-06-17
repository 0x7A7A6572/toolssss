import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import {
  normalizeBaseUrlForChatOpenAI,
  resolveEmbeddingModelConfig
} from './ai-service'

describe('ai-service', () => {
  it('normalizes openai-compatible base url for langchain clients', () => {
    expect(normalizeBaseUrlForChatOpenAI('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1'
    )
    expect(normalizeBaseUrlForChatOpenAI('https://example.com/openai')).toBe(
      'https://example.com/openai'
    )
  })

  it('resolves embedding config from dedicated profile settings', () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.ai.profiles = [
      {
        id: 'chat-profile',
        name: 'Chat',
        source: 'custom',
        provider: 'custom',
        baseUrl: 'https://chat.example.com/v1',
        model: 'chat-model',
        apiKeySet: true,
        modelType: 'llm'
      },
      {
        id: 'embed-profile',
        name: 'Embedding',
        source: 'custom',
        provider: 'custom',
        baseUrl: 'https://embed.example.com/v1',
        model: 'text-embedding-3-small',
        apiKeySet: true,
        modelType: 'embedding'
      }
    ]
    settings.ai.embedding = {
      enabled: true,
      profileId: 'embed-profile',
      model: 'legacy-model-should-be-ignored',
      dimensions: 1536
    }

    expect(resolveEmbeddingModelConfig(settings)).toEqual({
      baseUrl: 'https://embed.example.com/v1',
      model: 'text-embedding-3-small',
      profileId: 'embed-profile',
      provider: 'custom',
      dimensions: 1536
    })
  })

  it('rejects non-embedding profiles for rag indexing', () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.ai.profiles = [
      {
        id: 'chat-profile',
        name: 'Chat',
        source: 'custom',
        provider: 'custom',
        baseUrl: 'https://chat.example.com/v1',
        model: 'gpt-like-model',
        apiKeySet: true,
        modelType: 'llm'
      }
    ]
    settings.ai.embedding = {
      enabled: true,
      profileId: 'chat-profile',
      model: '',
      dimensions: 1536
    }

    expect(() => resolveEmbeddingModelConfig(settings)).toThrow(/不是向量模型/)
  })

  it('rejects rerank and multimodal embedding models on current chain', () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.ai.profiles = [
      {
        id: 'embed-profile',
        name: 'Qwen Vision Embedding',
        source: 'custom',
        provider: 'qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'tongyi-embedding-vision-flash',
        apiKeySet: true,
        modelType: 'embedding'
      }
    ]
    settings.ai.embedding = {
      enabled: true,
      profileId: 'embed-profile',
      model: '',
      dimensions: 1024
    }

    expect(() => resolveEmbeddingModelConfig(settings)).toThrow(/文本向量模型/)
  })
})
