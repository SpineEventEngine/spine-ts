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
   * Absolute caller deadline, further capped to ten seconds.
   */
  readonly deadlineEpochMs?: number;
}

/**
 * Applies one aggregate time, physical output, and retained catalog budget.
 */
export class GitAdmission {
  private readonly control: GitAdmissionControl | undefined;

  private readonly controller = new AbortController();

  private readonly timer: ReturnType<typeof setTimeout>;

  private commandBytes = 0;

  private catalogBytes = 0;

  /**
   * Starts one bounded comparison admission.
   *
   * @param control Optional caller cancellation and deadline.
   */
  constructor(control?: GitAdmissionControl) {
    this.control = control;
    const deadline = Math.min(
      Time.currentTimeMillis() + 10_000,
      control?.deadlineEpochMs ?? Number.POSITIVE_INFINITY,
    );
    const remaining = deadline - Time.currentTimeMillis();
    const cancel = () => {
      this.controller.abort(new Error("Git admission cancelled."));
    };
    control?.signal?.addEventListener("abort", cancel, { once: true });
    this.cancelCaller = cancel;
    if (control?.signal?.aborted) cancel();
    if (remaining <= 0) this.controller.abort(new Error("Git admission deadline exceeded."));
    this.timer = setTimeout(
      () => {
        this.controller.abort(new Error("Git admission deadline exceeded."));
      },
      Math.max(0, remaining),
    );
  }

  private readonly cancelCaller: () => void;

  /**
   * Executes a Git command under the shared cancellation and output budget.
   *
   * @param executable Trusted Git executable.
   * @param repository Selected repository.
   * @param args Fixed Git argument array.
   * @returns Complete command output.
   */
  async run(executable: string, repository: string, args: readonly string[]): Promise<Buffer> {
    this.controller.signal.throwIfAborted();
    const remaining = 200_000 - this.commandBytes;
    if (remaining <= 0) throw new Error("Git aggregate output bound exceeded; narrow the range.");
    let output: Buffer;
    try {
      output = await GitCommand.run(
        executable,
        repository,
        args,
        remaining,
        this.controller.signal,
      );
    } catch (error) {
      this.controller.signal.throwIfAborted();
      throw error;
    }
    this.controller.signal.throwIfAborted();
    this.commandBytes += output.byteLength;
    return output;
  }

  /**
   * Records retained catalog bytes before appending one entry.
   *
   * @param value Proposed immutable catalog entry.
   */
  record(value: unknown): void {
    this.controller.signal.throwIfAborted();
    this.catalogBytes += Buffer.byteLength(JSON.stringify(value), "utf8");
    if (this.catalogBytes > 200_000)
      throw new Error("Git aggregate catalog bound exceeded; narrow the range.");
  }

  /**
   * Clears the deadline and linked caller signal.
   */
  close(): void {
    clearTimeout(this.timer);
    this.control?.signal?.removeEventListener("abort", this.cancelCaller);
  }
}
