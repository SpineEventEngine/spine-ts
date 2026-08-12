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

import { describe, expect, it } from "vitest";

import { RelativeTime } from "../src/relative-time.js";

describe("RelativeTime", () => {
  it("uses the MessageBoard age vocabulary at every boundary", () => {
    const now = new Date("2026-07-31T12:00:00.000Z");

    expect(RelativeTime.format(new Date("2026-07-31T11:59:01.000Z"), now)).toBe("just now");
    expect(RelativeTime.format(new Date("2026-07-31T11:59:00.000Z"), now)).toBe("1 minute ago");
    expect(RelativeTime.format(new Date("2026-07-31T11:57:00.000Z"), now)).toBe("3 minutes ago");
    expect(RelativeTime.format(new Date("2026-07-31T09:00:00.000Z"), now)).toBe("3 hours ago");
    expect(RelativeTime.format(new Date("2026-07-29T12:00:00.000Z"), now)).toBe("2 days ago");
  });
});
