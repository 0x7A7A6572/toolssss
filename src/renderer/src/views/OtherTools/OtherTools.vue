<script setup lang="ts">
import {
  computed,
  FunctionalComponent,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch
} from 'vue'
import { WeatherTool } from '../../utils/weather'
import type { WeatherDashboard, WeatherProvinceCity } from '@shared/weather'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'
import { useSettingsStore } from '@renderer/state/settings'
import {
  Stone,
  PencilLine,
  Settings,
  Sparkles,
  Plus,
  ToolCase,
  Calendar,
  ChartLine,
  CloudSun,
  LucideProps
} from 'lucide-vue-next'
import type {
  CustomModuleConfig,
  CustomModuleCachedContent,
  CustomModuleRankingItem,
  CustomModuleLinkItem,
  CustomModuleChartItem,
  CustomModuleSearchMeta
} from '@shared/custom-modules'
import {
  CUSTOM_MODULES_EVENTS,
  CUSTOM_MODULES_STORAGE_KEY,
  CUSTOM_MODULES_CACHE_KEY
} from '@shared/custom-modules'
import CustomModuleCard from '../../components/CustomModule/CustomModuleCard.vue'
import ModuleDialog from '../../components/CustomModule/ModuleDialog.vue'
import type { ModuleDialogData } from '../../components/CustomModule/ModuleDialog.vue'
import SevenDayTempChart from '../../components/SevenDayTempChart.vue'
import WeatherHourlyTrendsChart, {
  type HourlyMetricKey
} from '../../components/WeatherHourlyTrendsChart.vue'
import { LegalHoliday, SolarDay } from 'tyme4ts'
import answerBookData from '../../../../libs/book-of-answers.json'
import AppSwitch from '@renderer/components/AppSwitch.vue'

const DEFAULT_STATION_ID = '59431'
const stationId = ref<string>(localStorage.getItem('weather.stationId') ?? DEFAULT_STATION_ID)
const loadingSate = reactive({
  weather: false,
  daily: false
})
const errorText = ref<string | null>(null)
const dashboard = ref<WeatherDashboard | null>(null)
const weatherType = ref<string>('recently')
const hourlyActiveKey = ref<HourlyMetricKey>('temperatureC')
const hourlyTrends = computed(() => dashboard.value?.hourlyTrends ?? null)

const hourlyLegend = [
  { key: 'temperatureC' as const, label: '气温' },
  { key: 'precipitationMm' as const, label: '降水' },
  { key: 'windSpeedMs' as const, label: '风速' },
  { key: 'humidityPercent' as const, label: '湿度' },
  { key: 'cloudPercent' as const, label: '云量' }
]

function toggleHourlyMetric(key: HourlyMetricKey): void {
  hourlyActiveKey.value = key
}

const provCode = ref<string>(localStorage.getItem('weather.provCode') ?? 'JS')
const cities = ref<Array<{ id: string; name: string }>>([])
const chosenCityId = ref<string | null>(localStorage.getItem('weather.stationId') ?? null)
const citiesLoading = ref(false)
const citiesErrorText = ref<string | null>(null)
const lastRefreshMs = ref<number>(0)
const lastRefreshKey = ref<string>('')
const cityPickerOpen = ref(false)
const paydayDialogOpen = ref(false)
const provinces = ref<WeatherProvinceCity[]>([])
const provincesLoading = ref(false)
const provincesErrorText = ref<string | null>(null)
const cityQuery = ref<string>('')
const cityDropdownOpen = ref(false)

const filteredCities = computed(() => {
  const q = cityQuery.value.trim()
  if (!q) return cities.value
  const qUpper = q.toUpperCase()
  return cities.value.filter((c) => c.name.includes(q) || c.id.toUpperCase().includes(qUpper))
})

const provinceGroups = computed(() => {
  const map = new Map<string, WeatherProvinceCity[]>()
  for (const p of provinces.value) {
    const letter = (p.id?.[0] || '#').toUpperCase()
    const list = map.get(letter)
    if (list) list.push(p)
    else map.set(letter, [p])
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, list]) => ({
      letter,
      items: [...list].sort((x, y) => x.name.localeCompare(y.name, 'zh-Hans-CN'))
    }))
})

const provinceLetters = computed(() => provinceGroups.value.map((g) => g.letter))
const provinceListEl = ref<HTMLElement | null>(null)

function scrollToProvinceLetter(letter: string): void {
  const container = provinceListEl.value
  if (!container) return
  const target = container.querySelector(`[data-letter="${letter}"]`) as HTMLElement | null
  if (!target) return
  container.scrollTo({ top: target.offsetTop, behavior: 'smooth' })
}

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

const settingsStore = useSettingsStore()
const settings = computed(() => settingsStore.settings.value)

const FUN_FACT_YMD_KEY = 'ai.funFact.ymd'
const FUN_FACT_TEXT_KEY = 'ai.funFact.text'
const funFactYmd = ref<string>(localStorage.getItem(FUN_FACT_YMD_KEY) ?? '')
const funFactText = ref<string>(localStorage.getItem(FUN_FACT_TEXT_KEY) ?? '')
const funFactLoading = ref(false)
const funFactErrorText = ref('')
const funFactStreamId = ref<string>('')

type StackCardId = 'answer' | 'funFact'
const STACK_ACTIVE_KEY = 'miniTools.stack.active'
const stackActive = ref<StackCardId>(
  localStorage.getItem(STACK_ACTIVE_KEY) === 'funFact' ? 'funFact' : 'answer'
)

const stackColors = ['#1A1A1A', 'linear-gradient(45deg, #835abf, #5a5a5ac7)']

function setStackActive(id: StackCardId): void {
  stackActive.value = id
  try {
    localStorage.setItem(STACK_ACTIVE_KEY, id)
  } catch {
    return
  }
}

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

const funFactTitle = computed(() => {
  const v = settings.value.funFact?.title
  return (typeof v === 'string' ? v.trim() : '') || DEFAULT_SETTINGS.funFact.title
})

const customModules = ref<CustomModuleConfig[]>([])
const customModulesCache = ref<Record<string, CustomModuleCachedContent>>({})
const customModulesLoading = ref<Record<string, boolean>>({})
const customModulesSearching = ref<Record<string, boolean>>({})
const customModulesError = ref<Record<string, string>>({})
const customModulesStreamId = ref<Record<string, string>>({})

const BUILTIN_MODULE_IDS = [
  'weather-today',
  'weather-chart',
  'work-calendar',
  'stack-tools'
] as const

const BUILTIN_MODULE_VISIBILITY_KEY = 'builtinModules.visibility'

const BUILTIN_MODULE_LABELS: Record<
  string,
  { title: string; icon: FunctionalComponent<LucideProps> }
> = {
  'weather-today': {
    title: '今日天气',
    icon: CloudSun
  },
  'weather-chart': {
    title: '天气图表',
    icon: ChartLine
  },
  'work-calendar': {
    title: '打工人日历',
    icon: Calendar
  },
  'stack-tools': {
    title: '迷你工具',
    icon: ToolCase
  }
}

const moduleVisibility = reactive<Record<string, boolean>>(loadBuiltinModuleVisibility())
const moduleVisibilityDrawerOpen = ref(false)

const addBtnVisible = ref(false)
let addBtnHideTimer: number | null = null

function onPageMouseMove(e: MouseEvent): void {
  const viewportHeight = window.innerHeight
  const threshold = viewportHeight * 0.7
  if (e.clientY >= threshold) {
    if (addBtnHideTimer !== null) {
      window.clearTimeout(addBtnHideTimer)
      addBtnHideTimer = null
    }
    addBtnVisible.value = true
  } else {
    if (addBtnVisible.value) {
      scheduleAddBtnHide()
    }
  }
}

function onPageMouseLeave(): void {
  scheduleAddBtnHide()
}

function scheduleAddBtnHide(): void {
  if (addBtnHideTimer !== null) return
  addBtnHideTimer = window.setTimeout(() => {
    addBtnVisible.value = false
    addBtnHideTimer = null
  }, 300)
}

function loadBuiltinModuleVisibility(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(BUILTIN_MODULE_VISIBILITY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') {
        return Object.fromEntries(BUILTIN_MODULE_IDS.map((id) => [id, parsed[id] !== false]))
      }
    }
  } catch (e) {
    console.error(e)
  }
  return Object.fromEntries(BUILTIN_MODULE_IDS.map((id) => [id, true]))
}

function saveBuiltinModuleVisibility(): void {
  try {
    localStorage.setItem(BUILTIN_MODULE_VISIBILITY_KEY, JSON.stringify(moduleVisibility))
  } catch (e) {
    console.error(e)
  }
}

function toggleModuleVisibility(id: string): void {
  moduleVisibility[id] = !moduleVisibility[id]
  saveBuiltinModuleVisibility()
}

const ADD_MODULE_ID = '__add__'
const GRID_ORDER_KEY = 'customModules.gridOrder'

const gridOrder = ref<string[]>([])

function loadGridOrder(): void {
  try {
    const raw = localStorage.getItem(GRID_ORDER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        gridOrder.value = parsed.filter((id): id is string => typeof id === 'string')
        return
      }
    }
  } catch {
    gridOrder.value = []
  }
  const builtinIds = [...BUILTIN_MODULE_IDS]
  const customIds = customModules.value.map((m) => m.id)
  gridOrder.value = [...builtinIds, ...customIds, ADD_MODULE_ID]
}

function saveGridOrder(): void {
  try {
    localStorage.setItem(GRID_ORDER_KEY, JSON.stringify(gridOrder.value))
  } catch {
    return
  }
}

const orderedGridItems = computed(() => {
  const validIds = new Set<string>([...BUILTIN_MODULE_IDS])
  for (const mod of customModules.value) {
    validIds.add(mod.id)
  }
  const seen = new Set<string>()
  const items: string[] = []
  for (const id of gridOrder.value) {
    if (validIds.has(id) && !seen.has(id)) {
      items.push(id)
      seen.add(id)
    }
  }
  for (const id of BUILTIN_MODULE_IDS) {
    if (!seen.has(id)) {
      items.push(id)
      seen.add(id)
    }
  }
  if (!seen.has(ADD_MODULE_ID)) {
    items.push(ADD_MODULE_ID)
  }
  return items
})

