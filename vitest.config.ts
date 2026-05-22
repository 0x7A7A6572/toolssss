import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@root': '/',
      '@shared': resolve(__dirname, 'src/shared'),
      '@main-shared': resolve(__dirname, 'src/main/shared')
    }
  },
  plugins: [vue()],
  server: {
    port: 65015
  }
})
