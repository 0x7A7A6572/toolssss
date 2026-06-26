/**
 * Python 后端 API 客户端
 *
 * 通过 HTTP 直接请求 Python 服务（不经过 Electron 主进程中转）。
 * Python 端口通过 IPC `python:port` 从主进程获取。
 *
 * 对应 Python 端的 API 设计：
 * - /api/agents/conversations/*    智能体对话
 * - /api/agents/knowledge-bases/*  知识库
 * - /api/modules/stream            自定义模块流式
 * - /api/modules/enhance           Prompt 增强
 */

import type {
  AgentConversation,
  AgentKnowledgeDoc,
  AgentMessage,
  AgentRagChunk,
  KnowledgeBaseConfig
} from '@shared/agents'
import type { CustomModuleConfig } from '@shared/custom-modules'

// =============================================================================
// 类型定义
// =============================================================================

export type {
  AgentConversation,
  AgentKnowledgeDoc,
  AgentMessage,
  AgentRagChunk,
  KnowledgeBaseConfig
}

export interface ConversationListItem {
  id: string
  agentId: string
  title: string
  createdAt: number
  updatedAt: number
}

// SSE 事件类型
export interface ChatStreamEvent {
  type: 'status' | 'delta' | 'done' | 'error' | 'completed'
  conversationId?: string
  status?: string
  delta?: string
  fullText?: string
  message?: string
  ragChunks?: { text: string; docTitle: string; score: number }[]
  assistantMessage?: AgentMessage
}

export interface ModuleStreamEvent {
  type: 'searching' | 'delta' | 'done' | 'error'
  id?: string
  moduleId?: string
  status?: string
  delta?: string
  text?: string
  message?: string
  searchMeta?: { resultCount: number; sources: string[] } | null
}

// =============================================================================
// 基础 HTTP 工具
// =============================================================================

/** 缓存 Python 端口，避免每次都 IPC 查询 */
let cachedPort = 0

/** 获取 Python 服务端口 */
async function getPort(): Promise<number> {
  if (cachedPort) return cachedPort
  try {
    cachedPort = (await window.electron.ipcRenderer.invoke('python:port')) as number
  } catch {
    cachedPort = 0
  }
  return cachedPort
}

/** 构建 Python API URL */
async function apiUrl(path: string): Promise<string> {
  const port = await getPort()
  if (!port) throw new Error('Python 服务未启动')
  return `http://127.0.0.1:${port}${path}`
}

/** 基础 GET 请求 */
async function get<T>(path: string): Promise<T> {
  return requestJson<T>(path)
}

/** 基础 POST 请求 */
async function post<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>(path, { method: 'POST', body })
}

// =============================================================================
// 智能体对话 API
// =============================================================================

export const agentApi = {
  /** 获取对话列表 */
  listConversations(): Promise<ConversationListItem[]> {
    return get<unknown[]>('/api/agents/conversations').then((rows) =>
      Array.isArray(rows) ? rows.map(normalizeConversationListItem) : []
    )
  },

  /** 获取单个对话 */
  getConversation(id: string): Promise<AgentConversation> {
    return get<unknown>(`/api/agents/conversations/${id}`).then(normalizeConversation)
  },

  /** 创建对话 */
  createConversation(agentId: string, title: string = '新对话'): Promise<AgentConversation> {
    return post<unknown>('/api/agents/conversations', { agent_id: agentId, title }).then(
      normalizeConversation
    )
  },

  /** 删除对话 */
  async deleteConversation(id: string): Promise<void> {
    await requestVoid(`/api/agents/conversations/${id}`, { method: 'DELETE' })
  },

  /** 重命名对话 */
  renameConversation(id: string, title: string): Promise<AgentConversation> {
    return requestJson<unknown>(`/api/agents/conversations/${id}/rename`, {
      method: 'PUT',
      body: { title }
    }).then(normalizeConversation)
  },

  /** 清空对话消息 */
  clearConversation(id: string): Promise<AgentConversation> {
    return requestJson<unknown>(`/api/agents/conversations/${id}/messages`, {
      method: 'DELETE'
    }).then(normalizeConversation)
  },

  /**
   * 流式聊天 —— 返回 SSE 事件监听器
   *
   * 使用方式：
   * ```typescript
   * const es = await agentApi.chatStream('conv-id', 'agent-id', '你好')
   * es.addEventListener('delta', (e) => { console.log(JSON.parse(e.data)) })
   * es.addEventListener('done', (e) => { console.log('完成', JSON.parse(e.data)) })
   * ```
   */
  async chatStream(
    conversationId: string,
    agentId: string,
    message: string
  ): Promise<CustomEventSource> {
    const controller = new AbortController()
    const res = await request(`/api/agents/conversations/${conversationId}/chat`, {
      method: 'POST',
      body: {
        conversation_id: conversationId,
        agent_id: agentId,
        message
      },
      signal: controller.signal
    })
    if (!res.ok) {
      throw new Error(await readErrorMessage(res))
    }
    const reader = res.body?.getReader()
    if (!reader) throw new Error('无法读取流式响应')

    return createEventSourceFromReader(reader, {
      controller,
      transformEvent: (event, data) => normalizeChatEventData(event, data, conversationId)
    })
  },

  /** 取消流式聊天 */
  async cancelStream(conversationId: string): Promise<void> {
    await requestVoid(`/api/agents/conversations/${conversationId}/cancel`, {
      method: 'POST',
      body: {}
    })
  }
}

