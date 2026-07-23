import { describe, expect, it } from "vitest";

import { runDeliveryServerShutdown } from "../../src/server/shutdown.js";

describe("delivery server shutdown order", () => {
  it("marks health, fences admission, completes Admin, then closes network", async () => {
    const phases: string[] = [];
    await runDeliveryServerShutdown({
      markNotServing: () => phases.push("health"),
      closeAdmission: () => phases.push("admission"),
      closeAdmin: () => phases.push("admin"),
      closeNetwork: () => {
        phases.push("network");
        return Promise.resolve();
      },
    });
    expect(phases).toEqual(["health", "admission", "admin", "network"]);
  });
});
