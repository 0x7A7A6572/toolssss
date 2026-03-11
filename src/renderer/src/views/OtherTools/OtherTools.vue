<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { WeatherTool } from '../../utils/weather'
import type { WeatherDashboard } from '@shared/weather'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'
import { RefreshCw, Settings } from 'lucide-vue-next'
import LazyCascader from '../../components/LazyCascader.vue'
import SevenDayTempChart from '../../components/SevenDayTempChart.vue'
import { LegalHoliday, SolarDay } from 'tyme4ts'
import answerBookData from '../../../../libs/book-of-answers.json'

const PROVINCES: Array<{ name: string; code: string }> = [
  { name: '北京', code: 'BJ' },
  { name: '天津', code: 'TJ' },
  { name: '上海', code: 'SH' },
  { name: '重庆', code: 'CQ' },
  { name: '河北', code: 'HE' },
  { name: '山西', code: 'SX' },
  { name: '内蒙古', code: 'NM' },
  { name: '辽宁', code: 'LN' },
  { name: '吉林', code: 'JL' },
  { name: '黑龙江', code: 'HL' },
  { name: '江苏', code: 'JS' },
  { name: '浙江', code: 'ZJ' },
  { name: '安徽', code: 'AH' },
  { name: '福建', code: 'FJ' },
  { name: '江西', code: 'JX' },
  { name: '山东', code: 'SD' },
  { name: '河南', code: 'HA' },
  { name: '湖北', code: 'HB' },
  { name: '湖南', code: 'HN' },
  { name: '广东', code: 'GD' },
  { name: '广西', code: 'GX' },
  { name: '海南', code: 'HI' },
  { name: '四川', code: 'SC' },
  { name: '贵州', code: 'GZ' },
  { name: '云南', code: 'YN' },
  { name: '西藏', code: 'XZ' },
  { name: '陕西', code: 'SN' },
  { name: '甘肃', code: 'GS' },
  { name: '青海', code: 'QH' },
  { name: '宁夏', code: 'NX' },
  { name: '新疆', code: 'XJ' },
  { name: '香港', code: 'HK' },
  { name: '澳门', code: 'MO' },
  { name: '台湾', code: 'TW' }
]

const DEFAULT_STATION_ID = '59431'
const stationId = ref<string>(localStorage.getItem('weather.stationId') ?? DEFAULT_STATION_ID)
const loading = ref(false)
const errorText = ref<string | null>(null)
const dashboard = ref<WeatherDashboard | null>(null)

const provCode = ref<string>(localStorage.getItem('weather.provCode') ?? 'JS')
const cities = ref<Array<{ id: string; name: string }>>([])
const chosenCityId = ref<string | null>(localStorage.getItem('weather.stationId') ?? null)
const citiesLoading = ref(false)
const citiesErrorText = ref<string | null>(null)
const lastRefreshMs = ref<number>(0)
const lastRefreshKey = ref<string>('')
const MIN_INTERVAL_MS = 60 * 1000
const cascValue = ref<Array<string | number>>([])
const cityPickerOpen = ref(false)
const paydayDialogOpen = ref(false)

const PAYDAY_KEY = 'workCalendar.paydayDay'
const paydayDay = ref<number>(normalizePaydayDay(localStorage.getItem(PAYDAY_KEY)))
const paydayInput = ref<string>(String(paydayDay.value))

const nowTickMs = ref<number>(Date.now())
let tickTimer: number | null = null

type AnswerBookItem = { zh: string; en: string }
const answerBookList: AnswerBookItem[] = Array.isArray(answerBookData)
  ? (answerBookData as AnswerBookItem[])
  : []
const answerQuestion = ref<string>(localStorage.getItem('answerBook.question') ?? '')
const answerCurrent = ref<AnswerBookItem | null>(null)
const answerLastIndex = ref<number>(-1)
const answerFlipped = ref(false)
const answerAnimKey = ref(0)
const answerSpotlightActive = ref(false)
const answerSpotlightX = ref(0)
const answerSpotlightY = ref(0)

const answerSpotlightStyle = computed<Record<string, string>>(() => ({
  '--answer-spot-x': `${answerSpotlightX.value}px`,
  '--answer-spot-y': `${answerSpotlightY.value}px`
}))

