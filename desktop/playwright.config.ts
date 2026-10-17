import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./.verify/browser-results",
  reporter: "list",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:1421", channel: "msedge", headless: true, viewport: { width: 1280, height: 860 } },
  webServer: { command: "pnpm preview --port 1421 --strictPort", url: "http://127.0.0.1:1421", reuseExistingServer: false },
});
