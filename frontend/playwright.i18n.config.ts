import { defineConfig, devices } from "@playwright/test"
// Intercepted API responses: no developer database or Compose services.
export default defineConfig({
  testDir: "./tests",
  testMatch: ["i18n.spec.ts", "demo-preview.spec.ts"],
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:5173",
    locale: "en-GB",
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.I18N_CHROMIUM_EXECUTABLE },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_API_URL: "http://localhost:8000",
      VITE_DISABLE_DEVTOOLS: "true",
    },
  },
})