const customModuleMap = computed(() => {
  const map = new Map<string, CustomModuleConfig>()
  for (const mod of customModules.value) {
    map.set(mod.id, mod)
  }
  return map
})

const moduleDialogOpen = ref(false)
const moduleDialogMode = ref<'add' | 'edit'>('add')
const editingModuleId = ref('')
const moduleDialogInitial = ref<ModuleDialogData>({
  name: '',
  type: 'text',
  prompt: '',
  webSearch: false,
  minHeight: 180,
  maxHeight: 300,
  enableMarkdown: false,
  updateFrequency: 'daily'
})

function generateModuleId(): string {
  return `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const DEFAULT_CUSTOM_MODULES: CustomModuleConfig[] = [
  {
    id: 'cm-demo-text',
    name: '每日编程小知识',
    type: 'text',
    prompt: '分享一个实用的编程小技巧，控制在100字以内',
    createdAt: Date.now(),
    minHeight: 180,
    maxHeight: 300,
    enableMarkdown: true,
    updateFrequency: 'daily'
  },
  {
    id: 'cm-demo-ranking',
    name: '前端技术栈排行',
    type: 'ranking',
    prompt: '获取当前前端开发技术栈的流行度排行，要求以JSON格式输出，包含多个维度的排行榜',
    createdAt: Date.now(),
    minHeight: 180,
    maxHeight: 300,
    enableMarkdown: false,
    updateFrequency: 'weekly'
  },
  {
    id: 'cm-demo-link',
    name: '开发者资讯简报',
    type: 'link',
    prompt: '推荐当前热门的开发者工具、技术网站和学习资源，以JSON格式输出',
    createdAt: Date.now(),
    minHeight: 180,
    maxHeight: 300,
    enableMarkdown: false,
    updateFrequency: 'daily'
  },
  {
    id: 'cm-demo-chart',
    name: '技术趋势数据',
    type: 'chart',
    prompt: '展示当前主流前端框架的使用率数据和语言趋势，以JSON格式输出',
    createdAt: Date.now(),
    minHeight: 200,
    maxHeight: 400,
    enableMarkdown: false,
    updateFrequency: 'monthly'
  }
]

const DEFAULT_CUSTOM_MODULES_CACHE: Record<string, CustomModuleCachedContent> = {
  'cm-demo-text': {
    text: '### 🔧 解构赋值让代码更简洁\n\nJavaScript 的解构赋值可以从数组或对象中提取值并赋给变量：\n\n```js\n// 对象解构\nconst { name, age } = user;\n// 数组解构\nconst [first, ...rest] = arr;\n```\n\n让代码更简洁、可读性更强！',
    rawText:
      '### 🔧 解构赋值让代码更简洁\n\nJavaScript 的解构赋值可以从数组或对象中提取值并赋给变量：\n\n```js\n// 对象解构\nconst { name, age } = user;\n// 数组解构\nconst [first, ...rest] = arr;\n```\n\n让代码更简洁、可读性更强！',
    updatedAt: Date.now()
  },
  'cm-demo-ranking': {
    rankings: [
      { title: '前端框架', items: ['React', 'Vue', 'Angular', 'Svelte', 'Solid'] },
      {
        title: 'CSS 方案',
        items: ['Tailwind CSS', 'CSS Modules', 'Styled Components', 'Sass/SCSS']
      },
      { title: '构建工具', items: ['Vite', 'Webpack', 'Turbopack', 'esbuild'] }
    ],
    rawText:
      '{"rankings":[{"title":"前端框架","items":["React","Vue","Angular","Svelte","Solid"]},{"title":"CSS 方案","items":["Tailwind CSS","CSS Modules","Styled Components","Sass/SCSS"]},{"title":"构建工具","items":["Vite","Webpack","Turbopack","esbuild"]}]}',
    updatedAt: Date.now()
  },
  'cm-demo-link': {
    links: [
      {
        title: 'GitHub Trending',
        link: 'https://github.com/trending',
        description: '每日热门开源项目'
      },
      { title: 'Hacker News', link: 'https://news.ycombinator.com', description: '科技新闻社区' },
      { title: 'Dev.to', link: 'https://dev.to', description: '开发者技术社区' },
      {
        title: 'MDN Web Docs',
        link: 'https://developer.mozilla.org/zh-CN/',
        description: 'Web 技术权威文档'
      }
    ],
    rawText:
      '{"items":[{"title":"GitHub Trending","link":"https://github.com/trending","description":"每日热门开源项目"},{"title":"Hacker News","link":"https://news.ycombinator.com","description":"科技新闻社区"},{"title":"Dev.to","link":"https://dev.to","description":"开发者技术社区"},{"title":"MDN Web Docs","link":"https://developer.mozilla.org/zh-CN/","description":"Web 技术权威文档"}]}',
    updatedAt: Date.now()
  },
  'cm-demo-chart': {
    charts: [
      {
        title: '前端框架使用率',
        type: 'bar',
        labels: ['React', 'Vue', 'Angular', 'Svelte', 'Solid'],
        series: [
          { name: '使用率', type: 'bar', data: [42, 28, 16, 8, 6], color: 'rgba(0, 220, 255, 0.9)' }
        ]
      },
      {
        title: 'JavaScript 生态',
        type: 'line',
        labels: ['2019', '2020', '2021', '2022', '2023', '2024'],
        series: [
          {
            name: 'React',
            type: 'line',
            data: [38, 40, 42, 43, 42, 42],
            color: 'rgba(0, 220, 255, 0.9)'
          },
          {
            name: 'Vue',
            type: 'line',
            data: [22, 25, 28, 30, 29, 28],
            color: 'rgba(60, 180, 120, 0.9)'
          }
        ]
      }
    ],
    rawText:
      '{"charts":[{"title":"前端框架使用率","type":"bar","labels":["React","Vue","Angular","Svelte","Solid"],"series":[{"name":"使用率","type":"bar","data":[42,28,16,8,6]}]},{"title":"JavaScript 生态","type":"line","labels":["2019","2020","2021","2022","2023","2024"],"series":[{"name":"React","type":"line","data":[38,40,42,43,42,42]},{"name":"Vue","type":"line","data":[22,25,28,30,29,28]}]}]}',
    updatedAt: Date.now()
  }
}

function loadCustomModules(): void {
  try {
    const raw = localStorage.getItem(CUSTOM_MODULES_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        customModules.value = parsed.filter(
          (item): item is CustomModuleConfig =>
            item &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>).id === 'string' &&
            typeof (item as Record<string, unknown>).name === 'string' &&
            ((item as Record<string, unknown>).type === 'text' ||
              (item as Record<string, unknown>).type === 'ranking' ||
              (item as Record<string, unknown>).type === 'link' ||
              (item as Record<string, unknown>).type === 'chart') &&
            typeof (item as Record<string, unknown>).prompt === 'string'
        )
        return
      }
    }
    customModules.value = DEFAULT_CUSTOM_MODULES.map((m) => ({ ...m, createdAt: Date.now() }))
    saveCustomModules()
  } catch {
    customModules.value = DEFAULT_CUSTOM_MODULES.map((m) => ({ ...m, createdAt: Date.now() }))
    saveCustomModules()
  }
}

function saveCustomModules(): void {
  try {
    localStorage.setItem(CUSTOM_MODULES_STORAGE_KEY, JSON.stringify(customModules.value))
  } catch {
    return
  }
}

const draggedModuleId = ref<string | null>(null)
const dragOverModuleId = ref<string | null>(null)

function onModuleDragStart(payload: { id: string; event: DragEvent }): void {
  draggedModuleId.value = payload.id
  if (payload.event.dataTransfer) {
    payload.event.dataTransfer.effectAllowed = 'move'
    payload.event.dataTransfer.setData('text/plain', payload.id)
  }
}

function onModuleDragOver(payload: { id: string; event: DragEvent }): void {
  if (draggedModuleId.value === payload.id) return
  payload.event.preventDefault()
  if (payload.event.dataTransfer) {
    payload.event.dataTransfer.dropEffect = 'move'
  }
  dragOverModuleId.value = payload.id
}

function onModuleDragLeave(): void {
  dragOverModuleId.value = null
}

function onModuleDrop(payload: { id: string; event: DragEvent }): void {
  payload.event.preventDefault()
  const sourceId = draggedModuleId.value
  const targetId = payload.id
  if (!sourceId || sourceId === targetId || targetId === ADD_MODULE_ID) {
    resetModuleDragState()
    return
  }

  const sourceIdx = gridOrder.value.indexOf(sourceId)
  const targetIdx = gridOrder.value.indexOf(targetId)
  if (sourceIdx === -1 || targetIdx === -1) {
    resetModuleDragState()
    return
  }

  const items = [...gridOrder.value]
  const [moved] = items.splice(sourceIdx, 1)
  const adjustedTarget = sourceIdx < targetIdx ? targetIdx - 1 : targetIdx
  items.splice(adjustedTarget, 0, moved)
  gridOrder.value = items
  saveGridOrder()
  resetModuleDragState()
}

function onModuleDragEnd(): void {
  resetModuleDragState()
}

function resetModuleDragState(): void {
  draggedModuleId.value = null
  dragOverModuleId.value = null
}

function loadCustomModulesCache(): void {
  try {
    const raw = localStorage.getItem(CUSTOM_MODULES_CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') {
        customModulesCache.value = parsed as Record<string, CustomModuleCachedContent>
        return
      }
    }
    customModulesCache.value = Object.fromEntries(
      Object.entries(DEFAULT_CUSTOM_MODULES_CACHE).map(([id, content]) => [
        id,
        { ...content, updatedAt: Date.now() }
      ])
    )
    saveCustomModulesCache()
  } catch {
    customModulesCache.value = Object.fromEntries(
      Object.entries(DEFAULT_CUSTOM_MODULES_CACHE).map(([id, content]) => [
        id,
        { ...content, updatedAt: Date.now() }
      ])
    )
    saveCustomModulesCache()
  }
}

