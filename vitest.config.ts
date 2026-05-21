import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  resolve: {
    alias: {
      '@root': '/',
      '@main-shared': resolve(__dirname, 'src/main/shared')
    }
  },
  plugins: [vue()],
  server: {
    port: 65015
  }
})
