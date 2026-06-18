import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/bot-api': {
        target: 'http://localhost:5055',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bot-api/, ''),
        timeout: 60000, // 60 segundos
        proxyTimeout: 60000,
      },
      '/bot-files': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bot-files/, ''),
      }
    }
  }
})
