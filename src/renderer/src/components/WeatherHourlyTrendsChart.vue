<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { WeatherHourlyTrends } from '@shared/weather'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

export type HourlyMetricKey =
  | 'temperatureC'
  | 'precipitationMm'
  | 'windSpeedMs'
  | 'humidityPercent'
  | 'cloudPercent'

const props = defineProps<{
  trends: WeatherHourlyTrends
  activeKey: HourlyMetricKey | null
}>()

const elRef = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

type MetricDef = {
  key: HourlyMetricKey
  name: string
  unit: string
  color: string
  data: Array<number | null>
}

const metrics = computed<MetricDef[]>(() => {
  const t = props.trends
  return [
    {
      key: 'temperatureC',
      name: '气温',
      unit: '℃',
      color: 'rgba(0, 220, 255, 0.95)',
      data: t.temperatureC
    },
    {
      key: 'precipitationMm',
      name: '降水',
      unit: 'mm',
      color: 'rgba(60, 180, 120, 0.95)',
      data: t.precipitationMm
    },
    {
      key: 'windSpeedMs',
      name: '风速',
      unit: 'm/s',
      color: 'rgba(255, 198, 0, 0.95)',
      data: t.windSpeedMs
    },
    {
      key: 'humidityPercent',
      name: '湿度',
      unit: '%',
      color: 'rgba(180, 140, 255, 0.95)',
      data: t.humidityPercent
    },
    {
      key: 'cloudPercent',
      name: '云量',
      unit: '%',
      color: 'rgba(255, 120, 120, 0.95)',
      data: t.cloudPercent
    }
  ]
})

function getExtent(values: Array<number | null>): { min: number; max: number } {
  const all = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (all.length === 0) return { min: 0, max: 1 }
  const min = Math.min(...all)
  const max = Math.max(...all)
  const range = Math.max(1e-6, max - min)
  const pad = range * 0.15
  return { min: min - pad, max: max + pad }
}

function buildOption(): EChartsOption {
  const text1 = 'rgba(235, 235, 245, 0.72)'
  const text2 = 'rgba(235, 235, 245, 0.55)'
  const split = 'rgba(255, 255, 255, 0.08)'

  const formatLabel = (v: unknown, unit: string): string => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return ''
    return `${v}${unit}`
  }

  const x = props.trends.times ?? []
  const active = props.activeKey
  const list = active ? metrics.value.filter((m) => m.key === active) : metrics.value

  if (active) {
    const m = list[0]
    const extent = getExtent(m.data)
    return {
      grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        backgroundColor: 'rgba(20, 20, 20, 0.92)',
        borderWidth: 0,
        textStyle: { color: text1, fontSize: 12 }
      },
      xAxis: {
        type: 'category',
        data: x,
        boundaryGap: false,
        axisLine: { lineStyle: { color: split } },
        axisTick: { show: false },
        axisLabel: { color: text2, fontSize: 11 }
      },
      yAxis: {
        type: 'value',
        min: extent.min,
        max: extent.max,
        show: false
      },
      series: [
        {
          type: 'line',
          name: m.name,
          data: m.data.slice(0, x.length),
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 6,
          emphasis: { scale: true },
          label: {
            show: true,
            position: 'top' as const,
            color: text2,
            fontSize: 10,
            formatter: (p: unknown) => formatLabel((p as { value?: unknown } | null)?.value, m.unit)
          },
          smooth: 0.35,
          lineStyle: { width: 2, color: m.color },
          itemStyle: { color: m.color }
        }
      ]
    }
  }

  const yAxis = list.map((m) => {
    const extent = getExtent(m.data)
    return {
      type: 'value' as const,
      min: extent.min,
      max: extent.max,
      show: false
    }
  })

  const series = list.map((m, i) => ({
    type: 'line' as const,
    name: m.name,
    data: m.data.slice(0, x.length),
    yAxisIndex: i,
    showSymbol: true,
    symbol: 'circle' as const,
    symbolSize: 5,
    emphasis: { scale: true },
    label: {
      show: true,
      position: 'top' as const,
      color: text2,
      fontSize: 9,
      formatter: (p: unknown) => formatLabel((p as { value?: unknown } | null)?.value, m.unit)
    },
    smooth: 0.35,
    lineStyle: { width: 2, color: m.color, opacity: 0.9 },
    itemStyle: { color: m.color }
  }))

  return {
    grid: { left: 12, right: 12, top: 10, bottom: 26, containLabel: false },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      backgroundColor: 'rgba(20, 20, 20, 0.92)',
      borderWidth: 0,
      textStyle: { color: text1, fontSize: 12 },
      valueFormatter: (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? String(v) : '—'
    },
    xAxis: {
      type: 'category',
      data: x,
      boundaryGap: false,
      axisLine: { lineStyle: { color: split } },
      axisTick: { show: false },
      axisLabel: { color: text2, fontSize: 11 }
    },
    yAxis,
    series
  }
}

function render(): void {
  if (!chart) return
  chart.setOption(buildOption(), true)
}

onMounted(() => {
  const el = elRef.value
  if (!el) return
  chart = echarts.init(el, undefined, { renderer: 'canvas' })
  render()
  ro = new ResizeObserver(() => chart?.resize())
  ro.observe(el)
})

onUnmounted(() => {
  if (ro && elRef.value) ro.unobserve(elRef.value)
  ro = null
  chart?.dispose()
  chart = null
})

watch(
  () => [props.trends, props.activeKey],
  () => render(),
  { deep: true }
)
</script>

<template>
  <div ref="elRef" class="chart"></div>
</template>

<style scoped>
.chart {
  height: 168px;
  width: 100%;
}
</style>
