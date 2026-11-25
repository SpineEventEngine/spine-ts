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

import {
  PrivateDeliveryChild,
  type PrivateDeliveryChildOptions,
} from "./private-delivery-child.js";

/**
 * Starts a child with parent-generated private credentials and fixed slot settings.
 */
interface StartChildMessage {
  /**
   * Selects child listener startup.
   */
  readonly kind: "start";

  /**
   * Supplies the fixed route and private capacity endpoint.
   */
  readonly options: PrivateDeliveryChildOptions;
}

/**
 * Requests orderly child listener shutdown before IPC disconnect.
 */
interface CloseChildMessage {
  /**
   * Selects terminal shutdown.
   */
  readonly kind: "close";
}

/**
 * Carries only lifecycle instructions across the parent-child IPC channel.
 */
type ChildMessage = StartChildMessage | CloseChildMessage;

/**
 * Runs the private Delivery child after its parent sends lifecycle configuration.
 */
class PrivateDeliveryChildProcess {
  #child: PrivateDeliveryChild | undefined;

  #closing: Promise<void> | undefined;

  /**
   * Attaches the child process to parent lifecycle messages.
   */
  start(): void {
    process.on("message", (message: ChildMessage) => {
      if (message.kind === "start") void this.#open(message.options);
      else void this.#close();
    });
    process.on("disconnect", () => {
      void this.#close();
    });
  }

  /**
   * Starts exactly one configured private child listener.
   *
   * @param options Supplies the parent-generated slot and credentials.
   * @returns Completion after readiness or a reported startup failure.
   */
  async #open(options: PrivateDeliveryChildOptions): Promise<void> {
    if (this.#child !== undefined || this.#closing !== undefined) return;
    try {
      const child = new PrivateDeliveryChild(options, () => {
        process.exitCode = 1;
        void this.#close();
      });
      this.#child = child;
      await child.start();
      process.send?.({ kind: "ready", baseUrl: child.baseUrl });
    } catch (error) {
      process.send?.({ kind: "failed", message: String(error) });
      await this.#close();
      process.exitCode = 1;
    }
  }

  /**
   * Closes the child listener before disconnecting from its parent.
   *
   * @returns Completion after child resources close.
   */
  async #close(): Promise<void> {
    this.#closing ??= (async () => {
      await this.#child?.close();
      if (process.connected) process.disconnect();
    })();
    return this.#closing;
  }
}

new PrivateDeliveryChildProcess().start();
