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

import { create, setExtension } from "@bufbuild/protobuf";
import { fileDesc } from "@bufbuild/protobuf/codegenv2";
import { base64Encode } from "@bufbuild/protobuf/wire";
import { toBinary } from "@bufbuild/protobuf";
import { FileDescriptorProtoSchema } from "@bufbuild/protobuf/wkt";
import {
  EveryIsOptionSchema,
  IsOptionSchema,
  every_is,
  file_spine_options,
  is,
} from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

import { InterfaceGenerator, stagedSourceView } from "../src/generation/interface-generator.js";
import { AuthoredInterfaceProvider } from "../src/generation/authored-interface-provider.js";
import type { Schema } from "@bufbuild/protoplugin";

function optionFile(
  tsType: string,
  generate = true,
  messageType = "",
  javaType = "",
  sourceName = "example/signals.proto",
  packageName = "example",
) {
  const file = create(FileDescriptorProtoSchema, {
    name: sourceName,
    package: packageName,
    dependency: ["spine/options.proto"],
    options: {},
    messageType: [
      {
        name: "Signal",
        nestedType: [{ name: "Nested" }],
        options: {},
      },
    ],
  });
  if (file.options === undefined) throw new Error("fixture options are missing");
  setExtension(file.options, every_is, create(EveryIsOptionSchema, { generate, tsType, javaType }));
  if (messageType.length > 0) {
    const message = file.messageType[0];
    if (message?.options === undefined) throw new Error("fixture message options are missing");
    setExtension(message.options, is, create(IsOptionSchema, { tsType: messageType }));
  }
  return fileDesc(base64Encode(toBinary(FileDescriptorProtoSchema, file)), [file_spine_options]);
}

