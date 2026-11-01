import { readFileSync } from "node:fs"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react-swc"
import { defineConfig, loadEnv } from "vite"
import { resolveBuildVersion } from "./build/version.mjs"

const project = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
)

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_BUILD__: JSON.stringify(
      resolveBuildVersion(project.version, {
        ...loadEnv(mode, process.cwd(), "VITE_"),
        ...process.env,
      }),
    ),
  },
  server: {
    host: process.env.VITE_API_PROXY_TARGET ? "0.0.0.0" : undefined,
    proxy: process.env.VITE_API_PROXY_TARGET
      ? {
          "/api": {
            target: process.env.VITE_API_PROXY_TARGET,
            changeOrigin: true,
          },
        }
      : undefined,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
}))
