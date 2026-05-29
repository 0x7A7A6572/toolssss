import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'

interface McpJsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface McpJsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

let nextId = 1
let mcpProcess: ChildProcess | null = null
let shutdownTimer: ReturnType<typeof setTimeout> | null = null
let pendingReject: ((reason: unknown) => void) | null = null

let stderrBuf = ''

function getNextId(): number {
  return nextId++
}

function safeKill(proc: ChildProcess): void {
  if (!proc.killed) {
    try {
      proc.kill()
    } catch {
      void 0
    }
  }
}

function spawnMcpServer(command: string): ChildProcess {
  const parts = command.trim().split(/\s+/)
  const cmd = parts[0] ?? ''
  const args = parts.slice(1)

  const proc = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true
  })

  stderrBuf = ''
  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stderrBuf += text
  })

  proc.on('exit', (code, sig) => {
    if (proc !== mcpProcess) return
    const reason = sig
      ? `进程被信号 ${sig} 终止`
      : code !== null
        ? `进程退出 (code: ${code})`
        : '进程未知退出'
    if (code !== 0) {
      const errMsg = `MCP ${reason}${stderrBuf ? `\nstderr: ${stderrBuf.trim()}` : ''}`
      console.error('[MCP]', errMsg)
      const rej = pendingReject
      pendingReject = null
      rej?.(new Error(errMsg))
    }
  })

  proc.on('error', (err) => {
    if (proc !== mcpProcess) return
    const errMsg = `MCP 启动失败: ${err.message}${stderrBuf ? `\nstderr: ${stderrBuf.trim()}` : ''}`
    console.error('[MCP]', errMsg)
    const rej = pendingReject
    pendingReject = null
    rej?.(new Error(errMsg))
  })

  return proc
}

function sendRequest(proc: ChildProcess, method: string, params?: Record<string, unknown>): number {
  const id = getNextId()
  const request: McpJsonRpcRequest = { jsonrpc: '2.0', id, method, params }
  const line = JSON.stringify(request) + '\n'
  if (proc.stdin?.writable && !proc.killed) {
    proc.stdin.write(line)
  }
  return id
}

function waitForResponse(
  proc: ChildProcess,
  targetId: number,
  signal: AbortSignal
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pendingReject = reject

    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity })

    const cleanup = (): void => {
      if (pendingReject === reject) pendingReject = null
      rl.close()
      rl.removeAllListeners()
    }

    const abortHandler = (): void => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abortHandler, { once: true })

    rl.on('line', (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return

      try {
        const parsed = JSON.parse(trimmed) as McpJsonRpcResponse
        if (parsed.id === targetId) {
          cleanup()
          signal.removeEventListener('abort', abortHandler)
          if (parsed.error) {
            reject(new Error(`MCP 返回错误: ${parsed.error.message}`))
          } else {
            resolve(parsed.result)
          }
        }
      } catch {
        /* not JSON, skip */
      }
    })

    rl.on('error', (err) => {
      cleanup()
      signal.removeEventListener('abort', abortHandler)
      reject(new Error(`MCP 读取错误: ${err.message}`))
    })
  })
}

interface ParsedSearchResult {
  text: string
  resultCount: number
  sources: string[]
}

function tryParseSearchResultsJson(text: string): ParsedSearchResult | null {
  try {
    const cleaned = text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()
    const data = JSON.parse(cleaned) as {
      results?: Array<{ title?: string; url?: string; excerpts?: string[] }>
    }
    const results = data?.results
    if (!Array.isArray(results) || results.length === 0) return null
    const lines: string[] = []
    const sources: string[] = []
    for (const r of results) {
      if (r.title) lines.push(`标题: ${r.title.trim()}`)
      if (r.url) {
        lines.push(`链接: ${r.url.trim()}`)
        try {
          const url = new URL(r.url.trim())
          if (url.hostname) sources.push(url.hostname)
        } catch {
          sources.push(r.url.trim())
        }
      }
      if (Array.isArray(r.excerpts) && r.excerpts.length > 0) {
        const excerpt = r.excerpts
          .map((e) => e.replace(/\\n/g, ' ').trim())
          .filter(Boolean)
          .join(' ')
        if (excerpt) lines.push(`摘要: ${excerpt}`)
      }
      lines.push('---')
    }
    const out = lines.join('\n')
    if (out.length <= 50) return null
    return { text: out, resultCount: results.length, sources }
  } catch {
    return null
  }
}

export interface McpSearchResult {
  text: string
  resultCount: number
  sources: string[]
}

export async function runMcpSearch(
  command: string,
  objective: string,
  searchQueries: string[],
  signal: AbortSignal
): Promise<McpSearchResult> {
  if (!command.trim()) throw new Error('未配置 MCP 搜索命令')

  if (mcpProcess && !mcpProcess.killed) {
    safeKill(mcpProcess)
    mcpProcess = null
  }
  if (shutdownTimer) {
    clearTimeout(shutdownTimer)
    shutdownTimer = null
  }

  const proc = spawnMcpServer(command)
  mcpProcess = proc

  try {
    const initId = sendRequest(proc, 'initialize', {
      protocolVersion: '2024-11-20',
      capabilities: {},
      clientInfo: { name: 'freamx', version: '1.0' }
    })

    await waitForResponse(proc, initId, signal)
    console.log('[MCP] initialized successfully')

    const listId = sendRequest(proc, 'tools/list', {})
    const toolsResult = (await waitForResponse(proc, listId, signal)) as {
      tools?: Array<{ name: string }>
    }
    if (toolsResult?.tools && Array.isArray(toolsResult.tools)) {
      const names = toolsResult.tools.map((t) => t.name).join(', ')
      console.log(`[MCP] available tools: ${names}`)
    }

    const searchId = sendRequest(proc, 'tools/call', {
      name: 'web_search',
      arguments: {
        objective,
        search_queries: searchQueries
      }
    })

    const raw = (await waitForResponse(proc, searchId, signal)) as {
      content?: Array<{ type?: string; text?: string }>
    }

    const content = raw?.content
    if (!Array.isArray(content) || content.length === 0) {
      return { text: '', resultCount: 0, sources: [] }
    }

    const texts: string[] = []
    let totalResultCount = 0
    const allSources = new Set<string>()
    const seenHostnames = new Set<string>()

    for (const block of content) {
      if (!block?.text) continue
      const trimmed = block.text.trim()
      if (!trimmed) continue
      const parsed = tryParseSearchResultsJson(trimmed)
      if (parsed) {
        texts.push(parsed.text)
        totalResultCount += parsed.resultCount
        for (const src of parsed.sources) {
          if (!seenHostnames.has(src)) {
            seenHostnames.add(src)
            allSources.add(src)
          }
        }
      } else {
        texts.push(trimmed)
      }
    }

    console.log(
      `[MCP] search returned ${texts.length} text blocks, ${totalResultCount} total results`
    )
    return {
      text: texts.join('\n\n'),
      resultCount: totalResultCount,
      sources: Array.from(allSources)
    }
  } finally {
    pendingReject = null
    safeKill(proc)
    mcpProcess = null
    shutdownTimer = setTimeout(() => {
      shutdownTimer = null
    }, 1000)
  }
}

export function killMcpProcess(): void {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer)
    shutdownTimer = null
  }
  if (mcpProcess && !mcpProcess.killed) {
    safeKill(mcpProcess)
    mcpProcess = null
  }
  pendingReject = null
}
