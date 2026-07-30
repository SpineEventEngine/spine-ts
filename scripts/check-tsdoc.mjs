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
  "marks",
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
  "commits",
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
  "replaces",
  "restores",
  "retries",
  "rolls",
  "routes",
  "schedules",
  "serializes",
  "snapshots",
  "stores",
  "streams",
  "tests",
  "transforms",
  "translates",
  "tries",
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
  return applyDebt(root, rejectDuplicateFailures(scanTsdoc(root))).sort(compareFailures);
}

function rejectDuplicateFailures(failures) {
  const occurrences = new Map();
  return failures.flatMap((failure) => {
    const key = failureKey(failure);
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    if (occurrence === 1) {
      return [failure];
    }
    return [
      {
        ...failure,
        rule: "duplicate-observed-failure",
        name: `${failure.name}#duplicate-${occurrence}`,
      },
    ];
  });
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
  if (/^examples\/chat\/(?:app|web)\//.test(file)) return "T-0080K";
  if (/^examples\/chat\/(?:model|users-model)\//.test(file)) return "T-0080J";
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
  const sourceFailures = rejectDuplicateFailures(scanTsdoc(root)).filter(
    (failure) => failure.rule !== "duplicate-observed-failure",
  );
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
  const declarations = new Set();
  const inspected = new Set();
  for (const statement of source.statements) {
    if (isExported(statement) || ts.isExportAssignment(statement)) declarations.add(statement);
  }
  const module = checker.getSymbolAtLocation(source);
  if (module !== undefined) {
    for (const exported of checker.getExportsOfModule(module)) {
      const symbol =
        (exported.flags & ts.SymbolFlags.Alias) !== 0
          ? checker.getAliasedSymbol(exported)
          : exported;
      for (const declaration of symbol.declarations ?? []) {
        if (declaration.getSourceFile() === source) {
          declarations.add(variableStatementFor(declaration) ?? declaration);
        }
      }
    }
  }

  const ordered = [...declarations].sort(
    (left, right) => left.getStart(source) - right.getStart(source),
  );
  const occurrences = new Map();
  for (const declaration of ordered) {
    const key =
      declarationName(declaration, undefined) ?? `default@${declaration.getStart(source)}`;
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  const seen = new Map();
  for (const declaration of ordered) {
    const key =
      declarationName(declaration, undefined) ?? `default@${declaration.getStart(source)}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const suffix = occurrences.get(key) > 1 ? `#${occurrence}` : "";
    inspectDeclaration(declaration, file, undefined, checker, failures, suffix);
    inspected.add(declaration);
  }
  if (debtPartition(file) === "T-0080F")
    inspectInternalObjectMembers(source, file, checker, failures, inspected);
}

function inspectInternalObjectMembers(source, file, checker, failures, inspected) {
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node) && !belongsToInspectedDeclaration(node, inspected)) {
      inspectDocumentedObjectMembers(node, file, checker, failures);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
}

function belongsToInspectedDeclaration(node, inspected) {
  for (let current = node; current !== undefined; current = current.parent) {
    if (inspected.has(current)) return true;
  }
  return false;
}

function inspectDocumentedObjectMembers(object, file, checker, failures) {
  for (const member of object.properties) {
    if (ts.isObjectLiteralExpression(member)) {
      inspectDocumentedObjectMembers(member, file, checker, failures);
      continue;
    }
    if (!hasTsdoc(member)) continue;
    const name = propertyName(member.name);
    if (name === undefined) continue;
    if (
      ts.isMethodDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      inspectObjectCallableSummary(member, file, name, failures);
    }
  }
}

function hasTsdoc(node) {
  return ts.getJSDocCommentsAndTags(node).some(ts.isJSDoc);
}

function inspectObjectCallableSummary(node, file, name, failures) {
  const documentation = documentationFor(node);
  if (documentation.summary === undefined || !startsWithCallableVerb(documentation.summary))
    failures.push({ rule: "callable-summary", file, name });
}

function inspectDeclaration(node, file, owner, checker, failures, suffix = "") {
  const name = declarationName(node, owner, suffix);
  if (name !== undefined && !isCallable(node))
    inspectDocumentation(node, file, `${name}:${ts.SyntaxKind[node.kind]}`, checker, failures);

  if (isCallable(node)) inspectCallable(node, file, name, checker, failures);

  if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
    for (const [member, suffix] of memberSuffixes(node.members)) {
      if (isDocumentedClassMember(node, member))
        inspectDeclaration(member, file, name, checker, failures, suffix);
    }
  }

  if (ts.isEnumDeclaration(node)) {
    for (const member of node.members) {
      const memberName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();
      inspectDocumentation(member, file, `${name}.${memberName}:EnumMember`, checker, failures);
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

  if (ts.isExportAssignment(node)) inspectExportAssignment(node, file, checker, failures);

  if (ts.isTypeAliasDeclaration(node))
    inspectTypeNode(
      node.type,
      file,
      name,
      checker,
      failures,
      node,
      typeMemberOccurrences(node.type, name),
    );

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
    inspectDocumentation(declaration, file, name, checker, failures, documentationNode);
  }
  if (initializer !== undefined && ts.isObjectLiteralExpression(initializer)) {
    for (const member of initializer.properties)
      inspectObjectMember(member, file, name, checker, failures, new Set());
  }
}

function inspectObjectMember(member, file, owner, checker, failures, visited = new Set()) {
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
    inspectDocumentation(member, file, name, checker, failures);
    if (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
      inspectCallable(member.initializer, file, name, checker, failures, member);
    else inspectReferencedCallable(member.initializer, file, name, checker, failures, visited);
    if (ts.isObjectLiteralExpression(member.initializer)) {
      for (const nested of member.initializer.properties)
        inspectObjectMember(nested, file, name, checker, failures, new Set(visited));
    }
  } else if (ts.isShorthandPropertyAssignment(member)) {
    inspectDocumentation(member, file, name, checker, failures);
    inspectReferencedCallable(member, file, name, checker, failures, visited);
  }
}

function inspectReferencedCallable(expression, file, name, checker, failures, visited = new Set()) {
  const symbol = ts.isShorthandPropertyAssignment(expression)
    ? checker.getShorthandAssignmentValueSymbol(expression)
    : ts.isElementAccessExpression(expression) &&
        (ts.isStringLiteral(expression.argumentExpression) ||
          ts.isNumericLiteral(expression.argumentExpression))
      ? checker
          .getTypeAtLocation(expression.expression)
          .getProperty(expression.argumentExpression.text)
      : ts.isIdentifier(expression) ||
          ts.isPropertyAccessExpression(expression) ||
          ts.isElementAccessExpression(expression)
        ? checker.getSymbolAtLocation(expression)
        : undefined;
  const resolved =
    symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  for (const declaration of resolved?.declarations ?? []) {
    if (declaration.getSourceFile() !== expression.getSourceFile() || visited.has(declaration))
      continue;
    visited.add(declaration);
    if (ts.isFunctionDeclaration(declaration)) {
      inspectCallable(declaration, file, name, checker, failures);
      return;
    }
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      inspectReferencedInitializer(
        declaration.initializer,
        declaration,
        file,
        name,
        checker,
        failures,
        visited,
      );
      return;
    }
    if (ts.isPropertyAssignment(declaration)) {
      inspectReferencedInitializer(
        declaration.initializer,
        declaration,
        file,
        name,
        checker,
        failures,
        visited,
      );
      return;
    }
    if (ts.isMethodDeclaration(declaration)) {
      inspectCallable(declaration, file, name, checker, failures);
      return;
    }
  }
}

function inspectReferencedInitializer(
  initializer,
  documentationNode,
  file,
  name,
  checker,
  failures,
  visited,
) {
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    inspectCallable(initializer, file, name, checker, failures, documentationNode);
  } else if (ts.isObjectLiteralExpression(initializer)) {
    for (const member of initializer.properties)
      inspectObjectMember(member, file, name, checker, failures, new Set(visited));
  } else {
    inspectReferencedCallable(initializer, file, name, checker, failures, visited);
  }
}

