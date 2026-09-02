import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The pitch site is served at the root of its own domain
// (demo.veradicai.com), so `base` is "/".
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
