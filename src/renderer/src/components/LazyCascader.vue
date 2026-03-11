<template>
  <div ref="cascaderRef" class="lazy-cascader">
    <!-- 输入框区域 -->
    <div class="cascader-input" :class="{ 'is-open': isOpen }" @click="toggleDropdown">
      <span v-if="!selectedLabels.length" class="placeholder">请选择...</span>
      <span v-else class="selected-text">{{ selectedLabels.join(' / ') }}</span>
      <span class="arrow">▼</span>
    </div>

    <!-- 下拉面板 -->
    <div v-show="isOpen" class="cascader-dropdown">
      <div class="cascader-panel-container">
        <!-- 递归渲染每一列 -->
        <div v-for="(level, index) in optionsStack" :key="index" class="cascader-panel">
          <div
            v-for="node in level"
            :key="String(node[props.propsConfig.value] ?? node[props.propsConfig.label] ?? '')"
            class="cascader-option"
            :class="{
              'is-active': isActive(node, index),
              'is-loading': node.loading,
              'is-disabled': node.disabled
            }"
            @click="handleNodeClick(node, index)"
          >
            {{ node.label }}
            <!-- 加载图标 -->
            <span v-if="node.loading" class="loading-icon">↻</span>
            <!-- 有子节点的箭头 -->
            <span v-else-if="hasChildren(node)" class="children-arrow">›</span>
          </div>
        </div>

        <!-- 空数据提示 -->
        <div v-if="optionsStack.length === 0" class="empty-data">暂无数据</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

type Node = {
  [key: string]: unknown
  label?: string
  value?: unknown
  children?: Node[]
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

const isOpen = ref(false)
const cascaderRef = ref<HTMLElement | null>(null)
const optionsStack = ref<Node[][]>([])
const selectedPath = ref<Node[]>([])

// 初始化
onMounted(() => {
  if (props.options.length) {
    optionsStack.value = [props.options]
  }
  // 如果有默认值，需要回显逻辑（此处简化，实际项目中需根据 value 递归查找或请求）
  if (props.modelValue.length && props.lazyLoad) {
    // 回显逻辑较复杂，通常需要配合后端接口或预先加载，这里暂不做深度回显演示
    // 简单场景下，如果第一级数据足够，可以直接匹配
  }
})

// 点击外部关闭
const handleClickOutside = (e: MouseEvent): void => {
  const target = e.target as Node & Element
  if (cascaderRef.value && !cascaderRef.value.contains(target)) {
    isOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', handleClickOutside))
onUnmounted(() => document.removeEventListener('click', handleClickOutside))

const toggleDropdown = (): void => {
  isOpen.value = !isOpen.value
  if (isOpen.value && optionsStack.value.length === 0 && props.options.length) {
    optionsStack.value = [props.options]
  }
}

// 判断是否有子节点（静态或已加载）
const hasChildren = (node: Node): boolean => {
  const key = props.propsConfig.children
  const children = node[key] as Node[] | undefined
  return Array.isArray(children) && children.length > 0
}

const shouldLazyLoadAtLevel = (levelIndex: number): boolean => {
  const v = props.lazyLoadLevel
  if (Array.isArray(v)) return v.includes(levelIndex)
  return levelIndex === v
}

// 处理节点点击
const handleNodeClick = async (node: Node, levelIndex: number): Promise<void> => {
  if (node.disabled) return

  // 更新选中路径
  selectedPath.value = selectedPath.value.slice(0, levelIndex)
  selectedPath.value.push(node)

  // 更新面板显示
  optionsStack.value = optionsStack.value.slice(0, levelIndex + 1)

  const childrenKey = props.propsConfig.children

  // 情况 A: 有静态子节点 -> 直接展示下一级
  if (hasChildren(node)) {
    optionsStack.value.push(node[childrenKey] as Node[])
  }
  // 情况 B: 配置了懒加载且没有子节点 -> 触发懒加载
  else if (props.lazyLoad && !node[childrenKey] && shouldLazyLoadAtLevel(levelIndex)) {
    node.loading = true // 标记加载中
    try {
      await props.lazyLoad(node, (children: Node[]) => {
        node[childrenKey] = children // 将加载的数据挂载到节点上
        optionsStack.value.push(children)
        node.loading = false
      })
    } catch (error) {
      node.loading = false
      console.error('Lazy load failed', error)
    }
  }
  // 情况 C: 叶子节点 -> 完成选择
  else {
    finishSelection()
  }
}

// 完成选择
const finishSelection = (): void => {
  const valuePath = selectedPath.value.map((n) => n[props.propsConfig.value] as unknown)
  const labelPath = selectedPath.value.map((n) => n[props.propsConfig.label] as string)

  emit('update:modelValue', valuePath)
  emit('change', { value: valuePath, labels: labelPath, selectedNodes: selectedPath.value })
  isOpen.value = false
}

// 判断节点是否高亮
const isActive = (node: Node, levelIndex: number): boolean => {
  return (
    selectedPath.value[levelIndex] &&
    selectedPath.value[levelIndex][props.propsConfig.value] === node[props.propsConfig.value]
  )
}

// 计算显示的标签
const selectedLabels = computed<string[]>(() => {
  return selectedPath.value.map((n) => n[props.propsConfig.label] as string)
})
</script>

<style scoped>
.lazy-cascader {
  position: relative;
  min-width: 180px;
  color: var(--ev-c-text-1);
}

.cascader-input {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition:
    border-color 0.2s,
    background 0.2s;
  font-size: 12px;
  line-height: 16px;
  user-select: none;
}

.cascader-input:hover,
.cascader-input.is-open {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
}

.placeholder {
  color: rgba(235, 235, 245, 0.5);
}
.selected-text {
  color: var(--ev-c-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.arrow {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.6);
  transform: rotate(0deg);
  transition: transform 0.2s;
}
.is-open .arrow {
  transform: rotate(180deg);
}

.cascader-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: rgba(22, 22, 26, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
  z-index: 1000;
  min-width: 100%;
  overflow: hidden;
}

.cascader-panel-container {
  display: flex;
}

.cascader-panel {
  min-width: 150px;
  max-height: 300px;
  overflow-y: auto;
  padding: 6px 0;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
}
.cascader-panel:last-child {
  border-right: none;
}

.cascader-option {
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--ev-c-text-1);
}

.cascader-option:hover {
  background: rgba(255, 255, 255, 0.08);
}
.cascader-option.is-active {
  background: rgba(255, 255, 255, 0.12);
}
.cascader-option.is-disabled {
  color: rgba(235, 235, 245, 0.35);
  cursor: not-allowed;
}
.cascader-option.is-disabled:hover {
  background: none;
}

.children-arrow {
  font-size: 16px;
  color: rgba(235, 235, 245, 0.55);
}
.loading-icon {
  animation: spin 1s linear infinite;
  font-size: 14px;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.empty-data {
  padding: 20px;
  text-align: center;
  color: rgba(235, 235, 245, 0.55);
}
</style>
