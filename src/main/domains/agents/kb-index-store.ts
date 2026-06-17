import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface IndexedKnowledgeChunk {
  id: string
  kbId: string
  docId: string
  docTitle: string
  text: string
  index: number
  embedding: number[]
}

export interface KnowledgeBaseIndex {
  kbId: string
  indexedAt: number | null
  chunks: IndexedKnowledgeChunk[]
}

function knowledgeBasesRootDir(baseDir?: string): string {
  return baseDir?.trim() || join(app.getPath('userData'), 'agents', 'knowledge-bases')
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function kbDir(rootDir: string, kbId: string): string {
  return join(rootDir, kbId)
}

function indexFilePath(rootDir: string, kbId: string): string {
  return join(kbDir(rootDir, kbId), 'vector-index.json')
}

export function loadKnowledgeBaseIndex(kbId: string, baseDir?: string): KnowledgeBaseIndex {
  const rootDir = knowledgeBasesRootDir(baseDir)
  const filePath = indexFilePath(rootDir, kbId)
  if (!existsSync(filePath)) {
    return { kbId, indexedAt: null, chunks: [] }
  }
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as KnowledgeBaseIndex
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.chunks)) {
      return { kbId, indexedAt: null, chunks: [] }
    }
    return {
      kbId,
      indexedAt: typeof parsed.indexedAt === 'number' ? parsed.indexedAt : null,
      chunks: parsed.chunks
    }
  } catch {
    return { kbId, indexedAt: null, chunks: [] }
  }
}

export function saveKnowledgeBaseIndex(index: KnowledgeBaseIndex, baseDir?: string): void {
  const rootDir = knowledgeBasesRootDir(baseDir)
  ensureDir(kbDir(rootDir, index.kbId))
  writeFileSync(indexFilePath(rootDir, index.kbId), JSON.stringify(index), 'utf-8')
}
