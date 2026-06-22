import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentKnowledgeDoc, KnowledgeBaseConfig } from '@shared/agents'

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function indexFilePath(rootDir: string): string {
  return join(rootDir, 'index.json')
}

function docsDir(rootDir: string, kbId: string): string {
  return join(rootDir, kbId, 'docs')
}

function docFilePath(rootDir: string, kbId: string, docId: string): string {
  return join(docsDir(rootDir, kbId), `${docId}.json`)
}

function normalizeLegacyKnowledgeBase(input: unknown): KnowledgeBaseConfig | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : ''
  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : ''
  if (!id || !name) return null
  return {
    id,
    name,
    docCount: Array.isArray(raw['docs']) ? raw['docs'].length : 0,
    indexedAt: typeof raw['indexedAt'] === 'number' ? raw['indexedAt'] : null
  }
}

function normalizeKnowledgeBaseRecord(input: unknown): KnowledgeBaseConfig | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : ''
  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : ''
  if (!id || !name) return null
  return {
    id,
    name,
    docCount: typeof raw['docCount'] === 'number' ? raw['docCount'] : 0,
    indexedAt: typeof raw['indexedAt'] === 'number' ? raw['indexedAt'] : null
  }
}

function normalizeLegacyKnowledgeDoc(input: unknown, kbId: string): AgentKnowledgeDoc | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : ''
  const title = typeof raw['title'] === 'string' ? raw['title'].trim() : ''
  const content = typeof raw['content'] === 'string' ? raw['content'] : ''
  if (!id || !title) return null
  return {
    id,
    kbId,
    title,
    content,
    createdAt: typeof raw['createdAt'] === 'number' ? raw['createdAt'] : Date.now(),
    updatedAt: typeof raw['updatedAt'] === 'number' ? raw['updatedAt'] : Date.now()
  }
}

function readKnowledgeBaseIndex(rootDir: string): KnowledgeBaseConfig[] {
  ensureDir(rootDir)
  const filePath = indexFilePath(rootDir)
  if (!existsSync(filePath)) return []
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => normalizeKnowledgeBaseRecord(item))
      .filter((item): item is KnowledgeBaseConfig => item !== null)
  } catch {
    return []
  }
}

function writeKnowledgeBaseIndex(rootDir: string, knowledgeBases: KnowledgeBaseConfig[]): void {
  ensureDir(rootDir)
  writeFileSync(indexFilePath(rootDir), JSON.stringify(knowledgeBases), 'utf-8')
}

function upsertKnowledgeBase(rootDir: string, kb: KnowledgeBaseConfig): void {
  ensureDir(docsDir(rootDir, kb.id))
  const knowledgeBases = readKnowledgeBaseIndex(rootDir)
  const existing = knowledgeBases.find((item) => item.id === kb.id)
  const next: KnowledgeBaseConfig = existing
    ? {
        ...existing,
        name: kb.name,
        docCount: Math.max(existing.docCount, kb.docCount),
        indexedAt: existing.indexedAt ?? kb.indexedAt
      }
    : kb
  const updated = existing
    ? knowledgeBases.map((item) => (item.id === kb.id ? next : item))
    : [...knowledgeBases, next]
  writeKnowledgeBaseIndex(rootDir, updated)
}

function saveKnowledgeDocument(rootDir: string, kbId: string, doc: AgentKnowledgeDoc): void {
  ensureDir(docsDir(rootDir, kbId))
  writeFileSync(docFilePath(rootDir, kbId, doc.id), JSON.stringify(doc), 'utf-8')
}

export function migrateLegacyKnowledgeBases(
  legacyKnowledgeBases: unknown[],
  baseDir: string
): KnowledgeBaseConfig[] {
  const rootDir = baseDir.trim()
  for (const item of legacyKnowledgeBases) {
    const kb = normalizeLegacyKnowledgeBase(item)
    if (!kb) continue
    upsertKnowledgeBase(rootDir, kb)

    const raw = item as Record<string, unknown>
    const docs = Array.isArray(raw['docs']) ? raw['docs'] : []
    let migratedCount = 0
    for (const doc of docs) {
      const normalized = normalizeLegacyKnowledgeDoc(doc, kb.id)
      if (!normalized) continue
      saveKnowledgeDocument(rootDir, kb.id, normalized)
      migratedCount += 1
    }

    upsertKnowledgeBase(rootDir, { ...kb, docCount: migratedCount })
  }

  return readKnowledgeBaseIndex(rootDir)
}
