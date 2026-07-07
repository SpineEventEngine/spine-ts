import { spawnSync } from "node:child_process";
import { closeSync, constants, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  BuildEntityHandlers,
  BuildHandlerAnalysis,
  SchemaReference,
} from "./build-time-handler-analyzer.js";

const defaultRegistryConst = "generatedHandlerRegistry";
const defaultRegistryModule = "@spine-ts/server";
const registryTypeName = "GeneratedHandlerRegistry";
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
}

interface RenderRefs {
  readonly entityNames: ReadonlyMap<string, string>;
  readonly schemaNames: ReadonlyMap<string, string>;
  readonly imports: readonly string[];
  readonly localNames: ReadonlySet<string>;
}

/** Options for deterministic generated-registry source rendering. */
export interface RegistryRenderOptions {
  /** Absolute or caller-owned output file used for relative import rendering. */
  readonly outputFile: string;
  /** Type-only module specifier used for the generated registry contract. */
  readonly registryModuleSpecifier?: string;
  /** Exported constant name for the generated registry object. */
  readonly registryName?: string;
}

/** Options for guarded generated-registry file writing. */
export interface RegistryWriteOptions extends RegistryRenderOptions {
  /** Repository root used for Git-ignore and symlink validation. */
  readonly repoRoot: string;
  /** Explicit generated directory that must own the output file. */
  readonly generatedRoot: string;
}

/** Build-time writer for version-1 generated handler registry source. */
export class GeneratedRegistryWriter {
  /** Render generated registry source without writing to disk. */
  render(analysis: BuildHandlerAnalysis, options: RegistryRenderOptions): string {
    const outputFile = resolve(options.outputFile);
    const registryName = options.registryName ?? defaultRegistryConst;
    const registryModule = options.registryModuleSpecifier ?? defaultRegistryModule;
    const refs = buildRefs(analysis.entities, outputFile);

    assertRegistryName(registryName, importNames(refs));
    const lines = [
      `import type { ${registryTypeName} } from ${stringLiteral(registryModule)};`,
      ...refs.imports,
      "",
      ...renderRegistry(analysis.entities, outputFile, registryName, refs),
      "",
    ];

    return lines.join("\n");
  }

  /** Validate and write generated registry source only when explicitly invoked. */
  write(analysis: BuildHandlerAnalysis, options: RegistryWriteOptions): string {
    assertNoDiagnostics(analysis);
    assertWriteOptions(options);
    const source = this.render(analysis, options);
    const repoRoot = resolve(options.repoRoot);
    const outputDir = dirname(resolve(options.outputFile));

    assertGitIgnored(repoRoot, options.outputFile);
    mkdirSync(outputDir, { recursive: true });
    assertNoSymlinkPath(repoRoot, outputDir, "Generated output directory");
    assertNoSymlinkOutput(options.outputFile);

    writeOutput(options.outputFile, source);
    return source;
  }
}

function importNames(refs: RenderRefs): ReadonlySet<string> {
  return new Set([registryTypeName, ...refs.localNames]);
}

function buildRefs(entities: readonly BuildEntityHandlers[], outputFile: string): RenderRefs {
  const entityRefs = new Map<string, string>();
  const schemaRefs = new Map<string, string>();
  const entityRaw = new Map<string, ImportRef>();
  const schemaRaw = new Map<string, ImportRef>();
  const used = new Set<string>();
  const entityImports: ImportRef[] = [];

  for (const entity of entities) {
    const moduleSpecifier = entityModule(outputFile, entity.sourceFile);
    const key = entityKey(moduleSpecifier, entity.className);
    const existing = entityRaw.get(key);
    const ref =
      existing ??
      bindRef(
        {
          importedName: entity.className,
          localName: "",
          moduleSpecifier,
        },
        used,
      );

    if (existing === undefined) {
      entityRaw.set(key, ref);
      entityImports.push(ref);
    }

    entityRefs.set(entityKey(ref.moduleSpecifier, ref.importedName), ref.localName);
    addSchemaRef(schemaRaw, outputFile, entity.sourceFile, entity.stateSchema);

    for (const handler of entity.handlers) {
      addSchemaRef(schemaRaw, outputFile, entity.sourceFile, handler.signalSchema);
      handler.emittedSchemas.forEach((schema) => {
        addSchemaRef(schemaRaw, outputFile, entity.sourceFile, schema);
      });
    }
  }

  const schemaImports = [...schemaRaw.values()].sort(compareRef).map((ref) => {
    const bound = bindRef(ref, used);
    schemaRefs.set(entityKey(bound.moduleSpecifier, bound.importedName), bound.localName);
    return bound;
  });

  return {
    entityNames: entityRefs,
    schemaNames: schemaRefs,
    imports: [...entityImports.map(renderImport), ...renderSchemaImports(schemaImports)],
    localNames: used,
  };
}

