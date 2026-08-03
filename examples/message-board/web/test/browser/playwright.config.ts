import { defineConfig } from "@playwright/test";

const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true";
const gatewayPort = Number(process.env.MESSAGE_BOARD_TEST_GATEWAY_PORT ?? "8090");
const gatewayUrl = `http://127.0.0.1:${String(gatewayPort)}`;
const webPort = Number(process.env.MESSAGE_BOARD_TEST_WEB_PORT ?? "5173");
const webUrl = `http://127.0.0.1:${String(webPort)}`;

export default defineConfig({
  testDir: ".",
  tsconfig: "./tsconfig.json",
  use: { baseURL: webUrl },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: [
    {
      command: `node --input-type=module --eval 'import { MessageBoardApplication } from "../app/dist/src/index.js"; await new MessageBoardApplication().run({ port: ${String(gatewayPort)}, webOrigin: "${webUrl}" });'`,
      cwd: "../..",
      port: gatewayPort,
      reuseExistingServer,
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${String(webPort)}`,
      cwd: "../..",
      env: { VITE_MESSAGE_BOARD_GATEWAY_URL: gatewayUrl },
      port: webPort,
      reuseExistingServer,
    },
  ],
});
