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

const deliveredRetentionMs = 5_000;

/**
 * Applies the shared completed Inbox retention policy.
 */
export const InboxRetention: Readonly<{ deadline(nowMs: number): Date }> = Object.freeze({
  /**
   * Returns the cleanup eligibility time for a completed Inbox delivery.
   *
   * @param nowMs Application time at the delivered transition, in milliseconds.
   * @returns The deadline five seconds after completion.
   */
  deadline(nowMs: number): Date {
    return new Date(nowMs + deliveredRetentionMs);
  },
});
