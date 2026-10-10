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

import type { ReleaseStudio } from "./studio-service.js";

/**
 * Applies the current in-memory generation lock to account actions from IPC.
 */
export const StudioAccountGate = {
  /**
   * Acquires a mutating account action across its check and external I/O.
   *
   * @typeParam Result Result returned by the trusted action.
   * @param studio Live release session used for admission fencing.
   * @param command Fixed validated account action.
   * @param account Validated account argument.
   * @param action Trusted account or model operation.
   * @returns Action result after the admission fence is released.
   */
  async run<Result>(
    studio: Pick<ReleaseStudio, "withAccountTransition" | "selectionLocked" | "allowsReconnect">,
    command: string,
    account: unknown,
    action: () => Promise<Result>,
  ): Promise<Result> {
    if (!["sign-in", "reconnect", "select-account", "select-model", "sign-out"].includes(command))
      return action();
    return studio.withAccountTransition(async () => {
      await this.requireUnlocked(studio, command, account);
      return action();
    });
  },

  /**
   * Rejects account switching while a generation is active or its result is unknown.
   *
   * @param studio Current release session with its accepted generation binding.
   * @param command Fixed validated account action.
   * @param account Validated account argument, if any.
   * @returns Completion after the action is permitted.
   */
  async requireUnlocked(
    studio: Pick<ReleaseStudio, "selectionLocked" | "allowsReconnect">,
    command: string,
    account: unknown,
  ): Promise<void> {
    if (!["sign-in", "reconnect", "select-account", "select-model", "sign-out"].includes(command))
      return;
    if (!(await studio.selectionLocked())) return;
    if (
      command === "reconnect" &&
      typeof account === "string" &&
      (await studio.allowsReconnect(account))
    )
      return;
    throw new Error("Wait for the active generation or stop and quit.");
  },
};
