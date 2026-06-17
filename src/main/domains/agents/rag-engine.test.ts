import { describe, expect, it, vi } from 'vitest'
import { retrieveFromKnowledgeBase } from './rag-engine'

describe('rag-engine', () => {
  it('retrieves top chunks from vector index only', async () => {
    const result = await retrieveFromKnowledgeBase({
      kbId: 'kb-1',
      query: 'installation steps',
      settings: {
        agents: {
          rag: {
            topK: 1,
            chunkSize: 700,
            chunkOverlap: 120
          }
        }
      } as never,
      embedQuery: vi.fn().mockResolvedValue([0.9, 0.1]),
      loadIndex: vi.fn().mockResolvedValue({
        kbId: 'kb-1',
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
      })
    })

    expect(result.chunks).toHaveLength(1)
    expect(result.chunks[0]).toMatchObject({
      chunkId: 'a',
      docId: 'doc-1',
      docTitle: 'Install'
    })
  })

  it('returns empty chunks when kb id is missing', async () => {
    const result = await retrieveFromKnowledgeBase({
      kbId: null,
      query: 'anything',
      settings: {
        agents: {
          rag: {
            topK: 1,
            chunkSize: 700,
            chunkOverlap: 120
          }
        }
      } as never
    })

    expect(result.chunks).toEqual([])
  })
})
