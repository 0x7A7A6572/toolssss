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
import { runMcpSearch, type McpSearchResult } from '@main-core/mcp-client'

const streamByModule = new Map<
  string,
  {
    id: string
    moduleId: string
    controller: AbortController
    timeout: ReturnType<typeof setTimeout> | null
  }
>()

const moduleProcessingQueue: Array<{
  id: string
  moduleId: string
  controller: AbortController
  timeoutMs: number
  event: Electron.IpcMainInvokeEvent
  moduleType: CustomModuleType
  prompt: string
  webSearch: boolean
  enableMarkdown: boolean
  getSettings: () => AppSettings
}> = []
let moduleProcessingInProgress = false

async function processModuleQueue(): Promise<void> {
  if (moduleProcessingInProgress) return
  moduleProcessingInProgress = true
  while (moduleProcessingQueue.length > 0) {
    const item = moduleProcessingQueue.shift()!
    try {
      await executeModuleStream(item)
    } catch (e) {
      console.error('[CustomModule] unexpected queue error:', e)
    }
  }
  moduleProcessingInProgress = false
}

async function executeModuleStream(item: {
  id: string
  moduleId: string
  controller: AbortController
  timeoutMs: number
  event: Electron.IpcMainInvokeEvent
  moduleType: CustomModuleType
  prompt: string
  webSearch: boolean
  enableMarkdown: boolean
  getSettings: () => AppSettings
}): Promise<void> {
  const {
    id,
    moduleId,
    controller,
    timeoutMs,
    event,
    moduleType,
    prompt,
    webSearch,
    enableMarkdown,
    getSettings
  } = item

  if (controller.signal.aborted) return

  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  streamByModule.set(moduleId, { ...streamByModule.get(moduleId)!, timeout })

  try {
    let finalPrompt = prompt
    let searchMeta: { resultCount: number; sources: string[] } | undefined

    if (webSearch) {
      try {
        event.sender.send(CUSTOM_MODULES_EVENTS.SEARCHING, {
          id,
          moduleId,
          status: 'searching'
        })
        const searchCmd = getSettings().ai.searchMcpCommand

        const aiParams = await extractSearchParamsViaAi({
          settings: getSettings(),
          prompt,
          signal: controller.signal
        })

        let searchObjective: string
        let searchQueries: string[]
        if (aiParams) {
          searchObjective = aiParams.objective
          searchQueries = aiParams.searchQueries
        } else {
          searchObjective = extractSearchQuery(prompt)
          searchQueries = extractSearchQueries(prompt)
          console.log('[CustomModule] AI extraction failed, using regex fallback')
        }

        console.log(`[CustomModule] search objective: "${searchObjective}"`)
        console.log(`[CustomModule] search queries: ${JSON.stringify(searchQueries)}`)
        const searchResults: McpSearchResult = await runMcpSearch(
          searchCmd,
          searchObjective,
          searchQueries,
          controller.signal
        )
        const trimmed = searchResults.text.trim()
        if (searchResults.resultCount > 0) {
          searchMeta = {
            resultCount: searchResults.resultCount,
            sources: searchResults.sources
          }
        }
        console.log(
          `[CustomModule] search results length: ${trimmed.length} chars, results: ${searchResults.resultCount}`
        )
        if (trimmed.length > 100) {
          console.log(`[CustomModule] search results preview: ${trimmed.slice(0, 300)}...`)
        }
        if (trimmed) {
          finalPrompt =
            `基于以下搜索结果来回答用户的问题，请直接使用搜索结果中的信息，不要编造。\n\n` +
            `搜索结果：\n${trimmed}\n\n` +
            `用户问题/要求：\n${prompt}`
        }
      } catch (e) {
        const name =
          e &&
          typeof e === 'object' &&
          'name' in e &&
          typeof (e as { name?: unknown }).name === 'string'
            ? ((e as { name: string }).name as string)
            : ''
        if (name === 'AbortError') throw e
        const msg = e instanceof Error ? e.message : '搜索失败'
        console.error('[CustomModule] web search error:', msg)
      }
    }

    let acc = ''
    const text = await requestFromAiStreamed({
      settings: getSettings(),
      type: moduleType,
      prompt: finalPrompt,
      signal: controller.signal,
      webSearch,
      enableMarkdown,
      onDelta: (delta) => {
        if (streamByModule.get(moduleId)?.id !== id) return
        acc += delta
        try {
          event.sender.send(CUSTOM_MODULES_EVENTS.CHUNK, { id, moduleId, delta })
        } catch {
          void 0
        }
      }
    })

    if (streamByModule.get(moduleId)?.id !== id) return
    const fullText = text || trimAiText(acc)
    try {
      event.sender.send(CUSTOM_MODULES_EVENTS.DONE, {
        id,
        moduleId,
        text: fullText,
        searchMeta: searchMeta || null
      })
    } catch {
      void 0
    }
  } catch (e) {
    if (streamByModule.get(moduleId)?.id !== id) return
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
    const cur = streamByModule.get(moduleId)
    if (cur?.id === id) {
      if (cur.timeout) clearTimeout(cur.timeout)
      streamByModule.delete(moduleId)
    }
  }
}

