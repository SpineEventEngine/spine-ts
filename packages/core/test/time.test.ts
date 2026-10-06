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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Time } from "../src/time.js";
import { Time as BarrelTime } from "../src/index.js";

afterEach(() => {
  Time.resetProvider();
  vi.restoreAllMocks();
});

describe("Time", () => {
  it("exposes one shared provider through the core barrel", () => {
    expect(BarrelTime).toBe(Time);
  });

  it("returns a provider timestamp and restores the previous provider", () => {
    const first = create(TimestampSchema, { seconds: 1n, nanos: 123_456_789 });
    const second = create(TimestampSchema, { seconds: 2n, nanos: 987_654_321 });
    const original = Time.setProvider({
      currentTime: () => first,
      currentZone: () => "Europe/Lisbon",
    });
    expect(Time.currentTime()).toBe(first);
    expect(Time.currentTimeZone()).toBe("Europe/Lisbon");
    expect(Time.currentTimeMillis()).toBe(1_123);

    const previous = Time.setProvider({ currentTime: () => second });
    expect(Time.currentTime()).toBe(second);
    expect(previous.currentTime()).toBe(first);
    Time.setProvider(previous);
    expect(Time.currentTime()).toBe(first);
    Time.setProvider(original);
  });

  it("uses system time independently of the configured provider", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_234);
    Time.setProvider({ currentTime: () => create(TimestampSchema, { seconds: 99n }) });
    expect(Time.currentTime().seconds).toBe(99n);
    expect(Time.systemTime()).toMatchObject({ seconds: 1n, nanos: 234_000_000 });
  });

  it("increments by one microsecond, wraps after 1,000 calls, and resets on a new millisecond", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_236);
    expect(Time.systemTime()).toMatchObject({ seconds: 1n, nanos: 236_000_000 });
    expect(Time.systemTime()).toMatchObject({ seconds: 1n, nanos: 236_001_000 });
    for (let index = 2; index < 999; index += 1) Time.systemTime();
    expect(Time.systemTime()).toMatchObject({ seconds: 1n, nanos: 236_999_000 });
    expect(Time.systemTime()).toMatchObject({ seconds: 1n, nanos: 236_000_000 });
    now.mockReturnValue(1_237);
    expect(Time.systemTime()).toMatchObject({ seconds: 1n, nanos: 237_000_000 });
  });

  it("normalizes negative epoch milliseconds", () => {
    vi.spyOn(Date, "now").mockReturnValue(-1);
    expect(Time.systemTime()).toMatchObject({ seconds: -1n, nanos: 999_000_000 });
  });

  it("uses monotonic elapsed milliseconds and permits a provider override", () => {
    const reading = vi.spyOn(performance, "now").mockReturnValueOnce(5).mockReturnValueOnce(7);
    const first = Time.monotonicTime();
    const second = Time.monotonicTime();
    expect(second - first).toBe(2);
    expect(reading).toHaveBeenCalledTimes(2);
    Time.setProvider({ currentTime: () => create(TimestampSchema), monotonicTime: () => 42 });
    expect(Time.monotonicTime()).toBe(42);
  });
});
