import { describe, expect, it } from 'vitest'
import { chunkKnowledgeDocument } from './kb-chunker'

describe('kb-chunker', () => {
  it('splits long documents into stable overlapping chunks', async () => {
    const chunks = await chunkKnowledgeDocument(
      {
        id: 'doc-1',
        kbId: 'kb-1',
        title: 'Guide',
        content: '第一段内容。第二段内容。第三段内容。'.repeat(120),
        createdAt: 1,
        updatedAt: 1
      },
      {
        topK: 4,
        chunkSize: 120,
        chunkOverlap: 20
      }
    )

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({
      kbId: 'kb-1',
      docId: 'doc-1',
      docTitle: 'Guide',
      index: 0
    })
  })
})
