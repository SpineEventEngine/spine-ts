import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const callableVerbs = new Set([
  "adds",
  "builds",
  "checks",
  "creates",
  "describes",
  "finds",
  "gets",
  "loads",
  "maps",
  "reads",
  "returns",
  "sets",
  "updates",
  "validates",
  "writes",
  "accepts",
  "acquires",
  "asserts",
  "attaches",
  "awaits",
  "binds",
  "calculates",
  "calls",
  "captures",
  "clears",
  "collects",
  "compares",
  "completes",
  "composes",
  "connects",
  "copies",
  "decodes",
  "deletes",
  "delivers",
  "determines",
  "dispatches",
  "encodes",
  "executes",
  "exposes",
  "fetches",
  "groups",
  "initializes",
  "inspects",
  "invokes",
  "joins",
  "lists",
  "matches",
  "merges",
  "normalizes",
  "notifies",
  "observes",
  "persists",
  "prepares",
  "processes",
  "publishes",
  "queues",
  "records",
  "registers",
  "rejects",
  "removes",
  "renders",
  "restores",
  "retries",
  "routes",
  "schedules",
  "serializes",
  "snapshots",
  "stores",
  "streams",
  "transforms",
  "translates",
  "verifies",
  "waits",
  "watches",
  "wraps",
  "yields",
  "activates",
  "applies",
  "cancels",
  "closes",
  "converts",
  "ensures",
  "formats",
  "handles",
  "opens",
  "packs",
  "parses",
  "posts",
  "performs",
  "resolves",
  "sends",
  "starts",
  "stops",
  "subscribes",
  "throws",
  "unpacks",
]);
const sourceExtension = /\.(?:cts|mts|ts|tsx)$/;
const remediationPartitions = [
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

export function checkTsdoc(repoRoot) {
  const root = realpathSync(resolve(repoRoot));
  return applyDebt(root, scanTsdoc(root)).sort(compareFailures);
}

function scanTsdoc(root) {
  const files = trackedSourceFiles(root);
  const failures = [];
  const confined = [];
  for (const file of files) {
    const sourcePath = join(root, file);
    try {
      const resolved = realpathSync(sourcePath);
      if (isConfined(root, resolved)) confined.push({ file, sourcePath });
      else failures.push({ rule: "path-confinement", file, name: "source" });
    } catch {
      failures.push({ rule: "path-confinement", file, name: "source" });
    }
  }
  const program = ts.createProgram(
    confined.map(({ sourcePath }) => sourcePath),
    {
      allowJs: false,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
    },
  );
  const checker = program.getTypeChecker();

  for (const { file, sourcePath } of confined) {
    const source = program.getSourceFile(sourcePath);
    if (source === undefined) {
      failures.push({ rule: "source-program", file, name: "source" });
      continue;
    }
    visitSource(source, file, checker, failures);
  }

  return failures;
}

function isConfined(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !path.split(/[\\/]/u).includes(".."));
}

function applyDebt(root, failures) {
  const debt = readDebt(root);
  if (debt.size === 0) return failures;
  const observed = new Set(failures.map(failureKey));
  const stale = [...debt].filter((entry) => !observed.has(entry));
  const newFailures = failures.filter((failure) => !debt.has(failureKey(failure)));
  return [
    ...newFailures,
    ...stale.map(parseDebtKey).map((failure) => ({ ...failure, rule: "stale-debt" })),
  ];
}

function readDebt(root) {
  const debtRoot = join(root, "build-protocol", "tsdoc-debt");
  if (!existsSync(debtRoot)) return new Set();
  const entries = new Set();
  for (const filename of readdirSync(debtRoot).sort()) {
    if (
      !filename.endsWith(".json") ||
      !remediationPartitions.includes(filename.replace(/\.json$/, ""))
    )
      throw new Error(
        `Unexpected TSDoc debt partition: ${relative(root, join(debtRoot, filename))}`,
      );
    const partition = join(debtRoot, filename);
    let values;
    try {
      values = JSON.parse(readFileSync(partition, "utf8"));
    } catch {
      throw new Error(`Malformed TSDoc debt partition: ${relative(root, partition)}`);
    }
    if (!Array.isArray(values))
      throw new Error(`Malformed TSDoc debt partition: ${relative(root, partition)}`);
    for (const value of values) {
      if (
        Object.keys(value ?? {}).length !== 3 ||
        typeof value?.rule !== "string" ||
        typeof value?.file !== "string" ||
        typeof value?.name !== "string"
      ) {
        throw new Error(`Malformed TSDoc debt entry: ${relative(root, partition)}`);
      }
      if (!isAuthoredSource(value.file) || value.file.includes("..") || value.file.includes("\\")) {
        throw new Error(`Out-of-scope TSDoc debt entry: ${relative(root, partition)}`);
      }
      if (debtPartition(value.file) !== filename.replace(/\.json$/, "")) {
        throw new Error(`Wrong TSDoc debt partition: ${relative(root, partition)}`);
      }
      const entry = failureKey(value);
      if (entries.has(entry)) throw new Error(`Duplicate TSDoc debt entry: ${entry}`);
      entries.add(entry);
    }
  }
  return entries;
}

