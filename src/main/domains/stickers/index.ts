import { createHash } from 'crypto'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  type MenuItemConstructorOptions
} from 'electron'
import { existsSync } from 'fs'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { clampNumber } from '@main-shared/primitives'

type Deps = {
  icon: string
  loadWindow: (win: BrowserWindow, query: Record<string, string>) => Promise<void>
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
              void 0
            }
            const chiDst = join(devLangPath, 'chi_sim.traineddata.gz')
            const engDst = join(devLangPath, 'eng.traineddata.gz')
            try {
              await fsp.copyFile(chiSrc, chiDst)
            } catch {
              void 0
            }
            try {
              await fsp.copyFile(engSrc, engDst)
            } catch {
              void 0
            }
            if (existsSync(chiDst) && existsSync(engDst)) {
              langPath = devLangPath
            }
          }
        } catch {
          void 0
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
            void 0
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

const stickerWindows = new Map<number, BrowserWindow>()
const stickerAspectRatios = new Map<number, number>()
const pendingStickerInits = new Map<number, StickerPayload>()
let stickersHidden = false

function stashStickerInit(winId: number, payload: StickerPayload): void {
  pendingStickerInits.set(winId, payload)
}

function takeStickerInit(winId: number): StickerPayload | null {
  const payload = pendingStickerInits.get(winId)
  if (!payload) return null
  pendingStickerInits.delete(winId)
  return payload
}

function createStickerWindow(deps: Deps, payload: StickerPayload): BrowserWindow {
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
    ...(process.platform === 'linux' ? { icon: deps.icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver', 0)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0) {
    try {
      win.setAspectRatio(aspectRatio)
      stickerAspectRatios.set(win.id, aspectRatio)
    } catch {
      void 0
    }
  }

  stashStickerInit(win.id, payload)

  deps.loadWindow(win, { mode: 'sticker' }).catch(() => null)

  win.webContents.on('context-menu', (event) => {
    event.preventDefault()
    showStickerContextMenu(win, payload)
  })

  win.webContents.once('did-finish-load', () => {
    win.showInactive()
    try {
      app.focus()
    } catch {
      void 0
    }
    win.moveTop()
    win.focus()
  })

  win.on('closed', () => {
    pendingStickerInits.delete(win.id)
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
            void 0
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
            void 0
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
            void 0
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
        void 0
      }
    }
  })

  const menu = Menu.buildFromTemplate(template)

  menu.popup({ window: win })
}

export function createStickersDomain(deps: Deps): {
  pasteFromClipboard: () => void
  openImageDataUrl: (dataUrl: string) => void
  toggleHidden: () => void
  registerIpcHandlers: () => void
} {
  const pasteFromClipboard = (): void => {
    const payload = readClipboardAsStickerPayload()
    if (!payload) return
    stickersHidden = false
    createStickerWindow(deps, payload)
  }

  const openImageDataUrl = (dataUrl: string): void => {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return
    stickersHidden = false
    createStickerWindow(deps, { kind: 'image', data: dataUrl })
  }

  const toggleHidden = (): void => {
    stickersHidden = !stickersHidden
    for (const win of stickerWindows.values()) {
      if (win.isDestroyed()) continue
      if (stickersHidden) win.hide()
      else win.showInactive()
    }
  }

  const registerIpcHandlers = (): void => {
    ipcMain.handle('sticker:ready', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return null
      return takeStickerInit(win.id)
    })

    ipcMain.handle('sticker:close', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return false
      try {
        win.hide()
        win.close()
        return true
      } catch {
        return false
      }
    })

    ipcMain.handle('sticker:context-menu', (event, payload: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return false
      const p =
        payload && typeof payload === 'object'
          ? (payload as { kind?: unknown; data?: unknown })
          : {}
      const kind = p.kind === 'image' || p.kind === 'text' || p.kind === 'color' ? p.kind : null
      const data = typeof p.data === 'string' ? p.data : ''
      const normalized: StickerPayload | null = kind && data ? { kind, data } : null
      showStickerContextMenu(win, normalized)
      return true
    })

    ipcMain.handle('sticker:ocr:recognize', async (_event, payload: unknown) => {
      const p = payload && typeof payload === 'object' ? (payload as { dataUrl?: unknown }) : {}
      const dataUrl =
        typeof payload === 'string' ? payload : typeof p.dataUrl === 'string' ? p.dataUrl : ''
      if (!dataUrl) return null
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
          void 0
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
        void 0
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
        void 0
      }
    })
  }

  return { pasteFromClipboard, openImageDataUrl, toggleHidden, registerIpcHandlers }
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
