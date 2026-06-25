/**
 * Agent Python API 包装层
 *
 * 统一封装智能体相关的 Python API 调用。
 * 如果 Python 服务不可用，直接抛错。
 */

import { agentApi, knowledgeBaseApi, isPythonServerAvailable } from '@renderer/utils/python-api'

let pythonReady = false
let detectPromise: Promise<void> | null = null

async function ensurePythonReady(force: boolean = false): Promise<void> {
  if (pythonReady && !force) return
  if (detectPromise && !force) return detectPromise
  detectPromise = (async () => {
    try {
      pythonReady = await isPythonServerAvailable()
    } catch {
      pythonReady = false
    }
  })()
  await detectPromise
  if (pythonReady) return
  await ensurePythonReady(true)
  if (pythonReady) return
  throw new Error('Python 智能体服务不可用，请先确认 Python 后端已正常启动')
}

export type AgentBackend = typeof agentApi & typeof knowledgeBaseApi

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
    ...knowledgeBaseApi
  }
}
