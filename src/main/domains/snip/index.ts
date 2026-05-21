import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  shell,
  type OpenDialogOptions
} from 'electron'
import { existsSync } from 'fs'
import { promises as fsp } from 'fs'
import { join, resolve, sep } from 'path'
import Screenshots from '@libs/electron-screenshots/index'

type Deps = {
  getMainWindow: () => BrowserWindow | null
  getSnipSaveDirSetting: () => string
  setCapturing: (capturing: boolean) => void
  suspendOverlayForSnip: () => void
  resumeOverlayAfterSnip: () => void
  stickFromClipboard: () => void
  openStickerFromImageDataUrl: (dataUrl: string) => void
}

export function createSnipDomain(deps: Deps): {
  startCapture: () => void
  registerIpcHandlers: () => void
} {
  let screenshots: Screenshots | null = null
  let isScreenshotsHooked = false
  const snipSavedThumbCache = new Map<string, string | null>()

  const broadcastSnipSavedChanged = (): void => {
    const win = deps.getMainWindow()
    if (!win || win.isDestroyed()) return
    if (win.webContents.isLoading()) return
    win.webContents.send('snip:saved:changed')
  }

  const defaultSnipSaveDir = (): string => {
    const pictures = app.getPath('pictures')
    const legacy = join(pictures, 'freamx', 'screenshots')
    const next = join(pictures, 'toolssss', 'screenshots')
    if (existsSync(legacy) && !existsSync(next)) return legacy
    return next
  }

  const resolveSnipSaveDir = (): string => {
    const raw = deps.getSnipSaveDirSetting().trim()
    return raw ? raw : defaultSnipSaveDir()
  }

  const isWithinSnipSaveDir = (filePath: string): boolean => {
    const base = resolveSnipSaveDir()
    const absBase = resolve(base)
    const absTarget = resolve(filePath)
    const basePrefix = absBase.endsWith(sep) ? absBase : absBase + sep
    if (process.platform === 'win32') {
      return absTarget.toLowerCase().startsWith(basePrefix.toLowerCase())
    }
    return absTarget.startsWith(basePrefix)
  }

  const formatSnipFileName = (ts: number): string => {
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

  const saveSnipBufferToDisk = async (buffer: Buffer): Promise<string | null> => {
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

  const ensureScreenshots = (): Screenshots => {
    if (!screenshots) {
      screenshots = new Screenshots({
        singleWindow: true,
        sandbox: process.env.SCREENSHOTS_VIEW_SANDBOX === '1'
      })
      isScreenshotsHooked = false
    }
    return screenshots
  }

  const hookScreenshotsOnce = (): void => {
    if (isScreenshotsHooked) return
    const sc = ensureScreenshots()
    isScreenshotsHooked = true
    sc.on('windowClosed', () => {
      deps.setCapturing(false)
      deps.resumeOverlayAfterSnip()
    })
    sc.on('windowCreated', (win: BrowserWindow) => {
      win.on('hide', () => {
        deps.setCapturing(false)
        deps.resumeOverlayAfterSnip()
      })
      win.on('closed', () => {
        deps.setCapturing(false)
        deps.resumeOverlayAfterSnip()
      })
    })

    sc.on('save', (event, buffer, data) => {
      event.preventDefault()
      const stickAfterSave =
        Boolean(data) &&
        typeof data === 'object' &&
        (data as Record<string, unknown>)['stickAfterSave'] === true
      try {
        const img = nativeImage.createFromBuffer(buffer)
        if (!img.isEmpty()) clipboard.writeImage(img)
      } catch {
        void 0
      }
      void saveSnipBufferToDisk(buffer).finally(() => {
        sc.endCapture()
          .catch(() => null)
          .finally(() => {
            if (stickAfterSave) deps.stickFromClipboard()
          })
      })
    })

    sc.on('ok', (_event, buffer) => {
      try {
        const img = nativeImage.createFromBuffer(buffer)
        if (img.isEmpty()) return
        clipboard.writeImage(img)
      } catch {
        return
      }
    })

    sc.on('cancel', () => {
      deps.setCapturing(false)
      deps.resumeOverlayAfterSnip()
    })
  }

  const startCapture = (): void => {
    hookScreenshotsOnce()
    deps.suspendOverlayForSnip()
    deps.setCapturing(true)
    ensureScreenshots()
      .startCapture()
      .catch(() => {
        deps.setCapturing(false)
        deps.resumeOverlayAfterSnip()
        return null
      })
  }

  const registerIpcHandlers = (): void => {
    ipcMain.handle('snip:saveDir:choose', async () => {
      const parent = deps.getMainWindow()
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
      const meta: Array<{ name: string; filePath: string; mtimeMs: number; size: number }> = []
      for (const name of files) {
        const lower = name.toLowerCase()
        if (!lower.endsWith('.png') && !lower.endsWith('.jpg') && !lower.endsWith('.jpeg')) continue
        const filePath = join(dir, name)
        try {
          const st = await fsp.stat(filePath)
          if (!st.isFile()) continue
          meta.push({ name, filePath, mtimeMs: st.mtimeMs, size: st.size })
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
          void 0
        }
        try {
          await fsp.unlink(filePath)
          deleted += 1
        } catch {
          void 0
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
        deps.openStickerFromImageDataUrl(img.toDataURL())
        return true
      } catch {
        return false
      }
    })
  }

  return { startCapture, registerIpcHandlers }
}
