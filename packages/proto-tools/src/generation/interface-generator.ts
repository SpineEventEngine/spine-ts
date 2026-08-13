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

import { getOption, type DescMessage } from "@bufbuild/protobuf";
import { createEcmaScriptPlugin, runNodeJs, type Schema } from "@bufbuild/protoplugin";
import { every_is, is } from "@spine-event-engine/proto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const typescriptIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

function collectMessages(messages: readonly DescMessage[]): readonly DescMessage[] {
  return messages.flatMap((message) => [message, ...collectMessages(message.nestedMessages)]);
}

function assertTypeName(name: string, source: string): void {
  if (!typescriptIdentifier.test(name)) {
    throw new Error(`spine-proto: ${source}: ts_type must be a non-empty TypeScript identifier`);
  }
}

function validateMessageDeclarations(file: {
  readonly proto: { readonly name: string };
  readonly messages: readonly DescMessage[];
}): void {
  for (const message of collectMessages(file.messages)) {
    const option = getOption(message, is);
    if (option.tsType.length > 0)
      assertTypeName(option.tsType, `${file.proto.name}:${message.name}`);
  }
}

/**
 * Generates file-scoped empty TypeScript interfaces and nominal schema tokens.
 *
 * Authored interface discovery and message-level conformance are intentionally
 * owned by T-0182; this phase only materializes `(every_is).generate = true`.
 */
export const InterfaceGenerator: Readonly<{
  generateCompanions(schema: Schema): void;
}> = Object.freeze({
  generateCompanions(schema: Schema): void {
    for (const file of schema.files) {
      const option = getOption(file, every_is);
      validateMessageDeclarations(file);
      if (!option.generate) continue;
      assertTypeName(option.tsType, file.proto.name);
      const members = collectMessages(file.messages);
      if (members.length === 0) {
        throw new Error(
          `spine-proto: ${file.proto.name}: every_is cannot target an empty message set`,
        );
      }
      const output = schema.generateFile(`interfaces/${file.name}.ts`);
      const define = output.import("MessageInterfaces", "@spine-event-engine/core");
      const token = output.import("MessageInterface", "@spine-event-engine/core", true);
      const schemaImports = members.map((member) => output.importSchema(member));
      output.preamble(file);
      output.print(
        "/** Generated file-level message interface. */\n",
        output.export("interface", option.tsType),
        " {}\n\n",
        `const memberSchemas = [${schemaImports.join(", ")}] as const;\n\n`,
        "/** Generated nominal runtime token for this message interface. */\n",
        output.export("const", option.tsType),
        `: ${token}<${option.tsType}, typeof memberSchemas> = ${define}.define<${option.tsType}, typeof memberSchemas>(memberSchemas);\n`,
      );
    }
  },
});

const interfacePlugin = createEcmaScriptPlugin({
  name: "protoc-gen-spine-interfaces",
  version: "1.0.0",
  generateTs: InterfaceGenerator.generateCompanions,
});

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runNodeJs(interfacePlugin);
