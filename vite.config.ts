import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = process.env.VITE_BASE_PATH ?? '/'

export default defineConfig({
  base,
  resolve: { alias: { '@': path.resolve(fileURLToPath(new URL('.', import.meta.url)), './src') } },
  plugins: [
    tanstackRouter({ autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.svg'],
      manifest: {
        name: 'Our Groceries',
        short_name: 'Groceries',
        description: 'A calm shared grocery list',
        theme_color: '#f6f1e7',
        background_color: '#f6f1e7',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: `${base}icons/icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          {
            src: `${base}icons/icon-maskable.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        runtimeCaching: [],
        cleanupOutdatedCaches: true
      }
    })
  ],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'motion'],
          'vendor-data': [
            '@tanstack/react-query',
            '@tanstack/react-router',
            '@supabase/supabase-js'
          ],
          'vendor-ui': [
            '@base-ui/react',
            '@phosphor-icons/react',
            'i18next',
            'react-i18next',
            'dayjs'
          ]
        }
      }
    }
  }
})
