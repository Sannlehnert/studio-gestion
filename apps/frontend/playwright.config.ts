import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  workers: 1,
  fullyParallel: false,
  use: { baseURL: "http://localhost:5173", trace: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_FRONTEND_MANAGED
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: false,
        env: {
          VITE_API_BASE_URL:
            process.env.E2E_API_ORIGIN ?? "http://localhost:3000",
        },
      },
});
