<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { WeatherDayForecast } from '@shared/weather'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  days: WeatherDayForecast[]
}>()

const elRef = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

const seriesData = computed(() => {
  const days = (props.days ?? []).slice(0, 7)
  const x = days.map((d) => d.weekText)
  const high = days.map((d) => (typeof d.highC === 'number' ? d.highC : null))
  const low = days.map((d) => (typeof d.lowC === 'number' ? d.lowC : null))
  const all = [...high, ...low].filter((v): v is number => typeof v === 'number')
  const min = all.length ? Math.min(...all) : 0
  const max = all.length ? Math.max(...all) : 0
  const pad = Math.max(1, Math.round((max - min) * 0.15))
  return { x, high, low, min: min - pad, max: max + pad }
})

function buildOption(): EChartsOption {
  const d = seriesData.value
  const text1 = 'rgba(235, 235, 245, 0.72)'
  const text2 = 'rgba(235, 235, 245, 0.55)'
  const split = 'rgba(255, 255, 255, 0.08)'
  const highColor = 'rgba(0, 220, 255, 0.95)'
  const lowColor = 'rgba(180, 140, 255, 0.95)'

  return {
    backgroundColor: 'transparent',
    animation: true,
    grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: false },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(22, 22, 26, 0.92)',
      borderColor: 'rgba(255, 255, 255, 0.12)',
      borderWidth: 1,
      textStyle: { color: text1, fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: split } }
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: d.x,
      axisLine: { lineStyle: { color: split } },
      axisTick: { show: false },
      axisLabel: { color: text2, fontSize: 11 }
    },
    yAxis: {
      type: 'value',
      min: d.min,
      max: d.max,
      splitNumber: 3,
      axisLine: { show: false },
      axisTick: { show: true },
      axisLabel: { color: text2, fontSize: 11, formatter: (v: number) => `${Math.round(v)}°` },
      splitLine: { lineStyle: { color: split } }
    },
    series: [
      {
        name: '高温',
        type: 'line',
        data: d.high,
        smooth: true,
        connectNulls: false,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2, color: highColor },
        itemStyle: { color: highColor },
        label: {
          show: true,
          position: 'top',
          color: highColor,
          fontSize: 11,
          fontWeight: 700,
          formatter: (p: { value: unknown }) =>
            typeof p.value === 'number' ? `${Math.round(p.value)}°` : ''
        }
      },
      {
        name: '低温',
        type: 'line',
        data: d.low,
        smooth: true,
        connectNulls: false,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2, color: lowColor },
        itemStyle: { color: lowColor },
        label: {
          show: true,
          position: 'bottom',
          color: lowColor,
          fontSize: 11,
          fontWeight: 700,
          formatter: (p: { value: unknown }) =>
            typeof p.value === 'number' ? `${Math.round(p.value)}°` : ''
        }
      }
    ]
  }
}

function render(): void {
  if (!chart) return
  chart.setOption(buildOption(), { notMerge: true, lazyUpdate: false })
}

onMounted(() => {
  if (!elRef.value) return
  chart = echarts.init(elRef.value, undefined, { renderer: 'canvas' })
  render()
  ro = new ResizeObserver(() => chart?.resize())
  ro.observe(elRef.value)
})

onUnmounted(() => {
  ro?.disconnect()
  ro = null
  chart?.dispose()
  chart = null
})

watch(seriesData, () => render(), { deep: true })
</script>

<template>
  <div class="chart-wrap">
    <div ref="elRef" class="chart" />
  </div>
</template>

<style scoped>
.chart-wrap {
  width: 100%;
  aspect-ratio: 1 / 1;
  max-height: 130px;
}

.chart {
  width: 100%;
  height: 100%;
}
</style>
