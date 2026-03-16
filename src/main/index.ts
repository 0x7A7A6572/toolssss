import { exec } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  Tray,
  Menu,
  globalShortcut,
  clipboard,
  nativeImage,
  safeStorage,
  type MenuItemConstructorOptions,
  type OpenDialogOptions
} from 'electron'

const execAsync = promisify(exec)
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve, sep } from 'path'
import { promises as fsp } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  DEFAULT_SETTINGS,
  type AlarmReason,
  type AppSettings,
  type SettingsPatch
} from '@shared/settings'
import {
  openQuickStickyNoteEditor,
  registerStickyNotesHandlers,
  setStickyNotesSaveDir
} from './sticky-notes'
import { registerWeatherHandlers } from './weather'
import { registerScriptLibraryHandlers } from './script-library'
import { TRANSLATOR_EVENTS, type TranslatePayload, type TranslateResult } from '@shared/translator'
import Screenshots from '../libs/electron-screenshots/index'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let translatorPopupWindow: BrowserWindow | null = null
let screenshots: Screenshots | null = null
let isScreenshotsHooked = false
let snipCapturing = false

let settings: AppSettings = DEFAULT_SETTINGS
const overlayWindows = new Map<number, BrowserWindow>()
const alarmWindows = new Map<number, BrowserWindow>()
const stickerWindows = new Map<number, BrowserWindow>()
const stickerAspectRatios = new Map<number, number>()
let stickersHidden = false
let overlaySuspended = false

const snipShortcutDebug = Boolean(is.dev) || process.env.SNIP_SHORTCUT_DEBUG === '1'

function snipDbg(...args: unknown[]): void {
  if (!snipShortcutDebug) return
  console.log('[snip-shortcut]', ...args)
}

function setSnipCapturing(next: boolean): void {
  if (snipCapturing === next) return
  snipCapturing = next
  snipDbg('snipCapturing', snipCapturing)
  ensureShortcuts()
}

let dailyAlarmTimer: NodeJS.Timeout | undefined
let breakTimer: NodeJS.Timeout | undefined
let snoozeTimer: NodeJS.Timeout | undefined
let lastAlarmPayload: { reason: AlarmReason; title: string; body: string } | null = null
let breakNextAt: number | null = null
let restTipsCache: string[] | null = null
const snipSavedThumbCache = new Map<string, string | null>()

function getBreakStatus(): { enabled: boolean; intervalMinutes: number; nextAt: number | null } {
  return {
    enabled: settings.break.enabled,
    intervalMinutes: settings.break.intervalMinutes,
    nextAt: breakNextAt
  }
}

function broadcastBreakStatus(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.webContents.isLoading()) return
  mainWindow.webContents.send('break:status', getBreakStatus())
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalizeTimeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isInteger(h) || !Number.isInteger(mm)) return null
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function normalizeSettings(input: unknown): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS)
  if (!input || typeof input !== 'object') return base
  const obj = input as Partial<AppSettings>

  if (obj.general) {
    base.general.minimizeToTray = Boolean(obj.general.minimizeToTray)
    base.general.autoStart = Boolean(obj.general.autoStart)
  }

  if (obj.snip) {
    base.snip.enabled = typeof obj.snip.enabled === 'boolean' ? obj.snip.enabled : base.snip.enabled
    base.snip.provider = 'app'
    base.snip.saveDir = typeof obj.snip.saveDir === 'string' ? obj.snip.saveDir : base.snip.saveDir
    const sn = obj.snip as Record<string, unknown>
    const suspendEyeOverlay = sn['suspendEyeOverlay']
    if (typeof suspendEyeOverlay === 'boolean') {
      base.snip.suspendEyeOverlay = suspendEyeOverlay
    } else {
      const eye = obj.eye as Record<string, unknown> | undefined
      const legacySuspendOnSnip = eye?.['suspendOnSnip']
      if (typeof legacySuspendOnSnip === 'boolean')
        base.snip.suspendEyeOverlay = legacySuspendOnSnip
    }
  }

  if (
    (obj as { stickyNotes?: unknown }).stickyNotes &&
    typeof (obj as { stickyNotes?: unknown }).stickyNotes === 'object'
  ) {
    const sn = (obj as { stickyNotes: Record<string, unknown> }).stickyNotes
    base.stickyNotes.saveDir =
      typeof sn['saveDir'] === 'string' ? (sn['saveDir'] as string) : base.stickyNotes.saveDir
  }

  if (obj.shortcuts) {
    if (typeof obj.shortcuts.toggleEye === 'string')
      base.shortcuts.toggleEye = obj.shortcuts.toggleEye
    if (typeof (obj.shortcuts as Record<string, unknown>).translateSelection === 'string')
      base.shortcuts.translateSelection = (
        obj.shortcuts as Record<string, string>
      ).translateSelection
    if (typeof (obj.shortcuts as Record<string, unknown>).stickyNotesPopup === 'string')
      base.shortcuts.stickyNotesPopup = (obj.shortcuts as Record<string, string>).stickyNotesPopup
    if (typeof (obj.shortcuts as Record<string, unknown>).snipStart === 'string')
      base.shortcuts.snipStart = (obj.shortcuts as Record<string, string>).snipStart
    if (typeof (obj.shortcuts as Record<string, unknown>).stickerPaste === 'string')
      base.shortcuts.stickerPaste = (obj.shortcuts as Record<string, string>).stickerPaste
    if (typeof (obj.shortcuts as Record<string, unknown>).stickersToggleHidden === 'string')
      base.shortcuts.stickersToggleHidden = (
        obj.shortcuts as Record<string, string>
      ).stickersToggleHidden
  }

  if (
    (obj as { translate?: unknown }).translate &&
    typeof (obj as { translate?: unknown }).translate === 'object'
  ) {
    const tr = (obj as { translate: Record<string, unknown> }).translate
    const provider = tr['provider']
    if (provider === 'baidu' || provider === 'bing' || provider === 'ai')
      base.translate.provider = provider
    if (typeof tr['defaultSource'] === 'string')
      base.translate.defaultSource = tr['defaultSource'].trim()
    if (typeof tr['defaultTarget'] === 'string')
      base.translate.defaultTarget = tr['defaultTarget'].trim()

    const baidu = tr['baidu']
    if (baidu && typeof baidu === 'object') {
      const b = baidu as Record<string, unknown>
      if (typeof b['baseUrl'] === 'string') base.translate.baidu.baseUrl = b['baseUrl'].trim()
      if (typeof b['appId'] === 'string') base.translate.baidu.appId = b['appId'].trim()
      if (typeof b['secret'] === 'string') base.translate.baidu.secret = b['secret']
    } else {
      const legacyBaseUrl = tr['baseUrl']
      if (typeof legacyBaseUrl === 'string' && legacyBaseUrl.trim())
        base.translate.baidu.baseUrl = legacyBaseUrl.trim()
      const legacyKey = tr['apiKey']
      if (typeof legacyKey === 'string') base.translate.baidu.secret = legacyKey
      const legacyAppId = tr['appId']
      if (typeof legacyAppId === 'string') base.translate.baidu.appId = legacyAppId.trim()
    }

    const bing = tr['bing']
    if (bing && typeof bing === 'object') {
      const b = bing as Record<string, unknown>
      if (typeof b['baseUrl'] === 'string') base.translate.bing.baseUrl = b['baseUrl'].trim()
      if (typeof b['key'] === 'string') base.translate.bing.key = b['key']
      if (typeof b['region'] === 'string') base.translate.bing.region = b['region'].trim()
    }
  }

  if ((obj as { ai?: unknown }).ai && typeof (obj as { ai?: unknown }).ai === 'object') {
    const ai = (obj as { ai: Record<string, unknown> }).ai
    base.ai.enabled = Boolean(ai['enabled'])
    const provider = ai['provider']
    if (
      provider === 'openai' ||
      provider === 'gmini' ||
      provider === 'kimi' ||
      provider === 'qwen' ||
      provider === 'custom'
    )
      base.ai.provider = provider
    if (typeof ai['baseUrl'] === 'string') base.ai.baseUrl = ai['baseUrl'].trim()
    if (typeof ai['model'] === 'string') base.ai.model = ai['model'].trim()
    if (typeof ai['apiKeySet'] === 'boolean') base.ai.apiKeySet = ai['apiKeySet'] as boolean
  }

  base.eye.enabled = Boolean(obj.eye?.enabled)
  base.eye.opacity = clampNumber(Number(obj.eye?.opacity), 0, 0.7)
  if (typeof obj.eye?.color === 'string' && obj.eye.color.trim()) {
    base.eye.color = obj.eye.color.trim()
  }

  const rs = (obj as { reminderSeconds?: unknown }).reminderSeconds
  if (typeof rs === 'number') {
    base.reminderSeconds = clampNumber(rs, 5, 600)
  }

  base.alarm.enabled = Boolean(obj.alarm?.enabled)
  base.alarm.time = normalizeTimeString(obj.alarm?.time) ?? base.alarm.time
  base.alarm.label =
    typeof obj.alarm?.label === 'string' && obj.alarm.label.trim()
      ? obj.alarm.label.trim()
      : base.alarm.label

  base.break.enabled = Boolean(obj.break?.enabled)
  base.break.intervalMinutes = clampNumber(Number(obj.break?.intervalMinutes), 5, 240)
  base.break.disableInFullscreen =
    typeof obj.break?.disableInFullscreen === 'boolean'
      ? obj.break.disableInFullscreen
      : base.break.disableInFullscreen

  return base
}

