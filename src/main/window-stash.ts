import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { readFile, writeFile } from 'fs/promises'
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
  handleAlias?: string
  handleColor?: string
}

type WindowStashListItem = {
  hwnd: string
  title: string
  edge: ExternalWindowEdge
  handleAlias?: string
  handleColor?: string
}

const stashed = new Map<string, StashedWindow>()

type PersistedStashItem = {
  hwnd: string
  title?: string
  handleAlias?: string
  handleColor?: string
  edge: ExternalWindowEdge
  rect: ExternalWindowRect
  savedAtMs: number
  tries: number
  lastTriedAtMs: number | null
}

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
let suppressHandleClosedRestore = false

export async function getWindowStashPreviousExitClean(): Promise<boolean> {
  const s = await readPersistedSession()
  if (!s) return true
  return Boolean(s.clean)
}

export async function markWindowStashSessionRunning(): Promise<void> {
  await writePersistedSession(false)
}

export async function markWindowStashSessionClean(): Promise<void> {
  await writePersistedSession(true)
}

function stashStateFilePath(): string {
  return join(app.getPath('userData'), 'window-stash-state.json')
}

function stashSessionFilePath(): string {
  return join(app.getPath('userData'), 'window-stash-session.json')
}

type PersistedStashSession = { clean: boolean; updatedAtMs: number; pid: number }

function normalizePersistedSession(input: unknown): PersistedStashSession | null {
  if (!input || typeof input !== 'object') return null
  const p = input as Record<string, unknown>
  const clean = Boolean(p['clean'])
  const updatedAtMsRaw =
    typeof p['updatedAtMs'] === 'number' ? p['updatedAtMs'] : Number(p['updatedAtMs'])
  const pidRaw = typeof p['pid'] === 'number' ? p['pid'] : Number(p['pid'])
  const updatedAtMs = Number.isFinite(updatedAtMsRaw) ? Math.max(0, Math.floor(updatedAtMsRaw)) : 0
  const pid = Number.isFinite(pidRaw) ? Math.max(0, Math.floor(pidRaw)) : 0
  if (!pid) return null
  return { clean, updatedAtMs, pid }
}

async function readPersistedSession(): Promise<PersistedStashSession | null> {
  try {
    const raw = await readFile(stashSessionFilePath(), 'utf-8')
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return normalizePersistedSession(parsed)
  } catch {
    return null
  }
}

async function writePersistedSession(clean: boolean): Promise<void> {
  try {
    const payload: PersistedStashSession = {
      clean: Boolean(clean),
      updatedAtMs: Date.now(),
      pid: process.pid
    }
    await writeFile(stashSessionFilePath(), JSON.stringify(payload), 'utf-8')
  } catch {
    void 0
  }
}

function normalizePersistedItem(input: unknown): PersistedStashItem | null {
  if (!input || typeof input !== 'object') return null
  const p = input as Record<string, unknown>
  const hwnd = typeof p['hwnd'] === 'string' ? p['hwnd'].trim() : ''
  const title = typeof p['title'] === 'string' ? p['title'].trim() : ''
  const handleAliasRaw = typeof p['handleAlias'] === 'string' ? p['handleAlias'].trim() : ''
  const handleColorRaw = typeof p['handleColor'] === 'string' ? p['handleColor'].trim() : ''
  const handleColor = normalizeHexColor(handleColorRaw)
  const edge = p['edge']
  const rect = p['rect']
  if (!hwnd) return null
  if (edge !== 'left' && edge !== 'right' && edge !== 'top' && edge !== 'bottom') return null
  if (!rect || typeof rect !== 'object') return null
  const r = rect as Record<string, unknown>
  const left = typeof r['left'] === 'number' ? r['left'] : Number(r['left'])
  const top = typeof r['top'] === 'number' ? r['top'] : Number(r['top'])
  const right = typeof r['right'] === 'number' ? r['right'] : Number(r['right'])
  const bottom = typeof r['bottom'] === 'number' ? r['bottom'] : Number(r['bottom'])
  if (![left, top, right, bottom].every((n) => Number.isFinite(n))) return null
  const savedAtMsRaw = typeof p['savedAtMs'] === 'number' ? p['savedAtMs'] : Number(p['savedAtMs'])
  const savedAtMs = Number.isFinite(savedAtMsRaw) ? Math.max(0, Math.floor(savedAtMsRaw)) : 0
  const triesRaw = typeof p['tries'] === 'number' ? p['tries'] : Number(p['tries'])
  const tries = Number.isFinite(triesRaw) ? Math.max(0, Math.floor(triesRaw)) : 0
  const lastRaw =
    typeof p['lastTriedAtMs'] === 'number' ? p['lastTriedAtMs'] : Number(p['lastTriedAtMs'])
  const lastTriedAtMs = Number.isFinite(lastRaw) ? Math.max(0, Math.floor(lastRaw)) : null
  return {
    hwnd,
    title: title ? title : undefined,
    handleAlias: handleAliasRaw ? handleAliasRaw : undefined,
    handleColor: handleColor ? handleColor : undefined,
    edge,
    rect: { left, top, right, bottom },
    savedAtMs,
    tries,
    lastTriedAtMs
  }
}

