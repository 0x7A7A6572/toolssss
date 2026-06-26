# Enterprise RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current lexical-search pseudo-RAG with a standard local vector RAG pipeline that uses chunking, embeddings, persisted local indexes, and retrievable citations.

**Architecture:** Move knowledge-base content and index data out of `settings.json` into dedicated local storage under Electron `userData`, keep `settings` for configuration and references only, and make chat retrieval async and vector-based. Use LangChain for text splitting and embeddings, persist chunk metadata plus vectors locally, and retrieve by cosine similarity without any lexical search path.

**Tech Stack:** Electron, Vue 3, TypeScript, LangChain, `@langchain/openai`, local JSON file storage, Vitest

---

## File Structure

- Modify: `f:\codes\toolssss\src\shared\agents.ts`
  - Replace full knowledge-base-in-settings assumptions with summary/config types plus richer RAG metadata types.
- Modify: `f:\codes\toolssss\src\shared\settings.ts`
  - Add embedding profile config and remove inline KB document payloads from settings state.
- Modify: `f:\codes\toolssss\src\main\core\settings-store.ts`
  - Normalize new settings shape and migrate legacy embedded KB docs into dedicated storage.
- Modify: `f:\codes\toolssss\src\main\core\ai-service.ts`
  - Add embeddings model creation and shared profile resolution helpers.
- Create: `f:\codes\toolssss\src\main\domains\agents\knowledge-base-store.ts`
  - Persist KB summaries and KB documents outside settings.
- Create: `f:\codes\toolssss\src\main\domains\agents\kb-index-store.ts`
  - Persist chunk metadata and vector indexes.
- Create: `f:\codes\toolssss\src\main\domains\agents\kb-chunker.ts`
  - Centralize chunking strategy using LangChain text splitters.
- Create: `f:\codes\toolssss\src\main\domains\agents\kb-indexer.ts`
  - Build/rebuild chunk embeddings and write the local index.
- Create: `f:\codes\toolssss\src\main\domains\agents\vector-search.ts`
  - Compute cosine similarity and rank chunks.
- Modify: `f:\codes\toolssss\src\main\domains\agents\rag-engine.ts`
  - Replace lexical retrieval with async vector retrieval only.
- Modify: `f:\codes\toolssss\src\main\domains\agents\chat-pipeline.ts`
  - Await async RAG retrieval and pass citation-rich chunks forward.
- Modify: `f:\codes\toolssss\src\main\domains\agents\index.ts`
  - Register KB CRUD/reindex IPC handlers and use new stores instead of settings payloads.
- Modify: `f:\codes\toolssss\src\renderer\src\views\Settings\SettingsView.vue`
  - Switch KB CRUD to dedicated IPC APIs and add embedding/RAG settings controls.
- Modify: `f:\codes\toolssss\src\renderer\src\state\settings.ts`
  - Keep settings store focused on config only; KB content comes from agent-domain APIs.
- Test: `f:\codes\toolssss\src\main\domains\agents\rag-engine.test.ts`
- Create Test: `f:\codes\toolssss\src\main\domains\agents\kb-chunker.test.ts`
- Create Test: `f:\codes\toolssss\src\main\domains\agents\kb-indexer.test.ts`
- Create Test: `f:\codes\toolssss\src\main\domains\agents\knowledge-base-store.test.ts`

### Task 1: Redefine Shared Types For Real RAG

**Files:**

- Modify: `f:\codes\toolssss\src\shared\agents.ts`
- Modify: `f:\codes\toolssss\src\shared\settings.ts`
- Test: `f:\codes\toolssss\src\main\domains\agents\rag-engine.test.ts`

- [ ] **Step 1: Write the failing type-driven test scaffold**

```ts
import { describe, expect, it } from 'vitest'
import type { AppSettings } from '@shared/settings'

describe('enterprise rag settings shape', () => {
  it('supports separate embedding config', () => {
    const settings = {
      ai: {
        embedding: {
          enabled: true,
          profileId: 'embed-profile',
          model: 'text-embedding-3-small',
          dimensions: 1536
        }
      }
    } as Partial<AppSettings>

    expect(settings.ai?.embedding?.profileId).toBe('embed-profile')
  })
})
```

