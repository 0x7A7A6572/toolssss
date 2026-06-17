import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'

describe('rag settings defaults', () => {
  it('includes separate embedding and rag runtime config', () => {
    expect(DEFAULT_SETTINGS.ai.embedding).toMatchObject({
      enabled: false,
      profileId: '',
      model: 'text-embedding-3-small',
      dimensions: 1536
    })

    expect(DEFAULT_SETTINGS.agents.rag).toMatchObject({
      topK: 4,
      chunkSize: 700,
      chunkOverlap: 120
    })
  })
})
