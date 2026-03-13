type ScreenshotsListener = (...args: unknown[]) => void

interface ScreenshotsBounds {
  x: number
  y: number
  width: number
  height: number
}

interface ScreenshotsDisplay {
  id: number
  x: number
  y: number
  width: number
  height: number
  scaleFactor?: number
}

interface ScreenshotsData {
  bounds: ScreenshotsBounds
  display: ScreenshotsDisplay
}

interface GlobalScreenshots {
  ready: () => void
  copyText?: (text: string) => void
  reset: () => void
  save: (arrayBuffer: ArrayBuffer, data: ScreenshotsData) => void
  cancel: () => void
  ok: (arrayBuffer: ArrayBuffer, data: ScreenshotsData) => void
  on: (channel: string, fn: ScreenshotsListener) => void
  off: (channel: string, fn: ScreenshotsListener) => void
}

declare global {
  interface Window {
    screenshots: GlobalScreenshots
  }
}

export {}
