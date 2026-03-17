import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import {
  activateExternalWindow,
  getForegroundExternalWindow,
  hideExternalWindowToEdge,
  raiseExternalWindow,
  restoreExternalWindow,
  type ExternalWindowEdge,
  type ExternalWindowRect
} from './external-window'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'

type StashedWindow = {
  hwnd: string
  title: string
  edge: ExternalWindowEdge
  originalRect: ExternalWindowRect
  handle: BrowserWindow
  hoverTimer: NodeJS.Timeout | null
  peeking: boolean
  peekGraceUntilMs: number
}

type WindowStashListItem = { hwnd: string; title: string; edge: ExternalWindowEdge }

const stashed = new Map<string, StashedWindow>()

const HANDLE_THICKNESS = 26
const HANDLE_LENGTH = 92
const PEEK_PX = 0
const HOVER_POLL_MS = 110
const PEEK_GRACE_MS = 650
const LEAVE_MARGIN_PX = 6
const HANDLE_GAP_PX = 8
const HANDLE_TITLE_MAX_CHARS = 10

let loadWindowFn: ((win: BrowserWindow, query: Record<string, string>) => Promise<void>) | null =
  null
let getMainWindowFn: (() => BrowserWindow | null) | null = null
let getSettingsFn: (() => AppSettings) | null = null

function getStashSettings(): AppSettings['windowStash'] {
  const s = getSettingsFn?.()
  return s?.windowStash ?? DEFAULT_SETTINGS.windowStash
}

function normalizeHexColor(s: string): string | null {
  const v = typeof s === 'string' ? s.trim() : ''
  if (!v) return null
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : null
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function rectContainsPoint(
  rect: { left: number; top: number; right: number; bottom: number },
  point: { x: number; y: number },
  marginPx: number
): boolean {
  const m = Math.max(0, Math.round(marginPx))
  return (
    point.x >= rect.left - m &&
    point.x <= rect.right + m &&
    point.y >= rect.top - m &&
    point.y <= rect.bottom + m
  )
}

function browserWindowRect(win: BrowserWindow): {
  left: number
  top: number
  right: number
  bottom: number
} {
  const b = win.getBounds()
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height }
}

function truncateByCodePoints(value: string, maxChars: number): string {
  const s = typeof value === 'string' ? value : ''
  const max = clampNumber(Number(maxChars), 0, 200)
  if (!s || max <= 0) return ''
  const chars = Array.from(s)
  if (chars.length <= max) return s
  return chars.slice(0, max).join('')
}

function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
  gapPx: number
): boolean {
  const g = Math.max(0, Math.round(gapPx))
  return !(
    a.right + g <= b.left ||
    b.right + g <= a.left ||
    a.bottom + g <= b.top ||
    b.bottom + g <= a.top
  )
}

function listItems(): WindowStashListItem[] {
  return Array.from(stashed.values()).map((s) => ({ hwnd: s.hwnd, title: s.title, edge: s.edge }))
}

function broadcastChanged(): void {
  const mw = getMainWindowFn?.() ?? null
  if (!mw || mw.isDestroyed()) return
  if (mw.webContents.isLoading()) return
  mw.webContents.send('window-stash:changed', listItems())
}

function cleanupOne(hwnd: string): void {
  const s = stashed.get(hwnd)
  if (!s) return
  if (s.hoverTimer) clearInterval(s.hoverTimer)
  s.hoverTimer = null
  try {
    if (!s.handle.isDestroyed()) s.handle.close()
  } catch {
    void 0
  }
  stashed.delete(hwnd)
  broadcastChanged()
}