function saveCustomModulesCache(): void {
  try {
    localStorage.setItem(CUSTOM_MODULES_CACHE_KEY, JSON.stringify(customModulesCache.value))
  } catch {
    return
  }
}

function openAddModuleDialog(): void {
  moduleDialogMode.value = 'add'
  editingModuleId.value = ''
  moduleDialogInitial.value = {
    name: '',
    type: 'text',
    prompt: '',
    webSearch: false,
    minHeight: 180,
    maxHeight: 300,
    enableMarkdown: false,
    updateFrequency: 'daily'
  }
  moduleDialogOpen.value = true
}

function openEditModuleDialog(module: CustomModuleConfig): void {
  moduleDialogMode.value = 'edit'
  editingModuleId.value = module.id
  moduleDialogInitial.value = {
    name: module.name,
    type: module.type,
    prompt: module.prompt,
    webSearch: !!module.webSearch,
    minHeight: module.minHeight ?? 180,
    maxHeight: module.maxHeight ?? 300,
    enableMarkdown: !!module.enableMarkdown,
    updateFrequency: module.updateFrequency ?? 'realtime'
  }
  moduleDialogOpen.value = true
}

function handleModuleSaved(data: ModuleDialogData): void {
  if (moduleDialogMode.value === 'add') {
    const newModule: CustomModuleConfig = {
      id: generateModuleId(),
      name: data.name,
      type: data.type,
      prompt: data.prompt,
      createdAt: Date.now(),
      webSearch: data.webSearch,
      minHeight: data.minHeight,
      maxHeight: data.maxHeight,
      enableMarkdown: data.enableMarkdown,
      updateFrequency: data.updateFrequency
    }
    customModules.value.push(newModule)
    const addIdx = gridOrder.value.indexOf(ADD_MODULE_ID)
    if (addIdx >= 0) {
      gridOrder.value.splice(addIdx, 0, newModule.id)
    } else {
      gridOrder.value.push(newModule.id)
    }
  } else {
    const idx = customModules.value.findIndex((m) => m.id === editingModuleId.value)
    if (idx >= 0) {
      customModules.value[idx] = {
        ...customModules.value[idx],
        name: data.name,
        type: data.type,
        prompt: data.prompt,
        webSearch: data.webSearch,
        minHeight: data.minHeight,
        maxHeight: data.maxHeight,
        enableMarkdown: data.enableMarkdown,
        updateFrequency: data.updateFrequency
      }
    }
  }
  saveCustomModules()
  saveGridOrder()
  moduleDialogOpen.value = false
}

function deleteModule(moduleId: string): void {
  customModules.value = customModules.value.filter((m) => m.id !== moduleId)
  gridOrder.value = gridOrder.value.filter((id) => id !== moduleId)
  saveCustomModules()
  saveGridOrder()
  delete customModulesCache.value[moduleId]
  saveCustomModulesCache()
}

function getModuleCache(moduleId: string): CustomModuleCachedContent | undefined {
  return customModulesCache.value[moduleId]
}

function updateModuleCache(moduleId: string, content: Partial<CustomModuleCachedContent>): void {
  const existing = customModulesCache.value[moduleId]
  customModulesCache.value[moduleId] = {
    ...(existing || { updatedAt: 0 }),
    ...content,
    updatedAt: Date.now()
  }
  saveCustomModulesCache()
}

function onCustomModuleChunk(_event: unknown, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { id?: unknown; moduleId?: unknown; delta?: unknown }
  const moduleId = typeof p.moduleId === 'string' ? p.moduleId : ''
  if (!moduleId) return
  if (typeof p.id !== 'string' || !p.id) return
  if (p.id !== customModulesStreamId.value[moduleId]) return
  const delta = typeof p.delta === 'string' ? p.delta : ''
  if (!delta) return
  customModulesSearching.value[moduleId] = false
  const cache = customModulesCache.value[moduleId]
  const currentText = cache?.rawText || ''
  const next = `${currentText}${delta}`
  updateModuleCache(moduleId, { rawText: next })
  if (customModules.value.find((m) => m.id === moduleId)?.type === 'ranking') {
    const parsed = tryParseRankingsFromText(next)
    if (parsed) {
      updateModuleCache(moduleId, { rankings: parsed })
    }
  } else if (customModules.value.find((m) => m.id === moduleId)?.type === 'link') {
    const parsed = tryParseLinksFromText(next)
    if (parsed) {
      updateModuleCache(moduleId, { links: parsed })
    }
  } else if (customModules.value.find((m) => m.id === moduleId)?.type === 'chart') {
    const parsed = tryParseChartsFromText(next)
    if (parsed) {
      updateModuleCache(moduleId, { charts: parsed })
    }
  }
}

function onCustomModuleDone(_event: unknown, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { id?: unknown; moduleId?: unknown; text?: unknown; searchMeta?: unknown }
  const moduleId = typeof p.moduleId === 'string' ? p.moduleId : ''
  if (!moduleId) return
  if (typeof p.id !== 'string' || !p.id) return
  if (p.id !== customModulesStreamId.value[moduleId]) return
  const text = typeof p.text === 'string' ? p.text : ''
  let searchMeta: CustomModuleSearchMeta | undefined
  if (p.searchMeta && typeof p.searchMeta === 'object') {
    const sm = p.searchMeta as { resultCount?: unknown; sources?: unknown }
    const resultCount = typeof sm.resultCount === 'number' ? sm.resultCount : 0
    const sources = Array.isArray(sm.sources)
      ? sm.sources.filter((s): s is string => typeof s === 'string')
      : []
    if (resultCount > 0) {
      searchMeta = { resultCount, sources }
    }
  }
  const module = customModules.value.find((m) => m.id === moduleId)
  if (module?.type === 'text') {
    updateModuleCache(moduleId, { text, rawText: text, searchMeta })
  } else if (module?.type === 'link') {
    const parsed = tryParseLinksFromText(text)
    if (parsed) {
      updateModuleCache(moduleId, { links: parsed, rawText: text, searchMeta })
    } else {
      updateModuleCache(moduleId, { rawText: text, searchMeta })
    }
  } else if (module?.type === 'chart') {
    const parsed = tryParseChartsFromText(text)
    if (parsed) {
      updateModuleCache(moduleId, { charts: parsed, rawText: text, searchMeta })
    } else {
      updateModuleCache(moduleId, { rawText: text, searchMeta })
    }
  } else {
    const parsed = tryParseRankingsFromText(text)
    if (parsed) {
      updateModuleCache(moduleId, { rankings: parsed, rawText: text, searchMeta })
    } else {
      updateModuleCache(moduleId, { rawText: text, searchMeta })
    }
  }
  delete customModulesStreamId.value[moduleId]
  customModulesLoading.value[moduleId] = false
  customModulesSearching.value[moduleId] = false
  customModulesError.value[moduleId] = ''
}

function onCustomModuleError(_event: unknown, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { id?: unknown; moduleId?: unknown; message?: unknown }
  const moduleId = typeof p.moduleId === 'string' ? p.moduleId : ''
  if (!moduleId) return
  if (typeof p.id !== 'string' || !p.id) return
  if (p.id !== customModulesStreamId.value[moduleId]) return
  const msg = typeof p.message === 'string' && p.message ? p.message : '生成失败'
  customModulesError.value[moduleId] = msg
  delete customModulesStreamId.value[moduleId]
  customModulesLoading.value[moduleId] = false
  customModulesSearching.value[moduleId] = false
}

function onCustomModuleSearching(_event: unknown, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { id?: unknown; moduleId?: unknown; status?: unknown; message?: unknown }
  const moduleId = typeof p.moduleId === 'string' ? p.moduleId : ''
  if (!moduleId) return
  if (typeof p.id !== 'string' || !p.id) return
  if (p.id !== customModulesStreamId.value[moduleId]) return
  const status = typeof p.status === 'string' ? p.status : ''
  if (status === 'searching') {
    customModulesSearching.value[moduleId] = true
    customModulesError.value[moduleId] = ''
  } else if (status === 'error') {
    customModulesSearching.value[moduleId] = false
    const msg = typeof p.message === 'string' && p.message ? p.message : '搜索失败'
    customModulesError.value[moduleId] = `联网搜索失败：${msg}`
  }
}

function tryParseRankingsFromText(rawText: string): CustomModuleRankingItem[] | null {
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  // Try full JSON parse first
  try {
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const jsonStr = cleaned.slice(firstBrace, lastBrace + 1)
      const data = JSON.parse(jsonStr) as { rankings?: unknown }
      if (data.rankings && Array.isArray(data.rankings)) {
        const rankings: CustomModuleRankingItem[] = []
        for (const item of data.rankings) {
          if (item && typeof item === 'object') {
            const r = item as Record<string, unknown>
            const title = typeof r.title === 'string' ? r.title.trim() : ''
            const items = Array.isArray(r.items)
              ? r.items.filter((i): i is string => typeof i === 'string')
              : []
            if (title && items.length > 0) {
              rankings.push({ title, items })
            }
          }
        }
        if (rankings.length > 0) return rankings
      }
    }
  } catch {
    // Full parse failed (likely truncated JSON) — fall through to item-by-item extraction
  }

  // Fallback: extract individual complete JSON objects item by item
  const extracted: CustomModuleRankingItem[] = []
  let idx = 0
  while (idx < cleaned.length) {
    const objStart = cleaned.indexOf('{', idx)
    if (objStart < 0) break

    let depth = 0
    let objEnd = -1
    for (let i = objStart; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++
      else if (cleaned[i] === '}') {
        depth--
        if (depth === 0) {
          objEnd = i
          break
        }
      }
    }
    if (objEnd < 0) break

    try {
      const objStr = cleaned.slice(objStart, objEnd + 1)
      const obj = JSON.parse(objStr) as Record<string, unknown>
      const title = typeof obj.title === 'string' ? obj.title.trim() : ''
      const items = Array.isArray(obj.items)
        ? obj.items.filter((i): i is string => typeof i === 'string')
        : []
      if (title && items.length > 0) {
        extracted.push({ title, items })
      }
    } catch {
      // skip malformed object
    }
    idx = objEnd + 1
  }

  return extracted.length > 0 ? extracted : null
}

