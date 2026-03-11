import { ipcMain } from 'electron'
import {
  WEATHER_EVENTS,
  type WeatherDashboard,
  type WeatherDayForecast,
  type WeatherNow,
  type WeatherProvinceCity
} from '@shared/weather'
import dayjs from 'dayjs'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'

const NOW_BASE = 'https://weather.cma.cn/api/now'
const FORECAST_BASE = 'https://weather.cma.cn/web/weather'

function asFiniteNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  if (n >= 9999) return null
  return n
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function parsePrecipMm(text: string): number {
  const t = text.trim()
  if (!t) return 0
  if (t.includes('无降水')) return 0
  const m = t.match(/(\d+(?:\.\d+)?)/)
  if (!m) return 0
  const n = Number(m[1])
  return Number.isFinite(n) ? n : 0
}

function parse7DayForecastFromText(text: string): WeatherDayForecast[] {
  const days: WeatherDayForecast[] = []
  const re =
    /星期([一二三四五六日天])\s*(\d{2}\/\d{2})\s*([^\s]{1,8})\s*([^\s]{1,8}风)\s*([^\s]{1,8})\s*(\d{1,2})℃\s*(\d{1,2})℃\s*([^\s]{1,8})\s*([^\s]{1,8}风)\s*([^\s]{1,8})/g

  for (const m of text.matchAll(re)) {
    const week = `星期${m[1]}`
    const date = m[2]
    const dayText = m[3]
    const windDirectionText = m[4]
    const windScaleText = m[5]
    const highC = Number(m[6])
    const lowC = Number(m[7])
    const nightText = m[8]
    days.push({
      weekText: week,
      dateText: date,
      dayText,
      nightText,
      windDirectionText,
      windScaleText,
      highC: Number.isFinite(highC) ? highC : null,
      lowC: Number.isFinite(lowC) ? lowC : null
    })
    if (days.length >= 7) break
  }
  return days
}

function buildChronologicalTimes(base: Date, times: string[]): Date[] {
  const out: Date[] = []
  const baseDj = dayjs(base)
  for (const t of times) {
    const mm = t.match(/^(\d{1,2}):(\d{2})$/)
    if (!mm) continue
    const h = Number(mm[1])
    const m = Number(mm[2])
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue
    let d = baseDj.hour(h).minute(m).second(0).millisecond(0)
    if (d.isBefore(baseDj)) d = d.add(1, 'day')
    out.push(d.toDate())
  }
  return out
}

function parseHourlyPrecipFromText(
  text: string,
  now: Date
): Array<{
  atText: string
  precipitationText: string
  precipitationMm: number
  inNext3Hours: boolean
}> {
  const idx = text.indexOf('时间')
  if (idx < 0) return []
  const windowText = text.slice(idx, idx + 6000)

  const times: string[] = []
  for (const m of windowText.matchAll(/\b\d{1,2}:\d{2}\b/g)) {
    times.push(m[0].padStart(5, '0'))
    if (times.length >= 24) break
  }
  if (times.length === 0) return []

  const pIdx = windowText.indexOf('降水')
  if (pIdx < 0) return []
  const afterP = windowText.slice(pIdx)
  const endIdx = afterP.indexOf('风速')
  const precipSlice = (endIdx > 0 ? afterP.slice(0, endIdx) : afterP.slice(0, 1200))
    .replace(/^降水\s*/u, '')
    .trim()

  const precipTokens = precipSlice.split(/\s+/).filter(Boolean)
  if (precipTokens.length === 0) return []

  const chrono = buildChronologicalTimes(now, times)
  const items: Array<{
    atText: string
    precipitationText: string
    precipitationMm: number
    inNext3Hours: boolean
  }> = []
  for (let i = 0; i < Math.min(times.length, precipTokens.length, chrono.length); i++) {
    const dt = chrono[i]
    const diffMs = dt.getTime() - now.getTime()
    const inNext3Hours = diffMs >= 0 && diffMs <= 3 * 60 * 60 * 1000
    const precipitationText = precipTokens[i]
    items.push({
      atText: times[i],
      precipitationText,
      precipitationMm: parsePrecipMm(precipitationText),
      inNext3Hours
    })
  }
  return items
}

