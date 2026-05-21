export function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function normalizeTimeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isInteger(h) || !Number.isInteger(mm)) return null
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
