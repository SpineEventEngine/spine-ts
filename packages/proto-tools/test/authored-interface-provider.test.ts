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

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AuthoredInterfaceProvider } from "../src/generation/authored-interface-provider.js";
import type { DescMessage } from "@bufbuild/protobuf";

describe("AuthoredInterfaceProvider", () => {
  it("resolves a compatible same-module top-level interface through the staged Program", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const authored = join(root, "src/signal-family.ts");
    try {
      mkdirSync(join(stagedGeneratedRoot, "example"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true },
        }),
      );
      writeFileSync(
        join(stagedGeneratedRoot, "example/signals_pb.ts"),
        "export type Signal = { readonly text: string };\n",
      );
      writeFileSync(join(root, "src/external.ts"), "export interface ExternalValue {}\n");
      writeFileSync(
        authored,
        'import type { ExternalValue } from "./external.js";\n' +
          "export interface SignalParent { readonly text: string; readonly external?: ExternalValue }\n" +
          "export interface SignalFamily extends SignalParent {}\n",
      );
      const provider = new AuthoredInterfaceProvider();
      const result = provider.resolve(
        "SignalFamily",
        [
          {
            file: { proto: { name: "example/signals.proto", package: "example" } },
            name: "Signal",
            typeName: "example.Signal",
          } as DescMessage,
        ],
        {
          authoredFiles: [authored],
          liveGeneratedRoot,
          packageRoot: root,
          stagedGeneratedRoot,
        },
      );
      expect(result).toEqual({ name: "SignalFamily", importPath: "../../signal-family.js" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an authored interface that launders an external extends parent", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-external-parent-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const authored = join(root, "src/signal-family.ts");
    try {
      mkdirSync(join(stagedGeneratedRoot, "example"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true },
        }),
      );
      writeFileSync(
        join(stagedGeneratedRoot, "example/signals_pb.ts"),
        "export type Signal = { readonly text: string };\n",
      );
      writeFileSync(
        join(root, "src/external.ts"),
        "export interface External { readonly text: string }\n",
      );
      writeFileSync(
        authored,
        'import type { External } from "./external.js";\n' +
          "export interface SignalFamily extends External {}\n",
      );
      expect(() =>
        new AuthoredInterfaceProvider().resolve(
          "SignalFamily",
          [
            {
              file: { proto: { name: "example/signals.proto", package: "example" } },
              name: "Signal",
              typeName: "example.Signal",
            } as DescMessage,
          ],
          { authoredFiles: [authored], liveGeneratedRoot, packageRoot: root, stagedGeneratedRoot },
        ),
      ).toThrow("extends parent must stay in the model module");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports stable declaration-shape diagnostics before compatibility analysis", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-diagnostics-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const authored = join(root, "src/interfaces.ts");
    const sourceView = {
      authoredFiles: [authored],
      liveGeneratedRoot,
      packageRoot: root,
      stagedGeneratedRoot,
    };
    const member = {
      file: { proto: { name: "example/signals.proto", package: "example" } },
      name: "Signal",
      typeName: "example.Signal",
    } as DescMessage;
    try {
      mkdirSync(join(stagedGeneratedRoot, "example"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true } }),
      );
      writeFileSync(
        join(stagedGeneratedRoot, "example/signals_pb.ts"),
        "export type Signal = {};\n",
      );
      const cases: readonly (readonly [string, string])[] = [
        ["export type SignalFamily = {};\n", "not an interface"],
        ["export interface Outer { }\n", "missing top-level interface"],
        ["export interface SignalFamily<T> {}\n", "generic interface is unbound"],
        ["export namespace Outer { export interface SignalFamily {} }\n", "nested interface"],
      ];
      for (const [source, diagnostic] of cases) {
        writeFileSync(authored, source);
        expect(() =>
          new AuthoredInterfaceProvider().resolve("SignalFamily", [member], sourceView),
        ).toThrow(diagnostic);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
