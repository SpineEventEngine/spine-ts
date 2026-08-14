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

import { mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  it("resolves an authored interface through a local declaration compiler input", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-declaration-input-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const authored = join(root, "src/signal-family.ts");
    const declaration = join(root, "src/helper.d.ts");
    try {
      mkdirSync(stagedGeneratedRoot, { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "tsconfig.json"),
        JSON.stringify({ files: ["src/signal-family.ts"] }),
      );
      writeFileSync(declaration, "export interface Helper { readonly text: string }\n");
      writeFileSync(
        authored,
        'import type { Helper } from "./helper.js";\n' +
          "export interface SignalFamily { readonly helper: Helper }\n",
      );
      expect(
        new AuthoredInterfaceProvider().resolve("SignalFamily", [], {
          authoredFiles: [authored],
          compilerFiles: [authored, declaration],
          liveGeneratedRoot,
          packageRoot: root,
          stagedGeneratedRoot,
        }),
      ).toEqual({ name: "SignalFamily", importPath: "../../signal-family.js" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a local diamond inheritance graph", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-diamond-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const authored = join(root, "src/signal-family.ts");
    try {
      mkdirSync(join(stagedGeneratedRoot, "example"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true } }),
      );
      writeFileSync(
        join(stagedGeneratedRoot, "example/signals_pb.ts"),
        "export type Signal = { readonly text: string };\n",
      );
      writeFileSync(
        authored,
        "export interface Base { readonly text: string }\n" +
          "export interface Left extends Base {}\n" +
          "export interface Right extends Base {}\n" +
          "export interface SignalFamily extends Left, Right {}\n",
      );
      expect(
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
      ).toBeDefined();
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

  it("uses tsconfig file membership instead of the broad source-view inventory", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-tsconfig-membership-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const authored = join(root, "src/excluded.ts");
    try {
      mkdirSync(join(stagedGeneratedRoot, "example"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ files: ["src/included.ts"] }));
      writeFileSync(join(root, "src/included.ts"), "export interface Included {}\n");
      writeFileSync(authored, "export interface SignalFamily {}\n");
      writeFileSync(
        join(stagedGeneratedRoot, "example/signals_pb.ts"),
        "export type Signal = {};\n",
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
      ).toThrow("missing top-level interface");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a local parent imported outside explicit tsconfig root files", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-transitive-parent-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const child = join(root, "src/child.ts");
    const parent = join(root, "src/parent.ts");
    try {
      mkdirSync(join(stagedGeneratedRoot, "example"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ files: ["src/child.ts"] }));
      writeFileSync(parent, "export interface Parent { readonly text: string }\n");
      writeFileSync(
        child,
        'import type { Parent } from "./parent.js";\n' +
          "export interface SignalFamily extends Parent {}\n",
      );
      writeFileSync(
        join(stagedGeneratedRoot, "example/signals_pb.ts"),
        "export type Signal = { readonly text: string };\n",
      );
      expect(
        new AuthoredInterfaceProvider().resolve(
          "SignalFamily",
          [
            {
              file: { proto: { name: "example/signals.proto", package: "example" } },
              name: "Signal",
              typeName: "example.Signal",
            } as DescMessage,
          ],
          {
            authoredFiles: [child, parent],
            liveGeneratedRoot,
            packageRoot: root,
            stagedGeneratedRoot,
          },
        ),
      ).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("redirects authored live-generated imports to the divergent staged output", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-staged-import-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const authored = join(root, "src/interface.ts");
    try {
      mkdirSync(join(stagedGeneratedRoot, "example"), { recursive: true });
      mkdirSync(join(liveGeneratedRoot, "example"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" } }),
      );
      writeFileSync(
        join(liveGeneratedRoot, "example/signals_pb.ts"),
        "export type Signal = { readonly stale: string };\n",
      );
      writeFileSync(
        join(stagedGeneratedRoot, "example/signals_pb.ts"),
        "export type Signal = { readonly text: string };\n",
      );
      writeFileSync(
        authored,
        'import type { Signal } from "./generated/example/signals_pb.js";\n' +
          "export interface SignalFamily { readonly text: string; readonly payload?: Signal }\n",
      );
      expect(
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
      ).toBeDefined();
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
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ extends: "./base.json" }));
      writeFileSync(join(root, "base.json"), JSON.stringify({ compilerOptions: { strict: true } }));
      writeFileSync(
        join(stagedGeneratedRoot, "example/signals_pb.ts"),
        "export type Signal = {};\n",
      );
      const cases: readonly (readonly [string, string])[] = [
        ["export type SignalFamily = {};\n", "not an interface"],
        ["export interface Outer { }\n", "missing top-level interface"],
        ["export interface SignalFamily<T> {}\n", "generic interface is unbound"],
        ["export namespace Outer { export interface SignalFamily {} }\n", "nested interface"],
        ["interface SignalFamily {}\n", "named module export"],
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
  }, 15_000);

  it("rejects generated and declaration outputs as authored candidates before analysis", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-path-"));
    const liveGeneratedRoot = join(root, "src/generated");
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const generated = join(liveGeneratedRoot, "example/signals_pb.ts");
    try {
      mkdirSync(join(liveGeneratedRoot, "example"), { recursive: true });
      mkdirSync(join(stagedGeneratedRoot, "example"), { recursive: true });
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ extends: "./base.json" }));
      writeFileSync(join(root, "base.json"), JSON.stringify({ compilerOptions: { strict: true } }));
      writeFileSync(generated, "export interface SignalFamily {}\n");
      writeFileSync(
        join(stagedGeneratedRoot, "example/signals_pb.ts"),
        "export type Signal = {};\n",
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
          { authoredFiles: [generated], liveGeneratedRoot, packageRoot: root, stagedGeneratedRoot },
        ),
      ).toThrow("source path escapes model module");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an incomplete authored interface through TypeScript assignability", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-incompatible-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const authored = join(root, "src/interface.ts");
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
      writeFileSync(authored, "export interface SignalFamily { readonly required: string }\n");
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
      ).toThrow("incompatible message example.Signal");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses one source snapshot when authored sources change during an interface phase", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-snapshot-"));
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
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ extends: "./base.json" }));
      writeFileSync(join(root, "base.json"), JSON.stringify({ compilerOptions: { strict: true } }));
      writeFileSync(
        join(stagedGeneratedRoot, "example/signals_pb.ts"),
        "export type Signal = { readonly text: string };\n",
      );
      writeFileSync(
        authored,
        "export interface Parent { readonly text: string }\n" +
          "export interface First extends Parent {}\n" +
          "export interface Second extends Parent {}\n",
      );
      const provider = new AuthoredInterfaceProvider();
      expect(provider.resolve("First", [member], sourceView)).toBeDefined();
      const renamed = join(root, "src/interfaces-renamed.ts");
      renameSync(authored, renamed);
      writeFileSync(
        join(root, "src/added.ts"),
        "export interface Added { readonly missing: string }\n",
      );
      writeFileSync(
        join(root, "base.json"),
        JSON.stringify({ compilerOptions: { strict: false } }),
      );
      writeFileSync(
        renamed,
        "export interface Parent { readonly missing: string }\n" +
          "export interface First extends Parent {}\n" +
          "export interface Second extends Parent {}\n",
      );
      expect(provider.resolve("Second", [member], sourceView)).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects symlink, stage, backup, dist, and declaration authored candidates", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-exclusions-"));
    const liveGeneratedRoot = join(root, "src/generated");
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const external = join(root, "external.ts");
    const member = {
      file: { proto: { name: "example/signals.proto", package: "example" } },
      name: "Signal",
      typeName: "example.Signal",
    } as DescMessage;
    try {
      mkdirSync(join(root, "src/.generated.stage-x"), { recursive: true });
      mkdirSync(join(root, "src/.generated.1.backup"), { recursive: true });
      mkdirSync(join(root, "dist"), { recursive: true });
      mkdirSync(join(stagedGeneratedRoot, "example"), { recursive: true });
      writeFileSync(
        join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true } }),
      );
      writeFileSync(
        join(stagedGeneratedRoot, "example/signals_pb.ts"),
        "export type Signal = {};\n",
      );
      writeFileSync(external, "export interface SignalFamily {}\n");
      const symlink = join(root, "src/symlink.ts");
      symlinkSync(external, symlink);
      for (const candidate of [
        symlink,
        join(root, "src/.generated.stage-x/source.ts"),
        join(root, "src/.generated.1.backup/source.ts"),
        join(root, "dist/source.ts"),
        join(root, "src/source.d.ts"),
      ]) {
        if (!candidate.endsWith("symlink.ts"))
          writeFileSync(candidate, "export interface SignalFamily {}\n");
        let diagnostic = "";
        try {
          new AuthoredInterfaceProvider().resolve("SignalFamily", [member], {
            authoredFiles: [candidate],
            liveGeneratedRoot,
            packageRoot: root,
            stagedGeneratedRoot,
          });
        } catch (error) {
          diagnostic = String(error);
        }
        expect(diagnostic, candidate).toContain("source path escapes model module");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous and cyclic local interface declarations", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-cycle-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const first = join(root, "src/first.ts");
    const second = join(root, "src/second.ts");
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
      writeFileSync(first, "export interface SignalFamily {}\n");
      writeFileSync(second, "export interface SignalFamily {}\n");
      expect(() =>
        new AuthoredInterfaceProvider().resolve("SignalFamily", [member], {
          authoredFiles: [first, second],
          liveGeneratedRoot,
          packageRoot: root,
          stagedGeneratedRoot,
        }),
      ).toThrow("ambiguous top-level interface");
      writeFileSync(
        first,
        "export interface SignalFamily extends Parent {}\nexport interface Parent extends SignalFamily {}\n",
      );
      expect(() =>
        new AuthoredInterfaceProvider().resolve("SignalFamily", [member], {
          authoredFiles: [first],
          liveGeneratedRoot,
          packageRoot: root,
          stagedGeneratedRoot,
        }),
      ).toThrow("cyclic extends chain");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed for absent and invalid compiler inputs", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-config-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const authored = join(root, "src/interface.ts");
    const member = {
      file: { proto: { name: "example/signals.proto", package: "example" } },
      name: "Signal",
      typeName: "Signal",
    } as DescMessage;
    const view = {
      authoredFiles: [authored],
      liveGeneratedRoot,
      packageRoot: root,
      stagedGeneratedRoot,
    };
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(stagedGeneratedRoot, { recursive: true });
      writeFileSync(authored, "export interface SignalFamily {}\n");
      const provider = new AuthoredInterfaceProvider();
      expect(provider.resolve("SignalFamily", [member], undefined)).toBeUndefined();
      expect(() => provider.resolve("SignalFamily", [member], view)).toThrow(
        "requires tsconfig.json",
      );
      writeFileSync(join(root, "tsconfig.json"), "{ invalid");
      expect(() => new AuthoredInterfaceProvider().resolve("SignalFamily", [member], view)).toThrow(
        "could not read tsconfig.json",
      );
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ include: 1 }));
      expect(() => new AuthoredInterfaceProvider().resolve("SignalFamily", [member], view)).toThrow(
        "invalid tsconfig.json",
      );
      writeFileSync(
        join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true } }),
      );
      expect(() => new AuthoredInterfaceProvider().resolve("SignalFamily", [member], view)).toThrow(
        "missing staged generated message",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects non-interface and generic local extends parents", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-parent-shape-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const authored = join(root, "src/interface.ts");
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
      for (const [source, diagnostic] of [
        [
          "export type Parent = {}; export interface SignalFamily extends Parent {}\n",
          "extends parent must stay",
        ],
        [
          "export interface Parent<T> {}; export interface SignalFamily extends Parent<string> {}\n",
          "generic extends parent",
        ],
        ["export interface SignalFamily extends Unknown {}\n", "extends parent must stay"],
      ] as const) {
        writeFileSync(authored, source);
        expect(() =>
          new AuthoredInterfaceProvider().resolve("SignalFamily", [member], {
            authoredFiles: [authored],
            liveGeneratedRoot,
            packageRoot: root,
            stagedGeneratedRoot,
          }),
        ).toThrow(diagnostic);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a missing generated member export before accepting an authored declaration", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-member-export-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const authored = join(root, "src/interface.ts");
    try {
      mkdirSync(join(stagedGeneratedRoot, "example"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true } }),
      );
      writeFileSync(authored, "export interface SignalFamily {}\n");
      writeFileSync(
        join(stagedGeneratedRoot, "example/signals_pb.ts"),
        "export type Other = {};\n",
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
      ).toThrow("missing staged generated message");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