describe("InterfaceGenerator", () => {
  it("emits one same-name type/value companion with nested schema membership", () => {
    const printed: string[] = [];
    const generated: string[] = [];
    const schema = {
      files: [optionFile("SignalFamily")],
      generateFile: (name: string) => {
        generated.push(name);
        return {
          import: (name_: string) => name_,
          importSchema: (message: { readonly name: string }) => `${message.name}Schema`,
          preamble: () => {
            return undefined;
          },
          export: (kind: string, name_: string) => `export ${kind} ${name_}`,
          print: (...parts: readonly string[]) => printed.push(parts.join("")),
        };
      },
    } as unknown as Schema;

    InterfaceGenerator.generateCompanions(schema);

    expect(generated).toEqual(["interfaces/signal-family.ts"]);
    expect(printed.join("")).toContain("export interface SignalFamily {}");
    expect(printed.join("")).toContain("[SignalSchema, NestedSchema] as const");
    expect(printed.join("")).toContain("export const SignalFamily");
  });

  it("rejects empty and invalid generated TypeScript names before emitting output", () => {
    for (const name of ["", "Outer.Inner", "not-valid", "default", "class", "await"]) {
      const schema = {
        files: [optionFile(name)],
        generateFile: () => {
          throw new Error("invalid declaration must not emit output");
        },
      } as unknown as Schema;
      expect(() => {
        InterfaceGenerator.generateCompanions(schema);
      }).toThrow("ts_type");
    }
  });

  it("does not emit a companion when every_is generation is disabled", () => {
    const schema = {
      files: [optionFile("AuthoredSignal", false)],
      generateFile: () => {
        throw new Error("authored declaration must not emit output");
      },
    } as unknown as Schema;

    InterfaceGenerator.generateCompanions(schema);
  });

  it("ignores JVM-only interface declarations", () => {
    const schema = {
      files: [optionFile("", false, "", "example.jvm.Signal")],
      generateFile: () => {
        throw new Error("JVM-only declaration must not emit output");
      },
    } as unknown as Schema;

    InterfaceGenerator.generateCompanions(schema);
  });

  it("validates message declarations while retaining generated file membership", () => {
    const printed: string[] = [];
    const schema = {
      files: [optionFile("SignalFamily", true, "AuthoredSignal")],
      generateFile: () => ({
        import: (name: string) => name,
        importSchema: (message: { readonly typeName: string }) =>
          `${message.typeName.replaceAll(".", "_")}Schema`,
        preamble: () => {
          return undefined;
        },
        export: (kind: string, name: string) => `export ${kind} ${name}`,
        print: (...parts: readonly string[]) => printed.push(parts.join("")),
      }),
    } as unknown as Schema;

    InterfaceGenerator.generateCompanions(schema);

    expect(printed.join("")).toContain(
      "[example_SignalSchema, example_Signal_NestedSchema] as const",
    );
  });

  it("hands message declarations to the authored-interface provider seam", () => {
    const resolved: string[] = [];
    const output: string[] = [];
    const schema = {
      files: [optionFile("SignalFamily", true, "AuthoredSignal")],
      generateFile: (path: string) => ({
        import: (name: string) => name,
        importSchema: (message: { readonly typeName: string }) =>
          `${message.typeName.replaceAll(".", "_")}Schema`,
        preamble: () => {
          return undefined;
        },
        export: (kind: string, name: string) => `export ${kind} ${name}`,
        print: (...parts: readonly string[]) => output.push(`${path}:${parts.join("")}`),
      }),
    } as unknown as Schema;

    InterfaceGenerator.generateWithProvider(schema, {
      resolve: (name) => {
        resolved.push(name);
        return { name, importPath: "../src/authored.js" };
      },
    });

    expect(resolved).toEqual(["AuthoredSignal"]);
    expect(output.join("")).toContain("interfaces/authored-signal.ts");
    expect(output.join("")).toContain('from "../src/authored.js"');
    expect(output.join("")).toContain("export type AuthoredSignal = AuthoredAuthoredSignal");
    expect(output.join("")).toContain("export const AuthoredSignal");
  });

  it("rejects malformed message interface declarations before output", () => {
    const schema = {
      files: [optionFile("SignalFamily", true, "Outer.Inner")],
      generateFile: () => {
        throw new Error("invalid declaration must not emit output");
      },
    } as unknown as Schema;

    expect(() => {
      InterfaceGenerator.generateCompanions(schema);
    }).toThrow("ts_type");
  });

  it("rejects planned name and provider conflicts before opening output", () => {
    for (const files of [
      [optionFile("SignalFamily"), optionFile("SignalFamily")],
      [optionFile("SignalFamily", true, "SignalFamily")],
    ]) {
      let generated = 0;
      const schema = {
        files,
        generateFile: () => {
          generated++;
          throw new Error("must not emit");
        },
      } as unknown as Schema;
      expect(() => {
        InterfaceGenerator.generateCompanions(schema);
      }).toThrow(/duplicate|conflict/u);
      expect(generated).toBe(0);
    }
    for (const declaration of [
      { name: "Different", importPath: "../src/authored.js" },
      { name: "AuthoredSignal", importPath: "" },
    ]) {
      let generated = 0;
      const schema = {
        files: [optionFile("SignalFamily", true, "AuthoredSignal")],
        generateFile: () => {
          generated++;
          throw new Error("must not emit");
        },
      } as unknown as Schema;
      expect(() => {
        InterfaceGenerator.generateWithProvider(schema, { resolve: () => declaration });
      }).toThrow("irreconcilable");
      expect(generated).toBe(0);
    }
  });

  it("accumulates nested members across files in one authored provider call", () => {
    const calls: readonly unknown[][] = [];
    const output: string[] = [];
    const schema = {
      files: [
        optionFile("", false, "SharedSignal"),
        optionFile("", false, "SharedSignal", "", "other/signals.proto", "other"),
      ],
      generateFile: () => ({
        import: (name: string) => name,
        importSchema: (message: { readonly typeName: string }) =>
          `${message.typeName.replaceAll(".", "_")}Schema`,
        preamble: () => {
          return undefined;
        },
        export: (kind: string, name: string) => `export ${kind} ${name}`,
        print: (...parts: readonly string[]) => output.push(parts.join("")),
      }),
    } as unknown as Schema;
    InterfaceGenerator.generateWithProvider(schema, {
      resolve: (name, members) => {
        (calls as unknown[][]).push([...members]);
        return { name, importPath: "../src/shared.js" };
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(output.join("")).toContain("example_SignalSchema, other_SignalSchema");
  });

  it("rejects authored companion-path collisions before output", () => {
    let generated = 0;
    const schema = {
      files: [optionFile("", false, "AB"), optionFile("", false, "Ab")],
      generateFile: () => {
        generated++;
        throw new Error("must not emit");
      },
    } as unknown as Schema;
    expect(() => {
      InterfaceGenerator.generateCompanions(schema);
    }).toThrow("duplicate interface companion path");
    expect(generated).toBe(0);
  });

  it("emits resolved authored companions for non-generated every_is and is declarations", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-authored-interface-phase-"));
    const stagedGeneratedRoot = join(root, ".generated.stage-1/output");
    const liveGeneratedRoot = join(root, "src/generated");
    const authored = join(root, "src/interfaces.ts");
    const output: string[] = [];
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
        "export type Signal = { readonly text: string };\n" +
          "export type Signal_Nested = { readonly text: string };\n",
      );
      writeFileSync(
        authored,
        "export interface FileSignal { readonly text: string }\n" +
          "export interface MessageSignal { readonly text: string }\n",
      );
      const schema = {
        files: [optionFile("FileSignal", false, "MessageSignal")],
        generateFile: (path: string) => ({
          import: (name: string) => name,
          importSchema: (message: { readonly name: string }) => `${message.name}Schema`,
          preamble: () => {
            return undefined;
          },
          export: (kind: string, name: string) => `export ${kind} ${name}`,
          print: (...parts: readonly string[]) => output.push(`${path}:${parts.join("")}`),
        }),
      } as unknown as Schema;
      InterfaceGenerator.generateWithProvider(schema, new AuthoredInterfaceProvider(), {
        authoredFiles: [authored],
        liveGeneratedRoot,
        packageRoot: root,
        stagedGeneratedRoot,
      });
      expect(output.join("")).toContain("interfaces/file-signal.ts");
      expect(output.join("")).toContain("interfaces/message-signal.ts");
      expect(output.join("")).toContain("export type FileSignal = AuthoredFileSignal");
      expect(output.join("")).toContain("export type MessageSignal = AuthoredMessageSignal");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not open staged output when authored discovery fails", () => {
    let generated = 0;
    const schema = {
      files: [optionFile("FileSignal", false, "MessageSignal")],
      generateFile: () => {
        generated += 1;
        throw new Error("must not publish partial companions");
      },
    } as unknown as Schema;
    expect(() => {
      InterfaceGenerator.generateWithProvider(schema, {
        resolve: () => {
          throw new Error(
            "spine-proto: authored interface MessageSignal: missing top-level interface",
          );
        },
      });
    }).toThrow("missing top-level interface");
    expect(generated).toBe(0);
  });

  it("fails closed for malformed staged source-view metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-staged-source-view-"));
    const packageRoot = join(root, "model");
    const liveGeneratedRoot = join(packageRoot, "src/generated");
    const stagedGeneratedRoot = join(root, "output");
    const authored = join(packageRoot, "src/authored.ts");
    mkdirSync(join(packageRoot, "src/generated"), { recursive: true });
    mkdirSync(stagedGeneratedRoot);
    writeFileSync(authored, "export interface Authored {}\n");
    const write = (value: object) => {
      writeFileSync(join(root, ".spine-source-view.json"), `${JSON.stringify(value)}\n`);
    };
    const valid = {
      authoredFiles: [authored],
      liveGeneratedRoot,
      packageRoot,
      stagedGeneratedRoot,
    };
    try {
      write(valid);
      const view = stagedSourceView(root);
      expect(view).toEqual(valid);
      expect(Object.isFrozen(view)).toBe(true);
      expect(Object.isFrozen(view?.authoredFiles)).toBe(true);
      for (const malformed of [
        { ...valid, stagedGeneratedRoot: join(root, "wrong-output") },
        { ...valid, liveGeneratedRoot: join(root, "outside") },
        { ...valid, authoredFiles: [join(liveGeneratedRoot, "live.ts")] },
        { ...valid, authoredFiles: [join(packageRoot, "src/.generated.stage-1/staged.ts")] },
        { ...valid, authoredFiles: [join(packageRoot, "src/.generated.1.backup/old.ts")] },
      ]) {
        write(malformed);
        expect(() => stagedSourceView(root)).toThrow("invalid staged source view");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a non-canonical live generated root in staged source-view metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-staged-source-view-live-root-"));
    const packageRoot = join(root, "model");
    const liveGeneratedRoot = join(packageRoot, "src/generated");
    try {
      mkdirSync(liveGeneratedRoot, { recursive: true });
      mkdirSync(join(root, "output"));
      writeFileSync(
        join(root, ".spine-source-view.json"),
        `${JSON.stringify({
          authoredFiles: [join(packageRoot, "src/authored.ts")],
          liveGeneratedRoot: `${packageRoot}/src/../src/generated`,
          packageRoot,
          stagedGeneratedRoot: join(root, "output"),
        })}\n`,
      );
      expect(() => stagedSourceView(root)).toThrow("invalid staged source view");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an authored entry beneath the current staged output root", () => {
    const root = mkdtempSync(join(tmpdir(), "spine-staged-source-view-output-"));
    const liveGeneratedRoot = join(root, "src/generated");
    const stagedGeneratedRoot = join(root, "output");
    try {
      mkdirSync(liveGeneratedRoot, { recursive: true });
      mkdirSync(stagedGeneratedRoot);
      writeFileSync(
        join(root, ".spine-source-view.json"),
        `${JSON.stringify({
          authoredFiles: [join(stagedGeneratedRoot, "staged.ts")],
          liveGeneratedRoot,
          packageRoot: root,
          stagedGeneratedRoot,
        })}\n`,
      );
      expect(() => stagedSourceView(root)).toThrow("invalid staged source view");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
