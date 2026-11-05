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
import { describe, expect, it, vi } from "vitest";

import { SessionLifetimes } from "../../src/sessions/session-lifetime.js";

describe("session operation lifetimes", () => {
  it("rejects registration after host cancellation or strategy close", () => {
    const lifetimes = new SessionLifetimes(() => 1_000);
    const cancelled = new AbortController();
    cancelled.abort();
    expect(() => lifetimes.register("session", cancelled.signal)).toThrow();
    lifetimes.close();
    expect(() => lifetimes.register("session", new AbortController().signal)).toThrow("closed");
  });

  it("stops a registered operation if its trusted clock fails", () => {
    const lifetimes = new SessionLifetimes(() => undefined);
    const monitor = lifetimes.register("session", new AbortController().signal);
    expect(monitor.ready(create(TimestampSchema, { seconds: 2n }))).toBe(false);
    expect(monitor.signal.aborted).toBe(true);
    lifetimes.close();
  });

  it("uses bounded timers for a distant deadline and checks the clock again", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const lifetimes = new SessionLifetimes(() => now);
      const monitor = lifetimes.register("session", new AbortController().signal);
      const deadline = create(TimestampSchema, { seconds: 4_000_000n });
      expect(monitor.ready(deadline)).toBe(true);
      await vi.advanceTimersByTimeAsync(2_147_483_647);
      expect(monitor.signal.aborted).toBe(false);
      now = 4_000_000_000;
      await vi.runOnlyPendingTimersAsync();
      expect(monitor.signal.aborted).toBe(true);
      lifetimes.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases a completed monitor without stopping another operation", () => {
    const lifetimes = new SessionLifetimes(() => 1_000);
    const first = lifetimes.register("session", new AbortController().signal);
    const second = lifetimes.register("session", new AbortController().signal);
    first.release();
    first.release();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    lifetimes.invalidate("session");
    expect(second.signal.aborted).toBe(true);
    lifetimes.close();
  });

  it("rejects an already expired deadline at its exact timestamp", () => {
    const lifetimes = new SessionLifetimes(() => 1_000);
    const monitor = lifetimes.register("session", new AbortController().signal);
    expect(monitor.ready(create(TimestampSchema, { seconds: 1n }))).toBe(false);
    lifetimes.close();
  });
});
