import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

import { findSymlinkedAncestors, lstatIfPresent } from "./generated-path-safety.mjs";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maxLineLength = 120;
const maxSemanticComponents = 4;
const maxTypeReferenceVisits = 200;
const tooDeepTypeLabel = "too deep to audit";
const migrationBaseline = "1ed40826cf0465de59f7d1bcb8ef2963e1b1695e";
const baselineSourceCache = new Map();
const structurePartitions = [
  "T-0080D",
  "T-0080E",
  "T-0080F",
  "T-0080G",
  "T-0080H",
  "T-0080K",
  "T-0080L",
  "T-0080M",
  "T-0080N",
];
const forbiddenEndUserServerApis = new Set([
  "defineEntityHandlers",
  "EntityHandlersMetadata",
  "GeneratedEntityHandlerGroup",
  "GeneratedEntityHandlers",
  "GeneratedHandlerRecord",
  "GeneratedHandlerRegistry",
  "GeneratedRegistryDiscovery",
  "GeneratedRegistryDiscoveryOptions",
  "HandlerMetadataRegistry",
  "HandlerRegistryIngestor",
  "materializeDecoratedEntityHandlers",
  "Repository",
]);
const eventSuffixes = [
  "Accepted",
  "Added",
  "Archived",
  "Canceled",
  "Cancelled",
  "Changed",
  "Closed",
  "Completed",
  "Created",
  "Deleted",
  "Failed",
  "Notified",
  "Opened",
  "Rejected",
  "Removed",
  "Renamed",
  "Reopened",
  "Scheduled",
  "Shipped",
  "Started",
  "Stopped",
  "Updated",
];
const allowedFlatPackageSourceFiles = new Set([
  "packages/core/src/index.ts",
  "packages/proto/src/index.ts",
  "packages/server/src/index.ts",
  "packages/storage/src/index.ts",
  // Published `@spine-event-engine/storage/provider` SPI entrypoint.
  "packages/storage/src/provider.ts",
  "packages/testing/src/index.ts",
  "packages/transport/src/index.ts",
]);
const gitOutputMaxBuffer = 64 * 1024 * 1024;