const SEARCH_EXTRACT_SYSTEM_PROMPT = `你是一个搜索参数提取专家。你的任务是根据用户的需求，提取出适合Parallel Search MCP中 web_search 工具的参数。

要求：
1. objective（字符串）：一句话概括用户想搜索什么，去掉格式要求和输出格式指令，只保留核心搜索意图
2. search_queries（字符串数组）：具体搜索关键词列表，每一条应该独立、明确、可直接用于搜索。生成3-5个不同角度的搜索词

注意：去除用户提示词中的"JSON格式"、"以XX格式输出"、"包含XX字段"等格式要求，只保留搜索意图。
注意：如果用户指定了来源URL，提取其中的域名作为搜索词的限定词。

必须只输出JSON格式，不要附加任何解释或标记。
JSON格式：{"objective": "搜索目标描述", "search_queries": ["关键词1", "关键词2"]}`

const ENHANCE_PROMPT_SYSTEM_PROMPT = `你是一个专业的提示词优化专家。你的任务是根据用户提供的模块标题、现有提示词和模块类型，优化并完善这条提示词。

要求：
1. 保持原有的核心意图和需求
2. 补充具体的细节、格式要求、约束条件，使提示词更清晰、可执行
3. 根据模块类型（text=生成文字, ranking=数据排行, link=资讯简报, chart=数据图表）调整输出格式指引
4. 使提示词更加结构化，明确输出要求
5. 如果原有提示词已经很好，可以小幅优化，不要过度修改
6. 只输出优化后的提示词本身，不要输出任何解释、前缀或标记`

const ENHANCE_PROMPT_MAX_TOKENS = 600

const SEARCH_EXTRACT_MAX_TOKENS = 300

function trimAiText(text: string, maxLength = 4000): string {
  const t = text.replace(/\r\n/g, '\n').trim()
  if (t.length <= maxLength) return t
  return t.slice(0, maxLength).trimEnd()
}

function buildSystemPrompt(type: CustomModuleType, enableMarkdown?: boolean): string {
  if (type === 'ranking') {
    return '你是一个数据分析师。根据用户的要求输出结构化的排行榜数据，必须只输出JSON格式，不要附加任何解释或标记。JSON格式：{"rankings":[{"title":"榜单标题","items":["项目1","项目2","项目3"]}]}。如果有多个维度，可以在rankings数组中包含多个元素。'
  }
  if (type === 'link') {
    return '你是一个资讯编辑。根据用户的要求输出结构化的信息列表，必须只输出JSON格式，不要附加任何解释或标记。JSON格式：{"items":[{"title":"标题","link":"https://...","description":"简短描述"}]}。其中link字段必须是真实可访问的URL，description为可选字段。'
  }
  if (type === 'chart') {
    return '你是一个数据可视化专家。根据用户的要求输出结构化的图表数据，必须只输出JSON格式，不要附加任何解释或标记。JSON格式：{"charts":[{"title":"图表标题","type":"bar","labels":["标签1","标签2","标签3"],"series":[{"name":"系列名","type":"bar","data":[10,20,30]}]}]}。支持的type有：bar（柱状图）, line（折线图）, pie（饼图）。series支持多系列，适合对比数据。'
  }
  if (enableMarkdown) {
    return '你是一个知识丰富的助手。根据用户的要求输出简洁、准确的内容。可以使用Markdown格式排版。'
  }
  return '你是一个知识丰富的助手。根据用户的要求输出简洁、准确的内容。不要使用列表格式，直接输出段落文字。'
}