function tryParseLinksFromText(rawText: string): CustomModuleLinkItem[] | null {
  const items: CustomModuleLinkItem[] = []
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  // Try full JSON parse first
  try {
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const jsonStr = cleaned.slice(firstBrace, lastBrace + 1)
      const data = JSON.parse(jsonStr) as { items?: unknown }
      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          if (item && typeof item === 'object') {
            const r = item as Record<string, unknown>
            const title = typeof r.title === 'string' ? r.title.trim() : ''
            const link = typeof r.link === 'string' ? r.link.trim() : ''
            const description = typeof r.description === 'string' ? r.description.trim() : undefined
            if (title && link) {
              items.push({ title, link, description })
            }
          }
        }
        if (items.length > 0) return items
      }
    }
  } catch {
    // Full parse failed (likely truncated JSON) — fall through to item-by-item extraction
  }

  // Fallback: extract individual complete JSON objects item by item
  const extracted: CustomModuleLinkItem[] = []
  let idx = 0
  while (idx < cleaned.length) {
    const objStart = cleaned.indexOf('{', idx)
    if (objStart < 0) break

    let depth = 0
    let objEnd = -1
    for (let i = objStart; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++
      else if (cleaned[i] === '}') {
        depth--
        if (depth === 0) {
          objEnd = i
          break
        }
      }
    }
    if (objEnd < 0) break

    try {
      const objStr = cleaned.slice(objStart, objEnd + 1)
      const obj = JSON.parse(objStr) as Record<string, unknown>
      const title = typeof obj.title === 'string' ? obj.title.trim() : ''
      const link = typeof obj.link === 'string' ? obj.link.trim() : ''
      const description = typeof obj.description === 'string' ? obj.description.trim() : undefined
      if (title && link) {
        extracted.push({ title, link, description })
      }
    } catch {
      // skip malformed object
    }
    idx = objEnd + 1
  }

  return extracted.length > 0 ? extracted : null
}

function tryParseChartsFromText(rawText: string): CustomModuleChartItem[] | null {
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  try {
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const jsonStr = cleaned.slice(firstBrace, lastBrace + 1)
      const data = JSON.parse(jsonStr) as { charts?: unknown }
      if (data.charts && Array.isArray(data.charts)) {
        const charts: CustomModuleChartItem[] = []
        for (const item of data.charts) {
          if (item && typeof item === 'object') {
            const c = item as Record<string, unknown>
            const title = typeof c.title === 'string' ? c.title.trim() : ''
            const type = c.type === 'bar' || c.type === 'line' || c.type === 'pie' ? c.type : 'bar'
            const labels = Array.isArray(c.labels)
              ? c.labels.filter((l): l is string => typeof l === 'string')
              : []
            const series = Array.isArray(c.series)
              ? c.series
                  .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
                  .map((s) => ({
                    name: typeof s.name === 'string' ? s.name.trim() : '',
                    type: (s.type === 'bar' || s.type === 'line' || s.type === 'pie'
                      ? s.type
                      : 'bar') as 'bar' | 'line' | 'pie',
                    data: Array.isArray(s.data)
                      ? s.data.filter((d): d is number => typeof d === 'number')
                      : [],
                    color: typeof s.color === 'string' ? s.color : undefined
                  }))
                  .filter((s) => s.name && s.data.length > 0)
              : []
            if (title && labels.length > 0 && series.length > 0) {
              charts.push({ title, type, labels, series })
            }
          }
        }
        if (charts.length > 0) return charts
      }
    }
  } catch {
    // full parse failed — fall through
  }

  const extracted: CustomModuleChartItem[] = []
  let idx = 0
  while (idx < cleaned.length) {
    const objStart = cleaned.indexOf('{', idx)
    if (objStart < 0) break
    let depth = 0
    let objEnd = -1
    for (let i = objStart; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++
      else if (cleaned[i] === '}') {
        depth--
        if (depth === 0) {
          objEnd = i
          break
        }
      }
    }
    if (objEnd < 0) break
    try {
      const obj = JSON.parse(cleaned.slice(objStart, objEnd + 1)) as Record<string, unknown>
      if (obj.series && Array.isArray(obj.series) && Array.isArray(obj.labels)) {
        const title = typeof obj.title === 'string' ? obj.title.trim() : ''
        const type =
          obj.type === 'bar' || obj.type === 'line' || obj.type === 'pie' ? obj.type : 'bar'
        const labels = obj.labels.filter((l: unknown): l is string => typeof l === 'string')
        const series = obj.series
          .filter((s: unknown): s is Record<string, unknown> => s !== null && typeof s === 'object')
          .map((s: Record<string, unknown>) => ({
            name: typeof s.name === 'string' ? s.name.trim() : '',
            type: (s.type === 'bar' || s.type === 'line' || s.type === 'pie' ? s.type : 'bar') as
              | 'bar'
              | 'line'
              | 'pie',
            data: Array.isArray(s.data)
              ? s.data.filter((d: unknown): d is number => typeof d === 'number')
              : [],
            color: typeof s.color === 'string' ? s.color : undefined
          }))
          .filter((s) => s.name && s.data.length > 0)
        if (title && labels.length > 0 && series.length > 0) {
          extracted.push({ title, type, labels, series })
        }
      }
    } catch {
      /* skip */
    }
    idx = objEnd + 1
  }
  return extracted.length > 0 ? extracted : null
}

function isSameDay(timestamp: number): boolean {
  const d1 = new Date(timestamp)
  const d2 = new Date()
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

function isSameWeek(timestamp: number): boolean {
  const d1 = new Date(timestamp)
  const d2 = new Date()
  const startOfWeek = new Date(d2)
  startOfWeek.setDate(d2.getDate() - d2.getDay())
  startOfWeek.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)
  return d1 >= startOfWeek && d1 < endOfWeek
}

function isSameMonth(timestamp: number): boolean {
  const d1 = new Date(timestamp)
  const d2 = new Date()
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth()
}

function shouldAutoRefreshModule(module: CustomModuleConfig): boolean {
  const freq = module.updateFrequency ?? 'realtime'
  if (freq === 'realtime') return true
  const cache = customModulesCache.value[module.id]
  if (!cache) return true
  const updatedAt = cache.updatedAt
  if (!updatedAt) return true
  if (freq === 'daily') return !isSameDay(updatedAt)
  if (freq === 'weekly') return !isSameWeek(updatedAt)
  if (freq === 'monthly') return !isSameMonth(updatedAt)
  return true
}

function maybeAutoRefreshModules(): void {
  for (const mod of customModules.value) {
    if (shouldAutoRefreshModule(mod) && aiReady.value) {
      enqueueModuleRefresh(mod)
    }
  }
}

const moduleRefreshQueue: string[] = []
let moduleRefreshProcessing = false

async function processModuleRefreshQueue(): Promise<void> {
  if (moduleRefreshProcessing) return
  moduleRefreshProcessing = true
  while (moduleRefreshQueue.length > 0) {
    const moduleId = moduleRefreshQueue.shift()!
    const module = customModules.value.find((m) => m.id === moduleId)
    if (module && !customModulesLoading.value[module.id]) {
      await executeRefreshModule(module)
    }
  }
  moduleRefreshProcessing = false
}

function enqueueModuleRefresh(mod: CustomModuleConfig): void {
  if (!moduleRefreshQueue.includes(mod.id) && !customModulesLoading.value[mod.id]) {
    moduleRefreshQueue.push(mod.id)
  }
  processModuleRefreshQueue()
}

async function executeRefreshModule(module: CustomModuleConfig): Promise<void> {
  if (!aiReady.value) {
    customModulesError.value[module.id] = '请到「全局设置」启用 AI 并配置 Base URL / Key / Model'
    return
  }
  if (customModulesLoading.value[module.id]) return

  customModulesLoading.value[module.id] = true
  customModulesError.value[module.id] = ''
  delete customModulesCache.value[module.id]

  try {
    const ret = (await window.electron.ipcRenderer.invoke(CUSTOM_MODULES_EVENTS.STREAM, {
      moduleId: module.id,
      type: module.type,
      prompt: module.prompt,
      webSearch: !!module.webSearch,
      enableMarkdown: !!module.enableMarkdown
    })) as { id?: unknown; moduleId?: unknown }
    const id = typeof ret?.id === 'string' ? ret.id : ''
    if (!id) throw new Error('AI 流式请求启动失败')
    customModulesStreamId.value[module.id] = id
  } catch (e) {
    customModulesLoading.value[module.id] = false
    customModulesError.value[module.id] = e instanceof Error ? e.message : '请求失败'
  }
}

const funFactEditOpen = ref(false)
const funFactTitleDraft = ref('')
const funFactPromptDraft = ref('')
const funFactEditSaving = ref(false)
const funFactEditErrorText = ref('')

function openFunFactEditor(): void {
  funFactEditErrorText.value = ''
  funFactTitleDraft.value =
    (typeof settings.value.funFact?.title === 'string'
      ? settings.value.funFact.title
      : ''
    ).trim() || DEFAULT_SETTINGS.funFact.title
  funFactPromptDraft.value =
    typeof settings.value.funFact?.prompt === 'string'
      ? settings.value.funFact.prompt
      : DEFAULT_SETTINGS.funFact.prompt
  funFactEditOpen.value = true
}

function closeFunFactEditor(): void {
  funFactEditOpen.value = false
  funFactEditSaving.value = false
  funFactEditErrorText.value = ''
}

async function saveFunFactEditor(): Promise<void> {
  funFactEditSaving.value = true
  funFactEditErrorText.value = ''
  try {
    const title = funFactTitleDraft.value.trim()
    const prompt = funFactPromptDraft.value.replace(/\r\n/g, '\n')
    const ret = (await window.electron.ipcRenderer.invoke('settings:update', {
      funFact: {
        title,
        prompt
      }
    })) as AppSettings
    settingsStore.replace(ret)
    closeFunFactEditor()
  } catch (e) {
    funFactEditErrorText.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    funFactEditSaving.value = false
  }
}