async function readPersistedState(): Promise<PersistedStashItem[]> {
  try {
    const raw = await readFile(stashStateFilePath(), 'utf-8')
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizePersistedItem).filter((v): v is PersistedStashItem => Boolean(v))
  } catch {
    return []
  }
}

async function writePersistedState(items: PersistedStashItem[]): Promise<void> {
  try {
    await writeFile(stashStateFilePath(), JSON.stringify(items), 'utf-8')
  } catch {
    void 0
  }
}

let persistChain: Promise<void> = Promise.resolve()
function persistMutate(
  mutator: (items: PersistedStashItem[]) => PersistedStashItem[] | Promise<PersistedStashItem[]>
): Promise<void> {
  persistChain = persistChain
    .then(async () => {
      const cur = await readPersistedState()
      const next = await mutator(cur)
      await writePersistedState(next)
    })
    .catch(() => void 0)
  return persistChain
}

function getStashSettings(): AppSettings['windowStash'] {
  const s = getSettingsFn?.()
  return s?.windowStash ?? DEFAULT_SETTINGS.windowStash
}

function normalizeHexColor(s: string): string | null {
  const v = typeof s === 'string' ? s.trim() : ''
  if (!v) return null
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : null
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
  return Array.from(stashed.values()).map((s) => ({
    hwnd: s.hwnd,
    title: s.title,
    edge: s.edge,
    handleAlias: s.handleAlias,
    handleColor: s.handleColor
  }))
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
  persistMutate((items) => items.filter((it) => it.hwnd !== hwnd)).catch(() => null)
}

async function ensureHandleWindow(s: {
  hwnd: string
  title: string
  handleAlias?: string
  handleColor?: string
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

  win.setAlwaysOnTop(true, 'screen-saver', 10)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  const query: Record<string, string> = { mode: 'stash-handle', hwnd: s.hwnd, edge: s.edge }
  const handleTitle = truncateByCodePoints(
    (s.handleAlias ?? s.title).trim(),
    HANDLE_TITLE_MAX_CHARS
  )
  if (handleTitle) query['title'] = handleTitle
  const color = normalizeHexColor(s.handleColor ?? '') ?? null
  if (color) query['color'] = color

  loadWindowFn(win, query).catch(() => null)

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.showInactive()
  })

  win.on('closed', () => {
    if (suppressHandleClosedRestore) return
    const cur = stashed.get(s.hwnd)
    if (cur) {
      restore(cur.hwnd, false).catch(() => null)
      return
    }
    restoreExternalWindow({ hwnd: s.hwnd, rect: s.rect, animate: false }).catch(() => null)
    persistMutate((items) => items.filter((it) => it.hwnd !== s.hwnd)).catch(() => null)
  })

  return win
}

