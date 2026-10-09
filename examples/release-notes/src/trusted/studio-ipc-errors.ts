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
  "Generation acceptance is unconfirmed. Read the current draft; retry the saved generation if offered.";
const changedInputs = "Generation inputs changed. Read the current draft before generating again.";
const history = "History is unavailable. Try loading this view again.";
const exported =
  "Export outcome is unconfirmed. Check the selected destination before trying again.";
const wait = "Wait for the active generation or stop and quit.";
const generic = "The requested action could not be confirmed. Review the current draft.";
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
    if (detail === wait || detail === "Wait for the current account or generation action.")
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