function buildMaxTokens(type: CustomModuleType, webSearch = false): number {
  const base = type === 'ranking' ? 2000 : type === 'link' ? 2500 : type === 'chart' ? 3000 : 800
  return webSearch ? base * 2 : base
}

function extractSearchQuery(prompt: string): string {
  const cleaned = prompt.replace(/```[\s\S]*?```/g, '').trim()
  return cleaned || prompt.slice(0, 200)
}

function extractSearchQueries(prompt: string): string[] {
  const queries: string[] = []
  const lines = prompt
    .split(/[，,、\n]+/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (const line of lines) {
    const cleaned = line.replace(/```[\s\S]*?```/g, '').trim()
    if (cleaned && cleaned.length > 4) {
      queries.push(cleaned)
    }
  }
  return queries.length > 0 ? queries : [extractSearchQuery(prompt)]
}

function tryParseSearchParams(
  rawText: string
): { objective: string; searchQueries: string[] } | null {
  try {
    const cleaned = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace < 0 || lastBrace <= firstBrace) return null
    const jsonStr = cleaned.slice(firstBrace, lastBrace + 1)
    const data = JSON.parse(jsonStr) as { objective?: unknown; search_queries?: unknown }
    const objective =
      typeof data.objective === 'string' && data.objective.trim() ? data.objective.trim() : ''
    const searchQueries = Array.isArray(data.search_queries)
      ? data.search_queries
          .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
          .map((q) => q.trim())
      : []
    if (objective && searchQueries.length > 0) {
      return { objective, searchQueries }
    }
    return null
  } catch {
    return null
  }
}

async function extractSearchParamsViaAi(args: {
  settings: AppSettings
  prompt: string
  signal: AbortSignal
}): Promise<{ objective: string; searchQueries: string[] } | null> {
  const settings = args.settings
  if (!settings.ai.enabled) return null
  const base = settings.ai.baseUrl.trim()
  if (!base) return null
  const model = settings.ai.model.trim()
  if (!model) return null
  const apiKey = getAiApiKeyFromSecrets(settings.ai.activeProfileId)
  if (!apiKey) return null

  const url = buildAiChatCompletionsUrl(base)
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: SEARCH_EXTRACT_MAX_TOKENS,
        stream: false,
        messages: [
          { role: 'system', content: SEARCH_EXTRACT_SYSTEM_PROMPT },
          { role: 'user', content: args.prompt }
        ]
      }),
      signal: args.signal
    })
    if (!res.ok) return null
    const raw = await res.text()
    const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data?.choices?.[0]?.message?.content
    if (!content || !content.trim()) return null
    const parsed = tryParseSearchParams(content)
    if (parsed) {
      console.log(
        `[CustomModule] AI extracted search params: objective="${parsed.objective}", queries=${JSON.stringify(parsed.searchQueries)}`
      )
      return parsed
    }
    return null
  } catch {
    return null
  }
}

