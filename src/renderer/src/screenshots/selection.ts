export type Point = { x: number; y: number }

export type Bounds = { x: number; y: number; width: number; height: number }

export type DragMode =
  | 'new'
  | 'move'
  | 'resize-nw'
  | 'resize-n'
  | 'resize-ne'
  | 'resize-e'
  | 'resize-se'
  | 'resize-s'
  | 'resize-sw'
  | 'resize-w'
  | null

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function normalizeBounds(a: { x1: number; y1: number; x2: number; y2: number }): Bounds {
  const x = Math.min(a.x1, a.x2)
  const y = Math.min(a.y1, a.y2)
  const x2 = Math.max(a.x1, a.x2)
  const y2 = Math.max(a.y1, a.y2)
  return { x, y, width: x2 - x, height: y2 - y }
}

export function clampBounds(b: Bounds, viewportWidth: number, viewportHeight: number): Bounds {
  const x = clamp(b.x, 0, viewportWidth)
  const y = clamp(b.y, 0, viewportHeight)
  const w = clamp(b.width, 0, viewportWidth - x)
  const h = clamp(b.height, 0, viewportHeight - y)
  return { x, y, width: w, height: h }
}

export function isPointInBounds(p: Point, b: Bounds): boolean {
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height
}

export function getHandleAtPoint(p: Point, b: Bounds, handleRadius: number): DragMode {
  const x1 = b.x
  const y1 = b.y
  const x2 = b.x + b.width
  const y2 = b.y + b.height

  const near = (x: number, y: number): boolean =>
    Math.abs(p.x - x) <= handleRadius && Math.abs(p.y - y) <= handleRadius

  const nearH = (y: number): boolean => Math.abs(p.y - y) <= handleRadius && p.x >= x1 && p.x <= x2
  const nearV = (x: number): boolean => Math.abs(p.x - x) <= handleRadius && p.y >= y1 && p.y <= y2

  if (near(x1, y1)) return 'resize-nw'
  if (near(x2, y1)) return 'resize-ne'
  if (near(x2, y2)) return 'resize-se'
  if (near(x1, y2)) return 'resize-sw'
  if (near((x1 + x2) / 2, y1) || nearH(y1)) return 'resize-n'
  if (nearV(x2)) return 'resize-e'
  if (near((x1 + x2) / 2, y2) || nearH(y2)) return 'resize-s'
  if (nearV(x1)) return 'resize-w'

  return null
}

export function computeDragBounds(args: {
  mode: DragMode
  start: Point
  startBounds: Bounds | null
  pointer: Point
  viewportWidth: number
  viewportHeight: number
}): Bounds {
  const { mode, start, startBounds, pointer, viewportWidth, viewportHeight } = args
  if (mode === 'new') {
    const next = normalizeBounds({ x1: start.x, y1: start.y, x2: pointer.x, y2: pointer.y })
    return clampBounds(next, viewportWidth, viewportHeight)
  }

  const dx = pointer.x - start.x
  const dy = pointer.y - start.y
  const b = startBounds ?? { x: start.x, y: start.y, width: 0, height: 0 }

  if (mode === 'move') {
    return clampBounds({ ...b, x: b.x + dx, y: b.y + dy }, viewportWidth, viewportHeight)
  }

  const x1 = b.x
  const y1 = b.y
  const x2 = b.x + b.width
  const y2 = b.y + b.height

  const nextRaw =
    mode === 'resize-nw'
      ? { x1: x1 + dx, y1: y1 + dy, x2, y2 }
      : mode === 'resize-n'
        ? { x1, y1: y1 + dy, x2, y2 }
        : mode === 'resize-ne'
          ? { x1, y1: y1 + dy, x2: x2 + dx, y2 }
          : mode === 'resize-e'
            ? { x1, y1, x2: x2 + dx, y2 }
            : mode === 'resize-se'
              ? { x1, y1, x2: x2 + dx, y2: y2 + dy }
              : mode === 'resize-s'
                ? { x1, y1, x2, y2: y2 + dy }
                : mode === 'resize-sw'
                  ? { x1: x1 + dx, y1, x2, y2: y2 + dy }
                  : mode === 'resize-w'
                    ? { x1: x1 + dx, y1, x2, y2 }
                    : { x1, y1, x2, y2 }

  return clampBounds(normalizeBounds(nextRaw), viewportWidth, viewportHeight)
}