- [ ] **Step 2: Run test to verify current shape is missing**

Run: `npm test -- src/main/domains/agents/rag-engine.test.ts`
Expected: FAIL or type-check mismatch because `settings.ai.embedding` does not exist yet.

- [ ] **Step 3: Update shared types**

```ts
export interface EmbeddingProfileConfig {
  enabled: boolean
  profileId: string
  model: string
  dimensions: number
}

export interface RagRuntimeConfig {
  topK: number
  chunkSize: number
  chunkOverlap: number
}

export interface KnowledgeBaseConfig {
  id: string
  name: string
  docCount: number
  indexedAt: number | null
}

export interface AgentKnowledgeDoc {
  id: string
  kbId: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

export interface AgentRagChunk {
  docTitle: string
  text: string
  score: number
  docId: string
  chunkId: string
}
```

- [ ] **Step 4: Add settings fields for embedding and runtime config**

```ts
ai: {
  enabled: boolean
  provider: AiProvider
  baseUrl: string
  model: string
  apiKeySet: boolean
  activeProfileId: string
  profiles: AiProfile[]
  searchMcpCommand: string
  embedding: EmbeddingProfileConfig
}
agents: {
  configs: AgentConfig[]
  knowledgeBases: KnowledgeBaseConfig[]
  rag: RagRuntimeConfig
}
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:node`
Expected: FAIL in files still assuming `kb.docs` exists. That is good; it tells the rest of the migration surface.

- [ ] **Step 6: Commit**

```bash
git add src/shared/agents.ts src/shared/settings.ts
git commit -m "refactor: redefine shared types for vector rag"
```

### Task 2: Move Knowledge Base Content Out Of Settings

**Files:**

- Create: `f:\codes\toolssss\src\main\domains\agents\knowledge-base-store.ts`
- Modify: `f:\codes\toolssss\src\main\core\settings-store.ts`
- Test: `f:\codes\toolssss\src\main\domains\agents\knowledge-base-store.test.ts`

- [ ] **Step 1: Write the failing storage test**

```ts
import { describe, expect, it } from 'vitest'
import { createTmpKnowledgeBaseStore } from './knowledge-base-store'

describe('knowledge-base-store', () => {
  it('persists kb summaries and docs outside settings', async () => {
    const store = createTmpKnowledgeBaseStore()
    const kb = await store.saveKnowledgeBase({ id: 'kb-1', name: 'Support Docs' })
    await store.saveDocument(kb.id, {
      id: 'doc-1',
      title: 'Install',
      content: 'Install steps',
      createdAt: 1,
      updatedAt: 1
    })

    const docs = await store.listDocuments(kb.id)
    expect(kb.name).toBe('Support Docs')
    expect(docs).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify missing module failure**

Run: `npm test -- src/main/domains/agents/knowledge-base-store.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement the store**

```ts
export interface KnowledgeBaseStore {
  listKnowledgeBases(): Promise<KnowledgeBaseConfig[]>
  saveKnowledgeBase(input: Pick<KnowledgeBaseConfig, 'id' | 'name'>): Promise<KnowledgeBaseConfig>
  deleteKnowledgeBase(id: string): Promise<void>
  listDocuments(kbId: string): Promise<AgentKnowledgeDoc[]>
  saveDocument(
    kbId: string,
    input: Omit<AgentKnowledgeDoc, 'kbId'> & Partial<Pick<AgentKnowledgeDoc, 'kbId'>>
  ): Promise<AgentKnowledgeDoc>
  deleteDocument(kbId: string, docId: string): Promise<void>
}
```

- [ ] **Step 4: Add legacy migration in settings normalization**

```ts
if (Array.isArray(agents['knowledgeBases'])) {
  const migrated = await migrateLegacyKnowledgeBases(
    agents['knowledgeBases'] as unknown[],
    knowledgeBaseStore
  )
  base.agents.knowledgeBases = migrated
}
```

- [ ] **Step 5: Ensure settings only keeps KB summaries**