function applySettingsPatch(patch: unknown): AppSettings {
  if (!patch || typeof patch !== 'object') return settings
  const p = patch as SettingsPatch
  const next: AppSettings = structuredClone(settings)

  if (p.general) {
    if (typeof p.general.minimizeToTray === 'boolean')
      next.general.minimizeToTray = p.general.minimizeToTray
    if (typeof p.general.autoStart === 'boolean') next.general.autoStart = p.general.autoStart
  }

  if (p.snip) {
    if (typeof p.snip.enabled === 'boolean') next.snip.enabled = p.snip.enabled
    if (p.snip.provider === 'app') next.snip.provider = p.snip.provider
    if (typeof p.snip.saveDir === 'string') next.snip.saveDir = p.snip.saveDir
    if (typeof (p.snip as Record<string, unknown>).suspendEyeOverlay === 'boolean')
      next.snip.suspendEyeOverlay = (p.snip as Record<string, boolean>).suspendEyeOverlay
  }

  if (
    (p as { stickyNotes?: unknown }).stickyNotes &&
    typeof (p as { stickyNotes?: unknown }).stickyNotes === 'object'
  ) {
    const sn = (p as { stickyNotes: Record<string, unknown> }).stickyNotes
    if (typeof sn['saveDir'] === 'string') next.stickyNotes.saveDir = sn['saveDir'] as string
  }

  if (p.shortcuts) {
    if (typeof p.shortcuts.toggleEye === 'string') next.shortcuts.toggleEye = p.shortcuts.toggleEye
    if (typeof (p.shortcuts as Record<string, unknown>).translateSelection === 'string')
      next.shortcuts.translateSelection = (p.shortcuts as Record<string, string>).translateSelection
    if (typeof (p.shortcuts as Record<string, unknown>).stickyNotesPopup === 'string')
      next.shortcuts.stickyNotesPopup = (p.shortcuts as Record<string, string>).stickyNotesPopup
    if (typeof (p.shortcuts as Record<string, unknown>).snipStart === 'string')
      next.shortcuts.snipStart = (p.shortcuts as Record<string, string>).snipStart
    if (typeof (p.shortcuts as Record<string, unknown>).stickerPaste === 'string')
      next.shortcuts.stickerPaste = (p.shortcuts as Record<string, string>).stickerPaste
    if (typeof (p.shortcuts as Record<string, unknown>).stickersToggleHidden === 'string')
      next.shortcuts.stickersToggleHidden = (
        p.shortcuts as Record<string, string>
      ).stickersToggleHidden
  }

  if (
    (p as { translate?: unknown }).translate &&
    typeof (p as { translate?: unknown }).translate === 'object'
  ) {
    const tr = (p as { translate: Record<string, unknown> }).translate
    const provider = tr['provider']
    if (provider === 'baidu' || provider === 'bing' || provider === 'ai')
      next.translate.provider = provider
    if (typeof tr['defaultSource'] === 'string') next.translate.defaultSource = tr['defaultSource']
    if (typeof tr['defaultTarget'] === 'string') next.translate.defaultTarget = tr['defaultTarget']

    const baidu = tr['baidu']
    if (baidu && typeof baidu === 'object') {
      const b = baidu as Record<string, unknown>
      if (typeof b['baseUrl'] === 'string') next.translate.baidu.baseUrl = b['baseUrl']
      if (typeof b['appId'] === 'string') next.translate.baidu.appId = b['appId']
      if (typeof b['secret'] === 'string') next.translate.baidu.secret = b['secret']
    }

    const bing = tr['bing']
    if (bing && typeof bing === 'object') {
      const b = bing as Record<string, unknown>
      if (typeof b['baseUrl'] === 'string') next.translate.bing.baseUrl = b['baseUrl']
      if (typeof b['key'] === 'string') next.translate.bing.key = b['key']
      if (typeof b['region'] === 'string') next.translate.bing.region = b['region']
    }
  }

  if ((p as { ai?: unknown }).ai && typeof (p as { ai?: unknown }).ai === 'object') {
    const ai = (p as { ai: Record<string, unknown> }).ai
    if (typeof ai['enabled'] === 'boolean') next.ai.enabled = ai['enabled'] as boolean
    const provider = ai['provider']
    if (
      provider === 'openai' ||
      provider === 'gmini' ||
      provider === 'kimi' ||
      provider === 'qwen' ||
      provider === 'custom'
    )
      next.ai.provider = provider
    if (typeof ai['baseUrl'] === 'string') next.ai.baseUrl = ai['baseUrl'] as string
    if (typeof ai['model'] === 'string') next.ai.model = ai['model'] as string
    if (typeof ai['apiKeySet'] === 'boolean') next.ai.apiKeySet = ai['apiKeySet'] as boolean
  }

  if (p.eye) {
    if (typeof p.eye.enabled === 'boolean') next.eye.enabled = p.eye.enabled
    if (typeof p.eye.opacity === 'number') next.eye.opacity = p.eye.opacity
    if (typeof p.eye.color === 'string') next.eye.color = p.eye.color
  }

  if (p.alarm) {
    if (typeof p.alarm.enabled === 'boolean') next.alarm.enabled = p.alarm.enabled
    if (typeof p.alarm.time === 'string') next.alarm.time = p.alarm.time
    if (typeof p.alarm.label === 'string') next.alarm.label = p.alarm.label
  }

  if (p.break) {
    if (typeof p.break.enabled === 'boolean') next.break.enabled = p.break.enabled
    if (typeof p.break.intervalMinutes === 'number')
      next.break.intervalMinutes = p.break.intervalMinutes
    if (typeof p.break.disableInFullscreen === 'boolean')
      next.break.disableInFullscreen = p.break.disableInFullscreen
  }
  {
    const rsv = (p as { reminderSeconds?: unknown }).reminderSeconds
    if (typeof rsv === 'number') {
      next.reminderSeconds = clampNumber(rsv, 5, 600)
    }
  }

  return normalizeSettings(next)
}

type StickerPayload = { kind: 'image' | 'text' | 'color'; data: string }
type StickerOcrBBox = { x0: number; y0: number; x1: number; y1: number }
type StickerOcrLine = { text: string; bbox: StickerOcrBBox; confidence: number }
type StickerOcrResult = { width: number; height: number; text: string; lines: StickerOcrLine[] }

function normalizeClipboardColorText(text: string): string | null {
  const raw = text.trim()
  if (!raw) return null
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    let v = hex[1].toLowerCase()
    if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2]
    return `#${v}`
  }

  const rgb = raw.match(/^rgb\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)$/i)
  if (rgb) {
    const r = clampNumber(Number(rgb[1]), 0, 255)
    const g = clampNumber(Number(rgb[2]), 0, 255)
    const b = clampNumber(Number(rgb[3]), 0, 255)
    return (
      '#' +
      [r, g, b]
        .map((n) => Math.round(n).toString(16).padStart(2, '0'))
        .join('')
        .toLowerCase()
    )
  }

  const tripleInt = raw.match(/^(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})$/)
  if (tripleInt) {
    const r = clampNumber(Number(tripleInt[1]), 0, 255)
    const g = clampNumber(Number(tripleInt[2]), 0, 255)
    const b = clampNumber(Number(tripleInt[3]), 0, 255)
    return (
      '#' +
      [r, g, b]
        .map((n) => Math.round(n).toString(16).padStart(2, '0'))
        .join('')
        .toLowerCase()
    )
  }

  return null
}

function readClipboardAsStickerPayload(): StickerPayload | null {
  const image = clipboard.readImage()
  if (!image.isEmpty()) {
    return { kind: 'image', data: image.toDataURL() }
  }

  const text = clipboard.readText()
  const color = normalizeClipboardColorText(text)
  if (color) return { kind: 'color', data: color }
  if (text && text.trim()) return { kind: 'text', data: text }

  return null
}

let stickerOcrWorkerLoading: Promise<{
  recognize: (image: Buffer) => Promise<unknown>
  terminate: () => Promise<void>
}> | null = null
let stickerOcrWorker: {
  recognize: (image: Buffer) => Promise<unknown>
  terminate: () => Promise<void>
} | null = null
let stickerOcrProgressSink: ((payload: unknown) => void) | null = null
const stickerOcrCache = new Map<string, StickerOcrResult>()
const stickerOcrInFlight = new Map<string, Promise<StickerOcrResult | null>>()

async function getStickerOcrWorker(): Promise<{
  recognize: (image: Buffer) => Promise<unknown>
  terminate: () => Promise<void>
}> {
  if (stickerOcrWorker) return stickerOcrWorker
  if (!stickerOcrWorkerLoading) {
    stickerOcrWorkerLoading = (async () => {
      const cachePath = join(app.getPath('userData'), 'tesseract-cache')
      try {
        await fsp.mkdir(cachePath, { recursive: true })
      } catch {
        void 0
      }

      const bundledLangPath = join(process.resourcesPath, 'tessdata')
      let langPath: string | undefined = existsSync(join(bundledLangPath, 'chi_sim.traineddata.gz'))
        ? bundledLangPath
        : undefined

      if (!langPath) {
        try {
          const appRoot = app.getAppPath()
          const chiSrc = join(
            appRoot,
            'node_modules',
            '@tesseract.js-data',
            'chi_sim',
            '4.0.0_best_int',
            'chi_sim.traineddata.gz'
          )
          const engSrc = join(
            appRoot,
            'node_modules',
            '@tesseract.js-data',
            'eng',
            '4.0.0_best_int',
            'eng.traineddata.gz'
          )
          if (existsSync(chiSrc) && existsSync(engSrc)) {
            const devLangPath = join(app.getPath('userData'), 'tessdata-dev')
            try {
              await fsp.mkdir(devLangPath, { recursive: true })
            } catch {
              // ignore
            }
            const chiDst = join(devLangPath, 'chi_sim.traineddata.gz')
            const engDst = join(devLangPath, 'eng.traineddata.gz')
            try {
              await fsp.copyFile(chiSrc, chiDst)
            } catch {
              // ignore
            }
            try {
              await fsp.copyFile(engSrc, engDst)
            } catch {
              // ignore
            }
            if (existsSync(chiDst) && existsSync(engDst)) {
              langPath = devLangPath
            }
          }
        } catch {
          // ignore
        }
      }

      const mod = await import('tesseract.js')
      const createWorker = (
        mod as unknown as {
          createWorker?: (
            lang: string,
            oem?: number,
            options?: Record<string, unknown>
          ) => Promise<unknown>
        }
      ).createWorker
      if (!createWorker) throw new Error('tesseract.js createWorker unavailable')
      const worker = (await createWorker('chi_sim+eng', 1, {
        cachePath,
        langPath,
        gzip: true,
        logger: (m: unknown) => {
          try {
            stickerOcrProgressSink?.(m)
          } catch {
            // ignore
          }
        }
      })) as unknown as {
        recognize: (image: Buffer) => Promise<unknown>
        terminate: () => Promise<void>
      }
      return worker
    })()
  }
  stickerOcrWorker = await stickerOcrWorkerLoading
  return stickerOcrWorker
}