// =============================================================================
// 知识库 API
// =============================================================================

export const knowledgeBaseApi = {
  list(): Promise<KnowledgeBaseConfig[]> {
    return get<unknown[]>('/api/agents/knowledge-bases').then((rows) =>
      Array.isArray(rows) ? rows.map(normalizeKnowledgeBase) : []
    )
  },

  save(id: string, name: string): Promise<KnowledgeBaseConfig> {
    return post<unknown>('/api/agents/knowledge-bases', { id, name }).then(normalizeKnowledgeBase)
  },

  async delete(id: string): Promise<void> {
    await requestVoid(`/api/agents/knowledge-bases/${id}`, { method: 'DELETE' })
  },

  listDocuments(kbId: string): Promise<AgentKnowledgeDoc[]> {
    return get<unknown[]>(`/api/agents/knowledge-bases/${kbId}/docs`).then((rows) =>
      Array.isArray(rows) ? rows.map(normalizeKnowledgeDoc) : []
    )
  },

  saveDocument(
    kbId: string,
    doc: Omit<AgentKnowledgeDoc, 'kbId'> & Partial<Pick<AgentKnowledgeDoc, 'kbId'>>
  ): Promise<AgentKnowledgeDoc> {
    return post<unknown>(`/api/agents/knowledge-bases/${kbId}/docs`, { doc }).then(
      normalizeKnowledgeDoc
    )
  },

  async deleteDocument(kbId: string, docId: string): Promise<void> {
    await requestVoid(`/api/agents/knowledge-bases/${kbId}/docs/${docId}`, {
      method: 'DELETE'
    })
  },

  reindex(kbId: string): Promise<KnowledgeBaseConfig> {
    return post<unknown>(`/api/agents/knowledge-bases/${kbId}/reindex`).then(normalizeKnowledgeBase)
  }
}

// =============================================================================
// 自定义模块 API
// =============================================================================

export const moduleApi = {
  /** Prompt 增强 */
  enhance(title: string, prompt: string, type: string = 'text'): Promise<{ enhanced: string }> {
    return post('/api/modules/enhance', { title, prompt, type })
  },

  /** 获取模块列表 */
  list(): Promise<CustomModuleConfig[]> {
    return get<unknown[]>('/api/modules').then((rows) =>
      Array.isArray(rows) ? rows.map(normalizeModuleConfig) : []
    )
  },

  /** 获取单个模块 */
  get(id: string): Promise<CustomModuleConfig> {
    return get<unknown>(`/api/modules/${id}`).then(normalizeModuleConfig)
  },

  /** 创建模块 */
  create(
    data: Pick<CustomModuleConfig, 'name' | 'type' | 'prompt'> &
      Partial<
        Pick<
          CustomModuleConfig,
          'webSearch' | 'minHeight' | 'maxHeight' | 'enableMarkdown' | 'updateFrequency'
        >
      >
  ): Promise<CustomModuleConfig> {
    return post<unknown>('/api/modules', denormalizeModuleConfig(data)).then(normalizeModuleConfig)
  },

  /** 更新模块（PATCH 语义） */
  update(
    id: string,
    data: Partial<
      Pick<
        CustomModuleConfig,
        | 'name'
        | 'type'
        | 'prompt'
        | 'webSearch'
        | 'minHeight'
        | 'maxHeight'
        | 'enableMarkdown'
        | 'updateFrequency'
      >
    >
  ): Promise<CustomModuleConfig> {
    return requestJson<unknown>(`/api/modules/${id}`, {
      method: 'PUT',
      body: denormalizeModuleConfig(data)
    }).then(normalizeModuleConfig)
  },

  /** 删除模块 */
  async delete(id: string): Promise<void> {
    await requestVoid(`/api/modules/${id}`, { method: 'DELETE' })
  },

  /**
   * 流式刷新模块 —— 调用 Python SSE 端点，返回事件源
   *
   * 监听 'delta' 获取增量文本，'done' 获取最终结果，'error' 获取错误。
   */
  async refreshStream(
    moduleId: string,
    type: string,
    prompt: string,
    webSearch: boolean = false,
    enableMarkdown: boolean = false
  ): Promise<CustomEventSource> {
    const controller = new AbortController()
    const res = await request('/api/modules/stream', {
      method: 'POST',
      body: {
        module_id: moduleId,
        type,
        prompt,
        web_search: webSearch,
        enable_markdown: enableMarkdown
      },
      signal: controller.signal
    })
    if (!res.ok) {
      throw new Error(await readErrorMessage(res))
    }
    const reader = res.body?.getReader()
    if (!reader) throw new Error('无法读取流式响应')

    return createEventSourceFromReader(reader, { controller })
  }
}

