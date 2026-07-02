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

import { spawn, type ChildProcess, execSync } from 'child_process'
import { app } from 'electron'
import { join } from 'path'
import { platform } from 'os'
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
  /** 健康检查每次尝试时回调，用于外部显示启动进度 */
  onHealthCheckAttempt?: (attempt: number, max: number) => void
}

// =============================================================================
// 常量
// =============================================================================

/** 最大重启次数 */
const MAX_RESTART_COUNT = 3

/** 健康检查尝试次数 */
const HEALTH_CHECK_MAX_ATTEMPTS = 3

/** 单次健康检查超时（毫秒） */
const HEALTH_CHECK_PER_ATTEMPT_TIMEOUT_MS = 5000

/** Python 关闭超时（毫秒），超时后强制 SIGKILL */
const PYTHON_SHUTDOWN_TIMEOUT_MS = 5000

/** Python 最小版本要求 */
const MIN_PYTHON_VERSION = [3, 11] as const

// =============================================================================
// 内部状态
// =============================================================================

let pythonProcess: ChildProcess | null = null
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

/** Python 服务固定端口 */
const PYTHON_PORT = 8710

// =============================================================================
// Python 进程管理
// =============================================================================

/**
 * 检查端口是否被占用，如果被 Python 进程占用则尝试释放
 *
 * 场景：VS Code 停止调试时，Electron 主进程被强制终止，
 * 但 Python 子进程在 Windows 上不会自动退出，端口仍被占用。
 * 启动前主动清理，避免 "端口被占用" 错误。
 */
async function ensurePortFree(port: number): Promise<void> {
  const pid = findPidByPort(port)
  if (!pid) return

  const isPython = isProcessPython(pid)
  console.log(
    `[PythonServer] 端口 ${port} 被占用 (PID: ${pid}, ${isPython ? '疑似上次残留的 Python 进程' : '未知进程'})`
  )

  if (!isPython) {
    // 不是 Python 进程，不强制终止，让正常的端口冲突错误处理
    console.warn(`[PythonServer] 端口 ${port} 被非 Python 进程占用，跳过清理`)
    return
  }

  try {
    console.log(`[PythonServer] 正在终止残留进程 PID: ${pid}...`)
    if (platform() === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { windowsHide: true })
    } else {
      process.kill(pid, 'SIGKILL')
    }
    // 等待端口释放
    await new Promise((resolve) => setTimeout(resolve, 500))
    console.log(`[PythonServer] 残留进程已终止，端口 ${port} 已释放`)
  } catch (err) {
    console.warn(`[PythonServer] 终止残留进程失败:`, err)
  }
}

/** 查找占用指定端口的进程 PID */
function findPidByPort(port: number): number | null {
  try {
    if (platform() === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port}`, {
        windowsHide: true,
        encoding: 'utf-8'
      })
      // netstat 输出格式: TCP    127.0.0.1:8710    0.0.0.0:0    LISTENING    12345
      const lines = output.trim().split(/\r?\n/)
      for (const line of lines) {
        // 只匹配 LISTENING 状态的行
        if (!line.includes('LISTENING')) continue
        const parts = line.trim().split(/\s+/)
        const pidStr = parts[parts.length - 1]
        const pid = parseInt(pidStr, 10)
        if (!isNaN(pid) && pid > 0) return pid
      }
      return null
    }
    // macOS / Linux
    try {
      const output = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf-8' })
      const pid = parseInt(output.trim(), 10)
      return isNaN(pid) ? null : pid
    } catch {
      return null
    }
  } catch {
    return null
  }
}

/** 检查进程是否为 Python */
function isProcessPython(pid: number): boolean {
  try {
    if (platform() === 'win32') {
      const output = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        windowsHide: true,
        encoding: 'utf-8'
      })
      const lowered = output.toLowerCase()
      return lowered.includes('python') || lowered.includes('python3')
    }
    try {
      const output = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf-8' })
      const name = output.trim().toLowerCase()
      return name.includes('python')
    } catch {
      return false
    }
  } catch {
    return false
  }
}

/**
 * 启动 Python 后端服务
 *
 * @returns Python 服务的监听端口，失败返回 0
 */
export async function startPythonServer(dependencies: Deps): Promise<number> {
  deps = dependencies

  // 检测环境
  const env = await detectPythonEnv()
  if (!env.available) {
    console.error('[PythonServer] 环境检测失败:', env.error)
    status = 'error'
    return 0
  }
  console.log('[PythonServer] Python 环境:', env.version)

  // 端口固定使用 8710，启动前清理可能残留的进程（调试停止时子进程可能未被终止）
  pythonPort = PYTHON_PORT
  await ensurePortFree(pythonPort)
  console.log('[PythonServer] 端口:', pythonPort)

  // 启动 Python 进程
  const started = await spawnPythonProcess()
  if (!started) {
    status = 'error'
    return 0
  }

  status = 'running'
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

  const args = ['main.py', '--port', String(pythonPort), '--host', '127.0.0.1']

  // 开发模式下开启 debug（/docs、debug 日志）
  if (!app.isPackaged) {
    args.push('--debug')
  }

  pythonProcess = spawn(pythonCmd, args, {
    cwd: serverDir,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8'
    }
  })

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
  return await waitForHealth(deps?.onHealthCheckAttempt)
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

/** 尝试 3 次健康检查，每次 5 秒超时，总共最多 15 秒 */
function waitForHealth(onAttempt?: (attempt: number, max: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const http = require('http') as typeof import('http')
    let attempts = 0

    function tryOnce(): void {
      attempts++
      onAttempt?.(attempts, HEALTH_CHECK_MAX_ATTEMPTS)
      console.log(`[PythonServer] 健康检查 (${attempts}/${HEALTH_CHECK_MAX_ATTEMPTS})...`)

      const req = http.get(
        `http://127.0.0.1:${pythonPort}/health`,
        { timeout: HEALTH_CHECK_PER_ATTEMPT_TIMEOUT_MS },
        (res: import('http').IncomingMessage) => {
          res.resume()
          if (res.statusCode === 200) {
            console.log('[PythonServer] 健康检查通过')
            resolve(true)
            return
          }
          nextOrFail()
        }
      )
      req.on('error', () => nextOrFail())
      req.on('timeout', () => {
        req.destroy()
        nextOrFail()
      })
    }

    function nextOrFail(): void {
      if (attempts >= HEALTH_CHECK_MAX_ATTEMPTS) {
        console.error('[PythonServer] 健康检查超时，已达最大尝试次数')
        resolve(false)
        return
      }
      setTimeout(tryOnce, HEALTH_CHECK_PER_ATTEMPT_TIMEOUT_MS)
    }

    tryOnce()
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

/** 获取 Python 服务运行状态 */
export function getPythonServerStatus(): PythonServerStatus {
  return status
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
