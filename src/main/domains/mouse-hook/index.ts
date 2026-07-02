import { BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

// =============================================================================
// 类型
// =============================================================================

type Deps = {
  icon: string
  loadWindow: (win: BrowserWindow, query: Record<string, string>) => Promise<void>
  getSettings: () => { general: { immersiveMode: boolean } }
}

// =============================================================================
// 常量
// =============================================================================

/** 呼出覆盖窗口的全局快捷键 */
const TOGGLE_SHORTCUT = 'Alt+`'

// =============================================================================
// 内部状态
// =============================================================================

let deps: Deps | null = null
let overlayWindow: BrowserWindow | null = null

function dbg(...args: unknown[]): void {
  console.log('[MouseHook]', ...args)
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
 *  在注册全局快捷键后立即调用，确保用户首次触发时窗口立即可用。 */
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

  deps.loadWindow(overlayWindow, { mode: 'mouse-hook-overlay' }).catch(() => null)

  overlayWindow.webContents.once('did-finish-load', () => {
    dbg('覆盖窗口预加载完成（隐藏待命）')
  })

  overlayWindow.on('closed', () => {
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
    overlayWindow.webContents.send('mouse-hook:show')
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

  if (is.dev) overlayWindow.webContents.openDevTools({ mode: 'detach' })

  deps.loadWindow(overlayWindow, { mode: 'mouse-hook-overlay' }).catch(() => null)

  overlayWindow.webContents.once('did-finish-load', () => {
    overlayWindow?.showInactive()
    if (immersive) {
      overlayWindow?.setIgnoreMouseEvents(false)
    }
    dbg('覆盖窗口已加载并就绪')
  })

  overlayWindow.on('closed', () => {
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
}

// =============================================================================
// 快捷键盘启停
// =============================================================================

function registerShortcut(): boolean {
  const ok = globalShortcut.register(TOGGLE_SHORTCUT, () => {
    // 切換：覆蓋窗口顯示中 → 隱藏，否則 → 顯示
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      hideOverlay()
    } else {
      createOverlay()
    }
  })
  if (ok) {
    dbg(`全局快捷鍵 ${TOGGLE_SHORTCUT} 已註冊`)
  } else {
    dbg(`全局快捷鍵 ${TOGGLE_SHORTCUT} 註冊失敗（可能被其他應用佔用）`)
  }
  // 無論快捷鍵是否註冊成功，都預加載覆蓋窗口
  // 否則應用沒有任何窗口時會觸發 window-all-closed → app.quit()
  preloadOverlay()
  return ok
}

function unregisterShortcut(): void {
  globalShortcut.unregister(TOGGLE_SHORTCUT)
  dbg(`全局快捷鍵 ${TOGGLE_SHORTCUT} 已卸載`)
}

// =============================================================================
// 公开 API
// =============================================================================

export function createMouseHookDomain(dependencies: Deps): {
  start: () => boolean
  stop: () => void
  isRunning: () => boolean
  hideOverlay: () => void
  showOverlay: () => void
  getOverlayWindow: () => BrowserWindow | null
  dispose: () => void
} {
  deps = dependencies

  return {
    start: () => registerShortcut(),
    stop: unregisterShortcut,
    isRunning: () => globalShortcut.isRegistered(TOGGLE_SHORTCUT),
    hideOverlay,
    showOverlay: () => createOverlay(),
    getOverlayWindow: () => overlayWindow,
    dispose: () => {
      unregisterShortcut()
      destroyOverlay()
      deps = null
    }
  }
}
