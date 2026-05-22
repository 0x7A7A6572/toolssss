import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { StickyNote } from '@shared/sticky-notes'

const LEGACY_NOTES_FILE = 'sticky-notes.json'
const NOTE_FILE_PREFIX = 'sticky-note__'
const NOTE_FILE_EXT = '.html'
const NOTE_FILE_HEADER_PREFIX = '<!--FreamXStickyNote '

function ensureDir(dir: string): void {
  if (!dir.trim()) return
  mkdirSync(dir, { recursive: true })
}

function isNoteFileName(name: string): boolean {
  return name.startsWith(NOTE_FILE_PREFIX) && name.endsWith(NOTE_FILE_EXT)
}

function noteIdFromFileName(name: string): string {
  if (!isNoteFileName(name)) return ''
  return name.slice(NOTE_FILE_PREFIX.length, name.length - NOTE_FILE_EXT.length)
}

function noteFilePath(baseDir: string, noteId: string): string {
  return join(baseDir, `${NOTE_FILE_PREFIX}${noteId}${NOTE_FILE_EXT}`)
}

export function serializeStickyNoteHtmlFile(note: StickyNote): string {
  const meta = JSON.stringify({
    id: note.id,
    color: note.color,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt
  })
  return `${NOTE_FILE_HEADER_PREFIX}${meta} -->\n${note.content ?? ''}`
}

export function parseStickyNoteHtmlFile(
  noteId: string,
  raw: string,
  mtimeMsFallback: number
): StickyNote {
  const text = typeof raw === 'string' ? raw : ''
  const id = noteId.trim()
  if (!id) {
    return {
      id: '',
      content: text,
      color: '#FFF8B8',
      createdAt: mtimeMsFallback,
      updatedAt: mtimeMsFallback
    }
  }

  if (!text.startsWith(NOTE_FILE_HEADER_PREFIX)) {
    return {
      id,
      content: text,
      color: '#FFF8B8',
      createdAt: mtimeMsFallback,
      updatedAt: mtimeMsFallback
    }
  }

  const end = text.indexOf('-->')
  if (end < 0) {
    return {
      id,
      content: text,
      color: '#FFF8B8',
      createdAt: mtimeMsFallback,
      updatedAt: mtimeMsFallback
    }
  }

  const metaRaw = text.slice(NOTE_FILE_HEADER_PREFIX.length, end).trim()
  const body = text.slice(end + 3).replace(/^\r?\n/, '')
  try {
    const meta = JSON.parse(metaRaw) as unknown
    const m = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}
    const color = typeof m['color'] === 'string' ? (m['color'] as string) : '#FFF8B8'
    const createdAt =
      typeof m['createdAt'] === 'number' ? (m['createdAt'] as number) : mtimeMsFallback
    const updatedAt =
      typeof m['updatedAt'] === 'number' ? (m['updatedAt'] as number) : mtimeMsFallback
    return { id, content: body, color, createdAt, updatedAt }
  } catch {
    return {
      id,
      content: text,
      color: '#FFF8B8',
      createdAt: mtimeMsFallback,
      updatedAt: mtimeMsFallback
    }
  }
}

function listNoteFiles(baseDir: string): string[] {
  if (!existsSync(baseDir)) return []
  try {
    return readdirSync(baseDir).filter(isNoteFileName)
  } catch {
    return []
  }
}

export function hasAnyHtmlNotes(baseDir: string): boolean {
  return listNoteFiles(baseDir).length > 0
}

export function migrateLegacyJsonToHtml(baseDir: string): StickyNote[] {
  ensureDir(baseDir)
  const legacyPath = join(baseDir, LEGACY_NOTES_FILE)
  if (!existsSync(legacyPath)) return []

  try {
    const raw = readFileSync(legacyPath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const list = Array.isArray(parsed) ? (parsed as StickyNote[]) : []
    for (const n of list) {
      if (!n || typeof n !== 'object') continue
      const note = n as StickyNote
      if (!note.id) continue
      const p = noteFilePath(baseDir, note.id)
      if (existsSync(p)) continue
      writeFileSync(p, serializeStickyNoteHtmlFile(note), 'utf-8')
    }
    return listStickyNotes(baseDir)
  } catch {
    return []
  }
}

export function listStickyNotes(baseDir: string): StickyNote[] {
  ensureDir(baseDir)
  if (!hasAnyHtmlNotes(baseDir)) {
    migrateLegacyJsonToHtml(baseDir)
  }

  const out: StickyNote[] = []
  for (const file of listNoteFiles(baseDir)) {
    const id = noteIdFromFileName(file)
    if (!id) continue
    const p = join(baseDir, file)
    try {
      const st = statSync(p)
      const raw = readFileSync(p, 'utf-8')
      out.push(parseStickyNoteHtmlFile(id, raw, st.mtimeMs))
    } catch {
      void 0
    }
  }
  return out
}

export function upsertStickyNote(baseDir: string, note: StickyNote): StickyNote[] {
  ensureDir(baseDir)
  if (!note.id) return listStickyNotes(baseDir)
  const p = noteFilePath(baseDir, note.id)
  try {
    writeFileSync(p, serializeStickyNoteHtmlFile(note), 'utf-8')
  } catch {
    void 0
  }
  return listStickyNotes(baseDir)
}

export function deleteStickyNote(baseDir: string, id: string): StickyNote[] {
  ensureDir(baseDir)
  const p = noteFilePath(baseDir, id)
  try {
    if (existsSync(p)) unlinkSync(p)
  } catch {
    void 0
  }
  return listStickyNotes(baseDir)
}

export function copyStickyNotesStorageIfAbsent(prevDir: string, nextDir: string): void {
  if (!prevDir.trim() || !nextDir.trim()) return
  ensureDir(prevDir)
  ensureDir(nextDir)

  if (!hasAnyHtmlNotes(prevDir)) {
    migrateLegacyJsonToHtml(prevDir)
  }

  if (hasAnyHtmlNotes(nextDir)) return

  for (const file of listNoteFiles(prevDir)) {
    const src = join(prevDir, file)
    const dst = join(nextDir, file)
    try {
      if (!existsSync(dst)) {
        const raw = readFileSync(src, 'utf-8')
        writeFileSync(dst, raw, 'utf-8')
      }
    } catch {
      void 0
    }
  }

  const legacySrc = join(prevDir, LEGACY_NOTES_FILE)
  const legacyDst = join(nextDir, LEGACY_NOTES_FILE)
  if (existsSync(legacySrc) && !existsSync(legacyDst)) {
    try {
      const raw = readFileSync(legacySrc, 'utf-8')
      writeFileSync(legacyDst, raw, 'utf-8')
    } catch {
      void 0
    }
  }
}

