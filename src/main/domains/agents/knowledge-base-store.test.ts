import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  createKnowledgeBaseStore,
  migrateLegacyKnowledgeBases
} from './knowledge-base-store'

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), 'forge-studio-kb-'))
}

describe('knowledge-base-store', () => {
  it('persists kb summaries and docs outside settings', () => {
    const dir = mkTmp()
    try {
      const store = createKnowledgeBaseStore(dir)
      const kb = store.saveKnowledgeBase({ id: 'kb-1', name: 'Support Docs' })
      store.saveDocument(kb.id, {
        id: 'doc-1',
        title: 'Install',
        content: 'Install steps',
        createdAt: 1,
        updatedAt: 1
      })

      const docs = store.listDocuments(kb.id)
      const kbs = store.listKnowledgeBases()

      expect(kb.name).toBe('Support Docs')
      expect(docs).toHaveLength(1)
      expect(docs[0]).toMatchObject({
        id: 'doc-1',
        kbId: 'kb-1',
        title: 'Install'
      })
      expect(kbs[0]).toMatchObject({
        id: 'kb-1',
        name: 'Support Docs',
        docCount: 1,
        indexedAt: null
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('migrates legacy inline kb docs into file storage', () => {
    const dir = mkTmp()
    try {
      const store = createKnowledgeBaseStore(dir)
      const migrated = migrateLegacyKnowledgeBases(
        [
          {
            id: 'kb-legacy',
            name: 'Legacy KB',
            docs: [
              {
                id: 'doc-legacy',
                title: 'Legacy Doc',
                content: 'Legacy content',
                createdAt: 10,
                updatedAt: 20
              }
            ]
          }
        ],
        store
      )

      expect(migrated).toHaveLength(1)
      expect(migrated[0]).toMatchObject({
        id: 'kb-legacy',
        name: 'Legacy KB',
        docCount: 1,
        indexedAt: null
      })
      expect(store.listDocuments('kb-legacy')).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
