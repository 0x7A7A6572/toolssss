import { app, ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { STICKY_NOTES_EVENTS, type StickyNote } from '../shared/sticky-notes'

const NOTES_FILE = 'sticky-notes.json'

function getNotesFilePath(): string {
  return join(app.getPath('userData'), NOTES_FILE)
}

function loadNotes(): StickyNote[] {
  try {
    const filePath = getNotesFilePath()
    if (!existsSync(filePath)) {
      return []
    }
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
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

export function registerStickyNotesHandlers(): void {
  ipcMain.handle(STICKY_NOTES_EVENTS.GET_ALL, () => {
    return loadNotes()
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
    return notes
  })

  ipcMain.handle(STICKY_NOTES_EVENTS.DELETE, (_, id: string) => {
    const notes = loadNotes()
    const newNotes = notes.filter((n) => n.id !== id)
    saveNotes(newNotes)
    return newNotes
  })
}
