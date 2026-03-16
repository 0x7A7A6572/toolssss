// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { isProxy, nextTick } from 'vue'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import ScreenshotsApp from '../ScreenshotsApp.vue'

enableAutoUnmount(afterEach)

type Listener = (...args: unknown[]) => void

type Display = {
  id: number
  x: number
  y: number
  width: number
  height: number
  scaleFactor?: number
}
type Bounds = { x: number; y: number; width: number; height: number }
type ScreenshotsData = { bounds: Bounds; display: Display }

type ScreenshotsMock = {
  api: {
    ready: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
    ok: ReturnType<typeof vi.fn>
    save: ReturnType<typeof vi.fn>
    on: (channel: string, fn: Listener) => void
    off: (channel: string, fn: Listener) => void
  }
  emit: (channel: string, ...args: unknown[]) => void
}

function createScreenshotsMock(): ScreenshotsMock {
  const listeners = new Map<string, Set<Listener>>()

  const on = (channel: string, fn: Listener): void => {
    const set = listeners.get(channel) ?? new Set<Listener>()
    set.add(fn)
    listeners.set(channel, set)
  }
  const off = (channel: string, fn: Listener): void => {
    const set = listeners.get(channel)
    if (!set) return
    set.delete(fn)
    if (set.size === 0) listeners.delete(channel)
  }
  const emit = (channel: string, ...args: unknown[]): void => {
    const set = listeners.get(channel)
    if (!set) return
    for (const fn of set) fn(...args)
  }

  return {
    api: {
      ready: vi.fn(),
      reset: vi.fn(),
      cancel: vi.fn(),
      ok: vi.fn(),
      save: vi.fn(),
      on,
      off
    },
    emit
  }
}

function dispatchPointer(
  el: Element,
  type: string,
  init: { clientX: number; clientY: number; button?: number; pointerId?: number }
): void {
  const e = new Event(type, { bubbles: true, cancelable: true }) as unknown as Record<
    string,
    unknown
  >
  e['clientX'] = init.clientX
  e['clientY'] = init.clientY
  e['button'] = init.button ?? 0
  e['pointerId'] = init.pointerId ?? 1
  el.dispatchEvent(e as unknown as Event)
}

function flushRaf(maxFrames = 10): void {
  const q = (globalThis as unknown as Record<string, unknown>)['_rafQueue'] as
    | FrameRequestCallback[]
    | undefined
  if (!q) return
  let i = 0
  while (q.length > 0 && i < maxFrames) {
    const cb = q.shift()
    if (cb) cb(i * 16)
    i += 1
  }
}

const display = { id: 1, x: 0, y: 0, width: 800, height: 600 }
const pngBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

let restoreGetContext: (() => void) | null = null
let restoreToBlob: (() => void) | null = null
let restoreToDataURL: (() => void) | null = null
let restoreFetch: (() => void) | null = null

