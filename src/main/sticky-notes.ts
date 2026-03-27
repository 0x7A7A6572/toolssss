import { app, ipcMain, BrowserWindow, screen } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { STICKY_NOTES_EVENTS, type StickyNote } from '../shared/sticky-notes'

const NOTES_FILE = 'sticky-notes.json'
let notesDirOverride: string | null = null

function broadcastNotes(notes: StickyNote[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('sticky-notes:changed', notes)
    } catch {
      // ignore
    }
  }
}

function defaultNotesDir(): string {
  return app.getPath('userData')
}

function resolveNotesDir(): string {
  const raw = typeof notesDirOverride === 'string' ? notesDirOverride.trim() : ''
  if (!raw) return defaultNotesDir()
  try {
    mkdirSync(raw, { recursive: true })
    return raw
  } catch {
    return defaultNotesDir()
  }
}

function getNotesFilePath(): string {
  return join(resolveNotesDir(), NOTES_FILE)
}

export function setStickyNotesSaveDir(saveDir: string | null): void {
  const prevDir =
    typeof notesDirOverride === 'string' && notesDirOverride.trim()
      ? notesDirOverride.trim()
      : defaultNotesDir()
  const prevPath = join(prevDir, NOTES_FILE)

  notesDirOverride = typeof saveDir === 'string' && saveDir.trim() ? saveDir.trim() : null

  const nextPath = getNotesFilePath()
  if (prevPath !== nextPath && existsSync(prevPath) && !existsSync(nextPath)) {
    try {
      const raw = readFileSync(prevPath, 'utf-8')
      writeFileSync(nextPath, raw, 'utf-8')
    } catch {
      // ignore
    }
  }

  broadcastNotes(loadNotes())
}

function loadNotes(): StickyNote[] {
  try {
    const filePath = getNotesFilePath()
    if (!existsSync(filePath)) {
      return []
    }
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as StickyNote[]) : []
  } catch (error) {
    console.error('Failed to load sticky notes:', error)
    return []
  }
}

function saveNotes(notes: StickyNote[]): void {
  try {
    const filePath = getNotesFilePath()
    writeFileSync(filePath, JSON.stringify(notes, null, 2), 'utf-8')
  } catch (error) {
    console.error('Failed to save sticky notes:', error)
  }
}

function loadWindowForEditor(win: BrowserWindow, query: Record<string, string>): Promise<void> {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const params = new URLSearchParams(query)
    return win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${params.toString()}`)
  }
  return win.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

function createStickyEditorWindow(noteId: string): void {
  const display = screen.getPrimaryDisplay()
  const w = Math.round(display.bounds.width * 0.7)
  const h = Math.round(display.bounds.height * 0.8)
  const x = display.bounds.x + Math.round((display.bounds.width - w) / 2)
  const y = display.bounds.y + Math.round((display.bounds.height - h) / 2)
  const win = new BrowserWindow({
    x,
    y,
    width: w,
    height: h,
    show: false,
    frame: false,
    resizable: true,
    movable: true,
    fullscreen: false,
    skipTaskbar: true,
    backgroundColor: '#111827',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
      // devTools: false
    }
  })

  try {
    win.webContents.closeDevTools()
  } catch {
    // ignore
  }

  loadWindowForEditor(win, { mode: 'note-editor', id: noteId })
    .then(() => {
      win.show()
      win.focus()
    })
    .catch(() => null)
}

export function openQuickStickyNoteEditor(): void {
  const colors = ['#FFF8B8', '#E2F0CB', '#F0E6EF', '#E0F7FA', '#FFCCBC', '#FFCDD2', '#F5F5F5']
  const now = Date.now()
  const note: StickyNote = {
    id: randomUUID(),
    content: '',
    color: colors[Math.floor(Math.random() * colors.length)],
    createdAt: now,
    updatedAt: now
  }
  const notes = loadNotes()
  notes.push(note)
  saveNotes(notes)
  broadcastNotes(notes)
  createStickyEditorWindow(note.id)
}

export function registerStickyNotesHandlers(): void {
  ipcMain.handle(STICKY_NOTES_EVENTS.GET_ALL, () => {
    return loadNotes()
  })

  ipcMain.handle('sticky-editor:close', (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.hide()
        win.close()
      }
      return true
    } catch {
      console.error('Failed to close sticky editor window')
      return false
    }
  })

  ipcMain.handle(STICKY_NOTES_EVENTS.SAVE, (_, note: StickyNote) => {
    const notes = loadNotes()
    const index = notes.findIndex((n) => n.id === note.id)

    if (index >= 0) {
      notes[index] = { ...note, updatedAt: Date.now() }
    } else {
      notes.push({ ...note, createdAt: Date.now(), updatedAt: Date.now() })
    }

    saveNotes(notes)
    broadcastNotes(notes)
    return notes
  })

  ipcMain.handle(STICKY_NOTES_EVENTS.DELETE, (_, id: string) => {
    const notes = loadNotes()
    const newNotes = notes.filter((n) => n.id !== id)
    saveNotes(newNotes)
    broadcastNotes(newNotes)
    return newNotes
  })

  ipcMain.handle('sticky-editor:open', (_e, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return false
    const p = payload as { id?: unknown }
    const id = typeof p.id === 'string' ? p.id : ''
    if (!id) return false
    createStickyEditorWindow(id)
    return true
  })
}
