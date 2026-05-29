<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import type { CustomModuleChartItem } from '@shared/custom-modules'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer
])

const props = defineProps<{
  charts: CustomModuleChartItem[]
}>()

const elRef = ref<HTMLElement | null>(null)
const activeIndex = ref(0)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

const currentChart = computed(() => props.charts[activeIndex.value])

const palette = [
  'rgba(0, 220, 255, 0.9)',
  'rgba(255, 198, 0, 0.9)',
  'rgba(60, 180, 120, 0.9)',
  'rgba(180, 140, 255, 0.9)',
  'rgba(255, 120, 120, 0.9)',
  'rgba(255, 160, 60, 0.9)'
]

function buildOption(): EChartsOption {
  const c = currentChart.value
  if (!c) return {}

  const text1 = 'rgba(235, 235, 245, 0.72)'
  const text2 = 'rgba(235, 235, 245, 0.55)'
  const split = 'rgba(255, 255, 255, 0.08)'

  if (c.type === 'pie') {
    const dataset = c.labels.map((label, i) => ({
      name: label,
      value: c.series[0]?.data[i] ?? 0
    }))
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(20, 20, 20, 0.92)',
        borderWidth: 0,
        textStyle: { color: text1, fontSize: 12 }
      },
      series: [
        {
          type: 'pie',
          radius: ['35%', '65%'],
          center: ['50%', '50%'],
          data: dataset,
          label: {
            color: text2,
            fontSize: 11,
            formatter: '{b}: {d}%'
          },
          labelLine: {
            lineStyle: { color: split }
          },
          itemStyle: {
            borderRadius: 4,
            borderColor: 'rgba(28, 28, 36, 0.8)',
            borderWidth: 2
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.3)'
            }
          }
        }
      ]
    }
  }

  const isBar = c.type === 'bar'
  const series: Record<string, unknown>[] = c.series.map((s, i) => ({
    type: isBar ? 'bar' : 'line',
    name: s.name,
    data: s.data,
    color: s.color || palette[i % palette.length],
    smooth: isBar ? undefined : 0.35,
    barMaxWidth: 32,
    showSymbol: !isBar,
    symbol: 'circle' as const,
    symbolSize: 5,
    emphasis: { scale: true },
    lineStyle: isBar ? undefined : { width: 2 },
    itemStyle: {
      borderRadius: isBar ? [4, 4, 0, 0] : undefined
    }
  }))

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: isBar ? 'shadow' : 'line' },
      backgroundColor: 'rgba(20, 20, 20, 0.92)',
      borderWidth: 0,
      textStyle: { color: text1, fontSize: 12 }
    },
    legend: {
      type: 'scroll',
      bottom: 0,
      textStyle: { color: text2, fontSize: 11 },
      pageTextStyle: { color: text2 },
      pageIconColor: text2,
      pageIconInactiveColor: split
    },
    grid: {
      left: 8,
      right: 8,
      top: 8,
      bottom: 32,
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: c.labels,
      axisLine: { lineStyle: { color: split } },
      axisTick: { show: false },
      axisLabel: { color: text2, fontSize: 11 }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: split } },
      axisLabel: { color: text2, fontSize: 10 }
    },
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
  () => [props.charts, activeIndex.value],
  () => render(),
  { deep: true }
)
</script>

<template>
  <div class="chart-wrapper">
    <div v-if="charts.length > 1" class="chart-tabs">
      <button
        v-for="(c, i) in charts"
        :key="i"
        class="chart-tab"
        :class="{ active: activeIndex === i }"
        type="button"
        :title="c.title"
        @click="activeIndex = i"
      >
        {{ c.title }}
      </button>
    </div>
    <div ref="elRef" class="chart-container"></div>
  </div>
</template>

<style scoped>
.chart-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  flex: 1;
}

.chart-tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  overflow-x: auto;
}

.chart-tab {
  font-size: 11px;
  /* width: 30px; */
  max-width: 60px;
  text-overflow: ellipsis;
  overflow: hidden;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: transparent;
  color: rgba(235, 235, 245, 0.55);
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}

.chart-tab:hover {
  color: rgba(235, 235, 245, 0.8);
  border-color: rgba(255, 255, 255, 0.15);
}

.chart-tab.active {
  color: rgba(0, 220, 255, 0.9);
  border-color: rgba(0, 220, 255, 0.4);
  background: rgba(0, 220, 255, 0.08);
}

.chart-container {
  flex: 1;
  min-height: 200px;
  width: 100%;
}
</style>