function inspectExportAssignment(node, file, checker, failures) {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return;
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    inspectCallable(expression, file, "default", checker, failures, node);
  } else if (ts.isObjectLiteralExpression(expression)) {
    inspectDocumentation(node, file, "default:ExportAssignment", checker, failures);
    for (const member of expression.properties)
      inspectObjectMember(member, file, "default", checker, failures);
  } else {
    inspectDocumentation(node, file, "default:ExportAssignment", checker, failures);
  }
}

function inspectTypeNode(
  node,
  file,
  owner,
  checker,
  failures,
  documentationNode,
  memberOccurrences = new Map(),
) {
  if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) {
    inspectCallable(node, file, owner, checker, failures, documentationNode);
    return;
  }
  if (ts.isParenthesizedTypeNode(node)) {
    inspectTypeNode(
      node.type,
      file,
      owner,
      checker,
      failures,
      documentationNode,
      memberOccurrences,
    );
    return;
  }
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    for (const type of node.types)
      inspectTypeNode(type, file, owner, checker, failures, documentationNode, memberOccurrences);
    return;
  }
  if (ts.isTypeReferenceNode(node)) {
    for (const type of node.typeArguments ?? [])
      inspectTypeNode(type, file, owner, checker, failures, documentationNode, memberOccurrences);
    return;
  }
  if (!ts.isTypeLiteralNode(node)) return;
  for (const [member, suffix] of typeMemberSuffixes(node.members, owner, memberOccurrences)) {
    const name = declarationName(member, owner, suffix);
    if (name !== undefined && !isCallable(member))
      inspectDocumentation(
        member,
        file,
        `${name}:${ts.SyntaxKind[member.kind]}`,
        checker,
        failures,
      );
    if (isCallable(member)) inspectCallable(member, file, name, checker, failures, member);
    if (ts.isPropertySignature(member) && member.type !== undefined)
      inspectTypeNode(member.type, file, name, checker, failures, member, memberOccurrences);
  }
}

