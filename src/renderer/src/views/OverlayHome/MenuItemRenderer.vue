<template>
  <a-sub-menu v-if="item.children" :key="`sub-${item.id}`">
    <template #icon>
      <component :is="item.icon" size="15" />
    </template>
    <template #title
      ><span>{{ item.label }}</span></template
    >
    <MenuItemRenderer v-for="child in item.children" :key="child.id" :item="child" />
  </a-sub-menu>
  <a-menu-item v-else :key="`item-${item.id}`">
    <template #icon>
      <component :is="item.icon" size="15" />
    </template>
    {{ item.label }}
  </a-menu-item>
</template>
<script lang="ts" setup>
interface TabItem {
  id: string
  label: string
  path: string
  icon: unknown
  showTitle?: boolean
  children?: TabItem[]
}

defineProps<{
  item: TabItem
}>()
</script>
