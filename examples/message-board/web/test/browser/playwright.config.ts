import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  tsconfig: "./tsconfig.json",
  use: { baseURL: "http://127.0.0.1:5173" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: [
    {
      command: "node ../app/dist/src/local-entry.js",
      cwd: "../..",
      port: 8090,
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec vite --host 127.0.0.1 --port 5173",
      cwd: "../..",
      port: 5173,
      reuseExistingServer: false,
    },
  ],
});
