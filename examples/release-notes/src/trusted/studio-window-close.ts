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

import type { BrowserWindow } from "electron";
import type { DesktopAuth } from "./desktop-auth.js";
import type { ReleaseStudio } from "./studio-service.js";

type CloseWindow = Pick<BrowserWindow, "on" | "close">;
type CloseSession = Pick<ReleaseStudio, "selectionLocked" | "close">;
type CloseAuth = Pick<DesktopAuth, "close">;

/**
 * Keeps an active generation visible until the user chooses to stop it.
 */
export const StudioWindowClose = {
  /**
   * Registers the native Wait or Stop and quit decision for the active session.
   *
   * @param window Native application window.
   * @param studio In-memory Bounded Context session.
   * @param auth Trusted account service.
   * @param choose Native dialog result for an active or unknown generation.
   */
  install(
    window: CloseWindow,
    studio: CloseSession,
    auth: CloseAuth,
    choose: () => Promise<"wait" | "stop">,
  ): void {
    let closing = false;
    let deciding = false;
    window.on("close", (event) => {
      if (closing) return;
      event.preventDefault();
      if (deciding) return;
      deciding = true;
      void (async () => {
        if ((await studio.selectionLocked()) && (await choose()) !== "stop") return;
        closing = true;
        await studio.close();
        window.close();
      })()
        .catch(() => {
          closing = false;
        })
        .finally(() => {
          deciding = false;
        });
    });
    window.on("closed", () => {
      void auth.close();
      if (!closing) void studio.close();
    });
  },
};
