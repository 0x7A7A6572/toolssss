import type { AgentKnowledgeDoc } from '@shared/agents'
import type { RagRuntimeConfig } from '@shared/settings'
import type { KnowledgeBaseIndex, IndexedKnowledgeChunk } from './kb-index-store'
import { chunkKnowledgeDocument } from './kb-chunker'

export interface EmbeddingsLike {
  embedDocuments(texts: string[]): Promise<number[][]>
}

export interface RebuildKnowledgeBaseIndexInput {
  kbId: string
  docs: AgentKnowledgeDoc[]
  rag: RagRuntimeConfig
  embeddings: EmbeddingsLike
}

export async function rebuildKnowledgeBaseIndex(
  input: RebuildKnowledgeBaseIndexInput
): Promise<KnowledgeBaseIndex> {
  const chunkGroups = await Promise.all(
    input.docs.map((doc) => chunkKnowledgeDocument(doc, input.rag))
  )
  const chunks = chunkGroups.flat()

  if (!chunks.length) {
    return {
      kbId: input.kbId,
      indexedAt: Date.now(),
      chunks: []
    }
  }

  // 这里让 LangChain Embeddings 一次性批量向量化所有 chunk，减少 provider 往返开销。
  const vectors = await input.embeddings.embedDocuments(chunks.map((item) => item.text))
  const indexedChunks: IndexedKnowledgeChunk[] = chunks.map((chunk, index) => ({
    ...chunk,
    embedding: vectors[index] ?? []
  }))

  return {
    kbId: input.kbId,
    indexedAt: Date.now(),
    chunks: indexedChunks
  }
}
