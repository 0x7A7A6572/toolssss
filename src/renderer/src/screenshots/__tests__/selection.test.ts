import { describe, expect, test } from 'vitest'
import {
  computeDragBounds,
  getHandleAtPoint,
  isPointInBounds,
  normalizeBounds,
  type Bounds
} from '../selection'

describe('selection', () => {
  test('normalizeBounds handles reverse drag', () => {
    const b = normalizeBounds({ x1: 200, y1: 300, x2: 100, y2: 120 })
    expect(b).toEqual({ x: 100, y: 120, width: 100, height: 180 })
  })

  test('computeDragBounds new mode', () => {
    const b = computeDragBounds({
      mode: 'new',
      start: { x: 100, y: 100 },
      startBounds: null,
      pointer: { x: 220, y: 260 },
      viewportWidth: 1920,
      viewportHeight: 1080
    })
    expect(b).toEqual({ x: 100, y: 100, width: 120, height: 160 })
  })

  test('computeDragBounds move mode', () => {
    const startBounds: Bounds = { x: 10, y: 10, width: 100, height: 80 }
    const b = computeDragBounds({
      mode: 'move',
      start: { x: 50, y: 50 },
      startBounds,
      pointer: { x: 70, y: 90 },
      viewportWidth: 1920,
      viewportHeight: 1080
    })
    expect(b).toEqual({ x: 30, y: 50, width: 100, height: 80 })
  })

  test('computeDragBounds resize-se mode', () => {
    const startBounds: Bounds = { x: 100, y: 100, width: 100, height: 100 }
    const b = computeDragBounds({
      mode: 'resize-se',
      start: { x: 200, y: 200 },
      startBounds,
      pointer: { x: 240, y: 260 },
      viewportWidth: 1920,
      viewportHeight: 1080
    })
    expect(b).toEqual({ x: 100, y: 100, width: 140, height: 160 })
  })

  test('computeDragBounds clamps to viewport', () => {
    const b = computeDragBounds({
      mode: 'new',
      start: { x: 900, y: 500 },
      startBounds: null,
      pointer: { x: 2000, y: 2000 },
      viewportWidth: 1000,
      viewportHeight: 600
    })
    expect(b).toEqual({ x: 900, y: 500, width: 100, height: 100 })
  })

  test('getHandleAtPoint returns corner handles', () => {
    const b: Bounds = { x: 100, y: 100, width: 200, height: 100 }
    expect(getHandleAtPoint({ x: 100, y: 100 }, b, 6)).toBe('resize-nw')
    expect(getHandleAtPoint({ x: 300, y: 100 }, b, 6)).toBe('resize-ne')
    expect(getHandleAtPoint({ x: 300, y: 200 }, b, 6)).toBe('resize-se')
    expect(getHandleAtPoint({ x: 100, y: 200 }, b, 6)).toBe('resize-sw')
  })

  test('isPointInBounds checks inclusion', () => {
    const b: Bounds = { x: 10, y: 20, width: 30, height: 40 }
    expect(isPointInBounds({ x: 10, y: 20 }, b)).toBe(true)
    expect(isPointInBounds({ x: 40, y: 60 }, b)).toBe(true)
    expect(isPointInBounds({ x: 41, y: 60 }, b)).toBe(false)
    expect(isPointInBounds({ x: 40, y: 61 }, b)).toBe(false)
  })
})
