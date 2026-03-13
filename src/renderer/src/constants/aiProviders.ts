export type AiProviderKey = 'openai' | 'gmini' | 'kimi' | 'qwen'
export type AiProvidersMap = Record<
  AiProviderKey,
  {
    baseUrl: string
    models: string[]
  }
>

export const AI_PROVIDERS: AiProvidersMap = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini']
  },
  gmini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash']
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen2.5-7b-instruct', 'qwen2.5-32b-instruct', 'qwen2.5-72b-instruct']
  }
}
