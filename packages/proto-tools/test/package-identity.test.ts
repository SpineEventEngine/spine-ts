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

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { PackageIdentity } from "../src/generation/build-time-handler-analyzer.js";

it("recognizes only a canonical server manifest across packed and symlinked declarations", () => {
  const root = mkdtempSync(join(tmpdir(), "spine-package-identity-"));
  try {
    const server = join(root, "server");
    const packed = join(server, "dist/handler/external.d.ts");
    mkdirSync(join(server, "dist/handler"), { recursive: true });
    writeFileSync(join(server, "package.json"), '{"name":"@spine-event-engine/server"}');
    writeFileSync(packed, "export type External<T> = T;\n");
    expect(PackageIdentity.nameFor(packed)).toBe("@spine-event-engine/server");
    const installed = join(root, "node_modules/@spine-event-engine/server");
    mkdirSync(join(root, "node_modules/@spine-event-engine"), { recursive: true });
    symlinkSync(server, installed, "dir");
    expect(PackageIdentity.nameFor(join(installed, "dist/handler/external.d.ts"))).toBe(
      "@spine-event-engine/server",
    );
    const counterfeit = join(root, "counterfeit");
    mkdirSync(join(counterfeit, "dist/handler"), { recursive: true });
    writeFileSync(join(counterfeit, "package.json"), '{"name":42}');
    expect(
      PackageIdentity.nameFor(join(counterfeit, "dist/handler/external.d.ts")),
    ).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
