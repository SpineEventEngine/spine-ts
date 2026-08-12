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
import { Code, ConnectError } from "@connectrpc/connect";

/**
 * A finite FIFO boundary for all state-changing delivery operations.
 */
export class MutationAdmission {
  #pending: { readonly admit: () => void; readonly reject: (error: Error) => void }[] = [];
  #scheduled = false;
  #closed = false;

  /**
   * Closes admission and rejects pending mutations.
   */
  close(): void {
    this.#closed = true;
    const error = new ConnectError("Delivery server is closed.", Code.Unavailable);
    for (const pending of this.#pending) pending.reject(error);
    this.#pending = [];
  }

  /**
   * Queues one synchronous state mutation.
   * @param signal Cancels admission before commit.
   * @param commit Performs the linearized mutation.
   * @returns Resolves with the committed value.
   */
  run<T>(signal: AbortSignal | undefined, commit: () => T): Promise<T> {
    if (this.#closed)
      return Promise.reject(new ConnectError("Delivery server is closed.", Code.Unavailable));
    if (signal?.aborted) return Promise.reject(this.#abortError(signal));
    if (this.#pending.length >= 100)
      return Promise.reject(
        new ConnectError("Delivery mutation queue is full.", Code.ResourceExhausted),
      );
    return new Promise<T>((resolve, reject) => {
      const admission = () => {
        if (signal?.aborted) {
          reject(this.#abortError(signal));
          return;
        }
        try {
          resolve(commit());
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Delivery mutation failed."));
        }
      };
      this.#pending.push({ admit: admission, reject });
      if (!this.#scheduled) {
        this.#scheduled = true;
        queueMicrotask(() => {
          this.#flush();
        });
      }
    });
  }

  #flush(): void {
    this.#scheduled = false;
    const pending = this.#pending;
    this.#pending = [];
    for (const admission of pending) admission.admit();
  }

  #abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error("Delivery mutation aborted.");
  }
}
