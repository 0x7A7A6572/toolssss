/**
 * Python 后端服务管理器
 *
 * 职责：
 * - 检测 Python 环境是否可用
 * - 管理 Python 子进程生命周期（启动、健康检查、重启、关闭）
 * - 与 Python 服务双向通信（配置推送、回调接收）
 *
 * 对应计划文件中的 "Electron ↔ Python 生命周期" 设计。
 */

import { spawn, type ChildProcess } from 'child_process'
import { createServer, type Server } from 'http'
import { join } from 'path'
import { getAiApiKeyFromSecrets, getLegacyAiApiKeyFromSecrets } from './secrets'

// =============================================================================
// 类型定义
// =============================================================================

/** Python 服务运行状态 */
export type PythonServerStatus =
  | 'stopped' // 未启动
  | 'starting' // 正在启动（等待健康检查）
  | 'running' // 正常运行
  | 'error' // 启动失败

/** Python 环境检测结果 */
export interface PythonEnvInfo {
  available: boolean
  version: string | null
  error: string | null
}

/** Python 服务管理器依赖 */
type Deps = {
  getSettings: () => import('@shared/settings').AppSettings
  getUserDataPath: () => string
}

// =============================================================================
// 常量
// =============================================================================

/** 最大重启次数 */
const MAX_RESTART_COUNT = 3

/** 健康检查轮询间隔（毫秒） */
const HEALTH_CHECK_INTERVAL_MS = 300

/** 健康检查最大等待时间（毫秒） */
const HEALTH_CHECK_TIMEOUT_MS = 15000

/** Python 关闭超时（毫秒），超时后强制 SIGKILL */
const PYTHON_SHUTDOWN_TIMEOUT_MS = 5000

/** Python 最小版本要求 */
const MIN_PYTHON_VERSION = [3, 11] as const

// =============================================================================
// 内部状态
// =============================================================================

let pythonProcess: ChildProcess | null = null
let callbackServer: Server | null = null
let callbackPort = 0
let pythonPort = 0
let status: PythonServerStatus = 'stopped'
let restartCount = 0
let restartTimer: ReturnType<typeof setTimeout> | null = null
let deps: Deps | null = null

// =============================================================================
// 环境检测
// =============================================================================

/**
 * 检测系统 Python 环境是否可用
 * 尝试多个可能的命令名称（python, python3）
 */
export async function detectPythonEnv(): Promise<PythonEnvInfo> {
  for (const cmd of ['python', 'python3']) {
    try {
      const version = await runPythonVersion(cmd)
      if (version) {
        const parts = version.split('.')
        const major = parseInt(parts[0], 10)
        const minor = parseInt(parts[1], 10)
        if (
          major > MIN_PYTHON_VERSION[0] ||
          (major === MIN_PYTHON_VERSION[0] && minor >= MIN_PYTHON_VERSION[1])
        ) {
          return { available: true, version, error: null }
        }
        return {
          available: false,
          version,
          error: `Python 版本 ${version} 低于要求 ${MIN_PYTHON_VERSION[0]}.${MIN_PYTHON_VERSION[1]}+`
        }
      }
    } catch {
      // 命令不存在，尝试下一个
    }
  }
  return {
    available: false,
    version: null,
    error: '未找到 Python 3.11+ 环境，请安装 Python 后重试'
  }
}

/** 执行 python --version 并解析版本号 */
function runPythonVersion(command: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, ['--version'], { windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`exit code ${code}`))
        return
      }
      // Python 2 的 --version 输出到 stderr
      const output = (stdout + stderr).trim()
      const match = output.match(/Python\s+(\d+\.\d+\.\d+)/)
      resolve(match ? match[1] : null)
    })
  })
}

// =============================================================================
// 端口管理
// =============================================================================

/** 查找可用端口 */
async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = require('net').createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

// =============================================================================
// 回调 HTTP 服务器
// =============================================================================

/**
 * 启动本地回调服务器
 * Python 通过此接口请求 Electron 写入配置
 */
function startCallbackServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    callbackServer = createServer((req, res) => {
      // POST /internal/config-callback —— Python 请求写入配置
      if (req.url === '/internal/config-callback' && req.method === 'POST') {
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as {
              action: string
              [key: string]: unknown
            }
            handleConfigCallback(payload)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ status: 'ok' }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: '无效的请求体' }))
          }
        })
        return
      }

      // POST /internal/mouse-hook —— 鼠标钩子事件
      if (req.url === '/internal/mouse-hook' && req.method === 'POST') {
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as { action: string; deltaY: number; startX: number; startY: number }
            if (onMouseHookEvent) {
              onMouseHookEvent(payload)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ status: 'ok' }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: '无效的请求体' }))
          }
        })
        return
      }

      res.writeHead(404)
      res.end()
    })

    callbackServer.listen(0, '127.0.0.1', () => {
      const addr = callbackServer!.address()
      if (addr && typeof addr === 'object') {
        callbackPort = addr.port
      }
      resolve(callbackPort)
    })
    callbackServer.on('error', reject)
  })
}

/** 处理 Python 发来的配置回调 */
function handleConfigCallback(payload: { action: string; [key: string]: unknown }): void {
  if (!deps) return

  const settings = deps.getSettings()

  switch (payload.action) {
    case 'updateKnowledgeBase': {
      const kbId = typeof payload.kbId === 'string' ? payload.kbId : ''
      const fields = payload.fields as Record<string, unknown> | undefined
      if (!kbId || !fields) break

      const updatedBases = settings.agents.knowledgeBases.map((item) =>
        item.id === kbId ? { ...item, ...fields } : item
      )

      // 通过 commitSettings 写入（由外部注入）
      if (onConfigWrite) {
        onConfigWrite({
          agents: {
            ...settings.agents,
            knowledgeBases: updatedBases
          }
        } as Partial<import('@shared/settings').AppSettings>)
      }
      break
    }
    case 'updateAgentConfig': {
      const agentId = typeof payload.agentId === 'string' ? payload.agentId : ''
      const fields = payload.fields as Record<string, unknown> | undefined
      if (!agentId || !fields) break

      const updatedConfigs = settings.agents.configs.map((item) =>
        item.id === agentId ? { ...item, ...fields } : item
      )

      if (onConfigWrite) {
        onConfigWrite({
          agents: {
            ...settings.agents,
            configs: updatedConfigs
          }
        } as Partial<import('@shared/settings').AppSettings>)
      }
      break
    }
  }
}

/** 配置写入回调（由外部注入 commitSettings） */
let onConfigWrite: ((patch: Partial<import('@shared/settings').AppSettings>) => void) | null = null

/** 鼠标钩子事件回调（由外部注入） */
let onMouseHookEvent: ((event: { action: string; deltaY: number; startX: number; startY: number }) => void) | null = null

// =============================================================================
// Python 进程管理
// =============================================================================

/**
 * 启动 Python 后端服务
 *
 * @returns Python 服务的监听端口，失败返回 0
 */
export async function startPythonServer(
  dependencies: Deps,
  commitSettings: (next: import('@shared/settings').AppSettings) => void
): Promise<number> {
  deps = dependencies

  // 注入配置写入回调（保持设置权威源在 Electron）
  onConfigWrite = (patch) => {
    const current = deps!.getSettings()
    // 使用 structuredClone + 浅合并，保持类型安全
    const merged: import('@shared/settings').AppSettings = {
      ...current,
      ...patch,
      agents: patch.agents
        ? {
            ...current.agents,
            ...patch.agents,
            knowledgeBases: patch.agents.knowledgeBases ?? current.agents.knowledgeBases,
            configs: patch.agents.configs ?? current.agents.configs,
            rag: patch.agents.rag ?? current.agents.rag
          }
        : current.agents
    }
    commitSettings(merged)
  }

  // 检测环境
  const env = await detectPythonEnv()
  if (!env.available) {
    console.error('[PythonServer] 环境检测失败:', env.error)
    status = 'error'
    return 0
  }
  console.log('[PythonServer] Python 环境:', env.version)

  // 查找可用端口
  pythonPort = await findAvailablePort()
  console.log('[PythonServer] 分配端口:', pythonPort)

  // 启动回调服务器
  await startCallbackServer()
  console.log('[PythonServer] 回调端口:', callbackPort)

  // 启动 Python 进程
  const started = await spawnPythonProcess()
  if (!started) {
    status = 'error'
    return 0
  }

  status = 'running'
  // 推送初始配置
  await pushConfigToPython()
  restartCount = 0
  return pythonPort
}

