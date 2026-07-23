import { describe, expect, it } from "vitest";

import { ShardIndex } from "../../src/index.js";
import { DeliveryRunControl } from "../../src/delivery/delivery-run-control.js";

describe("DeliveryRunControl", () => {
  it("does not admit a run after its control signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    let calls = 0;
    const control = new DeliveryRunControl({
      run: () => {
        calls += 1;
        return Promise.resolve({ status: "COMPLETED", pages: [] });
      },
    });

    await expect(
      control.run({
        shard: new ShardIndex(0, 1),
        onMessage: () => Promise.resolve(),
        signal: controller.signal,
      }),
    ).rejects.toThrow("stop");
    expect(calls).toBe(0);
  });

  it("rejects a controlled caller on abort while observing a detached late settlement", async () => {
    const controller = new AbortController();
    const settled = Promise.withResolvers<{ status: "COMPLETED"; pages: never[] }>();
    const control = new DeliveryRunControl({ run: () => settled.promise });

    const running = control.run({
      shard: new ShardIndex(0, 1),
      onMessage: () => Promise.resolve(),
      signal: controller.signal,
    });
    controller.abort(new Error("stop"));

    await expect(running).rejects.toThrow("stop");
    settled.resolve({ status: "COMPLETED", pages: [] });
  });

  it("rejects a controlled caller before a detached late rejection", async () => {
    const controller = new AbortController();
    const settled = Promise.withResolvers<{ status: "COMPLETED"; pages: never[] }>();
    const control = new DeliveryRunControl({ run: () => settled.promise });

    const running = control.run({
      shard: new ShardIndex(0, 1),
      onMessage: () => Promise.resolve(),
      signal: controller.signal,
    });
    controller.abort(new Error("deadline elapsed"));

    await expect(running).rejects.toThrow("deadline elapsed");
    settled.reject(new Error("late endpoint failure"));
    await Promise.resolve();
  });
});
