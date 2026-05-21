import { ipcMain } from 'electron'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'
import { buildAiChatCompletionsUrl, createAiStreamId, extractAiErrorMessage, tryParseAiSseDelta } from '@main-core/ai-client'
import { getAiApiKeyFromSecrets } from '@main-core/secrets'

type AiDailyFunFactResult = {
  ymd: string
  text: string
}

let dailyCache: AiDailyFunFactResult | null = null
const streamBySender = new Map<
  number,
  { id: string; controller: AbortController; timeout: ReturnType<typeof setTimeout> }
>()

function ymdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function trimAiText(text: string): string {
  const t = text.replace(/\r\n/g, '\n').trim()
  if (t.length <= 800) return t
  return t.slice(0, 800).trimEnd()
}

function getDailyTitle(settings: AppSettings): string {
  const title = typeof settings.funFact?.title === 'string' ? settings.funFact.title.trim() : ''
  return title || DEFAULT_SETTINGS.funFact.title
}

function getPromptTemplate(settings: AppSettings): string {
  const prompt = typeof settings.funFact?.prompt === 'string' ? settings.funFact.prompt : ''
  const v = prompt.replace(/\r\n/g, '\n').trim()
  if (v) return v
  return DEFAULT_SETTINGS.funFact.prompt
}

function buildUserPrompt(settings: AppSettings, ymd: string): string {
  const title = getDailyTitle(settings)
  const tpl = getPromptTemplate(settings)
  const out = tpl
    .replace(/\{ymd\}/g, ymd)
    .replace(/\{title\}/g, title)
    .replace(/\r\n/g, '\n')
    .trim()
  if (out.length <= 2000) return out
  return out.slice(0, 2000).trimEnd()
}

