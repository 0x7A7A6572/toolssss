import { ipcMain } from 'electron'
import type { AppSettings } from '@shared/settings'
import type { CustomModuleType } from '@shared/custom-modules'
import { CUSTOM_MODULES_EVENTS } from '@shared/custom-modules'
import {
  buildAiChatCompletionsUrl,
  createAiStreamId,
  extractAiErrorMessage,
  tryParseAiSseDelta
} from '@main-core/ai-client'
import { getAiApiKeyFromSecrets } from '@main-core/secrets'

const streamBySender = new Map<
  number,
  {
    id: string
    moduleId: string
    controller: AbortController
    timeout: ReturnType<typeof setTimeout>
  }
>()

function trimAiText(text: string, maxLength = 4000): string {
  const t = text.replace(/\r\n/g, '\n').trim()
  if (t.length <= maxLength) return t
  return t.slice(0, maxLength).trimEnd()
}

function buildSystemPrompt(type: CustomModuleType): string {
  if (type === 'ranking') {
    return '你是一个数据分析师。根据用户的要求输出结构化的排行榜数据，必须只输出JSON格式，不要附加任何解释或标记。JSON格式：{"rankings":[{"title":"榜单标题","items":["项目1","项目2","项目3"]}]}。如果有多个维度，可以在rankings数组中包含多个元素。'
  }
  if (type === 'link') {
    return '你是一个资讯编辑。根据用户的要求输出结构化的信息列表，必须只输出JSON格式，不要附加任何解释或标记。JSON格式：{"items":[{"title":"标题","link":"https://...","description":"简短描述"}]}。其中link字段必须是真实可访问的URL，description为可选字段。'
  }
  return '你是一个知识丰富的助手。根据用户的要求输出简洁、准确的内容。不要使用列表格式，直接输出段落文字。'
}

function buildMaxTokens(type: CustomModuleType): number {
  if (type === 'ranking') return 800
  if (type === 'link') return 1000
  return 400
}

async function requestFromAiStreamed(args: {
  settings: AppSettings
  type: CustomModuleType
  prompt: string
  signal: AbortSignal
  onDelta: (delta: string) => void
}): Promise<string> {
  const settings = args.settings
  if (!settings.ai.enabled) throw new Error('AI 未启用，请到「全局设置」开启。')
  const base = settings.ai.baseUrl.trim()
  if (!base) throw new Error('未配置 AI Base URL，请到「全局设置」完善。')
  const model = settings.ai.model.trim()
  if (!model) throw new Error('未配置 AI Model，请到「全局设置」完善。')
  const apiKey = getAiApiKeyFromSecrets(settings.ai.activeProfileId)
  if (!apiKey) throw new Error('未配置 AI API Key，请到「全局设置」完善。')

  const url = buildAiChatCompletionsUrl(base)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: buildMaxTokens(args.type),
      stream: true,
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(args.type)
        },
        {
          role: 'user',
          content: args.prompt
        }
      ]
    }),
    signal: args.signal
  })

  if (!res.ok) {
    const raw = await res.text()
    const msg = extractAiErrorMessage(raw)
    throw new Error(msg ? `AI 请求失败：${msg}` : raw || `AI 请求失败：HTTP ${res.status}`)
  }

  const ct = res.headers.get('content-type') ?? ''
  if (!/text\/event-stream/i.test(ct) || !res.body) {
    const raw = await res.text()
    const data = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 未返回有效内容')
    const out = trimAiText(content)
    if (out) args.onDelta(out)
    return out
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    while (true) {
      const idx = buffer.indexOf('\n')
      if (idx < 0) break
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      const trimmed = line.trim()
      if (!trimmed) continue
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice('data:'.length).trim()
      if (!data) continue
      if (data === '[DONE]') return trimAiText(full)
      const delta = tryParseAiSseDelta(data)
      if (!delta) continue
      full += delta
      args.onDelta(delta)
    }
  }
  return trimAiText(full)
}