function typeMemberOccurrences(node, owner) {
  const counts = new Map();
  collectTypeMemberOccurrences(node, owner, counts);
  return { counts, seen: new Map() };
}

function collectTypeMemberOccurrences(node, owner, occurrences) {
  if (ts.isParenthesizedTypeNode(node)) {
    collectTypeMemberOccurrences(node.type, owner, occurrences);
    return;
  }
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    for (const type of node.types) collectTypeMemberOccurrences(type, owner, occurrences);
    return;
  }
  if (ts.isTypeReferenceNode(node)) {
    for (const type of node.typeArguments ?? [])
      collectTypeMemberOccurrences(type, owner, occurrences);
    return;
  }
  if (!ts.isTypeLiteralNode(node)) return;
  for (const member of node.members) {
    const name = declarationName(member, owner);
    if (name === undefined) continue;
    occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
    if (ts.isPropertySignature(member) && member.type !== undefined)
      collectTypeMemberOccurrences(member.type, name, occurrences);
  }
}

function typeMemberSuffixes(members, owner, occurrences) {
  return members.map((member) => {
    const name = declarationName(member, owner);
    if (name === undefined || occurrences.counts.get(name) === 1) return [member, ""];
    const occurrence = (occurrences.seen.get(name) ?? 0) + 1;
    occurrences.seen.set(name, occurrence);
    return [member, `#${occurrence}`];
  });
}

function memberSuffixes(members) {
  const occurrences = new Map();
  for (const member of members) {
    const key = declarationName(member, undefined);
    if (key !== undefined) occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  const seen = new Map();
  return members.map((member) => {
    const key = declarationName(member, undefined);
    if (key === undefined || occurrences.get(key) === 1) return [member, ""];
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return [member, `#${occurrence}`];
  });
}

function variableStatementFor(node) {
  return ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent)
    ? node.parent.parent
    : undefined;
}

function inspectDocumentation(node, file, name, checker, failures, documentationNode = node) {
  const documentation = documentationFor(documentationNode);
  if (documentation.adjacent) failures.push({ rule: "adjacent-tsdoc", file, name });
  if (documentation.inherited) {
    if (hasDocumentedInheritedMember(node, checker)) return;
    failures.push({ rule: "invalid-inheritdoc", file, name });
  }
  if (documentation.summary === undefined) {
    failures.push({ rule: "missing-summary", file, name });
    return;
  }
  if (isPlaceholder(documentation.summary))
    failures.push({ rule: "placeholder-summary", file, name });
}

