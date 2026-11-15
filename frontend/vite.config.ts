import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // Keep the charting library out of the entry chunk.
        codeSplitting: {
          groups: [
            { name: 'charts', test: /node_modules[\\/](recharts|d3-|victory-vendor)/ },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8082',
        // Keep Host aligned with the browser Origin for same-origin WebSocket
        // validation when accessing Vite through a LAN or Tailscale address.
        changeOrigin: false,
        ws: true,
      },
    },
  },
})