function renderRegistry(
  entities: readonly BuildEntityHandlers[],
  outputFile: string,
  registryName: string,
  refs: RenderRefs,
): readonly string[] {
  const lines = [
    `export const ${registryName}: GeneratedHandlerRegistry = {`,
    "  version: 1,",
    "  entities: [",
  ];

  entities.forEach((entity) => {
    lines.push(...renderEntity(entity, outputFile, refs));
  });
  lines.push("  ],", "};");

  return lines;
}

function renderEntity(
  entity: BuildEntityHandlers,
  outputFile: string,
  refs: RenderRefs,
): readonly string[] {
  const entityType = entityName(refs, outputFile, entity);
  const stateSchema = schemaName(refs, outputFile, entity.sourceFile, entity.stateSchema);
  const lines = [
    "    {",
    `      entityType: ${entityType},`,
    `      stateSchema: ${stateSchema},`,
    "      handlers: [",
  ];

  entity.handlers.forEach((handler) => {
    const emitted = handler.emittedSchemas
      .map((schema) => schemaName(refs, outputFile, entity.sourceFile, schema))
      .join(", ");
    const signalSchema = schemaName(refs, outputFile, entity.sourceFile, handler.signalSchema);

    lines.push(
      "        {",
      `          kind: ${stringLiteral(handler.kind)},`,
      `          methodName: ${stringLiteral(handler.methodName)},`,
      `          signalSchema: ${signalSchema},`,
      `          emittedSchemas: [${emitted}],`,
      `          parameterCount: ${String(handler.parameterCount)},`,
      "        },",
    );
  });
  lines.push("      ],", "    },");

  return lines;
}

function addSchemaRef(
  schemaImports: Map<string, ImportRef>,
  outputFile: string,
  sourceFile: string,
  schema: SchemaReference,
): void {
  const moduleSpecifier = importedSchemaModule(outputFile, sourceFile, schema.moduleSpecifier);
  const key = entityKey(moduleSpecifier, schema.exportName);

  if (schemaImports.has(key)) {
    return;
  }

  schemaImports.set(key, {
    importedName: schema.exportName,
    localName: "",
    moduleSpecifier,
  });
}

function entityModule(outputFile: string, sourceFile: string): string {
  return relativeModule(dirname(outputFile), replaceSourceExtension(sourceFile));
}

function importedSchemaModule(
  outputFile: string,
  sourceFile: string,
  moduleSpecifier: string,
): string {
  if (!moduleSpecifier.startsWith(".")) {
    return moduleSpecifier;
  }

  const resolved = resolve(dirname(sourceFile), moduleSpecifier);

  return relativeModule(dirname(outputFile), resolved);
}

function relativeModule(fromDirectory: string, targetPath: string): string {
  const value = relative(fromDirectory, targetPath).split(sep).join("/");

  return value.startsWith(".") ? value : `./${value}`;
}

function replaceSourceExtension(path: string): string {
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
}

function compareRef(left: ImportRef, right: ImportRef): number {
  return (
    compareString(left.moduleSpecifier, right.moduleSpecifier) ||
    compareString(left.importedName, right.importedName)
  );
}

function bindRef(ref: ImportRef, used: Set<string>): ImportRef {
  return {
    ...ref,
    localName: allocName(ref.importedName, used),
  };
}

function allocName(base: string, used: Set<string>): string {
  let next = base;
  let index = 2;

  while (used.has(next)) {
    next = `${base}_${String(index)}`;
    index += 1;
  }

  used.add(next);
  return next;
}

function renderImport(ref: ImportRef): string {
  const local =
    ref.importedName === ref.localName
      ? ref.importedName
      : `${ref.importedName} as ${ref.localName}`;

  return `import { ${local} } from ${stringLiteral(ref.moduleSpecifier)};`;
}

function renderSchemaImports(refs: readonly ImportRef[]): readonly string[] {
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
      `import { ${names.join(", ")} } from ${stringLiteral(moduleSpecifier)};`,
  );
}