export function registerCustomModuleHandlers(args: { getSettings: () => AppSettings }): void {
  ipcMain.handle(CUSTOM_MODULES_EVENTS.STREAM, async (event, payload: unknown) => {
    const p =
      payload && typeof payload === 'object'
        ? (payload as { moduleId?: unknown; type?: unknown; prompt?: unknown })
        : {}
    const moduleId = typeof p.moduleId === 'string' ? p.moduleId.trim() : ''
    const type = p.type === 'text' || p.type === 'ranking' ? (p.type as CustomModuleType) : 'text'
    const prompt = typeof p.prompt === 'string' ? p.prompt.trim() : ''
    if (!moduleId) throw new Error('模块 ID 不能为空')
    if (!prompt) throw new Error('提示词不能为空')

    const id = createAiStreamId()
    const senderId = event.sender.id

    const prev = streamBySender.get(senderId)
    if (prev) {
      try {
        prev.controller.abort()
      } catch {
        void 0
      }
      clearTimeout(prev.timeout)
      streamBySender.delete(senderId)
    }

    const controller = new AbortController()
    const timeoutMs = 60000
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    streamBySender.set(senderId, { id, moduleId, controller, timeout })

    setImmediate(() => {
      ;(async () => {
        try {
          let acc = ''
          const text = await requestFromAiStreamed({
            settings: args.getSettings(),
            type,
            prompt,
            signal: controller.signal,
            onDelta: (delta) => {
              if (streamBySender.get(senderId)?.id !== id) return
              acc += delta
              try {
                event.sender.send(CUSTOM_MODULES_EVENTS.CHUNK, { id, moduleId, delta })
              } catch {
                void 0
              }
            }
          })

          if (streamBySender.get(senderId)?.id !== id) return
          const fullText = text || trimAiText(acc)
          try {
            event.sender.send(CUSTOM_MODULES_EVENTS.DONE, { id, moduleId, text: fullText })
          } catch {
            void 0
          }
        } catch (e) {
          if (streamBySender.get(senderId)?.id !== id) return
          const name =
            e &&
            typeof e === 'object' &&
            'name' in e &&
            typeof (e as { name?: unknown }).name === 'string'
              ? ((e as { name: string }).name as string)
              : ''
          if (name === 'AbortError') {
            try {
              event.sender.send(CUSTOM_MODULES_EVENTS.ERROR, {
                id,
                moduleId,
                message: `AI 请求超时（${Math.round(timeoutMs / 1000)}秒），请稍后重试`
              })
            } catch {
              void 0
            }
            return
          }
          const msg = e instanceof Error ? e.message : 'AI 请求失败'
          try {
            event.sender.send(CUSTOM_MODULES_EVENTS.ERROR, { id, moduleId, message: msg })
          } catch {
            void 0
          }
        } finally {
          const cur = streamBySender.get(senderId)
          if (cur?.id === id) {
            clearTimeout(cur.timeout)
            streamBySender.delete(senderId)
          }
        }
      })()
    })

    return { id, moduleId }
  })

  ipcMain.handle(CUSTOM_MODULES_EVENTS.CANCEL, (event, payload: unknown) => {
    const p = payload && typeof payload === 'object' ? (payload as { id?: unknown }) : {}
    const id = typeof p.id === 'string' ? p.id : ''
    const senderId = event.sender.id
    const cur = streamBySender.get(senderId)
    if (!cur) return false
    if (id && cur.id !== id) return false
    try {
      event.sender.send(CUSTOM_MODULES_EVENTS.ERROR, {
        id,
        moduleId: cur.moduleId,
        message: '已取消'
      })
    } catch {
      void 0
    }
    try {
      cur.controller.abort()
    } catch {
      void 0
    }
    clearTimeout(cur.timeout)
    streamBySender.delete(senderId)
    return true
  })
}
