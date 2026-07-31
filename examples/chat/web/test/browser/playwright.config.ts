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
      command: "pnpm --dir ../app start",
      cwd: "../..",
      port: 8090,
      reuseExistingServer: false,
    },
    {
      command: "pnpm start",
      cwd: "../..",
      port: 5173,
      reuseExistingServer: false,
    },
  ],
});
