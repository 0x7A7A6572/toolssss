import { onMounted, onBeforeUnmount, watch, type Ref } from 'vue'
import Sortable from 'sortablejs'

export function useSortableGrid(
  containerRef: Ref<HTMLElement | null>,
  options: {
    items: Ref<string[]>
    onChange: (newOrder: string[]) => void
    disabled?: Ref<boolean>
    filter?: string
  }
): {
  destroy: () => void
} {
  let sortableInstance: Sortable | null = null

  function initSortable(): void {
    if (!containerRef.value) return

    sortableInstance = new Sortable(containerRef.value, {
      animation: 250,
      easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      delay: 150,
      delayOnTouchOnly: true,
      filter: options.filter ?? '.not-sortable',
      disabled: options.disabled?.value ?? false,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: (evt) => {
        if (evt.oldIndex === undefined || evt.newIndex === undefined) return
        if (evt.oldIndex === evt.newIndex) return

        const items = [...options.items.value]
        const [moved] = items.splice(evt.oldIndex, 1)
        items.splice(evt.newIndex, 0, moved)
        options.onChange(items)
      }
    })
  }

  function destroySortable(): void {
    if (sortableInstance) {
      sortableInstance.destroy()
      sortableInstance = null
    }
  }

  watch(
    () => options.disabled?.value,
    (val) => {
      if (sortableInstance) {
        sortableInstance.option('disabled', val ?? false)
      }
    }
  )

  onMounted(() => {
    initSortable()
  })

  onBeforeUnmount(() => {
    destroySortable()
  })

  return {
    destroy: destroySortable
  }
}
