import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { MutationAdmission } from "../../src/core/mutation-admission.js";

describe("MutationAdmission", () => {
  it("skips pre-admission aborts, preserves FIFO, and commits after admission", async () => {
    const admission = new MutationAdmission();
    const aborted = new AbortController();
    aborted.abort();
    const values: string[] = [];
    await expect(admission.run(aborted.signal, () => values.push("never"))).rejects.toBeInstanceOf(
      Error,
    );
    const queued = new AbortController();
    const skipped = admission.run(queued.signal, () => values.push("skipped"));
    const first = admission.run(undefined, () => values.push("first"));
    const second = admission.run(undefined, () => values.push("second"));
    queued.abort();
    await expect(skipped).rejects.toBeInstanceOf(Error);
    await Promise.all([first, second]);
    expect(values).toEqual(["first", "second"]);
  });

  it("bounds pending admission at 100", async () => {
    const admission = new MutationAdmission();
    const pending = Array.from({ length: 100 }, () => admission.run(undefined, () => undefined));
    await expect(admission.run(undefined, () => undefined)).rejects.toMatchObject({
      code: Code.ResourceExhausted,
    });
    await Promise.all(pending);
  });

  it("commits after admission even when the commit aborts its own caller signal", async () => {
    const admission = new MutationAdmission();
    const controller = new AbortController();
    let committed = false;
    await admission.run(controller.signal, () => {
      committed = true;
      controller.abort();
    });
    expect(committed).toBe(true);
  });

  it("does not retain completed or aborted waiters", async () => {
    const admission = new MutationAdmission();
    const controller = new AbortController();
    const aborted = admission.run(controller.signal, () => undefined);
    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(Error);
    await Promise.all(Array.from({ length: 100 }, () => admission.run(undefined, () => undefined)));
    await Promise.all(Array.from({ length: 100 }, () => admission.run(undefined, () => undefined)));
  });
});