const settings = ref<AppSettings>(structuredClone(DEFAULT_SETTINGS))

const FUN_FACT_YMD_KEY = 'ai.funFact.ymd'
const FUN_FACT_TEXT_KEY = 'ai.funFact.text'
const funFactYmd = ref<string>(localStorage.getItem(FUN_FACT_YMD_KEY) ?? '')
const funFactText = ref<string>(localStorage.getItem(FUN_FACT_TEXT_KEY) ?? '')
const funFactLoading = ref(false)
const funFactErrorText = ref('')

function ymdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const funFactTodayYmd = computed(() => ymdLocal(new Date(nowTickMs.value)))

const aiReady = computed(() => {
  const ai = settings.value.ai
  return Boolean(ai.enabled && ai.apiKeySet && ai.baseUrl.trim() && ai.model.trim())
})

function normalizeCachedFunFact(): void {
  if (!funFactYmd.value) return
  if (funFactYmd.value === funFactTodayYmd.value) return
  funFactYmd.value = ''
  funFactText.value = ''
  localStorage.removeItem(FUN_FACT_YMD_KEY)
  localStorage.removeItem(FUN_FACT_TEXT_KEY)
}

const onSettingsChanged = (_: unknown, s: unknown): void => {
  settings.value = s as AppSettings
}

async function refreshSettings(): Promise<void> {
  const result = await window.electron.ipcRenderer.invoke('settings:get')
  settings.value = result as AppSettings
}

async function refreshDailyFunFact(force: boolean): Promise<void> {
  normalizeCachedFunFact()
  if (!aiReady.value) {
    funFactErrorText.value = '请到「全局设置」启用 AI 并配置 Base URL / Key / Model'
    return
  }
  if (!force && funFactYmd.value === funFactTodayYmd.value && funFactText.value.trim()) {
    funFactErrorText.value = ''
    return
  }
  funFactLoading.value = true
  funFactErrorText.value = ''
  try {
    const ret = (await window.electron.ipcRenderer.invoke('ai:funfact:daily', {
      force
    })) as { ymd?: unknown; text?: unknown }
    const ymd = typeof ret?.ymd === 'string' ? ret.ymd : ''
    const text = typeof ret?.text === 'string' ? ret.text : ''
    funFactYmd.value = ymd
    funFactText.value = text
    if (ymd) localStorage.setItem(FUN_FACT_YMD_KEY, ymd)
    if (text) localStorage.setItem(FUN_FACT_TEXT_KEY, text)
  } catch (e) {
    funFactErrorText.value = e instanceof Error ? e.message : '获取冷知识失败'
  } finally {
    funFactLoading.value = false
  }
}

function openCityPicker(): void {
  cityPickerOpen.value = true
}

function closeCityPicker(): void {
  cityPickerOpen.value = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  closeCityPicker()
  closePaydayDialog()
}

const provinceOptions = computed(() =>
  PROVINCES.map((p) => ({
    label: p.name,
    value: p.code
  }))
)

async function lazyLoadCities(
  children: { value?: unknown; label?: unknown },
  resolve: (children: Array<{ label: string; value: string }>) => void
): Promise<void> {
  const code = String(children.value || '')
    .trim()
    .toUpperCase()
  const list = await WeatherTool.getProvinceCities(code)
  resolve(list.map((c) => ({ label: c.name, value: c.id })))
}

const onCascChange = (payload: {
  value: unknown[]
  labels: string[]
  selectedNodes: unknown[]
}): void => {
  const arr: unknown[] = Array.isArray(payload?.value) ? payload.value : []
  const pv = typeof arr[0] === 'string' ? (arr[0] as string) : provCode.value
  const city = typeof arr[1] === 'string' ? (arr[1] as string) : null
  provCode.value = pv
  localStorage.setItem('weather.provCode', pv)
  if (city) {
    chosenCityId.value = city
    stationId.value = city
    localStorage.setItem('weather.stationId', stationId.value)
    refresh().catch(() => null)
    closeCityPicker()
  }
}

