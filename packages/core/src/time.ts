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
import { type Timestamp, TimestampSchema } from "@bufbuild/protobuf/wkt";

/**
 * Supplies UTC time to framework code. Optional operations use the system clock when omitted.
 * Provider replacement is intended for tests and affects this module instance within one JS realm.
 */
export interface TimeProvider {
  /**
   * Returns the current UTC instant as a Protobuf timestamp.
   * @returns Current UTC time with seconds and nanoseconds.
   */
  currentTime(): Timestamp;

  /**
   * Returns the current IANA time zone identifier.
   * @returns Current time zone identifier.
   */
  currentZone?(): string;

  /**
   * Returns a monotonic duration reading in milliseconds.
   * @returns Monotonic milliseconds from an arbitrary local origin.
   */
  monotonicTime?(): number;
}

let previousMillis: number | undefined;
let increment = 0;

interface MonotonicClock {
  /**
   * Reads elapsed milliseconds from a local origin.
   * @returns Monotonic milliseconds.
   */
  now(): number;
}

const systemProvider: TimeProvider = {
  /**
   * Reads the system wall clock with the JVM-style microsecond increment.
   * @returns Current UTC timestamp.
   */
  currentTime(): Timestamp {
    const millis = Date.now();
    if (millis === previousMillis) {
      increment = (increment + 1) % 1_000;
    } else {
      increment = 0;
      previousMillis = millis;
    }
    const seconds = Math.floor(millis / 1_000);
    const nanos = (millis - seconds * 1_000) * 1_000_000 + increment * 1_000;
    return create(TimestampSchema, { seconds: BigInt(seconds), nanos });
  },

  /**
   * Reads the runtime's system time zone.
   * @returns IANA time zone identifier.
   */
  currentZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  },

  /**
   * Reads the platform monotonic clock.
   * @returns Monotonic milliseconds.
   */
  monotonicTime(): number {
    const clock = globalThis as typeof globalThis & { performance: MonotonicClock };
    return clock.performance.now();
  },
};

let provider: TimeProvider = systemProvider;

/**
 * Shared, synchronous framework clock.
 */
export const Time = {
  /**
   * Reads the configured provider's current UTC timestamp.
   * @returns Current UTC time with full Protobuf nanosecond precision.
   */
  currentTime(): Timestamp {
    return provider.currentTime();
  },

  /**
   * Reads the system clock regardless of the configured provider. Consecutive calls in the same
   * millisecond have microsecond offsets 0 through 999, then wrap. The sequence is local to this
   * module instance and provides no uniqueness guarantee across workers, processes, restarts, or
   * backward wall-clock changes.
   * @returns System UTC time with an emulated microsecond offset.
   */
  systemTime(): Timestamp {
    return systemProvider.currentTime();
  },

  /**
   * Reads the configured provider's time zone, or the system time zone if omitted.
   * @returns IANA time zone identifier.
   */
  currentTimeZone(): string {
    return (provider.currentZone ?? systemProvider.currentZone)?.() ?? "UTC";
  },

  /**
   * Converts the configured provider's current timestamp to epoch milliseconds. This truncates
   * submillisecond precision and is suitable for deadlines, not occurrence ordering.
   * @returns Integer epoch milliseconds.
   */
  currentTimeMillis(): number {
    const current = provider.currentTime();
    return Number(current.seconds) * 1_000 + Math.floor(current.nanos / 1_000_000);
  },

  /**
   * Reads a monotonic clock for measuring elapsed duration, independent of wall-clock changes.
   * @returns Monotonic milliseconds from an arbitrary local origin.
   */
  monotonicTime(): number {
    return (provider.monotonicTime ?? systemProvider.monotonicTime)?.() ?? 0;
  },

  /**
   * Replaces the provider for this module instance, primarily in sequential tests. Restore the
   * returned provider in a `finally` block to avoid affecting later work.
   * @param next Provider to install.
   * @returns Previously configured provider.
   */
  setProvider(next: TimeProvider): TimeProvider {
    if (next === null || typeof next?.currentTime !== "function") {
      throw new TypeError("A time provider must supply currentTime().");
    }
    const previous = provider;
    provider = next;
    return previous;
  },

  /**
   * Restores the shared system provider after a test.
   */
  resetProvider(): void {
    provider = systemProvider;
  },
} as const;