async function ensureHandleWindow(s: {
  hwnd: string
  title: string
  edge: ExternalWindowEdge
  rect: ExternalWindowRect
}): Promise<BrowserWindow | null> {
  if (!loadWindowFn) return null

  const display = screen.getDisplayNearestPoint({ x: s.rect.left, y: s.rect.top })
  const wa = display.workArea
  const vertical = s.edge === 'left' || s.edge === 'right'
  const width = vertical ? HANDLE_THICKNESS : HANDLE_LENGTH
  const height = vertical ? HANDLE_LENGTH : HANDLE_THICKNESS

  let x = wa.x + Math.round((wa.width - width) / 2)
  let y = wa.y + Math.round((wa.height - height) / 2)

  if (vertical) {
    y = clampNumber(s.rect.top + 64, wa.y, wa.y + wa.height - height)
    x = s.edge === 'left' ? wa.x : wa.x + wa.width - width
  } else {
    x = clampNumber(s.rect.left + 64, wa.x, wa.x + wa.width - width)
    y = s.edge === 'top' ? wa.y : wa.y + wa.height - height
  }

  const existingRects = Array.from(stashed.values())
    .filter((it) => it.edge === s.edge && !it.handle.isDestroyed())
    .map((it) => {
      const r = browserWindowRect(it.handle)
      const cx = Math.round((r.left + r.right) / 2)
      const cy = Math.round((r.top + r.bottom) / 2)
      const did = screen.getDisplayNearestPoint({ x: cx, y: cy }).id
      return did === display.id ? r : null
    })
    .filter((r): r is { left: number; top: number; right: number; bottom: number } => Boolean(r))

  if (existingRects.length) {
    const minCoord = vertical ? wa.y : wa.x
    const maxCoord = vertical ? wa.y + wa.height - height : wa.x + wa.width - width
    const desired = vertical ? y : x
    const step = (vertical ? height : width) + HANDLE_GAP_PX
    const maxSteps = Math.max(6, Math.ceil((maxCoord - minCoord + 1) / Math.max(1, step)) + 3)

    const overlaps = (px: number, py: number): boolean => {
      const r = { left: px, top: py, right: px + width, bottom: py + height }
      for (const ex of existingRects) {
        if (rectsOverlap(r, ex, HANDLE_GAP_PX)) return true
      }
      return false
    }

    let placed = false
    for (let i = 0; i <= maxSteps; i++) {
      const offsets = i === 0 ? [0] : [i * step, -i * step]
      for (const off of offsets) {
        const c = clampNumber(desired + off, minCoord, maxCoord)
        const px = vertical ? x : c
        const py = vertical ? c : y
        if (!overlaps(px, py)) {
          x = px
          y = py
          placed = true
          break
        }
      }
      if (placed) break
    }
  }

  const win = new BrowserWindow({
    x: Math.round(x),
    y: Math.round(y),
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  const query: Record<string, string> = { mode: 'stash-handle', hwnd: s.hwnd, edge: s.edge }
  const handleTitle = truncateByCodePoints(s.title.trim(), HANDLE_TITLE_MAX_CHARS)
  if (handleTitle) query['title'] = handleTitle
  const cfg = getStashSettings()
  const color = normalizeHexColor(cfg.handleColors?.[s.edge]) ?? null
  if (color) query['color'] = color

  loadWindowFn(win, query).catch(() => null)

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.showInactive()
  })

  win.on('closed', () => {
    cleanupOne(s.hwnd)
  })

  return win
}

async function collapseToEdge(hwnd: string): Promise<void> {
  const s = stashed.get(hwnd)
  if (!s) return
  if (s.peeking) s.peeking = false
  s.peekGraceUntilMs = 0
  const cfg = getStashSettings()
  const ret = await hideExternalWindowToEdge({
    hwnd,
    edge: s.edge,
    peekPx: PEEK_PX,
    animate: Boolean(cfg.animate),
    durationMs: cfg.durationMs
  })
  if (!ret.ok) {
    cleanupOne(hwnd)
  }
}

async function peekOut(hwnd: string): Promise<void> {
  const s = stashed.get(hwnd)
  if (!s) return
  if (s.peeking) return
  s.peeking = true
  const cfg = getStashSettings()

  const ret = await restoreExternalWindow({
    hwnd,
    rect: s.originalRect,
    animate: Boolean(cfg.animate),
    durationMs: cfg.durationMs
  })
  if (!ret.ok) {
    cleanupOne(hwnd)
    return
  }
  await raiseExternalWindow(hwnd)
  s.peekGraceUntilMs = Date.now() + PEEK_GRACE_MS

  if (s.hoverTimer) clearInterval(s.hoverTimer)
  s.hoverTimer = setInterval(async () => {
    if (Date.now() < s.peekGraceUntilMs) return
    const cur = screen.getCursorScreenPoint()
    const handleRect = browserWindowRect(s.handle)
    const inHandle = rectContainsPoint(handleRect, cur, 0)
    const inWindow = rectContainsPoint(s.originalRect, cur, LEAVE_MARGIN_PX)
    if (inHandle || inWindow) return

    if (s.hoverTimer) clearInterval(s.hoverTimer)
    s.hoverTimer = null
    await collapseToEdge(hwnd)
  }, HOVER_POLL_MS)
}

