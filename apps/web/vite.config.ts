import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vitest/config"

const apiProxy = {
  target: process.env.API_PROXY_TARGET ?? "http://localhost:4311",
  changeOrigin: false,
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4310,
    strictPort: true,
    proxy: {
      "/api": apiProxy,
      "/health": apiProxy,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
})