async function requestFromAiStreamed(args: {
  settings: AppSettings
  type: CustomModuleType
  prompt: string
  signal: AbortSignal
  webSearch?: boolean
  enableMarkdown?: boolean
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

  const messages: Array<{ role: string; content: string }> = [
    {
      role: 'system',
      content: buildSystemPrompt(args.type, args.enableMarkdown)
    },
    {
      role: 'user',
      content: args.prompt
    }
  ]

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
      max_tokens: buildMaxTokens(args.type, args.webSearch),
      stream: true,
      messages
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
        ? (payload as {
            moduleId?: unknown
            type?: unknown
            prompt?: unknown
            webSearch?: unknown
            enableMarkdown?: unknown
          })
        : {}
    const moduleId = typeof p.moduleId === 'string' ? p.moduleId.trim() : ''
    const type =
      p.type === 'text' || p.type === 'ranking' || p.type === 'link' || p.type === 'chart'
        ? (p.type as CustomModuleType)
        : 'text'
    const prompt = typeof p.prompt === 'string' ? p.prompt.trim() : ''
    const webSearch = Boolean(p.webSearch)
    const enableMarkdown = Boolean(p.enableMarkdown)
    if (!moduleId) throw new Error('模块 ID 不能为空')
    if (!prompt) throw new Error('提示词不能为空')

    const id = createAiStreamId()

    const prev = streamByModule.get(moduleId)
    if (prev) {
      try {
        prev.controller.abort()
      } catch {
        void 0
      }
      if (prev.timeout) clearTimeout(prev.timeout)
      streamByModule.delete(moduleId)
    }

    const controller = new AbortController()
    const timeoutMs = webSearch ? 120000 : 60000
    streamByModule.set(moduleId, { id, moduleId, controller, timeout: null })

    moduleProcessingQueue.push({
      id,
      moduleId,
      controller,
      timeoutMs,
      event,
      moduleType: type,
      prompt,
      webSearch,
      enableMarkdown,
      getSettings: args.getSettings
    })
    processModuleQueue()

    return { id, moduleId }
  })

  ipcMain.handle(CUSTOM_MODULES_EVENTS.CANCEL, (event, payload: unknown) => {
    const p = payload && typeof payload === 'object' ? (payload as { id?: unknown }) : {}
    const id = typeof p.id === 'string' ? p.id : ''
    if (!id) return false
    let cur:
      | {
          id: string
          moduleId: string
          controller: AbortController
          timeout: ReturnType<typeof setTimeout> | null
        }
      | undefined
    let foundModuleId: string | undefined
    for (const [mid, entry] of streamByModule) {
      if (entry.id === id) {
        cur = entry
        foundModuleId = mid
        break
      }
    }
    if (!cur) return false

    const qIdx = moduleProcessingQueue.findIndex((q) => q.id === id)
    if (qIdx >= 0) {
      moduleProcessingQueue.splice(qIdx, 1)
    }

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
    if (cur.timeout) clearTimeout(cur.timeout)
    if (foundModuleId) streamByModule.delete(foundModuleId)
    return true
  })

  ipcMain.handle(CUSTOM_MODULES_EVENTS.ENHANCE_PROMPT, async (_event, payload: unknown) => {
    const p =
      payload && typeof payload === 'object'
        ? (payload as { title?: unknown; prompt?: unknown; type?: unknown })
        : {}
    const title = typeof p.title === 'string' ? p.title.trim() : ''
    const prompt = typeof p.prompt === 'string' ? p.prompt.trim() : ''
    const type =
      p.type === 'text' || p.type === 'ranking' || p.type === 'link'
        ? (p.type as CustomModuleType)
        : 'text'

    if (!title && !prompt) throw new Error('请至少输入模块名称或提示词')

    const settings = args.getSettings()
    if (!settings.ai.enabled) throw new Error('AI 未启用，请到「全局设置」开启。')
    const base = settings.ai.baseUrl.trim()
    if (!base) throw new Error('未配置 AI Base URL，请到「全局设置」完善。')
    const model = settings.ai.model.trim()
    if (!model) throw new Error('未配置 AI Model，请到「全局设置」完善。')
    const apiKey = getAiApiKeyFromSecrets(settings.ai.activeProfileId)
    if (!apiKey) throw new Error('未配置 AI API Key，请到「全局设置」完善。')

    const typeLabel = type === 'text' ? '生成文字' : type === 'ranking' ? '数据排行' : '资讯简报'
    const userContent = `模块标题：${title}\n模块类型：${typeLabel}\n当前提示词：${prompt}\n\n请优化以上提示词，使其更加完善和可执行。`

    const url = buildAiChatCompletionsUrl(base)
    const controller = new AbortController()
    const timeoutMs = 30000
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.5,
          max_tokens: ENHANCE_PROMPT_MAX_TOKENS,
          stream: false,
          messages: [
            { role: 'system', content: ENHANCE_PROMPT_SYSTEM_PROMPT },
            { role: 'user', content: userContent }
          ]
        }),
        signal: controller.signal
      })

      clearTimeout(timeout)

      if (!res.ok) {
        const raw = await res.text()
        const msg = extractAiErrorMessage(raw)
        throw new Error(msg ? `AI 请求失败：${msg}` : raw || `AI 请求失败：HTTP ${res.status}`)
      }

      const raw = await res.text()
      const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> }
      const content = data?.choices?.[0]?.message?.content
      if (!content || !content.trim()) throw new Error('AI 未返回有效内容')

      return trimAiText(content)
    } catch (e) {
      clearTimeout(timeout)
      if (
        e &&
        typeof e === 'object' &&
        'name' in e &&
        (e as { name: string }).name === 'AbortError'
      ) {
        throw new Error('AI 请求超时，请稍后重试')
      }
      throw e
    }
  })
}
