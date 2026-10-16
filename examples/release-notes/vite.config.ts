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

import { resolve } from "node:path";
import { defineConfig, type UserConfig } from "vite";

const directory = import.meta.dirname;

export default defineConfig(({ mode, command }) => {
  if (mode === "main") return mainConfig();
  if (mode === "renderer") return rendererConfig(command);
  if (mode === "test") return { root: directory };
  throw new Error(`Unsupported Vite mode: ${mode}`);
});

function mainConfig(): UserConfig {
  return {
    root: directory,
    build: {
      target: "node24",
      outDir: resolve(directory, "out/main"),
      emptyOutDir: true,
      sourcemap: true,
      lib: {
        entry: resolve(directory, "src/main/loader.ts"),
        formats: ["es"],
        fileName: () => "index.js",
      },
      rollupOptions: {
        output: {
          entryFileNames: "index.js",
          chunkFileNames: "chunks/[name]-[hash].js",
        },
      },
    },
  };
}

function rendererConfig(command: "build" | "serve"): UserConfig {
  return {
    root: resolve(directory, "src/renderer"),
    plugins:
      command === "serve"
        ? [
            {
              name: "studio-local-development-csp",
              transformIndexHtml(html: string) {
                return html.replace(
                  "script-src mobrowser://app; style-src mobrowser://app; img-src mobrowser://app data:; connect-src 'none'",
                  "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
                );
              },
            },
          ]
        : [],
    build: {
      outDir: resolve(directory, "out/renderer"),
      emptyOutDir: true,
      sourcemap: true,
    },
  };
}
