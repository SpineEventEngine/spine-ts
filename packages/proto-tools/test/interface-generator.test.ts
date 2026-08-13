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

import { InterfaceGenerator } from "../src/generation/interface-generator.js";
import type { Schema } from "@bufbuild/protoplugin";

function optionFile(tsType: string, generate = true, messageType = "", javaType = "") {
  const file = create(FileDescriptorProtoSchema, {
    name: "example/signals.proto",
    package: "example",
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
          preamble: () => undefined,
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
    for (const name of ["", "Outer.Inner", "not-valid"]) {
      const schema = {
        files: [optionFile(name)],
        generateFile: () => {
          throw new Error("invalid declaration must not emit output");
        },
      } as unknown as Schema;
      expect(() => InterfaceGenerator.generateCompanions(schema)).toThrow("ts_type");
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
        importSchema: (message: { readonly name: string }) => `${message.name}Schema`,
        preamble: () => undefined,
        export: (kind: string, name: string) => `export ${kind} ${name}`,
        print: (...parts: readonly string[]) => printed.push(parts.join("")),
      }),
    } as unknown as Schema;

    InterfaceGenerator.generateCompanions(schema);

    expect(printed.join("")).toContain("[SignalSchema, NestedSchema] as const");
  });

  it("hands message declarations to the authored-interface provider seam", () => {
    const resolved: string[] = [];
    const output: string[] = [];
    const schema = {
      files: [optionFile("SignalFamily", true, "AuthoredSignal")],
      generateFile: (path: string) => ({
        import: (name: string) => name,
        importSchema: (message: { readonly name: string }) => `${message.name}Schema`,
        preamble: () => undefined,
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

    expect(() => InterfaceGenerator.generateCompanions(schema)).toThrow("ts_type");
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
      expect(() => InterfaceGenerator.generateCompanions(schema)).toThrow(/duplicate|conflict/u);
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
      expect(() =>
        InterfaceGenerator.generateWithProvider(schema, { resolve: () => declaration }),
      ).toThrow("irreconcilable");
      expect(generated).toBe(0);
    }
  });
});
