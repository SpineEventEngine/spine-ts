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

import { spawnSync } from "node:child_process";
import { closeSync, constants, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  BuildAppQueryHandler,
  BuildHandlerAnalysis,
  BuildHandlerRecord,
  BuildReceiverHandlers,
  BuildWhereOptions,
  SchemaReference,
} from "./build-time-handler-analyzer.js";

const defaultRegistryConst = "spineMetadata";
const defaultRegistryModule = "@spine-event-engine/server/spi/handler-registry";
const registryTypeName = "SpineMetadata";
const identRe = /^[$A-Z_a-z][$\w]*$/;
const reservedWords = new Set([
  "arguments",
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
  "eval",
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
  "static",
  "super",
  "switch",
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

interface ImportRef {
  readonly importedName: string;
  readonly localName: string;
  readonly moduleSpecifier: string;
  readonly defaultExport?: boolean;
}

interface RenderRefs {
  readonly entityNames: ReadonlyMap<string, string>;
  readonly schemaNames: ReadonlyMap<string, string>;
  readonly imports: readonly string[];
  readonly localNames: ReadonlySet<string>;
}

/**
 * Options for deterministic generated-registry source rendering.
 */
export interface RegistryRenderOptions {
  // prettier-ignore

  /**
   * Absolute or caller-owned output file used for relative import rendering.
   */
  readonly outputFile: string;

  /**
   * Type-only module specifier used for the generated registry contract.
   */
  readonly registryModuleSpecifier?: string;

  /**
   * Exported constant name for the generated registry object.
   */
  readonly registryName?: string;

  /**
   * Exported Proto module in the generated local `proto-module.ts`, if present.
   */
  readonly protoModuleExport?: string;

  /**
   * Module specifier for the exported Proto module; local by default.
   */
  readonly protoModuleSpecifier?: string;
}

/**
 * Options for guarded generated-registry file writing.
 */
export interface RegistryWriteOptions extends RegistryRenderOptions {
  // prettier-ignore

  /**
   * Repository root used for Git-ignore and symlink validation.
   */
  readonly repoRoot: string;

  /**
   * Explicit generated directory that must own the output file.
   */
  readonly generatedRoot: string;

  /**
   * Published output path used for relative imports when writing to staging.
   */
  readonly publishedOutputFile?: string;

  /**
   * Discovered passive metadata packages for the generated bootstrap.
   */
  readonly dependencies?: readonly { readonly name: string }[];
}

/**
 * Build-time writer for unversioned generated handler registry source.
 */
export class GeneratedRegistryWriter {
  // prettier-ignore

  /**
   * Renders the local application bootstrap without starting a Server.
   *
   * @param options Metadata export name used by the generated bootstrap.
   * @returns Static metadata registration source.
   */
  renderBootstrap(options: Pick<RegistryRenderOptions, "registryName"> & {
    readonly dependencies?: readonly { readonly name: string }[];
  } = {}): string {
    const registryName = options.registryName ?? defaultRegistryConst;
    RegistrySource.assertRegistryName(registryName, new Set([registryTypeName]));
    const registrationName = registryName === "registerSpineMetadata"
      ? "registerSpineMetadata_2" : "registerSpineMetadata";
    const registrationImport = registrationName === "registerSpineMetadata"
      ? registrationName : `registerSpineMetadata as ${registrationName}`;
    const dependencies = (options.dependencies ?? []).map((dependency, index) => ({
      name: dependency.name,
      binding: `dependencyMetadata${String(index)}`,
    }));
    return [
      `import { ${registrationImport} } from "@spine-event-engine/server/spi/handler-registry";`,
      `import { ${registryName} } from "./spine-metadata.js";`,
      dependencies.length === 0
        ? 'import "./spine-dependencies.js";'
        : `import { ${dependencies.map(({ binding }) => binding).join(", ")} } from "./spine-dependencies.js";`,
      "",
      `${registrationName}(${registryName}, "./spine-metadata.js");`,
      ...dependencies.map(({ name, binding }) =>
        `${registrationName}(${binding}, ${RegistrySource.stringLiteral(`${name}/spine`)});`),
      "",
    ].join("\n");
  }

  /**
   * Renders a passive adapter against one bootstrap location.
   *
   * @param dependencies Resolved public Spine exports and portable direct imports.
   * @param fromDirectory Directory receiving the adapter.
   * @param format Runtime module condition of the consuming package.
   * @returns Static JavaScript re-exports and matching declaration bindings.
   */
  renderDependencies(
    dependencies: readonly {
      readonly runtimeFile: string;
      readonly typesFile: string;
      readonly moduleSpecifier?: string;
    }[],
    fromDirectory: string,
    format: "import" | "require" = "import",
  ): { readonly runtime: string; readonly declarations: string } {
    const header = "/* Generated by Spine TypeScript. Do not edit manually. */\n";
    const runtime = dependencies.map(({ runtimeFile, moduleSpecifier }, index) => {
      const path = moduleSpecifier ?? RegistrySource.relativeModule(fromDirectory, runtimeFile);
      const binding = `dependencyMetadata${String(index)}`;
      const specifier = RegistrySource.stringLiteral(path);
      return format === "import"
        ? `export { spineMetadata as ${binding} } from ${specifier};`
        : `exports.${binding} = require(${specifier}).spineMetadata;`;
    });
    const declarations = dependencies.map(({ typesFile, moduleSpecifier }, index) => {
      const path = moduleSpecifier ?? RegistrySource.relativeModule(fromDirectory, typesFile);
      const binding = `dependencyMetadata${String(index)}`;
      const specifier = RegistrySource.stringLiteral(path);
      return `export declare const ${binding}: typeof import(${specifier}).spineMetadata;`;
    });
    return {
      runtime: `${header}${runtime.join("\n")}\n${runtime.length === 0 && format === "import" ? "export {};\n" : ""}`,
      declarations: `${header}${declarations.join("\n")}\n${declarations.length === 0 ? "export {};\n" : ""}`,
    };
  }

  /**
   * Writes the generated bootstrap under the same output guard as metadata.
   *
   * @param options Output path and repository guards.
   * @returns Written bootstrap source.
   */
  writeBootstrap(options: RegistryWriteOptions): string {
    RegistrySource.assertWriteOptions(options);
    const source = this.renderBootstrap(options);
    const repoRoot = resolve(options.repoRoot);
    const outputDir = dirname(resolve(options.outputFile));
    RegistrySource.assertGitIgnored(repoRoot, options.outputFile);
    mkdirSync(outputDir, { recursive: true });
    RegistrySource.assertNoSymlinkPath(repoRoot, outputDir, "Generated output directory");
    RegistrySource.assertNoSymlinkOutput(options.outputFile);
    RegistrySource.writeOutput(options.outputFile, source);
    return source;
  }

  /**
   * Rejects unsafe generated destinations before a publication snapshot reads them.
   *
   * @param repoRoot Repository checkout containing generated output.
   * @param paths Metadata, bootstrap, adapter, and record destinations.
   */
  validateDestinations(repoRoot: string, paths: readonly string[]): void {
    const root = resolve(repoRoot);
    RegistrySource.assertRepoRoot(root);
    for (const path of paths) {
      const file = resolve(path);
      RegistrySource.assertWithin(root, file, "Generated output");
      RegistrySource.assertNoSymlinkPath(root, dirname(file), "Generated output directory");
      RegistrySource.assertNoSymlinkOutput(file);
    }
  }

  /**
   * Renders generated registry source without writing to disk.
   *
   * @param analysis Analyzed receiver handlers to render.
   * @param options Caller-owned output and registry naming options.
   * @returns Deterministic generated TypeScript source.
   */
  render(analysis: BuildHandlerAnalysis, options: RegistryRenderOptions): string {
    const outputFile = resolve(options.outputFile);
    const registryName = options.registryName ?? defaultRegistryConst;
    const registryModule = options.registryModuleSpecifier ?? defaultRegistryModule;
    const receivers = analysis.receivers;
    const appQueries = analysis.appQueries ?? [];
    const refs = RegistrySource.buildRefs(receivers, appQueries, outputFile);

    RegistrySource.assertRegistryName(registryName, RegistrySource.importNames(refs));
    const protoModule = RegistrySource.bindProtoModule(options, registryName, refs);
    const lines = [
      `import type { ${registryTypeName} } from ${RegistrySource.stringLiteral(registryModule)};`,
      ...(protoModule === undefined ? [] : [protoModule.importLine]),
      ...refs.imports,
      "",
      ...RegistrySource.renderRegistry(
        receivers,
        appQueries,
        outputFile,
        registryName,
        refs,
        protoModule?.localName,
      ),
      "",
    ];

    return lines.join("\n");
  }

  /**
   * Validates and writes generated registry source only when explicitly invoked.
   *
   * @param analysis Analyzed receiver handlers to render and validate.
   * @param options Guarded output location and registry naming options.
   * @returns Generated TypeScript source written to the output file.
   */
  write(analysis: BuildHandlerAnalysis, options: RegistryWriteOptions): string {
    RegistrySource.assertNoDiagnostics(analysis);
    RegistrySource.assertWriteOptions(options);
    const source = this.render(analysis, {
      ...options,
      outputFile: options.publishedOutputFile ?? options.outputFile,
    });
    const repoRoot = resolve(options.repoRoot);
    const outputDir = dirname(resolve(options.outputFile));

    RegistrySource.assertGitIgnored(repoRoot, options.outputFile);
    mkdirSync(outputDir, { recursive: true });
    RegistrySource.assertNoSymlinkPath(repoRoot, outputDir, "Generated output directory");
    RegistrySource.assertNoSymlinkOutput(options.outputFile);

    RegistrySource.writeOutput(options.outputFile, source);
    return source;
  }
}

/**
 * Renders deterministic generated registries and guards file output.
 */
const RegistrySource = Object.freeze({
  /**
   * Binds a Proto module import distinct from metadata and receiver symbols.
   *
   * @param options Proto export and module specifier from caller configuration.
   * @param registryName Generated metadata declaration name.
   * @param refs Already bound class and schema imports.
   * @returns Aliased import and local binding when a Proto module is requested.
   */
  bindProtoModule(
    options: RegistryRenderOptions,
    registryName: string,
    refs: RenderRefs,
  ): { readonly importLine: string; readonly localName: string } | undefined {
    const exported = options.protoModuleExport;
    if (exported === undefined) return undefined;
    if (!identRe.test(exported) || reservedWords.has(exported))
      throw new Error(`Invalid Proto module export: ${exported}`);
    const used = new Set([...RegistrySource.importNames(refs), registryName]);
    const localName = RegistrySource.allocName(exported, used);
    const binding = localName === exported ? exported : `${exported} as ${localName}`;
    const specifier = RegistrySource.stringLiteral(
      options.protoModuleSpecifier ?? "./proto-module.js",
    );
    return {
      importLine: `import { ${binding} } from ${specifier};`,
      localName,
    };
  },

  /**
   * Collects local identifiers that generated imports must not shadow.
   *
   * @param refs Allocated import and receiver references.
   * @returns Identifiers reserved by generated imports.
   */
  importNames(refs: RenderRefs): ReadonlySet<string> {
    return new Set([registryTypeName, ...refs.localNames]);
  },

  /**
   * Binds receiver classes and schemas to deterministic TypeScript imports.
   *
   * @param outputFile Generated output file used for import or publication paths.
   * @param receivers Analyzed receiver descriptions.
   * @param appQueries Analyzed application query implementations.
   * @returns Bound class and schema import references.
   */
  buildRefs(
    receivers: readonly BuildReceiverHandlers[],
    appQueries: readonly BuildAppQueryHandler[],
    outputFile: string,
  ): RenderRefs {
    const used = new Set<string>();
    const entityRefs = new Map<string, string>();
    const entityImports: ImportRef[] = [];
    const schemaRaw = new Map<string, ImportRef>();
    const entityRaw = new Map<string, ImportRef>();
    RegistrySource.addReceiverRefs(
      receivers,
      outputFile,
      entityRaw,
      entityRefs,
      entityImports,
      schemaRaw,
      used,
    );
    for (const query of appQueries) {
      RegistrySource.addQueryRefs(
        query,
        outputFile,
        entityRaw,
        entityRefs,
        entityImports,
        schemaRaw,
        used,
      );
    }
    const { schemaImports, schemaRefs } = RegistrySource.bindSchemaRefs(schemaRaw, used);
    return RegistrySource.finishRefs(entityRefs, schemaRefs, entityImports, schemaImports, used);
  },

  /**
   * Builds the render reference table from allocated class and schema imports.
   *
   * @param entities Bound implementation class names.
   * @param schemas Bound generated schema names.
   * @param entityImports Ordered implementation imports.
   * @param schemaImports Ordered generated schema imports.
   * @param used Reserved local names.
   * @returns References for metadata rendering.
   */
  finishRefs(
    entities: ReadonlyMap<string, string>,
    schemas: ReadonlyMap<string, string>,
    entityImports: readonly ImportRef[],
    schemaImports: readonly ImportRef[],
    used: ReadonlySet<string>,
  ): RenderRefs {
    return {
      entityNames: entities,
      schemaNames: schemas,
      imports: [
        ...entityImports.map(RegistrySource.renderImport),
        ...RegistrySource.renderSchemaImports(schemaImports),
      ],
      localNames: used,
    };
  },

  /**
   * Adds all receiver classes and schemas to the shared reference allocation.
   *
   * @param receivers Descriptions to import.
   * @param outputFile Generated metadata path.
   * @param raw Unbound class imports.
   * @param names Bound class names.
   * @param imports Ordered class imports.
   * @param schemas Unbound schema imports.
   * @param used Reserved local names.
   */
  addReceiverRefs(
    receivers: readonly BuildReceiverHandlers[],
    outputFile: string,
    raw: Map<string, ImportRef>,
    names: Map<string, string>,
    imports: ImportRef[],
    schemas: Map<string, ImportRef>,
    used: Set<string>,
  ): void {
    for (const receiver of receivers) {
      RegistrySource.addReceiverRef(receiver, outputFile, raw, names, imports, used);
      RegistrySource.addReceiverSchemas(receiver, outputFile, schemas);
    }
  },

  /**
   * Adds one query class and its two generated schemas to shared import allocation.
   *
   * @param query Analyzed implementation and paired schemas.
   * @param outputFile Generated metadata location.
   * @param raw Class import references.
   * @param names Bound class names.
   * @param imports Ordered class imports.
   * @param schemas Generated schema imports.
   * @param used Already reserved local identifiers.
   */
  addQueryRefs(
    query: BuildAppQueryHandler,
    outputFile: string,
    raw: Map<string, ImportRef>,
    names: Map<string, string>,
    imports: ImportRef[],
    schemas: Map<string, ImportRef>,
    used: Set<string>,
  ): void {
    RegistrySource.addReceiverRef(query, outputFile, raw, names, imports, used);
    RegistrySource.addSchemaRef(schemas, outputFile, query.sourceFile, query.querySchema);
    RegistrySource.addSchemaRef(schemas, outputFile, query.sourceFile, query.responseSchema);
  },

  /**
   * Records the class import and local identifier for an analyzed receiver.
   *
   * @param imports Ordered bound import references.
   * @param names Receiver keys mapped to local identifiers.
   * @param outputFile Generated output file used for import or publication paths.
   * @param raw Collected unbound import references.
   * @param receiver Analyzed handler receiver.
   * @param used Already allocated local identifiers.
   */
  addReceiverRef(
    receiver: Pick<BuildAppQueryHandler, "className" | "sourceFile" | "defaultExport">,
    outputFile: string,
    raw: Map<string, ImportRef>,
    names: Map<string, string>,
    imports: ImportRef[],
    used: Set<string>,
  ): void {
    const moduleSpecifier = RegistrySource.entityModule(outputFile, receiver.sourceFile);
    const key = RegistrySource.entityKey(moduleSpecifier, receiver.className);
    const existing = raw.get(key);
    const ref =
      existing ??
      RegistrySource.bindRef(
        {
          importedName: receiver.className,
          localName: "",
          moduleSpecifier,
          ...(receiver.defaultExport === true ? { defaultExport: true } : {}),
        },
        used,
      );
    if (existing === undefined) {
      raw.set(key, ref);
      imports.push(ref);
    }
    names.set(RegistrySource.entityKey(ref.moduleSpecifier, ref.importedName), ref.localName);
  },

  /**
   * Collects Proto schemas referenced by a receiver and its handlers.
   *
   * @param outputFile Generated output file used for import or publication paths.
   * @param receiver Analyzed handler receiver.
   * @param schemas Mutable schema import collection.
   */
  addReceiverSchemas(
    receiver: BuildReceiverHandlers,
    outputFile: string,
    schemas: Map<string, ImportRef>,
  ): void {
    const add = (schema: SchemaReference) => {
      RegistrySource.addSchemaRef(schemas, outputFile, receiver.sourceFile, schema);
    };
    if (receiver.receiverKind === "entity") add(receiver.stateSchema);
    for (const handler of receiver.handlers) {
      add(handler.input.schema);
      handler.outcomes.returned.forEach(add);
      handler.outcomes.thrown.forEach(add);
    }
  },

  /**
   * Binds stable local names for collected schema imports.
   *
   * @param raw Collected unbound import references.
   * @param used Already allocated local identifiers.
   * @returns Schema imports and their allocated local names.
   */
  bindSchemaRefs(raw: Map<string, ImportRef>, used: Set<string>) {
    const schemaRefs = new Map<string, string>();
    const schemaImports = [...raw.values()].sort(RegistrySource.compareRef).map((ref) => {
      const bound = RegistrySource.bindRef(ref, used);
      schemaRefs.set(
        RegistrySource.entityKey(bound.moduleSpecifier, bound.importedName),
        bound.localName,
      );
      return bound;
    });
    return { schemaImports, schemaRefs };
  },

  /**
   * Renders the complete passive metadata source from bound receiver references.
   *
   * @param outputFile Generated output file used for import or publication paths.
   * @param protoModuleExport Value used by this operation.
   * @param receivers Analyzed receiver descriptions.
   * @param appQueries Analyzed application query implementations.
   * @param refs Allocated import and receiver references.
   * @param registryName Generated metadata export name.
   * @returns Complete passive metadata source.
   */
  renderRegistry(
    receivers: readonly BuildReceiverHandlers[],
    appQueries: readonly BuildAppQueryHandler[],
    outputFile: string,
    registryName: string,
    refs: RenderRefs,
    protoModuleExport?: string,
  ): readonly string[] {
    const lines = [
      `export const ${registryName}: ${registryTypeName} = {`,
      ...(protoModuleExport === undefined ? [] : [`  protoModule: ${protoModuleExport},`]),
      "  receivers: [",
    ];

    receivers.forEach((receiver) => {
      lines.push(...RegistrySource.renderReceiver(receiver, outputFile, refs));
    });
    lines.push("  ],");
    if (appQueries.length > 0)
      lines.push(
        "  appQueries: [",
        ...appQueries.flatMap((query) => RegistrySource.renderAppQuery(query, outputFile, refs)),
        "  ],",
      );
    lines.push("};");

    return lines;
  },

  /**
   * Renders one passive query implementation reference.
   *
   * @param query Analyzed implementation and paired schemas.
   * @param outputFile Generated metadata location.
   * @param refs Bound import identifiers.
   * @returns Constructor and schema data without executing the handler.
   */
  renderAppQuery(
    query: BuildAppQueryHandler,
    outputFile: string,
    refs: RenderRefs,
  ): readonly string[] {
    const handler = RegistrySource.entityName(refs, outputFile, query);
    const request = RegistrySource.schemaName(
      refs,
      outputFile,
      query.sourceFile,
      query.querySchema,
    );
    const response = RegistrySource.schemaName(
      refs,
      outputFile,
      query.sourceFile,
      query.responseSchema,
    );
    return [
      "    {",
      `      handlerType: ${handler},`,
      `      queryTypeName: ${RegistrySource.stringLiteral(query.queryTypeName)},`,
      `      querySchema: ${request},`,
      `      responseSchema: ${response},`,
      "    },",
    ];
  },

  /**
   * Renders one generated entity or standalone receiver description.
   *
   * @param outputFile Generated output file used for import or publication paths.
   * @param receiver Analyzed handler receiver.
   * @param refs Allocated import and receiver references.
   * @returns Receiver description source.
   */
  renderReceiver(
    receiver: BuildReceiverHandlers,
    outputFile: string,
    refs: RenderRefs,
  ): readonly string[] {
    const entityType = RegistrySource.entityName(refs, outputFile, receiver);
    const receiverKind = receiver.receiverKind;
    const stateSchema =
      receiver.receiverKind === "entity"
        ? RegistrySource.schemaName(refs, outputFile, receiver.sourceFile, receiver.stateSchema)
        : undefined;
    const lines = [
      "    {",
      `      receiverKind: ${RegistrySource.stringLiteral(receiverKind)},`,
      `      receiverType: ${entityType},`,
      ...(stateSchema === undefined ? [] : [`      stateSchema: ${stateSchema},`]),
      "      handlers: [",
    ];

    for (const handler of receiver.handlers) {
      lines.push(...RegistrySource.renderHandler(handler, receiver.sourceFile, outputFile, refs));
    }
    lines.push("      ],", "    },");
    return lines;
  },

  /**
   * Renders one declared handler with its input and outcome schemas.
   *
   * @param handler Analyzed handler declaration.
   * @param outputFile Generated output file used for import or publication paths.
   * @param refs Allocated import and receiver references.
   * @param sourceFile Source file containing the referenced symbol.
   * @returns Handler description source.
   */
  renderHandler(
    handler: BuildHandlerRecord,
    sourceFile: string,
    outputFile: string,
    refs: RenderRefs,
  ): readonly string[] {
    const schemaName = (schema: SchemaReference) =>
      RegistrySource.schemaName(refs, outputFile, sourceFile, schema);
    const returned = handler.outcomes.returned.map(schemaName).join(", ");
    const thrown = handler.outcomes.thrown.map(schemaName).join(", ");
    return [
      "        {",
      `          kind: ${RegistrySource.stringLiteral(handler.kind)},`,
      `          methodName: ${RegistrySource.stringLiteral(handler.methodName)},`,
      "          input: {",
      `            schema: ${schemaName(handler.input.schema)},`,
      `            origin: ${RegistrySource.stringLiteral(handler.input.origin)},`,
      ...RegistrySource.renderWhere(handler.input.where),
      "          },",
      "          outcomes: {",
      `            returned: [${returned}],`,
      `            thrown: [${thrown}],`,
      "          },",
      `          parameterCount: ${String(handler.parameterCount)},`,
      "        },",
    ];
  },

  /**
   * Renders a declared event filter as a source expression.
   *
   * @param where Declared event filter.
   * @returns Event filter source expression.
   */
  renderWhere(where: BuildWhereOptions | undefined): readonly string[] {
    return where === undefined
      ? []
      : [
          "            where: {",
          `              eventField: ${RegistrySource.stringLiteral(where.eventField)},`,
          `              equals: ${RegistrySource.stringLiteral(where.equals)},`,
          "            },",
        ];
  },

  /**
   * Records an import reference for one Proto schema.
   *
   * @param outputFile Generated output file used for import or publication paths.
   * @param schema Referenced Proto schema.
   * @param schemaImports Collected Proto schema imports.
   * @param sourceFile Source file containing the referenced symbol.
   */
  addSchemaRef(
    schemaImports: Map<string, ImportRef>,
    outputFile: string,
    sourceFile: string,
    schema: SchemaReference,
  ): void {
    const moduleSpecifier = RegistrySource.importedSchemaModule(
      outputFile,
      sourceFile,
      schema.moduleSpecifier,
    );
    const key = RegistrySource.entityKey(moduleSpecifier, schema.exportName);

    if (schemaImports.has(key)) {
      return;
    }

    schemaImports.set(key, {
      importedName: schema.exportName,
      localName: "",
      moduleSpecifier,
    });
  },

  /**
   * Resolves an Entity source module from the generated output.
   *
   * @param outputFile Generated output file used for import or publication paths.
   * @param sourceFile Source file containing the referenced symbol.
   * @returns Entity module import specifier.
   */
  entityModule(outputFile: string, sourceFile: string): string {
    return RegistrySource.relativeModule(
      dirname(outputFile),
      RegistrySource.replaceSourceExtension(sourceFile),
    );
  },

  /**
   * Resolves a schema module import against the generated output.
   *
   * @param moduleSpecifier Imported module specifier.
   * @param outputFile Generated output file used for import or publication paths.
   * @param sourceFile Source file containing the referenced symbol.
   * @returns Schema module import specifier.
   */
  importedSchemaModule(outputFile: string, sourceFile: string, moduleSpecifier: string): string {
    if (!moduleSpecifier.startsWith(".")) {
      return moduleSpecifier;
    }

    const resolved = resolve(dirname(sourceFile), moduleSpecifier);

    return RegistrySource.relativeModule(dirname(outputFile), resolved);
  },

  /**
   * Builds a relative JavaScript module specifier between source paths.
   *
   * @param fromDirectory Importing source directory.
   * @param targetPath Generated or compiler path to validate.
   * @returns Relative JavaScript module specifier.
   */
  relativeModule(fromDirectory: string, targetPath: string): string {
    const value = relative(fromDirectory, targetPath).split(sep).join("/");

    return value.startsWith(".") ? value : `./${value}`;
  },

  /**
   * Converts a TypeScript source path to its runtime JavaScript path.
   *
   * @param path Path or Proto import path to inspect.
   * @returns Runtime JavaScript path.
   */
  replaceSourceExtension(path: string): string {
    const extension = extname(path);

    switch (extension) {
      case ".cts":
        return `${path.slice(0, -extension.length)}.cjs`;
      case ".mts":
        return `${path.slice(0, -extension.length)}.mjs`;
      case ".ts":
      case ".tsx":
        return `${path.slice(0, -extension.length)}.js`;
      default:
        return path;
    }
  },

  /**
   * Compares import references by stable module and symbol identity.
   *
   * @param left First value in stable ordering.
   * @param right Second value in stable ordering.
   * @returns Negative, zero, or positive stable comparison.
   */
  compareRef(left: ImportRef, right: ImportRef): number {
    return (
      RegistrySource.compareString(left.moduleSpecifier, right.moduleSpecifier) ||
      RegistrySource.compareString(left.importedName, right.importedName)
    );
  },

  /**
   * Binds an unused local identifier to an import reference.
   *
   * @param ref Bound import reference.
   * @param used Already allocated local identifiers.
   * @returns Import reference with an allocated local identifier.
   */
  bindRef(ref: ImportRef, used: Set<string>): ImportRef {
    return {
      ...ref,
      localName: RegistrySource.allocName(ref.importedName, used),
    };
  },

  /**
   * Returns a collision-free generated import identifier.
   *
   * @param base Preferred generated identifier.
   * @param used Already allocated local identifiers.
   * @returns Collision-free local identifier.
   */
  allocName(base: string, used: Set<string>): string {
    let next = base;
    let index = 2;

    while (used.has(next)) {
      next = `${base}_${String(index)}`;
      index += 1;
    }

    used.add(next);
    return next;
  },

  /**
   * Renders the import statement for a bound symbol.
   *
   * @param ref Bound import reference.
   * @returns TypeScript import statement.
   */
  renderImport(ref: ImportRef): string {
    if (ref.defaultExport === true) {
      return `import ${ref.localName} from ${RegistrySource.stringLiteral(ref.moduleSpecifier)};`;
    }
    const local =
      ref.importedName === ref.localName
        ? ref.importedName
        : `${ref.importedName} as ${ref.localName}`;

    return `import { ${local} } from ${RegistrySource.stringLiteral(ref.moduleSpecifier)};`;
  },

  /**
   * Renders deterministic import statements for collected schemas.
   *
   * @param refs Allocated import and receiver references.
   * @returns Ordered schema import statements.
   */
  renderSchemaImports(refs: readonly ImportRef[]): readonly string[] {
    const grouped = new Map<string, string[]>();

    refs.forEach((ref) => {
      const rendered =
        ref.importedName === ref.localName
          ? ref.importedName
          : `${ref.importedName} as ${ref.localName}`;
      const existing = grouped.get(ref.moduleSpecifier);

      if (existing === undefined) {
        grouped.set(ref.moduleSpecifier, [rendered]);
        return;
      }

      existing.push(rendered);
    });

    return [...grouped.entries()].map(
      ([moduleSpecifier, names]) =>
        `import { ${names.join(", ")} } from ${RegistrySource.stringLiteral(moduleSpecifier)};`,
    );
  },

  /**
   * Finds the allocated local identifier for an Entity class.
   *
   * @param entity Entity class description.
   * @param outputFile Generated output file used for import or publication paths.
   * @param refs Allocated import and receiver references.
   * @returns Allocated Entity class identifier.
   */
  entityName(
    refs: RenderRefs,
    outputFile: string,
    entity: Pick<BuildAppQueryHandler, "className" | "sourceFile">,
  ): string {
    return RegistrySource.refName(
      refs.entityNames,
      RegistrySource.entityKey(
        RegistrySource.entityModule(outputFile, entity.sourceFile),
        entity.className,
      ),
    );
  },

  /**
   * Finds the allocated local identifier for a Proto schema.
   *
   * @param outputFile Generated output file used for import or publication paths.
   * @param refs Allocated import and receiver references.
   * @param schema Referenced Proto schema.
   * @param sourceFile Source file containing the referenced symbol.
   * @returns Allocated Proto schema identifier.
   */
  schemaName(
    refs: RenderRefs,
    outputFile: string,
    sourceFile: string,
    schema: SchemaReference,
  ): string {
    return RegistrySource.refName(
      refs.schemaNames,
      RegistrySource.entityKey(
        RegistrySource.importedSchemaModule(outputFile, sourceFile, schema.moduleSpecifier),
        schema.exportName,
      ),
    );
  },

  /**
   * Finds a bound local name by its stable reference key.
   *
   * @param key Stable reference key.
   * @param refs Allocated import and receiver references.
   * @returns Bound local identifier.
   */
  refName(refs: ReadonlyMap<string, string>, key: string): string {
    const value = refs.get(key);

    if (value !== undefined) {
      return value;
    }

    throw new Error(`Missing generated registry import binding for ${key}.`);
  },

  /**
   * Builds the stable module-and-symbol key for a receiver class.
   *
   * @param importedName Value used by this operation.
   * @param moduleSpecifier Imported module specifier.
   * @returns Stable receiver class key.
   */
  entityKey(moduleSpecifier: string, importedName: string): string {
    return `${moduleSpecifier}::${importedName}`;
  },

  /**
   * Encodes a value as a safe TypeScript string literal.
   *
   * @param value Value being read or validated.
   * @returns Escaped TypeScript string literal.
   */
  stringLiteral(value: string): string {
    return JSON.stringify(value)
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  },

  /**
   * Rejects a symbol name that cannot be emitted as an identifier.
   *
   * @param label Diagnostic label for the checked path.
   * @param value Value being read or validated.
   */
  assertIdentifier(value: string, label: string): void {
    if (identRe.test(value)) {
      return;
    }

    throw new Error(`${label} must be a valid TypeScript identifier: ${value}`);
  },

  /**
   * Rejects an invalid or colliding metadata export name.
   *
   * @param localNames Already allocated local identifiers.
   * @param value Value being read or validated.
   */
  assertRegistryName(value: string, localNames: ReadonlySet<string>): void {
    RegistrySource.assertIdentifier(value, "Registry name");

    if (reservedWords.has(value)) {
      throw new Error(`Registry name must not be a reserved TypeScript word: ${value}`);
    }

    if (localNames.has(value)) {
      throw new Error(`Registry name collides with generated import binding: ${value}`);
    }
  },

  /**
   * Rejects analyzer findings before source publication.
   *
   * @param analysis Analyzed receiver descriptions and diagnostics.
   */
  assertNoDiagnostics(analysis: BuildHandlerAnalysis): void {
    if (analysis.diagnostics.length === 0) {
      return;
    }

    const first = analysis.diagnostics[0];
    const location =
      first === undefined
        ? "unknown"
        : `${first.sourceFile}:${String(first.line)}:${String(first.column)}`;

    throw new Error(
      `Cannot write generated handler registry with analyzer diagnostics. First diagnostic: ${location}.`,
    );
  },

  /**
   * Validates generated output paths and publication settings.
   *
   * @param options Caller configuration for the operation.
   */
  assertWriteOptions(options: RegistryWriteOptions): void {
    const repoRoot = resolve(options.repoRoot);
    const generatedRoot = resolve(options.generatedRoot);
    const outputFile = resolve(options.outputFile);

    RegistrySource.assertRepoRoot(repoRoot);

    if (generatedRoot.split(sep).at(-1) !== "generated") {
      throw new Error(`Generated root must end with "/generated": ${generatedRoot}`);
    }

    RegistrySource.assertWithin(repoRoot, generatedRoot, "Generated root");
    RegistrySource.assertWithin(repoRoot, outputFile, "Generated output");
    RegistrySource.assertWithin(generatedRoot, outputFile, "Generated output");
    if (options.publishedOutputFile !== undefined) {
      RegistrySource.assertWithin(
        repoRoot,
        resolve(options.publishedOutputFile),
        "Published generated output",
      );
    }
    RegistrySource.assertNoSymlinkPath(repoRoot, generatedRoot, "Generated root");
    RegistrySource.assertNoSymlinkPath(repoRoot, dirname(outputFile), "Generated output directory");
  },

  /**
   * Checks that the repository root is a real directory.
   *
   * @param repoRoot Repository root used for output guards.
   */
  assertRepoRoot(repoRoot: string): void {
    RegistrySource.assertNoSymlinkAncestors(repoRoot, "Repository root path");
    const stat = RegistrySource.lstatIfPresent(repoRoot);

    if (stat === undefined) {
      throw new Error(`Repository root does not exist: ${repoRoot}`);
    }

    if (stat.isSymbolicLink()) {
      throw new Error(`Repository root must not be a symlink: ${repoRoot}`);
    }

    if (!stat.isDirectory()) {
      throw new Error(`Repository root must be a directory: ${repoRoot}`);
    }
  },

  /**
   * Rejects symlinks along a generated output path.
   *
   * @param label Diagnostic label for the checked path.
   * @param targetPath Generated or compiler path to validate.
   */
  assertNoSymlinkAncestors(targetPath: string, label: string): void {
    const parts = resolve(targetPath).split(sep).filter(Boolean);
    let current: string = sep;

    for (const part of parts.slice(0, -1)) {
      current = join(current, part);
      const stat = RegistrySource.lstatIfPresent(current);

      if (stat?.isSymbolicLink()) {
        throw new Error(`${label} must not use a symlink ancestor: ${current}`);
      }

      if (stat !== undefined && !stat.isDirectory()) {
        throw new Error(`${label} ancestor is not a directory: ${current}`);
      }
    }
  },

  /**
   * Rejects a symlink at the generated output file.
   *
   * @param outputFile Generated output file used for import or publication paths.
   */
  assertNoSymlinkOutput(outputFile: string): void {
    const stat = RegistrySource.lstatIfPresent(resolve(outputFile));

    if (stat?.isSymbolicLink()) {
      throw new Error(`Generated output file must not be a symlink: ${outputFile}`);
    }
  },

  /**
   * Writes generated source through a temporary file and atomic rename.
   *
   * @param outputFile Generated output file used for import or publication paths.
   * @param source Generated or source TypeScript text.
   */
  writeOutput(outputFile: string, source: string): void {
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;
    const fd = openSync(outputFile, flags, 0o666);

    try {
      writeFileSync(fd, source);
    } finally {
      closeSync(fd);
    }
  },

  /**
   * Checks that a target path remains inside its allowed root.
   *
   * @param label Diagnostic label for the checked path.
   * @param root Confinement or generated-tree root.
   * @param target Target path to validate.
   */
  assertWithin(root: string, target: string, label: string): void {
    const value = relative(root, target);

    if (value === "" || value.startsWith("..") || isAbsolute(value)) {
      throw new Error(`${label} must stay within ${root}.`);
    }
  },

  /**
   * Checks every existing component of a generated path for symlinks.
   *
   * @param label Diagnostic label for the checked path.
   * @param repoRoot Repository root used for output guards.
   * @param targetPath Generated or compiler path to validate.
   */
  assertNoSymlinkPath(repoRoot: string, targetPath: string, label: string): void {
    const relativePath = relative(repoRoot, targetPath);

    if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`${label} must stay within ${repoRoot}.`);
    }

    const parts = relativePath.split(sep).filter(Boolean);
    let current = repoRoot;

    for (const part of parts) {
      current = join(current, part);
      const stat = RegistrySource.lstatIfPresent(current);

      if (stat === undefined) {
        continue;
      }

      if (stat.isSymbolicLink()) {
        throw new Error(`${label} must not use a symlink path: ${relative(repoRoot, current)}`);
      }

      if (!stat.isDirectory()) {
        throw new Error(`${label} ancestor is not a directory: ${relative(repoRoot, current)}`);
      }
    }
  },

  /**
   * Rejects generated output that is not ignored by Git.
   *
   * @param outputFile Generated output file used for import or publication paths.
   * @param repoRoot Repository root used for output guards.
   */
  assertGitIgnored(repoRoot: string, outputFile: string): void {
    const relativePath = relative(resolve(repoRoot), resolve(outputFile));
    const result = spawnSync("git", ["check-ignore", "--quiet", "--", relativePath], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    if (result.status === 0) {
      return;
    }

    if (result.status === 1) {
      throw new Error(`Generated output must live under a path ignored by Git: ${relativePath}`);
    }

    throw new Error(`Failed to verify Git ignore status for generated output: ${relativePath}`);
  },

  /**
   * Reads filesystem metadata when a path exists.
   *
   * @param path Path or Proto import path to inspect.
   * @returns Filesystem metadata, or undefined for an absent path.
   */
  lstatIfPresent(path: string) {
    try {
      return lstatSync(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  },

  /**
   * Compares strings deterministically for generated source.
   *
   * @param left First value in stable ordering.
   * @param right Second value in stable ordering.
   * @returns Negative, zero, or positive lexical comparison.
   */
  compareString(left: string, right: string): number {
    if (left === right) {
      return 0;
    }

    return left < right ? -1 : 1;
  },
});

export type { BuildHandlerAnalysis } from "./build-time-handler-analyzer.js";
