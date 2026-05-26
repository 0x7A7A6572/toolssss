<template>
  <a-cascader
    class="lazy-cascader"
    :value="props.modelValue"
    :options="preparedOptions"
    :field-names="fieldNames"
    :load-data="props.lazyLoad ? loadData : undefined"
    placeholder="请选择..."
    @change="onChange"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

type Node = {
  [key: string]: unknown
  label?: unknown
  value?: unknown
  children?: Node[]
  isLeaf?: boolean
  disabled?: boolean
  loading?: boolean
}
type PropsConfig = { label: string; value: string; children: string; disabled: string }
type LazyLoadFn = (node: Node, resolve: (children: Node[]) => void) => void | Promise<void>

const props = withDefaults(
  defineProps<{
    modelValue?: unknown[]
    options?: Node[]
    lazyLoad?: LazyLoadFn
    lazyLoadLevel?: number | number[]
    propsConfig?: PropsConfig
  }>(),
  {
    modelValue: () => [],
    options: () => [],
    lazyLoad: undefined,
    lazyLoadLevel: 0,
    propsConfig: () => ({
      label: 'label',
      value: 'value',
      children: 'children',
      disabled: 'disabled'
    })
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: unknown[]): void
  (e: 'change', payload: { value: unknown[]; labels: string[]; selectedNodes: Node[] }): void
}>()

const fieldNames = computed(() => ({
  label: props.propsConfig.label,
  value: props.propsConfig.value,
  children: props.propsConfig.children
}))

function shouldLazyLoadAtLevel(levelIndex: number): boolean {
  const v = props.lazyLoadLevel
  if (Array.isArray(v)) return v.includes(levelIndex)
  return levelIndex === v
}

function prepareOptions(options: Node[] | undefined, depth: number): Node[] {
  const list = Array.isArray(options) ? options : []
  const childrenKey = props.propsConfig.children
  const disabledKey = props.propsConfig.disabled
  for (const n of list) {
    if (disabledKey !== 'disabled') {
      n.disabled = Boolean(n[disabledKey])
    }

    const children = n[childrenKey] as Node[] | undefined
    if (Array.isArray(children) && children.length) {
      n.isLeaf = false
      prepareOptions(children, depth + 1)
      continue
    }

    if (props.lazyLoad && shouldLazyLoadAtLevel(depth)) {
      n.isLeaf = false
      continue
    }

    n.isLeaf = true
  }
  return list
}

const preparedOptions = computed(() => prepareOptions(props.options, 0))

async function loadData(selectedOptions: Node[]): Promise<void> {
  if (!props.lazyLoad) return
  const targetOption = selectedOptions[selectedOptions.length - 1]
  if (!targetOption) return
  const levelIndex = Math.max(0, selectedOptions.length - 1)
  if (!shouldLazyLoadAtLevel(levelIndex)) return

  const childrenKey = props.propsConfig.children
  const children = targetOption[childrenKey] as Node[] | undefined
  if (Array.isArray(children) && children.length) return

  targetOption.loading = true
  try {
    await props.lazyLoad(targetOption, (nextChildren: Node[]) => {
      targetOption.loading = false
      targetOption[childrenKey] = nextChildren
      prepareOptions(nextChildren, levelIndex + 1)
    })
  } catch {
    targetOption.loading = false
  }
}

function onChange(value: unknown[] | undefined, selectedOptions: Node[] | undefined): void {
  const v = Array.isArray(value) ? value : []
  const nodes = Array.isArray(selectedOptions) ? selectedOptions : []
  const labels = nodes.map((n) => String(n[props.propsConfig.label] ?? ''))
  emit('update:modelValue', v)
  emit('change', { value: v, labels, selectedNodes: nodes })
}
</script>