function hasDocumentedInheritedMember(node, checker) {
  const owner = node.parent;
  if (
    !ts.isClassDeclaration(owner) ||
    owner.heritageClauses === undefined ||
    node.name === undefined
  )
    return false;
  const name = propertyName(node.name);
  if (name === undefined) return false;
  const memberType = checker.getTypeAtLocation(node);
  return owner.heritageClauses
    .flatMap((clause) => clause.types)
    .some((heritage) => {
      const inherited = checker.getTypeAtLocation(heritage);
      const property = inherited.getProperty(name);
      if (property === undefined) return false;
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (declaration === undefined || !hasCompleteCallableDocumentation(declaration, checker))
        return false;
      return checker.isTypeAssignableTo(
        memberType,
        checker.getTypeOfSymbolAtLocation(property, declaration),
      );
    });
}

function hasCompleteCallableDocumentation(node, checker) {
  if (!isCallable(node)) return false;
  const documentation = documentationFor(node);
  if (
    documentation.summary === undefined ||
    isPlaceholder(documentation.summary) ||
    !startsWithCallableVerb(documentation.summary) ||
    documentation.duplicateParameters.length > 0
  )
    return false;
  const parameters = node.parameters.flatMap(parameterNames);
  const tags = documentation.tags.filter((tag) => tag.name === "param");
  const documented = new Set();
  for (const tag of tags) {
    if (
      tag.parameterName === undefined ||
      documented.has(tag.parameterName) ||
      isPlaceholder(tag.description)
    )
      return false;
    documented.add(tag.parameterName);
  }
  if (
    parameters.length !== documented.size ||
    parameters.some((parameter) => !documented.has(parameter))
  )
    return false;
  const returns = documentation.tags.filter(
    (tag) => tag.name === "returns" || tag.name === "return",
  );
  if (ts.isConstructorDeclaration(node)) return returns.length === 0;
  return isBareVoidResult(node, checker)
    ? returns.length === 0
    : returns.length === 1 && !isPlaceholder(returns[0].description);
}

function inspectCallable(node, file, name, checker, failures, documentationNode = node) {
  if (name === undefined) return;
  const identity = `${name}(${node.parameters.map((parameter) => parameter.name.getText()).join(",")})`;
  const documentation = documentationFor(documentationNode);
  if (documentation.adjacent) failures.push({ rule: "adjacent-tsdoc", file, name: identity });
  if (documentation.inherited && hasDocumentedInheritedMember(node, checker)) return;
  if (documentation.inherited) failures.push({ rule: "invalid-inheritdoc", file, name: identity });
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
  if (ts.isConstructorDeclaration(node)) {
    if (returns.length > 0) failures.push({ rule: "constructor-returns", file, name: identity });
  } else if (isBareVoidResult(node, checker)) {
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
  const source = node.getSourceFile();
  const comments = (ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? []).filter(
    (range) => source.text.startsWith("/**", range.pos),
  );
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
  const summary =
    jsdoc?.comment === undefined ? undefined : ts.getTextOfJSDocComment(jsdoc.comment).trim();
  const inherited =
    tags.some((tag) => tag.name === "inheritdoc") || /@inheritDoc\b/u.test(jsdoc?.getText() ?? "");
  return {
    summary: summary === "" ? undefined : summary,
    tags,
    duplicateParameters,
    inherited,
    adjacent: comments.some(
      (comment, index) =>
        index > 0 && source.text.slice(comments[index - 1].end, comment.pos).trim().length === 0,
    ),
  };
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

/**
 * Determines whether a callable returns directly without a result value.
 *
 * A `Promise<void>` still returns an asynchronous completion value, so its
 * documentation must describe that completion with `@returns`.
 *
 * @param node The callable declaration to inspect.
 * @param checker The TypeScript semantic checker for the declaration.
 * @returns Whether the callable has a direct `void` or `undefined` result.
 */
function isBareVoidResult(node, checker) {
  const signature = checker.getSignatureFromDeclaration(node);
  if (signature === undefined) return false;
  const type = checker.getReturnTypeOfSignature(signature);
  return (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) !== 0;
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

function isDocumentedClassMember(owner, member) {
  if (isPublicMember(member)) return true;
  return (
    ts.isClassDeclaration(owner) &&
    isExported(owner) &&
    (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Protected) !== 0 &&
    !isInternalDocumentation(member)
  );
}

function isInternalDocumentation(node) {
  return documentationFor(node).tags.some(
    (tag) => tag.name === "hidden" || tag.name === "internal",
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
    compareText(left.rule, right.rule) ||
    compareText(left.file, right.file) ||
    compareText(left.name, right.name)
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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
