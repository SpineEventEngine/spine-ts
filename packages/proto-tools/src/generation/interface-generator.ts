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

import { getOption, type DescExtension, type DescFile, type DescMessage } from "@bufbuild/protobuf";
import { createEcmaScriptPlugin, runNodeJs, type Schema } from "@bufbuild/protoplugin";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

import type { InterfaceDeclarationProvider } from "./interface-provider.js";
import type { ModelSourceView } from "./source-view.js";

const authoredProviderModule = (await import(
  import.meta.url.endsWith(".ts")
    ? "./authored-interface-provider.ts"
    : "./authored-interface-provider.js"
)) as unknown as { readonly AuthoredInterfaceProvider: new () => InterfaceDeclarationProvider };
const { AuthoredInterfaceProvider } = authoredProviderModule;

const typescriptIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

/**
 * Reads the immutable source-view handoff for the post-Buf interface phase.
 *
 * @param cwd Plugin working directory containing its staged `output` tree.
 * @returns A validated source view, or undefined when no handoff was supplied.
 */
export function stagedSourceView(cwd: string = process.cwd()): ModelSourceView | undefined {
  const path = join(cwd, ".spine-source-view.json");
  if (!existsSync(path)) return undefined;
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (value === null || typeof value !== "object")
    throw new Error("spine-proto: invalid staged source view");
  const view = value as {
    readonly authoredFiles?: unknown;
    readonly liveGeneratedRoot?: unknown;
    readonly packageRoot?: unknown;
    readonly stagedGeneratedRoot?: unknown;
  };
  const expectedStage = resolve(cwd, "output");
  const within = (root: string, path: string) => {
    const pathRelative = relative(root, path);
    return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
  };
  if (
    typeof view.packageRoot !== "string" ||
    typeof view.stagedGeneratedRoot !== "string" ||
    typeof view.liveGeneratedRoot !== "string" ||
    !Array.isArray(view.authoredFiles)
  )
    throw new Error("spine-proto: invalid staged source view");
  const packageRoot = view.packageRoot;
  const stagedGeneratedRoot = view.stagedGeneratedRoot;
  const liveGeneratedRoot = view.liveGeneratedRoot;
  const rawAuthoredFiles = view.authoredFiles;
  const authoredFiles = rawAuthoredFiles.filter((file): file is string => typeof file === "string");
  const liveParent = dirname(liveGeneratedRoot);
  const liveName = basename(liveGeneratedRoot);
  const transactionStage = join(liveParent, `.${liveName}.stage-`);
  const transactionBackup = join(liveParent, `.${liveName}.`);
  const isTransactionArtifact = (file: string) =>
    file.startsWith(transactionStage) ||
    (file.startsWith(transactionBackup) && file.includes(".backup"));
  if (
    !isAbsolute(packageRoot) ||
    resolve(packageRoot) !== packageRoot ||
    !isAbsolute(stagedGeneratedRoot) ||
    resolve(stagedGeneratedRoot) !== stagedGeneratedRoot ||
    stagedGeneratedRoot !== expectedStage ||
    !isAbsolute(liveGeneratedRoot) ||
    resolve(liveGeneratedRoot) !== liveGeneratedRoot ||
    !within(packageRoot, liveGeneratedRoot) ||
    authoredFiles.length !== rawAuthoredFiles.length ||
    authoredFiles.some(
      (file) =>
        !isAbsolute(file) ||
        resolve(file) !== file ||
        !within(packageRoot, file) ||
        within(liveGeneratedRoot, file) ||
        within(stagedGeneratedRoot, file) ||
        isTransactionArtifact(file),
    )
  )
    throw new Error("spine-proto: invalid staged source view");
  return Object.freeze({
    authoredFiles: Object.freeze(authoredFiles.map((file) => file)),
    liveGeneratedRoot,
    packageRoot,
    stagedGeneratedRoot,
  });
}
const reservedTypeScriptWords = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "super",
  "switch",
  "static",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);
const protoPackage = "@spine-event-engine/proto";
const packagedOptions = (await import(protoPackage).catch(() => undefined)) as
  { readonly every_is: DescExtension; readonly is: DescExtension } | undefined;

