/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import reservedSpineRpcPaths from "../../../packages/server/src/server/reserved-spine-rpc-paths.json" with { type: "json" };

const serveConfig = () => {
  const tlsKey = process.env.MESSAGE_BOARD_TLS_KEY_FILE;
  const tlsCertificate = process.env.MESSAGE_BOARD_TLS_CERT_FILE;
  const gateway = process.env.MESSAGE_BOARD_INTERNAL_GATEWAY_URL;
  const browserGateway = process.env.VITE_MESSAGE_BOARD_GATEWAY_URL;
  if (
    tlsKey === undefined ||
    tlsCertificate === undefined ||
    gateway === undefined ||
    browserGateway === undefined
  )
    throw new Error(
      "Local Message Board serving requires TLS key/certificate, internal Gateway URL, and HTTPS browser Gateway URL.",
    );
  if (!browserGateway.startsWith("https://"))
    throw new Error("VITE_MESSAGE_BOARD_GATEWAY_URL must use the HTTPS browser origin.");
  const proxy = Object.fromEntries(
    reservedSpineRpcPaths.map((path) => [
      `^${path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`,
      { target: gateway, changeOrigin: false },
    ]),
  );
  return {
    https: { key: readFileSync(tlsKey), cert: readFileSync(tlsCertificate), allowHTTP1: true },
    proxy,
  };
};

const runtimeConfig = (): Plugin => ({
  name: "message-board-runtime-config",
  configureServer(server) {
    server.middlewares.use("/message-board-runtime-config.js", (_request, response) => {
      const gateway = process.env.VITE_MESSAGE_BOARD_GATEWAY_URL;
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        `window.MESSAGE_BOARD_RUNTIME_CONFIG=${JSON.stringify({ MESSAGE_BOARD_GATEWAY_URL: gateway })};`,
      );
    });
  },
});

export default defineConfig(({ command }) => ({
  plugins: [tailwindcss(), runtimeConfig()],
  server: command === "serve" ? serveConfig() : {},
}));
