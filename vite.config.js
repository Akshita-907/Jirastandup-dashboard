import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { syncApiPlugin } from './scripts/sync-endpoint.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), syncApiPlugin()],
})
