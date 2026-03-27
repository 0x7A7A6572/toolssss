import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const api = {}
const electronAPI = {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
      ipcRenderer.invoke(channel, ...args),
    send: (channel: string, ...args: unknown[]): void => ipcRenderer.send(channel, ...args),
    on: (
      channel: string,
      listener: (event: IpcRendererEvent, ...args: unknown[]) => void
    ): void => {
      ipcRenderer.on(channel, listener)
    },
    once: (
      channel: string,
      listener: (event: IpcRendererEvent, ...args: unknown[]) => void
    ): void => {
      ipcRenderer.once(channel, listener)
    },
    removeListener: (
      channel: string,
      listener: (event: IpcRendererEvent, ...args: unknown[]) => void
    ): void => {
      ipcRenderer.removeListener(channel, listener)
    },
    removeAllListeners: (channel: string): void => {
      ipcRenderer.removeAllListeners(channel)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
