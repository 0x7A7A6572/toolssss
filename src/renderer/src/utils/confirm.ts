import { Modal } from 'ant-design-vue'

export interface ConfirmOptions {
  title?: string
  confirmText?: string
  cancelText?: string
}

export default function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    Modal.confirm({
      title: options.title ?? '确认操作',
      content: message,
      okText: options.confirmText ?? '确定',
      cancelText: options.cancelText ?? '取消',
      centered: true,
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
}
