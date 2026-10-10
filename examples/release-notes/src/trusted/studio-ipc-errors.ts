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

const stale = "The draft changed. Read the current draft before trying again.";
const generation =
  "We cannot confirm whether writing started. Check this draft; use Retry saved draft only if it appears.";
const changedInputs = "The draft changed before writing could start. Refresh it, then try again.";
const history = "Activity could not be loaded. Try again.";
const exported =
  "We cannot confirm whether the file was saved. Check the chosen location before exporting again.";
const wait = "Writing is still in progress. Wait, or quit and stop it.";
const generic = "We could not confirm this action. Refresh the draft and try again.";
const safeMessages = [stale, generation, changedInputs, history, exported, wait, generic] as const;

/**
 * Prevents credentials and provider prose from crossing the renderer boundary.
 */
export const StudioIpcErrors = {
  /**
   * Returns a fixed user action from the command and known application failure.
   *
   * @param command Fixed validated IPC command, when available.
   * @param error Failure retained only inside the trusted process.
   * @returns Safe message with no raw provider or filesystem content.
   */
  message(command: unknown, error: unknown): string {
    const detail = error instanceof Error ? error.message : "";
    if (
      [
        "The displayed draft Version is stale.",
        "Approval no longer matches the current draft.",
      ].includes(detail)
    )
      return stale;
    if (
      detail === wait ||
      detail === "Wait for the current account or generation action." ||
      detail === "Wait for the active generation or stop and quit."
    )
      return wait;
    if (detail === "Generation inputs changed; read the current draft.") return changedInputs;
    if (command === "generate" || command === "repeat-generation") return generation;
    if (command === "history") return history;
    if (command === "export") return exported;
    return generic;
  },

  /**
   * Executes one trusted IPC action with bounded failure text.
   *
   * @typeParam Result Action result returned unchanged on success.
   * @param command Fixed action name after sender validation.
   * @param action Trusted action invoked once.
   * @returns Original action result on success.
   */
  async execute<Result>(command: unknown, action: () => Promise<Result>): Promise<Result> {
    try {
      return await action();
    } catch (error) {
      throw new Error(this.message(command, error));
    }
  },

  /**
   * Reads only known fixed messages from Electron's wrapped error text.
   *
   * @param error Renderer-side invocation failure.
   * @param fallback Safe message for an unknown failure.
   * @returns Whitelisted instruction without raw exception detail.
   */
  display(error: unknown, fallback: string): string {
    const detail = error instanceof Error ? error.message : "";
    return safeMessages.find((message) => detail.includes(message)) ?? fallback;
  },
};