// =============================================================================
// SSE 工具：将 ReadableStream 转换为 EventSource-like 对象
// =============================================================================

export interface CustomEventSource {
  addEventListener(event: string, listener: (data: { data: string }) => void): void
  close(): void
}

type RequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown, fallback: string = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parseJsonSafe(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return {}
  }
}

function normalizeRagChunk(raw: unknown): AgentRagChunk {
  const item = asRecord(raw)
  return {
    chunkId: asString(item.chunkId ?? item.chunk_id),
    docId: asString(item.docId ?? item.doc_id),
    docTitle: asString(item.docTitle ?? item.doc_title),
    text: asString(item.text),
    score: asNumber(item.score, 0)
  }
}

function normalizeMessage(raw: unknown): AgentMessage {
  const item = asRecord(raw)
  const ragRows = item.ragChunks ?? item.rag_chunks
  const ragChunks = Array.isArray(ragRows) ? ragRows.map(normalizeRagChunk) : []
  return {
    id: asString(item.id),
    role: (asString(item.role) || 'assistant') as AgentMessage['role'],
    content: asString(item.content),
    ragChunks: ragChunks.length ? ragChunks : undefined,
    timestamp: asNumber(item.timestamp, Date.now())
  }
}

function normalizeConversation(raw: unknown): AgentConversation {
  const item = asRecord(raw)
  const rows = item.messages
  return {
    id: asString(item.id),
    agentId: asString(item.agentId ?? item.agent_id),
    title: asString(item.title),
    messages: Array.isArray(rows) ? rows.map(normalizeMessage) : [],
    createdAt: asNumber(item.createdAt ?? item.created_at, Date.now()),
    updatedAt: asNumber(item.updatedAt ?? item.updated_at, Date.now())
  }
}

function normalizeConversationListItem(raw: unknown): ConversationListItem {
  const item = asRecord(raw)
  return {
    id: asString(item.id),
    agentId: asString(item.agentId ?? item.agent_id),
    title: asString(item.title),
    createdAt: asNumber(item.createdAt ?? item.created_at, Date.now()),
    updatedAt: asNumber(item.updatedAt ?? item.updated_at, Date.now())
  }
}

function normalizeKnowledgeBase(raw: unknown): KnowledgeBaseConfig {
  const item = asRecord(raw)
  return {
    id: asString(item.id),
    name: asString(item.name),
    docCount: asNumber(item.docCount ?? item.doc_count, 0),
    indexedAt:
      item.indexedAt === null || item.indexed_at === null
        ? null
        : asNumber(item.indexedAt ?? item.indexed_at, 0) || null
  }
}

function normalizeKnowledgeDoc(raw: unknown): AgentKnowledgeDoc {
  const item = asRecord(raw)
  return {
    id: asString(item.id),
    kbId: asString(item.kbId ?? item.kb_id),
    title: asString(item.title),
    content: asString(item.content),
    createdAt: asNumber(item.createdAt ?? item.created_at, Date.now()),
    updatedAt: asNumber(item.updatedAt ?? item.updated_at, Date.now())
  }
}

function normalizeMaxHeight(raw: unknown): number | 'auto' | undefined {
  if (raw === null || raw === undefined) return undefined
  if (raw === 'auto') return 'auto'
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  return undefined
}

function normalizeModuleConfig(raw: unknown): CustomModuleConfig {
  const item = asRecord(raw)
  return {
    id: asString(item.id),
    name: asString(item.name),
    type: (asString(item.type) || 'text') as CustomModuleConfig['type'],
    prompt: asString(item.prompt),
    createdAt: asNumber(item.createdAt ?? item.created_at, Date.now()),
    webSearch: item.webSearch !== undefined ? Boolean(item.webSearch) : Boolean(item.web_search),
    minHeight:
      item.minHeight != null
        ? asNumber(item.minHeight ?? item.min_height, 0) || undefined
        : undefined,
    maxHeight: normalizeMaxHeight(item.maxHeight ?? item.max_height),
    enableMarkdown:
      item.enableMarkdown !== undefined
        ? Boolean(item.enableMarkdown)
        : Boolean(item.enable_markdown),
    updateFrequency: (asString(item.updateFrequency ?? item.update_frequency) ||
      'realtime') as CustomModuleConfig['updateFrequency']
  }
}

