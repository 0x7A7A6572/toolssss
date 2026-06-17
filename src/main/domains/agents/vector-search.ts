import type { IndexedKnowledgeChunk } from './kb-index-store'

export interface RankedKnowledgeChunk extends IndexedKnowledgeChunk {
  score: number
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0

  let dot = 0
  let magnitudeA = 0
  let magnitudeB = 0

  for (let index = 0; index < a.length; index += 1) {
    const valueA = a[index] ?? 0
    const valueB = b[index] ?? 0
    dot += valueA * valueB
    magnitudeA += valueA * valueA
    magnitudeB += valueB * valueB
  }

  if (!magnitudeA || !magnitudeB) return 0
  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB))
}

export function rankIndexedChunks(
  chunks: IndexedKnowledgeChunk[],
  queryVector: number[],
  topK: number
): RankedKnowledgeChunk[] {
  return chunks
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(chunk.embedding, queryVector)
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