export function checkCleanupRules(repoRoot) {
  const root = resolve(repoRoot);
  const resolvedRoot = realpathSync(root);
  const files = trackedFiles(root);
  const packages = packageDirs(root);
  const code = confinedTrackedFiles(
    root,
    resolvedRoot,
    authoredCodeFiles(files),
    "authored code symlinks must resolve within the repository root",
  );
  const examples = confinedTrackedFiles(
    root,
    resolvedRoot,
    exampleSourceFiles(files),
    "example source symlinks must resolve within the repository root",
  );

  return [
    ...checkGeneratedLayout(root, files, packages),
    ...checkPackageTests(files),
    ...checkFlatSourceGrowth(files),
    ...code.failures,
    ...examples.failures,
    ...checkLineLength(root, code.files),
    ...checkTypeScriptStructure(root, [...packageSourceFiles(code.files), ...examples.files]),
    ...checkExampleSourceGuardrails(root, examples.files),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { repoRoot, writeStructureDebt } = parseArgs(process.argv.slice(2));
    if (writeStructureDebt) {
      writeStructureDebtPartitions(repoRoot);
      console.log("TypeScript structure debt partitions written.");
      process.exit(0);
    }
    const failures = checkCleanupRules(repoRoot);

    if (failures.length > 0) {
      printFailures(failures);
      process.exit(1);
    }

    console.log("Cleanup enforcement checks passed.");
  } catch (error) {
    console.error(safeDetail(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

function parseArgs(argv) {
  if (argv.includes("--structure-baseline"))
    throw new Error(
      "--structure-baseline is forbidden; cleanup enforcement uses its immutable baseline.",
    );
  const repoRootFlagIndex = argv.indexOf("--repo-root");

  if (repoRootFlagIndex < 0) {
    return {
      repoRoot: defaultRepoRoot,
      writeStructureDebt: argv.includes("--write-structure-debt"),
    };
  }

  const repoRoot = argv[repoRootFlagIndex + 1];

  if (repoRoot === undefined || repoRoot.startsWith("--")) {
    throw new Error("--repo-root requires a path argument.");
  }

  return {
    repoRoot: resolve(repoRoot),
    writeStructureDebt: argv.includes("--write-structure-debt"),
  };
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: gitOutputMaxBuffer,
  });

  if (result.error !== undefined) {
    throw new Error(`Failed to run git ${args.join(" ")}: ${result.error.message}`);
  }

  if (result.signal !== null) {
    throw new Error(`git ${args.join(" ")} terminated by signal ${result.signal}.`);
  }

  return result;
}

function trackedFiles(repoRoot) {
  const result = runGit(repoRoot, ["ls-files", "-z"]);

  if (result.status !== 0) {
    throw new Error(
      `git ls-files failed:\n${safeDetail(result.stderr)}${safeDetail(result.stdout)}`,
    );
  }

  return result.stdout
    .split("\0")
    .filter(
      (file) =>
        file.length > 0 &&
        lstatIfPresent(join(repoRoot, file)) !== undefined &&
        findSymlinkedAncestors(repoRoot, file).length === 0,
    );
}

function packageDirs(repoRoot) {
  const packagesRoot = join(repoRoot, "packages");

  if (!existsSync(packagesRoot)) {
    return [];
  }

  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("packages", entry.name))
    .filter((packageDir) => existsSync(join(repoRoot, packageDir, "package.json")));
}

function checkGeneratedLayout(repoRoot, files, packages) {
  const failures = [];
  const srcGeneratedFiles = files.filter((file) => /^packages\/[^/]+\/src\/generated\//.test(file));
  const generatedTrackedFiles = files.filter(
    (file) =>
      /^packages\/[^/]+\/generated\//.test(file) &&
      !/^packages\/[^/]+\/generated\/\.spine-proto-generation\.json$/.test(file),
  );

  if (srcGeneratedFiles.length > 0) {
    failures.push({
      title: "tracked generated files under package src",
      details: srcGeneratedFiles,
    });
  }

  if (generatedTrackedFiles.length > 0) {
    failures.push({
      title: "tracked generated files under packages/*/generated",
      details: generatedTrackedFiles,
    });
  }

  const notIgnored = packages.filter((packageDir) => {
    const sentinel = `${packageDir}/generated/.cleanup-enforcement-check`;
    const result = runGit(repoRoot, ["check-ignore", "--quiet", "--", sentinel]);

    return result.status !== 0;
  });

  if (notIgnored.length > 0) {
    failures.push({
      title: "generated directories not ignored by Git",
      details: notIgnored.map((packageDir) => `${packageDir}/generated/`),
    });
  }

  return failures;
}

function checkPackageTests(files) {
  const srcTests = files.filter((file) => /^packages\/[^/]+\/src\/.+\.test\.ts$/.test(file));

  return srcTests.length === 0
    ? []
    : [{ title: "package test files under src", details: srcTests }];
}

function authoredCodeFiles(files) {
  return files.filter((file) => {
    if (!/^(packages\/[^/]+\/(src|test)\/|scripts\/)/.test(file)) {
      return false;
    }

    if (!/\.(ts|tsx|mts|cts|mjs)$/.test(file)) {
      return false;
    }

    return !file.includes("/generated/") && !file.endsWith(".test.mjs");
  });
}

function packageSourceFiles(files) {
  return files.filter(
    (file) =>
      /^packages\/[^/]+\/src\//.test(file) &&
      /\.(ts|tsx|mts|cts)$/.test(file) &&
      !file.includes("/generated/") &&
      !/\.test\.(ts|tsx|mts|cts)$/.test(file),
  );
}

function authoredTypeScriptSourceFiles(codeFiles, allFiles) {
  return [...packageSourceFiles(codeFiles), ...exampleSourceFiles(allFiles)].sort();
}

function exampleSourceFiles(files) {
  return files.filter(
    (file) =>
      /^examples\/.+\/src\//.test(file) &&
      /\.(ts|tsx|mts|cts)$/.test(file) &&
      !/\.test\.(ts|tsx|mts|cts)$/.test(file) &&
      !file.includes("/generated/"),
  );
}

function scriptKindForFile(file) {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function checkLineLength(repoRoot, files) {
  const longLines = files.flatMap((file) => {
    const lines = readFileSync(join(repoRoot, file), "utf8").split(/\r?\n/);

    return lines
      .map((line, index) => ({ file, lineNumber: index + 1, length: line.length }))
      .filter(({ length }) => length > maxLineLength)
      .map(({ file: path, lineNumber, length }) => `${path}:${lineNumber} (${length})`);
  });

  return longLines.length === 0
    ? []
    : [{ title: "lines longer than 120 characters", details: longLines }];
}

function confinedTrackedFiles(repoRoot, resolvedRepoRoot, files, title) {
  const safeFiles = [];
  const failures = [];

  for (const file of files) {
    let resolvedFile;
    try {
      resolvedFile = realpathSync(join(repoRoot, file));
    } catch {
      failures.push(`${file} cannot be resolved within the repository root`);
      continue;
    }

    if (resolvesOutsideRoot(resolvedRepoRoot, resolvedFile)) {
      failures.push(`${file} resolves outside the repository root`);
      continue;
    }

    safeFiles.push(file);
  }

  return {
    files: safeFiles,
    failures: failures.length === 0 ? [] : [{ title, details: failures }],
  };
}

function checkFlatSourceGrowth(files) {
  const newFlatFiles = files.filter(
    (file) =>
      /^packages\/[^/]+\/src\/[^/]+\.ts$/.test(file) &&
      !file.endsWith(".test.ts") &&
      !file.endsWith("/src/index.ts") &&
      !allowedFlatPackageSourceFiles.has(file),
  );

  return newFlatFiles.length === 0
    ? []
    : [{ title: "package src files must not grow flat", details: newFlatFiles }];
}

function semanticComponents(name) {
  const trimmed = name.replace(/^_+/, "");

  if (trimmed.length === 0) {
    return [];
  }

  return trimmed
    .split("_")
    .flatMap((part) => part.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? [])
    .filter(Boolean);
}

function hasCallbackType(node) {
  if (node.type === undefined) {
    return false;
  }

  return isVoidFunctionType(node.type) || node.type.getText().endsWith("Callback");
}

function isVoidFunctionType(type) {
  if (!ts.isFunctionTypeNode(type) || type.type === undefined) {
    return false;
  }

  return type.type.kind === ts.SyntaxKind.VoidKeyword;
}

function readIdentifierName(name) {
  return ts.isIdentifier(name) ? name.text : undefined;
}

function readPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(unwrappedExpression(name.expression))) {
    return unwrappedExpression(name.expression).text;
  }

  return undefined;
}

function nodeDecorators(node) {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function buildImportState(source) {
  const state = createImportState();

  for (const statement of source.statements) {
    recordImportStatement(statement, state);
  }

  applyNamespaceAliases(state);

  return state;
}

function cloneState(state) {
  return {
    serverDecoratorAliases: new Map(state.serverDecoratorAliases),
    forbiddenApiAliases: new Map(state.forbiddenApiAliases),
    coreNamespaces: new Set(state.coreNamespaces),
    coreSignalEnvelopeOwners: new Set(state.coreSignalEnvelopeOwners),
    serverNamespaces: new Set(state.serverNamespaces),
    protoTypeAliases: new Set(state.protoTypeAliases),
    protoNamespaces: new Set(state.protoNamespaces),
    generatedTypes: new Map(state.generatedTypes),
    generatedNamespaces: new Map(state.generatedNamespaces),
    localTypeAliases: new Map(state.localTypeAliases),
    importEqualsAliases: state.importEqualsAliases,
  };
}

function createImportState() {
  return {
    serverDecoratorAliases: new Map(),
    forbiddenApiAliases: new Map(),
    coreNamespaces: new Set(),
    coreSignalEnvelopeOwners: new Set(),
    serverNamespaces: new Set(),
    protoTypeAliases: new Set(),
    protoNamespaces: new Set(),
    generatedTypes: new Map(),
    generatedNamespaces: new Map(),
    localTypeAliases: new Map(),
    importEqualsAliases: [],
  };
}

function recordImportStatement(statement, state) {
  if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
    recordImportDeclaration(statement, state);
  }
  if (ts.isImportEqualsDeclaration(statement)) {
    recordImportEqualsDeclaration(statement, state);
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    state.localTypeAliases.set(statement.name.text, statement.type);
  }
}

function recordImportDeclaration(statement, state) {
  const moduleName = statement.moduleSpecifier.text;
  const clause = statement.importClause;

  if (clause?.namedBindings === undefined) {
    return;
  }

  if (moduleName === "@spine-event-engine/core") {
    recordCoreImport(clause, state);
  }
  if (moduleName === "@spine-event-engine/server") {
    recordServerImport(clause, state);
  }
  if (moduleName === "@spine-event-engine/proto") {
    recordProtoImport(clause, state);
  }
  if (isGeneratedModule(moduleName)) {
    recordGeneratedImport(clause, state, moduleName);
  }
}

function recordCoreImport(clause, state) {
  if (clause.isTypeOnly) {
    return;
  }

  const bindings = clause.namedBindings;
  if (ts.isNamespaceImport(bindings)) {
    state.coreNamespaces.add(bindings.name.text);
    return;
  }

  for (const element of bindings.elements) {
    if (element.isTypeOnly) {
      continue;
    }

    const importedName = element.propertyName?.text ?? element.name.text;
    if (importedName === "SignalEnvelopes") {
      state.coreSignalEnvelopeOwners.add(element.name.text);
    }
    if (importedName === "SignalEnvelopes.event" || importedName === "SignalEnvelopes.command") {
      state.forbiddenApiAliases.set(element.name.text, importedName);
    }
  }
}

function recordServerImport(clause, state) {
  const bindings = clause.namedBindings;
  const valueImport = clause.isTypeOnly !== true;
  if (ts.isNamespaceImport(bindings)) {
    if (valueImport) {
      state.serverNamespaces.add(bindings.name.text);
    }
    return;
  }

  for (const element of bindings.elements) {
    const importedName = element.propertyName?.text ?? element.name.text;
    const valueElement = valueImport && !element.isTypeOnly;

    if (valueElement) {
      state.serverDecoratorAliases.set(element.name.text, importedName);
    }
    if (isForbiddenEndUserServerApi(importedName)) {
      state.forbiddenApiAliases.set(element.name.text, importedName);
    }
  }
}

function recordProtoImport(clause, state) {
  const bindings = clause.namedBindings;
  if (ts.isNamespaceImport(bindings)) {
    state.protoNamespaces.add(bindings.name.text);
    return;
  }

  const valueImport = clause.isTypeOnly !== true;
  for (const element of bindings.elements) {
    const importedName = element.propertyName?.text ?? element.name.text;

    if (importedName === "Event" || importedName === "Command") {
      state.protoTypeAliases.add(element.name.text);
    }
    if (valueImport && !element.isTypeOnly && importedName === "EventIdSchema") {
      state.forbiddenApiAliases.set(element.name.text, importedName);
    }
  }
}

function recordGeneratedImport(clause, state, moduleName) {
  const bindings = clause?.namedBindings;
  if (bindings === undefined) {
    return;
  }

  const kind = generatedModuleKind(moduleName);
  if (ts.isNamespaceImport(bindings)) {
    state.generatedNamespaces.set(bindings.name.text, kind);
    return;
  }

  for (const element of bindings.elements) {
    state.generatedTypes.set(element.name.text, kind ?? fallbackSignalKind(element.name.text));
  }
}

function isGeneratedModule(moduleName) {
  return /(^|\/)generated\/.+_pb(\.js)?$/.test(moduleName);
}

function generatedModuleKind(moduleName) {
  if (/(^|\/)commands?_pb(\.js)?$/.test(moduleName)) {
    return "command";
  }
  if (/(^|\/)events?_pb(\.js)?$/.test(moduleName)) {
    return "event";
  }

  return undefined;
}

function recordImportEqualsDeclaration(statement, state) {
  const moduleName = externalModuleName(statement.moduleReference);
  const valueImport = !statement.isTypeOnly;

  if (moduleName === "@spine-event-engine/core" && valueImport) {
    state.coreNamespaces.add(statement.name.text);
  }
  if (moduleName === "@spine-event-engine/server" && valueImport) {
    state.serverNamespaces.add(statement.name.text);
  }
  if (moduleName === "@spine-event-engine/proto") {
    state.protoNamespaces.add(statement.name.text);
  }

  const memberAlias = importEqualsMember(statement.moduleReference);
  if (memberAlias !== undefined) {
    state.importEqualsAliases.push({
      alias: statement.name.text,
      name: memberAlias.name,
      namespace: memberAlias.namespace,
      valueImport,
    });
  }

  const namespaceAlias = importEqualsNamespace(statement.moduleReference);
  if (namespaceAlias !== undefined) {
    state.importEqualsAliases.push({
      alias: statement.name.text,
      name: undefined,
      namespace: namespaceAlias,
      valueImport,
    });
  }
}

function applyImportEqualsAlias(alias, importState) {
  const { namespace, name, valueImport } = alias;
  let changed = false;

  if (valueImport && importState.coreNamespaces.has(namespace) && name === "SignalEnvelopes") {
    changed = addToSet(importState.coreSignalEnvelopeOwners, alias.alias) || changed;
  }
  if (valueImport && isSignalEnvelopeMember(namespace, name, importState)) {
    changed =
      addToMap(importState.forbiddenApiAliases, alias.alias, `SignalEnvelopes.${name}`) || changed;
  }
  if (valueImport && importState.serverNamespaces.has(namespace)) {
    changed = addToMap(importState.serverDecoratorAliases, alias.alias, name) || changed;
    if (isForbiddenEndUserServerApi(name)) {
      changed = addToMap(importState.forbiddenApiAliases, alias.alias, name) || changed;
    }
  }
  if (importState.protoNamespaces.has(namespace)) {
    if (name === "Event" || name === "Command") {
      changed = addToSet(importState.protoTypeAliases, alias.alias) || changed;
    }
    if (valueImport && name === "EventIdSchema") {
      changed = addToMap(importState.forbiddenApiAliases, alias.alias, name) || changed;
    }
  }

  return changed;
}

function applyNamespaceAliases(state) {
  let changed = true;

  while (changed) {
    changed = false;
    for (const alias of state.importEqualsAliases) {
      if (alias.name === undefined) {
        changed = applyNamespaceAlias(alias, state) || changed;
      } else {
        changed = applyImportEqualsAlias(alias, state) || changed;
      }
    }
  }
}

function applyNamespaceAlias(alias, state) {
  const { namespace, valueImport } = alias;
  let changed = false;

  if (valueImport && state.coreNamespaces.has(namespace)) {
    changed = addToSet(state.coreNamespaces, alias.alias) || changed;
  }
  if (valueImport && state.coreSignalEnvelopeOwners.has(namespace)) {
    changed = addToSet(state.coreSignalEnvelopeOwners, alias.alias) || changed;
  }
  if (valueImport && state.serverNamespaces.has(namespace)) {
    changed = addToSet(state.serverNamespaces, alias.alias) || changed;
  }
  if (state.protoNamespaces.has(namespace)) {
    changed = addToSet(state.protoNamespaces, alias.alias) || changed;
  }
  if (state.protoTypeAliases.has(namespace)) {
    changed = addToSet(state.protoTypeAliases, alias.alias) || changed;
  }
  if (valueImport && state.forbiddenApiAliases.has(namespace)) {
    changed =
      addToMap(state.forbiddenApiAliases, alias.alias, state.forbiddenApiAliases.get(namespace)) ||
      changed;
  }
  if (valueImport && state.serverDecoratorAliases.has(namespace)) {
    changed =
      addToMap(
        state.serverDecoratorAliases,
        alias.alias,
        state.serverDecoratorAliases.get(namespace),
      ) || changed;
  }

  return changed;
}

function addToSet(set, value) {
  const size = set.size;
  set.add(value);

  return set.size !== size;
}

function addToMap(map, key, value) {
  if (map.has(key)) {
    return false;
  }

  map.set(key, value);
  return true;
}

function stateForScope(node, baseState) {
  const state = cloneState(baseState);
  const aliasNames = new Set();

  for (const name of scopeDeclaredNames(node)) {
    clearTrackedValue(state, name);
  }

  for (const statement of scopeStatements(node)) {
    if (ts.isTypeAliasDeclaration(statement)) {
      state.localTypeAliases.set(statement.name.text, statement.type);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        recordValueAlias(declaration, state, aliasNames);
      }
    }
  }

  return { state, aliasNames };
}