async function loadCities(): Promise<void> {
  const code = provCode.value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
  if (!code) return
  provCode.value = code
  localStorage.setItem('weather.provCode', code)
  citiesLoading.value = true
  citiesErrorText.value = null
  try {
    cities.value = await WeatherTool.getProvinceCities(code)
    if (cities.value.length === 0) {
      chosenCityId.value = null
      citiesErrorText.value = '该省份暂无可用城市数据'
      return
    }
    if (!chosenCityId.value || !cities.value.some((c) => c.id === chosenCityId.value)) {
      chosenCityId.value = cities.value[0].id
    }
  } catch {
    cities.value = []
    chosenCityId.value = null
    citiesErrorText.value = '城市列表加载失败'
  } finally {
    citiesLoading.value = false
  }
}

const todayWeatherEmoji = computed(() => {
  const text = dashboard.value?.days?.[0]?.dayText ?? ''
  if (!text) return '🌤️'
  if (text.includes('雷')) return '⛈️'
  if (text.includes('雪')) return '🌨️'
  if (text.includes('雨')) return '🌧️'
  if (text.includes('风')) return '🌪️'
  if (text.includes('阴')) return '🌥️'
  if (text.includes('多云')) return '⛅'
  if (text.includes('晴')) return '☀️'
  return '🌤️'
})

function normalizePaydayDay(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n)) return 10
  if (n < 1) return 1
  if (n > 31) return 31
  return n
}

function openPaydayDialog(): void {
  paydayInput.value = String(paydayDay.value)
  paydayDialogOpen.value = true
}

function closePaydayDialog(): void {
  paydayDialogOpen.value = false
}

function savePaydayDay(): void {
  const n = normalizePaydayDay(paydayInput.value)
  paydayDay.value = n
  localStorage.setItem(PAYDAY_KEY, String(n))
  paydayDialogOpen.value = false
}

function resetAnswerCard(): void {
  answerFlipped.value = false
  answerCurrent.value = null
  answerAnimKey.value += 1
}

async function drawAnswer(): Promise<void> {
  if (answerBookList.length === 0) return

  const q = answerQuestion.value.trim()
  try {
    if (q) localStorage.setItem('answerBook.question', q)
  } catch {
    // ignore
  }

  let idx = Math.floor(Math.random() * answerBookList.length)
  if (answerBookList.length > 1 && idx === answerLastIndex.value) {
    idx =
      (idx + 1 + Math.floor(Math.random() * (answerBookList.length - 1))) % answerBookList.length
  }

  answerLastIndex.value = idx
  answerCurrent.value = answerBookList[idx] ?? null

  answerFlipped.value = false
  await nextTick()
  answerFlipped.value = true
}

function setAnswerSpotlightFromEvent(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width)
  const y = Math.min(Math.max(0, e.clientY - rect.top), rect.height)
  answerSpotlightX.value = x
  answerSpotlightY.value = y
}

function onAnswerMouseEnter(e: MouseEvent): void {
  answerSpotlightActive.value = true
  setAnswerSpotlightFromEvent(e)
  drawAnswer().catch(() => null)
}

function onAnswerMouseMove(e: MouseEvent): void {
  if (!answerSpotlightActive.value) return
  setAnswerSpotlightFromEvent(e)
}