function normalizeStickerOcrResult(raw: unknown, width: number, height: number): StickerOcrResult {
  const data = raw && typeof raw === 'object' ? (raw as { data?: unknown }).data : null
  const text =
    data && typeof data === 'object' ? String((data as { text?: unknown }).text ?? '') : ''
  const linesRaw =
    data && typeof data === 'object' && Array.isArray((data as { lines?: unknown }).lines)
      ? ((data as { lines: unknown[] }).lines as unknown[])
      : []

  const lines: StickerOcrLine[] = []
  for (const it of linesRaw) {
    if (!it || typeof it !== 'object') continue
    const line = it as { text?: unknown; confidence?: unknown; bbox?: unknown }
    const lineText = typeof line.text === 'string' ? line.text.trim() : ''
    if (!lineText) continue
    const bbox =
      line.bbox && typeof line.bbox === 'object' ? (line.bbox as Partial<StickerOcrBBox>) : null
    const x0 = Number(bbox?.x0)
    const y0 = Number(bbox?.y0)
    const x1 = Number(bbox?.x1)
    const y1 = Number(bbox?.y1)
    if (
      !Number.isFinite(x0) ||
      !Number.isFinite(y0) ||
      !Number.isFinite(x1) ||
      !Number.isFinite(y1)
    )
      continue
    const confidence = Number(line.confidence)
    lines.push({
      text: lineText,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      bbox: {
        x0: clampNumber(x0, 0, width),
        y0: clampNumber(y0, 0, height),
        x1: clampNumber(x1, 0, width),
        y1: clampNumber(y1, 0, height)
      }
    })
  }

  return { width, height, text, lines }
}

async function recognizeStickerImageText(dataUrl: string): Promise<StickerOcrResult | null> {
  if (!dataUrl.startsWith('data:image/')) return null

  const cacheKey = createHash('sha1').update(dataUrl).digest('hex')
  const cached = stickerOcrCache.get(cacheKey)
  if (cached) return cached

  const inflight = stickerOcrInFlight.get(cacheKey)
  if (inflight) return inflight

  const job = (async () => {
    try {
      const img = nativeImage.createFromDataURL(dataUrl)
      if (img.isEmpty()) return null
      const size = img.getSize()
      const width = Math.max(1, Math.round(size.width))
      const height = Math.max(1, Math.round(size.height))
      const png = img.toPNG()
      const worker = await getStickerOcrWorker()
      const ret = await worker.recognize(png)
      const result = normalizeStickerOcrResult(ret, width, height)
      stickerOcrCache.set(cacheKey, result)
      if (stickerOcrCache.size > 20) {
        const oldest = stickerOcrCache.keys().next().value as string | undefined
        if (oldest) stickerOcrCache.delete(oldest)
      }
      return result
    } catch {
      return null
    } finally {
      stickerOcrInFlight.delete(cacheKey)
    }
  })()

  stickerOcrInFlight.set(cacheKey, job)
  return job
}

function createStickerWindow(payload: StickerPayload): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const work = display.workArea

  let w = 460
  let h = 360
  let aspectRatio: number | null = null
  if (payload.kind === 'image') {
    const image = payload.data.startsWith('data:')
      ? nativeImage.createFromDataURL(payload.data)
      : clipboard.readImage()
    const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize()
    const rawW = Number(size.width) || 0
    const rawH = Number(size.height) || 0
    if (rawW > 0 && rawH > 0) {
      const iw = Math.round(rawW)
      const ih = Math.round(rawH)
      const maxW = Math.max(360, Math.round(work.width * 0.38))
      const maxH = Math.max(260, Math.round(work.height * 0.38))
      const minW = 90
      const minH = 90
      const maxScale = Math.min(maxW / iw, maxH / ih)
      const minScale = Math.max(minW / iw, minH / ih)
      let s = 1
      if (Number.isFinite(maxScale)) s = Math.min(s, maxScale)
      if (Number.isFinite(minScale)) s = Math.max(s, minScale)
      if (Number.isFinite(maxScale) && Number.isFinite(minScale) && maxScale < minScale)
        s = maxScale
      const ratio = iw / ih
      let nextW = Math.round(iw * s)
      let nextH = Math.round(ih * s)
      const enforceMax = (): void => {
        if (nextW > maxW) {
          nextW = maxW
          nextH = Math.round(nextW / ratio)
        }
        if (nextH > maxH) {
          nextH = maxH
          nextW = Math.round(nextH * ratio)
        }
      }
      const enforceMin = (): void => {
        if (nextW < minW) {
          nextW = minW
          nextH = Math.round(nextW / ratio)
        }
        if (nextH < minH) {
          nextH = minH
          nextW = Math.round(nextH * ratio)
        }
      }
      enforceMax()
      enforceMin()
      enforceMax()
      w = nextW
      h = nextH
      aspectRatio = ratio
    }
  } else if (payload.kind === 'color') {
    w = 260
    h = 220
  }

  const x = work.x + Math.round((work.width - w) / 2)
  const y = work.y + Math.round((work.height - h) / 2)

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
    alwaysOnTop: true,
    hasShadow: false,
    transparent: true,
    backgroundColor: '#00000000',
    ...(process.platform === 'linux'
      ? {
          icon
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0) {
    try {
      win.setAspectRatio(aspectRatio)
      stickerAspectRatios.set(win.id, aspectRatio)
    } catch {
      void 0
    }
  }

  loadWindow(win, { mode: 'sticker' }).catch(() => null)

  win.webContents.on('context-menu', (event) => {
    event.preventDefault()
    showStickerContextMenu(win, payload)
  })

  win.webContents.once('did-finish-load', () => {
    try {
      win.webContents.send('sticker:init', payload)
    } catch {
      // ignore
    }
    win.showInactive()
    try {
      app.focus()
    } catch {
      // ignore
    }
    win.moveTop()
    win.focus()
  })

  win.on('closed', () => {
    stickerWindows.delete(win.id)
    stickerAspectRatios.delete(win.id)
  })

  stickerWindows.set(win.id, win)
  return win
}

function showStickerContextMenu(win: BrowserWindow, payload: StickerPayload | null): void {
  const kind =
    payload?.kind === 'image' || payload?.kind === 'text' || payload?.kind === 'color'
      ? payload.kind
      : null
  const data = typeof payload?.data === 'string' ? payload.data : ''
  const hasData = Boolean(kind && data)

  const doCopy = (): void => {
    if (!hasData || !kind) return
    try {
      if (kind === 'image') {
        const img = nativeImage.createFromDataURL(data)
        if (!img.isEmpty()) clipboard.writeImage(img)
        return
      }
      clipboard.writeText(data)
    } catch {
      return
    }
  }

  const doSaveAs = async (): Promise<void> => {
    if (!hasData || !kind) return
    const ts = formatSnipFileName(Date.now()).replace(/\.png$/i, '')
    const ext = kind === 'image' ? 'png' : 'txt'
    const result = await dialog.showSaveDialog(win, {
      defaultPath: join(app.getPath('pictures'), `toolssss-sticker-${ts}.${ext}`),
      filters:
        kind === 'image'
          ? [{ name: 'PNG Image', extensions: ['png'] }]
          : [{ name: 'Text', extensions: ['txt'] }]
    })
    if (result.canceled || !result.filePath) return

    try {
      if (kind === 'image') {
        const img = nativeImage.createFromDataURL(data)
        if (img.isEmpty()) return
        await fsp.writeFile(result.filePath, img.toPNG())
        return
      }
      await fsp.writeFile(result.filePath, data, 'utf-8')
    } catch {
      return
    }
  }

  const labelCopy =
    kind === 'image'
      ? '复制图片'
      : kind === 'text'
        ? '复制文本'
        : kind === 'color'
          ? '复制颜色'
          : '复制'

  const template: MenuItemConstructorOptions[] = [
    { label: labelCopy, enabled: hasData, click: () => doCopy() },
    { label: '另存为', enabled: hasData, click: () => void doSaveAs() }
  ]

  if (kind === 'image') {
    const ocrSubmenu: MenuItemConstructorOptions[] = [
      {
        label: '开始识别',
        enabled: hasData,
        click: () => {
          try {
            win.webContents.send('sticker:ocr:run')
          } catch {
            // ignore
          }
        }
      },
      {
        label: '复制选中文本',
        enabled: hasData,
        click: () => {
          try {
            win.webContents.send('sticker:ocr:copy-selection')
          } catch {
            // ignore
          }
        }
      },
      {
        label: '清除识别结果',
        enabled: hasData,
        click: () => {
          try {
            win.webContents.send('sticker:ocr:clear')
          } catch {
            // ignore
          }
        }
      }
    ]

    template.push({ type: 'separator' })
    template.push({ label: '文字识别', submenu: ocrSubmenu })
  }

  template.push({ type: 'separator' })
  template.push({
    label: '关闭',
    click: () => {
      try {
        win.hide()
        win.close()
      } catch {
        // ignore
      }
    }
  })

  const menu = Menu.buildFromTemplate(template)

  menu.popup({ window: win })
}

function pasteStickerFromClipboard(): void {
  const payload = readClipboardAsStickerPayload()
  if (!payload) return
  stickersHidden = false
  createStickerWindow(payload)
}

function toggleStickersHidden(): void {
  stickersHidden = !stickersHidden
  for (const win of stickerWindows.values()) {
    if (win.isDestroyed()) continue
    if (stickersHidden) win.hide()
    else win.showInactive()
  }
}

function broadcastSnipSavedChanged(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.webContents.isLoading()) return
  mainWindow.webContents.send('snip:saved:changed')
}

function defaultSnipSaveDir(): string {
  const pictures = app.getPath('pictures')
  const legacy = join(pictures, 'freamx', 'screenshots')
  const next = join(pictures, 'toolssss', 'screenshots')
  if (existsSync(legacy) && !existsSync(next)) return legacy
  return next
}

function resolveSnipSaveDir(): string {
  const raw = settings.snip.saveDir.trim()
  return raw ? raw : defaultSnipSaveDir()
}

