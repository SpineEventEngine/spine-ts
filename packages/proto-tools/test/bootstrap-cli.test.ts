import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = [...process.argv];

afterEach(() => {
  process.argv = [...originalArgv];
  vi.resetModules();
  vi.doUnmock("../src/generation/generator.js");
});

describe("spine-proto source bootstrap", () => {
  it.each([undefined, "generate"])("dispatches %s to model generation", async (command) => {
    const generateModel = vi.fn();
    vi.doMock("../src/generation/generator.js", () => ({
      generateModel,
      composeApplication: vi.fn(),
    }));
    process.argv = command === undefined ? ["node", "bootstrap"] : ["node", "bootstrap", command];

    await import("../src/cli/spine-proto-bootstrap.js");

    expect(generateModel).toHaveBeenCalledExactlyOnceWith(resolve(process.cwd()));
  });

  it("dispatches compose to application composition", async () => {
    const composeApplication = vi.fn();
    vi.doMock("../src/generation/generator.js", () => ({
      generateModel: vi.fn(),
      composeApplication,
    }));
    process.argv = ["node", "bootstrap", "compose"];

    await import("../src/cli/spine-proto-bootstrap.js");

    expect(composeApplication).toHaveBeenCalledExactlyOnceWith(resolve(process.cwd()));
  });

  it("rejects unsupported commands without dispatching", async () => {
    const generateModel = vi.fn();
    const composeApplication = vi.fn();
    vi.doMock("../src/generation/generator.js", () => ({ generateModel, composeApplication }));
    process.argv = ["node", "bootstrap", "unknown"];

    await expect(import("../src/cli/spine-proto-bootstrap.js")).rejects.toThrow(
      "spine-proto bootstrap: unsupported command unknown",
    );
    expect(generateModel).not.toHaveBeenCalled();
    expect(composeApplication).not.toHaveBeenCalled();
  });
});