function clearTrackedValue(state, name) {
  state.serverDecoratorAliases.delete(name);
  state.forbiddenApiAliases.delete(name);
  state.coreNamespaces.delete(name);
  state.coreSignalEnvelopeOwners.delete(name);
  state.serverNamespaces.delete(name);
  state.protoNamespaces.delete(name);
}

function scopeStatements(node) {
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
    return [...node.statements];
  }

  return [];
}

function recordValueAlias(declaration, state, aliasNames) {
  if (declaration.initializer === undefined) {
    return;
  }

  if (ts.isIdentifier(declaration.name)) {
    const alias = readValueAlias(declaration.initializer, state);
    if (alias !== undefined) {
      applyValueAlias(declaration.name.text, alias, state);
      aliasNames.add(declaration.name.text);
    }
    return;
  }

  if (ts.isObjectBindingPattern(declaration.name)) {
    recordObjectAliases(declaration.name, declaration.initializer, state, aliasNames);
  }
}

function recordObjectAliases(binding, initializer, state, aliasNames) {
  const namespace = readNamespaceAlias(initializer, state);
  const objectMembers = namespace === undefined ? readObjectMembers(initializer, state) : undefined;
  if (namespace === undefined && objectMembers === undefined) {
    return;
  }

  for (const element of binding.elements) {
    const name = readPropertyName(element.propertyName ?? element.name);
    const alias = readIdentifierName(element.name);
    if (name !== undefined && alias !== undefined && namespace !== undefined) {
      applyNamespaceMember(alias, namespace, name, state, aliasNames);
    }
    if (name !== undefined && alias !== undefined && objectMembers !== undefined) {
      const member = objectMembers.get(name);
      if (member !== undefined) {
        applyValueAlias(alias, member, state);
        aliasNames.add(alias);
      }
    }
  }
}

function readValueAlias(initializer, state) {
  const expression = unwrappedExpression(initializer);

  if (ts.isIdentifier(expression)) {
    const decoratorName = state.serverDecoratorAliases.get(expression.text);
    if (decoratorName !== undefined) {
      return { kind: "server", name: decoratorName };
    }

    const forbiddenName = state.forbiddenApiAliases.get(expression.text);
    if (forbiddenName !== undefined) {
      return { kind: "forbidden", name: forbiddenName };
    }

    if (state.coreSignalEnvelopeOwners.has(expression.text)) {
      return { kind: "signal-envelope-owner" };
    }

    const namespace = readNamespaceAlias(expression, state);
    return namespace === undefined ? undefined : { kind: "namespace", namespace };
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    expressionPath(expression.expression) !== undefined
  ) {
    const namespace = expressionPath(expression.expression);
    const name = expression.name.text;

    if (namespace !== undefined && state.serverNamespaces.has(namespace)) {
      return { kind: "server", name };
    }
    if (
      namespace !== undefined &&
      name === "SignalEnvelopes" &&
      state.coreNamespaces.has(namespace)
    ) {
      return { kind: "signal-envelope-owner" };
    }
    if (isSignalEnvelopeMember(namespace, name, state)) {
      return { kind: "forbidden", name: `SignalEnvelopes.${name}` };
    }
    if (
      namespace !== undefined &&
      state.protoNamespaces.has(namespace) &&
      name === "EventIdSchema"
    ) {
      return { kind: "forbidden", name };
    }
  }

  if (
    ts.isElementAccessExpression(expression) &&
    expressionPath(expression.expression) !== undefined
  ) {
    const namespace = expressionPath(expression.expression);
    const name = elementAccessStringName(expression);

    if (namespace !== undefined && name !== undefined && state.serverNamespaces.has(namespace)) {
      return { kind: "server", name };
    }
    if (
      namespace !== undefined &&
      name === "SignalEnvelopes" &&
      state.coreNamespaces.has(namespace)
    ) {
      return { kind: "signal-envelope-owner" };
    }
    if (isSignalEnvelopeMember(namespace, name, state)) {
      return { kind: "forbidden", name: `SignalEnvelopes.${name}` };
    }
    if (
      namespace !== undefined &&
      name !== undefined &&
      state.protoNamespaces.has(namespace) &&
      name === "EventIdSchema"
    ) {
      return { kind: "forbidden", name };
    }
  }

  if (ts.isObjectLiteralExpression(expression)) {
    const members = readObjectAlias(expression, state);
    return members.size === 0 ? undefined : { kind: "object", members };
  }

  return undefined;
}

function readNamespaceAlias(initializer, state) {
  const path = expressionPath(initializer);

  if (path !== undefined && state.coreNamespaces.has(path)) {
    return "core";
  }
  if (path !== undefined && state.serverNamespaces.has(path)) {
    return "server";
  }
  if (path !== undefined && state.protoNamespaces.has(path)) {
    return "proto";
  }

  return undefined;
}

function expressionPath(node) {
  const expression = unwrappedExpression(node);

  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = expressionPath(expression.expression);
    return parent === undefined ? undefined : `${parent}.${expression.name.text}`;
  }

  return undefined;
}

function elementAccessStringName(node) {
  const argument = unwrappedExpression(node.argumentExpression);

  return ts.isStringLiteral(argument) ? argument.text : undefined;
}

function applyValueAlias(alias, value, state) {
  if (value.kind === "namespace") {
    addNamespaceAlias(alias, value.namespace, state);
    return;
  }
  if (value.kind === "signal-envelope-owner") {
    state.coreSignalEnvelopeOwners.add(alias);
    return;
  }
  if (value.kind === "server") {
    state.serverDecoratorAliases.set(alias, value.name);
    if (isForbiddenEndUserServerApi(value.name)) {
      state.forbiddenApiAliases.set(alias, value.name);
    }
    return;
  }
  if (value.kind === "object") {
    for (const [name, member] of value.members.entries()) {
      applyValueAlias(`${alias}.${name}`, member, state);
    }
    return;
  }

  state.forbiddenApiAliases.set(alias, value.name);
}

function readObjectAlias(expression, state) {
  const members = new Map();

  for (const property of expression.properties) {
    if (ts.isPropertyAssignment(property)) {
      const name = readPropertyName(property.name);
      const alias = readValueAlias(property.initializer, state);
      if (name !== undefined && alias !== undefined) {
        members.set(name, alias);
      }
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      const alias = readValueAlias(property.name, state);
      if (alias !== undefined) {
        members.set(property.name.text, alias);
      }
    }
  }

  return members;
}

function readObjectMembers(initializer, state) {
  const path = expressionPath(initializer);
  if (path === undefined) {
    return undefined;
  }

  const members = new Map();
  if (isSignalEnvelopeOwner(path, state)) {
    members.set("event", { kind: "forbidden", name: "SignalEnvelopes.event" });
    members.set("command", { kind: "forbidden", name: "SignalEnvelopes.command" });
  }
  const prefix = `${path}.`;

  for (const [key, value] of state.serverDecoratorAliases.entries()) {
    if (key.startsWith(prefix)) {
      members.set(key.slice(prefix.length), { kind: "server", name: value });
    }
  }
  for (const [key, value] of state.forbiddenApiAliases.entries()) {
    if (key.startsWith(prefix)) {
      members.set(key.slice(prefix.length), { kind: "forbidden", name: value });
    }
  }
  for (const key of state.coreNamespaces) {
    if (key.startsWith(prefix)) {
      members.set(key.slice(prefix.length), { kind: "namespace", namespace: "core" });
    }
  }
  for (const key of state.serverNamespaces) {
    if (key.startsWith(prefix)) {
      members.set(key.slice(prefix.length), { kind: "namespace", namespace: "server" });
    }
  }
  for (const key of state.protoNamespaces) {
    if (key.startsWith(prefix)) {
      members.set(key.slice(prefix.length), { kind: "namespace", namespace: "proto" });
    }
  }

  return members.size === 0 ? undefined : members;
}