function isWithinSnipSaveDir(filePath: string): boolean {
  const base = resolveSnipSaveDir()
  const absBase = resolve(base)
  const absTarget = resolve(filePath)
  const basePrefix = absBase.endsWith(sep) ? absBase : absBase + sep
  if (process.platform === 'win32') {
    return absTarget.toLowerCase().startsWith(basePrefix.toLowerCase())
  }
  return absTarget.startsWith(basePrefix)
}

function formatSnipFileName(ts: number): string {
  const d = new Date(ts)
  const yyyy = String(d.getFullYear())
  const MM = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const HH = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const SSS = String(d.getMilliseconds()).padStart(3, '0')
  return `${yyyy}${MM}${dd}${HH}${mm}${ss}${SSS}.png`
}

async function saveSnipBufferToDisk(buffer: Buffer): Promise<string | null> {
  const dir = resolveSnipSaveDir()
  try {
    await fsp.mkdir(dir, { recursive: true })
  } catch {
    return null
  }

  const filePath = join(dir, formatSnipFileName(Date.now()))
  try {
    await fsp.writeFile(filePath, buffer)
    broadcastSnipSavedChanged()
    return filePath
  } catch {
    return null
  }
}

function startAppSnip(): void {
  if (!screenshots) {
    // 是否复用截图窗口，加快截图窗口显示，默认值为 false
    // 如果设置为 true 则会在第一次调用截图窗口时创建，后续调用时直接使用
    // 且由于窗口不会 close，所以不会触发 app 的 `window-all-closed` 事件
    screenshots = new Screenshots({
      singleWindow: true
    })
    isScreenshotsHooked = false
  }

  if (!isScreenshotsHooked) {
    isScreenshotsHooked = true
    screenshots.on('windowClosed', () => {
      setSnipCapturing(false)
      resumeOverlayAfterSnip()
    })
    screenshots.on('windowCreated', (win: BrowserWindow) => {
      win.on('hide', () => {
        setSnipCapturing(false)
        resumeOverlayAfterSnip()
      })
      win.on('closed', () => {
        setSnipCapturing(false)
        resumeOverlayAfterSnip()
      })
    })
    // 让键盘事件在渲染端处理（例如 react-screenshots 的 C 键复制逻辑）

    screenshots.on('save', (event, buffer, data) => {
      event.preventDefault()
      const stickAfterSave =
        Boolean(data) &&
        typeof data === 'object' &&
        (data as Record<string, unknown>)['stickAfterSave'] === true
      try {
        const img = nativeImage.createFromBuffer(buffer)
        if (!img.isEmpty()) clipboard.writeImage(img)
      } catch {
        // ignore
      }
      void saveSnipBufferToDisk(buffer).finally(() => {
        screenshots
          ?.endCapture()
          .catch(() => null)
          .finally(() => {
            if (stickAfterSave) pasteStickerFromClipboard()
          })
      })
    })

    screenshots.on('ok', (_event, buffer) => {
      try {
        const img = nativeImage.createFromBuffer(buffer)
        if (img.isEmpty()) return
        clipboard.writeImage(img)
      } catch {
        return
      }
    })

    screenshots.on('cancel', () => {
      setSnipCapturing(false)
      resumeOverlayAfterSnip()
    })
  }

  suspendOverlayForSnip()
  setSnipCapturing(true)
  screenshots.startCapture().catch(() => {
    setSnipCapturing(false)
    resumeOverlayAfterSnip()
    return null
  })
}

function startSnip(): void {
  startAppSnip()
}

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

type SecretsV1 = {
  v: 1
  aiApiKey?: string
}

function secretsFilePath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function loadSecretsFromDisk(): SecretsV1 {
  try {
    const raw = readFileSync(secretsFilePath(), 'utf-8')
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object') return { v: 1 }
    const obj = v as Record<string, unknown>
    const out: SecretsV1 = { v: 1 }
    if (typeof obj['aiApiKey'] === 'string') out.aiApiKey = obj['aiApiKey']
    return out
  } catch {
    return { v: 1 }
  }
}

function saveSecretsToDisk(next: SecretsV1): void {
  try {
    writeFileSync(secretsFilePath(), JSON.stringify(next), 'utf-8')
  } catch {
    return
  }
}

function encryptToBase64(text: string): string | null {
  if (!text.trim()) return null
  try {
    const buf = safeStorage.encryptString(text)
    return buf.toString('base64')
  } catch {
    return null
  }
}

function decryptFromBase64(base64: string): string | null {
  if (!base64.trim()) return null
  try {
    return safeStorage.decryptString(Buffer.from(base64, 'base64'))
  } catch {
    return null
  }
}

function getAiApiKeyFromSecrets(): string | null {
  const secrets = loadSecretsFromDisk()
  if (typeof secrets.aiApiKey !== 'string' || !secrets.aiApiKey.trim()) return null
  const v = decryptFromBase64(secrets.aiApiKey)
  return typeof v === 'string' && v.trim() ? v : null
}

function setAiApiKeyToSecrets(apiKey: string): boolean {
  const trimmed = apiKey.trim()
  if (!trimmed) return false
  const enc = encryptToBase64(trimmed)
  if (!enc) return false
  const secrets = loadSecretsFromDisk()
  saveSecretsToDisk({ ...secrets, v: 1, aiApiKey: enc })
  return true
}

function clearAiApiKeyFromSecrets(): boolean {
  try {
    const secrets = loadSecretsFromDisk()
    if (!('aiApiKey' in secrets)) return true
    const next: SecretsV1 = { ...secrets, v: 1 }
    delete next.aiApiKey
    saveSecretsToDisk(next)
    return true
  } catch {
    return false
  }
}

function loadSettingsFromDisk(): AppSettings {
  let parsed: unknown = null
  try {
    const raw = readFileSync(settingsFilePath(), 'utf-8')
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }

  const normalized = normalizeSettings(parsed)
  const existing = getAiApiKeyFromSecrets()
  if (existing) {
    normalized.ai.apiKeySet = true
    return normalized
  }

  const legacyKey =
    parsed && typeof parsed === 'object'
      ? ((parsed as Record<string, unknown>)['ai'] as Record<string, unknown> | undefined)?.[
          'apiKey'
        ]
      : undefined
  const legacyTrimmed = typeof legacyKey === 'string' ? legacyKey.trim() : ''
  if (!legacyTrimmed) {
    normalized.ai.apiKeySet = false
    return normalized
  }

  if (!setAiApiKeyToSecrets(legacyTrimmed)) {
    normalized.ai.apiKeySet = false
    return normalized
  }

  normalized.ai.apiKeySet = true
  saveSettingsToDisk(normalized)
  return normalized
}

function saveSettingsToDisk(next: AppSettings): void {
  try {
    writeFileSync(settingsFilePath(), JSON.stringify(next), 'utf-8')
  } catch {
    return
  }
}

