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

import { createRoot } from "react-dom/client";
import "./index.css";
import { LocalBoardGateway } from "./board-config.js";
import { SessionBoardApp } from "./session-app.js";

declare global {

  /**
   * Runtime settings injected into the browser page by deployment.
   */
  interface Window {
    readonly MESSAGE_BOARD_RUNTIME_CONFIG?: Readonly<Record<string, string | undefined>>;
  }

  /**
   * Bundler environment and optional hot-reload hook for this browser entry.
   */
  interface ImportMeta {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly hot?: Readonly<{
      /**
       * Registers disposal of the React root during module replacement.
       *
       * @param onDispose Callback that releases the root.
       */
      dispose(onDispose: () => void): void;
    }>;
  }
}

const config = { ...import.meta.env, ...window.MESSAGE_BOARD_RUNTIME_CONFIG };
const mode = config.MESSAGE_BOARD_AUTH_MODE ?? config.VITE_MESSAGE_BOARD_AUTH_MODE ?? "public";
if (mode !== "public" && mode !== "signed") throw new Error("Invalid Message Board authentication mode.");
const root = createRoot(document.getElementById("root")!);
root.render(<SessionBoardApp url={LocalBoardGateway.url(config)} mode={mode} />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