function addNamespaceAlias(alias, namespace, state) {
  if (namespace === "core") {
    state.coreNamespaces.add(alias);
  }
  if (namespace === "server") {
    state.serverNamespaces.add(alias);
  }
  if (namespace === "proto") {
    state.protoNamespaces.add(alias);
  }
}

function isSignalEnvelopeMember(owner, name, state) {
  return (
    owner !== undefined &&
    (name === "event" || name === "command") &&
    isSignalEnvelopeOwner(owner, state)
  );
}

function isSignalEnvelopeOwner(path, state) {
  if (state.coreSignalEnvelopeOwners.has(path)) {
    return true;
  }

  const suffix = ".SignalEnvelopes";
  return path.endsWith(suffix) && state.coreNamespaces.has(path.slice(0, -suffix.length));
}

function applyNamespaceMember(alias, namespace, name, state, aliasNames) {
  if (namespace === "core" && name === "SignalEnvelopes") {
    state.coreSignalEnvelopeOwners.add(alias);
    aliasNames.add(alias);
  }
  if (namespace === "core" && (name === "event" || name === "command")) {
    state.forbiddenApiAliases.set(alias, name);
  }
  if (namespace === "server") {
    state.serverDecoratorAliases.set(alias, name);
    aliasNames.add(alias);
    if (isForbiddenEndUserServerApi(name)) {
      state.forbiddenApiAliases.set(alias, name);
    }
  }
  if (namespace === "proto" && name === "EventIdSchema") {
    state.forbiddenApiAliases.set(alias, name);
  }
}

function externalModuleName(moduleReference) {
  if (
    ts.isExternalModuleReference(moduleReference) &&
    ts.isStringLiteral(moduleReference.expression)
  ) {
    return moduleReference.expression.text;
  }

  return undefined;
}

function importEqualsMember(moduleReference) {
  if (ts.isQualifiedName(moduleReference)) {
    const path = qualifiedNamePath(moduleReference);
    const separator = path.lastIndexOf(".");
    if (separator > 0) {
      return { namespace: path.slice(0, separator), name: path.slice(separator + 1) };
    }
  }

  return undefined;
}

function qualifiedNamePath(node) {
  return ts.isIdentifier(node.left)
    ? `${node.left.text}.${node.right.text}`
    : `${qualifiedNamePath(node.left)}.${node.right.text}`;
}

function importEqualsNamespace(moduleReference) {
  return ts.isIdentifier(moduleReference) ? moduleReference.text : undefined;
}

function serverDecoratorName(decorator, importState, shadowedNames = new Set()) {
  const expression = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression;

  if (ts.isIdentifier(expression)) {
    if (shadowedNames.has(expression.text)) {
      return undefined;
    }
    return importState.serverDecoratorAliases.get(expression.text);
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    expressionPath(expression.expression) !== undefined
  ) {
    const namespace = expressionPath(expression.expression);
    if (namespace === undefined || shadowedNames.has(namespace.split(".")[0])) {
      return undefined;
    }
    const aliasName = importState.serverDecoratorAliases.get(
      `${namespace}.${expression.name.text}`,
    );
    if (aliasName !== undefined) {
      return aliasName;
    }
    if (importState.serverNamespaces.has(namespace)) {
      return expression.name.text;
    }
  }

  return undefined;
}

function isSchemaBearingDecorator(decorator, name, importState, shadowedNames) {
  return (
    ts.isCallExpression(decorator.expression) &&
    serverDecoratorName(decorator, importState, shadowedNames) === name
  );
}

function forbiddenApiName(node, importState) {
  if (ts.isIdentifier(node)) {
    if (
      node.text === "startTransaction" ||
      node.text === "commitTransaction" ||
      node.text === "rollbackTransaction"
    ) {
      return node.text;
    }
    if (isForbiddenEndUserServerApi(node.text)) {
      return node.text;
    }

    return importState.forbiddenApiAliases.get(node.text);
  }

  if (ts.isPropertyAccessExpression(node) && expressionPath(node.expression) !== undefined) {
    const namespace = expressionPath(node.expression);
    const name = node.name.text;
    const aliasedName =
      namespace === undefined
        ? undefined
        : importState.forbiddenApiAliases.get(`${namespace}.${name}`);
    if (aliasedName !== undefined) {
      return aliasedName;
    }

    if (
      isSignalEnvelopeMember(namespace, name, importState) ||
      (namespace !== undefined &&
        importState.protoNamespaces.has(namespace) &&
        name === "EventIdSchema") ||
      (namespace !== undefined &&
        importState.serverNamespaces.has(namespace) &&
        isForbiddenEndUserServerApi(name))
    ) {
      return isSignalEnvelopeMember(namespace, name, importState)
        ? `SignalEnvelopes.${name}`
        : name;
    }
  }

  if (ts.isElementAccessExpression(node) && expressionPath(node.expression) !== undefined) {
    const namespace = expressionPath(node.expression);
    const name = elementAccessStringName(node);
    const aliasedName =
      namespace === undefined || name === undefined
        ? undefined
        : importState.forbiddenApiAliases.get(`${namespace}.${name}`);
    if (aliasedName !== undefined) {
      return aliasedName;
    }

    if (
      name !== undefined &&
      (isSignalEnvelopeMember(namespace, name, importState) ||
        (namespace !== undefined &&
          importState.protoNamespaces.has(namespace) &&
          name === "EventIdSchema") ||
        (namespace !== undefined &&
          importState.serverNamespaces.has(namespace) &&
          isForbiddenEndUserServerApi(name)))
    ) {
      return isSignalEnvelopeMember(namespace, name, importState)
        ? `SignalEnvelopes.${name}`
        : name;
    }
  }

  return undefined;
}

function isForbiddenEndUserServerApi(name) {
  return forbiddenEndUserServerApis.has(name);
}

function forbiddenTypeLabel(typeNode, importState) {
  const state = { remaining: maxTypeReferenceVisits, seen: new Set(), tooDeep: false };

  return findForbiddenTypeLabel(typeNode, importState, state);
}

function findForbiddenTypeLabel(typeNode, importState, state) {
  state.remaining -= 1;
  if (state.remaining < 0) {
    state.tooDeep = true;
    return tooDeepTypeLabel;
  }

  if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
    return firstForbiddenTypeLabel(typeNode.types, importState, state);
  }

  if (ts.isArrayTypeNode(typeNode)) {
    return findForbiddenTypeLabel(typeNode.elementType, importState, state);
  }

  if (ts.isTupleTypeNode(typeNode)) {
    return firstForbiddenTypeLabel(typeNode.elements, importState, state);
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return findForbiddenTypeLabel(typeNode.type, importState, state);
  }

  if (ts.isTypeOperatorNode(typeNode)) {
    return findForbiddenTypeLabel(typeNode.type, importState, state);
  }

  if (ts.isImportTypeNode(typeNode)) {
    return importTypeEnvelopeLabel(typeNode);
  }

  if (!ts.isTypeReferenceNode(typeNode)) {
    return undefined;
  }

  const { typeName } = typeNode;

  if (ts.isIdentifier(typeName)) {
    const name = typeName.text;

    if (state.seen.has(name)) {
      return undefined;
    }

    const aliasedType = importState.localTypeAliases.get(name);

    if (aliasedType !== undefined) {
      state.seen.add(name);
      if (findForbiddenTypeLabel(aliasedType, importState, state) !== undefined) {
        return state.tooDeep ? tooDeepTypeLabel : name;
      }
      return firstForbiddenTypeLabel(typeNode.typeArguments ?? [], importState, state);
    }

    if (importState.protoTypeAliases.has(name)) {
      return name;
    }

    return firstForbiddenTypeLabel(typeNode.typeArguments ?? [], importState, state);
  }

  if (
    ts.isQualifiedName(typeName) &&
    ts.isIdentifier(typeName.left) &&
    importState.protoNamespaces.has(typeName.left.text) &&
    (typeName.right.text === "Event" || typeName.right.text === "Command")
  ) {
    return `${typeName.left.text}.${typeName.right.text}`;
  }

  return firstForbiddenTypeLabel(typeNode.typeArguments ?? [], importState, state);
}

function importTypeEnvelopeLabel(typeNode) {
  const argument = typeNode.argument;
  if (
    !ts.isLiteralTypeNode(argument) ||
    !ts.isStringLiteral(argument.literal) ||
    argument.literal.text !== "@spine-event-engine/proto"
  ) {
    return undefined;
  }

  const name = qualifiedNameTail(typeNode.qualifier);

  return name === "Event" || name === "Command" ? `spine proto ${name}` : undefined;
}

function qualifiedNameTail(name) {
  if (name === undefined) {
    return undefined;
  }
  if (ts.isIdentifier(name)) {
    return name.text;
  }

  return qualifiedNameTail(name.right);
}

function firstForbiddenTypeLabel(typeNodes, importState, state) {
  for (const typeNode of typeNodes) {
    const label = findForbiddenTypeLabel(typeNode, importState, state);
    if (label !== undefined) {
      return label;
    }
  }

  return undefined;
}

function returnIssue(typeNode, importState, expectedKind) {
  if (forbiddenTypeLabel(typeNode, importState) !== undefined) {
    return undefined;
  }

  return isMessageReturn(typeNode, importState, expectedKind)
    ? undefined
    : `handler return type generated domain ${expectedKind}`;
}

