import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  tsconfig: "./tsconfig.json",
  use: { baseURL: "http://127.0.0.1:4175" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4175",
    cwd: "../..",
    port: 4175,
    reuseExistingServer: false,
  },
});