```ts
return {
  id,
  name,
  docCount,
  indexedAt
}
```

- [ ] **Step 6: Run tests**

Run: `npm test -- src/main/domains/agents/knowledge-base-store.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/domains/agents/knowledge-base-store.ts src/main/core/settings-store.ts src/main/domains/agents/knowledge-base-store.test.ts
git commit -m "refactor: move knowledge base content out of settings"
```

### Task 3: Add Embeddings Support To AI Service

**Files:**

- Modify: `f:\codes\toolssss\src\main\core\ai-service.ts`
- Test: `f:\codes\toolssss\src\main\domains\agents\kb-indexer.test.ts`

- [ ] **Step 1: Write the failing embedding helper test**

```ts
import { describe, expect, it } from 'vitest'
import { normalizeBaseUrlForOpenAIEmbeddings } from '@main-core/ai-service'

describe('ai-service embeddings helpers', () => {
  it('normalizes custom openai-compatible base urls for embeddings', () => {
    expect(normalizeBaseUrlForOpenAIEmbeddings('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1'
    )
  })
})
```

- [ ] **Step 2: Add embedding model factory**

```ts
import { OpenAIEmbeddings } from '@langchain/openai'

export interface EmbeddingModelConfig {
  baseUrl: string
  model: string
  profileId: string
  dimensions?: number
}

export function createEmbeddingsModel(
  config: EmbeddingModelConfig,
  apiKey: string
): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    model: config.model,
    apiKey,
    dimensions: config.dimensions,
    configuration: {
      baseURL: normalizeBaseUrlForChatOpenAI(config.baseUrl)
    }
  })
}
```

- [ ] **Step 3: Resolve embedding profile separately**

```ts
export function resolveEmbeddingModelConfig(settings: AppSettings): EmbeddingModelConfig {
  if (!settings.ai.embedding.enabled) {
    throw new Error('未启用知识库 Embedding 配置，请到设置中完善。')
  }
  const profile = settings.ai.profiles.find((item) => item.id === settings.ai.embedding.profileId)
  if (!profile) throw new Error('未找到 Embedding 配置对应的 AI Profile。')
  return {
    baseUrl: profile.baseUrl,
    model: settings.ai.embedding.model.trim(),
    profileId: profile.id,
    dimensions: settings.ai.embedding.dimensions
  }
}
```

- [ ] **Step 4: Run node typecheck**

Run: `npm run typecheck:node`
Expected: PASS or only fail in not-yet-migrated RAG files.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/ai-service.ts
git commit -m "feat: add embeddings model support"
```

### Task 4: Implement Chunking And Local Vector Indexing

**Files:**

- Create: `f:\codes\toolssss\src\main\domains\agents\kb-chunker.ts`
- Create: `f:\codes\toolssss\src\main\domains\agents\kb-index-store.ts`
- Create: `f:\codes\toolssss\src\main\domains\agents\kb-indexer.ts`
- Create Test: `f:\codes\toolssss\src\main\domains\agents\kb-chunker.test.ts`
- Create Test: `f:\codes\toolssss\src\main\domains\agents\kb-indexer.test.ts`

- [ ] **Step 1: Write chunking test**

```ts
import { describe, expect, it } from 'vitest'
import { chunkKnowledgeDocument } from './kb-chunker'

describe('kb-chunker', () => {
  it('splits long documents into stable overlapping chunks', async () => {
    const chunks = await chunkKnowledgeDocument(
      {
        kbId: 'kb-1',
        docId: 'doc-1',
        title: 'Guide',
        content: '第一段。'.repeat(500)
      },
      {
        chunkSize: 600,
        chunkOverlap: 100
      }
    )

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]?.docTitle).toBe('Guide')
  })
})
```

- [ ] **Step 2: Implement chunker with LangChain splitter**

```ts
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