function onAnswerMouseLeave(): void {
  answerSpotlightActive.value = false
  resetAnswerCard()
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function diffDays(from: Date, to: Date): number {
  const a = startOfDay(from).getTime()
  const b = startOfDay(to).getTime()
  if (b <= a) return 0
  return Math.floor((b - a) / 86400000)
}

function getNextPaydayDate(now: Date, dayOfMonth: number): Date {
  const y = now.getFullYear()
  const m = now.getMonth()
  const lastThisMonth = new Date(y, m + 1, 0).getDate()
  const thisMonthDay = Math.min(dayOfMonth, lastThisMonth)
  const candidate = new Date(y, m, thisMonthDay)
  if (candidate.getTime() >= startOfDay(now).getTime()) return candidate
  const y2 = m === 11 ? y + 1 : y
  const m2 = m === 11 ? 0 : m + 1
  const lastNextMonth = new Date(y2, m2 + 1, 0).getDate()
  const nextMonthDay = Math.min(dayOfMonth, lastNextMonth)
  return new Date(y2, m2, nextMonthDay)
}

type NextHolidayInfo = { name: string; days: number; ymdText: string }

function getNextHolidayInfo(now: Date): NextHolidayInfo | null {
  const y = now.getFullYear()
  const today = SolarDay.fromYmd(y, now.getMonth() + 1, now.getDate())

  const findInYear = (year: number): NextHolidayInfo | null => {
    let holiday = LegalHoliday.fromYmd(year, 1, 1)
    while (holiday) {
      const isHoliday = !holiday.isWork()
      const day = holiday.getDay()
      if (isHoliday && day.isAfter(today)) {
        const raw = day.subtract(today) - 1
        const days = Number.isFinite(raw) ? Math.max(0, raw) : 0
        return {
          name: holiday.getName(),
          days,
          ymdText: day.toString()
        }
      }
      holiday = holiday.next(1)
    }
    return null
  }

  return findInYear(y) ?? findInYear(y + 1)
}

const daysUntilRest = computed(() => {
  const now = new Date(nowTickMs.value)
  const dow = now.getDay()
  if (dow === 0 || dow === 6) return 0
  return 6 - dow
})

const nextPaydayDate = computed(() => getNextPaydayDate(new Date(nowTickMs.value), paydayDay.value))

const daysUntilPayday = computed(() => diffDays(new Date(nowTickMs.value), nextPaydayDate.value))

const nextHoliday = computed(() => {
  try {
    return getNextHolidayInfo(new Date(nowTickMs.value))
  } catch {
    return null
  }
})

async function refresh(): Promise<void> {
  if (
    lastRefreshKey.value === stationId.value &&
    Date.now() - lastRefreshMs.value < MIN_INTERVAL_MS
  ) {
    errorText.value = '刷新过于频繁，请稍后再试'
    return
  }
  loading.value = true
  errorText.value = null
  try {
    const ret = await WeatherTool.getDashboard(stationId.value)
    if (!ret) {
      dashboard.value = null
      errorText.value = '天气数据获取失败'
      return
    }
    dashboard.value = ret
    lastRefreshKey.value = stationId.value
    lastRefreshMs.value = Date.now()
  } catch {
    dashboard.value = null
    errorText.value = '天气数据获取失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.electron.ipcRenderer.on('settings:changed', onSettingsChanged)
  tickTimer = window.setInterval(() => {
    nowTickMs.value = Date.now()
    normalizeCachedFunFact()
  }, 60 * 1000)
  refreshSettings()
    .then(() => {
      normalizeCachedFunFact()
      if (
        aiReady.value &&
        (!funFactText.value.trim() || funFactYmd.value !== funFactTodayYmd.value)
      )
        refreshDailyFunFact(false).catch(() => null)
    })
    .catch(() => null)
  loadCities()
    .then(() => {
      if (chosenCityId.value) {
        stationId.value = chosenCityId.value
        localStorage.setItem('weather.stationId', stationId.value)
      }
      refresh().catch(() => null)
    })
    .catch(() => {
      refresh().catch(() => null)
    })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.electron.ipcRenderer.removeListener('settings:changed', onSettingsChanged)
  if (tickTimer !== null) {
    window.clearInterval(tickTimer)
    tickTimer = null
  }
})
</script>

<template>
  <div class="page-content">
    <header class="header">
      <!-- <div class="title">工具首页</div>
      <div class="subtitle">天气（今日 / 近7日 / 3小时降雨预警）</div> -->
    </header>

    <section class="card">
      <div class="card-head">
        <div class="actions">
          <button
            v-if="!dashboard"
            class="btn"
            type="button"
            :disabled="citiesLoading || loading"
            title="选择城市"
            @click="openCityPicker"
          >
            城市
          </button>
          <button class="btn" :disabled="loading" title="刷新" @click="refresh">
            <RefreshCw v-if="!loading" :size="16" />
            <div v-else class="loading-spinner"></div>
          </button>
        </div>
      </div>

      <div v-if="citiesErrorText" class="hint">{{ citiesErrorText }}</div>
      <div v-if="errorText" class="error">{{ errorText }}</div>

      <div v-if="dashboard" class="weather-layout">
        <div class="left-col">
          <div class="block has-emoji">
            <div v-if="dashboard" class="weather-emoji" aria-hidden="true">
              {{ todayWeatherEmoji }}
            </div>

            <div class="block-title">今日</div>
            <div class="now-main">
              <button class="location location-btn" type="button" @click="openCityPicker">
                <span>{{ dashboard.now.locationName }}</span>
                <span class="location-caret">▾</span>
              </button>
              <div class="temp">
                <span class="temp-value">{{
                  dashboard.now.temperatureC === null ? '—' : Math.round(dashboard.now.temperatureC)
                }}</span>
                <span class="temp-unit">℃</span>
              </div>
            </div>
            <div class="meta">
              <div class="meta-row">
                <span class="meta-k">体感</span>
                <span class="meta-v">{{
                  dashboard.now.feelsLikeC === null
                    ? '—'
                    : `${Math.round(dashboard.now.feelsLikeC)}℃`
                }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-k">湿度</span>
                <span class="meta-v">{{
                  dashboard.now.humidityPercent === null
                    ? '—'
                    : `${Math.round(dashboard.now.humidityPercent)}%`
                }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-k">气压</span>
                <span class="meta-v">{{
                  dashboard.now.pressureHpa === null
                    ? '—'
                    : `${Math.round(dashboard.now.pressureHpa)}hPa`
                }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-k">降水</span>
                <span class="meta-v">{{
                  dashboard.now.precipitationMm === null
                    ? '—'
                    : `${dashboard.now.precipitationMm}mm`
                }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-k">风</span>
                <span class="meta-v">{{
                  dashboard.now.windDirectionText && dashboard.now.windScaleText
                    ? `${dashboard.now.windDirectionText} ${dashboard.now.windScaleText}`
                    : '—'
                }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-k">更新</span>
                <span class="meta-v">{{ dashboard.now.lastUpdateText ?? '—' }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="right-col">
          <div class="block">
            <div class="block-title">
              <span>3小时降雨预警</span>
              <div class="warning-line">
                <span class="badge" :class="{ danger: dashboard.threeHour.willRain }">
                  {{ dashboard.threeHour.willRain ? '可能降雨' : '无降雨' }}
                </span>
                <span v-if="dashboard.threeHour.willRain" class="warning-hint">
                  最大 {{ dashboard.threeHour.maxPrecipitationMm }}mm
                </span>
              </div>
            </div>

            <!-- <div v-if="next3Hours.length > 0" class="hour-list">
              <div v-for="it in next3Hours" :key="it.atText" class="hour-item">
                <span class="hour-at">{{ it.atText }}</span>
                <span class="hour-p">{{ it.precipitationText }}</span>
              </div>
            </div>
            <div v-else class="empty">未解析到未来3小时数据</div> -->
          </div>
          <div class="block">
            <div class="block-title">
              <span>近7日天气</span>
              <span class="legend">
                <span class="lg lg-high"></span>
                <span class="lg lg-low"></span>
              </span>
            </div>
            <SevenDayTempChart v-if="dashboard.days.length > 0" :days="dashboard.days" />
            <div v-else class="empty">暂无数据</div>
          </div>
        </div>
      </div>
    </section>

    <div class="mini-tools-row">
      <section class="card work-calendar-card">
        <div class="work-calendar-head">
          <div class="work-calendar-title">打工人日历</div>
          <div class="work-calendar-btn" type="button" @click="openPaydayDialog">
            <!-- 每月{{ paydayDay }}日 -->
            <Settings :size="18" />
          </div>
        </div>

        <div class="work-calendar-list">
          <div class="work-calendar-row">
            <div class="work-calendar-label">
              <div class="work-calendar-k">距离休息日</div>
              <div class="work-calendar-sub">周末</div>
            </div>
            <div class="work-calendar-value">
              <span class="work-calendar-num">{{ daysUntilRest }}</span>
              <span class="work-calendar-unit">天</span>
            </div>
          </div>

          <div class="work-calendar-row">
            <div class="work-calendar-label">
              <div class="work-calendar-k">距离发工资</div>
              <div class="work-calendar-sub">{{ nextPaydayDate.toLocaleDateString() }}</div>
            </div>
            <div class="work-calendar-value">
              <span class="work-calendar-num">{{ daysUntilPayday }}</span>
              <span class="work-calendar-unit">天</span>
            </div>
          </div>

          <div class="work-calendar-row">
            <div class="work-calendar-label">
              <div class="work-calendar-k">距离{{ nextHoliday?.name ?? '节假日' }}</div>
              <div class="work-calendar-sub">{{ nextHoliday?.ymdText ?? '—' }}</div>
            </div>
            <div class="work-calendar-value">
              <span class="work-calendar-num">{{ nextHoliday ? nextHoliday.days : '—' }}</span>
              <span class="work-calendar-unit">天</span>
            </div>
          </div>
        </div>
      </section>

      <section class="card answer-book-card">
        <div class="answer-book-head">
          <div class="answer-book-title">答案之书</div>
        </div>

        <div class="answer-book-body">
          <div
            :key="answerAnimKey"
            class="answer-flip"
            :class="{
              flipped: answerFlipped,
              spotlight: answerSpotlightActive
            }"
            :style="answerSpotlightStyle"
            role="button"
            tabindex="0"
            @mouseenter="onAnswerMouseEnter"
            @mousemove="onAnswerMouseMove"
            @mouseleave="onAnswerMouseLeave"
            @click="drawAnswer"
            @keydown.enter.prevent="drawAnswer"
          >
            <div class="answer-flip-inner">
              <div class="answer-face answer-front">
                <div class="answer-front-title">把鼠标移进来，命运马上发牌</div>
                <div class="answer-front-sub">移动鼠标，用探照灯看清答案</div>
              </div>
              <div class="answer-face answer-back">
                <div v-if="answerCurrent" class="answer-text">
                  <div class="answer-zh">{{ answerCurrent.zh }}</div>
                  <div class="answer-en">{{ answerCurrent.en }}</div>
                </div>
                <div v-else class="answer-text">
                  <div class="answer-zh">—</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <section class="card fun-fact-card">
      <div class="fun-fact-head">
        <div class="fun-fact-title">每日冷知识</div>
        <div class="actions">
          <button
            class="btn"
            type="button"
            :disabled="funFactLoading || !aiReady"
            @click="refreshDailyFunFact(true)"
          >
            换一条
          </button>
        </div>
      </div>

      <div v-if="funFactErrorText" class="error">{{ funFactErrorText }}</div>
      <div v-else class="fun-fact-body">
        <div class="fun-fact-meta">{{ funFactYmd || funFactTodayYmd }}</div>
        <div class="fun-fact-text">{{ funFactText || '—' }}</div>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="cityPickerOpen" class="picker-overlay" @click.self="closeCityPicker">
        <div class="picker-card">
          <div class="picker-title">选择城市</div>
          <LazyCascader
            v-model="cascValue"
            :options="provinceOptions"
            :lazy-load="lazyLoadCities"
            :lazy-load-level="0"
            :props-config="{
              label: 'label',
              value: 'value',
              children: 'children',
              disabled: 'disabled'
            }"
            @change="onCascChange"
          />
          <div class="picker-actions">
            <button class="btn" type="button" @click="closeCityPicker">关闭</button>
          </div>
        </div>
      </div>
      <div v-if="cityPickerOpen" class="picker-backdrop" />

      <div v-if="paydayDialogOpen" class="picker-overlay" @click.self="closePaydayDialog">
        <div class="picker-card">
          <div class="picker-title">设置发薪日</div>
          <div class="payday-form">
            <span class="payday-label">每月</span>
            <input
              v-model="paydayInput"
              class="input payday-input"
              type="number"
              min="1"
              max="31"
            />
            <span class="payday-label">日</span>
          </div>
          <div class="hint">范围 1-31，超过当月天数会按当月最后一天算</div>
          <div class="picker-actions">
            <button class="btn" type="button" @click="closePaydayDialog">取消</button>
            <button class="btn" type="button" @click="savePaydayDay">保存</button>
          </div>
        </div>
      </div>
      <div v-if="paydayDialogOpen" class="picker-backdrop" />
    </Teleport>
  </div>
</template>

<style scoped>
.page-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title {
  font-size: 24px;
  font-weight: 700;
  line-height: 28px;
}

.subtitle {
  font-size: 13px;
  color: var(--ev-c-text-2);
}

.loading-spinner {
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top: 4px solid #fff;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
  z-index: 1;
}

@keyframes emoji-bounce {
  0%,
  100% {
    left: 50%;
    top: -7rem;
  }
  50% {
    left: 48%;
    top: -6.5rem;
  }
}

.weather-emoji {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: -7rem;
  font-size: 10rem;
  z-index: 0;
  /* opacity: 1; */
  pointer-events: none;
  user-select: none;
  animation: emoji-bounce 5.5s infinite;
  transition: transform 0.3s ease-in-out;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.card-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ev-c-text-1);
}

.controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.input,
.select {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: var(--ev-c-text-1);
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 12px;
  outline: none;
}
.select {
  min-width: 180px;
}

.hint {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.62);
}

.btn {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: var(--ev-c-text-1);
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.location-btn {
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-align: left;
}

.location-btn:hover {
  text-decoration: underline;
}

.location-caret {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.62);
}

.picker-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 10000;
}

.picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 9999;
}

.picker-card {
  width: min(420px, calc(100vw - 64px));
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 18px;
  background: rgba(17, 24, 39, 0.9);
  color: var(--ev-c-text-1);
  z-index: 10001;
  display: flex;
  flex-direction: column;
  gap: 12px;
  top: 10%;
  position: absolute;
}

.picker-title {
  font-size: 14px;
  font-weight: 700;
}

.picker-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.payday-form {
  display: flex;
  align-items: center;
  gap: 10px;
}

.payday-input {
  width: 120px;
}

.payday-label {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.72);
}

