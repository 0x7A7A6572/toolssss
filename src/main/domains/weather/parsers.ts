import type { WeatherHourlyTrends } from '@shared/weather'

function parseMaybeNumberToken(token: string): number | null {
  const t = token.trim()
  if (!t || t === '—' || t === '-') return null
  const m = t.match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

function parsePrecipToken(token: string): number | null {
  const t = token.trim()
  if (!t || t === '—' || t === '-') return null
  if (t.includes('无降水')) return 0
  const m = t.match(/(\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function parseHourlyRowTokens(windowText: string, startLabel: string, endLabel?: string): string[] {
  const idx = windowText.indexOf(startLabel)
  if (idx < 0) return []
  const after = windowText.slice(idx + startLabel.length)
  const endIdx = endLabel ? after.indexOf(endLabel) : -1
  const slice = (endIdx >= 0 ? after.slice(0, endIdx) : after.slice(0, 1600)).trim()
  return slice.split(/\s+/).filter(Boolean)
}

export function parseHourlyTrendsFromText(text: string): WeatherHourlyTrends | null {
  const idx = text.indexOf('时间')
  if (idx < 0) return null
  const windowText = text.slice(idx, idx + 9000)

  const times: string[] = []
  for (const m of windowText.matchAll(/\b\d{1,2}:\d{2}\b/g)) {
    const v = m[0].padStart(5, '0')
    const prev = times[times.length - 1]
    if (v !== prev) times.push(v)
    if (times.length >= 36) break
  }
  if (times.length === 0) return null

  const tempTokens = parseHourlyRowTokens(windowText, '气温', '降水')
  const precipTokens = parseHourlyRowTokens(windowText, '降水', '风速')
  const windTokens = parseHourlyRowTokens(windowText, '风速', '风向')
  const humidityTokens = parseHourlyRowTokens(windowText, '湿度', '云量')
  const cloudTokens = parseHourlyRowTokens(windowText, '云量')

  const n = Math.min(
    times.length,
    tempTokens.length,
    precipTokens.length,
    windTokens.length,
    humidityTokens.length,
    cloudTokens.length
  )
  if (n <= 0) return null

  return {
    times: times.slice(0, n),
    temperatureC: tempTokens.slice(0, n).map(parseMaybeNumberToken),
    precipitationMm: precipTokens.slice(0, n).map(parsePrecipToken),
    windSpeedMs: windTokens.slice(0, n).map(parseMaybeNumberToken),
    humidityPercent: humidityTokens.slice(0, n).map(parseMaybeNumberToken),
    cloudPercent: cloudTokens.slice(0, n).map(parseMaybeNumberToken)
  }
}

