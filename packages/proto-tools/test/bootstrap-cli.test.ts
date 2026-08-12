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
      ProtoGeneration: { generate: generateModel, compose: vi.fn() },
    }));
    process.argv = command === undefined ? ["node", "bootstrap"] : ["node", "bootstrap", command];

    await import("../src/cli/spine-proto-bootstrap.js");

    expect(generateModel).toHaveBeenCalledExactlyOnceWith(resolve(process.cwd()));
  });

  it("dispatches compose to application composition", async () => {
    const composeApplication = vi.fn();
    vi.doMock("../src/generation/generator.js", () => ({
      ProtoGeneration: { generate: vi.fn(), compose: composeApplication },
    }));
    process.argv = ["node", "bootstrap", "compose"];

    await import("../src/cli/spine-proto-bootstrap.js");

    expect(composeApplication).toHaveBeenCalledExactlyOnceWith(resolve(process.cwd()));
  });

  it("rejects unsupported commands without dispatching", async () => {
    const generateModel = vi.fn();
    const composeApplication = vi.fn();
    vi.doMock("../src/generation/generator.js", () => ({
      ProtoGeneration: { generate: generateModel, compose: composeApplication },
    }));
    process.argv = ["node", "bootstrap", "unknown"];

    await expect(import("../src/cli/spine-proto-bootstrap.js")).rejects.toThrow(
      "spine-proto bootstrap: unsupported command unknown",
    );
    expect(generateModel).not.toHaveBeenCalled();
    expect(composeApplication).not.toHaveBeenCalled();
  });
});