function optionExtension(files: readonly DescFile[], name: "every_is" | "is"): DescExtension {
  const visited = new Set<DescFile>();
  const find = (candidates: readonly DescFile[]): DescExtension | undefined => {
    for (const file of candidates) {
      if (visited.has(file)) continue;
      visited.add(file);
      const extension = file.extensions.find((candidate) => candidate.name === name);
      if (extension !== undefined) return extension;
      const nested = find(file.dependencies);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  const extension = find(files);
  if (extension !== undefined) return extension;
  const packaged = name === "every_is" ? packagedOptions?.every_is : packagedOptions?.is;
  if (packaged !== undefined) return packaged;
  throw new Error(`spine-proto: missing (${name}) option descriptor`);
}

function companionPath(name: string): string {
  return `interfaces/${name.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase()}.ts`;
}

function collectMessages(messages: readonly DescMessage[]): readonly DescMessage[] {
  return messages.flatMap((message) => [message, ...collectMessages(message.nestedMessages)]);
}

function assertTypeName(name: string, source: string): void {
  if (!typescriptIdentifier.test(name) || reservedTypeScriptWords.has(name)) {
    throw new Error(`spine-proto: ${source}: ts_type must be a non-empty TypeScript identifier`);
  }
}

function validateMessageDeclarations(
  isOption: DescExtension,
  file: {
    readonly proto: { readonly name: string };
    readonly messages: readonly DescMessage[];
  },
): void {
  for (const message of collectMessages(file.messages)) {
    const option = getOption(message, isOption) as { readonly tsType: string };
    if (option.tsType.length > 0)
      assertTypeName(option.tsType, `${file.proto.name}:${message.name}`);
  }
}

/**
 * Generates file-scoped empty TypeScript interfaces and nominal schema tokens.
 *
 * Provider-resolved authored declarations are emitted when a compatible
 * discovery provider supplies them; unresolved declarations are omitted.
 */
export const InterfaceGenerator: Readonly<{
  generateCompanions(schema: Schema): void;
  generateWithProvider(
    schema: Schema,
    provider: InterfaceDeclarationProvider,
    sourceView?: ModelSourceView,
  ): void;
}> = Object.freeze({
  generateCompanions(schema: Schema): void {
    InterfaceGenerator.generateWithProvider(schema, new AuthoredInterfaceProvider());
  },

  generateWithProvider(
    schema: Schema,
    provider: InterfaceDeclarationProvider,
    suppliedSourceView?: ModelSourceView,
  ): void {
    const optionFiles =
      (schema as { readonly allFiles?: readonly DescFile[] }).allFiles ?? schema.files;
    const everyIs = optionExtension(optionFiles, "every_is");
    const isOption = optionExtension(optionFiles, "is");
    const sourceView = suppliedSourceView ?? stagedSourceView();
    const authored = new Map<string, DescMessage[]>();
    const generated = new Map<
      string,
      {
        readonly file: (typeof schema.files)[number];
        readonly members: readonly DescMessage[];
      }
    >();
    for (const file of schema.files) {
      validateMessageDeclarations(isOption, file);
      for (const message of collectMessages(file.messages)) {
        const declaration = getOption(message, isOption) as { readonly tsType: string };
        if (declaration.tsType.length === 0) continue;
        const members = authored.get(declaration.tsType) ?? [];
        members.push(message);
        authored.set(declaration.tsType, members);
      }
      const declaration = getOption(file, everyIs) as {
        readonly generate: boolean;
        readonly tsType: string;
      };
      if (declaration.generate) {
        assertTypeName(declaration.tsType, file.proto.name);
        if (generated.has(declaration.tsType))
          throw new Error(`spine-proto: ${file.proto.name}: duplicate generated interface name`);
        generated.set(declaration.tsType, { file, members: collectMessages(file.messages) });
      } else if (declaration.tsType.length > 0) {
        const members = authored.get(declaration.tsType) ?? [];
        members.push(...collectMessages(file.messages));
        authored.set(declaration.tsType, members);
      }
    }
    for (const name of authored.keys()) {
      if (generated.has(name))
        throw new Error(`spine-proto: generated and authored interface names conflict`);
    }
    const paths = new Set<string>();
    for (const name of [...generated.keys(), ...authored.keys()]) {
      const path = companionPath(name);
      if (paths.has(path))
        throw new Error(`spine-proto: duplicate interface companion path ${path}`);
      paths.add(path);
    }
    const resolved = [...authored.entries()].map(([name, members]) => ({
      name,
      members,
      declaration: provider.resolve(name, members, sourceView),
    }));
    for (const candidate of generated.values()) {
      if (candidate.members.length === 0)
        throw new Error(
          `${candidate.file.proto.name}: every_is cannot target an empty message set`,
        );
    }
    for (const candidate of resolved) {
      if (
        candidate.declaration !== undefined &&
        (candidate.declaration.name !== candidate.name ||
          candidate.declaration.importPath.length === 0)
      )
        throw new Error(
          "spine-proto: authored interface provider returned an irreconcilable declaration",
        );
    }
    for (const [name, candidate] of generated) {
      const members = candidate.members;
      const output = schema.generateFile(companionPath(name));
      const define = output.import("MessageInterfaces", "@spine-event-engine/core");
      const token = output.import("MessageInterface", "@spine-event-engine/core", true);
      const schemaImports = members.map((member) => output.importSchema(member));
      output.preamble(candidate.file);
      output.print(
        "/** Generated file-level message interface. */\n",
        `export interface ${name} {}\n\n`,
        "const memberSchemas = [",
        ...schemaImports.flatMap((member, index) => (index === 0 ? [member] : [", ", member])),
        "] as const;\n\n",
        "/** Generated nominal runtime token for this message interface. */\n",
        output.export("const", name),
        ": ",
        token,
        `<${name}, typeof memberSchemas> = `,
        define,
        `.define<${name}, typeof memberSchemas>(memberSchemas);\n`,
      );
    }
    for (const candidate of resolved) {
      if (candidate.declaration === undefined) continue;
      const output = schema.generateFile(companionPath(candidate.name));
      const define = output.import("MessageInterfaces", "@spine-event-engine/core");
      const token = output.import("MessageInterface", "@spine-event-engine/core", true);
      const schemaImports = candidate.members.map((member) => output.importSchema(member));
      const sourceFile = candidate.members[0]?.file;
      if (sourceFile === undefined)
        throw new Error("spine-proto: authored interface has no members");
      output.preamble(sourceFile);
      output.print(
        `import type { ${candidate.declaration.name} as Authored${candidate.name} } from ${JSON.stringify(
          candidate.declaration.importPath,
        )};\n\n`,
        `export type ${candidate.name} = Authored${candidate.name};\n\n`,
        "const memberSchemas = [",
        ...schemaImports.flatMap((member, index) => (index === 0 ? [member] : [", ", member])),
        `] as const;\n\nexport const ${candidate.name}: `,
        token,
        `<Authored${candidate.name}, typeof memberSchemas> = `,
        define,
        `.define<Authored${candidate.name}, typeof memberSchemas>(memberSchemas);\n`,
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