function normalizeCachedFunFact(): void {
  if (!funFactYmd.value) return
  if (funFactYmd.value === funFactTodayYmd.value) return
  funFactYmd.value = ''
  funFactText.value = ''
  localStorage.removeItem(FUN_FACT_YMD_KEY)
  localStorage.removeItem(FUN_FACT_TEXT_KEY)
}

async function refreshSettings(): Promise<void> {
  await settingsStore.refresh()
}

function endFunFactLoading(): void {
  funFactLoading.value = false
  loadingSate.daily = false
}

function onFunFactChunk(_event: unknown, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { id?: unknown; delta?: unknown }
  if (typeof p.id !== 'string' || !p.id) return
  if (p.id !== funFactStreamId.value) return
  const delta = typeof p.delta === 'string' ? p.delta : ''
  if (!delta) return
  const next = `${funFactText.value}${delta}`
  funFactText.value = next.length > 900 ? next.slice(0, 900) : next
}

function onFunFactDone(_event: unknown, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { id?: unknown; ymd?: unknown; text?: unknown }
  if (typeof p.id !== 'string' || !p.id) return
  if (p.id !== funFactStreamId.value) return
  const ymd = typeof p.ymd === 'string' ? p.ymd : ''
  const text = typeof p.text === 'string' ? p.text : ''
  funFactYmd.value = ymd
  funFactText.value = text
  if (ymd) localStorage.setItem(FUN_FACT_YMD_KEY, ymd)
  if (text) localStorage.setItem(FUN_FACT_TEXT_KEY, text)
  funFactStreamId.value = ''
  endFunFactLoading()
}

function onFunFactError(_event: unknown, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { id?: unknown; message?: unknown }
  if (typeof p.id !== 'string' || !p.id) return
  if (p.id !== funFactStreamId.value) return
  const msg = typeof p.message === 'string' && p.message ? p.message : '获取冷知识失败'
  funFactErrorText.value = msg
  funFactStreamId.value = ''
  endFunFactLoading()
}

function onFunFactCancelled(_event: unknown, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { id?: unknown }
  if (typeof p.id !== 'string' || !p.id) return
  if (p.id !== funFactStreamId.value) return
  funFactStreamId.value = ''
  endFunFactLoading()
}

async function refreshDailyFunFact(force: boolean): Promise<void> {
  loadingSate.daily = true
  // normalizeCachedFunFact()
  if (!aiReady.value) {
    funFactErrorText.value = '请到「全局设置」启用 AI 并配置 Base URL / Key / Model'
    endFunFactLoading()
    return
  }
  if (!force && funFactYmd.value === funFactTodayYmd.value && funFactText.value.trim()) {
    funFactErrorText.value = ''
    endFunFactLoading()
    return
  }
  funFactLoading.value = true
  funFactErrorText.value = ''
  funFactText.value = ''
  try {
    const ret = (await window.electron.ipcRenderer.invoke('ai:funfact:daily:stream', {
      force
    })) as { id?: unknown; ymd?: unknown; text?: unknown }
    const id = typeof ret?.id === 'string' ? ret.id : ''
    const ymd = typeof ret?.ymd === 'string' ? ret.ymd : funFactTodayYmd.value
    const text = typeof ret?.text === 'string' ? ret.text : ''
    if (!id) throw new Error('AI 流式请求启动失败')
    funFactStreamId.value = id
    funFactYmd.value = ymd
    if (text) {
      funFactText.value = text
      if (ymd) localStorage.setItem(FUN_FACT_YMD_KEY, ymd)
      localStorage.setItem(FUN_FACT_TEXT_KEY, text)
      funFactStreamId.value = ''
      endFunFactLoading()
    }
  } catch (e) {
    funFactErrorText.value = e instanceof Error ? e.message : '获取冷知识失败'
    funFactStreamId.value = ''
    endFunFactLoading()
  }
}

let autoFunFactRequested = false
function maybeAutoRefreshFunFact(): void {
  if (autoFunFactRequested) return
  if (!settingsStore.ready.value) return
  if (stackActive.value !== 'funFact') return
  if (funFactLoading.value) return
  if (funFactStreamId.value) return
  autoFunFactRequested = true
  normalizeCachedFunFact()
  refreshDailyFunFact(false).catch(() => null)
}

watch(
  () => stackActive.value,
  () => {
    maybeAutoRefreshFunFact()
  }
)

function openCityPicker(): void {
  cityPickerOpen.value = true
  if (provinces.value.length === 0) {
    loadProvinces().catch(() => null)
    return
  }
}

function closeCityPicker(): void {
  cityPickerOpen.value = false
  cityQuery.value = ''
  cityDropdownOpen.value = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (cityDropdownOpen.value) {
    closeCityDropdown()
    return
  }
  closeCityPicker()
  closePaydayDialog()
  closeFunFactEditor()
}

async function loadProvinces(): Promise<void> {
  provincesLoading.value = true
  provincesErrorText.value = null
  try {
    const list = await WeatherTool.getProvinces()
    provinces.value = list
    const current = provCode.value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
    const next = list.some((p) => p.id === current) ? current : (list[0]?.id ?? '')
    if (next) {
      provCode.value = next
      localStorage.setItem('weather.provCode', next)
    }
  } catch {
    provinces.value = []
    provincesErrorText.value = '省份列表加载失败'
  } finally {
    provincesLoading.value = false
  }
}

async function loadCitiesForProvince(inputCode: string): Promise<void> {
  const code = inputCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
  if (!code) return
  provCode.value = code
  localStorage.setItem('weather.provCode', code)
  cityQuery.value = ''
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

function selectProvince(code: string): void {
  const next = code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
  if (!next) return
  if (provCode.value !== next) {
    chosenCityId.value = null
    cityQuery.value = ''
  }
  openCityDropdown()
  loadCitiesForProvince(next).catch(() => null)
}

function selectCity(cityId: string): void {
  const v = String(cityId || '').trim()
  if (!v) return
  chosenCityId.value = v
  stationId.value = v
  localStorage.setItem('weather.stationId', v)
  refresh().catch(() => null)
  closeCityPicker()
}

function openCityDropdown(): void {
  cityDropdownOpen.value = true
  cityQuery.value = ''
  if (provinces.value.length === 0) {
    loadProvinces()
      .then(() => loadCitiesForProvince(provCode.value))
      .catch(() => null)
    return
  }
  if (cities.value.length === 0) {
    loadCitiesForProvince(provCode.value).catch(() => null)
  }
}

function closeCityDropdown(): void {
  cityDropdownOpen.value = false
  cityQuery.value = ''
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

const emojiPullY = ref(0)
const emojiPulling = ref(false)
const emojiPointerId = ref<number | null>(null)
const emojiStartClientY = ref(0)
const EMOJI_PULL_MAX_PX = 84
const EMOJI_PULL_TRIGGER_PX = 52

const emojiPullReady = computed(() => emojiPullY.value >= EMOJI_PULL_TRIGGER_PX)

function onEmojiPointerDown(e: PointerEvent): void {
  if (!dashboard.value) return
  if (loadingSate.weather) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  emojiPointerId.value = e.pointerId
  emojiStartClientY.value = e.clientY
  emojiPulling.value = true
  try {
    el.setPointerCapture(e.pointerId)
  } catch {
    emojiPointerId.value = null
    emojiPulling.value = false
    emojiPullY.value = 0
  }
}

function onEmojiPointerMove(e: PointerEvent): void {
  if (!emojiPulling.value) return
  if (emojiPointerId.value !== e.pointerId) return
  const dy = e.clientY - emojiStartClientY.value
  if (dy <= 0) {
    emojiPullY.value = 0
    return
  }
  const dampened = dy * 0.58
  emojiPullY.value = Math.min(EMOJI_PULL_MAX_PX, dampened)
}

function endEmojiPull(triggerRefresh: boolean): void {
  const shouldRefresh =
    triggerRefresh &&
    emojiPullY.value >= EMOJI_PULL_TRIGGER_PX &&
    dashboard.value !== null &&
    !loadingSate.weather
  emojiPulling.value = false
  emojiPointerId.value = null
  emojiPullY.value = 0
  if (shouldRefresh) refresh().catch(() => null)
}

function onEmojiPointerUp(e: PointerEvent): void {
  if (emojiPointerId.value !== e.pointerId) return
  endEmojiPull(true)
}

function onEmojiPointerCancel(e: PointerEvent): void {
  if (emojiPointerId.value !== e.pointerId) return
  endEmojiPull(false)
}

function onEmojiPointerLostCapture(e: PointerEvent): void {
  if (emojiPointerId.value !== e.pointerId) return
  endEmojiPull(false)
}

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
  // if (
  //   lastRefreshKey.value === stationId.value &&
  //   Date.now() - lastRefreshMs.value < MIN_INTERVAL_MS
  // ) {
  //   errorText.value = '刷新过于频繁，请稍后再试'
  //   return
  // }
  loadingSate.weather = true
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
    loadingSate.weather = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.electron.ipcRenderer.on('ai:funfact:daily:chunk', onFunFactChunk)
  window.electron.ipcRenderer.on('ai:funfact:daily:done', onFunFactDone)
  window.electron.ipcRenderer.on('ai:funfact:daily:error', onFunFactError)
  window.electron.ipcRenderer.on('ai:funfact:daily:cancelled', onFunFactCancelled)
  window.electron.ipcRenderer.on(CUSTOM_MODULES_EVENTS.CHUNK, onCustomModuleChunk)
  window.electron.ipcRenderer.on(CUSTOM_MODULES_EVENTS.DONE, onCustomModuleDone)
  window.electron.ipcRenderer.on(CUSTOM_MODULES_EVENTS.ERROR, onCustomModuleError)
  window.electron.ipcRenderer.on(CUSTOM_MODULES_EVENTS.SEARCHING, onCustomModuleSearching)
  tickTimer = window.setInterval(() => {
    nowTickMs.value = Date.now()
    normalizeCachedFunFact()
  }, 60 * 1000)
  refreshSettings()
    .then(() => {
      normalizeCachedFunFact()
      maybeAutoRefreshFunFact()
    })
    .catch(() => null)
  if (chosenCityId.value) {
    stationId.value = chosenCityId.value
    localStorage.setItem('weather.stationId', stationId.value)
  }
  loadCustomModules()
  loadCustomModulesCache()
  loadGridOrder()
  maybeAutoRefreshModules()
  refresh().catch(() => null)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  // window.electron.ipcRenderer.removeListener('ai:funfact:daily:chunk', onFunFactChunk)
  // window.electron.ipcRenderer.removeListener('ai:funfact:daily:done', onFunFactDone)
  // window.electron.ipcRenderer.removeListener('ai:funfact:daily:error', onFunFactError)
  // window.electron.ipcRenderer.removeListener('ai:funfact:daily:cancelled', onFunFactCancelled)
  if (funFactStreamId.value) {
    window.electron.ipcRenderer
      .invoke('ai:funfact:daily:cancel', { id: funFactStreamId.value })
      .catch(() => null)
  }
  for (const [, streamId] of Object.entries(customModulesStreamId.value)) {
    if (streamId) {
      window.electron.ipcRenderer
        .invoke(CUSTOM_MODULES_EVENTS.CANCEL, { id: streamId })
        .catch(() => null)
    }
  }
  if (tickTimer !== null) {
    window.clearInterval(tickTimer)
    tickTimer = null
  }
})
</script>