function denormalizeModuleConfig(data: Partial<CustomModuleConfig>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (data.name !== undefined) out.name = data.name
  if (data.type !== undefined) out.type = data.type
  if (data.prompt !== undefined) out.prompt = data.prompt
  if (data.webSearch !== undefined) out.web_search = data.webSearch
  if (data.minHeight !== undefined) out.min_height = data.minHeight
  if (data.maxHeight !== undefined) out.max_height = data.maxHeight
  if (data.enableMarkdown !== undefined) out.enable_markdown = data.enableMarkdown
  if (data.updateFrequency !== undefined) out.update_frequency = data.updateFrequency
  return out
}

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  if (!text) return `HTTP ${res.status}`
  const payload = parseJsonSafe(text)
  return asString(asRecord(payload).error, text || `HTTP ${res.status}`)
}

async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const url = await apiUrl(path)
  return fetch(url, {
    method: options.method ?? 'GET',
    headers: Object.prototype.hasOwnProperty.call(options, 'body')
      ? { 'Content-Type': 'application/json' }
      : undefined,
    body: Object.prototype.hasOwnProperty.call(options, 'body')
      ? JSON.stringify(options.body)
      : undefined,
    signal: options.signal
  })
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await request(path, options)
  if (!res.ok) {
    throw new Error(await readErrorMessage(res))
  }
  return res.json() as Promise<T>
}

async function requestVoid(path: string, options: RequestOptions = {}): Promise<void> {
  const res = await request(path, options)
  if (!res.ok) {
    throw new Error(await readErrorMessage(res))
  }
}

function normalizeChatEventData(event: string, data: string, conversationId: string): string {
  const payload = asRecord(parseJsonSafe(data))
  if (event === 'status') {
    return JSON.stringify({
      conversationId,
      status: asString(payload.status)
    })
  }
  if (event === 'delta') {
    return JSON.stringify({
      conversationId,
      delta: asString(payload.delta)
    })
  }
  if (event === 'done') {
    const ragChunkRows = payload.ragChunks ?? payload.rag_chunks
    return JSON.stringify({
      conversationId,
      fullText: asString(payload.fullText ?? payload.full_text),
      ragChunks: Array.isArray(ragChunkRows) ? ragChunkRows.map(normalizeRagChunk) : []
    })
  }
  if (event === 'completed') {
    const assistantMessage = normalizeMessage(payload)
    return JSON.stringify({
      conversationId,
      assistantMessage,
      fullText: assistantMessage.content
    })
  }
  if (event === 'error') {
    return JSON.stringify({
      conversationId,
      message: asString(payload.message, '聊天请求失败')
    })
  }
  return data
}

function createEventSourceFromReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options?: {
    controller?: AbortController
    transformEvent?: (event: string, data: string) => string
  }
): CustomEventSource {
  const listeners: Record<string, Array<(data: { data: string }) => void>> = {}

  const source: CustomEventSource = {
    addEventListener(event: string, listener: (data: { data: string }) => void): void {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(listener)
    },
    close(): void {
      options?.controller?.abort()
      void reader.cancel().catch(() => null)
    }
  }

  const decoder = new TextDecoder()
  let buffer = ''

  function emit(event: string, data: string): void {
    const payload = options?.transformEvent ? options.transformEvent(event, data) : data
    const handlers = listeners[event] || []
    for (const handler of handlers) {
      handler({ data: payload })
    }
  }

  function processEventBlock(block: string): void {
    const lines = block.split('\n')
    let currentEvent = 'message'
    const dataLines: string[] = []
    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '')
      if (!line) continue
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim() || 'message'
        continue
      }
      if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6))
      }
    }
    if (!dataLines.length) return
    emit(currentEvent, dataLines.join('\n'))
  }

  async function read(): Promise<void> {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          processEventBlock(block)
        }
      }
    } catch (e) {
      emit('error', JSON.stringify({ message: String(e) }))
    }
  }

  read()
  return source
}

// =============================================================================
// 服务可用性检查
// =============================================================================

/** 检查 Python 服务是否可用 */
export async function isPythonServerAvailable(): Promise<boolean> {
  try {
    const port = await getPort()
    if (!port) return false
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000)
    })
    return res.ok
  } catch {
    return false
  }
}
