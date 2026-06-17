// 生成唯一的 AI 流 ID，用于取消和流管理
export function createAiStreamId(): string {
  const a = Date.now()
  const b = Math.random().toString(16).slice(2)
  return `${a}-${b}`
}