function isMessageReturn(typeNode, importState, expectedKind) {
  const state = { remaining: maxTypeReferenceVisits, seen: new Set() };

  return checkMessageReturn(typeNode, importState, state, expectedKind);
}

function checkMessageReturn(typeNode, importState, state, expectedKind) {
  state.remaining -= 1;
  if (state.remaining < 0) {
    return false;
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return checkMessageReturn(typeNode.type, importState, state, expectedKind);
  }

  if (ts.isTypeOperatorNode(typeNode)) {
    return checkMessageReturn(typeNode.type, importState, state, expectedKind);
  }

  if (ts.isTupleTypeNode(typeNode)) {
    return (
      hasRequiredHead(typeNode, importState, state, expectedKind) &&
      typeNode.elements.every((element) =>
        checkTupleElement(element, importState, state, expectedKind),
      )
    );
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    return checkTypeReturn(typeNode, importState, state, expectedKind);
  }

  return false;
}

function hasRequiredHead(typeNode, importState, state, expectedKind) {
  const first = typeNode.elements[0];

  return (
    first !== undefined &&
    !ts.isRestTypeNode(first) &&
    !ts.isOptionalTypeNode(first) &&
    checkTupleElement(first, importState, state, expectedKind)
  );
}

function checkTupleElement(typeNode, importState, state, expectedKind) {
  if (ts.isRestTypeNode(typeNode)) {
    return (
      ts.isArrayTypeNode(typeNode.type) &&
      checkMessageReturn(typeNode.type.elementType, importState, state, expectedKind)
    );
  }

  if (ts.isNamedTupleMember(typeNode)) {
    if (typeNode.dotDotDotToken !== undefined) {
      return (
        ts.isArrayTypeNode(typeNode.type) &&
        checkMessageReturn(typeNode.type.elementType, importState, state, expectedKind)
      );
    }

    return (
      !typeNode.questionToken && checkTupleElement(typeNode.type, importState, state, expectedKind)
    );
  }

  if (ts.isOptionalTypeNode(typeNode)) {
    return false;
  }

  return checkMessageReturn(typeNode, importState, state, expectedKind);
}

function checkTypeReturn(typeNode, importState, state, expectedKind) {
  const { typeName } = typeNode;

  if (ts.isIdentifier(typeName)) {
    return checkNamedReturn(
      typeName.text,
      typeNode.typeArguments ?? [],
      importState,
      state,
      expectedKind,
    );
  }

  if (ts.isQualifiedName(typeName)) {
    return isGeneratedQualified(typeName, importState, expectedKind);
  }

  return false;
}

function checkNamedReturn(name, typeArguments, importState, state, expectedKind) {
  if (typeArguments.length > 0 || isContainerName(name)) {
    return false;
  }

  const aliasedType = importState.localTypeAliases.get(name);
  if (aliasedType !== undefined) {
    if (state.seen.has(name)) {
      return false;
    }
    state.seen.add(name);
    const matches = checkMessageReturn(aliasedType, importState, state, expectedKind);
    state.seen.delete(name);
    return matches;
  }

  return importState.generatedTypes.get(name) === expectedKind;
}

function isGeneratedQualified(typeName, importState, expectedKind) {
  return generatedQualifiedKind(typeName, importState) === expectedKind;
}

function generatedQualifiedKind(typeName, importState) {
  if (!ts.isIdentifier(typeName.left)) {
    return undefined;
  }

  if (!importState.generatedNamespaces.has(typeName.left.text)) {
    return undefined;
  }

  const moduleKind = importState.generatedNamespaces.get(typeName.left.text);
  if (moduleKind === "command" || moduleKind === "event") {
    return moduleKind;
  }

  return fallbackSignalKind(typeName.right.text);
}

function typeNodeSignalKind(typeNode, importState) {
  const state = { remaining: maxTypeReferenceVisits, seen: new Set() };

  return readSignalKind(typeNode, importState, state);
}

function readSignalKind(typeNode, importState, state) {
  state.remaining -= 1;
  if (state.remaining < 0) {
    return undefined;
  }

  if (ts.isParenthesizedTypeNode(typeNode) || ts.isTypeOperatorNode(typeNode)) {
    return readSignalKind(typeNode.type, importState, state);
  }

  if (!ts.isTypeReferenceNode(typeNode)) {
    return undefined;
  }

  const { typeName } = typeNode;
  if (ts.isIdentifier(typeName)) {
    const aliasedType = importState.localTypeAliases.get(typeName.text);
    if (aliasedType !== undefined) {
      if (state.seen.has(typeName.text)) {
        return undefined;
      }
      state.seen.add(typeName.text);
      const kind = readSignalKind(aliasedType, importState, state);
      state.seen.delete(typeName.text);
      return kind;
    }

    return importState.generatedTypes.get(typeName.text);
  }

  if (ts.isQualifiedName(typeName) && ts.isIdentifier(typeName.left)) {
    return generatedQualifiedKind(typeName, importState);
  }

  return undefined;
}

function fallbackSignalKind(name) {
  if (isCommandName(name)) {
    return "command";
  }
  if (isEventName(name)) {
    return "event";
  }

  return undefined;
}

function isCommandName(name) {
  return !isNonSignalName(name) && !isEventName(name);
}

function isEventName(name) {
  return /Event$/.test(name) || eventSuffixes.some((suffix) => name.endsWith(suffix));
}

function isNonSignalName(name) {
  return /(State|View|Details|Detail|Id|ID|Status|Priority|Pointer|Projection|Result)$/.test(name);
}

function isContainerName(name) {
  return name === "Array" || name === "ReadonlyArray" || name === "Promise";
}

function commandFieldName(node, commandNames) {
  const expression = unwrappedExpression(node);

  if (
    ts.isPropertyAccessExpression(expression) &&
    expressionPath(expression.expression) !== undefined &&
    commandNames.has(expressionPath(expression.expression))
  ) {
    return expression.name.text;
  }

  if (
    ts.isElementAccessExpression(expression) &&
    expressionPath(expression.expression) !== undefined &&
    commandNames.has(expressionPath(expression.expression)) &&
    ts.isStringLiteral(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }

  return undefined;
}

function unwrappedExpression(node) {
  let current = node;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function isRouteTargetField(name) {
  const lowerName = name.toLowerCase();

  return lowerName === "id" || lowerName === "target";
}

function targetIdFieldName(node, commandNames) {
  const fieldName = commandFieldName(node, commandNames);

  return fieldName !== undefined && isRouteTargetField(fieldName) ? fieldName : undefined;
}

function collectTargetChecks(source, file, node, violations) {
  const state = {
    commandNames: new Set(),
    file,
    root: node,
    source,
    targetAliases: new Map(),
    violations,
  };
  seedTargetCommand(state, node.parameters[0]);

  if (state.commandNames.size === 0 && state.targetAliases.size === 0) {
    return;
  }

  if (node.body !== undefined) {
    visitTargetNode(state, node.body);
  }
}

function seedTargetCommand(state, parameter) {
  if (parameter === undefined) {
    return;
  }
  if (ts.isIdentifier(parameter.name)) {
    state.commandNames.add(parameter.name.text);
    return;
  }
  if (ts.isObjectBindingPattern(parameter.name)) {
    recordTargetBinding(parameter.name, state.targetAliases);
  }
}

function visitTargetNode(state, node) {
  if (node !== state.root.body && isFunctionLikeNode(node)) {
    visitTargetFunction(state, node);
    return;
  }

  if (ts.isBlock(node) && node !== state.root.body) {
    visitTargetBlock(state, node);
    return;
  }

  recordCommandTargetAlias(node, state.commandNames, state.targetAliases);
  collectTargetViolations(state, node, true);
  ts.forEachChild(node, (child) => visitTargetNode(state, child));
}

function visitTargetBlock(state, block) {
  const names = scopeDeclaredNames(block);
  const shadowedAliases = takeShadowedTargets(state.targetAliases, names);
  const shadowedCommands = takeShadowedTargets(state.commandNames, names);
  const visitor = state.commandNames.size === 0 ? visitTargetShadow : visitTargetNode;

  for (const statement of block.statements) {
    visitor(state, statement);
  }

  restoreTargetMap(state.targetAliases, shadowedAliases);
  restoreTargetSet(state.commandNames, shadowedCommands);
}

function visitTargetShadow(state, node) {
  if (node !== state.root.body && isFunctionLikeNode(node)) {
    visitTargetFunction(state, node);
    return;
  }

  collectTargetViolations(state, node, false);
  ts.forEachChild(node, (child) => visitTargetShadow(state, child));
}

function visitTargetFunction(state, node) {
  const names = node.parameters.flatMap((parameter) => bindingNames(parameter.name));
  const shadowedAliases = takeShadowedTargets(state.targetAliases, names);
  const shadowedCommands = takeShadowedTargets(state.commandNames, names);
  const visitor = state.commandNames.size === 0 ? visitTargetShadow : visitTargetNode;

  ts.forEachChild(node, (child) => visitor(state, child));
  restoreTargetMap(state.targetAliases, shadowedAliases);
  restoreTargetSet(state.commandNames, shadowedCommands);
}

function collectTargetViolations(state, node, includeCommandFields) {
  if (!ts.isCallExpression(node) || !isValidationCall(node)) {
    return;
  }

  for (const argument of node.arguments) {
    const fieldName =
      (includeCommandFields ? targetIdFieldName(argument, state.commandNames) : undefined) ??
      targetAliasFieldName(argument, state.targetAliases);
    if (fieldName !== undefined) {
      state.violations.push({
        kind: "api",
        detail: lineDetail(
          state.source,
          state.file,
          argument,
          `command target validation "${fieldName}"`,
        ),
      });
    }
  }
}

function takeShadowedTargets(collection, names) {
  return collection instanceof Map
    ? takeShadowedTargetMap(collection, names)
    : takeShadowedTargetSet(collection, names);
}

function takeShadowedTargetMap(map, names) {
  const removed = [];
  for (const name of names) {
    for (const [key, value] of [...map.entries()]) {
      if (key === name || key.startsWith(`${name}.`)) {
        removed.push([key, value]);
        map.delete(key);
      }
    }
  }
  return removed;
}

function takeShadowedTargetSet(set, names) {
  const removed = [];
  for (const name of names) {
    for (const value of [...set]) {
      if (value === name || value.startsWith(`${name}.`)) {
        removed.push(value);
        set.delete(value);
      }
    }
  }
  return removed;
}

function restoreTargetMap(map, entries) {
  for (const [key, value] of entries.reverse()) {
    map.set(key, value);
  }
}

function restoreTargetSet(set, values) {
  for (const value of values.reverse()) {
    set.add(value);
  }
}

function bindingNames(name) {
  const names = [];
  collectBindingNames(name, names);
  return names;
}

function collectBindingNames(name, names) {
  if (ts.isIdentifier(name)) {
    names.push(name.text);
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        collectBindingNames(element.name, names);
      }
    }
  }
}

