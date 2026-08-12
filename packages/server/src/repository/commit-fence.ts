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

interface Commit {
  readonly status: string;
}
type Guard = () => Promise<void>;

const fences = new AsyncLocalStorage<Guard>();

/**
 * Executes a delivery callback with a commit-time ownership guard.
 *
 * @param guard Verifies that the delivery worker still owns its shard.
 * @param callback Performs the delivery work within the guarded scope.
 * @returns The value produced by the delivery callback.
 */
export async function withDeliveryCommitFence<T>(
  guard: Guard,
  callback: () => Promise<T>,
): Promise<T> {
  return fences.run(guard, callback);
}

/**
 * Verifies delivery ownership immediately before committing an Entity.
 *
 * @param entity Supplies the Entity whose transaction is committed.
 * @param commit Commits the active Entity transaction synchronously.
 * @returns The result produced by the Entity transaction commit.
 */
export async function commitFenced<T extends Commit>(
  entity: object,
  commit: (entity: object) => T,
): Promise<T> {
  await fences.getStore()?.();
  return commit(entity);
}
