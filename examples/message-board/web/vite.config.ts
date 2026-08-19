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
import { defineConfig, type Plugin } from "vite";

const runtimeConfig = (): Plugin => ({
  name: "message-board-runtime-config",
  configureServer(server) {
    server.middlewares.use("/message-board-runtime-config.js", (_request, response) => {
      const gateway = process.env.VITE_MESSAGE_BOARD_GATEWAY_URL ?? "http://127.0.0.1:8090";
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

export default defineConfig({
  plugins: [tailwindcss(), runtimeConfig()],
});