<template>
  <div class="page-content" @mousemove="onPageMouseMove" @mouseleave="onPageMouseLeave">
    <header class="header">
      <div class="flex flex-col">
        <div class="title">Hello</div>
        <div class="subtitle">...</div>
      </div>
      <div class="ctrl-btns">
        <div
          class="module-visibility-btn"
          type="button"
          title="模块显示设置"
          @click="moduleVisibilityDrawerOpen = true"
        >
          <Stone :size="18" />
          <span>个性化设置</span>
        </div>
      </div>
    </header>

    <div>
      <div class="custom-modules-grid">
        <template v-for="itemId in orderedGridItems" :key="itemId">
          <div
            v-if="itemId === 'weather-today'"
            v-show="moduleVisibility['weather-today']"
            class="left-col"
            draggable="true"
            :class="{
              'is-dragging': draggedModuleId === itemId,
              'is-drag-over': dragOverModuleId === itemId
            }"
            @dragstart="onModuleDragStart({ id: itemId, event: $event })"
            @dragover="onModuleDragOver({ id: itemId, event: $event })"
            @dragleave="onModuleDragLeave"
            @drop="onModuleDrop({ id: itemId, event: $event })"
            @dragend="onModuleDragEnd"
          >
            <div class="block has-emoji">
              <div
                class="weather-emoji"
                :class="{
                  'is-dragging': emojiPulling,
                  'is-ready': emojiPullReady,
                  'is-loading': loadingSate.weather
                }"
                :style="{ transform: `translate(-50%, ${emojiPullY}px)` }"
                aria-hidden="true"
                @pointerdown.prevent="onEmojiPointerDown"
                @pointermove.prevent="onEmojiPointerMove"
                @pointerup.prevent="onEmojiPointerUp"
                @pointercancel.prevent="onEmojiPointerCancel"
                @lostpointercapture="onEmojiPointerLostCapture"
              >
                <div v-if="loadingSate.weather" class="weather-emoji-spinner" />
                <template v-else>{{ todayWeatherEmoji }}</template>
              </div>

              <div class="weather-content">
                <div class="block-title">今日</div>
                <div class="now-main">
                  <button class="location location-btn" type="button" @click="openCityPicker">
                    <span>{{ dashboard?.now?.locationName }}</span>
                    <span class="location-caret">▾</span>
                  </button>
                  <div class="temp">
                    <span class="temp-value">{{
                      dashboard?.now?.temperatureC == null
                        ? '—'
                        : Math.round(dashboard?.now?.temperatureC ?? 0)
                    }}</span>
                    <span class="temp-unit">℃</span>
                  </div>
                </div>
                <div class="meta">
                  <div class="meta-row">
                    <span class="meta-k">体感</span>
                    <span class="meta-v">{{
                      dashboard?.now?.feelsLikeC == null
                        ? '—'
                        : `${Math.round(dashboard?.now?.feelsLikeC ?? 0)}℃`
                    }}</span>
                  </div>
                  <div class="meta-row">
                    <span class="meta-k">湿度</span>
                    <span class="meta-v">{{
                      dashboard?.now?.humidityPercent == null
                        ? '—'
                        : `${Math.round(dashboard?.now?.humidityPercent ?? 0)}%`
                    }}</span>
                  </div>
                  <div class="meta-row">
                    <span class="meta-k">气压</span>
                    <span class="meta-v">{{
                      dashboard?.now?.pressureHpa == null
                        ? '—'
                        : `${Math.round(dashboard?.now?.pressureHpa ?? 0)}hPa`
                    }}</span>
                  </div>
                  <div class="meta-row">
                    <span class="meta-k">降水</span>
                    <span class="meta-v">{{
                      dashboard?.now?.precipitationMm == null
                        ? '—'
                        : `${dashboard?.now?.precipitationMm ?? 0}mm`
                    }}</span>
                  </div>
                  <div class="meta-row">
                    <span class="meta-k">风</span>
                    <span class="meta-v">{{
                      dashboard?.now?.windDirectionText && dashboard?.now?.windScaleText
                        ? `${dashboard?.now?.windDirectionText} ${dashboard?.now?.windScaleText}`
                        : '—'
                    }}</span>
                  </div>
                  <!-- <div class="meta-row">
                  <span class="meta-k">更新</span>
                  <span class="meta-v">{{ dashboard?.now?.lastUpdateText ?? '—' }}</span>
                </div> -->
                </div>
              </div>
            </div>
            <div class="block border-none">
              <div class="block-title">
                <span>3小时降雨预警</span>
                <div class="warning-line">
                  <span class="badge" :class="{ danger: dashboard?.threeHour?.willRain }">
                    {{ dashboard?.threeHour?.willRain ? '可能降雨' : '无降雨' }}
                  </span>
                  <span v-if="dashboard?.threeHour?.willRain" class="warning-hint">
                    最大 {{ dashboard?.threeHour?.maxPrecipitationMm ?? 0 }}mm
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div
            v-else-if="itemId === 'weather-chart'"
            v-show="moduleVisibility['weather-chart']"
            class="right-col"
            draggable="true"
            :class="{
              'is-dragging': draggedModuleId === itemId,
              'is-drag-over': dragOverModuleId === itemId
            }"
            @dragstart="onModuleDragStart({ id: itemId, event: $event })"
            @dragover="onModuleDragOver({ id: itemId, event: $event })"
            @dragleave="onModuleDragLeave"
            @drop="onModuleDrop({ id: itemId, event: $event })"
            @dragend="onModuleDragEnd"
          >
            <div class="block border-none !h-[200px]">
              <div class="block-title">
                <span>
                  <a-segmented
                    v-model:value="weatherType"
                    size="small"
                    :options="[
                      { label: '7日天气', value: 'recently' },
                      { label: '24小时天气', value: 'now' }
                    ]"
                  />
                </span>
                <span class="legend">
                  <template v-if="weatherType === 'recently'">
                    <span class="lg lg-high"></span>
                    <span class="lg lg-low"></span>
                  </template>
                  <template v-else>
                    <a-tooltip v-for="it in hourlyLegend" :key="it.key" placement="topLeft">
                      <template #title>
                        <span>{{ it.label }}</span>
                      </template>
                      <span
                        :key="it.key"
                        :class="['lg', it.key, hourlyActiveKey === it.key ? 'active' : '']"
                        :label="it.label"
                        @click="toggleHourlyMetric(it.key)"
                      ></span>
                    </a-tooltip>
                    <!-- <span
                    v-for="it in hourlyLegend"
                    :key="it.key"
                    class="lg"
                    :label="it.label"
                    @click="toggleHourlyMetric(it.key)"
                  ></span> -->
                    <!-- <button
                    v-for="it in hourlyLegend"
                    :key="it.key"
                    class="legend-item"
                    type="button"
                    :class="{ active: hourlyActiveKey === it.key }"
                    @click="toggleHourlyMetric(it.key)"
                  >
                    {{ it.label }}
                  </button> -->
                  </template>
                </span>
              </div>
              <SevenDayTempChart
                v-if="weatherType === 'recently' && (dashboard?.days?.length ?? 0) > 0"
                :days="dashboard?.days ?? []"
              />
              <WeatherHourlyTrendsChart
                v-else-if="weatherType === 'now' && hourlyTrends"
                :trends="hourlyTrends"
                :active-key="hourlyActiveKey"
              />
              <div v-else class="empty">暂无数据</div>
            </div>
          </div>

          <section
            v-else-if="itemId === 'work-calendar'"
            v-show="moduleVisibility['work-calendar']"
            class="card work-calendar-card"
            draggable="true"
            :class="{
              'is-dragging': draggedModuleId === itemId,
              'is-drag-over': dragOverModuleId === itemId
            }"
            @dragstart="onModuleDragStart({ id: itemId, event: $event })"
            @dragover="onModuleDragOver({ id: itemId, event: $event })"
            @dragleave="onModuleDragLeave"
            @drop="onModuleDrop({ id: itemId, event: $event })"
            @dragend="onModuleDragEnd"
          >
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

          <div
            v-else-if="itemId === 'stack-tools'"
            v-show="moduleVisibility['stack-tools']"
            class="stack-tool-wrap"
            draggable="true"
            :class="{
              'is-dragging': draggedModuleId === itemId,
              'is-drag-over': dragOverModuleId === itemId
            }"
            @dragstart="onModuleDragStart({ id: itemId, event: $event })"
            @dragover="onModuleDragOver({ id: itemId, event: $event })"
            @dragleave="onModuleDragLeave"
            @drop="onModuleDrop({ id: itemId, event: $event })"
            @dragend="onModuleDragEnd"
          >
            <section
              class="card stack-card"
              :class="{ active: stackActive === 'answer', inactive: stackActive !== 'answer' }"
              :style="{
                background: stackColors[0]
              }"
            >
              <button
                class="stack-head answer-book-head"
                type="button"
                :disabled="stackActive === 'answer'"
                @click="setStackActive('answer')"
              >
                <div class="answer-book-title">答案之书</div>
              </button>

              <div v-show="stackActive === 'answer'" class="answer-book-body stack-body">
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
                      <div class="answer-front-title">心中默念你的问题，命运会给你答案</div>
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

            <section
              class="card stack-card"
              :class="{ active: stackActive === 'funFact', inactive: stackActive !== 'funFact' }"
              :style="{
                background: stackColors[1]
              }"
            >
              <button
                class="stack-head fun-fact-head"
                type="button"
                :disabled="stackActive === 'funFact'"
                @click="setStackActive('funFact')"
              >
                <div class="fun-fact-title">
                  {{ funFactTitle }}
                  <button
                    class="bg-transparent border-none"
                    type="button"
                    :disabled="funFactLoading"
                    @click.stop="openFunFactEditor"
                  >
                    <PencilLine :size="14" />
                  </button>
                </div>
                <div v-if="stackActive === 'funFact'" class="actions">
                  <button
                    class="bg-transparent border-none"
                    type="button"
                    :disabled="funFactLoading || !aiReady"
                    @click.stop="refreshDailyFunFact(true)"
                  >
                    <Sparkles v-if="!loadingSate.daily" :size="16" />
                    <div v-else class="loading-spinner"></div>
                  </button>
                </div>
              </button>

              <div v-show="stackActive === 'funFact'" class="stack-body">
                <div v-if="funFactErrorText" class="error">{{ funFactErrorText }}</div>
                <div v-else class="fun-fact-body">
                  <div class="fun-fact-meta">{{ funFactYmd || funFactTodayYmd }}</div>
                  <div class="fun-fact-text">{{ funFactText || '—' }}</div>
                </div>
              </div>
            </section>
          </div>

          <CustomModuleCard
            v-else-if="customModuleMap.has(itemId)"
            :config="customModuleMap.get(itemId)!"
            :content="getModuleCache(itemId) ?? null"
            :loading="!!customModulesLoading[itemId]"
            :searching="!!customModulesSearching[itemId]"
            :error-text="customModulesError[itemId] || ''"
            :module-id="itemId"
            :is-dragging="draggedModuleId === itemId"
            :is-drag-over="dragOverModuleId === itemId"
            @dragstart="onModuleDragStart"
            @dragover="onModuleDragOver"
            @dragleave="onModuleDragLeave"
            @drop="onModuleDrop"
            @dragend="onModuleDragEnd"
            @refresh="enqueueModuleRefresh(customModuleMap.get(itemId)!)"
            @edit="openEditModuleDialog(customModuleMap.get(itemId)!)"
            @delete="deleteModule(itemId)"
          />
          <section
            v-else-if="itemId === '__add__'"
            class="card add-module-card"
            type="button"
            @click="openAddModuleDialog"
          >
            <div class="add-module-inner">
              <Plus :size="32" />
              <div class="add-module-text">添加模块</div>
            </div>
          </section>
        </template>
      </div>
    </div>

    <div class="add-btn-float" :class="{ 'show-in': addBtnVisible }" @click="openAddModuleDialog">
      <Plus :size="24" />
    </div>
  </div>

  <a-modal :open="cityPickerOpen" centered :footer="null" @cancel="closeCityPicker">
    <div class="city-picker">
      <div class="picker-title mb-[10px]">选择城市</div>
      <div v-if="provincesLoading" class="picker-loading">
        <div class="loading-spinner"></div>
      </div>
      <div v-else-if="provincesErrorText" class="error">{{ provincesErrorText }}</div>
      <div v-else-if="provinceGroups.length === 0" class="empty">暂无省份数据</div>
      <div v-else class="province-index-layout">
        <div class="province-index-left">
          <!-- <div class="city-trigger-row">
            <button class="city-trigger-btn" type="button" @click="openCityDropdown">
              城市：{{ chosenCityName || '点击选择' }}
            </button>
          </div> -->

          <div ref="provinceListEl" class="province-index-list">
            <div
              v-for="g in provinceGroups"
              :key="g.letter"
              class="province-group"
              :data-letter="g.letter"
            >
              <div class="province-group-head">{{ g.letter }}</div>
              <div class="province-group-grid">
                <button
                  v-for="p in g.items"
                  :key="p.id"
                  class="province-btn"
                  :class="{ active: p.id === provCode }"
                  type="button"
                  @click="selectProvince(p.id)"
                >
                  {{ p.name }}
                </button>
              </div>
            </div>
          </div>
          <div class="province-letter-index" aria-hidden="true">
            <button
              v-for="l in provinceLetters"
              :key="l"
              class="letter-btn"
              type="button"
              @click="scrollToProvinceLetter(l)"
            >
              {{ l }}
            </button>
          </div>

          <div
            v-if="cityDropdownOpen"
            class="city-dropdown-backdrop"
            @click="closeCityDropdown"
          ></div>
          <transition name="city-drop" appear>
            <div v-if="cityDropdownOpen" class="city-pop city-dropdown">
              <div class="city-list-head">城市</div>
              <div v-if="citiesLoading" class="picker-loading">
                <div class="loading-spinner"></div>
              </div>
              <div v-else-if="citiesErrorText" class="error">{{ citiesErrorText }}</div>
              <template v-else>
                <div class="city-search mb-[10px]">
                  <a-input
                    v-model:value="cityQuery"
                    allow-clear
                    placeholder="搜索城市（名称/代码）"
                  />
                </div>
                <div v-if="filteredCities.length === 0" class="empty">没有匹配的城市</div>
                <div v-else class="city-grid">
                  <button
                    v-for="c in filteredCities"
                    :key="c.id"
                    class="city-btn"
                    :class="{ active: c.id === chosenCityId }"
                    type="button"
                    @click="selectCity(c.id)"
                  >
                    {{ c.name }}
                  </button>
                </div>
              </template>
            </div>
          </transition>
        </div>
      </div>
      <div class="picker-actions mt-[10px]">
        <a-button @click="closeCityPicker">关闭</a-button>
      </div>
    </div>
  </a-modal>

  <a-modal :open="paydayDialogOpen" centered :footer="null" @cancel="closePaydayDialog">
    <div class="picker-title">设置发薪日</div>
    <div class="payday-form mt-[10px]">
      <span class="payday-label">每月</span>
      <a-input v-model:value="paydayInput" class="payday-input" type="number" />
      <span class="payday-label">日</span>
    </div>
    <div class="hint mt-[10px]">范围 1-31，超过当月天数会按当月最后一天算</div>
    <div class="picker-actions">
      <a-button @click="closePaydayDialog">取消</a-button>
      <a-button type="primary" @click="savePaydayDay">保存</a-button>
    </div>
  </a-modal>

  <a-modal
    :open="funFactEditOpen"
    :width="560"
    centered
    :mask-closable="!funFactEditSaving"
    :keyboard="!funFactEditSaving"
    :closable="!funFactEditSaving"
    :footer="null"
    @cancel="closeFunFactEditor"
  >
    <div class="picker-title">编辑冷知识</div>
    <div class="funfact-form">
      <div class="funfact-field">
        <div class="funfact-label">标题</div>
        <a-input v-model:value="funFactTitleDraft" placeholder="例如：每日冷知识" />
      </div>
      <div class="funfact-field">
        <div class="funfact-label">提示词</div>
        <a-textarea
          v-model:value="funFactPromptDraft"
          class="funfact-textarea"
          :rows="6"
          placeholder="支持变量：{ymd}、{title}"
        />
        <div class="hint">支持变量：{ymd}（日期）、{title}（标题）。</div>
      </div>
      <div v-if="funFactEditErrorText" class="error">{{ funFactEditErrorText }}</div>
    </div>
    <div class="picker-actions">
      <a-button :disabled="funFactEditSaving" @click="closeFunFactEditor">取消</a-button>
      <a-button type="primary" :loading="funFactEditSaving" @click="saveFunFactEditor"
        >保存</a-button
      >
    </div>
  </a-modal>

  <ModuleDialog
    :open="moduleDialogOpen"
    :mode="moduleDialogMode"
    :initial-name="moduleDialogInitial.name"
    :initial-type="moduleDialogInitial.type"
    :initial-prompt="moduleDialogInitial.prompt"
    :initial-web-search="moduleDialogInitial.webSearch"
    :initial-min-height="moduleDialogInitial.minHeight"
    :initial-enable-markdown="moduleDialogInitial.enableMarkdown"
    :initial-update-frequency="moduleDialogInitial.updateFrequency"
    @close="moduleDialogOpen = false"
    @saved="handleModuleSaved"
  />

  <a-drawer
    :open="moduleVisibilityDrawerOpen"
    title="模块显示设置"
    placement="right"
    :width="320"
    @close="moduleVisibilityDrawerOpen = false"
  >
    <div class="module-visibility-list">
      <div v-for="id in BUILTIN_MODULE_IDS" :key="id" class="module-visibility-item">
        <div class="flex items-center gap-[10px]">
          <component
            :is="BUILTIN_MODULE_LABELS[id].icon"
            :size="16"
            class="module-visibility-icon"
          />
          <span class="module-visibility-label">{{ BUILTIN_MODULE_LABELS[id].title || id }}</span>
        </div>

        <AppSwitch
          :model-value="moduleVisibility[id]"
          @update:model-value="toggleModuleVisibility(id)"
        />
      </div>
    </div>
  </a-drawer>
