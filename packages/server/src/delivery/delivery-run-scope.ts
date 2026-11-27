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

const scopes = new AsyncLocalStorage<object>();

/**
 * Exposes a private identity for the current shard drain.
 */
export interface DeliveryRunScopesApi {
  /**
   * Executes a shard drain with one async identity across its inbox pages.
   *
   * @typeParam T Value returned by the drain.
   * @param action Runs the drain inside its private evidence scope.
   * @returns The drain result.
   */
  run<T>(action: () => Promise<T>): Promise<T>;

  /**
   * Reads the current shard drain identity, when work runs inside a drain.
   *
   * @returns The current drain identity.
   */
  current(): object | undefined;
}

/**
 * Keeps a shard drain's private identity through its async work.
 */
export const deliveryRunScopes: Readonly<DeliveryRunScopesApi> = Object.freeze({
  /**
   * Executes a shard drain with one async identity across its inbox pages.
   *
   * @typeParam T Value returned by the drain.
   * @param action Runs the drain inside its private evidence scope.
   * @returns The drain result.
   */
  run<T>(action: () => Promise<T>): Promise<T> {
    return scopes.run({}, action);
  },

  /**
   * Reads the current shard drain identity, when work runs inside a drain.
   *
   * @returns The current drain identity.
   */
  current(): object | undefined {
    return scopes.getStore();
  },
});