beforeEach(() => {
  vi.useFakeTimers()

  if (!Blob.prototype.arrayBuffer) {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      value: function (): Promise<ArrayBuffer> {
        return Promise.resolve(new ArrayBuffer(0))
      }
    })
  }

  const prevGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = vi.fn(() => {
    return {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      strokeRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fillText: vi.fn(),
      bezierCurveTo: vi.fn(),
      ellipse: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn()
    }
  }) as unknown as HTMLCanvasElement['getContext']
  restoreGetContext = () => {
    HTMLCanvasElement.prototype.getContext = prevGetContext
  }

  const prevToBlob = HTMLCanvasElement.prototype.toBlob
  HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback) => {
    setTimeout(() => cb(pngBlob), 10)
  })
  restoreToBlob = () => {
    HTMLCanvasElement.prototype.toBlob = prevToBlob
  }

  const prevToDataURL = HTMLCanvasElement.prototype.toDataURL
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,iVBORw0KGgo=')
  restoreToDataURL = () => {
    HTMLCanvasElement.prototype.toDataURL = prevToDataURL
  }

  const prevFetch = globalThis.fetch
  globalThis.fetch = vi.fn(async () => {
    return {
      blob: async () => pngBlob
    } as unknown as Response
  }) as unknown as typeof fetch
  restoreFetch = () => {
    globalThis.fetch = prevFetch
  }

  const prevRaf = globalThis.requestAnimationFrame
  const prevCancel = globalThis.cancelAnimationFrame
  const rafQueue: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
    rafQueue.push(cb)
    return rafQueue.length
  }) as unknown as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', vi.fn() as unknown as typeof cancelAnimationFrame)
  ;(globalThis as unknown as Record<string, unknown>)['_rafQueue'] = rafQueue
  ;(globalThis as unknown as Record<string, unknown>)['_restoreRaf'] = () => {
    globalThis.requestAnimationFrame = prevRaf
    globalThis.cancelAnimationFrame = prevCancel
  }

  Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
  restoreGetContext?.()
  restoreToBlob?.()
  restoreToDataURL?.()
  restoreFetch?.()
  const restoreRaf = (globalThis as unknown as Record<string, unknown>)['_restoreRaf'] as
    | (() => void)
    | undefined
  restoreRaf?.()
  delete (window as unknown as Record<string, unknown>)['screenshots']
  delete (globalThis as unknown as Record<string, unknown>)['_rafQueue']
})

test('click OK triggers window.screenshots.ok and disables button while pending', async () => {
  const mock = createScreenshotsMock()
  ;(window as unknown as Record<string, unknown>)['screenshots'] = mock.api

  const wrapper = mount(ScreenshotsApp, { attachTo: document.body })
  await nextTick()

  mock.emit('capture', display, 'data:image/png;base64,iVBORw0KGgo=')
  await nextTick()

  const img = wrapper.get('img.bg').element as HTMLImageElement
  Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true })
  await wrapper.get('img.bg').trigger('load')
  await nextTick()

  const canvas = wrapper.get('canvas.overlay').element as HTMLCanvasElement & {
    setPointerCapture?: (id: number) => void
    releasePointerCapture?: (id: number) => void
  }
  canvas.setPointerCapture = vi.fn()
  canvas.releasePointerCapture = vi.fn()

  dispatchPointer(canvas, 'pointerdown', { clientX: 10, clientY: 10, pointerId: 1, button: 0 })
  dispatchPointer(canvas, 'pointermove', { clientX: 110, clientY: 110, pointerId: 1, button: 0 })
  flushRaf()
  dispatchPointer(canvas, 'pointerup', { clientX: 110, clientY: 110, pointerId: 1, button: 0 })
  flushRaf()
  await nextTick()

  const okBtn = wrapper.get('.toolbar button[aria-label="完成"]')
  await okBtn.trigger('click')
  await nextTick()
  expect(okBtn.attributes('disabled')).toBeDefined()

  await vi.runAllTimersAsync()
  await nextTick()

  expect(mock.api.ok).toHaveBeenCalledTimes(1)
  const payload = mock.api.ok.mock.calls[0]?.[1] as ScreenshotsData | undefined
  expect(payload?.bounds).toMatchObject({ x: 10, y: 10, width: 100, height: 100 })
  expect(payload?.bounds ? isProxy(payload.bounds) : false).toBe(false)
  expect(payload?.display ? isProxy(payload.display) : false).toBe(false)
})

