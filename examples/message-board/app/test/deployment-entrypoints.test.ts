import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "examples/message-board/app/src");

describe("MessageBoard deployment entrypoints", () => {
  it("provides explicit combined and application-only startup sources", () => {
    expect(existsSync(join(sourceRoot, "application-entry.ts"))).toBe(true);
    expect(existsSync(join(sourceRoot, "combined-entry.ts"))).toBe(true);
  });

  it("configures standalone gateway durable bindings from named runtime input", () => {
    const gateway = readFileSync(join(sourceRoot, "gateway-entry.ts"), "utf8");
    const deployment = readFileSync(join(sourceRoot, "deployment-config.ts"), "utf8");
    expect(gateway).toContain("new DurableSubscriptionBindings");
    expect(gateway).toContain("storageFactory: MessageBoardDeployment.storage(config)");
    expect(gateway).toContain("bindings,");
    expect(deployment).toContain('"SUBSCRIPTION_REGISTRY_NAMESPACE"');
  });
});