async function loadWindow(win: BrowserWindow, query: Record<string, string>): Promise<void> {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const params = new URLSearchParams(query)
    await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${params.toString()}`)
    return
  }

  await win.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

function closeWindowMap(map: Map<number, BrowserWindow>): void {
  for (const win of map.values()) {
    if (!win.isDestroyed()) win.close()
  }
  map.clear()
}

function ensureOverlayWindows(): void {
  if (!settings.eye.enabled) {
    closeWindowMap(overlayWindows)
    return
  }

  const displays = screen.getAllDisplays()
  const displayIds = new Set(displays.map((d) => d.id))
  for (const [id, win] of overlayWindows) {
    if (!displayIds.has(id)) {
      if (!win.isDestroyed()) win.close()
      overlayWindows.delete(id)
    }
  }

  for (const display of displays) {
    const existing = overlayWindows.get(display.id)
    if (existing && !existing.isDestroyed()) {
      existing.setBounds(display.bounds, false)
      continue
    }
    overlayWindows.set(display.id, createOverlayWindow(display))
  }

  broadcastOverlaySettings()
}

function broadcastOverlaySettings(): void {
  for (const win of overlayWindows.values()) {
    if (win.isDestroyed()) continue
    win.webContents.send('overlay:settings', settings.eye)
  }
}

function createOverlayWindow(display: Electron.Display): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true })

  loadWindow(win, { mode: 'overlay' }).catch(() => null)

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('overlay:settings', settings.eye)
    if (!overlaySuspended) win.showInactive()
  })

  return win
}

function suspendOverlayForSnip(): void {
  if (!settings.eye.enabled) return
  if (!settings.snip.suspendEyeOverlay) return
  if (overlaySuspended) return
  overlaySuspended = true
  for (const win of overlayWindows.values()) {
    if (win.isDestroyed()) continue
    win.hide()
  }
}

function resumeOverlayAfterSnip(): void {
  if (!overlaySuspended) return
  overlaySuspended = false
  ensureOverlayWindows()
  if (!settings.eye.enabled) return
  for (const win of overlayWindows.values()) {
    if (win.isDestroyed()) continue
    win.showInactive()
  }
}

function nextDailyAlarmDelayMs(time: string, now = new Date()): number | null {
  const normalized = normalizeTimeString(time)
  if (!normalized) return null
  const [hStr, mStr] = normalized.split(':')
  const h = Number(hStr)
  const m = Number(mStr)

  const next = new Date(now)
  next.setSeconds(0, 0)
  next.setHours(h, m, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

function ensureDailyAlarmTimer(): void {
  if (dailyAlarmTimer) clearTimeout(dailyAlarmTimer)
  dailyAlarmTimer = undefined

  if (!settings.alarm.enabled) return
  const delay = nextDailyAlarmDelayMs(settings.alarm.time)
  if (delay === null) return

  dailyAlarmTimer = setTimeout(() => {
    triggerAlarm('alarm')
    ensureDailyAlarmTimer()
  }, delay)
}

function ensureBreakTimer(): void {
  if (breakTimer) clearTimeout(breakTimer)
  breakTimer = undefined

  if (!settings.break.enabled) {
    breakNextAt = null
    broadcastBreakStatus()
    return
  }
  const intervalMs = settings.break.intervalMinutes * 60 * 1000
  scheduleBreak(intervalMs, intervalMs)
}

function scheduleBreak(delayMs: number, intervalMs: number): void {
  if (breakTimer) clearTimeout(breakTimer)
  breakTimer = undefined
  breakNextAt = Date.now() + delayMs
  broadcastBreakStatus()
  breakTimer = setTimeout(() => {
    void triggerBreakFromTimer(intervalMs)
  }, delayMs)
}

async function triggerBreakFromTimer(intervalMs: number): Promise<void> {
  if (!settings.break.enabled) return

  if (settings.break.disableInFullscreen) {
    const fullscreen = await isForegroundFullscreenWindows()
    if (fullscreen) {
      scheduleBreak(5 * 60 * 1000, intervalMs)
      return
    }
  }

  showAlarmWindows('break', '休息提醒', pickRestTip())
  scheduleBreak(intervalMs, intervalMs)
}

function resolveRestTipsFilePath(): string | null {
  const candidates: string[] = []
  if (is.dev) {
    candidates.push(join(process.cwd(), 'src', 'libs', 'rest-tips.json'))
    candidates.push(join(app.getAppPath(), 'src', 'libs', 'rest-tips.json'))
  } else {
    candidates.push(join(process.resourcesPath, 'rest-tips.json'))
    candidates.push(join(app.getAppPath(), 'rest-tips.json'))
  }

  for (const p of candidates) {
    try {
      if (existsSync(p)) return p
    } catch {
      void 0
    }
  }
  return null
}

function loadRestTips(): string[] {
  if (restTipsCache) return restTipsCache
  const p = resolveRestTipsFilePath()
  if (!p) return []
  try {
    const raw = readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out = parsed.filter((v) => typeof v === 'string' && v.trim()) as string[]
    restTipsCache = out
    return out
  } catch {
    return []
  }
}

function pickRestTip(): string {
  const tips = loadRestTips()
  if (!tips.length) return '休息一下，看看远处 20 秒，眨眨眼。'
  const idx = Math.floor(Math.random() * tips.length)
  const v = tips[idx]?.trim() ?? ''
  return v || '休息一下，看看远处 20 秒，眨眨眼。'
}

function triggerAlarm(reason: AlarmReason): void {
  if (snoozeTimer) {
    clearTimeout(snoozeTimer)
    snoozeTimer = undefined
  }

  const title = reason === 'alarm' ? settings.alarm.label : '休息提醒'
  const body = reason === 'alarm' ? `现在时间：${settings.alarm.time}` : pickRestTip()

  showAlarmWindows(reason, title, body)
}

async function isForegroundFullscreenWindows(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  try {
    const script = `
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinApi {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public struct MONITORINFO {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
  }
}
'@
      $hwnd = [WinApi]::GetForegroundWindow()
      $rect = New-Object WinApi+RECT
      [WinApi]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
      $mon = [WinApi]::MonitorFromWindow($hwnd, 2)
      $mi = New-Object WinApi+MONITORINFO
      $mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mi)
      [WinApi]::GetMonitorInfo($mon, [ref]$mi) | Out-Null
      $obj = [pscustomobject]@{
        left = $rect.Left
        top = $rect.Top
        right = $rect.Right
        bottom = $rect.Bottom
        monLeft = $mi.rcMonitor.Left
        monTop = $mi.rcMonitor.Top
        monRight = $mi.rcMonitor.Right
        monBottom = $mi.rcMonitor.Bottom
      }
      $obj | ConvertTo-Json -Compress
    `
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const { stdout } = await execAsync(`powershell -EncodedCommand ${encoded}`)
    const raw = stdout.trim()
    if (!raw) return false
    const p = JSON.parse(raw) as Record<string, unknown>
    const left = Number(p['left'])
    const top = Number(p['top'])
    const right = Number(p['right'])
    const bottom = Number(p['bottom'])
    const monLeft = Number(p['monLeft'])
    const monTop = Number(p['monTop'])
    const monRight = Number(p['monRight'])
    const monBottom = Number(p['monBottom'])
    if (![left, top, right, bottom, monLeft, monTop, monRight, monBottom].every(Number.isFinite))
      return false

    const tol = 4
    const w = Math.max(0, right - left)
    const h = Math.max(0, bottom - top)
    const mw = Math.max(0, monRight - monLeft)
    const mh = Math.max(0, monBottom - monTop)
    if (mw <= 0 || mh <= 0 || w <= 0 || h <= 0) return false

    const covers =
      left <= monLeft + tol &&
      top <= monTop + tol &&
      right >= monRight - tol &&
      bottom >= monBottom - tol
    if (covers) return true

    const areaRatio = (w * h) / (mw * mh)
    const sizeOk = w >= mw * 0.98 && h >= mh * 0.98
    return areaRatio >= 0.98 && sizeOk
  } catch (e) {
    console.error('Failed to check fullscreen:', e)
    return false
  }
}

function showAlarmWindows(reason: AlarmReason, title: string, body: string): void {
  lastAlarmPayload = { reason, title, body }

  if (alarmWindows.size === 0) {
    for (const display of screen.getAllDisplays()) {
      alarmWindows.set(display.id, createAlarmWindow(display))
    }
  }

  for (const win of alarmWindows.values()) {
    if (win.isDestroyed()) continue
    if (!win.webContents.isLoading())
      win.webContents.send('alarm:show', {
        reason,
        title,
        body,
        timeoutSec: settings.reminderSeconds
      })
    if (!win.isVisible()) win.show()
    try {
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
      win.setKiosk(true)
      win.setFullScreen(true)
    } catch {
      void 0
    }
  }
}

function createAlarmWindow(display: Electron.Display): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    fullscreen: false,
    kiosk: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#111827',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  loadWindow(win, { mode: 'alarm' }).catch(() => null)

  win.webContents.once('did-finish-load', () => {
    if (lastAlarmPayload)
      win.webContents.send('alarm:show', {
        ...lastAlarmPayload,
        timeoutSec: settings.reminderSeconds
      })
    try {
      win.setBounds(display.bounds, false)
    } catch {
      void 0
    }
    win.show()
    try {
      app.focus()
    } catch {
      void 0
    }
    win.setAlwaysOnTop(true, 'screen-saver')
    win.moveTop()
    win.focus()
    win.setKiosk(true)
    win.setFullScreen(true)
    try {
      win.webContents.focus()
    } catch {
      void 0
    }
  })

  win.on('closed', () => {
    alarmWindows.delete(display.id)
  })

  return win
}

function loadWindowForPopup(win: BrowserWindow, query: Record<string, string>): Promise<void> {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const params = new URLSearchParams(query)
    return win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${params.toString()}`)
  }
  return win.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

function ensureTranslatorPopupWindow(): BrowserWindow {
  if (translatorPopupWindow && !translatorPopupWindow.isDestroyed()) return translatorPopupWindow

  const display = screen.getPrimaryDisplay()
  const w = 520
  const h = 360
  const x = display.workArea.x + display.workArea.width - w - 20
  const y = display.workArea.y + 80
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
    alwaysOnTop: false,
    backgroundColor: '#0b0b0c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // win.setAlwaysOnTop(true, 'pop-up-menu')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  translatorPopupWindow = win

  loadWindowForPopup(win, { mode: 'translator-popup' }).catch(() => null)

  win.on('closed', () => {
    if (translatorPopupWindow === win) translatorPopupWindow = null
  })

  return win
}

function showTranslatorPopupWindow(win: BrowserWindow, activate: boolean): void {
  win.setAlwaysOnTop(true, 'pop-up-menu')
  if (activate) {
    win.show()
  } else {
    win.showInactive()
  }
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (activate) {
    try {
      app.focus()
    } catch {
      // ignore
    }
  }
  win.moveTop()
  if (activate) {
    win.focus()
    try {
      win.webContents.focus()
    } catch {
      // ignore
    }
  }
}

type TranslatorPopupOpenPayload = {
  text: string
  source?: string
  target?: string
  pendingSelection?: boolean
}

function sendTranslatorPopupOpen(win: BrowserWindow, payload: TranslatorPopupOpenPayload): void {
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('translator-popup:open', payload)
    })
  } else {
    win.webContents.send('translator-popup:open', payload)
  }
}

async function openTranslatorPopupFromSelection(): Promise<void> {
  const win = ensureTranslatorPopupWindow()
  const base = {
    source: settings.translate.defaultSource,
    target: settings.translate.defaultTarget
  }
  showTranslatorPopupWindow(win, false)
  sendTranslatorPopupOpen(win, { text: '', ...base, pendingSelection: true })
  const text = await captureSelectionText()
  if (win.isDestroyed()) return
  sendTranslatorPopupOpen(win, { text, ...base, pendingSelection: false })
  showTranslatorPopupWindow(win, true)
}