.mini-tools-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}

.work-calendar-card {
  width: min(360px, 100%);
  height: 240px;
  align-self: flex-start;
  padding: 14px;
  gap: 12px;
}

.answer-book-card {
  height: 180px;
  padding: 14px;
  gap: 12px;
  flex: auto;
}

.work-calendar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.answer-book-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.work-calendar-title {
  font-size: 14px;
  font-weight: 800;
  color: rgba(235, 235, 245, 0.92);
}

.answer-book-title {
  font-size: 14px;
  font-weight: 800;
  color: rgba(235, 235, 245, 0.92);
}

.work-calendar-btn {
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 999px;
  white-space: nowrap;
}

.answer-book-btn {
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 999px;
  white-space: nowrap;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: var(--ev-c-text-1);
  cursor: pointer;
}

.answer-book-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.answer-book-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.fun-fact-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.fun-fact-title {
  font-size: 14px;
  font-weight: 800;
  color: rgba(235, 235, 245, 0.92);
}

.fun-fact-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fun-fact-meta {
  font-size: 12px;
  font-weight: 700;
  color: rgba(235, 235, 245, 0.62);
}

.fun-fact-text {
  font-size: 14px;
  font-weight: 700;
  color: rgba(235, 235, 245, 0.92);
  white-space: pre-wrap;
  line-height: 1.35;
}

