import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyKnowledgeBases } from './legacy-agent-kb-migration'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('legacy-agent-kb-migration', () => {
  it('migrates embedded knowledge base docs into dedicated storage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-kb-migration-'))
    tempDirs.push(dir)

    const knowledgeBases = migrateLegacyKnowledgeBases(
      [
        {
          id: 'kb-1',
          name: '产品手册',
          indexedAt: 123,
          docs: [
            {
              id: 'doc-1',
              title: '介绍',
              content: 'hello',
              createdAt: 11,
              updatedAt: 22
            }
          ]
        }
      ],
      dir
    )

    expect(knowledgeBases).toEqual([
      {
        id: 'kb-1',
        name: '产品手册',
        docCount: 1,
        indexedAt: 123
      }
    ])

    const indexPath = join(dir, 'index.json')
    const docPath = join(dir, 'kb-1', 'docs', 'doc-1.json')
    expect(existsSync(indexPath)).toBe(true)
    expect(existsSync(docPath)).toBe(true)
    expect(JSON.parse(readFileSync(indexPath, 'utf-8'))).toEqual(knowledgeBases)
    expect(JSON.parse(readFileSync(docPath, 'utf-8'))).toEqual({
      id: 'doc-1',
      kbId: 'kb-1',
      title: '介绍',
      content: 'hello',
      createdAt: 11,
      updatedAt: 22
    })
  })
})
