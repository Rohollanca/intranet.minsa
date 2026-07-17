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
      '/bot-api/convert-docx-to-pdf': {
        target: 'https://intranet-api.alisadata.lat',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/bot-api/, ''),
      },
      '/bot-api': {
        target: 'https://api.alisadata.lat',
        changeOrigin: true,
        secure: true,
        headers: {
          Origin: 'https://alisadata.lat',
          Referer: 'https://alisadata.lat/',
          'User-Agent': 'Mozilla/5.0',
        },
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
