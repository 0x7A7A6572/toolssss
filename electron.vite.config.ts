import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
        '@main-shared': resolve('src/main/shared'),
        '@main-core': resolve('src/main/core'),
        '@libs': resolve('src/libs')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          screenshots: resolve('src/preload/screenshots.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
        '@main-shared': resolve('src/main/shared'),
        '@main-core': resolve('src/main/core'),
        '@libs': resolve('src/libs')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
        '@main-shared': resolve('src/main/shared'),
        '@main-core': resolve('src/main/core'),
        '@libs': resolve('src/libs')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          screenshots: resolve('src/renderer/screenshots.html')
        }
      }
    },
    plugins: [vue()]
  }
})
