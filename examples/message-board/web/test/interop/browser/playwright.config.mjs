// Starts the browser fixture that drives the live Message Board interop tests.
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.mjs",
  tsconfig: fileURLToPath(new URL("./tsconfig.json", import.meta.url)),
  workers: 1,
  use: { baseURL: "https://127.0.0.1:4175", ignoreHTTPSErrors: true },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command:
      "./node_modules/.bin/vite test/interop/browser --config test/interop/browser/vite.config.mjs",
    cwd: "../../..",
    port: 4175,
  },
});
