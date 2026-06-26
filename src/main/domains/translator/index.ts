import { exec } from 'child_process'
import { createHash } from 'crypto'
import { promisify } from 'util'
import { join } from 'path'
import { BrowserWindow, clipboard, ipcMain, screen } from 'electron'
import type { AppSettings } from '@shared/settings'
import { TRANSLATOR_EVENTS, type TranslatePayload, type TranslateResult } from '@shared/translator'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import {
  createChatModel,
  resolveAiModelConfig,
  resolveApiKey,
  invokeText
} from '@main-core/ai-service'

const execAsync = promisify(exec)

type Deps = {
  getSettings: () => AppSettings
  loadWindowForPopup: (win: BrowserWindow, query: Record<string, string>) => Promise<void>
}

type TranslatorPopupOpenPayload = {
  text: string
  source?: string
  target?: string
  pendingSelection?: boolean
}

export function createTranslatorDomain(deps: Deps): {
  openPopupFromSelection: () => Promise<void>
  registerIpcHandlers: () => void
} {
  let translatorPopupWindow: BrowserWindow | null = null

  const ensureTranslatorPopupWindow = (): BrowserWindow => {
    if (translatorPopupWindow && !translatorPopupWindow.isDestroyed()) return translatorPopupWindow

    const display = screen.getPrimaryDisplay()
    const w = 360
    const h = 160
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
      backgroundColor: 'transparent',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true
      }
    })

    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    translatorPopupWindow = win

    deps.loadWindowForPopup(win, { mode: 'translator-popup' }).catch(() => null)

    win.on('closed', () => {
      if (translatorPopupWindow === win) translatorPopupWindow = null
    })

    return win
  }

  const showTranslatorPopupWindow = (win: BrowserWindow, activate: boolean): void => {
    win.setAlwaysOnTop(true, 'pop-up-menu')
    if (activate) {
      win.show()
    } else {
      win.showInactive()
    }
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.moveTop()
    if (activate) {
      win.focus()
      try {
        win.webContents.focus()
      } catch {
        void 0
      }
    }
  }

  const positionTranslatorPopupNearCursor = (win: BrowserWindow): void => {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const area = display.workArea
    const b = win.getBounds()
    const w = b.width
    const h = b.height
    const margin = 8
    let x = cursor.x + 12
    let y = cursor.y + 12
    const maxX = area.x + area.width - w - margin
    const maxY = area.y + area.height - h - margin
    if (x > maxX) x = maxX
    if (y > maxY) y = maxY
    if (x < area.x + margin) x = area.x + margin
    if (y < area.y + margin) y = area.y + margin
    try {
      win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h }, false)
    } catch (e) {
      console.error(e)
    }
  }

  const sendTranslatorPopupOpen = (
    win: BrowserWindow,
    payload: TranslatorPopupOpenPayload
  ): void => {
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('translator-popup:open', payload)
      })
    } else {
      win.webContents.send('translator-popup:open', payload)
    }
  }

  const sendCtrlCWindows = async (): Promise<void> => {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait("^c")
    `
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    await execAsync(`powershell -STA -EncodedCommand ${encoded}`)
  }

  const captureSelectionText = async (): Promise<string> => {
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

  const resolveTranslateConfig = (
    settings: AppSettings,
    payload: TranslatePayload
  ): {
    provider: AppSettings['translate']['provider']
    source: string
    target: string
    text: string
  } => {
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

  const md5Hex = (input: string): string => {
    return createHash('md5').update(input).digest('hex')
  }

  const translateWithBaidu = async (args: {
    baseUrl: string
    appId: string
    secret: string
    text: string
    source: string
    target: string
  }): Promise<string> => {
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

  const translateWithBing = async (args: {
    baseUrl: string
    key: string
    region: string
    text: string
    source: string
    target: string
  }): Promise<string> => {
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
      const t = data?.[0]?.translations?.[0]?.text
      return typeof t === 'string' ? t : ''
    } finally {
      clearTimeout(timeout)
    }
  }

  const trimAiTranslateText = (text: string): string => {
    const t = text.replace(/\r\n/g, '\n').trim()
    if (t.length <= 12000) return t
    return t.slice(0, 12000).trimEnd()
  }

  const translateWithAi = async (
    settings: AppSettings,
    args: { text: string; source: string; target: string }
  ): Promise<string> => {
    const sourceLabel = args.source && args.source !== 'auto' ? args.source : 'auto'
    const target = args.target
    if (!target) throw new Error('未指定目标语言')

    const config = resolveAiModelConfig(settings)
    const apiKey = resolveApiKey(config.profileId)
    const model = createChatModel(config, apiKey, {
      temperature: 0.1,
      maxTokens: 2000
    })
    const messages = [
      new SystemMessage('你是一个翻译引擎。只输出译文，不要解释，不要加引号。保留原文换行与格式。'),
      new HumanMessage(
        `请把下面内容翻译成目标语言。\n` +
          `源语言：${sourceLabel === 'auto' ? '自动检测' : sourceLabel}\n` +
          `目标语言：${target}\n` +
          `内容：\n` +
          args.text
      )
    ]

    const controller = new AbortController()
    const timeoutMs = 45000
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const content = await invokeText(model, messages, controller.signal)
      return trimAiTranslateText(content)
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
    } finally {
      clearTimeout(timeout)
    }
  }

  const translate = async (payload: TranslatePayload): Promise<TranslateResult> => {
    const settings = deps.getSettings()
    const cfg = resolveTranslateConfig(settings, payload)
    const text = cfg.text.trim()
    if (!text) return { text: '' }
    if (cfg.provider === 'ai') {
      const out = await translateWithAi(settings, { text, source: cfg.source, target: cfg.target })
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

  const openPopupFromSelection = async (): Promise<void> => {
    const win = ensureTranslatorPopupWindow()
    const settings = deps.getSettings()
    const base = {
      source: settings.translate.defaultSource,
      target: settings.translate.defaultTarget
    }
    positionTranslatorPopupNearCursor(win)
    showTranslatorPopupWindow(win, false)
    sendTranslatorPopupOpen(win, { text: '', ...base, pendingSelection: true })
    const text = await captureSelectionText()
    if (win.isDestroyed()) return
    sendTranslatorPopupOpen(win, { text, ...base, pendingSelection: false })
    showTranslatorPopupWindow(win, true)
  }

  const registerIpcHandlers = (): void => {
    ipcMain.handle(TRANSLATOR_EVENTS.TRANSLATE, async (_e, payload: TranslatePayload) => {
      return translate(payload)
    })
    ipcMain.handle(TRANSLATOR_EVENTS.OPEN_POPUP, async () => {
      await openPopupFromSelection()
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
  }

  return { openPopupFromSelection, registerIpcHandlers }
}
