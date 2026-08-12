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

const minuteMilliseconds = 60_000;
const hourMilliseconds = 60 * minuteMilliseconds;
const dayMilliseconds = 24 * hourMilliseconds;

/**
 * Formats the approximate elapsed age of a MessageBoard post.
 *
 * @param postedAt Records when the post was accepted.
 * @param now Supplies the current instant for deterministic rendering and tests.
 * @returns A compact relative age suitable for the message timeline.
 */
export const RelativeTime: Readonly<{
  // prettier-ignore

  format(postedAt: Date, now: Date): string;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Formats the approximate elapsed age of a MessageBoard post.
   *
   * @param postedAt Records when the post was accepted.
   * @param now Supplies the current instant for deterministic rendering and tests.
   * @returns A compact relative age suitable for the message timeline.
   */
  format(postedAt: Date, now: Date): string {
    const elapsed = Math.max(0, now.getTime() - postedAt.getTime());
    if (elapsed < minuteMilliseconds) return "just now";
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "always" });
    if (elapsed < hourMilliseconds)
      return formatter.format(-Math.floor(elapsed / minuteMilliseconds), "minute");
    if (elapsed < dayMilliseconds)
      return formatter.format(-Math.floor(elapsed / hourMilliseconds), "hour");
    return formatter.format(-Math.floor(elapsed / dayMilliseconds), "day");
  },
});
