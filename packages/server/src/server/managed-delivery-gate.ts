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

/**
 * Defers managed-child delivery startup until the parent activates the replica.
 * An already active process can start a replacement environment's supervisor.
 * @internal
 */
export class ManagedDeliveryGate {
  readonly #managedChild: boolean;

  #activated: boolean;

  #cancelled = false;

  #pending: (() => Promise<void>) | undefined;

  #started: Promise<void> | undefined;

  /**
   * Creates a gate for a managed child or an already active process.
   * @param managedChild Whether parent activation is required.
   */
  constructor(managedChild: boolean) {
    this.#managedChild = managedChild;
    this.#activated = !managedChild;
  }

  /**
   * Starts the supplied supervisor after activation, coalescing managed-child calls.
   * @param start Starts the current environment's retained supervisor.
   * @returns Startup when activated.
   */
  start(start: () => Promise<void>): Promise<void> {
    if (this.#cancelled) return Promise.resolve();
    if (!this.#activated) {
      this.#pending = start;
      return Promise.resolve();
    }
    return this.#managedChild ? (this.#started ??= start()) : start();
  }

  /**
   * Activates deferred supervisor startup after parent activation.
   * @returns Completion of supervisor startup after parent activation.
   */
  activate(): Promise<void> {
    this.#activated = true;
    const pending = this.#pending;
    this.#pending = undefined;
    return pending === undefined || this.#cancelled ? Promise.resolve() : this.start(pending);
  }

  /**
   * Cancels deferred startup during child shutdown.
   */
  cancel(): void {
    this.#cancelled = true;
    this.#pending = undefined;
  }
}

/**
 * Process-local managed-child admission gate.
 * @internal
 */
export const managedDeliveryGate: ManagedDeliveryGate = new ManagedDeliveryGate(
  process.env.SPINE_MANAGED_SERVER_CHILD === "true",
);