/** 启动 Python 子进程 */
async function spawnPythonProcess(): Promise<boolean> {
  if (!deps) return false

  const serverDir = join(__dirname, '../../server')
  const pythonCmd = await findPythonCommand()
  if (!pythonCmd) return false

  status = 'starting'

  pythonProcess = spawn(
    pythonCmd,
    [
      'main.py',
      '--port',
      String(pythonPort),
      '--host',
      '127.0.0.1',
      '--user-data-path',
      deps.getUserDataPath()
    ],
    {
      cwd: serverDir,
      windowsHide: true,
      env: {
        ...process.env,
        FS_CALLBACK_PORT: String(callbackPort),
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      }
    }
  )

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString().trim()
    if (text) console.log('[PythonServer]', text)
  })

  pythonProcess.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim()
    if (text) console.error('[PythonServer:err]', text)
  })

  pythonProcess.on('error', (err) => {
    console.error('[PythonServer] 进程错误:', err.message)
    status = 'error'
    scheduleRestart()
  })

  pythonProcess.on('exit', (code, signal) => {
    console.log('[PythonServer] 进程退出, code:', code, 'signal:', signal)
    pythonProcess = null
    const wasActive = status === 'running' || status === 'starting'
    if (wasActive) {
      status = 'error'
      scheduleRestart()
    }
  })

  // 等待健康检查通过
  return await waitForHealth()
}

/** 查找可用的 Python 命令 */
async function findPythonCommand(): Promise<string | null> {
  for (const cmd of ['python', 'python3']) {
    try {
      const version = await runPythonVersion(cmd)
      if (version) return cmd
    } catch {
      // 继续尝试
    }
  }
  return null
}

/** 轮询等待健康检查通过 */
function waitForHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now()
    const http = require('http') as typeof import('http')
    let settled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let activeRequest: import('http').ClientRequest | null = null

    function finish(result: boolean): void {
      if (settled) return
      settled = true
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      if (activeRequest) {
        activeRequest.setTimeout(0)
        activeRequest = null
      }
      resolve(result)
    }

    function scheduleNextCheck(): void {
      if (settled || retryTimer) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        check()
      }, HEALTH_CHECK_INTERVAL_MS)
    }

    function check(): void {
      if (settled) return
      const elapsedMs = Date.now() - startTime
      if (elapsedMs > HEALTH_CHECK_TIMEOUT_MS) {
        console.error('[PythonServer] 健康检查超时')
        finish(false)
        return
      }

      activeRequest = http.get(
        `http://127.0.0.1:${pythonPort}/health`,
        { timeout: 2000 },
        (res: import('http').IncomingMessage) => {
          activeRequest = null
          res.resume()
          if (settled) return
          if (res.statusCode === 200) {
            finish(true)
            return
          }
          scheduleNextCheck()
        }
      )
      activeRequest.on('error', () => {
        activeRequest = null
        if (settled) return
        scheduleNextCheck()
      })
      activeRequest.on('timeout', () => {
        activeRequest?.destroy()
        activeRequest = null
        if (settled) return
        scheduleNextCheck()
      })
    }

    // 首次检查延迟 500ms，给 Python 启动时间
    retryTimer = setTimeout(() => {
      retryTimer = null
      check()
    }, 500)
  })
}

// =============================================================================
// 配置同步
// =============================================================================

/**
 * 向 Python 服务推送最新配置
 */
export async function pushConfigToPython(): Promise<void> {
  if ((status !== 'running' && status !== 'starting') || !pythonPort || !deps) return

  const http = require('http') as typeof import('http')
  const settings = deps.getSettings()
  const userDataPath = deps.getUserDataPath()
  const aiApiKeys: Record<string, string> = {}

  // 解析当前激活的 API Key（优先按 profileId 查找，回退到兼容旧版单一 key）
  let apiKey = ''
  let legacyAiApiKey = ''
  try {
    apiKey = getAiApiKeyFromSecrets(settings.ai.activeProfileId) ?? ''
    // 如果多 profile 没找到，尝试旧版单一 key
    if (!apiKey) {
      legacyAiApiKey = getLegacyAiApiKeyFromSecrets() ?? ''
      apiKey = legacyAiApiKey
    }
  } catch {
    void 0
  }

  for (const profile of settings.ai.profiles) {
    const profileId = profile.id.trim()
    if (!profileId) continue
    const profileApiKey = getAiApiKeyFromSecrets(profileId)?.trim() ?? ''
    if (profileApiKey) {
      aiApiKeys[profileId] = profileApiKey
    }
  }
  if (
    settings.ai.activeProfileId.trim() &&
    apiKey &&
    !aiApiKeys[settings.ai.activeProfileId.trim()]
  ) {
    aiApiKeys[settings.ai.activeProfileId.trim()] = apiKey
  } else if (settings.ai.activeProfileId.trim() && legacyAiApiKey) {
    aiApiKeys[settings.ai.activeProfileId.trim()] = legacyAiApiKey
  }

  const payload = JSON.stringify({
    ai: settings.ai,
    agents: settings.agents,
    translate: settings.translate,
    fun_fact: settings.funFact,
    user_data_path: userDataPath,
    callback_port: callbackPort,
    api_key: apiKey,
    ai_api_keys: aiApiKeys
  })

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: pythonPort,
        path: '/config',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 5000
      },
      (res: import('http').IncomingMessage) => {
        if (res.statusCode === 200) {
          console.log('[PythonServer] 配置已推送')
        } else {
          console.error('[PythonServer] 配置推送失败, status:', res.statusCode)
        }
        resolve()
      }
    )
    req.on('error', (err: Error) => {
      console.error('[PythonServer] 配置推送错误:', err.message)
      resolve()
    })
    req.on('timeout', () => {
      req.destroy()
      resolve()
    })
    req.write(payload)
    req.end()
  })
}