function entityName(refs: RenderRefs, outputFile: string, entity: BuildEntityHandlers): string {
  return refName(
    refs.entityNames,
    entityKey(entityModule(outputFile, entity.sourceFile), entity.className),
  );
}

function schemaName(
  refs: RenderRefs,
  outputFile: string,
  sourceFile: string,
  schema: SchemaReference,
): string {
  return refName(
    refs.schemaNames,
    entityKey(
      importedSchemaModule(outputFile, sourceFile, schema.moduleSpecifier),
      schema.exportName,
    ),
  );
}

function refName(refs: ReadonlyMap<string, string>, key: string): string {
  const value = refs.get(key);

  if (value !== undefined) {
    return value;
  }

  throw new Error(`Missing generated registry import binding for ${key}.`);
}

function entityKey(moduleSpecifier: string, importedName: string): string {
  return `${moduleSpecifier}::${importedName}`;
}

function stringLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function assertIdentifier(value: string, label: string): void {
  if (identRe.test(value)) {
    return;
  }

  throw new Error(`${label} must be a valid TypeScript identifier: ${value}`);
}

function assertRegistryName(value: string, localNames: ReadonlySet<string>): void {
  assertIdentifier(value, "Registry name");

  if (reservedWords.has(value)) {
    throw new Error(`Registry name must not be a reserved TypeScript word: ${value}`);
  }

  if (localNames.has(value)) {
    throw new Error(`Registry name collides with generated import binding: ${value}`);
  }
}

function assertNoDiagnostics(analysis: BuildHandlerAnalysis): void {
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
}

function assertWriteOptions(options: RegistryWriteOptions): void {
  const repoRoot = resolve(options.repoRoot);
  const generatedRoot = resolve(options.generatedRoot);
  const outputFile = resolve(options.outputFile);

  assertRepoRoot(repoRoot);

  if (generatedRoot.split(sep).at(-1) !== "generated") {
    throw new Error(`Generated root must end with "/generated": ${generatedRoot}`);
  }

  assertWithin(repoRoot, generatedRoot, "Generated root");
  assertWithin(repoRoot, outputFile, "Generated output");
  assertWithin(generatedRoot, outputFile, "Generated output");
  assertNoSymlinkPath(repoRoot, generatedRoot, "Generated root");
  assertNoSymlinkPath(repoRoot, dirname(outputFile), "Generated output directory");
}

function assertRepoRoot(repoRoot: string): void {
  assertNoSymlinkAncestors(repoRoot, "Repository root path");
  const stat = lstatIfPresent(repoRoot);

  if (stat === undefined) {
    throw new Error(`Repository root does not exist: ${repoRoot}`);
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`Repository root must not be a symlink: ${repoRoot}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Repository root must be a directory: ${repoRoot}`);
  }
}

function assertNoSymlinkAncestors(targetPath: string, label: string): void {
  const parts = resolve(targetPath).split(sep).filter(Boolean);
  let current: string = sep;

  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const stat = lstatIfPresent(current);

    if (stat?.isSymbolicLink()) {
      throw new Error(`${label} must not use a symlink ancestor: ${current}`);
    }

    if (stat !== undefined && !stat.isDirectory()) {
      throw new Error(`${label} ancestor is not a directory: ${current}`);
    }
  }
}

function assertNoSymlinkOutput(outputFile: string): void {
  const stat = lstatIfPresent(resolve(outputFile));

  if (stat?.isSymbolicLink()) {
    throw new Error(`Generated output file must not be a symlink: ${outputFile}`);
  }
}

function writeOutput(outputFile: string, source: string): void {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;
  const fd = openSync(outputFile, flags, 0o666);

  try {
    writeFileSync(fd, source);
  } finally {
    closeSync(fd);
  }
}

function assertWithin(root: string, target: string, label: string): void {
  const value = relative(root, target);

  if (value === "" || value.startsWith("..") || isAbsolute(value)) {
    throw new Error(`${label} must stay within ${root}.`);
  }
}

function assertNoSymlinkPath(repoRoot: string, targetPath: string, label: string): void {
  const relativePath = relative(repoRoot, targetPath);

  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${label} must stay within ${repoRoot}.`);
  }

  const parts = relativePath.split(sep).filter(Boolean);
  let current = repoRoot;

  for (const part of parts) {
    current = join(current, part);
    const stat = lstatIfPresent(current);

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
}

function assertGitIgnored(repoRoot: string, outputFile: string): void {
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
}

function lstatIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function compareString(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

export type { BuildHandlerAnalysis } from "./build-time-handler-analyzer.js";
