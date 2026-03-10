import { createApp, h } from 'vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

export interface ConfirmOptions {
  title?: string
  confirmText?: string
  cancelText?: string
}

export default function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return new Promise<boolean>((resolve) => {
    const app = createApp({
      render() {
        return h(ConfirmDialog, {
          ...options,
          message,
          onClose(ok: boolean) {
            resolve(Boolean(ok))
            app.unmount()
            if (container.parentNode) container.parentNode.removeChild(container)
          }
        })
      }
    })
    app.mount(container)
  })
}
