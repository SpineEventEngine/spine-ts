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

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Records failure origin for one attempted Inbox dispatch.
 */
export interface ReceptionObservation {
  /**
   * Whether the callback entered framework-managed replay.
   */
  managed: boolean;

  /**
   * Whether dispatch entered the callback after validating the shard session.
   */
  entered: boolean;

  /**
   * Exact values thrown or rejected by Entity handlers during this attempt.
   */
  readonly handlerFailures: unknown[];
}

const attempts = new AsyncLocalStorage<ReceptionObservation>();

/**
 * Distinguishes managed receptor failures from replay infrastructure failures.
 */
export const receptionObservation = {
  /**
   * Creates facts for one attempted dispatch.
   *
   * @returns An empty observation.
   */
  create(): ReceptionObservation {
    return { managed: false, entered: false, handlerFailures: [] };
  },

  /**
   * Executes a dispatch in its private async observation scope.
   *
   * @typeParam T The action result.
   * @param attempt The current attempt's facts.
   * @param action The scoped action.
   * @returns The action result.
   */
  run<T>(attempt: ReceptionObservation, action: () => T): T {
    return attempts.run(attempt, action);
  },

  /**
   * Marks the current callback as framework-managed replay.
   */
  markManaged(): void {
    const attempt = attempts.getStore();
    if (attempt !== undefined) attempt.managed = true;
  },

  /**
   * Records the exact value thrown or rejected by a handler.
   *
   * @param error The raw handler failure.
   */
  recordHandlerFailure(error: unknown): void {
    attempts.getStore()?.handlerFailures.push(error);
  },

  /**
   * Checks whether the dispatch rejection came from an endpoint receptor.
   *
   * @param attempt The attempted dispatch.
   * @param error The raw dispatch rejection.
   * @returns Whether the reception monitor may handle it.
   */
  isReceptorFailure(attempt: ReceptionObservation, error: unknown): boolean {
    return (
      attempt.entered &&
      (!attempt.managed || attempt.handlerFailures.some((failure) => Object.is(failure, error)))
    );
  },
};
