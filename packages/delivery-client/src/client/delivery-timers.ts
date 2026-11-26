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
 * Schedules client waits longer than a single Node.js timer can represent.
 */
export const DeliveryTimers: Readonly<{
  readonly maxTimerMs: number;
  after(callback: () => void, delay: number | undefined): (() => void) | undefined;
}> = Object.freeze({
  /**
   * Largest delay that Node accepts without replacing it with one millisecond.
   */
  maxTimerMs: 0x7fff_ffff,

  /**
   * Runs the callback after all timer intervals have elapsed.
   *
   * @param callback Runs when the requested time has passed.
   * @param delay Supplies the total delay in milliseconds.
   * @returns A function that cancels the current interval, when scheduled.
   */
  after(callback: () => void, delay: number | undefined): (() => void) | undefined {
    if (delay === undefined) return undefined;
    let remaining = delay;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const slice = Math.min(remaining, DeliveryTimers.maxTimerMs);
      remaining -= slice;
      timer = setTimeout(remaining > 0 ? schedule : callback, slice);
    };
    schedule();
    return () => {
      clearTimeout(timer);
    };
  },
});
