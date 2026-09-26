import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const backendUrl = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8080'
const wsBackendUrl = backendUrl.replace(/^http/, 'ws')
const comfyUrl = process.env.VITE_COMFY_URL || 'http://127.0.0.1:8188'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: wsBackendUrl,
        ws: true,
      },
      '/api': {
        target: backendUrl,
        changeOrigin: true,
      },
      // Only used when VITE_BACKEND_URL is empty (direct ComfyUI fallback).
      '/comfy': {
        target: comfyUrl,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/comfy/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