</template>

<style lang="scss" scoped>
.ant-segmented {
  background: #2d2d2d;
  font-size: smaller;
}
.ant-segmented .ant-segmented-item-selected {
  background: #2d2d2d;
}

.border-none {
  border: none;
}

.page-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* height: 100%; */
  overflow-y: visible;
  /* 隐藏滚动条 */
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
}

.picker-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
}

.city-search {
  margin-bottom: 10px;
}

.empty {
  padding: 10px 0;
  color: rgba(0, 0, 0, 0.45);
  text-align: center;
}

.province-index-layout {
  display: flex;
  gap: 12px;
  max-height: 70vh;
  overflow: hidden;
}

.province-index-left {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  height: 70vh;
}

.province-index-list {
  flex: 1 1 auto;
  overflow: auto;
  padding-right: 24px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.province-index-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.province-group {
  padding-bottom: 10px;
}

.province-group-head {
  font-size: 12px;
  font-weight: 700;
  opacity: 0.65;
  padding: 6px 0;
}

.province-group-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.province-letter-index {
  position: absolute;
  right: 2px;
  top: 44px;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0;
}

.letter-btn {
  border: none;
  background: none;
  padding: 2px 4px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.7;
}

.letter-btn:hover {
  opacity: 1;
}

.city-pop {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(48, 48, 48, 0.96);
  border-radius: 12px;
  padding: 10px;
  box-shadow:
    0 18px 55px rgba(0, 0, 0, 0.45),
    0 2px 0 rgba(255, 255, 255, 0.04) inset;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.city-dropdown-backdrop {
  position: absolute;
  inset: 0;
  z-index: 9;
}

.city-dropdown {
  position: absolute;
  left: 0;
  right: 24px;
  top: 44px;
  bottom: 0;
  z-index: 10;
}

.city-trigger-row {
  flex: none;
  padding: 0 24px 10px 0;
}

.city-trigger-btn {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(235, 235, 245, 0.92);
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.city-trigger-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.city-trigger-btn:active {
  transform: translateY(1px);
}

.city-drop-enter-active,
.city-drop-leave-active {
  transition:
    transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 170ms ease;
  will-change: transform, opacity;
}

.city-drop-enter-from,
.city-drop-leave-to {
  transform: translateY(-12px);
  opacity: 0;
}

.city-drop-enter-to,
.city-drop-leave-from {
  transform: translateY(0);
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .city-drop-enter-active,
  .city-drop-leave-active {
    transition: none;
  }
}

.province-btn {
  border: none;
  background: none;
  border-radius: 10px;
  padding: 10px 8px;
  font-size: 13px;
  line-height: 1.1;
  cursor: pointer;
  transition:
    transform 80ms ease,
    border-color 120ms ease,
    background 120ms ease;
}

.province-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}

.province-btn.active {
  color: rgba(22, 119, 255, 0.832);
  /* border-color: rgba(22, 119, 255, 0.55); */
  /* background: rgba(22, 119, 255, 0.08); */
}

.city-list-head {
  font-size: 13px;
  /* color: rgba(0, 0, 0, 0.65); */
}

.city-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding-right: 2px;
}

.city-dropdown .city-grid {
  flex: 1 1 auto;
  overflow: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.city-dropdown .city-grid::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.city-btn {
  border: none;
  background: none;
  border-radius: 10px;
  padding: 10px 8px;
  font-size: 13px;
  line-height: 1.1;
  cursor: pointer;
  transition:
    transform 80ms ease,
    border-color 120ms ease,
    background 120ms ease;
}

.city-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}

.city-btn.active {
  /* border-color: rgba(22, 119, 255, 0.55);
  background: rgba(22, 119, 255, 0.08); */
  color: rgba(22, 119, 255, 0.832);
}

.header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  gap: 4px;
}

