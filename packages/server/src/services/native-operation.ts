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
 * Host-managed lifetime spanning native authentication and all output.
 */
export class NativeOperation {
  readonly #controller = new AbortController();

  readonly #transport: AbortSignal;

  readonly #shutdown: AbortSignal;

  #invalidated: AbortSignal | undefined;

  /**
   * Starts one native invocation before its authenticator runs.
   *
   * @param transport Incoming peer cancellation.
   * @param shutdown Local host shutdown.
   */
  constructor(transport: AbortSignal, shutdown: AbortSignal) {
    this.#transport = transport;
    this.#shutdown = shutdown;
    transport.addEventListener("abort", this.#abort, { once: true });
    shutdown.addEventListener("abort", this.#abort, { once: true });
    if (transport.aborted || shutdown.aborted) this.#abort();
  }

  /**
   * Returns the signal used by admission, filters, backend work and output guards.
   *
   * @returns Effective operation cancellation.
   */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /**
   * Captures the authenticator's process-local invalidation signal once.
   *
   * @param invalidated Optional authenticated session invalidation.
   */
  link(invalidated?: AbortSignal): void {
    this.#invalidated = invalidated;
    invalidated?.addEventListener("abort", this.#abort, { once: true });
    if (invalidated?.aborted) this.#abort();
  }

  /**
   * Rejects side effects or output after any linked cancellation.
   */
  check(): void {
    if (this.signal.aborted) throw new ConnectError("Reader operation cancelled.", Code.Canceled);
  }

  /**
   * Closes the invocation even when its transport peer remains connected.
   */
  close(): void {
    this.#abort();
    this.#transport.removeEventListener("abort", this.#abort);
    this.#shutdown.removeEventListener("abort", this.#abort);
    this.#invalidated?.removeEventListener("abort", this.#abort);
  }

  readonly #abort = (): void => {
    if (!this.#controller.signal.aborted) this.#controller.abort();
  };
}
