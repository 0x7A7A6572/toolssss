import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { setMouseHookCallback, getPythonPort, getCallbackPort } from '@main-core/python-server'

// =============================================================================
// 类型
// =============================================================================

type Deps = {
  icon: string
  loadWindow: (win: BrowserWindow, query: Record<string, string>) => Promise<void>
  getSettings: () => { general: { immersiveMode: boolean } }
}

type MouseHookEvent = { action: string; deltaY: number; startX: number; startY: number }

// =============================================================================
// 内部状态
// =============================================================================

let deps: Deps | null = null
let overlayWindow: BrowserWindow | null = null
let hookRunning = false
let hookStarting = false
let overlayReady = false

function dbg(...args: unknown[]): void {
  console.log('[MouseHook]', ...args)
}

// =============================================================================
// Python 通信
// =============================================================================

async function postPython<T>(path: string, payload: unknown): Promise<T | null> {
  const port = getPythonPort()
  if (!port) {
    dbg('postPython: Python 端口未就绪')
    return null
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) {
      dbg(`postPython ${path}: HTTP ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (e) {
    dbg(`postPython ${path}: fetch 失败 —`, String(e))
    return null
  }
}

// =============================================================================
// 钩子启停
// =============================================================================

async function startHook(): Promise<void> {
  if (hookRunning || hookStarting) return
  hookStarting = true
  try {
    const port = getCallbackPort()
    dbg(`尝试启动钩子, callbackPort=${port}, pythonPort=${getPythonPort()}`)
    if (!port) throw new Error('回调端口未就绪')

    const res = await postPython<{ running?: boolean }>('/api/mouse-hook/start', {
      callback_port: port
    })
    dbg(`Python 响应:`, JSON.stringify(res))
    if (res && res.running) {
      hookRunning = true
      dbg('全局鼠标钩子已启动')
      // 预加载覆盖窗口，确保用户首次触发中键时立即可用（无需等待 BrowserWindow 创建和渲染加载）
      preloadOverlay()
    } else {
      dbg('全局鼠标钩子启动失败（Python 返回 running=false）')
    }
  } catch (e) {
    dbg('启动失败:', e instanceof Error ? e.message : e)
  } finally {
    hookStarting = false
  }
}

async function stopHook(): Promise<void> {
  if (!hookRunning) return
  try {
    await postPython('/api/mouse-hook/stop', {})
  } catch {
    void 0
  }
  hookRunning = false
  dbg('全局鼠标钩子已停止')
}

// =============================================================================
// 沉浸模式判断
// =============================================================================

function isImmersive(): boolean {
  return deps?.getSettings()?.general?.immersiveMode !== false
}

// =============================================================================
// 覆盖窗口创建
// =============================================================================

/** 根据沉浸模式构建 BrowserWindow 构造参数 */
function buildWindowOptions(
  displayBounds: Electron.Rectangle
): Electron.BrowserWindowConstructorOptions {
  const immersive = isImmersive()

  if (immersive) {
    // 沉浸模式：全屏透明无框窗口
    return {
      x: displayBounds.x,
      y: displayBounds.y,
      width: displayBounds.width,
      height: displayBounds.height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: '#00000000'
    }
  }

  // 非沉浸模式：标准窗口，带标题栏和边框
  const winWidth = 960
  const winHeight = 680
  return {
    width: winWidth,
    height: winHeight,
    // 居中
    x: Math.round(displayBounds.x + (displayBounds.width - winWidth) / 2),
    y: Math.round(displayBounds.y + (displayBounds.height - winHeight) / 2),
    show: false,
    frame: true,
    transparent: false,
    resizable: true,
    movable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    hasShadow: true,
    backgroundColor: '#1a1a1a',
    title: 'Forge Studio'
  }
}

/** 预加载覆盖窗口：创建 BrowserWindow 并加载渲染进程，但保持隐藏。
 *  在全局鼠标钩子启动后立即调用，确保用户首次触发中键时窗口立即可用。 */
function preloadOverlay(): void {
  if (!deps) return
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    dbg('覆盖窗口已存在，无需预加载')
    return
  }

  const immersive = isImmersive()
  dbg(`预加载覆盖窗口（${immersive ? '沉浸' : '窗口'}模式）...`)
  const primaryDisplay = screen.getPrimaryDisplay()
  const options = buildWindowOptions(primaryDisplay.bounds)

  overlayWindow = new BrowserWindow({
    ...options,
    ...(process.platform === 'linux' ? { icon: deps.icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  if (immersive) {
    overlayWindow.setAlwaysOnTop(true, 'screen-saver', 20)
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // 预加载阶段：隐藏窗口并转发鼠标事件，用户触发前不拦截任何操作
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  }

  // 开发模式：打开 DevTools 方便调试
  // if (is.dev) overlayWindow.webContents.openDevTools({ mode: 'detach' })

  deps.loadWindow(overlayWindow, { mode: 'mouse-hook-overlay' }).catch(() => null)

  overlayWindow.webContents.once('did-finish-load', () => {
    overlayReady = true
    dbg('覆盖窗口预加载完成（隐藏待命）')
  })

  overlayWindow.on('closed', () => {
    overlayReady = false
    overlayWindow = null
    dbg('覆盖窗口已关闭')
  })
}

function createOverlay(): void {
  if (!deps) return
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    dbg('覆盖窗口已存在，showInactive')
    overlayWindow.showInactive()
    if (isImmersive()) {
      overlayWindow.setIgnoreMouseEvents(false)
    }
    return
  }

  const immersive = isImmersive()
  dbg(`覆盖窗口不存在，即时创建（${immersive ? '沉浸' : '窗口'}模式）...`)
  const primaryDisplay = screen.getPrimaryDisplay()
  const options = buildWindowOptions(primaryDisplay.bounds)

  overlayWindow = new BrowserWindow({
    ...options,
    ...(process.platform === 'linux' ? { icon: deps.icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  if (immersive) {
    overlayWindow.setAlwaysOnTop(true, 'screen-saver', 20)
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  // 开发模式：打开 DevTools 方便调试
  if (is.dev) overlayWindow.webContents.openDevTools({ mode: 'detach' })

  deps.loadWindow(overlayWindow, { mode: 'mouse-hook-overlay' }).catch(() => null)

  overlayWindow.webContents.once('did-finish-load', () => {
    overlayReady = true
    overlayWindow?.showInactive()
    if (immersive) {
      overlayWindow?.setIgnoreMouseEvents(false)
    }
    dbg('覆盖窗口已加载并就绪（可直接点击关闭）')
  })

  overlayWindow.on('closed', () => {
    overlayReady = false
    overlayWindow = null
    dbg('覆盖窗口已关闭')
  })
}

function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide()
    if (isImmersive()) {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    }
  }
}

function destroyOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close()
  }
  overlayWindow = null
  overlayReady = false
}

function sendOverlayIpc(event: MouseHookEvent): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('mouse-hook:event', event)
  } else {
    dbg(`sendOverlayIpc(${event.action}): 窗口不可用`)
  }
}

// =============================================================================
// 事件处理器
// =============================================================================

function onHookEvent(event: MouseHookEvent): void {
  switch (event.action) {
    case 'start':
      // 中键松开后触发：显示预加载的覆盖窗口，直接进入可点击状态
      createOverlay()
      sendWhenReady(event)
      break
    case 'move':
      sendOverlayIpc(event)
      break
    case 'key_esc':
      hideOverlay()
      break
  }
}

function sendWhenReady(event: MouseHookEvent): void {
  const wc = overlayWindow?.webContents
  if (!overlayWindow || overlayWindow.isDestroyed() || !wc) {
    dbg('sendWhenReady: 无可用窗口')
    return
  }
  if (!wc.isLoading() && overlayReady) {
    sendOverlayIpc(event)
    return
  }
  dbg('sendWhenReady: 等待 did-finish-load...')
  wc.once('did-finish-load', () => {
    overlayReady = true
    sendOverlayIpc(event)
  })
}

// =============================================================================
// 公开 API
// =============================================================================

export function createMouseHookDomain(dependencies: Deps): {
  start: () => Promise<void>
  stop: () => Promise<void>
  isRunning: () => boolean
  hideOverlay: () => void
  showOverlay: () => void
  getOverlayWindow: () => BrowserWindow | null
  dispose: () => void
} {
  deps = dependencies
  setMouseHookCallback(onHookEvent)

  return {
    start: startHook,
    stop: stopHook,
    isRunning: () => hookRunning,
    hideOverlay,
    showOverlay: () => createOverlay(),
    getOverlayWindow: () => overlayWindow,
    dispose: () => {
      stopHook().catch(() => null)
      destroyOverlay()
      setMouseHookCallback(null)
      deps = null
    }
  }
}