.ctrl-btns {
  display: flex;
  align-items: center;
  gap: 8px;

  .module-visibility-btn {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    border: 1px solid rgba(180, 180, 180, 0.308);
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
  }

  .avatar-box {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background-color: #f5f5f5bb;
  }
}

.module-visibility-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.module-visibility-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  transition: background 0.15s ease;
}

.module-visibility-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.module-visibility-label {
  font-size: 14px;
  font-weight: 500;
  color: rgba(235, 235, 245, 0.92);
}

.title {
  font-size: 28px;
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
  /* border: 1px solid rgba(255, 255, 255, 0.08); */
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
  z-index: 1;
  flex: 1;

  &.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
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
  top: -7rem;
  font-size: 10rem;
  z-index: 2;
  /* line-height: 1; */
  display: flex;
  align-items: center;
  justify-content: center;
  /* opacity: 1; */
  pointer-events: auto;
  user-select: none;
  animation: emoji-bounce 5.5s infinite;
  transition: transform 0.26s cubic-bezier(0.2, 0.7, 0.2, 1);
  touch-action: none;
  cursor: grab;
}

.weather-emoji.is-dragging {
  animation-play-state: paused;
  transition: none;
  cursor: grabbing;
}

.weather-emoji.is-loading {
  animation-play-state: paused;
  cursor: default;
}

.weather-emoji-spinner {
  width: 50px;
  height: 50px;
  border: 8px solid rgba(255, 255, 255, 0.22);
  border-top-color: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

.weather-content {
  position: relative;
  z-index: 1;
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
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 1;
}

.picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1;
}

.picker-card {
  width: min(420px, calc(100vw - 64px));
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 18px;
  background: rgb(0 0 0 / 58%);
  color: var(--ev-c-text-1);
  z-index: 10001;
  display: flex;
  flex-direction: column;
  gap: 12px;
  top: 10%;
  position: absolute;
  z-index: 2;
}

.funfact-editor-card {
  width: min(560px, calc(100vw - 64px));
}

.funfact-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.funfact-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.funfact-label {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.72);
  font-weight: 700;
}

.funfact-textarea {
  min-height: 140px;
  resize: vertical;
  line-height: 18px;
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
  height: 230px;
  align-self: flex-start;
  padding: 14px;
  gap: 12px;
}

.stack-tool-wrap {
  height: 240px;
  flex: auto;
  position: relative;
  --stack-head-h: 20px;
  --stack-offset: 48px;
}

.stack-card {
  position: absolute;
  inset: 0;
  padding: 14px;
  gap: 12px;
  background: #0a0a0a;
  height: 180px;
  transition:
    transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
    clip-path 220ms ease,
    filter 220ms ease;
}

.stack-card.active {
  transform: translateY(var(--stack-offset));
  z-index: 2;
}

.stack-card.inactive {
  transform: /*translateY(0)*/ translateY(0) scale(0.95);
  z-index: 1;
  /* clip-path: inset(0 0 calc(100% - var(--stack-head-h)) 0 round 12px); */
}

.stack-head {
  width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  min-height: var(--stack-head-h);
}

.stack-head:disabled {
  cursor: default;
}

.stack-body {
  flex: 1;
  min-height: 0;
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
  display: flex;
  align-items: center;
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
  max-height: 86px;
  overflow-y: scroll;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
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
  /* border: 1px solid rgba(255, 255, 255, 0.08); */
  /* background: rgba(255, 255, 255, 0.03); */
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 12px;
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
  /* border: 1px solid rgba(255, 255, 255, 0.08); */
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

.city-picker :deep(.lazy-cascader) {
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
  flex: auto;
  flex-grow: 0;
  // min-width: 350px;
}
.right-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  // width: 300px;
}

.block {
  position: relative;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
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
  /* border: 1px solid rgba(144, 238, 144, 0.25); */
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

.legend-item {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(235, 235, 245, 0.72);
  font-size: 12px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 999px;
  cursor: pointer;
}

.legend-item:hover {
  border-color: rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.1);
}

.legend-item.active {
  border-color: rgba(0, 220, 255, 0.35);
  background: rgba(0, 220, 255, 0.14);
  color: rgba(235, 235, 245, 0.9);
}

.lg {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(235, 235, 245, 0.72);

  &.temperatureC {
    background-color: rgba(0, 221, 255, 0.3);
    border-color: rgba(0, 220, 255, 0.25);
    &.active {
      background-color: rgba(0, 220, 255, 0.95);
      border-color: rgba(0, 220, 255, 0.25);
      box-shadow: 0 0 0 2px rgba(0, 220, 255, 0.3);
    }
  }
  &.precipitationMm {
    background-color: rgba(60, 180, 120, 0.3);
    border-color: rgba(60, 180, 120, 0.25);
    &.active {
      background-color: rgba(60, 180, 120, 0.95);
      border-color: rgba(60, 180, 120, 0.25);
      box-shadow: 0 0 0 2px rgba(60, 180, 120, 0.3);
    }
  }
  &.windSpeedMs {
    background-color: rgba(255, 198, 0, 0.3);
    border-color: rgba(255, 198, 0, 0.25);
    &.active {
      background-color: rgba(255, 198, 0, 0.95);
      border-color: rgba(255, 198, 0, 0.25);
      box-shadow: 0 0 0 2px rgba(255, 198, 0, 0.3);
    }
  }
  &.humidityPercent {
    background-color: rgba(180, 140, 255, 0.3);
    border-color: rgba(180, 140, 255, 0.25);
    &.active {
      background-color: rgba(180, 140, 255, 0.95);
      border-color: rgba(180, 140, 255, 0.25);
      box-shadow: 0 0 0 2px rgba(180, 140, 255, 0.3);
    }
  }
  &.cloudPercent {
    background-color: rgba(255, 120, 120, 0.3);
    border-color: rgba(255, 120, 120, 0.25);
    &.active {
      background-color: rgba(255, 120, 120, 0.95);
      border-color: rgba(255, 120, 120, 0.25);
      box-shadow: 0 0 0 2px rgba(255, 120, 120, 0.3);
    }
  }
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

.custom-modules-grid {
  column-width: 320px;
  column-gap: 12px;
}

.custom-modules-grid > * {
  break-inside: avoid;
  margin-bottom: 12px;
}

.custom-modules-grid :deep(.is-dragging) {
  opacity: 0.35;
}

.custom-modules-grid :deep(.is-drag-over) {
  outline: 2px solid rgba(60, 130, 255, 0.65);
  outline-offset: -1px;
  border-radius: 12px;
}

.add-module-card {
  width: min(360px, 100%);
  min-height: 180px;
  align-self: flex-start;
  padding: 14px;
  gap: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.add-module-card:hover {
  border-color: rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.06);
}

.add-module-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgba(235, 235, 245, 0.62);
}

.add-module-text {
  font-size: 13px;
  font-weight: 700;
}

@media (max-width: 900px) {
  .weather-layout {
    grid-template-columns: 1fr;
  }
}

.add-btn-float {
  position: fixed;
  z-index: 1000;
  bottom: -80px;
  left: 50%;
  transform: translateX(-50%);
  background-color: var(--ev-c-theme);
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;

  &.show-in {
    bottom: 24px;
  }

  &:hover {
    box-shadow: 0 0 0 2px rgba(0, 220, 255, 0.3);
  }
}
</style>
