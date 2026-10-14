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

import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";

/** Waits for fixture evidence only until its deadline or termination. */
export async function waitUntil(predicate, timeoutMs, label, termination) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error(`Timed out waiting for ${label}.`);
    let timer;
    try {
      const tick = new Promise((resolve) => {
        timer = setTimeout(resolve, Math.min(5, remaining));
      });
      await Promise.race(termination === undefined ? [tick] : [tick, termination]);
    } finally {
      clearTimeout(timer);
    }
  }
}
