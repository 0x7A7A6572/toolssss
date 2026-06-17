// 对话文件持久化存储
// 存储路径：userData/agents/conversations/{id}.json

import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { AgentConversation } from '@shared/agents'

/** 对话文件存储目录 */
function conversationsDir(): string {
  return join(app.getPath('userData'), 'agents', 'conversations')
}

/** 确保存储目录存在 */
function ensureDir(): void {
  const dir = conversationsDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/** 对话文件路径 */
function conversationFilePath(id: string): string {
  return join(conversationsDir(), `${id}.json`)
}

/** 生成唯一 ID */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

/** 列出所有对话，按更新时间降序 */
export function listConversations(): AgentConversation[] {
  ensureDir()
  const dir = conversationsDir()
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  return files
    .map((f) => loadConversation(f.replace(/\.json$/, '')))
    .filter((c): c is AgentConversation => c !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 加载单个对话 */
export function loadConversation(id: string): AgentConversation | null {
  try {
    const raw = readFileSync(conversationFilePath(id), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const conv = parsed as AgentConversation
    // 基本结构校验
    if (
      typeof conv.id !== 'string' ||
      typeof conv.agentId !== 'string' ||
      !Array.isArray(conv.messages)
    ) {
      return null
    }
    return conv
  } catch {
    return null
  }
}

/** 保存对话 */
export function saveConversation(conv: AgentConversation): void {
  ensureDir()
  conv.updatedAt = Date.now()
  writeFileSync(conversationFilePath(conv.id), JSON.stringify(conv), 'utf-8')
}

/** 删除对话 */
export function deleteConversation(id: string): boolean {
  try {
    unlinkSync(conversationFilePath(id))
    return true
  } catch {
    return false
  }
}