// =============================================================================
// 崩溃重启
// =============================================================================

/** 调度重启 */
function scheduleRestart(): void {
  if (restartTimer) return

  restartCount++
  if (restartCount > MAX_RESTART_COUNT) {
    console.error(`[PythonServer] 已重启 ${MAX_RESTART_COUNT} 次，放弃`)
    return
  }

  const delay = Math.min(1000 * restartCount, 5000)
  console.log(`[PythonServer] 将在 ${delay}ms 后第 ${restartCount} 次重启`)
  restartTimer = setTimeout(async () => {
    restartTimer = null
    const s = status
    if (s !== 'error') return
    console.log('[PythonServer] 尝试重启...')
    await spawnPythonProcess()
    if (status === 'running') {
      await pushConfigToPython()
      restartCount = 0
    }
  }, delay)
}

// =============================================================================
// 优雅关闭
// =============================================================================

/**
 * 停止 Python 后端服务
 */
export async function stopPythonServer(): Promise<void> {
  // 清理重启定时器
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }

  // 关闭回调服务器
  if (callbackServer) {
    await new Promise<void>((resolve) => {
      callbackServer!.close(() => resolve())
    })
    callbackServer = null
  }

  // 优雅关闭 Python 进程
  if (pythonProcess && !pythonProcess.killed) {
    // 先尝试发送配置保存 + 优雅关闭请求
    try {
      await httpPost(`http://127.0.0.1:${pythonPort}/shutdown`)
    } catch {
      // 忽略，走 SIGTERM
    }

    const killed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        // 超时，强制 SIGKILL
        try {
          pythonProcess?.kill('SIGKILL')
        } catch {
          void 0
        }
        resolve(false)
      }, PYTHON_SHUTDOWN_TIMEOUT_MS)

      pythonProcess!.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })

      // 发送 SIGTERM
      try {
        pythonProcess!.kill('SIGTERM')
      } catch {
        clearTimeout(timer)
        resolve(false)
      }
    })

    if (killed) {
      console.log('[PythonServer] 优雅关闭完成')
    } else {
      console.log('[PythonServer] 强制关闭完成')
    }
  }

  pythonProcess = null
  status = 'stopped'
}

// =============================================================================
// 状态查询
// =============================================================================

/** 获取 Python 服务当前端口（供渲染进程使用） */
export function getPythonPort(): number {
  return pythonPort
}

/** 获取 Electron 回调服务器端口（供 main 进程 domain 使用） */
export function getCallbackPort(): number {
  return callbackPort
}

/** 获取 Python 服务运行状态 */
export function getPythonServerStatus(): PythonServerStatus {
  return status
}

/** 注册鼠标钩子事件回调 */
export function setMouseHookCallback(
  cb: ((event: { action: string; deltaY: number; startX: number; startY: number }) => void) | null
): void {
  onMouseHookEvent = cb
}

// =============================================================================
// 工具函数
// =============================================================================

/** 浅层 HTTP POST（不关心响应体） */
function httpPost(url: string, body?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const http = require('http') as typeof import('http')
    const req = http.request(
      url,
      { method: 'POST', timeout: 2000 },
      (res: import('http').IncomingMessage) => {
        res.resume()
        res.on('end', resolve)
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    if (body) req.write(body)
    req.end()
  })
}