export function initWindowStash(opts: {
  loadWindow: (win: BrowserWindow, query: Record<string, string>) => Promise<void>
  getMainWindow: () => BrowserWindow | null
  getSettings: () => AppSettings
}): void {
  loadWindowFn = opts.loadWindow
  getMainWindowFn = opts.getMainWindow
  getSettingsFn = opts.getSettings

  ipcMain.handle('window-stash:list', () => listItems())

  ipcMain.on('window-stash:toggle', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as { hwnd?: unknown; activate?: unknown }
    const hwnd = typeof p.hwnd === 'string' ? p.hwnd.trim() : ''
    if (!hwnd) return
    const activate = Boolean(p.activate)
    if (stashed.has(hwnd)) {
      await restore(hwnd, activate)
      return
    }
  })

  ipcMain.on('window-stash:hover', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as { hwnd?: unknown; on?: unknown }
    const hwnd = typeof p.hwnd === 'string' ? p.hwnd.trim() : ''
    if (!hwnd) return
    const on = Boolean(p.on)
    if (!stashed.has(hwnd)) return
    if (on) await peekOut(hwnd)
    else await collapseToEdge(hwnd)
  })
}

export async function stashForegroundToEdge(edge: ExternalWindowEdge): Promise<void> {
  const fg = await getForegroundExternalWindow()
  if (!fg) return
  const hwnd = fg.hwnd
  const title = fg.title

  if (stashed.has(hwnd)) {
    await restore(hwnd, true)
    return
  }

  const cfg = getStashSettings()
  const ret = await hideExternalWindowToEdge({
    hwnd,
    edge,
    peekPx: PEEK_PX,
    animate: Boolean(cfg.animate),
    durationMs: cfg.durationMs
  })
  if (!ret.ok) return
  const rect = ret.rect
  if (!rect) return

  const handle = await ensureHandleWindow({ hwnd, title, edge, rect })
  if (!handle) {
    await restoreExternalWindow({
      hwnd,
      rect,
      animate: Boolean(cfg.animate),
      durationMs: cfg.durationMs
    })
    return
  }

  stashed.set(hwnd, {
    hwnd,
    title,
    edge,
    originalRect: rect,
    handle,
    hoverTimer: null,
    peeking: false,
    peekGraceUntilMs: 0
  })
  broadcastChanged()
}

export async function restore(hwnd: string, activate: boolean): Promise<void> {
  const s = stashed.get(hwnd)
  if (!s) return
  if (s.hoverTimer) clearInterval(s.hoverTimer)
  s.hoverTimer = null
  s.peeking = false
  s.peekGraceUntilMs = 0

  const cfg = getStashSettings()
  const ret = await restoreExternalWindow({
    hwnd,
    rect: s.originalRect,
    animate: Boolean(cfg.animate),
    durationMs: cfg.durationMs
  })
  cleanupOne(hwnd)
  if (activate && ret.ok) {
    await activateExternalWindow(hwnd)
  }
}

export async function restoreAllWindowStash(): Promise<void> {
  const items = Array.from(stashed.values())
  for (const s of items) {
    if (s.hoverTimer) clearInterval(s.hoverTimer)
    s.hoverTimer = null
    s.peeking = false
    s.peekGraceUntilMs = 0
  }
  for (const s of items) {
    try {
      await restoreExternalWindow({ hwnd: s.hwnd, rect: s.originalRect, animate: false })
    } catch {
      void 0
    }
    try {
      if (!s.handle.isDestroyed()) s.handle.close()
    } catch {
      void 0
    }
  }
  stashed.clear()
  broadcastChanged()
}

export function disposeAllWindowStash(): void {
  for (const s of stashed.values()) {
    if (s.hoverTimer) clearInterval(s.hoverTimer)
    s.hoverTimer = null
    try {
      if (!s.handle.isDestroyed()) s.handle.close()
    } catch {
      void 0
    }
  }
  stashed.clear()
  broadcastChanged()
}
