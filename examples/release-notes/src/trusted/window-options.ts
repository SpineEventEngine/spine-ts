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

import type { BrowserWindowConstructorOptions } from "electron";

/**
 * Builds an isolated application window policy.
 *
 * @param preload The fixed preload entry path.
 * @returns Restricted Electron window options.
 */
export const windowOptions = (preload: string): BrowserWindowConstructorOptions => {
  return {
    width: 900,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    title: "Release Notes Studio",
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  };
};
