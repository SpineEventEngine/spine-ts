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

import { Time } from "@spine-event-engine/core";
import { GitCommand } from "./git-command.js";

/**
 * Cancellation and deadline for one complete comparison admission.
 */
export interface GitAdmissionControl {
  /**
   * Caller cancellation for the entire catalog build.
   */
  readonly signal?: AbortSignal;

  /**
   * Optional absolute caller deadline.
   */
  readonly deadlineEpochMs?: number;
}

/**
 * Applies caller cancellation and any explicit deadline to one comparison.
 */
export class GitAdmission {
  private readonly control: GitAdmissionControl | undefined;

  private readonly controller = new AbortController();

  private timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Starts one comparison admission.
   *
   * @param control Optional caller cancellation and deadline.
   */
  constructor(control?: GitAdmissionControl) {
    this.control = control;
    const cancel = () => {
      this.controller.abort(new Error("Git admission cancelled."));
    };
    control?.signal?.addEventListener("abort", cancel, { once: true });
    this.cancelCaller = cancel;
    if (control?.signal?.aborted) cancel();
    const deadlineEpochMs = control?.deadlineEpochMs;
    if (deadlineEpochMs !== undefined) {
      const schedule = () => {
        const remaining = deadlineEpochMs - Time.currentTimeMillis();
        if (remaining <= 0) {
          this.controller.abort(new Error("Git admission deadline exceeded."));
          return;
        }
        this.timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
      };
      schedule();
    }
  }

  private readonly cancelCaller: () => void;

  /**
   * Executes a Git command under shared cancellation.
   *
   * @param executable Trusted Git executable.
   * @param repository Selected repository.
   * @param args Fixed Git argument array.
   * @returns Complete command output.
   */
  async run(executable: string, repository: string, args: readonly string[]): Promise<Buffer> {
    this.controller.signal.throwIfAborted();
    let output: Buffer;
    try {
      output = await GitCommand.run(executable, repository, args, this.controller.signal);
    } catch (error) {
      this.controller.signal.throwIfAborted();
      throw error;
    }
    this.controller.signal.throwIfAborted();
    return output;
  }

  /**
   * Checks caller cancellation before appending one entry.
   *
   * @param _value Proposed immutable catalog entry.
   */
  record(_value: unknown): void {
    void _value;
    this.controller.signal.throwIfAborted();
  }

  /**
   * Clears the deadline and linked caller signal.
   */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.control?.signal?.removeEventListener("abort", this.cancelCaller);
  }
}