test('click OK still works when canvas.toBlob returns null (fallback path)', async () => {
  const prevToBlob = HTMLCanvasElement.prototype.toBlob
  HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback) => {
    setTimeout(() => cb(null), 10)
  })

  const mock = createScreenshotsMock()
  ;(window as unknown as Record<string, unknown>)['screenshots'] = mock.api

  const wrapper = mount(ScreenshotsApp, { attachTo: document.body })
  await nextTick()

  mock.emit('capture', display, 'data:image/png;base64,iVBORw0KGgo=')
  await nextTick()

  const img = wrapper.get('img.bg').element as HTMLImageElement
  Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true })
  await wrapper.get('img.bg').trigger('load')
  await nextTick()

  const canvas = wrapper.get('canvas.overlay').element as HTMLCanvasElement & {
    setPointerCapture?: (id: number) => void
    releasePointerCapture?: (id: number) => void
  }
  canvas.setPointerCapture = vi.fn()
  canvas.releasePointerCapture = vi.fn()

  dispatchPointer(canvas, 'pointerdown', { clientX: 10, clientY: 10, pointerId: 1, button: 0 })
  dispatchPointer(canvas, 'pointermove', { clientX: 110, clientY: 110, pointerId: 1, button: 0 })
  flushRaf()
  dispatchPointer(canvas, 'pointerup', { clientX: 110, clientY: 110, pointerId: 1, button: 0 })
  flushRaf()
  await nextTick()

  await wrapper.get('.toolbar button[aria-label="完成"]').trigger('click')
  await vi.runAllTimersAsync()
  await nextTick()

  expect(mock.api.ok).toHaveBeenCalledTimes(1)

  HTMLCanvasElement.prototype.toBlob = prevToBlob
})

test('press C without selection cancels after copying color', async () => {
  const mock = createScreenshotsMock()
  ;(mock.api as unknown as Record<string, unknown>)['copyText'] = vi.fn()
  ;(window as unknown as Record<string, unknown>)['screenshots'] = mock.api

  const wrapper = mount(ScreenshotsApp, { attachTo: document.body })
  await nextTick()

  mock.emit('capture', display, 'data:image/png;base64,iVBORw0KGgo=')
  await nextTick()

  const img = wrapper.get('img.bg').element as HTMLImageElement
  Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true })
  await wrapper.get('img.bg').trigger('load')
  await nextTick()

  const canvas = wrapper.get('canvas.overlay').element as HTMLCanvasElement
  dispatchPointer(canvas, 'pointermove', { clientX: 20, clientY: 30, pointerId: 1, button: 0 })
  flushRaf()
  await nextTick()

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }))
  await vi.runAllTimersAsync()
  await nextTick()

  expect(mock.api.cancel).toHaveBeenCalledTimes(1)
})

test('right click without selection cancels screenshot', async () => {
  const mock = createScreenshotsMock()
  ;(window as unknown as Record<string, unknown>)['screenshots'] = mock.api

  const wrapper = mount(ScreenshotsApp, { attachTo: document.body })
  await nextTick()

  mock.emit('capture', display, 'data:image/png;base64,iVBORw0KGgo=')
  await nextTick()

  await wrapper.get('canvas.overlay').trigger('contextmenu')
  await nextTick()

  expect(mock.api.cancel).toHaveBeenCalledTimes(1)
})

test('press F3 with selection triggers save with stickAfterSave', async () => {
  const mock = createScreenshotsMock()
  ;(window as unknown as Record<string, unknown>)['screenshots'] = mock.api

  const wrapper = mount(ScreenshotsApp, { attachTo: document.body })
  await nextTick()

  mock.emit('capture', display, 'data:image/png;base64,iVBORw0KGgo=')
  await nextTick()

  const img = wrapper.get('img.bg').element as HTMLImageElement
  Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true })
  await wrapper.get('img.bg').trigger('load')
  await nextTick()

  const canvas = wrapper.get('canvas.overlay').element as HTMLCanvasElement & {
    setPointerCapture?: (id: number) => void
    releasePointerCapture?: (id: number) => void
  }
  canvas.setPointerCapture = vi.fn()
  canvas.releasePointerCapture = vi.fn()

  dispatchPointer(canvas, 'pointerdown', { clientX: 10, clientY: 10, pointerId: 1, button: 0 })
  dispatchPointer(canvas, 'pointermove', { clientX: 110, clientY: 110, pointerId: 1, button: 0 })
  flushRaf()
  dispatchPointer(canvas, 'pointerup', { clientX: 110, clientY: 110, pointerId: 1, button: 0 })
  flushRaf()
  await nextTick()

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3' }))
  await vi.runAllTimersAsync()
  await nextTick()

  expect(mock.api.save).toHaveBeenCalledTimes(1)
  const payload = mock.api.save.mock.calls[0]?.[1] as ScreenshotsData & {
    stickAfterSave?: boolean
  }
  expect(payload?.stickAfterSave).toBe(true)
})