.tips {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.62);
}

.answer-book-input {
  width: 100%;
}

.answer-flip {
  flex: 1;
  min-height: 0;
  border-radius: 12px;
  position: relative;
  perspective: 900px;
  cursor: pointer;
  user-select: none;
  outline: none;
  --answer-spot-x: 50%;
  --answer-spot-y: 50%;
  --answer-spot-radius: 110px;
}

.answer-flip-inner {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  transform-style: preserve-3d;
  transition: transform 600ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.answer-flip.flipped .answer-flip-inner {
  transform: rotateY(180deg);
}

.answer-face {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  backface-visibility: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 12px;
}

.answer-front {
  background:
    radial-gradient(600px 220px at 40% 0%, rgba(90, 210, 255, 0.22), transparent),
    rgba(255, 255, 255, 0.03);
}

.answer-back {
  transform: rotateY(180deg);
  background:
    radial-gradient(600px 220px at 40% 0%, rgba(190, 120, 255, 0.22), transparent),
    rgba(255, 255, 255, 0.03);
  overflow: hidden;
}

.answer-back::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 12px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 180ms ease;
  z-index: 2;
  background: rgba(0, 0, 0, 0.967);
  -webkit-mask-image: radial-gradient(
    circle var(--answer-spot-radius) at var(--answer-spot-x) var(--answer-spot-y),
    transparent 0%,
    transparent 45%,
    rgba(0, 0, 0, 1) 70%,
    rgba(0, 0, 0, 1) 100%
  );
  mask-image: radial-gradient(
    circle var(--answer-spot-radius) at var(--answer-spot-x) var(--answer-spot-y),
    transparent 0%,
    transparent 45%,
    rgba(0, 0, 0, 1) 70%,
    rgba(0, 0, 0, 1) 100%
  );
}