function recordCommandTargetAlias(node, commandNames, targetAliases) {
  if (!ts.isVariableDeclaration(node)) {
    return;
  }

  if (ts.isIdentifier(node.name) && node.initializer !== undefined) {
    const initializerPath = expressionPath(node.initializer);
    if (initializerPath !== undefined && commandNames.has(initializerPath)) {
      commandNames.add(node.name.text);
    }

    const fieldName =
      targetIdFieldName(node.initializer, commandNames) ??
      targetAliasFieldName(node.initializer, targetAliases);
    if (fieldName !== undefined) {
      targetAliases.set(node.name.text, fieldName);
    }
  }

  if (ts.isIdentifier(node.name) && ts.isObjectLiteralExpression(node.initializer)) {
    for (const property of node.initializer.properties) {
      if (ts.isPropertyAssignment(property)) {
        recordCommandObjectProperty(
          node.name.text,
          readPropertyName(property.name),
          property.initializer,
          commandNames,
          targetAliases,
        );
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        recordCommandObjectProperty(
          node.name.text,
          property.name.text,
          property.name,
          commandNames,
          targetAliases,
        );
      }
    }
  }

  if (
    ts.isObjectBindingPattern(node.name) &&
    node.initializer !== undefined &&
    expressionPath(node.initializer) !== undefined &&
    commandNames.has(expressionPath(node.initializer))
  ) {
    recordTargetBinding(node.name, targetAliases);
  }

  if (
    ts.isObjectBindingPattern(node.name) &&
    node.initializer !== undefined &&
    expressionPath(node.initializer) !== undefined
  ) {
    const objectName = expressionPath(node.initializer);
    for (const element of node.name.elements) {
      const propertyName = readPropertyName(element.propertyName ?? element.name);
      const aliasName = readIdentifierName(element.name);
      const fieldName =
        propertyName === undefined ? undefined : targetAliases.get(`${objectName}.${propertyName}`);
      if (aliasName !== undefined && fieldName !== undefined) {
        targetAliases.set(aliasName, fieldName);
      }
    }
  }
}

function recordCommandObjectProperty(
  objectName,
  propertyName,
  initializer,
  commandNames,
  targetAliases,
) {
  const propertyPath = propertyName === undefined ? undefined : `${objectName}.${propertyName}`;
  const initializerPath = expressionPath(initializer);
  if (
    propertyPath !== undefined &&
    initializerPath !== undefined &&
    commandNames.has(initializerPath)
  ) {
    commandNames.add(propertyPath);
  }
  const fieldName =
    targetIdFieldName(initializer, commandNames) ??
    targetAliasFieldName(initializer, targetAliases);
  if (propertyPath !== undefined && fieldName !== undefined) {
    targetAliases.set(propertyPath, fieldName);
  }
}

function recordTargetBinding(binding, targetAliases) {
  for (const element of binding.elements) {
    const fieldName = readPropertyName(element.propertyName ?? element.name);
    const aliasName = readIdentifierName(element.name);
    if (fieldName !== undefined && aliasName !== undefined && isRouteTargetField(fieldName)) {
      targetAliases.set(aliasName, fieldName);
    }
  }
}

function targetAliasFieldName(node, targetAliases) {
  const expression = unwrappedExpression(node);

  if (ts.isIdentifier(expression)) {
    return targetAliases.get(expression.text);
  }
  if (ts.isPropertyAccessExpression(expression) && expressionPath(expression) !== undefined) {
    return targetAliases.get(expressionPath(expression));
  }

  return undefined;
}

function isValidationCall(node) {
  const name = callName(node.expression);

  return name !== undefined && /(?:^(assert|ensure|require|validate)|id$|target$)/i.test(name);
}

function callName(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return undefined;
}

