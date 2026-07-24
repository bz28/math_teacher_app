import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base` is "/" for the standalone build (demo.veradicai.com) and "/tour/" when
// the tour is mounted under veradicai.com/tour — set via DEMO_BASE by the web
// app's build step. import.meta.env.BASE_URL follows this, and the router
// basename + asset() read from it so every URL stays correct under either mount.
// https://vite.dev/config/
export default defineConfig({
  base: process.env.DEMO_BASE || '/',
  plugins: [react()],
})
