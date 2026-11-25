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

import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { CapacityLedger } from "../../src/server/capacity-ledger.js";

const limits = { maxRetainedMessages: 2, maxRetainedBytes: 100, maxTrackedShards: 2 };
const zero = { rows: 0, bytes: 0, shards: 0 };
const ticket = (slot: number, generation: string, sequence: number) => ({
  slot,
  generation,
  sequence: BigInt(sequence),
});

describe("global child capacity", () => {
  it("holds an uncertain reservation while another slot uses remaining headroom", () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    ledger.replace(1, "second");
    ledger.reserve(ticket(0, "first", 1), { rows: 1, bytes: 70, shards: 1 });
    ledger.reserve(ticket(1, "second", 1), { rows: 1, bytes: 30, shards: 1 });
    expect(() => {
      ledger.reserve(ticket(1, "second", 2), { rows: 0, bytes: 1, shards: 0 });
    }).toThrow(expect.objectContaining({ code: Code.ResourceExhausted }));
    ledger.report(ticket(1, "second", 1), { rows: 1, bytes: 30, shards: 1 }, 1n);
    expect(ledger.usage()).toEqual({ rows: 2, bytes: 100, shards: 2 });
    ledger.report(ticket(0, "first", 1), { rows: 1, bytes: 70, shards: 1 }, 1n);
    expect(ledger.usage()).toEqual({ rows: 2, bytes: 100, shards: 2 });
  });

  it("replays ticket decisions and discards old generations after replacement", () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    const first = ticket(0, "first", 1);
    ledger.reserve(first, { rows: 1, bytes: 70, shards: 1 });
    ledger.reserve(first, { rows: 1, bytes: 70, shards: 1 });
    ledger.replace(0, "replacement");
    expect(ledger.usage()).toEqual(zero);
    expect(() => {
      ledger.report(first, { rows: 1, bytes: 70, shards: 1 }, 1n);
    }).toThrow(expect.objectContaining({ code: Code.FailedPrecondition }));
    const current = ticket(0, "replacement", 1);
    ledger.reserve(current, { rows: 1, bytes: 90, shards: 1 });
    ledger.cancel(current);
    expect(ledger.usage()).toEqual(zero);
    expect(() => {
      ledger.reserve(current, { rows: 1, bytes: 90, shards: 1 });
    }).toThrow(expect.objectContaining({ code: Code.FailedPrecondition }));
  });

  it("frees an idle expired empty shard before another slot's write", () => {
    const ledger = new CapacityLedger({ ...limits, maxTrackedShards: 1 });
    ledger.replace(0, "first");
    ledger.replace(1, "second");
    ledger.reserve(ticket(0, "first", 1), { rows: 0, bytes: 0, shards: 1 });
    ledger.report(ticket(0, "first", 1), { rows: 0, bytes: 0, shards: 1 }, 1n);
    expect(() => {
      ledger.reserve(ticket(1, "second", 1), { rows: 1, bytes: 20, shards: 1 });
    }).toThrow(expect.objectContaining({ code: Code.ResourceExhausted }));
    ledger.reportUsage(0, "first", 2n, zero);
    ledger.reserve(ticket(1, "second", 1), { rows: 1, bytes: 20, shards: 1 });
    ledger.report(ticket(0, "first", 1), { rows: 0, bytes: 0, shards: 1 }, 1n);
    expect(ledger.usage()).toEqual({ rows: 1, bytes: 20, shards: 1 });
  });

  it("rejects a conflicting equal revision without retiring its reservation", () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    const first = ticket(0, "first", 1);
    ledger.reserve(first, { rows: 1, bytes: 20, shards: 1 });
    expect(() => {
      ledger.report(first, { rows: 1, bytes: 20, shards: 1 }, 0n);
    }).toThrow(expect.objectContaining({ code: Code.FailedPrecondition }));
    expect(ledger.usage()).toEqual({ rows: 1, bytes: 20, shards: 1 });
    ledger.report(first, zero, 0n);
    ledger.report(first, zero, 0n);
    expect(ledger.usage()).toEqual(zero);
    ledger.reportUsage(0, "first", 0n, zero);
    expect(() => {
      ledger.reportUsage(0, "first", 0n, { rows: 1, bytes: 1, shards: 1 });
    }).toThrow(expect.objectContaining({ code: Code.FailedPrecondition }));
  });

  it("keeps an earlier ticket valid after a later cancellation or autonomous revision", () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    const first = ticket(0, "first", 1);
    const second = ticket(0, "first", 2);
    ledger.reserve(first, { rows: 1, bytes: 20, shards: 1 });
    ledger.cancel(second);
    ledger.cancel(second);
    ledger.reportUsage(0, "first", 2n, zero);
    ledger.report(first, { rows: 1, bytes: 20, shards: 1 }, 1n);
    expect(ledger.usage()).toEqual(zero);
    expect(() => {
      ledger.reserve(second, { rows: 1, bytes: 20, shards: 1 });
    }).toThrow(expect.objectContaining({ code: Code.FailedPrecondition }));
  });

  it("retires out-of-order reports without leaking an earlier reservation", () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    const first = ticket(0, "first", 1);
    const second = ticket(0, "first", 2);
    ledger.reserve(first, { rows: 1, bytes: 20, shards: 1 });
    ledger.reserve(second, { rows: 1, bytes: 20, shards: 0 });
    ledger.report(second, { rows: 1, bytes: 20, shards: 1 }, 2n);
    expect(ledger.usage()).toEqual({ rows: 2, bytes: 40, shards: 2 });
    ledger.report(first, zero, 1n);
    ledger.cancel(first);
    expect(ledger.usage()).toEqual({ rows: 1, bytes: 20, shards: 1 });
  });
});
