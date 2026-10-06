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
import { toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Time } from "../src/time/index.js";
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
    expect(Date.now()).toBe(1_123);

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

  it("produces timestamps accepted by Protobuf binary encoding", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_234);
    const timestamp = Time.systemTime();
    expect(toBinary(TimestampSchema, timestamp)).toEqual(
      toBinary(TimestampSchema, create(TimestampSchema, { seconds: 1n, nanos: 234_000_000 })),
    );
  });

  it("imports in a dependency-free release checkout", () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-time-"));
    try {
      copyFileSync(new URL("../src/time/index.ts", import.meta.url), join(directory, "time.ts"));
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
        import { Time } from ${JSON.stringify(new URL(`file://${join(directory, "time.ts")}`).href)};
        const timestamp = Time.currentTime();
        if (timestamp.$typeName !== "google.protobuf.Timestamp" || typeof timestamp.seconds !== "bigint")
          process.exit(1);
      `,
        ],
        { encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resets the microsecond offset after a backward wall-clock change", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_001);
    Time.systemTime();
    expect(Time.systemTime().nanos).toBe(1_001_000);
    now.mockReturnValue(10_000);
    expect(Time.systemTime()).toMatchObject({ seconds: 10n, nanos: 0 });
  });

  it("keeps system timestamps within the Protobuf bounds", () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(Date.parse("0001-01-01T00:00:00.000Z"));
    expect(Time.systemTime()).toMatchObject({ seconds: -62_135_596_800n, nanos: 0 });
    now.mockReturnValue(Date.parse("9999-12-31T23:59:59.999Z"));
    expect(Time.systemTime()).toMatchObject({ seconds: 253_402_300_799n, nanos: 999_000_000 });
  });

  it("uses the system zone when a provider supplies only current time", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    Time.setProvider({ currentTime: () => create(TimestampSchema) });
    expect(Time.currentTimeZone()).toBe(zone);
  });

  it("rejects an invalid provider without replacing the current one", () => {
    const instant = create(TimestampSchema, { seconds: 42n });
    Time.setProvider({ currentTime: () => instant });
    expect(() => Time.setProvider(null as never)).toThrow(TypeError);
    expect(() => Time.setProvider({} as never)).toThrow(TypeError);
    expect(Time.currentTime()).toBe(instant);
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

  it("invokes optional provider methods with their instance context", () => {
    class StatefulProvider {
      readonly zone = "Pacific/Auckland";
      readonly tick = 12.5;
      currentTime() {
        return create(TimestampSchema);
      }
      currentZone() {
        return this.zone;
      }
      monotonicTime() {
        return this.tick;
      }
    }
    Time.setProvider(new StatefulProvider());
    expect(Time.currentTimeZone()).toBe("Pacific/Auckland");
    expect(Time.monotonicTime()).toBe(12.5);
  });
});
