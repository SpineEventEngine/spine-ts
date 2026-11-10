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

import { expect, it, vi } from "vitest";
import { FieldnotesProcessSignals } from "../src/fieldnotes-process.js";

it("closes one host exactly once across either process signal", async () => {
  const handlers = new Map<string, () => void>();
  const processLike = {
    once: vi.fn((signal: string, handler: () => void) => {
      handlers.set(signal, handler);
    }),
    off: vi.fn((signal: string) => {
      handlers.delete(signal);
    }),
    exitCode: undefined as number | undefined,
  };
  let finish!: () => void;
  const close = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  FieldnotesProcessSignals.install({ close }, processLike);
  handlers.get("SIGTERM")?.();
  handlers.get("SIGINT")?.();
  expect(close).toHaveBeenCalledTimes(1);
  finish();
  await vi.waitFor(() => {
    expect(processLike.exitCode).toBe(0);
  });
  expect(handlers.size).toBe(0);
});

it("reports shutdown failure without starting a second close", async () => {
  const handlers = new Map<string, () => void>();
  const processLike = {
    once: (signal: string, handler: () => void) => {
      handlers.set(signal, handler);
    },
    off: (signal: string) => {
      handlers.delete(signal);
    },
    exitCode: undefined as number | undefined,
  };
  const close = vi.fn(() => Promise.reject(new Error("close failed")));
  FieldnotesProcessSignals.install({ close }, processLike);
  handlers.get("SIGINT")?.();
  await vi.waitFor(() => {
    expect(processLike.exitCode).toBe(1);
  });
  expect(close).toHaveBeenCalledTimes(1);
});