async function requestFromAiStreamed(args: {
  settings: AppSettings
  ymd: string
  signal: AbortSignal
  onDelta: (delta: string) => void
}): Promise<string> {
  const settings = args.settings
  if (!settings.ai.enabled) throw new Error('AI 未启用，请到「全局设置」开启。')
  const base = settings.ai.baseUrl.trim()
  if (!base) throw new Error('未配置 AI Base URL，请到「全局设置」完善。')
  const model = settings.ai.model.trim()
  if (!model) throw new Error('未配置 AI Model，请到「全局设置」完善。')
  const apiKey = getAiApiKeyFromSecrets()
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
      max_tokens: 220,
      stream: true,
      messages: [
        {
          role: 'system',
          content: '你是一个严谨的科普编辑。只输出一条冷知识，中文，尽量准确，不要编造具体数字或来源。'
        },
        {
          role: 'user',
          content: buildUserPrompt(settings, args.ymd)
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

async function requestFromAi(settings: AppSettings, ymd: string): Promise<string> {
  if (!settings.ai.enabled) throw new Error('AI 未启用，请到「全局设置」开启。')
  const base = settings.ai.baseUrl.trim()
  if (!base) throw new Error('未配置 AI Base URL，请到「全局设置」完善。')
  const model = settings.ai.model.trim()
  if (!model) throw new Error('未配置 AI Model，请到「全局设置」完善。')
  const apiKey = getAiApiKeyFromSecrets()
  if (!apiKey) throw new Error('未配置 AI API Key，请到「全局设置」完善。')

  const url = buildAiChatCompletionsUrl(base)
  const controller = new AbortController()
  const timeoutMs = 60000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let res: Response
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.7,
          max_tokens: 220,
          stream: true,
          messages: [
            {
              role: 'system',
              content: '你是一个严谨的科普编辑。只输出一条冷知识，中文，尽量准确，不要编造具体数字或来源。'
            },
            {
              role: 'user',
              content: buildUserPrompt(settings, ymd)
            }
          ]
        }),
        signal: controller.signal
      })
    } catch (e) {
      const name =
        e && typeof e === 'object' && 'name' in e && typeof (e as { name?: unknown }).name === 'string'
          ? ((e as { name: string }).name as string)
          : ''
      if (name === 'AbortError')
        throw new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)}秒），请稍后重试`)
      throw e
    }

    const raw = await res.text()
    if (!res.ok) {
      const msg = extractAiErrorMessage(raw)
      throw new Error(msg ? `AI 请求失败：${msg}` : raw || `AI 请求失败：HTTP ${res.status}`)
    }

    const data = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 未返回有效内容')
    return trimAiText(content)
  } finally {
    clearTimeout(timeout)
  }
}

async function getDaily(settings: AppSettings, force: boolean): Promise<AiDailyFunFactResult> {
  const ymd = ymdLocal(new Date())
  if (!force && dailyCache?.ymd === ymd && dailyCache.text.trim()) return dailyCache
  const text = await requestFromAi(settings, ymd)
  const out: AiDailyFunFactResult = { ymd, text }
  dailyCache = out
  return out
}

export function registerFunFactHandlers(args: { getSettings: () => AppSettings }): void {
  ipcMain.handle('ai:funfact:daily', async (_event, payload: unknown) => {
    const p = payload && typeof payload === 'object' ? (payload as { force?: unknown }) : {}
    const force = Boolean(p.force)
    return await getDaily(args.getSettings(), force)
  })

  ipcMain.handle('ai:funfact:daily:stream', async (event, payload: unknown) => {
    const p = payload && typeof payload === 'object' ? (payload as { force?: unknown }) : {}
    const force = Boolean(p.force)
    const ymd = ymdLocal(new Date())
    const id = createAiStreamId()

    const senderId = event.sender.id
    const prev = streamBySender.get(senderId)
    if (prev) {
      try {
        prev.controller.abort()
      } catch (_e) {
        void _e
      }
      clearTimeout(prev.timeout)
      streamBySender.delete(senderId)
    }

    if (!force && dailyCache?.ymd === ymd && dailyCache.text.trim()) {
      return { id, ymd, text: dailyCache.text }
    }

    const controller = new AbortController()
    const timeoutMs = 60000
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    streamBySender.set(senderId, { id, controller, timeout })

    setImmediate(() => {
      ;(async () => {
        try {
          let acc = ''
          const text = await requestFromAiStreamed({
            settings: args.getSettings(),
            ymd,
            signal: controller.signal,
            onDelta: (delta) => {
              if (streamBySender.get(senderId)?.id !== id) return
              acc += delta
              try {
                event.sender.send('ai:funfact:daily:chunk', { id, delta })
              } catch (_e) {
                void _e
              }
            }
          })

          if (streamBySender.get(senderId)?.id !== id) return
          const out: AiDailyFunFactResult = { ymd, text: text || trimAiText(acc) }
          dailyCache = out
          try {
            event.sender.send('ai:funfact:daily:done', { id, ymd: out.ymd, text: out.text })
          } catch (_e) {
            void _e
          }
        } catch (e) {
          if (streamBySender.get(senderId)?.id !== id) return
          const name =
            e && typeof e === 'object' && 'name' in e && typeof (e as { name?: unknown }).name === 'string'
              ? ((e as { name: string }).name as string)
              : ''
          if (name === 'AbortError') {
            try {
              event.sender.send('ai:funfact:daily:error', {
                id,
                message: `AI 请求超时（${Math.round(timeoutMs / 1000)}秒），请稍后重试`
              })
            } catch (_e) {
              void _e
            }
            return
          }
          const msg = e instanceof Error ? e.message : 'AI 请求失败'
          try {
            event.sender.send('ai:funfact:daily:error', { id, message: msg })
          } catch (_e) {
            void _e
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

    return { id, ymd }
  })

  ipcMain.handle('ai:funfact:daily:cancel', (event, payload: unknown) => {
    const p = payload && typeof payload === 'object' ? (payload as { id?: unknown }) : {}
    const id = typeof p.id === 'string' ? p.id : ''
    const senderId = event.sender.id
    const cur = streamBySender.get(senderId)
    if (!cur) return false
    if (id && cur.id !== id) return false
    try {
      event.sender.send('ai:funfact:daily:cancelled', { id: cur.id })
    } catch (_e) {
      void _e
    }
    try {
      cur.controller.abort()
    } catch (_e) {
      void _e
    }
    clearTimeout(cur.timeout)
    streamBySender.delete(senderId)
    return true
  })
}
