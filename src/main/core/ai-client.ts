export function extractAiErrorMessage(raw: string): string | null {
  try {
    const obj = JSON.parse(raw) as unknown
    const root = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null
    const err = root?.['error']
    const e = err && typeof err === 'object' ? (err as Record<string, unknown>) : null
    const msg = typeof e?.['message'] === 'string' ? e.message : ''
    return msg.trim() ? msg.trim() : null
  } catch {
    return null
  }
}

export function buildAiChatCompletionsUrl(baseUrl: string): URL {
  const base = baseUrl.trim()
  if (!base) throw new Error('未配置 AI Base URL，请到「全局设置」完善。')
  const normalized = base.replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(normalized)) return new URL(normalized)
  if (/\/openai$/i.test(normalized)) return new URL(`${normalized}/chat/completions`)
  if (/\/v1$/i.test(normalized)) return new URL(`${normalized}/chat/completions`)
  return new URL(`${normalized}/v1/chat/completions`)
}

export function createAiStreamId(): string {
  const a = Date.now()
  const b = Math.random().toString(16).slice(2)
  return `${a}-${b}`
}

export function tryParseAiSseDelta(jsonText: string): string {
  try {
    const obj = JSON.parse(jsonText) as unknown
    const root = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null
    const choices = Array.isArray(root?.['choices']) ? (root?.['choices'] as unknown[]) : []
    const first =
      choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>) : null
    const delta =
      first?.['delta'] && typeof first['delta'] === 'object'
        ? (first['delta'] as Record<string, unknown>)
        : null
    const content = delta?.['content']
    return typeof content === 'string' ? content : ''
  } catch {
    return ''
  }
}
