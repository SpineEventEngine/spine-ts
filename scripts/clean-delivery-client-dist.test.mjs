import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { cleanDeliveryClientDist } from "./clean-delivery-client-dist.mjs";

describe("cleanDeliveryClientDist", () => {
  it("removes only the fixed delivery-client generated output", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const generatedOutput = resolve(repoRoot, "packages/delivery-client/dist");
    const removed = [];

    cleanDeliveryClientDist({
      exists: (target) => target === generatedOutput,
      status: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
      remove: (target) => removed.push(target),
    });

    expect(removed).toEqual([generatedOutput]);
  });
});
