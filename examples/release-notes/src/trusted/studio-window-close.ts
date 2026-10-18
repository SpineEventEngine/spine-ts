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

import type { BrowserWindow } from "@mobrowser/api";
import type { DesktopAuth } from "./desktop-auth.js";
import type { ReleaseStudio } from "./studio-service.js";

type CloseWindow = Pick<BrowserWindow, "handle" | "on">;
type CloseSession = Pick<
  ReleaseStudio,
  "reserveClose" | "releaseCloseReservation" | "acceptClose" | "selectionLocked" | "close"
>;
type CloseAuth = Pick<DesktopAuth, "close">;

/**
 * Serializes this application's native close decision and terminal cleanup.
 */
class NativeCloseGate {
  private deciding: Promise<"close" | "cancel"> | undefined;

  private accepted = false;

  /**
   * Binds the native close decision to this in-memory Studio session.
   *
   * @param studio Trusted release workflow.
   * @param auth In-memory account session.
   * @param choose Native Wait or Stop choice.
   */
  constructor(
    private readonly studio: CloseSession,
    private readonly auth: CloseAuth,
    private readonly choose: () => Promise<"wait" | "stop">,
  ) {}

  /**
   * Starts or joins one native close decision.
   *
   * @returns Close when accepted, or cancel when work should remain visible.
   */
  decide(): Promise<"close" | "cancel"> {
    if (this.accepted) return Promise.resolve("close");
    if (this.deciding) return this.deciding;
    this.studio.reserveClose();
    this.deciding = this.resolveDecision().finally(() => {
      this.deciding = undefined;
    });
    return this.deciding;
  }

  /**
   * Closes services if the native window closes without the decision callback.
   */
  closed(): void {
    if (this.accepted) return;
    this.accepted = true;
    this.studio.acceptClose();
    void this.cleanup();
  }

  /**
   * Reads the generation lock after admission has been reserved.
   *
   * @returns Terminal close or user-selected cancellation.
   */
  private async resolveDecision(): Promise<"close" | "cancel"> {
    try {
      if ((await this.studio.selectionLocked()) && (await this.choose()) !== "stop") {
        this.studio.releaseCloseReservation();
        return "cancel";
      }
      this.accepted = true;
      this.studio.acceptClose();
      await this.cleanup();
      return "close";
    } catch {
      this.studio.releaseCloseReservation();
      return "cancel";
    }
  }

  /**
   * Completes both service cleanups and reports a fixed non-sensitive failure.
   *
   * @returns Completion after both attempts settle.
   */
  private async cleanup(): Promise<void> {
    const results = await Promise.allSettled([this.studio.close(), this.auth.close()]);
    if (results.some((result) => result.status === "rejected"))
      console.error("Studio cleanup failed during close.");
  }
}

/**
 * Retains active work until Wait or Stop has resolved, including application quit.
 */
export const StudioWindowClose = {
  /**
   * Registers one coalesced close decision for the native window.
   *
   * @param window Native application window.
   * @param studio In-memory Bounded Context session.
   * @param auth Trusted account service.
   * @param choose Native dialog choice for active or uncertain generation.
   */
  install(
    window: CloseWindow,
    studio: CloseSession,
    auth: CloseAuth,
    choose: () => Promise<"wait" | "stop">,
  ): void {
    const gate = new NativeCloseGate(studio, auth, choose);
    window.handle("close", () => gate.decide());
    window.on("closed", () => {
      gate.closed();
    });
  },
};