async function sendCtrlCWindows(): Promise<void> {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait("^c")
  `
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  await execAsync(`powershell -STA -EncodedCommand ${encoded}`)
}

async function captureSelectionText(): Promise<string> {
  if (process.platform === 'win32') {
    try {
      const original = clipboard.readText()
      await sendCtrlCWindows()
      await new Promise((r) => setTimeout(r, 120))
      const text = clipboard.readText()
      if (text && text.trim()) return text
      if (original && original.trim()) return original
      return ''
    } catch {
      const t = clipboard.readText()
      return typeof t === 'string' ? t : ''
    }
  }
  const t = clipboard.readText()
  return typeof t === 'string' ? t : ''
}

function resolveTranslateConfig(payload: TranslatePayload): {
  provider: AppSettings['translate']['provider']
  source: string
  target: string
  text: string
} {
  const text = typeof payload.text === 'string' ? payload.text : ''
  const source =
    typeof payload.source === 'string' && payload.source.trim()
      ? payload.source.trim()
      : settings.translate.defaultSource
  const target =
    typeof payload.target === 'string' && payload.target.trim()
      ? payload.target.trim()
      : settings.translate.defaultTarget
  return {
    provider: settings.translate.provider,
    source,
    target,
    text
  }
}

function md5Hex(input: string): string {
  return createHash('md5').update(input).digest('hex')
}

async function translateWithBaidu(args: {
  baseUrl: string
  appId: string
  secret: string
  text: string
  source: string
  target: string
}): Promise<string> {
  const base = args.baseUrl.trim()
  if (!base) throw new Error('未配置百度翻译 baseUrl')
  if (!args.appId) throw new Error('未配置百度翻译 appId')
  if (!args.secret) throw new Error('未配置百度翻译 secret')
  if (!args.target) throw new Error('未指定目标语言')

  const url = new URL('/api/trans/vip/translate', base)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const salt = String(Date.now())
    const sign = md5Hex(`${args.appId}${args.text}${salt}${args.secret}`)
    const from = args.source && args.source !== 'auto' ? args.source : 'auto'
    const body = new URLSearchParams({
      q: args.text,
      from,
      to: args.target,
      appid: args.appId,
      salt,
      sign
    })
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
      signal: controller.signal
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(raw || `HTTP ${res.status}`)
    const data = JSON.parse(raw) as {
      error_code?: unknown
      error_msg?: unknown
      trans_result?: Array<{ dst?: unknown }>
    }
    if (data.error_code) {
      const msg = typeof data.error_msg === 'string' ? data.error_msg : String(data.error_code)
      throw new Error(`百度翻译失败：${msg}`)
    }
    const out =
      data.trans_result?.map((x) => (typeof x.dst === 'string' ? x.dst : '')).join('\n') ?? ''
    return out
  } finally {
    clearTimeout(timeout)
  }
}

async function translateWithBing(args: {
  baseUrl: string
  key: string
  region: string
  text: string
  source: string
  target: string
}): Promise<string> {
  const base = args.baseUrl.trim()
  if (!base) throw new Error('未配置必应翻译 baseUrl')
  if (!args.key) throw new Error('未配置必应翻译 key')
  if (!args.region) throw new Error('未配置必应翻译 region')
  if (!args.target) throw new Error('未指定目标语言')

  const url = new URL('/translate', base)
  url.searchParams.set('api-version', '3.0')
  if (args.source && args.source !== 'auto') url.searchParams.set('from', args.source)
  url.searchParams.set('to', args.target)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': args.key,
        'Ocp-Apim-Subscription-Region': args.region
      },
      body: JSON.stringify([{ Text: args.text }]),
      signal: controller.signal
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(raw || `HTTP ${res.status}`)
    const data = JSON.parse(raw) as Array<{
      translations?: Array<{ text?: unknown }>
    }>
    console.log('translateWithBing data', data)
    const t = data?.[0]?.translations?.[0]?.text
    return typeof t === 'string' ? t : ''
  } finally {
    clearTimeout(timeout)
  }
}

function trimAiTranslateText(text: string): string {
  const t = text.replace(/\r\n/g, '\n').trim()
  if (t.length <= 12000) return t
  return t.slice(0, 12000).trimEnd()
}

async function translateWithAi(args: {
  text: string
  source: string
  target: string
}): Promise<string> {
  if (!settings.ai.enabled) throw new Error('AI 未启用，请到「全局设置」开启。')
  const base = settings.ai.baseUrl.trim()
  if (!base) throw new Error('未配置 AI Base URL，请到「全局设置」完善。')
  const model = settings.ai.model.trim()
  if (!model) throw new Error('未配置 AI Model，请到「全局设置」完善。')
  const apiKey = getAiApiKeyFromSecrets()
  if (!apiKey) throw new Error('未配置 AI API Key，请到「全局设置」完善。')

  const source = args.source && args.source !== 'auto' ? args.source : 'auto'
  const target = args.target
  if (!target) throw new Error('未指定目标语言')

  const url = buildAiChatCompletionsUrl(base)
  const controller = new AbortController()
  const timeoutMs = 45000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let res: Response
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 2000,
          messages: [
            {
              role: 'system',
              content: '你是一个翻译引擎。只输出译文，不要解释，不要加引号。保留原文换行与格式。'
            },
            {
              role: 'user',
              content:
                `请把下面内容翻译成目标语言。\n` +
                `源语言：${source === 'auto' ? '自动检测' : source}\n` +
                `目标语言：${target}\n` +
                `内容：\n` +
                args.text
            }
          ]
        }),
        signal: controller.signal
      })
    } catch (e) {
      const name =
        e &&
        typeof e === 'object' &&
        'name' in e &&
        typeof (e as { name?: unknown }).name === 'string'
          ? ((e as { name: string }).name as string)
          : ''
      if (name === 'AbortError')
        throw new Error(`AI 翻译超时（${Math.round(timeoutMs / 1000)}秒），请稍后重试`)
      throw e
    }

    const raw = await res.text()
    if (!res.ok) {
      const msg = extractAiErrorMessage(raw)
      throw new Error(msg ? `AI 翻译失败：${msg}` : raw || `AI 翻译失败：HTTP ${res.status}`)
    }
    const data = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 未返回有效内容')
    return trimAiTranslateText(content)
  } finally {
    clearTimeout(timeout)
  }
}

async function translate(payload: TranslatePayload): Promise<TranslateResult> {
  const cfg = resolveTranslateConfig(payload)
  const text = cfg.text.trim()
  if (!text) return { text: '' }
  if (cfg.provider === 'ai') {
    const out = await translateWithAi({
      text,
      source: cfg.source,
      target: cfg.target
    })
    return { text: out }
  }
  if (cfg.provider === 'bing') {
    const out = await translateWithBing({
      baseUrl: settings.translate.bing.baseUrl,
      key: settings.translate.bing.key,
      region: settings.translate.bing.region,
      text,
      source: cfg.source,
      target: cfg.target
    })
    return { text: out }
  }
  const out = await translateWithBaidu({
    baseUrl: settings.translate.baidu.baseUrl,
    appId: settings.translate.baidu.appId,
    secret: settings.translate.baidu.secret,
    text,
    source: cfg.source,
    target: cfg.target
  })
  return { text: out }
}

type AiDailyFunFactResult = {
  ymd: string
  text: string
}

let aiDailyFunFactCache: AiDailyFunFactResult | null = null
const aiDailyFunFactStreamBySender = new Map<
  number,
  { id: string; controller: AbortController; timeout: ReturnType<typeof setTimeout> }
>()

function ymdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function trimAiText(text: string): string {
  const t = text.replace(/\r\n/g, '\n').trim()
  if (t.length <= 800) return t
  return t.slice(0, 800).trimEnd()
}

function extractAiErrorMessage(raw: string): string | null {
  try {
    const obj = JSON.parse(raw) as unknown
    const root = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null
    const err = root?.['error']
    const e = err && typeof err === 'object' ? (err as Record<string, unknown>) : null
    const msg = typeof e?.['message'] === 'string' ? e.message : ''
    return msg.trim() ? msg.trim() : null
  } catch {
    return null
  }
}

function buildAiChatCompletionsUrl(baseUrl: string): URL {
  const base = baseUrl.trim()
  if (!base) throw new Error('未配置 AI Base URL，请到「全局设置」完善。')
  const normalized = base.replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(normalized)) return new URL(normalized)
  if (/\/openai$/i.test(normalized)) return new URL(`${normalized}/chat/completions`)
  if (/\/v1$/i.test(normalized)) return new URL(`${normalized}/chat/completions`)
  return new URL(`${normalized}/v1/chat/completions`)
}

function createAiStreamId(): string {
  const a = Date.now()
  const b = Math.random().toString(16).slice(2)
  return `${a}-${b}`
}

function tryParseAiSseDelta(jsonText: string): string {
  try {
    const obj = JSON.parse(jsonText) as unknown
    const root = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null
    const choices = Array.isArray(root?.['choices']) ? (root?.['choices'] as unknown[]) : []
    const first =
      choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>) : null
    const delta =
      first?.['delta'] && typeof first['delta'] === 'object'
        ? (first['delta'] as Record<string, unknown>)
        : null
    const content = delta?.['content']
    return typeof content === 'string' ? content : ''
  } catch {
    return ''
  }
}

async function requestDailyFunFactFromAiStreamed(
  ymd: string,
  signal: AbortSignal,
  onDelta: (delta: string) => void
): Promise<string> {
  if (!settings.ai.enabled) throw new Error('AI 未启用，请到「全局设置」开启。')
  const base = settings.ai.baseUrl.trim()
  if (!base) throw new Error('未配置 AI Base URL，请到「全局设置」完善。')
  const model = settings.ai.model.trim()
  if (!model) throw new Error('未配置 AI Model，请到「全局设置」完善。')
  const apiKey = getAiApiKeyFromSecrets()
  if (!apiKey) throw new Error('未配置 AI API Key，请到「全局设置」完善。')

  const url = buildAiChatCompletionsUrl(base)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 220,
      stream: true,
      messages: [
        {
          role: 'system',
          content:
            '你是一个严谨的科普编辑。只输出一条冷知识，中文，尽量准确，不要编造具体数字或来源。'
        },
        {
          role: 'user',
          content: `给我一条“每日冷知识”，日期：${ymd}。\n要求：1) 1-3 句；2) 不要列表；3) 不要标题符号；4) 不要输出多余解释。`
        }
      ]
    }),
    signal
  })

  if (!res.ok) {
    const raw = await res.text()
    const msg = extractAiErrorMessage(raw)
    throw new Error(msg ? `AI 请求失败：${msg}` : raw || `AI 请求失败：HTTP ${res.status}`)
  }

  const ct = res.headers.get('content-type') ?? ''
  if (!/text\/event-stream/i.test(ct) || !res.body) {
    const raw = await res.text()
    const data = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 未返回有效内容')
    const out = trimAiText(content)
    if (out) onDelta(out)
    return out
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    while (true) {
      const idx = buffer.indexOf('\n')
      if (idx < 0) break
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      const trimmed = line.trim()
      if (!trimmed) continue
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice('data:'.length).trim()
      if (!data) continue
      if (data === '[DONE]') return trimAiText(full)
      const delta = tryParseAiSseDelta(data)
      if (!delta) continue
      full += delta
      onDelta(delta)
    }
  }
  return trimAiText(full)
}

async function requestDailyFunFactFromAi(ymd: string): Promise<string> {
  if (!settings.ai.enabled) throw new Error('AI 未启用，请到「全局设置」开启。')
  const base = settings.ai.baseUrl.trim()
  if (!base) throw new Error('未配置 AI Base URL，请到「全局设置」完善。')
  const model = settings.ai.model.trim()
  if (!model) throw new Error('未配置 AI Model，请到「全局设置」完善。')
  const apiKey = getAiApiKeyFromSecrets()
  if (!apiKey) throw new Error('未配置 AI API Key，请到「全局设置」完善。')

  const url = buildAiChatCompletionsUrl(base)
  const controller = new AbortController()
  const timeoutMs = 60000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let res: Response
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.7,
          max_tokens: 220,
          stream: true,
          messages: [
            {
              role: 'system',
              content:
                '你是一个严谨的科普编辑。只输出一条冷知识，中文，尽量准确，不要编造具体数字或来源。'
            },
            {
              role: 'user',
              content: `给我一条“每日冷知识”，日期：${ymd}。\n要求：1) 1-3 句；2) 不要列表；3) 不要标题符号；4) 不要输出多余解释。`
            }
          ]
        }),
        signal: controller.signal
      })
    } catch (e) {
      const name =
        e &&
        typeof e === 'object' &&
        'name' in e &&
        typeof (e as { name?: unknown }).name === 'string'
          ? ((e as { name: string }).name as string)
          : ''
      if (name === 'AbortError')
        throw new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)}秒），请稍后重试`)
      throw e
    }

    const raw = await res.text()
    if (!res.ok) {
      const msg = extractAiErrorMessage(raw)
      throw new Error(msg ? `AI 请求失败：${msg}` : raw || `AI 请求失败：HTTP ${res.status}`)
    }

    const data = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 未返回有效内容')
    return trimAiText(content)
  } finally {
    clearTimeout(timeout)
  }
}