.answer-flip.spotlight.flipped .answer-back::before {
  opacity: 1;
}

.answer-front-title {
  font-size: 14px;
  font-weight: 900;
  letter-spacing: -0.01em;
  color: rgba(235, 235, 245, 0.96);
}

.answer-front-sub {
  margin-top: 6px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(235, 235, 245, 0.62);
}

.answer-text {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  z-index: 1;
}

.answer-zh {
  font-size: 16px;
  font-weight: 900;
  color: rgba(235, 235, 245, 0.96);
  line-height: 1.25;
}

.answer-en {
  font-size: 12px;
  font-weight: 600;
  color: rgba(235, 235, 245, 0.62);
  line-height: 1.3;
}

.work-calendar-list {
  flex: 1;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10px;
}

.work-calendar-row {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.work-calendar-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.work-calendar-k {
  font-size: 12px;
  font-weight: 700;
  color: rgba(235, 235, 245, 0.72);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.work-calendar-sub {
  font-size: 12px;
  font-weight: 600;
  color: rgba(235, 235, 245, 0.52);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.work-calendar-value {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 6px;
  flex: none;
}

.work-calendar-num {
  font-size: 26px;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: rgba(235, 235, 245, 0.95);
  line-height: 1;
}

.work-calendar-unit {
  font-size: 12px;
  font-weight: 700;
  color: rgba(235, 235, 245, 0.62);
}

.picker-card :deep(.lazy-cascader) {
  width: 100%;
}

.error {
  font-size: 13px;
  color: #ff8a8a;
}

.weather-layout {
  position: relative;
  /* display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 12px; */
  display: flex;
  flex-direction: row;
  gap: 12px;
}
.left-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}
.right-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 300px;
}

.block {
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* min-height: 170px; */
}

.has-emoji {
  background: linear-gradient(45deg, rgb(0 155 255 / 61%), transparent);
}

.block-title {
  font-size: 12px;
  font-weight: 700;
  color: rgba(235, 235, 245, 0.7);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.now-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.location {
  font-size: 14px;
  font-weight: 700;
}

.temp {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.temp-value {
  font-size: 34px;
  font-weight: 800;
  line-height: 1;
}

.temp-unit {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.7);
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.meta-k {
  color: rgba(235, 235, 245, 0.62);
}

.meta-v {
  color: var(--ev-c-text-1);
}

.warning-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: auto;
  justify-content: flex-end;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  padding: 0 10px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(144, 238, 144, 0.15);
  border: 1px solid rgba(144, 238, 144, 0.25);
  color: rgba(144, 238, 144, 0.95);
}

.badge.danger {
  background: rgba(255, 122, 122, 0.14);
  border: 1px solid rgba(255, 122, 122, 0.25);
  color: rgba(255, 122, 122, 0.95);
}

.warning-hint {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.62);
}

.hour-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hour-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.hour-at {
  color: rgba(235, 235, 245, 0.62);
}

.hour-p {
  color: var(--ev-c-text-1);
}

.legend {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.lg {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(235, 235, 245, 0.72);
}

.lg-high {
  background-color: rgba(0, 220, 255, 0.95);
  border-color: rgba(0, 220, 255, 0.25);
}

.lg-low {
  background-color: rgba(180, 140, 255, 0.95);
  border-color: rgba(180, 140, 255, 0.25);
}

.empty {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.62);
}

@media (max-width: 900px) {
  .weather-layout {
    grid-template-columns: 1fr;
  }
}
</style>
