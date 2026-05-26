import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { StickyNote } from '@shared/sticky-notes'
import {
  copyStickyNotesStorageIfAbsent,
  deleteStickyNote,
  listStickyNotes,
  migrateLegacyJsonToHtml,
  parseStickyNoteHtmlFile,
  serializeStickyNoteHtmlFile,
  upsertStickyNote
} from './storage'

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), 'freamx-sticky-notes-'))
}

describe('sticky-notes storage (html files)', () => {
  it('serializes and parses note html with meta header', () => {
    const note: StickyNote = {
      id: 'n1',
      content: '<p>Hello</p>',
      color: '#FFCCBC',
      createdAt: 100,
      updatedAt: 200
    }

    const raw = serializeStickyNoteHtmlFile(note)
    const parsed = parseStickyNoteHtmlFile(note.id, raw, 999)

    expect(parsed).toEqual(note)
  })

  it('upserts, lists and deletes notes via filesystem', () => {
    const dir = mkTmp()
    try {
      const a: StickyNote = {
        id: 'a',
        content: '<p>A</p>',
        color: '#FFF8B8',
        createdAt: 1,
        updatedAt: 2
      }
      const b: StickyNote = {
        id: 'b',
        content: '<p>B</p>',
        color: '#E2F0CB',
        createdAt: 3,
        updatedAt: 4
      }

      upsertStickyNote(dir, a)
      upsertStickyNote(dir, b)

      const list1 = listStickyNotes(dir)
      expect(list1.map((n) => n.id).sort()).toEqual(['a', 'b'])

      const list2 = deleteStickyNote(dir, 'a')
      expect(list2.map((n) => n.id)).toEqual(['b'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('migrates legacy sticky-notes.json into html note files', () => {
    const dir = mkTmp()
    try {
      const legacy: StickyNote[] = [
        { id: 'x', content: '<p>X</p>', color: '#FFF8B8', createdAt: 1, updatedAt: 2 },
        { id: 'y', content: '<p>Y</p>', color: '#E2F0CB', createdAt: 3, updatedAt: 4 }
      ]
      writeFileSync(join(dir, 'sticky-notes.json'), JSON.stringify(legacy), 'utf-8')

      const migrated = migrateLegacyJsonToHtml(dir)
      expect(migrated.map((n) => n.id).sort()).toEqual(['x', 'y'])

      const list = listStickyNotes(dir)
      expect(list.map((n) => n.id).sort()).toEqual(['x', 'y'])

      const file = join(dir, 'sticky-note__x.html')
      const raw = readFileSync(file, 'utf-8')
      expect(raw.startsWith('<!--FreamXStickyNote ')).toBe(true)
      expect(raw.includes('<p>X</p>')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('copies storage from prev dir to next dir only when next is empty', () => {
    const prev = mkTmp()
    const next = mkTmp()
    try {
      const note: StickyNote = {
        id: 'z',
        content: '<p>Z</p>',
        color: '#FFCDD2',
        createdAt: 10,
        updatedAt: 20
      }
      upsertStickyNote(prev, note)

      copyStickyNotesStorageIfAbsent(prev, next)
      const list1 = listStickyNotes(next)
      expect(list1.map((n) => n.id)).toEqual(['z'])

      mkdirSync(next, { recursive: true })
      writeFileSync(join(next, 'sticky-note__other.html'), '<p>other</p>', 'utf-8')
      copyStickyNotesStorageIfAbsent(prev, next)
      const list2 = listStickyNotes(next)
      expect(list2.map((n) => n.id).sort()).toEqual(['other', 'z'])
    } finally {
      rmSync(prev, { recursive: true, force: true })
      rmSync(next, { recursive: true, force: true })
    }
  })
})