async function getAiDailyFunFact(force: boolean): Promise<AiDailyFunFactResult> {
  const ymd = ymdLocal(new Date())
  if (!force && aiDailyFunFactCache?.ymd === ymd && aiDailyFunFactCache.text.trim()) {
    return aiDailyFunFactCache
  }
  const text = await requestDailyFunFactFromAi(ymd)
  const out: AiDailyFunFactResult = { ymd, text }
  aiDailyFunFactCache = out
  return out
}

function previewAlarm(reason: AlarmReason): void {
  const title = reason === 'alarm' ? settings.alarm.label : '休息提醒'
  const body = reason === 'alarm' ? `现在时间：${settings.alarm.time}` : pickRestTip()
  showAlarmWindows(reason, title, body)
}

function dismissAlarmWindows(): void {
  closeWindowMap(alarmWindows)
}

function snoozeAlarm(minutes: number): void {
  dismissAlarmWindows()
  const ms = clampNumber(minutes, 1, 120) * 60 * 1000
  snoozeTimer = setTimeout(() => triggerAlarm('alarm'), ms)
}

function ensureTray(): void {
  if (settings.general.minimizeToTray) {
    if (tray) return
    tray = new Tray(icon)

    const showApp = (): void => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      } else {
        createWindow()
      }
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主界面',
        click: showApp
      },
      { type: 'separator' },
      {
        label: '退出',
        click: (): void => {
          isQuitting = true
          app.quit()
        }
      }
    ])
    tray.setToolTip('toolssss')
    tray.setContextMenu(contextMenu)
    tray.on('click', showApp)
    tray.on('double-click', showApp)
  } else {
    if (tray) {
      tray.destroy()
      tray = null
    }
  }
}

function ensureAutoStart(): void {
  if (process.platform === 'linux') return

  const desired = Boolean(settings.general.autoStart)
  const openAsHidden = Boolean(settings.general.minimizeToTray)

  try {
    const args = process.argv.slice(1).filter((v) => v !== '--autostart')
    if (desired) args.unshift('--autostart')
    app.setLoginItemSettings({
      openAtLogin: desired,
      openAsHidden,
      path: process.execPath,
      args: desired ? args : []
    })
  } catch {
    void 0
  }
}

function ensureShortcuts(): void {
  globalShortcut.unregisterAll()

  const conflicts: Record<string, string[]> = {}
  const entries: Array<{ name: string; acc: string }> = []
  for (const [name, raw] of Object.entries(settings.shortcuts ?? ({} as Record<string, unknown>))) {
    if (typeof raw !== 'string') continue
    const acc = raw.trim()
    if (!acc) continue
    entries.push({ name, acc })
  }
  for (const { name, acc } of entries) {
    const k = acc.toLowerCase()
    const arr = conflicts[k] ?? (conflicts[k] = [])
    arr.push(name)
  }
  const dup = Object.entries(conflicts).filter(([, names]) => names.length > 1)
  if (dup.length) {
    console.warn(
      'Shortcut conflicts detected:',
      dup.map(([acc, names]) => ({ acc, keys: names }))
    )
  }

  if (settings.shortcuts.toggleEye) {
    try {
      globalShortcut.register(settings.shortcuts.toggleEye, () => {
        settings.eye.enabled = !settings.eye.enabled
        saveSettingsToDisk(settings)
        // Only update relevant runtime parts, avoid full re-apply to prevent recursion
        ensureOverlayWindows()
        // Notify renderer to update UI
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('settings:changed', settings)
        }
      })
    } catch (e) {
      console.error('Failed to register shortcut:', settings.shortcuts.toggleEye, e)
    }
  }

  if ((settings.shortcuts as Record<string, unknown>).translateSelection) {
    const acc = (settings.shortcuts as Record<string, string>).translateSelection
    if (acc) {
      try {
        globalShortcut.register(acc, async () => {
          await openTranslatorPopupFromSelection()
        })
      } catch (e) {
        console.error('Failed to register shortcut:', acc, e)
      }
    }
  }

  if ((settings.shortcuts as Record<string, unknown>).stickyNotesPopup) {
    const acc = (settings.shortcuts as Record<string, string>).stickyNotesPopup
    if (acc) {
      try {
        globalShortcut.register(acc, () => openQuickStickyNoteEditor())
      } catch (e) {
        console.error('Failed to register shortcut:', acc, e)
      }
    }
  }

  if (settings.snip.enabled) {
    if ((settings.shortcuts as Record<string, unknown>).snipStart) {
      const acc = (settings.shortcuts as Record<string, string>).snipStart
      if (acc) {
        try {
          globalShortcut.register(acc, () => startSnip())
        } catch (e) {
          console.error('Failed to register shortcut:', acc, e)
        }
      }
    }

    if ((settings.shortcuts as Record<string, unknown>).stickerPaste) {
      const acc = (settings.shortcuts as Record<string, string>).stickerPaste
      if (acc) {
        try {
          if (!snipCapturing) {
            globalShortcut.register(acc, () => pasteStickerFromClipboard())
          } else {
            snipDbg('skip register stickerPaste during snip', acc)
          }
        } catch (e) {
          console.error('Failed to register shortcut:', acc, e)
        }
      }
    }

    if ((settings.shortcuts as Record<string, unknown>).stickersToggleHidden) {
      const acc = (settings.shortcuts as Record<string, string>).stickersToggleHidden
      if (acc) {
        try {
          if (!snipCapturing) {
            globalShortcut.register(acc, () => toggleStickersHidden())
          } else {
            snipDbg('skip register stickersToggleHidden during snip', acc)
          }
        } catch (e) {
          console.error('Failed to register shortcut:', acc, e)
        }
      }
    }
  }
}

