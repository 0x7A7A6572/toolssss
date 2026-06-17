import type { AppSettings } from '@shared/settings'
import { createEmbeddingsModelFromSettings } from '../../core/ai-service'
import { loadKnowledgeBaseIndex, type KnowledgeBaseIndex } from './kb-index-store'
import { rankIndexedChunks } from './vector-search'

/** RAG 检索结果 */
export interface RagChunk {
  chunkId: string
  docId: string
  docTitle: string
  text: string
  score: number
}

export interface RagContext {
  chunks: RagChunk[]
}

export interface RetrieveFromKnowledgeBaseInput {
  query: string
  kbId: string | null
  settings: AppSettings
  loadIndex?: (kbId: string) => Promise<KnowledgeBaseIndex> | KnowledgeBaseIndex
  embedQuery?: (query: string) => Promise<number[]>
}

/** 从知识库向量索引中检索相关文档片段 */
export async function retrieveFromKnowledgeBase(
  input: RetrieveFromKnowledgeBaseInput
): Promise<RagContext> {
  if (!input.kbId) return { chunks: [] }

  const indexLoader = input.loadIndex ?? loadKnowledgeBaseIndex
  const index = await Promise.resolve(indexLoader(input.kbId))
  if (!index.chunks.length) return { chunks: [] }

  // 这里用 LangChain 的 Embeddings 对 query 做向量化，让查询和 chunk 落在同一个向量空间里。
  const queryVector = input.embedQuery
    ? await input.embedQuery(input.query)
    : await createEmbeddingsModelFromSettings(input.settings).model.embedQuery(input.query)

  const ranked = rankIndexedChunks(index.chunks, queryVector, input.settings.agents.rag.topK)
  return {
    chunks: ranked.map((chunk) => ({
      chunkId: chunk.id,
      docId: chunk.docId,
      docTitle: chunk.docTitle,
      text: chunk.text,
      score: chunk.score
    }))
  }
}

/** 将 RAG 检索结果构建为注入到系统提示词的上下文文本 */
export function buildRagContextPrompt(rag: RagContext): string {
  if (!rag.chunks.length) return ''
  const context = rag.chunks
    .map((c, i) => `[${i + 1}] ${c.docTitle}：${c.text}`)
    .join('\n\n')
  return `\n\n以下是知识库中相关的参考资料：\n${context}\n\n请基于以上参考资料回答用户的问题。如果参考资料不足以回答问题，请如实告知。`
}