function debtPartition(file) {
  if (/^packages\/(?:proto|core|storage|transport)\//.test(file)) return "T-0080D";
  if (/^packages\/(?:storage-datastore|storage-rdbms|delivery-server)\//.test(file))
    return "T-0080E";
  if (/^packages\/server\//.test(file)) return "T-0080F";
  if (/^packages\/(?:auth|client-web|client-react)\//.test(file)) return "T-0080G";
  if (/^packages\//.test(file)) return "T-0080H";
  if (/^examples\/(?:chat|chat-web|chat-model|users-model)\//.test(file)) return "T-0080K";
  if (/^examples\/todo\//.test(file)) return "T-0080L";
  if (/^examples\/project-management\//.test(file)) return "T-0080M";
  if (/^examples\/datastore-orders\//.test(file)) return "T-0080N";
  throw new Error(`No TSDoc debt partition owns ${file}`);
}

function failureKey(failure) {
  return `${failure.rule}\u0000${failure.file}\u0000${failure.name}`;
}

function parseDebtKey(key) {
  const [rule, file, name] = key.split("\u0000");
  return { rule, file, name };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const repoRoot = readRepoRoot(args);
    if (args.includes("--write-debt")) {
      writeDebt(repoRoot);
      console.log("TSDoc debt partitions written.");
      process.exit(0);
    }
    const failures = checkTsdoc(repoRoot);
    if (failures.length > 0) {
      printFailures(failures);
      process.exit(1);
    }
    console.log("TSDoc enforcement checks passed.");
  } catch (error) {
    console.error(escapeDetail(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

function writeDebt(repoRoot) {
  const root = realpathSync(resolve(repoRoot));
  const debtRoot = join(root, "build-protocol", "tsdoc-debt");
  const sourceFailures = scanTsdoc(root);
  const partitions = new Map();
  for (const failure of sourceFailures) {
    const partition = debtPartition(failure.file);
    const entries = partitions.get(partition) ?? [];
    entries.push(failure);
    partitions.set(partition, entries);
  }
  mkdirSync(debtRoot, { recursive: true });
  for (const partition of remediationPartitions) {
    const entries = (partitions.get(partition) ?? []).sort(compareFailures);
    writeFileSync(join(debtRoot, `${partition}.json`), `${JSON.stringify(entries, null, 2)}\n`);
  }
}

function readRepoRoot(args) {
  const index = args.indexOf("--repo-root");
  if (index < 0) return defaultRepoRoot;
  const root = args[index + 1];
  if (root === undefined || root.startsWith("--"))
    throw new Error("--repo-root requires a path argument.");
  return root;
}

function trackedSourceFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
  return result.stdout.split("\0").filter(isAuthoredSource);
}

function isAuthoredSource(file) {
  if (!sourceExtension.test(file) || /\.(?:test|spec)\.(?:cts|mts|ts|tsx)$/.test(file))
    return false;
  if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/.test(file)) return false;
  if (file.includes("/generated/") || file.includes("/dist/") || file.includes("/node_modules/"))
    return false;
  return /^packages\/[^/]+\/src\//.test(file) || /^examples\/.+\/src\//.test(file);
}

function visitSource(source, file, checker, failures) {
  const overloads = new Map();
  for (const statement of source.statements) {
    if (
      isExported(statement) &&
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined
    ) {
      overloads.set(statement.name.text, (overloads.get(statement.name.text) ?? 0) + 1);
    }
  }
  const seen = new Map();
  const inspected = new Set();
  for (const statement of source.statements) {
    if (isExported(statement)) {
      const name =
        ts.isFunctionDeclaration(statement) && statement.name !== undefined
          ? statement.name.text
          : undefined;
      const occurrence = name === undefined ? undefined : (seen.get(name) ?? 0) + 1;
      if (name !== undefined) seen.set(name, occurrence);
      inspectDeclaration(
        statement,
        file,
        undefined,
        checker,
        failures,
        occurrence !== undefined && overloads.get(name) > 1 ? `#${occurrence}` : "",
      );
      inspected.add(statement);
    }
  }
  const module = checker.getSymbolAtLocation(source);
  if (module === undefined) return;
  for (const exported of checker.getExportsOfModule(module)) {
    const symbol =
      (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported;
    for (const declaration of symbol.declarations ?? []) {
      const variableStatement = variableStatementFor(declaration);
      if (declaration.getSourceFile() === source && !inspected.has(declaration)) {
        if (variableStatement !== undefined && inspected.has(variableStatement)) continue;
        inspectDeclaration(variableStatement ?? declaration, file, undefined, checker, failures);
        if (variableStatement !== undefined) inspected.add(variableStatement);
        inspected.add(declaration);
      }
    }
  }
}

function inspectDeclaration(node, file, owner, checker, failures, suffix = "") {
  const name = declarationName(node, owner, suffix);
  if (name !== undefined && !isCallable(node))
    inspectDocumentation(node, file, `${name}:${ts.SyntaxKind[node.kind]}`, failures);

  if (isCallable(node)) inspectCallable(node, file, name, checker, failures);

  if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
    for (const member of node.members) {
      if (isPublicMember(member)) inspectDeclaration(member, file, name, checker, failures);
    }
  }

  if (ts.isEnumDeclaration(node)) {
    for (const member of node.members) {
      const memberName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();
      inspectDocumentation(member, file, `${name}.${memberName}:EnumMember`, failures);
    }
  }

  if (ts.isModuleDeclaration(node) && node.body !== undefined && ts.isModuleBlock(node.body)) {
    for (const statement of node.body.statements) {
      if (isExported(statement)) inspectDeclaration(statement, file, name, checker, failures);
    }
  }

  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      inspectVariable(declaration, file, owner, checker, failures, node);
    }
  }

  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
    const callable =
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ? node.initializer
        : node.type;
    if (
      callable !== undefined &&
      (ts.isArrowFunction(callable) ||
        ts.isFunctionExpression(callable) ||
        ts.isFunctionTypeNode(callable) ||
        ts.isConstructorTypeNode(callable))
    )
      inspectCallable(callable, file, name, checker, failures, node);
  }

  if (ts.isIndexSignatureDeclaration(node))
    inspectCallable(
      node,
      file,
      owner === undefined ? "index" : `${owner}.index`,
      checker,
      failures,
    );
}

function inspectVariable(declaration, file, owner, checker, failures, documentationNode) {
  const localName = propertyName(declaration.name);
  if (localName === undefined) return;
  const name = owner === undefined ? localName : `${owner}.${localName}`;
  const initializer = declaration.initializer;
  if (
    initializer !== undefined &&
    (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
  ) {
    inspectCallable(initializer, file, name, checker, failures, documentationNode);
  } else {
    inspectDocumentation(declaration, file, name, failures, documentationNode);
  }
  if (initializer !== undefined && ts.isObjectLiteralExpression(initializer)) {
    for (const member of initializer.properties)
      inspectObjectMember(member, file, name, checker, failures);
  }
}

function inspectObjectMember(member, file, owner, checker, failures) {
  const memberName = member.name === undefined ? undefined : propertyName(member.name);
  if (memberName === undefined) return;
  const name = `${owner}.${memberName}`;
  if (
    ts.isMethodDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member)
  ) {
    inspectCallable(member, file, name, checker, failures);
  } else if (ts.isPropertyAssignment(member)) {
    inspectDocumentation(member, file, name, failures);
    if (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
      inspectCallable(member.initializer, file, name, checker, failures, member);
  }
}

function variableStatementFor(node) {
  return ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent)
    ? node.parent.parent
    : undefined;
}

function inspectDocumentation(node, file, name, failures, documentationNode = node) {
  const documentation = documentationFor(documentationNode);
  if (documentation.inherited) return;
  if (documentation.summary === undefined) {
    failures.push({ rule: "missing-summary", file, name });
    return;
  }
  if (isPlaceholder(documentation.summary))
    failures.push({ rule: "placeholder-summary", file, name });
}

function inspectCallable(node, file, name, checker, failures, documentationNode = node) {
  if (name === undefined) return;
  const identity = `${name}(${node.parameters.map((parameter) => parameter.name.getText()).join(",")})`;
  const documentation = documentationFor(documentationNode);
  if (documentation.inherited) return;
  if (documentation.summary === undefined) {
    failures.push({ rule: "missing-summary", file, name: identity });
  } else if (!startsWithCallableVerb(documentation.summary)) {
    failures.push({ rule: "callable-summary", file, name: identity });
  }

  const parameters = node.parameters ?? [];
  const tags = documentation.tags.filter((tag) => tag.name === "param");
  const names = parameters.flatMap(parameterNames);
  const documented = new Map();
  for (const tag of tags) {
    const tagName = tag.parameterName;
    if (tagName === undefined || documented.has(tagName)) {
      failures.push({ rule: "duplicate-or-malformed-param", file, name: identity });
    } else if (isPlaceholder(tag.description)) {
      failures.push({ rule: "missing-param-description", file, name: `${identity}(${tagName})` });
    } else documented.set(tagName, tag);
  }
  for (const parameter of documentation.duplicateParameters)
    failures.push({
      rule: "duplicate-or-malformed-param",
      file,
      name: `${identity}(${parameter})`,
    });
  for (const parameter of names)
    if (!documented.has(parameter))
      failures.push({ rule: "missing-param", file, name: `${identity}(${parameter})` });
  for (const parameter of documented.keys())
    if (!names.includes(parameter))
      failures.push({ rule: "stale-param", file, name: `${identity}(${parameter})` });

  const returns = documentation.tags.filter(
    (tag) => tag.name === "returns" || tag.name === "return",
  );
  if (isVoidResult(node, checker)) {
    if (returns.length > 0) failures.push({ rule: "void-returns", file, name: identity });
  } else if (returns.length !== 1) {
    failures.push({
      rule: returns.length === 0 ? "missing-returns" : "duplicate-returns",
      file,
      name: identity,
    });
  }
  if (returns.length === 1 && isPlaceholder(returns[0].description)) {
    failures.push({ rule: "missing-returns-description", file, name: identity });
  }
}

function documentationFor(node) {
  const jsdoc = ts.getJSDocCommentsAndTags(node).find(ts.isJSDoc);
  const tags = ts.getJSDocTags(node).map((tag) => ({
    name: tag.tagName.text.toLowerCase(),
    parameterName:
      ts.isJSDocParameterTag(tag) && tag.name !== undefined ? tag.name.getText() : undefined,
    description: tag.comment === undefined ? "" : String(tag.comment).trim(),
  }));
  const parameterNames = (jsdoc?.tags ?? [])
    .filter((tag) => tag.tagName.text.toLowerCase() === "param")
    .map((tag) => tag.name?.getText())
    .filter((name) => name !== undefined);
  const duplicateParameters = parameterNames.filter(
    (name, index) => parameterNames.indexOf(name) !== index,
  );
  const summary = jsdoc?.comment === undefined ? undefined : String(jsdoc.comment).trim();
  const inherited =
    tags.some((tag) => tag.name === "inheritdoc") || /@inheritDoc\b/u.test(jsdoc?.getText() ?? "");
  return { summary: summary === "" ? undefined : summary, tags, duplicateParameters, inherited };
}

function parameterNames(parameter) {
  if (ts.isIdentifier(parameter.name)) return [parameter.name.text];
  return bindingNames(parameter.name);
}

function bindingNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

function isVoidResult(node, checker) {
  const signature = checker.getSignatureFromDeclaration(node);
  if (signature === undefined) return false;
  const type = checker.getReturnTypeOfSignature(signature);
  if ((type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) !== 0) return true;
  const promised = checker.getPromisedTypeOfPromise(type);
  return (
    promised !== undefined && (promised.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) !== 0
  );
}

function isExported(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

function isPublicMember(node) {
  return (
    (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Private) === 0 &&
    (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Protected) === 0
  );
}

function isCallable(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isConstructSignatureDeclaration(node) ||
    ts.isCallSignatureDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function declarationName(node, owner, suffix = "") {
  if (ts.isConstructorDeclaration(node))
    return owner === undefined ? "constructor" : `${owner}.constructor`;
  if (ts.isConstructSignatureDeclaration(node))
    return owner === undefined ? "construct" : `${owner}.construct`;
  if (ts.isCallSignatureDeclaration(node)) return owner === undefined ? "call" : `${owner}.call`;
  if (node.name !== undefined && propertyName(node.name) !== undefined)
    return owner === undefined
      ? `${propertyName(node.name)}${suffix}`
      : `${owner}.${propertyName(node.name)}${suffix}`;
  if (
    isExported(node) &&
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  )
    return "default";
  return undefined;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.getText();
  if (ts.isComputedPropertyName(name)) return `[${name.expression.getText()}]`;
  return undefined;
}

function startsWithCallableVerb(summary) {
  const word = summary.match(/^[A-Za-z]+/)?.[0].toLowerCase();
  return word !== undefined && callableVerbs.has(word);
}

function isPlaceholder(summary) {
  const normalized = summary.toLowerCase().replace(/[^a-z]/g, "");
  return (
    normalized.length === 0 ||
    ["todo", "fixme", "tbd", "description", "comment"].includes(normalized) ||
    /^(.)\1+$/.test(normalized)
  );
}

function compareFailures(left, right) {
  return (
    left.rule.localeCompare(right.rule) ||
    left.file.localeCompare(right.file) ||
    left.name.localeCompare(right.name)
  );
}

function printFailures(failures) {
  for (const failure of failures)
    console.error(
      `${failure.rule}: ${escapeDetail(failure.file)} :: ${escapeDetail(failure.name)}`,
    );
}

/* eslint-disable no-control-regex -- diagnostics must escape control-path characters. */
function escapeDetail(value) {
  return value.replace(
    /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/gu,
    (character) => `\\u{${character.codePointAt(0).toString(16)}}`,
  );
}
/* eslint-enable no-control-regex */
