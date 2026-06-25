/**
 * Agent Python API 包装层
 *
 * 统一封装智能体相关的 Python API 调用。
 * 如果 Python 服务不可用，直接抛错。
 */

import { agentApi, knowledgeBaseApi, moduleApi, isPythonServerAvailable } from '@renderer/utils/python-api'

let pythonReady = false
let detectPromise: Promise<void> | null = null
const limitRetry: number = 3
let tryCount: number = 0

async function ensurePythonReady(force: boolean = false): Promise<void> {
  if (limitRetry <= tryCount)
    throw new Error('Python 智能体服务不可用，请先确认 Python 后端已正常启动')
  if (pythonReady && !force) return
  if (detectPromise && !force) return detectPromise
  detectPromise = (async () => {
    try {
      pythonReady = await isPythonServerAvailable()
    } catch {
      tryCount += 1
      pythonReady = false
    }
  })()
  await detectPromise
  if (pythonReady) return
  await ensurePythonReady(true)
  if (pythonReady) return
  throw new Error('Python 智能体服务不可用，请先确认 Python 后端已正常启动')
}

export type AgentBackend = typeof agentApi &
  Omit<typeof knowledgeBaseApi, keyof typeof moduleApi> &
  typeof moduleApi

// =============================================================================
// Composable
// =============================================================================

export function useAgentBackend(): AgentBackend {
  void ensurePythonReady()

  // ---- 对话 API ----

  return {
    // 对话 CRUD
    ...agentApi,
    // 知识库 CRUD
    ...knowledgeBaseApi,
    // 自定义模块 CRUD
    ...moduleApi
  }
}
