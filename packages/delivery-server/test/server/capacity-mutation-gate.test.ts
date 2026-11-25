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

import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import { CapacityLedger } from "../../src/server/capacity-ledger.js";
import { CapacityMutationGate } from "../../src/server/capacity-mutation-gate.js";

const limits = { maxRetainedMessages: 2, maxRetainedBytes: 100, maxTrackedShards: 2 };
const growth = { rows: 1, bytes: 70, shards: 1 };
const zero = { rows: 0, bytes: 0, shards: 0 };
const ticket = (slot: number, generation: string, sequence: number) => ({
  slot,
  generation,
  sequence: BigInt(sequence),
});

describe("per-child mutation admission", () => {
  it("rejects pre-aborted and closed admissions without reserving capacity", async () => {
    const reserve = vi.fn(() => Promise.resolve());
    const gate = new CapacityMutationGate({
      reserve,
      report: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
    });
    const caller = new AbortController();
    caller.abort(new Error("caller stopped"));
    await expect(
      gate.run(
        ticket(0, "first", 1),
        () => growth,
        () => Promise.resolve(),
        () => ({ usage: zero, revision: 0n }),
        caller.signal,
      ),
    ).rejects.toThrow("caller stopped");
    gate.close();
    await expect(
      gate.run(
        ticket(0, "first", 1),
        () => growth,
        () => Promise.resolve(),
        () => ({ usage: zero, revision: 0n }),
      ),
    ).rejects.toMatchObject({ code: Code.FailedPrecondition });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("shares an active ticket's result without repeating its mutation", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const operation = vi.fn(async () => {
      entered.resolve(undefined);
      await release.promise;
      return "committed";
    });
    const gate = new CapacityMutationGate({
      reserve: () => Promise.resolve(),
      report: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
    });
    const id = ticket(0, "first", 1);
    const first = gate.run(
      id,
      () => growth,
      operation,
      () => ({ usage: growth, revision: 1n }),
    );
    await entered.promise;
    const repeated = gate.run(
      id,
      () => zero,
      () => Promise.resolve("different"),
      () => ({ usage: zero, revision: 0n }),
    );
    expect(repeated).toBe(first);
    release.resolve(undefined);
    await expect(repeated).resolves.toBe("committed");
    expect(operation).toHaveBeenCalledOnce();
  });

  it.each(["caller", "child"])(
    "keeps committed accounting through caller abort and stops on child close: %s",
    async (stop) => {
      const reported = Promise.withResolvers<undefined>();
      const release = Promise.withResolvers<undefined>();
      const gate = new CapacityMutationGate({
        reserve: () => Promise.resolve(),
        report: () => {
          reported.resolve(undefined);
          return release.promise;
        },
        cancel: () => Promise.resolve(),
      });
      const caller = new AbortController();
      const operation = vi.fn(() => Promise.resolve("committed"));
      const running = gate.run(
        ticket(0, "first", 1),
        () => growth,
        operation,
        () => ({ usage: growth, revision: 1n }),
        caller.signal,
      );
      await reported.promise;
      if (stop === "caller") {
        caller.abort(new Error("caller stopped"));
        release.resolve(undefined);
        await expect(running).resolves.toBe("committed");
      } else {
        const rejected = expect(running).rejects.toThrow();
        gate.close();
        await rejected;
      }
      expect(operation).toHaveBeenCalledOnce();
    },
  );

  it.each([
    Code.ResourceExhausted,
    Code.InvalidArgument,
    Code.FailedPrecondition,
    Code.Unauthenticated,
    Code.PermissionDenied,
    Code.Unimplemented,
  ])("stops on definitive parent reserve rejection %s", async (code) => {
    const operation = vi.fn(() => Promise.resolve());
    const cancel = vi.fn(() => Promise.resolve());
    const report = vi.fn(() => Promise.resolve());
    const reserve = vi.fn(() => Promise.reject(new ConnectError("refused", code)));
    const gate = new CapacityMutationGate({ reserve, report, cancel });
    await expect(
      gate.run(
        ticket(0, "first", 1),
        () => growth,
        operation,
        () => ({ usage: zero, revision: 0n }),
      ),
    ).rejects.toMatchObject({ code });
    expect(reserve).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });

  it("retries an ambiguous usage report and preserves a committed handler error", async () => {
    const handlerError = new Error("handler rejected");
    const report = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new ConnectError("reply lost", Code.Unavailable))
      .mockResolvedValue(undefined);
    const gate = new CapacityMutationGate({
      reserve: () => Promise.resolve(),
      report,
      cancel: () => Promise.resolve(),
    });
    await expect(
      gate.run(
        ticket(0, "first", 1),
        () => growth,
        () => Promise.reject(handlerError),
        () => ({ usage: growth, revision: 1n }),
      ),
    ).rejects.toBe(handlerError);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("retries an ambiguous cancellation before retiring an aborted reservation", async () => {
    const reserved = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const cancel = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new ConnectError("cancel reply lost", Code.Unavailable))
      .mockResolvedValue(undefined);
    const operation = vi.fn(() => Promise.resolve());
    const gate = new CapacityMutationGate({
      reserve: async () => {
        reserved.resolve(undefined);
        await release.promise;
      },
      report: () => Promise.resolve(),
      cancel,
    });
    const controller = new AbortController();
    const running = gate.run(
      ticket(0, "first", 1),
      () => growth,
      operation,
      () => ({ usage: zero, revision: 0n }),
      controller.signal,
    );
    const rejected = expect(running).rejects.toThrow("caller stopped");
    await reserved.promise;
    controller.abort(new Error("caller stopped"));
    release.resolve(undefined);
    await rejected;
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(operation).not.toHaveBeenCalled();
  });

  it("retires an out-of-order barrier without skipping an earlier queued mutation", async () => {
    const applied: number[] = [];
    const gate = new CapacityMutationGate({
      reserve: () => Promise.resolve(),
      report: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
    });
    await gate.barrier(ticket(0, "first", 2));
    const third = gate.run(
      ticket(0, "first", 3),
      () => zero,
      () => {
        applied.push(3);
        return Promise.resolve();
      },
      () => ({ usage: zero, revision: 0n }),
    );
    const first = gate.run(
      ticket(0, "first", 1),
      () => zero,
      () => {
        applied.push(1);
        return Promise.resolve();
      },
      () => ({ usage: zero, revision: 0n }),
    );
    await Promise.all([first, third]);
    expect(applied).toEqual([1, 3]);
  });

  it.each([ticket(-1, "first", 1), ticket(0, "", 1), ticket(0, "first", 0)])(
    "rejects an invalid private mutation ticket before capacity admission",
    async (invalid) => {
      const reserve = vi.fn(() => Promise.resolve());
      const gate = new CapacityMutationGate({
        reserve,
        report: () => Promise.resolve(),
        cancel: () => Promise.resolve(),
      });
      await expect(
        gate.run(
          invalid,
          () => growth,
          () => Promise.resolve(),
          () => ({ usage: zero, revision: 0n }),
        ),
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
      expect(reserve).not.toHaveBeenCalled();
    },
  );

  it("refreshes exact growth after a delayed reservation before applying a mutation", async () => {
    const ledger = new CapacityLedger({ ...limits, maxRetainedBytes: 71 });
    ledger.replace(0, "first");
    const release = Promise.withResolvers<undefined>();
    let phase = 0;
    const gate = new CapacityMutationGate({
      reserve: async (id, amount, _signal, receivedPhase) => {
        if (receivedPhase === 0n) await release.promise;
        ledger.reserve(id, amount, receivedPhase);
      },
      report: (id, usage, revision) => {
        ledger.report(id, usage, revision);
        return Promise.resolve();
      },
      cancel: (id) => {
        ledger.cancel(id);
        return Promise.resolve();
      },
    });
    const running = gate.run(
      ticket(0, "first", 1),
      () => ({ ...growth, bytes: 70 }),
      () => Promise.resolve("committed"),
      () => ({ usage: { ...growth, bytes: 71 }, revision: 1n }),
      undefined,
      () => ({ ...growth, bytes: ++phase === 1 ? 71 : 71 }),
    );
    release.resolve(undefined);
    await expect(running).resolves.toBe("committed");
    expect(ledger.usage().bytes).toBe(71);
    expect(phase).toBe(2);
  });
  it("lets a second slot commit with headroom before the first slot settles", async () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    ledger.replace(1, "second");
    const first = new CapacityMutationGate({
      reserve: (id, amount) => {
        ledger.reserve(id, amount);
        return Promise.resolve();
      },
      report: (id, usage, revision) => {
        ledger.report(id, usage, revision);
        return Promise.resolve();
      },
      cancel: (id) => {
        ledger.cancel(id);
        return Promise.resolve();
      },
    });
    const second = new CapacityMutationGate({
      reserve: (id, amount) => {
        ledger.reserve(id, amount);
        return Promise.resolve();
      },
      report: (id, usage, revision) => {
        ledger.report(id, usage, revision);
        return Promise.resolve();
      },
      cancel: (id) => {
        ledger.cancel(id);
        return Promise.resolve();
      },
    });
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const firstRun = first.run(
      ticket(0, "first", 1),
      () => growth,
      async () => {
        entered.resolve(undefined);
        await release.promise;
        return "first";
      },
      () => ({ usage: { rows: 1, bytes: 70, shards: 1 }, revision: 1n }),
    );
    await entered.promise;
    const secondRun = second.run(
      ticket(1, "second", 1),
      () => ({
        rows: 1,
        bytes: 30,
        shards: 1,
      }),
      () => Promise.resolve("second"),
      () => ({ usage: { rows: 1, bytes: 30, shards: 1 }, revision: 1n }),
    );
    await expect(secondRun).resolves.toBe("second");
    expect(ledger.usage()).toEqual({ rows: 2, bytes: 100, shards: 2 });
    release.resolve(undefined);
    await expect(firstRun).resolves.toBe("first");
  });

  it("uses a correlated barrier before retiring an uncertain request", async () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    const gate = new CapacityMutationGate({
      reserve: (id, amount) => {
        ledger.reserve(id, amount);
        return Promise.resolve();
      },
      report: (id, usage, revision) => {
        ledger.report(id, usage, revision);
        return Promise.resolve();
      },
      cancel: (id) => {
        ledger.cancel(id);
        return Promise.resolve();
      },
    });
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const id = ticket(0, "first", 1);
    const running = gate.run(
      id,
      () => growth,
      async () => {
        entered.resolve(undefined);
        await release.promise;
        return true;
      },
      () => ({ usage: { rows: 1, bytes: 70, shards: 1 }, revision: 1n }),
    );
    await entered.promise;
    let settled = false;
    const barrier = gate.barrier(id).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release.resolve(undefined);
    await running;
    await barrier;
    expect(settled).toBe(true);
    const late = ticket(0, "first", 2);
    await gate.barrier(late);
    await expect(
      gate.run(
        late,
        () => growth,
        () => Promise.resolve(false),
        () => ({ usage: { rows: 2, bytes: 90, shards: 1 }, revision: 2n }),
      ),
    ).rejects.toThrow("retired");
  });

  it("queues overlapping same-slot writes and calculates growth after the preceding commit", async () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    const gate = new CapacityMutationGate({
      reserve: (id, amount) => {
        ledger.reserve(id, amount);
        return Promise.resolve();
      },
      report: (id, usage, revision) => {
        ledger.report(id, usage, revision);
        return Promise.resolve();
      },
      cancel: (id) => {
        ledger.cancel(id);
        return Promise.resolve();
      },
    });
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    let committed = 0;
    const first = gate.run(
      ticket(0, "first", 1),
      () => ({ rows: 1, bytes: 20, shards: 1 }),
      async () => {
        entered.resolve(undefined);
        await release.promise;
        committed = 1;
        return "first";
      },
      () => ({
        usage: { rows: committed, bytes: committed * 20, shards: committed },
        revision: 1n,
      }),
    );
    await entered.promise;
    let calculatedAfter = false;
    const second = gate.run(
      ticket(0, "first", 2),
      () => {
        calculatedAfter = committed === 1;
        return { rows: 1, bytes: 20, shards: 0 };
      },
      () => {
        committed = 2;
        return Promise.resolve("second");
      },
      () => ({ usage: { rows: 2, bytes: 40, shards: 1 }, revision: 2n }),
    );
    expect(
      gate.run(
        ticket(0, "first", 2),
        () => growth,
        () => Promise.resolve("wrong"),
        () => ({ usage: zero, revision: 0n }),
      ),
    ).toBe(second);
    release.resolve(undefined);
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(calculatedAfter).toBe(true);
    expect(ledger.usage()).toEqual({ rows: 2, bytes: 40, shards: 1 });
  });

  it("retires a queued request when its barrier arrives and still runs the earlier ticket", async () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    const gate = new CapacityMutationGate({
      reserve: (id, amount) => {
        ledger.reserve(id, amount);
        return Promise.resolve();
      },
      report: (id, usage, revision) => {
        ledger.report(id, usage, revision);
        return Promise.resolve();
      },
      cancel: (id) => {
        ledger.cancel(id);
        return Promise.resolve();
      },
    });
    const first = gate.run(
      ticket(0, "first", 1),
      () => zero,
      () => Promise.resolve("first"),
      () => ({ usage: zero, revision: 0n }),
    );
    const second = gate.run(
      ticket(0, "first", 2),
      () => growth,
      () => Promise.resolve("second"),
      () => ({ usage: growth, revision: 1n }),
    );
    const rejected = expect(second).rejects.toMatchObject({ code: Code.FailedPrecondition });
    await gate.barrier(ticket(0, "first", 2));
    await rejected;
    await expect(second).rejects.toMatchObject({ code: Code.FailedPrecondition });
    await expect(first).resolves.toBe("first");
    expect(ledger.usage()).toEqual(zero);
  });

  it("honors a barrier before request arrival without blocking a later ticket", async () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    const gate = new CapacityMutationGate({
      reserve: (id, amount) => {
        ledger.reserve(id, amount);
        return Promise.resolve();
      },
      report: (id, usage, revision) => {
        ledger.report(id, usage, revision);
        return Promise.resolve();
      },
      cancel: (id) => {
        ledger.cancel(id);
        return Promise.resolve();
      },
    });
    await gate.barrier(ticket(0, "first", 1));
    await expect(
      gate.run(
        ticket(0, "first", 1),
        () => growth,
        () => Promise.resolve("late"),
        () => ({ usage: growth, revision: 1n }),
      ),
    ).rejects.toMatchObject({ code: Code.FailedPrecondition });
    await expect(
      gate.run(
        ticket(0, "first", 2),
        () => zero,
        () => Promise.resolve("next"),
        () => ({ usage: zero, revision: 0n }),
      ),
    ).resolves.toBe("next");
    await expect(gate.barrier(ticket(1, "other", 3))).rejects.toMatchObject({
      code: Code.FailedPrecondition,
    });
  });

  it("cancels a queued call before its growth calculation or handler runs", async () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    const gate = new CapacityMutationGate({
      reserve: (id, amount) => {
        ledger.reserve(id, amount);
        return Promise.resolve();
      },
      report: (id, usage, revision) => {
        ledger.report(id, usage, revision);
        return Promise.resolve();
      },
      cancel: (id) => {
        ledger.cancel(id);
        return Promise.resolve();
      },
    });
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const first = gate.run(
      ticket(0, "first", 1),
      () => zero,
      async () => {
        entered.resolve(undefined);
        await release.promise;
      },
      () => ({ usage: zero, revision: 0n }),
    );
    await entered.promise;
    const aborted = new AbortController();
    let calculated = false;
    const second = gate.run(
      ticket(0, "first", 2),
      () => {
        calculated = true;
        return growth;
      },
      () => Promise.resolve(),
      () => ({ usage: growth, revision: 1n }),
      aborted.signal,
    );
    const rejected = expect(second).rejects.toThrow("cancelled before admission");
    aborted.abort(new Error("cancelled before admission"));
    await rejected;
    release.resolve(undefined);
    await first;
    expect(calculated).toBe(false);
    expect(ledger.usage()).toEqual(zero);
  });

  it("runs tickets in sequence when a later private request arrives first", async () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    const gate = new CapacityMutationGate({
      reserve: (id, amount) => {
        ledger.reserve(id, amount);
        return Promise.resolve();
      },
      report: (id, usage, revision) => {
        ledger.report(id, usage, revision);
        return Promise.resolve();
      },
      cancel: (id) => {
        ledger.cancel(id);
        return Promise.resolve();
      },
    });
    const order: string[] = [];
    const second = gate.run(
      ticket(0, "first", 2),
      () => zero,
      () => {
        order.push("second");
        return Promise.resolve();
      },
      () => ({ usage: zero, revision: 0n }),
    );
    await Promise.resolve();
    expect(order).toEqual([]);
    const first = gate.run(
      ticket(0, "first", 1),
      () => zero,
      () => {
        order.push("first");
        return Promise.resolve();
      },
      () => ({ usage: zero, revision: 0n }),
    );
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("paces ambiguous reserve failures and stops retrying on close", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const gate = new CapacityMutationGate({
        reserve: () => {
          calls++;
          return Promise.reject(new Error("lost reply"));
        },
        report: () => Promise.resolve(),
        cancel: () => Promise.resolve(),
      });
      const running = gate.run(
        ticket(0, "first", 1),
        () => zero,
        () => Promise.resolve(),
        () => ({ usage: zero, revision: 0n }),
      );
      const rejected = expect(running).rejects.toThrow("aborted");
      await Promise.resolve();
      await Promise.resolve();
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toBe(2);
      gate.close();
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["caller", "close"])(
    "cancels a granted reservation if %s stops while reserve is in flight",
    async (stoppedBy) => {
      const ledger = new CapacityLedger(limits);
      ledger.replace(0, "first");
      const reserved = Promise.withResolvers<undefined>();
      const release = Promise.withResolvers<undefined>();
      let cancellations = 0;
      let invoked = false;
      const gate = new CapacityMutationGate({
        reserve: (id, amount) => {
          ledger.reserve(id, amount);
          reserved.resolve(undefined);
          return release.promise;
        },
        report: () => Promise.resolve(),
        cancel: (id) => {
          cancellations++;
          ledger.cancel(id);
          return Promise.resolve();
        },
      });
      const controller = new AbortController();
      const running = gate.run(
        ticket(0, "first", 1),
        () => growth,
        () => {
          invoked = true;
          return Promise.resolve();
        },
        () => ({ usage: growth, revision: 1n }),
        controller.signal,
      );
      const rejected = expect(running).rejects.toThrow();
      await reserved.promise;
      if (stoppedBy === "caller") controller.abort(new Error("caller stopped"));
      else gate.close();
      release.resolve(undefined);
      await rejected;
      expect(invoked).toBe(false);
      expect(cancellations).toBe(1);
      expect(ledger.usage()).toEqual(zero);
    },
  );

  it("stops a hanging cancel on close while retaining uncertain capacity", async () => {
    const ledger = new CapacityLedger(limits);
    ledger.replace(0, "first");
    const enteredReserve = Promise.withResolvers<undefined>();
    const releaseReserve = Promise.withResolvers<undefined>();
    const enteredCancel = Promise.withResolvers<undefined>();
    const gate = new CapacityMutationGate({
      reserve: (id, amount) => {
        ledger.reserve(id, amount);
        enteredReserve.resolve(undefined);
        return releaseReserve.promise;
      },
      report: () => Promise.resolve(),
      cancel: () => {
        enteredCancel.resolve(undefined);
        return new Promise<undefined>(() => {
          /* Deliberately unanswered transport. */
        });
      },
    });
    const controller = new AbortController();
    const running = gate.run(
      ticket(0, "first", 1),
      () => growth,
      () => {
        throw new Error("handler must not start");
      },
      () => ({ usage: growth, revision: 1n }),
      controller.signal,
    );
    const rejected = expect(running).rejects.toThrow();
    await enteredReserve.promise;
    controller.abort(new Error("caller stopped"));
    releaseReserve.resolve(undefined);
    await enteredCancel.promise;
    gate.close();
    await rejected;
    await gate.barrier(ticket(0, "first", 1));
    expect(ledger.usage()).toEqual(growth);
    ledger.replace(0, "replacement");
    expect(ledger.usage()).toEqual(zero);
  });

  it("stops a hanging reserve on close and never starts its handler", async () => {
    const enteredReserve = Promise.withResolvers<undefined>();
    const gate = new CapacityMutationGate({
      reserve: () => {
        enteredReserve.resolve(undefined);
        return new Promise<undefined>(() => {
          /* Deliberately unanswered transport. */
        });
      },
      report: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
    });
    let invoked = false;
    const running = gate.run(
      ticket(0, "first", 1),
      () => growth,
      () => {
        invoked = true;
        return Promise.resolve();
      },
      () => ({ usage: growth, revision: 1n }),
    );
    const rejected = expect(running).rejects.toThrow();
    await enteredReserve.promise;
    gate.close();
    await rejected;
    expect(invoked).toBe(false);
    await gate.barrier(ticket(0, "first", 1));
  });
});