export async function chunkKnowledgeDocument(doc: AgentKnowledgeDoc, rag: RagRuntimeConfig) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: rag.chunkSize,
    chunkOverlap: rag.chunkOverlap,
    separators: ['\n## ', '\n### ', '\n\n', '\n', '。', '！', '？', '；', '，', ' ']
  })
  const texts = await splitter.splitText(doc.content)
  return texts.map((text, index) => ({
    id: `${doc.id}#${index}`,
    kbId: doc.kbId,
    docId: doc.id,
    docTitle: doc.title,
    text,
    index
  }))
}
```

- [ ] **Step 3: Write indexer test with fake embeddings**

```ts
import { describe, expect, it, vi } from 'vitest'
import { rebuildKnowledgeBaseIndex } from './kb-indexer'

describe('kb-indexer', () => {
  it('writes chunk vectors for every chunk', async () => {
    const embedDocuments = vi.fn().mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4]
    ])
    const result = await rebuildKnowledgeBaseIndex({
      docs: [
        {
          id: 'doc-1',
          kbId: 'kb-1',
          title: 'Guide',
          content: 'A'.repeat(1200),
          createdAt: 1,
          updatedAt: 1
        }
      ],
      rag: { topK: 4, chunkSize: 600, chunkOverlap: 100 },
      embeddings: { embedDocuments }
    })

    expect(result.chunks.length).toBeGreaterThan(1)
    expect(embedDocuments).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 4: Implement index store and indexer**

```ts
export interface IndexedKnowledgeChunk {
  id: string
  kbId: string
  docId: string
  docTitle: string
  text: string
  index: number
  embedding: number[]
}

export async function rebuildKnowledgeBaseIndex(input: RebuildInput): Promise<RebuildOutput> {
  const chunkGroups = await Promise.all(
    input.docs.map((doc) => chunkKnowledgeDocument(doc, input.rag))
  )
  const chunks = chunkGroups.flat()
  const vectors = chunks.length
    ? await input.embeddings.embedDocuments(chunks.map((item) => item.text))
    : []
  return {
    chunks: chunks.map((chunk, index) => ({ ...chunk, embedding: vectors[index] ?? [] })),
    indexedAt: Date.now()
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- src/main/domains/agents/kb-chunker.test.ts src/main/domains/agents/kb-indexer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/domains/agents/kb-chunker.ts src/main/domains/agents/kb-index-store.ts src/main/domains/agents/kb-indexer.ts src/main/domains/agents/kb-chunker.test.ts src/main/domains/agents/kb-indexer.test.ts
git commit -m "feat: add local chunking and vector index builder"
```

### Task 5: Replace Lexical Search With Vector Retrieval

**Files:**

- Create: `f:\codes\toolssss\src\main\domains\agents\vector-search.ts`
- Modify: `f:\codes\toolssss\src\main\domains\agents\rag-engine.ts`
- Modify: `f:\codes\toolssss\src\main\domains\agents\chat-pipeline.ts`
- Test: `f:\codes\toolssss\src\main\domains\agents\rag-engine.test.ts`

- [ ] **Step 1: Rewrite retrieval test to prove vector-only behavior**

```ts
import { describe, expect, it, vi } from 'vitest'
import { retrieveFromKnowledgeBase } from './rag-engine'

describe('rag-engine', () => {
  it('retrieves top chunks from vector index only', async () => {
    const retrieve = await retrieveFromKnowledgeBase({
      kbId: 'kb-1',
      query: 'installation steps',
      embedQuery: vi.fn().mockResolvedValue([0.9, 0.1]),
      loadIndex: vi.fn().mockResolvedValue({
        indexedAt: 1,
        chunks: [
          {
            id: 'a',
            kbId: 'kb-1',
            docId: 'doc-1',
            docTitle: 'Install',
            text: 'installation steps',
            index: 0,
            embedding: [1, 0]
          },
          {
            id: 'b',
            kbId: 'kb-1',
            docId: 'doc-2',
            docTitle: 'FAQ',
            text: 'billing question',
            index: 0,
            embedding: [0, 1]
          }
        ]
      }),
      topK: 1
    })

    expect(retrieve.chunks[0]?.docTitle).toBe('Install')
  })
})
```

- [ ] **Step 2: Implement cosine similarity**

```ts
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!
    magA += a[i]! * a[i]!
    magB += b[i]! * b[i]!
  }
  if (!magA || !magB) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}
```

- [ ] **Step 3: Replace `rag-engine.ts` API with async retrieval**

```ts
export async function retrieveFromKnowledgeBase(input: {
  query: string
  kbId: string | null
  settings: AppSettings
}): Promise<RagContext> {
  if (!input.kbId) return { chunks: [] }
  const index = await loadKnowledgeBaseIndex(input.kbId)
  if (!index.chunks.length) return { chunks: [] }

  const embedQuery = createEmbeddingsModel(
    resolveEmbeddingModelConfig(input.settings),
    resolveApiKey(resolveEmbeddingModelConfig(input.settings).profileId)
  )
  const vector = await embedQuery.embedQuery(input.query)
  const ranked = rankIndexedChunks(index.chunks, vector, input.settings.agents.rag.topK)
  return {
    chunks: ranked.map((item) => ({
      chunkId: item.id,
      docId: item.docId,
      docTitle: item.docTitle,
      text: item.text,
      score: item.score
    }))
  }
}
```

- [ ] **Step 4: Update chat pipeline**

```ts
if (agent.knowledgeBaseId) {
  onStatus('rag_loading')
  ragContext = await retrieveFromKnowledgeBase({
    query: newUserMessage,
    kbId: agent.knowledgeBaseId,
    settings
  })
}
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/main/domains/agents/rag-engine.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/domains/agents/vector-search.ts src/main/domains/agents/rag-engine.ts src/main/domains/agents/chat-pipeline.ts src/main/domains/agents/rag-engine.test.ts
git commit -m "feat: replace lexical rag retrieval with vector search"
```

### Task 6: Add IPC For KB CRUD And Index Rebuild

**Files:**

- Modify: `f:\codes\toolssss\src\main\domains\agents\index.ts`
- Modify: `f:\codes\toolssss\src\shared\agents.ts`
- Test: `f:\codes\toolssss\src\main\domains\agents\knowledge-base-store.test.ts`

- [ ] **Step 1: Add KB events**

```ts
export const AGENT_EVENTS = {
  KB_LIST: 'agent:kb:list',
  KB_SAVE: 'agent:kb:save',
  KB_DELETE: 'agent:kb:delete',
  KB_DOC_LIST: 'agent:kb:doc:list',
  KB_DOC_SAVE: 'agent:kb:doc:save',
  KB_DOC_DELETE: 'agent:kb:doc:delete',
  KB_REINDEX: 'agent:kb:reindex',
  CHAT_STREAM: 'agent:chat:stream'
} as const
```

- [ ] **Step 2: Register handlers in agent domain**

```ts
ipcMain.handle(AGENT_EVENTS.KB_LIST, () => kbStore.listKnowledgeBases())
ipcMain.handle(AGENT_EVENTS.KB_DOC_LIST, (_event, payload) =>
  kbStore.listDocuments(requireString(payload?.kbId, 'kbId'))
)
ipcMain.handle(AGENT_EVENTS.KB_REINDEX, async (_event, payload) => {
  const kbId = requireString(payload?.kbId, 'kbId')
  return reindexKnowledgeBase(kbId, deps.getSettings())
})
```

- [ ] **Step 3: Rebuild index on document mutations**

```ts
await kbStore.saveDocument(kbId, docInput)
await reindexKnowledgeBase(kbId, deps.getSettings())
return kbStore.listDocuments(kbId)
```

- [ ] **Step 4: Run node typecheck**

Run: `npm run typecheck:node`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/domains/agents/index.ts src/shared/agents.ts
git commit -m "feat: add knowledge base ipc and reindex hooks"
```

### Task 7: Migrate Settings UI To Dedicated KB APIs

**Files:**

- Modify: `f:\codes\toolssss\src\renderer\src\views\Settings\SettingsView.vue`
- Modify: `f:\codes\toolssss\src\renderer\src\state\settings.ts`

- [ ] **Step 1: Replace direct settings mutation for KB data**

```ts
const knowledgeBases = ref<KnowledgeBaseConfig[]>([])
const kbDocs = ref<Record<string, AgentKnowledgeDoc[]>>({})

async function loadKnowledgeBases(): Promise<void> {
  const list = await window.electron.ipcRenderer.invoke(AGENT_EVENTS.KB_LIST)
  knowledgeBases.value = Array.isArray(list) ? list : []
}
```

- [ ] **Step 2: Replace `saveKb` and `saveDoc` with IPC calls**

```ts
async function saveKb(): Promise<void> {
  const saved = await window.electron.ipcRenderer.invoke(AGENT_EVENTS.KB_SAVE, {
    id: kbEditing.value?.id ?? generateKbId(),
    name: kbDraftName.value.trim()
  })
  await loadKnowledgeBases()
  closeKbModal()
}

async function saveDoc(): Promise<void> {
  await window.electron.ipcRenderer.invoke(AGENT_EVENTS.KB_DOC_SAVE, {
    kbId: docEditingKb.value?.id,
    doc: {
      id: docEditing.value?.id ?? generateDocId(),
      title: docDraftTitle.value.trim(),
      content: docDraftContent.value
    }
  })
  await loadKnowledgeBases()
  closeDocModal()
}
```

- [ ] **Step 3: Add embedding and RAG controls**

```vue
<div class="agent-modal-field">
  <div class="agent-modal-label">Embedding Profile</div>
<a-select
  v-model:value="settings.ai.embedding.profileId"
  :options="settings.ai.profiles.map((p) => ({ value: p.id, label: p.name }))"
/>

<div class="agent-modal-field">
  <div class="agent-modal-label">Embedding Model</div>
<input v-model="embeddingModelDraft" class="text agent-modal-input" type="text" />
```

- [ ] **Step 4: Run web typecheck**

Run: `npm run typecheck:web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/views/Settings/SettingsView.vue src/renderer/src/state/settings.ts
git commit -m "refactor: move knowledge base ui to dedicated rag apis"
```

### Task 8: Verify End-To-End Chat Retrieval And Citations

**Files:**

- Modify: `f:\codes\toolssss\src\renderer\src\views\AgentChat\AgentChatView.vue`
- Modify: `f:\codes\toolssss\src\main\domains\agents\index.ts`
- Test: `f:\codes\toolssss\src\main\domains\agents\rag-engine.test.ts`

- [ ] **Step 1: Keep citation payload attached to assistant messages**

```ts
const assistantMsg: AgentMessage = {
  id: generateId('msg'),
  role: 'assistant',
  content: fullText,
  ragChunks: ragContext?.chunks.length ? ragContext.chunks : undefined,
  timestamp: Date.now()
}
```

- [ ] **Step 2: Verify chat shows retrieved chunks**

Run: `npm run typecheck && npm test -- src/main/domains/agents/rag-engine.test.ts src/main/domains/agents/kb-indexer.test.ts`
Expected: PASS

- [ ] **Step 3: Manual verification**

Run:

```bash
npm run dev
```

Expected:

- Create KB in settings
- Add document containing `KB_CANARY_9F3A2D 是 xxx`
- Reindex automatically
- Ask `KB_CANARY_9F3A2D 是什么`
- Assistant reply cites the correct chunk under the message footer

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/AgentChat/AgentChatView.vue src/main/domains/agents/index.ts
git commit -m "feat: surface vector rag citations in chat"
```

## Self-Review

- Spec coverage:
  - Remove lexical retrieval: covered in Task 5.
  - Enterprise-style local vector storage: covered in Tasks 2, 4, and 6.
  - Separate embedding config: covered in Tasks 1 and 3.
  - Settings/UI migration: covered in Tasks 1, 2, and 7.
  - Chat citation evidence: covered in Task 8.
- Placeholder scan:
  - No `TODO`, `TBD`, or "handle later" placeholders remain.
  - Each task names exact files, commands, and code shape.
- Type consistency:
  - `KnowledgeBaseConfig` becomes summary-only.
  - `AgentKnowledgeDoc` lives in store/API flows.
  - `AgentRagChunk` remains the chat citation payload.

Plan complete and saved to `docs/superpowers/plans/2026-06-17-enterprise-rag.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
