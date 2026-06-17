import { describe, expect, it, vi } from 'vitest'
import { rebuildKnowledgeBaseIndex } from './kb-indexer'

describe('kb-indexer', () => {
  it('writes chunk vectors for every chunk', async () => {
    const embedDocuments = vi
      .fn()
      .mockImplementation(async (texts: string[]) => texts.map((_, index) => [index + 0.1, index + 0.2]))

    const result = await rebuildKnowledgeBaseIndex({
      kbId: 'kb-1',
      docs: [
        {
          id: 'doc-1',
          kbId: 'kb-1',
          title: 'Guide',
          content: '第一段内容。第二段内容。第三段内容。\n\n'.repeat(120),
          createdAt: 1,
          updatedAt: 1
        }
      ],
      rag: {
        topK: 4,
        chunkSize: 120,
        chunkOverlap: 20
      },
      embeddings: { embedDocuments }
    })

    expect(result.kbId).toBe('kb-1')
    expect(result.indexedAt).toBeTypeOf('number')
    expect(result.chunks.length).toBeGreaterThan(1)
    expect(result.chunks[0]?.embedding).toEqual([0.1, 0.2])
    expect(embedDocuments).toHaveBeenCalledTimes(1)
  })
})
