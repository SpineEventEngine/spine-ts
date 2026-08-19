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
 * Private bridge from the normal local subscription activation point to the
 * managed-child lifecycle. It deliberately carries only a child subscription
 * identity; the public subscription update stream remains untouched.
 *
 * @internal
 */
let installed: ((id: string) => void) | undefined;
let reported = new Set<string>();

/**
 * Coordinates private managed-child subscription installation notification.
 *
 * @internal
 */
export const managedChildSubscriptionAccess: Readonly<{
  install(onInstalled: (id: string) => void): void;
  clear(): void;
  installed(id: string): void;
}> = Object.freeze({
  install(onInstalled): void {
    installed = onInstalled;
    reported = new Set();
  },
  clear(): void {
    installed = undefined;
    reported.clear();
  },
  installed(id): void {
    if (installed === undefined || reported.has(id)) return;
    reported.add(id);
    installed(id);
  },
});
