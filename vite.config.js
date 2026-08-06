import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base path must match your GitHub repo name for GitHub Pages to work.
export default defineConfig({
  plugins: [react()],
  base: '/impi-deployment/',
})
