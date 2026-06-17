import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentKnowledgeDoc, KnowledgeBaseConfig } from '@shared/agents'

type KnowledgeBaseSeed = Pick<KnowledgeBaseConfig, 'id' | 'name'> &
  Partial<Pick<KnowledgeBaseConfig, 'docCount' | 'indexedAt'>>

type DocumentSeed = Omit<AgentKnowledgeDoc, 'kbId'> & Partial<Pick<AgentKnowledgeDoc, 'kbId'>>

export interface KnowledgeBaseStore {
  listKnowledgeBases(): KnowledgeBaseConfig[]
  saveKnowledgeBase(input: KnowledgeBaseSeed): KnowledgeBaseConfig
  deleteKnowledgeBase(id: string): void
  listDocuments(kbId: string): AgentKnowledgeDoc[]
  saveDocument(kbId: string, input: DocumentSeed): AgentKnowledgeDoc
  deleteDocument(kbId: string, docId: string): void
}

function knowledgeBasesRootDir(baseDir?: string): string {
  return baseDir?.trim() || join(app.getPath('userData'), 'agents', 'knowledge-bases')
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function indexFilePath(rootDir: string): string {
  return join(rootDir, 'index.json')
}

function kbDir(rootDir: string, kbId: string): string {
  return join(rootDir, kbId)
}

function docsDir(rootDir: string, kbId: string): string {
  return join(kbDir(rootDir, kbId), 'docs')
}

function docFilePath(rootDir: string, kbId: string, docId: string): string {
  return join(docsDir(rootDir, kbId), `${docId}.json`)
}

function normalizeKnowledgeBaseSummary(input: unknown): KnowledgeBaseConfig | null {
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

function normalizeKnowledgeDoc(input: unknown, kbId: string): AgentKnowledgeDoc | null {
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
      .map((item) => normalizeKnowledgeBaseSummary(item))
      .filter((item): item is KnowledgeBaseConfig => item !== null)
  } catch {
    return []
  }
}

function writeKnowledgeBaseIndex(rootDir: string, knowledgeBases: KnowledgeBaseConfig[]): void {
  ensureDir(rootDir)
  writeFileSync(indexFilePath(rootDir), JSON.stringify(knowledgeBases), 'utf-8')
}

function updateKnowledgeBaseSummary(
  rootDir: string,
  kbId: string,
  updater: (current: KnowledgeBaseConfig) => KnowledgeBaseConfig
): KnowledgeBaseConfig {
  const knowledgeBases = readKnowledgeBaseIndex(rootDir)
  const current = knowledgeBases.find((item) => item.id === kbId)
  if (!current) {
    throw new Error(`知识库不存在: ${kbId}`)
  }
  const next = updater(current)
  const updated = knowledgeBases.map((item) => (item.id === kbId ? next : item))
  writeKnowledgeBaseIndex(rootDir, updated)
  return next
}

export function createKnowledgeBaseStore(baseDir?: string): KnowledgeBaseStore {
  const rootDir = knowledgeBasesRootDir(baseDir)

  function listKnowledgeBases(): KnowledgeBaseConfig[] {
    return readKnowledgeBaseIndex(rootDir)
  }

  function saveKnowledgeBase(input: KnowledgeBaseSeed): KnowledgeBaseConfig {
    ensureDir(rootDir)
    ensureDir(kbDir(rootDir, input.id))
    ensureDir(docsDir(rootDir, input.id))

    const knowledgeBases = readKnowledgeBaseIndex(rootDir)
    const current = knowledgeBases.find((item) => item.id === input.id)
    const next: KnowledgeBaseConfig = {
      id: input.id,
      name: input.name.trim(),
      docCount: current?.docCount ?? input.docCount ?? 0,
      indexedAt: current?.indexedAt ?? input.indexedAt ?? null
    }
    const updated = current
      ? knowledgeBases.map((item) => (item.id === next.id ? next : item))
      : [...knowledgeBases, next]
    writeKnowledgeBaseIndex(rootDir, updated)
    return next
  }

  function deleteKnowledgeBase(id: string): void {
    const knowledgeBases = readKnowledgeBaseIndex(rootDir).filter((item) => item.id !== id)
    writeKnowledgeBaseIndex(rootDir, knowledgeBases)
    rmSync(kbDir(rootDir, id), { recursive: true, force: true })
  }

  function listDocuments(kbId: string): AgentKnowledgeDoc[] {
    const dir = docsDir(rootDir, kbId)
    ensureDir(dir)
    try {
      return readdirSync(dir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => {
          const raw = readFileSync(join(dir, file), 'utf-8')
          return normalizeKnowledgeDoc(JSON.parse(raw) as unknown, kbId)
        })
        .filter((item): item is AgentKnowledgeDoc => item !== null)
        .sort((a, b) => a.updatedAt - b.updatedAt)
    } catch {
      return []
    }
  }

  function saveDocument(kbId: string, input: DocumentSeed): AgentKnowledgeDoc {
    ensureDir(kbDir(rootDir, kbId))
    ensureDir(docsDir(rootDir, kbId))
    const now = Date.now()
    const next: AgentKnowledgeDoc = {
      id: input.id.trim(),
      kbId,
      title: input.title.trim(),
      content: input.content,
      createdAt: typeof input.createdAt === 'number' ? input.createdAt : now,
      updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : now
    }
    writeFileSync(docFilePath(rootDir, kbId, next.id), JSON.stringify(next), 'utf-8')
    updateKnowledgeBaseSummary(rootDir, kbId, (current) => ({
      ...current,
      docCount: listDocuments(kbId).length
    }))
    return next
  }

  function deleteDocument(kbId: string, docId: string): void {
    rmSync(docFilePath(rootDir, kbId, docId), { force: true })
    updateKnowledgeBaseSummary(rootDir, kbId, (current) => ({
      ...current,
      docCount: listDocuments(kbId).length
    }))
  }

  return {
    listKnowledgeBases,
    saveKnowledgeBase,
    deleteKnowledgeBase,
    listDocuments,
    saveDocument,
    deleteDocument
  }
}

export function migrateLegacyKnowledgeBases(
  legacyKnowledgeBases: unknown[],
  store: KnowledgeBaseStore
): KnowledgeBaseConfig[] {
  for (const item of legacyKnowledgeBases) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const id = typeof raw['id'] === 'string' ? raw['id'].trim() : ''
    const name = typeof raw['name'] === 'string' ? raw['name'].trim() : ''
    if (!id || !name) continue
    store.saveKnowledgeBase({
      id,
      name,
      indexedAt: typeof raw['indexedAt'] === 'number' ? raw['indexedAt'] : null
    })
    const docs = Array.isArray(raw['docs']) ? raw['docs'] : []
    for (const doc of docs) {
      const normalized = normalizeKnowledgeDoc(doc, id)
      if (!normalized) continue
      store.saveDocument(id, normalized)
    }
  }
  return store.listKnowledgeBases()
}