function isFunctionLikeNode(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function lineDetail(source, file, node, label) {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${file}:${position.line + 1} ${label}`;
}

function scanTypeScriptStructure(repoRoot, files, sourceTexts = new Map()) {
  const failures = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      sourceTexts.get(file) ?? readFileSync(join(repoRoot, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      scriptKindForFile(file),
    );
    const occurrences = new Map();
    const ownedFunctions = new Set();
    function recordName(name, kind, node) {
      if (name === undefined || semanticComponents(name).length <= maxSemanticComponents) return;
      const key = `${kind}\u0000${name}`;
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      failures.push({
        rule: "semantic-name",
        file,
        kind,
        identity: `${kind}:${name}#${occurrence}`,
        name,
        components: semanticComponents(name).length,
        node,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
    }
    function recordBinding(name, kind, node) {
      if (ts.isIdentifier(name)) recordName(name.text, kind, node);
      if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
        for (const element of name.elements) {
          if (ts.isBindingElement(element)) recordBinding(element.name, "binding", element);
        }
      }
    }
    function functionIdentity(node) {
      const names = [];
      let current = node;
      while (current.parent !== undefined) {
        if (ts.isFunctionDeclaration(current) && current.name !== undefined)
          names.push(current.name.text);
        current = current.parent;
      }
      const base = `${names.reverse().join("/")}()`;
      const key = `function-declaration\u0000${base}`;
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      return `${base}#${occurrence}`;
    }
    function visit(node) {
      if (
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isModuleDeclaration(node)
      )
        recordName(node.name?.text, ts.SyntaxKind[node.kind], node);
      if (ts.isVariableDeclaration(node)) recordBinding(node.name, "variable", node);
      if (ts.isParameter(node)) recordBinding(node.name, "parameter", node);
      if (
        ts.isPropertyDeclaration(node) ||
        ts.isPropertySignature(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isMethodSignature(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isEnumMember(node)
      )
        recordName(readPropertyName(node.name), ts.SyntaxKind[node.kind], node);
      if (ts.isImportSpecifier(node)) recordName(node.name.text, "import-alias", node);
      if (ts.isNamespaceImport(node) || (ts.isImportClause(node) && node.name !== undefined))
        recordName(node.name.text, "import-alias", node);
      if (ts.isImportEqualsDeclaration(node)) recordName(node.name.text, "import-alias", node);
      if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
        failures.push({
          rule: "standalone-function",
          file,
          kind: "function-declaration",
          identity: functionIdentity(node),
          name: node.name.text,
          node,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
      }
      if (
        ts.isPropertyAssignment(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isMethodSignature(node)
      ) {
        const parent = node.parent;
        if (ts.isObjectLiteralExpression(parent)) {
          const declaration = parent.parent;
          if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
            ownedFunctions.add(
              `${file}\u0000${declaration.name.text}.${readPropertyName(node.name)}()`,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const failure of failures) {
      if (failure.file === file && failure.rule === "standalone-function")
        failure.ownedFunctions = ownedFunctions;
    }
  }
  return failures;
}

function structureFailureKey(entry) {
  return `${entry.rule}\u0000${entry.file}\u0000${entry.kind}\u0000${entry.identity}`;
}

function structureFailureDetail(failure) {
  const line = failure.line === undefined ? "" : `:${failure.line}`;
  return failure.rule === "semantic-name"
    ? `${failure.file}${line} ${failure.name} (${failure.components} components)`
    : `${failure.file}${line} ${failure.identity}`;
}

function structurePartition(file) {
  if (/^packages\/(?:proto|core|storage|transport)\//.test(file)) return "T-0080D";
  if (/^packages\/(?:storage-datastore|storage-rdbms|delivery-server)\//.test(file))
    return "T-0080E";
  if (/^packages\/server\//.test(file)) return "T-0080F";
  if (/^packages\/(?:auth|client-web|client-react)\//.test(file)) return "T-0080G";
  if (/^packages\//.test(file)) return "T-0080H";
  if (/^examples\/message-board\/(?:app|web)\//.test(file)) return "T-0080K";
  if (/^examples\/message-board\/model\//.test(file)) return "T-0080J";
  if (/^examples\/todo\//.test(file)) return "T-0080L";
  if (/^examples\/projects\//.test(file)) return "T-0080M";
  if (/^examples\/orders\//.test(file)) return "T-0080N";
  throw new Error(`No TypeScript structure partition owns ${file}`);
}

function readStructureLedgers(repoRoot) {
  const names = readStructureLedger(repoRoot, "typescript-structure-debt", "semantic-name");
  const functions = readStructureLedger(
    repoRoot,
    "standalone-function-necessities",
    "standalone-function",
  );
  return { names, functions };
}

function readStructureLedger(repoRoot, directory, rule) {
  const root = join(repoRoot, "build-protocol", directory);
  if (!existsSync(root)) return [];
  const entries = [];
  for (const filename of readdirSync(root).sort()) {
    if (!filename.endsWith(".json") || !structurePartitions.includes(filename.slice(0, -5)))
      throw new Error(`Unexpected ${rule} partition: ${relative(repoRoot, join(root, filename))}`);
    let values;
    try {
      values = JSON.parse(readFileSync(join(root, filename), "utf8"));
    } catch {
      throw new Error(`Malformed ${rule} partition: ${relative(repoRoot, join(root, filename))}`);
    }
    if (!Array.isArray(values))
      throw new Error(`Malformed ${rule} partition: ${relative(repoRoot, join(root, filename))}`);
    for (const value of values) {
      const required = ["rule", "file", "kind", "identity", "name", "reason"];
      if (rule === "standalone-function") required.push("disposition");
      if (rule === "semantic-name") required.push("disposition");
      if (
        Object.keys(value ?? {}).some(
          (key) => !required.includes(key) && key !== "sourceContract",
        ) ||
        required.some((key) => typeof value?.[key] !== "string") ||
        value.rule !== rule ||
        !/^(packages|examples)\//.test(value.file) ||
        value.file.includes("..") ||
        value.file.includes("\\") ||
        structurePartition(value.file) !== filename.slice(0, -5)
      )
        throw new Error(
          `Malformed or broadened ${rule} entry: ${relative(repoRoot, join(root, filename))}`,
        );
      if (
        rule === "semantic-name" &&
        !["migration-debt", "compatibility-exception"].includes(value.disposition)
      )
        throw new Error(
          `Malformed semantic-name disposition: ${relative(repoRoot, join(root, filename))}`,
        );
      if (
        rule === "semantic-name" &&
        value.disposition === "compatibility-exception" &&
        (typeof value.sourceContract !== "string" ||
          value.sourceContract.length < 12 ||
          !/\b(Spine|JVM|wire|Proto)\b/.test(value.sourceContract) ||
          !/\b[a-z][\w-]*(?:\.[a-z][\w-]*)+\.[A-Z][\w]*\b/.test(value.sourceContract))
      )
        throw new Error(
          `Invalid semantic compatibility source contract: ${relative(repoRoot, join(root, filename))}`,
        );
      if (value.disposition === "migration-debt" && !baselineContains(repoRoot, value))
        throw new Error(
          `Migration debt was not observed at immutable baseline: ${value.file} ${value.identity}`,
        );
      if (
        rule === "standalone-function" &&
        !["migration-debt", "necessity"].includes(value.disposition)
      )
        throw new Error(
          `Malformed standalone disposition: ${relative(repoRoot, join(root, filename))}`,
        );
      if (
        rule === "standalone-function" &&
        value.disposition === "necessity" &&
        (!/\b(JavaScript|TypeScript|callback identity|framework boundary|Spine JVM)\b/i.test(
          value.reason,
        ) ||
          /\b(helper|legacy)\b/i.test(value.reason) ||
          value.reason.trim().split(/\s+/).length < 7 ||
          !value.reason.includes(value.name))
      )
        throw new Error(
          `Generic standalone necessity reason: ${relative(repoRoot, join(root, filename))}`,
        );
      if (
        rule === "standalone-function" &&
        value.disposition === "migration-debt" &&
        !/^Pre-T-0080 observed standalone declaration /.test(value.reason)
      )
        throw new Error(
          `Generic standalone migration disposition: ${relative(repoRoot, join(root, filename))}`,
        );
      entries.push(value);
    }
  }
  const seen = new Set();
  for (const entry of entries) {
    const key = structureFailureKey(entry);
    if (seen.has(key)) throw new Error(`Duplicate ${rule} entry: ${key}`);
    seen.add(key);
  }
  return entries;
}

function baselineContains(repoRoot, entry) {
  const baselineFile = movedChatBaselinePath(entry.file);
  const key = `${repoRoot}\u0000${migrationBaseline}\u0000${baselineFile}`;
  let source = baselineSourceCache.get(key);
  if (source === undefined) {
    const result = runGit(repoRoot, ["show", `${migrationBaseline}:${baselineFile}`]);
    if (result.status !== 0)
      throw new Error(`Immutable structure baseline ${migrationBaseline} is unavailable.`);
    source = result.status === 0 ? result.stdout : "";
    baselineSourceCache.set(key, source);
  }
  return baselineObservesStructureEntry(entry, source);
}

export function movedChatBaselinePath(file) {
  return file
    .replace(/^examples\/message-board\/app\//, "examples/chat/")
    .replace(/^examples\/message-board\/web\//, "examples/chat-web/")
    .replace(/^examples\/message-board\/model\//, "examples/chat-model/")
    .replace(/^examples\/chat\/users-model\//, "examples/users-model/")
    .replace(/^examples\/projects\//, "examples/project-management/")
    .replace(/^examples\/orders\//, "examples/datastore-orders/");
}

export function baselineObservesStructureEntry(entry, source) {
  if (source.length === 0) return false;
  return scanTypeScriptStructure("", [entry.file], new Map([[entry.file, source]])).some(
    (failure) => structureFailureKey(failure) === structureFailureKey(entry),
  );
}

function writeStructureDebtPartitions(repoRoot) {
  const root = resolve(repoRoot);
  const files = authoredTypeScriptSourceFiles(
    authoredCodeFiles(trackedFiles(root)),
    trackedFiles(root),
  );
  const failures = scanTypeScriptStructure(root, files);
  for (const [directory, rule] of [
    ["typescript-structure-debt", "semantic-name"],
    ["standalone-function-necessities", "standalone-function"],
  ]) {
    const target = join(root, "build-protocol", directory);
    mkdirSync(target, { recursive: true });
    const byPartition = new Map(structurePartitions.map((partition) => [partition, []]));
    for (const failure of failures.filter((item) => item.rule === rule)) {
      const migrationReason = `Pre-T-0080 observed standalone declaration ${failure.identity}`;
      const entry = {
        rule,
        file: failure.file,
        kind: failure.kind,
        identity: failure.identity,
        name: failure.name,
        disposition: "migration-debt",
        reason:
          rule === "semantic-name"
            ? "Pre-T-0080 semantic-name migration debt owned by the assigned remediation slice."
            : `${migrationReason} requires remediation by the assigned slice.`,
      };
      byPartition.get(structurePartition(failure.file)).push(entry);
    }
    for (const [partition, entries] of byPartition)
      writeFileSync(
        join(target, `${partition}.json`),
        `${JSON.stringify(
          entries.sort((a, b) => structureFailureKey(a).localeCompare(structureFailureKey(b))),
          null,
          2,
        )}\n`,
      );
  }
}

function checkTypeScriptStructure(repoRoot, files) {
  const failures = scanTypeScriptStructure(repoRoot, files);
  const ledger = readStructureLedgers(repoRoot);
  const observed = new Set(failures.map(structureFailureKey));
  const nameDebt = new Set(ledger.names.map(structureFailureKey));
  const functionDebt = new Set(ledger.functions.map(structureFailureKey));
  const semanticViolations = failures
    .filter(
      (failure) => failure.rule === "semantic-name" && !nameDebt.has(structureFailureKey(failure)),
    )
    .map(structureFailureDetail);
  const callbackTypeViolations = [];
  const callbackNameViolations = [];
  const standaloneViolations = failures
    .filter(
      (failure) =>
        failure.rule === "standalone-function" && !functionDebt.has(structureFailureKey(failure)),
    )
    .map(structureFailureDetail);
  const staleNames = ledger.names
    .filter((entry) => !observed.has(structureFailureKey(entry)))
    .map((entry) => `${entry.file} ${entry.identity}`);
  const staleFunctions = ledger.functions
    .filter((entry) => !observed.has(structureFailureKey(entry)))
    .map((entry) => `${entry.file} ${entry.identity}`);
  const ownedFunctionIdentities = new Set(
    failures.flatMap((failure) => [...(failure.ownedFunctions ?? [])]),
  );
  const ownedFunctions = ledger.functions
    .filter((entry) => ownedFunctionIdentities.has(`${entry.file}\u0000${entry.identity}`))
    .map((entry) => `${entry.file} ${entry.identity}`);

  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(repoRoot, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    function visit(node) {
      if (
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isFunctionDeclaration(node)
      ) {
        const name = node.name?.text;
        if (name?.endsWith("Callback") === true && !name.startsWith("On")) {
          const position = source.getLineAndCharacterOfPosition(node.name.getStart(source));
          callbackTypeViolations.push(`${file}:${position.line + 1} ${name}`);
        }
      }

      if (ts.isParameter(node)) {
        const name = readIdentifierName(node.name);

        if (
          name !== undefined &&
          name !== "callback" &&
          !name.startsWith("on") &&
          hasCallbackType(node)
        ) {
          const position = source.getLineAndCharacterOfPosition(node.name.getStart(source));
          callbackNameViolations.push(`${file}:${position.line + 1} ${name}`);
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(source);
  }

  return [
    semanticViolations.length > 0 && {
      title: "semantic name components exceed 4",
      details: semanticViolations,
    },
    callbackTypeViolations.length > 0 && {
      title: "callback type names must start with On",
      details: callbackTypeViolations,
    },
    callbackNameViolations.length > 0 && {
      title: "callback names must start with on",
      details: callbackNameViolations,
    },
    standaloneViolations.length > 0 && {
      title: "standalone functions require exact necessity dispositions",
      details: standaloneViolations,
    },
    staleNames.length > 0 && { title: "stale semantic-name exception", details: staleNames },
    staleFunctions.length > 0 && {
      title: "stale standalone necessity disposition",
      details: staleFunctions,
    },
    ownedFunctions.length > 0 && {
      title: "standalone necessity is already owned by a class or named object",
      details: ownedFunctions,
    },
  ].filter(Boolean);
}

function checkExampleSourceGuardrails(repoRoot, files) {
  const resolvedRepoRoot = realpathSync(repoRoot);
  const violations = files.flatMap((file) =>
    collectExampleFileViolations(repoRoot, resolvedRepoRoot, file),
  );

  return groupExampleViolations(violations);
}

function collectExampleFileViolations(repoRoot, resolvedRepoRoot, file) {
  const source = readExampleSource(repoRoot, resolvedRepoRoot, file);

  if (source.kind === "symlink") {
    return [source];
  }

  return collectExampleApiViolations(source.file, source.source);
}

function readExampleSource(repoRoot, resolvedRepoRoot, file) {
  let resolvedFile;
  try {
    resolvedFile = realpathSync(join(repoRoot, file));
  } catch {
    return {
      kind: "symlink",
      detail: `${file} cannot be resolved within the repository root`,
    };
  }

  if (resolvesOutsideRoot(resolvedRepoRoot, resolvedFile)) {
    return {
      kind: "symlink",
      detail: `${file} resolves outside the repository root`,
    };
  }

  return {
    kind: "source",
    file,
    source: ts.createSourceFile(
      file,
      readFileSync(resolvedFile, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      scriptKindForFile(file),
    ),
  };
}

function resolvesOutsideRoot(resolvedRepoRoot, resolvedFile) {
  const relativeResolvedFile = relative(resolvedRepoRoot, resolvedFile);

  return (
    relativeResolvedFile.startsWith("..") ||
    relativeResolvedFile === ".." ||
    relativeResolvedFile.split(sep).includes("..")
  );
}

function collectExampleApiViolations(file, source) {
  const violations = [];
  const schemaDecorators = ["Assign", "Command", "React", "Subscribe"];
  const handlerDecorators = new Set(["Apply", ...schemaDecorators]);
  const importState = buildImportState(source);

  function visit(node, state = importState, shadowedNames = new Set()) {
    const scope = stateForScope(node, state);
    const scopedState = scope.state;
    const scopedShadowedNames = shadowedNamesForNode(
      node,
      shadowedNames,
      scopedState,
      scope.aliasNames,
    );

    if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) {
      const decorators = nodeDecorators(node);
      const decoratorNames = decorators
        .map((decorator) => serverDecoratorName(decorator, scopedState, scopedShadowedNames))
        .filter(Boolean);

      for (const decorator of decorators) {
        if (serverDecoratorName(decorator, scopedState, scopedShadowedNames) === "Apply") {
          violations.push({
            kind: "api",
            detail: lineDetail(source, file, decorator, "@Apply"),
          });
        }

        for (const name of schemaDecorators) {
          if (isSchemaBearingDecorator(decorator, name, scopedState, scopedShadowedNames)) {
            violations.push({
              kind: "api",
              detail: lineDetail(source, file, decorator, `@${name}(...)`),
            });
          }
        }
      }

      for (const returnViolation of handlerReturnViolations(node, decoratorNames, scopedState)) {
        violations.push({
          kind: "api",
          detail: lineDetail(source, file, node, returnViolation),
        });
      }

      for (const parameterViolation of handlerParameterViolations(node, decoratorNames)) {
        violations.push({
          kind: "api",
          detail: lineDetail(source, file, node, parameterViolation),
        });
      }

      const returnTypeLabel =
        node.type === undefined ? undefined : forbiddenTypeLabel(node.type, scopedState);
      if (
        decoratorNames.some((name) => handlerDecorators.has(name)) &&
        returnTypeLabel !== undefined
      ) {
        violations.push({
          kind: "api",
          detail: lineDetail(source, file, node.type, `handler return type ${returnTypeLabel}`),
        });
      }

      if (needsTargetGuard(node, decoratorNames, scopedState)) {
        collectTargetChecks(source, file, node, violations);
      }
    }

    const apiName = forbiddenApiName(node, scopedState);
    if (apiName !== undefined) {
      violations.push({
        kind: "api",
        detail: lineDetail(source, file, node, apiName),
      });
    }

    ts.forEachChild(node, (child) => visit(child, scopedState, scopedShadowedNames));
  }

  visit(source);
  return violations;
}

function needsTargetGuard(node, decoratorNames, importState) {
  return (
    decoratorNames.some((name) => name === "Assign") ||
    (decoratorNames.some((name) => name === "Command") && hasCommandParameter(node, importState))
  );
}

function hasCommandParameter(node, importState) {
  const type = node.parameters[0]?.type;

  return type !== undefined && typeNodeSignalKind(type, importState) === "command";
}

function shadowedNamesForNode(node, inheritedNames, importState, aliasNames) {
  const localNames = scopeDeclaredNames(node).filter(
    (name) =>
      !aliasNames.has(name) &&
      (importState.serverDecoratorAliases.has(name) || importState.serverNamespaces.has(name)),
  );

  if (localNames.length === 0) {
    return inheritedNames;
  }

  return new Set([...inheritedNames, ...localNames]);
}

function scopeDeclaredNames(node) {
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
    return node.statements.flatMap(statementDeclaredNames);
  }
  if (isFunctionLikeNode(node)) {
    return node.parameters.flatMap((parameter) => {
      const names = [];
      collectBindingNames(parameter.name, names);
      return names;
    });
  }
  if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
    const names = [];
    collectBindingNames(node.variableDeclaration.name, names);
    return names;
  }

  return [];
}

function statementDeclaredNames(statement) {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return statement.name === undefined ? [] : [statement.name.text];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) => {
      const names = [];
      collectBindingNames(declaration.name, names);
      return names;
    });
  }

  return [];
}

function handlerReturnViolations(node, decoratorNames, importState) {
  const violations = [];

  for (const name of decoratorNames) {
    if (name === "Assign" || name === "Command" || name === "React") {
      if (node.type === undefined) {
        violations.push(`@${name} handler return type annotation`);
      } else {
        const expectedKind = name === "Command" ? "command" : "event";
        const issue = returnIssue(node.type, importState, expectedKind);
        if (issue !== undefined) {
          violations.push(issue);
        }
      }
    }
    if (name === "Subscribe" && !isVoidTypeNode(node.type)) {
      violations.push("@Subscribe handler return type void");
    }
  }

  return violations;
}

function handlerParameterViolations(node, decoratorNames) {
  const violations = [];

  for (const name of decoratorNames) {
    if (
      (name === "Assign" || name === "Command" || name === "React" || name === "Subscribe") &&
      node.parameters[0]?.type === undefined
    ) {
      violations.push(`@${name} handler first parameter type annotation`);
    }
  }

  return violations;
}

function isVoidTypeNode(type) {
  return type?.kind === ts.SyntaxKind.VoidKeyword;
}

function groupExampleViolations(violations) {
  const failures = [];
  const symlinkViolations = violations
    .filter((violation) => violation.kind === "symlink")
    .map((violation) => violation.detail);
  const apiViolations = violations
    .filter((violation) => violation.kind === "api")
    .map((violation) => violation.detail);

  if (symlinkViolations.length > 0) {
    failures.push({
      title: "example source symlinks must resolve within the repository root",
      details: symlinkViolations,
    });
  }

  if (apiViolations.length > 0) {
    failures.push({
      title: "end-user example source uses forbidden API patterns",
      details: apiViolations,
    });
  }

  return failures;
}

function printFailures(failures) {
  for (const failure of failures) {
    console.error(`Cleanup enforcement failed: ${safeDetail(failure.title)}`);

    for (const detail of failure.details.slice(0, 40)) {
      console.error(`  - ${safeDetail(detail)}`);
    }

    if (failure.details.length > 40) {
      console.error(`  - ... ${failure.details.length - 40} more`);
    }
  }
}

function safeDetail(value) {
  return Array.from(String(value), safeCharacter).join("");
}

function safeCharacter(character) {
  const code = character.codePointAt(0);
  if (code === undefined) {
    return "";
  }
  if (!isUnsafeDiagnosticCode(code)) {
    return character;
  }
  switch (character) {
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
    default:
      return `\\u{${code.toString(16)}}`;
  }
}

function isUnsafeDiagnosticCode(code) {
  return (
    code <= 31 ||
    (code >= 127 && code <= 159) ||
    code === 0x061c ||
    code === 0x180e ||
    code === 0x200b ||
    code === 0x200c ||
    code === 0x200d ||
    code === 0x200e ||
    code === 0x200f ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff ||
    (code >= 0xe0000 && code <= 0xe007f) ||
    (code >= 0xe0100 && code <= 0xe01ef)
  );
}
