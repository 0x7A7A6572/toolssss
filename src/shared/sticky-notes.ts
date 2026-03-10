export interface StickyNote {
  id: string
  content: string // HTML content
  color: string // Hex color
  createdAt: number
  updatedAt: number
}

export const STICKY_NOTES_EVENTS = {
  GET_ALL: 'sticky-notes:get-all',
  SAVE: 'sticky-notes:save',
  DELETE: 'sticky-notes:delete'
} as const