function sendHandleMetaToRenderer(s: StashedWindow): void {
  try {
    if (s.handle.isDestroyed()) return
    s.handle.webContents.send('window-stash:handle:update', {
      title: (s.handleAlias ?? '').trim(),
      color: (s.handleColor ?? '').trim()
    })
  } catch {
    void 0
  }
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
  suppressHandleClosedRestore = false
  app.on('before-quit', () => {
    suppressHandleClosedRestore = true
  })
  app.on('will-quit', () => {
    suppressHandleClosedRestore = true
  })

  ipcMain.handle('window-stash:list', () => listItems())

  ipcMain.handle('window-stash:update-meta', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return listItems()
    const p = payload as { hwnd?: unknown; handleAlias?: unknown; handleColor?: unknown }
    const hwnd = typeof p.hwnd === 'string' ? p.hwnd.trim() : ''
    if (!hwnd) return listItems()
    const cur = stashed.get(hwnd)
    if (!cur) return listItems()

    const hasAlias = Object.prototype.hasOwnProperty.call(p, 'handleAlias')
    const hasColor = Object.prototype.hasOwnProperty.call(p, 'handleColor')

    if (hasAlias) {
      const handleAlias = typeof p.handleAlias === 'string' ? p.handleAlias.trim() : ''
      cur.handleAlias = handleAlias ? handleAlias : undefined
    }

    if (hasColor) {
      const raw = typeof p.handleColor === 'string' ? p.handleColor.trim() : ''
      if (!raw) {
        cur.handleColor = undefined
      } else {
        const handleColor = normalizeHexColor(raw)
        if (handleColor) cur.handleColor = handleColor
      }
    }
    sendHandleMetaToRenderer(cur)
    broadcastChanged()

    await persistMutate((items) =>
      items.map((it) => {
        if (it.hwnd !== hwnd) return it
        return {
          ...it,
          handleAlias: cur.handleAlias,
          handleColor: cur.handleColor
        }
      })
    )

    return listItems()
  })

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

  ipcMain.on('window-stash:handle:nudge', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as { hwnd?: unknown; dx?: unknown; dy?: unknown }
    const hwnd = typeof p.hwnd === 'string' ? p.hwnd.trim() : ''
    if (!hwnd) return
    const s = stashed.get(hwnd)
    if (!s) return
    if (s.handle.isDestroyed()) return
    const dx = typeof p.dx === 'number' ? p.dx : Number(p.dx)
    const dy = typeof p.dy === 'number' ? p.dy : Number(p.dy)
    const ddx = Number.isFinite(dx) ? Math.round(dx) : 0
    const ddy = Number.isFinite(dy) ? Math.round(dy) : 0
    if (!ddx && !ddy) return

    const b = s.handle.getBounds()
    const vertical = s.edge === 'left' || s.edge === 'right'
    let x = b.x
    let y = b.y
    if (vertical) y += ddy
    else x += ddx

    const cx = Math.round(x + b.width / 2)
    const cy = Math.round(y + b.height / 2)
    const wa = screen.getDisplayNearestPoint({ x: cx, y: cy }).workArea

    if (vertical) {
      x = s.edge === 'left' ? wa.x : wa.x + wa.width - b.width
      y = clampNumber(y, wa.y, wa.y + wa.height - b.height)
    } else {
      y = s.edge === 'top' ? wa.y : wa.y + wa.height - b.height
      x = clampNumber(x, wa.x, wa.x + wa.width - b.width)
    }

    try {
      s.handle.setBounds({ x, y, width: b.width, height: b.height }, false)
    } catch {
      void 0
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
    peekGraceUntilMs: 0,
    handleAlias: undefined,
    handleColor: undefined
  })
  await persistMutate((items) => {
    const keep = items.filter((it) => it.hwnd !== hwnd)
    keep.push({
      hwnd,
      title: title.trim() ? title.trim() : undefined,
      handleAlias: undefined,
      handleColor: undefined,
      edge,
      rect,
      savedAtMs: Date.now(),
      tries: 0,
      lastTriedAtMs: null
    })
    return keep
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
  await persistMutate((items) => items.filter((it) => it.hwnd !== hwnd))
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

export async function rehydrateWindowStashFromDisk(): Promise<number> {
  if (!loadWindowFn) return 0
  const items = await readPersistedState()
  if (!items.length) return 0

  const now = Date.now()
  const outcomes = new Map<
    string,
    { kind: 'drop' } | { kind: 'set'; item: PersistedStashItem } | { kind: 'noop' }
  >()
  let hydrated = 0
  const maxTries = 6

  for (const it of items) {
    const hwnd = it.hwnd
    if (!hwnd) continue
    if (stashed.has(hwnd)) {
      outcomes.set(hwnd, { kind: 'noop' })
      hydrated += 1
      continue
    }

    const title = typeof it.title === 'string' ? it.title : ''
    let rect = it.rect

    try {
      const ret = await hideExternalWindowToEdge({
        hwnd,
        edge: it.edge,
        peekPx: PEEK_PX,
        animate: false
      })
      if (!ret.ok) throw new Error('hide failed')
      if (ret.rect) rect = ret.rect

      const handle = await ensureHandleWindow({
        hwnd,
        title,
        handleAlias: it.handleAlias,
        handleColor: it.handleColor,
        edge: it.edge,
        rect
      })
      if (!handle) {
        await restoreExternalWindow({ hwnd, rect, animate: false })
        throw new Error('handle failed')
      }

      stashed.set(hwnd, {
        hwnd,
        title,
        edge: it.edge,
        originalRect: rect,
        handle,
        hoverTimer: null,
        peeking: false,
        peekGraceUntilMs: 0,
        handleAlias: it.handleAlias,
        handleColor: it.handleColor
      })
      hydrated += 1
      outcomes.set(hwnd, {
        kind: 'set',
        item: {
          hwnd,
          title: title.trim() ? title.trim() : undefined,
          handleAlias: it.handleAlias,
          handleColor: it.handleColor,
          edge: it.edge,
          rect,
          savedAtMs: it.savedAtMs || now,
          tries: 0,
          lastTriedAtMs: null
        }
      })
    } catch {
      const tries = Math.max(0, it.tries) + 1
      if (tries >= maxTries) {
        outcomes.set(hwnd, { kind: 'drop' })
      } else {
        outcomes.set(hwnd, {
          kind: 'set',
          item: {
            ...it,
            title: title.trim() ? title.trim() : undefined,
            rect,
            tries,
            lastTriedAtMs: now
          }
        })
      }
    }
  }

  await persistMutate((cur) => {
    const map = new Map(cur.map((it) => [it.hwnd, it] as const))
    for (const [hwnd, oc] of outcomes) {
      if (oc.kind === 'noop') continue
      if (oc.kind === 'drop') map.delete(hwnd)
      else map.set(hwnd, oc.item)
    }
    return Array.from(map.values())
  })
  broadcastChanged()
  return hydrated
}

export async function restoreAndClearPersistedWindowStash(): Promise<number> {
  const items = await readPersistedState()
  if (!items.length) {
    await writePersistedState([])
    return 0
  }
  let restored = 0
  for (const it of items) {
    try {
      const ret = await restoreExternalWindow({ hwnd: it.hwnd, rect: it.rect, animate: false })
      if (ret.ok) restored += 1
    } catch {
      void 0
    }
  }
  await writePersistedState([])
  return restored
}
