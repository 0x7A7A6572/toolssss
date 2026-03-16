import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  resolve: {
    alias: {
      '@root': '/'
    }
  },
  plugins: [vue()],
  test: {
    environment: 'node'
  }
})