test('text editor Enter does not trigger OK', async () => {
  const mock = createScreenshotsMock()
  ;(window as unknown as Record<string, unknown>)['screenshots'] = mock.api

  const wrapper = mount(ScreenshotsApp, { attachTo: document.body })
  await nextTick()

  mock.emit('capture', display, 'data:image/png;base64,iVBORw0KGgo=')
  await nextTick()

  const img = wrapper.get('img.bg').element as HTMLImageElement
  Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true })
  await wrapper.get('img.bg').trigger('load')
  await nextTick()

  const canvas = wrapper.get('canvas.overlay').element as HTMLCanvasElement & {
    setPointerCapture?: (id: number) => void
    releasePointerCapture?: (id: number) => void
  }
  canvas.setPointerCapture = vi.fn()
  canvas.releasePointerCapture = vi.fn()

  dispatchPointer(canvas, 'pointerdown', { clientX: 10, clientY: 10, pointerId: 1, button: 0 })
  dispatchPointer(canvas, 'pointermove', { clientX: 110, clientY: 110, pointerId: 1, button: 0 })
  flushRaf()
  dispatchPointer(canvas, 'pointerup', { clientX: 110, clientY: 110, pointerId: 1, button: 0 })
  flushRaf()
  await nextTick()

  await wrapper.get('.toolbar button[aria-label="文字"]').trigger('click')
  await nextTick()

  dispatchPointer(canvas, 'pointerdown', { clientX: 20, clientY: 20, pointerId: 2, button: 0 })
  flushRaf()
  await nextTick()

  const textarea = wrapper.get('textarea.text-editor')
  await textarea.setValue('hello')
  await textarea.trigger('keydown', { key: 'Enter' })
  await nextTick()

  expect(mock.api.ok).toHaveBeenCalledTimes(0)
})

describe('e2e-ish viewport coverage', () => {
  test.each([
    { w: 800, h: 600 },
    { w: 1366, h: 768 },
    { w: 1920, h: 1080 }
  ])('toolbar remains clickable at ${w}x${h}', async ({ w, h }) => {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })

    const mock = createScreenshotsMock()
    ;(window as unknown as Record<string, unknown>)['screenshots'] = mock.api

    const wrapper = mount(ScreenshotsApp, { attachTo: document.body })
    await nextTick()

    mock.emit('capture', { ...display, width: w, height: h }, 'data:image/png;base64,iVBORw0KGgo=')
    await nextTick()

    const img = wrapper.get('img.bg').element as HTMLImageElement
    Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true })
    await wrapper.get('img.bg').trigger('load')
    await nextTick()

    const canvas = wrapper.get('canvas.overlay').element as HTMLCanvasElement & {
      setPointerCapture?: (id: number) => void
      releasePointerCapture?: (id: number) => void
    }
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()

    dispatchPointer(canvas, 'pointerdown', { clientX: 10, clientY: 10, pointerId: 1, button: 0 })
    dispatchPointer(canvas, 'pointermove', { clientX: 110, clientY: 110, pointerId: 1, button: 0 })
    flushRaf()
    dispatchPointer(canvas, 'pointerup', { clientX: 110, clientY: 110, pointerId: 1, button: 0 })
    flushRaf()
    await nextTick()

    await wrapper.get('.toolbar button[aria-label="完成"]').trigger('click')
    await vi.runAllTimersAsync()
    await nextTick()

    expect(mock.api.ok).toHaveBeenCalledTimes(1)
  })
})
