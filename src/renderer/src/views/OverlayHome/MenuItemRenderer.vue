<template>
  <!-- 一级菜单：仅显示图标，放大，隐藏展开箭头 -->
  <template v-if="isFirstLevel">
    <a-sub-menu v-if="item.children" :key="item.id" :expand-icon="hideExpandIcon">
      <template #icon>
        <component :is="item.icon" size="20" />
      </template>
      <template #title />
      <MenuItemRenderer
        v-for="child in item.children"
        :key="child.id"
        :item="child"
        :level="level + 1"
      />
    </a-sub-menu>
    <a-menu-item v-else :key="item.id">
      <template #icon>
        <component :is="item.icon" size="20" />
      </template>
      <template #title />
    </a-menu-item>
  </template>

  <!-- 深层菜单：显示图标 + 文字 -->
  <template v-else>
    <a-sub-menu v-if="item.children" :key="item.id">
      <template #icon>
        <component :is="item.icon" size="15" />
      </template>
      <template #title
        ><span>{{ item.label }}</span></template
      >
      <MenuItemRenderer
        v-for="child in item.children"
        :key="child.id"
        :item="child"
        :level="level + 1"
      />
    </a-sub-menu>
    <a-menu-item v-else :key="item.id">
      <template #icon>
        <component :is="item.icon" size="15" />
      </template>
      {{ item.label }}
    </a-menu-item>
  </template>
</template>
<script lang="ts" setup>
import { computed } from 'vue'

interface TabItem {
  id: string
  label: string
  path: string
  icon: unknown
  showTitle?: boolean
  children?: TabItem[]
}

const props = withDefaults(
  defineProps<{
    item: TabItem
    level?: number
  }>(),
  {
    level: 1
  }
)

const isFirstLevel = computed(() => props.level === 1)

/** 返回 null 以隐藏一级子菜单的展开箭头 */
function hideExpandIcon(): null {
  return null
}
</script>