async function fetchJson(url: string, referer: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: referer,
      'User-Agent': USER_AGENT
    }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchText(url: string, referer: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: referer,
      'User-Agent': USER_AGENT
    }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function parseProvinceCities(raw: string): WeatherProvinceCity[] {
  const list: WeatherProvinceCity[] = []
  for (const seg of raw.split('|')) {
    const [id, name] = seg.split(',')
    if (!id || !name) continue
    const cid = id.trim()
    const cname = name.trim()
    if (!cid || !cname) continue
    list.push({ id: cid, name: cname })
  }
  return list
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function mapNowPayload(stationId: string, payload: unknown): WeatherNow {
  const obj = asRecord(payload)
  const data = asRecord(obj?.data)
  const location = asRecord(data?.location)
  const now = asRecord(data?.now) ?? {}
  const locationName = typeof location?.name === 'string' ? location.name : stationId
  return {
    stationId,
    locationName,
    temperatureC: asFiniteNumber(now.temperature),
    feelsLikeC: asFiniteNumber(now.feelst),
    humidityPercent: asFiniteNumber(now.humidity),
    pressureHpa: asFiniteNumber(now.pressure),
    precipitationMm: asFiniteNumber(now.precipitation),
    windDirectionText: typeof now.windDirection === 'string' ? now.windDirection : null,
    windScaleText: typeof now.windScale === 'string' ? now.windScale : null,
    lastUpdateText: typeof data?.lastUpdate === 'string' ? (data.lastUpdate as string) : null
  }
}

type CacheEntry = { atMs: number; data: WeatherDashboard }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 2 * 60 * 1000

type ProvinceCacheEntry = { atMs: number; data: WeatherProvinceCity[] }
const provinceCache = new Map<string, ProvinceCacheEntry>()
const PROVINCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000

async function getDashboard(stationId: string): Promise<WeatherDashboard> {
  const cached = cache.get(stationId)
  if (cached && Date.now() - cached.atMs < CACHE_TTL_MS) return cached.data

  const nowUrl = `${NOW_BASE}/${stationId}`
  const forecastUrl = `${FORECAST_BASE}/${stationId}.html`
  const referer = forecastUrl

  const [nowPayload, html] = await Promise.all([
    fetchJson(nowUrl, referer),
    fetchText(forecastUrl, referer)
  ])
  const text = stripHtmlToText(html)
  const days = parse7DayForecastFromText(text)
  const now = mapNowPayload(stationId, nowPayload)
  const hourly = parseHourlyPrecipFromText(text, new Date())
  const next3 = hourly.filter((it) => it.inNext3Hours)
  const willRain = next3.some((it) => it.precipitationMm > 0)
  const maxPrecipitationMm = next3.reduce((max, it) => Math.max(max, it.precipitationMm), 0)

  const data: WeatherDashboard = {
    now,
    days,
    threeHour: {
      willRain,
      maxPrecipitationMm,
      items: hourly.map((it) => ({
        atText: it.atText,
        precipitationText: it.precipitationText,
        precipitationMm: it.precipitationMm,
        inNext3Hours: it.inNext3Hours
      }))
    },
    fetchedAtMs: Date.now(),
    sources: { nowUrl, forecastUrl }
  }

  cache.set(stationId, { atMs: Date.now(), data })
  return data
}

export function registerWeatherHandlers(): void {
  ipcMain.handle(WEATHER_EVENTS.GET_DASHBOARD, async (_event, payload: unknown) => {
    const stationId = typeof payload === 'string' && payload.trim() ? payload.trim() : '59431'
    try {
      return await getDashboard(stationId)
    } catch {
      cache.delete(stationId)
      return null
    }
  })

  ipcMain.handle(WEATHER_EVENTS.GET_PROVINCE_CITIES, async (_event, payload: unknown) => {
    const code =
      typeof payload === 'string'
        ? payload
            .trim()
            .toUpperCase()
            .replace(/[^A-Z]/g, '')
        : ''
    if (!code) return []
    const cached = provinceCache.get(code)
    if (cached && Date.now() - cached.atMs < PROVINCE_CACHE_TTL_MS) return cached.data
    try {
      const url = `https://weather.cma.cn/api/dict/province/A${code}`
      const payloadJson = await fetchJson(url, 'https://weather.cma.cn/')
      const obj = asRecord(payloadJson)
      const raw = typeof obj?.data === 'string' ? (obj.data as string) : ''
      const data = parseProvinceCities(raw)
      provinceCache.set(code, { atMs: Date.now(), data })
      return data
    } catch {
      provinceCache.delete(code)
      return []
    }
  })
}
