import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("authenticated subscription public contract", () => {
  it("contains only the approved direct-record persistence model", async () => {
    const source = await readFile(
      new URL("../../src/server/durable-subscription-bindings.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("GatewayAuthenticatedSubscriptionSchema");
    expect(source).not.toMatch(
      new RegExp(
        [
          "AnySchema|type\\.spine-event-engine\\.gateway|JSON\\.parse|JSON\\.stringify",
          "quotaId|cleanupId|admissionToken|reservationOwner|principalFingerprint",
          "leaseUntilMs|retryAfterMs|receipt|marker",
        ].join("|"),
      ),
    );
  });
});