function applySettingsToRuntime(): void {
  setStickyNotesSaveDir(settings.stickyNotes?.saveDir ?? '')
  ensureOverlayWindows()
  ensureDailyAlarmTimer()
  ensureBreakTimer()
  ensureTray()
  ensureAutoStart()
  ensureShortcuts()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    resizable: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (settings.general.minimizeToTray && !isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadWindow(mainWindow, {}).catch(() => null)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  settings = loadSettingsFromDisk()
  applySettingsToRuntime()
  registerStickyNotesHandlers()
  registerWeatherHandlers()
  registerScriptLibraryHandlers()

  ipcMain.handle('app:paths', () => {
    return {
      userData: app.getPath('userData'),
      pictures: app.getPath('pictures')
    }
  })
  ipcMain.handle('app:version', () => {
    return app.getVersion()
  })
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('ai:apiKey:set', (_event, payload: unknown) => {
    const apiKey = typeof payload === 'string' ? payload.trim() : ''
    if (!apiKey) return settings
    if (!setAiApiKeyToSecrets(apiKey)) return settings
    settings.ai.apiKeySet = true
    saveSettingsToDisk(settings)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings:changed', settings)
    }
    return settings
  })
  ipcMain.handle('ai:apiKey:clear', () => {
    if (!clearAiApiKeyFromSecrets()) return settings
    settings.ai.apiKeySet = false
    saveSettingsToDisk(settings)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings:changed', settings)
    }
    return settings
  })
  ipcMain.handle('ai:funfact:daily', async (_event, payload: unknown) => {
    const p = payload && typeof payload === 'object' ? (payload as { force?: unknown }) : {}
    const force = Boolean(p.force)
    return await getAiDailyFunFact(force)
  })
  ipcMain.handle('ai:funfact:daily:stream', async (event, payload: unknown) => {
    const p = payload && typeof payload === 'object' ? (payload as { force?: unknown }) : {}
    const force = Boolean(p.force)
    const ymd = ymdLocal(new Date())
    const id = createAiStreamId()

    const senderId = event.sender.id
    const prev = aiDailyFunFactStreamBySender.get(senderId)
    if (prev) {
      try {
        prev.controller.abort()
      } catch (_e) {
        void _e
      }
      clearTimeout(prev.timeout)
      aiDailyFunFactStreamBySender.delete(senderId)
    }

    if (!force && aiDailyFunFactCache?.ymd === ymd && aiDailyFunFactCache.text.trim()) {
      return { id, ymd, text: aiDailyFunFactCache.text }
    }

    const controller = new AbortController()
    const timeoutMs = 60000
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    aiDailyFunFactStreamBySender.set(senderId, { id, controller, timeout })
    setImmediate(() => {
      ;(async () => {
        try {
          let acc = ''
          const text = await requestDailyFunFactFromAiStreamed(ymd, controller.signal, (delta) => {
            if (aiDailyFunFactStreamBySender.get(senderId)?.id !== id) return
            acc += delta
            try {
              event.sender.send('ai:funfact:daily:chunk', { id, delta })
            } catch (_e) {
              void _e
            }
          })

          if (aiDailyFunFactStreamBySender.get(senderId)?.id !== id) return
          const out: AiDailyFunFactResult = { ymd, text: text || trimAiText(acc) }
          aiDailyFunFactCache = out
          try {
            event.sender.send('ai:funfact:daily:done', { id, ymd: out.ymd, text: out.text })
          } catch (_e) {
            void _e
          }
        } catch (e) {
          if (aiDailyFunFactStreamBySender.get(senderId)?.id !== id) return
          const name =
            e &&
            typeof e === 'object' &&
            'name' in e &&
            typeof (e as { name?: unknown }).name === 'string'
              ? ((e as { name: string }).name as string)
              : ''
          if (name === 'AbortError') {
            try {
              event.sender.send('ai:funfact:daily:error', {
                id,
                message: `AI 请求超时（${Math.round(timeoutMs / 1000)}秒），请稍后重试`
              })
            } catch (_e) {
              void _e
            }
            return
          }
          const msg = e instanceof Error ? e.message : 'AI 请求失败'
          try {
            event.sender.send('ai:funfact:daily:error', { id, message: msg })
          } catch (_e) {
            void _e
          }
        } finally {
          const cur = aiDailyFunFactStreamBySender.get(senderId)
          if (cur?.id === id) {
            clearTimeout(cur.timeout)
            aiDailyFunFactStreamBySender.delete(senderId)
          }
        }
      })()
    })

    return { id, ymd }
  })
  ipcMain.handle('ai:funfact:daily:cancel', (event, payload: unknown) => {
    const p = payload && typeof payload === 'object' ? (payload as { id?: unknown }) : {}
    const id = typeof p.id === 'string' ? p.id : ''
    const senderId = event.sender.id
    const cur = aiDailyFunFactStreamBySender.get(senderId)
    if (!cur) return false
    if (id && cur.id !== id) return false
    try {
      event.sender.send('ai:funfact:daily:cancelled', { id: cur.id })
    } catch (_e) {
      void _e
    }
    try {
      cur.controller.abort()
    } catch (_e) {
      void _e
    }
    clearTimeout(cur.timeout)
    aiDailyFunFactStreamBySender.delete(senderId)
    return true
  })
  ipcMain.handle('snip:saveDir:choose', async () => {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return null
    const p = result.filePaths?.[0]
    return typeof p === 'string' && p.trim() ? p : null
  })
  ipcMain.handle('sticky-notes:saveDir:choose', async () => {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return null
    const p = result.filePaths?.[0]
    return typeof p === 'string' && p.trim() ? p : null
  })
  ipcMain.handle('snip:saved:list', async () => {
    const dir = resolveSnipSaveDir()
    try {
      await fsp.mkdir(dir, { recursive: true })
    } catch {
      return []
    }

    if (!existsSync(dir)) return []
    const files = await fsp.readdir(dir)
    const meta: Array<{
      name: string
      filePath: string
      mtimeMs: number
      size: number
    }> = []
    for (const name of files) {
      const lower = name.toLowerCase()
      if (!lower.endsWith('.png') && !lower.endsWith('.jpg') && !lower.endsWith('.jpeg')) continue
      const filePath = join(dir, name)
      try {
        const st = await fsp.stat(filePath)
        if (!st.isFile()) continue
        meta.push({
          name,
          filePath,
          mtimeMs: st.mtimeMs,
          size: st.size
        })
      } catch {
        continue
      }
    }
    meta.sort((a, b) => b.mtimeMs - a.mtimeMs)

    const top = meta.slice(0, 120)
    return top.map((it) => ({ ...it, thumbUrl: null }))
  })
  ipcMain.handle('snip:saved:thumb', async (_event, payload: unknown) => {
    const filePath = typeof payload === 'string' ? payload : ''
    if (!filePath) return null
    if (!isWithinSnipSaveDir(filePath)) return null
    const cached = snipSavedThumbCache.get(filePath)
    if (cached !== undefined) return cached
    let thumbUrl: string | null = null
    try {
      const img = nativeImage.createFromPath(filePath)
      if (!img.isEmpty()) {
        const resized = img.resize({ width: 420 })
        const png = resized.toPNG()
        thumbUrl = `data:image/png;base64,${png.toString('base64')}`
      }
    } catch {
      thumbUrl = null
    }
    snipSavedThumbCache.set(filePath, thumbUrl)
    if (snipSavedThumbCache.size > 300) {
      const k = snipSavedThumbCache.keys().next().value as string | undefined
      if (k) snipSavedThumbCache.delete(k)
    }
    return thumbUrl
  })
  ipcMain.handle('snip:saved:clear', async () => {
    const dir = resolveSnipSaveDir()
    try {
      await fsp.mkdir(dir, { recursive: true })
    } catch {
      return 0
    }
    if (!existsSync(dir)) return 0

    let files: string[] = []
    try {
      files = await fsp.readdir(dir)
    } catch {
      return 0
    }

    const targets = files.filter((name) => {
      const lower = name.toLowerCase()
      if (!lower.endsWith('.png') && !lower.endsWith('.jpg') && !lower.endsWith('.jpeg'))
        return false
      return /^\d{17}\.(png|jpe?g)$/i.test(name)
    })

    let deleted = 0
    for (const name of targets) {
      const filePath = join(dir, name)
      try {
        await shell.trashItem(filePath)
        deleted += 1
        continue
      } catch {
        // ignore
      }
      try {
        await fsp.unlink(filePath)
        deleted += 1
      } catch {
        // ignore
      }
    }

    if (deleted > 0) broadcastSnipSavedChanged()
    return deleted
  })
  ipcMain.handle('snip:saved:reveal', async (_event, payload: unknown) => {
    if (typeof payload !== 'string' || !payload.trim()) return false
    try {
      shell.showItemInFolder(payload)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('snip:saved:stick', async (_event, payload: unknown) => {
    if (typeof payload !== 'string' || !payload.trim()) return false
    try {
      const img = nativeImage.createFromPath(payload)
      if (img.isEmpty()) return false
      stickersHidden = false
      createStickerWindow({ kind: 'image', data: img.toDataURL() })
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('break:status:get', () => getBreakStatus())
  ipcMain.handle(TRANSLATOR_EVENTS.TRANSLATE, async (_e, payload: TranslatePayload) => {
    return translate(payload)
  })
  ipcMain.handle(TRANSLATOR_EVENTS.OPEN_POPUP, async () => {
    await openTranslatorPopupFromSelection()
    return true
  })
  ipcMain.handle('translator-popup:close', (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.hide()
        win.close()
      }
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('sticker:close', (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.hide()
        win.close()
      }
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('sticker:context-menu', (event, payload: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return false

    const p = payload && typeof payload === 'object' ? (payload as Partial<StickerPayload>) : null
    const safePayload: StickerPayload | null =
      p &&
      (p.kind === 'image' || p.kind === 'text' || p.kind === 'color') &&
      typeof p.data === 'string' &&
      p.data
        ? { kind: p.kind, data: p.data }
        : null

    showStickerContextMenu(win, safePayload)
    return true
  })
  ipcMain.handle('sticker:ocr:recognize', async (_event, payload: unknown) => {
    const dataUrl = typeof payload === 'string' ? payload : ''
    stickerOcrProgressSink = (msg: unknown) => {
      const m =
        msg && typeof msg === 'object' ? (msg as { status?: unknown; progress?: unknown }) : {}
      const status = typeof m.status === 'string' ? m.status : ''
      const progress = Number(m.progress)
      try {
        _event.sender.send('sticker:ocr:progress', {
          status,
          progress: Number.isFinite(progress) ? progress : null
        })
      } catch {
        // ignore
      }
    }
    try {
      return await recognizeStickerImageText(dataUrl)
    } finally {
      stickerOcrProgressSink = null
    }
  })
  ipcMain.handle('sticker:clipboard:write-text', (event, payload: unknown) => {
    const text = typeof payload === 'string' ? payload : ''
    if (!text) return false
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return false
    try {
      clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  })
  ipcMain.on('sticker:set-position', (event, payload: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    if (!payload || typeof payload !== 'object') return
    const p = payload as { x?: unknown; y?: unknown }
    const x = Number(p.x)
    const y = Number(p.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    try {
      win.setPosition(Math.round(x), Math.round(y), false)
    } catch {
      // ignore
    }
  })
  ipcMain.on('sticker:set-bounds', (event, payload: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    if (!payload || typeof payload !== 'object') return
    const p = payload as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
    const x = Number(p.x)
    const y = Number(p.y)
    const width = Number(p.width)
    const height = Number(p.height)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (!Number.isFinite(width) || !Number.isFinite(height)) return
    if (width <= 0 || height <= 0) return
    const ratio = stickerAspectRatios.get(win.id) ?? null
    const cx = x + width / 2
    const cy = y + height / 2
    let nextW = width
    let nextH = height
    if (ratio && Number.isFinite(ratio) && ratio > 0) {
      const hFromW = width / ratio
      const wFromH = height * ratio
      if (Math.abs(hFromW - height) <= Math.abs(wFromH - width)) {
        nextH = hFromW
      } else {
        nextW = wFromH
      }
    }
    if (nextW <= 0 || nextH <= 0) return
    try {
      win.setBounds(
        {
          x: Math.round(cx - nextW / 2),
          y: Math.round(cy - nextH / 2),
          width: Math.round(nextW),
          height: Math.round(nextH)
        },
        false
      )
    } catch {
      // ignore
    }
  })
  ipcMain.handle('alarm:preview', (_, payload: unknown) => {
    const p = payload && typeof payload === 'object' ? (payload as { reason?: unknown }) : {}
    const reason: AlarmReason = p.reason === 'alarm' ? 'alarm' : 'break'
    previewAlarm(reason)
  })
  ipcMain.handle('settings:update', (_, patch: SettingsPatch) => {
    settings = applySettingsPatch(patch)
    saveSettingsToDisk(settings)
    applySettingsToRuntime()
    broadcastBreakStatus()
    return settings
  })

  ipcMain.on('alarm:action', (_, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as { action?: unknown; minutes?: unknown }
    if (p.action === 'close') dismissAlarmWindows()
    if (p.action === 'snooze') snoozeAlarm(Number(p.minutes))
  })

  screen.on('display-added', () => ensureOverlayWindows())
  screen.on('display-removed', () => ensureOverlayWindows())
  screen.on('display-metrics-changed', () => ensureOverlayWindows())

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
