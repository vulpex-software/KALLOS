import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    // Escucha en todas las interfaces de red (no solo localhost) para
    // poder abrir la app desde el celular u otro equipo de la misma red
    // de casa, ej. http://192.168.1.9:5173 -- ajusta esa IP si cambia
    // (Windows: Get-NetIPAddress, o `ipconfig`).
    host: true
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.png', 'logo.png'],
      injectManifest: {
        // El manual de uso es un archivo estático aparte de la SPA.
        globIgnores: ['manual.html'],
      },
      manifest: {
        name: 'KALLOS - Software para salones de belleza',
        short_name: 'KALLOS',
        description: 'Gestión de citas, caja, inventario y personal para salones de belleza',
        theme_color: '#0b0b0d',
        background_color: '#0b0b0d',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
})
