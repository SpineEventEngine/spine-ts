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

const maximumTimerDelay = 2_147_483_647;

/**
 * Checks an absolute runtime deadline without overflowing Node's timer range.
 * @param deadlineEpochMs Accepted absolute deadline.
 * @param nowEpochMs Runtime clock read.
 * @param onExpire Callback after the deadline is reached.
 * @returns Timer cancellation.
 */
export const scheduleBoundedDeadline = (
  deadlineEpochMs: number,
  nowEpochMs: () => number,
  onExpire: () => void,
): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    const remaining = deadlineEpochMs - nowEpochMs();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      onExpire();
      return;
    }
    timer = setTimeout(schedule, Math.min(remaining, maximumTimerDelay));
  };
  schedule();
  return () => {
    if (timer) clearTimeout(timer);
  };
};
