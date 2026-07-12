import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      manifest: {
        name: 'Messenger',
        short_name: 'Messenger',
        description: 'Свой мессенджер — устанавливаемое веб-приложение',
        theme_color: '#05060a',
        background_color: '#05060a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/auth': 'http://localhost:4000',
      '/users': 'http://localhost:4000',
      '/conversations': 'http://localhost:4000',
      '/upload': 'http://localhost:4000',
      '/push': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
      '/link-preview': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
})
