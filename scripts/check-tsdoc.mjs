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
  "admits",
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
const semanticSourceExtension = /\.(?:cts|mts|ts|tsx)$/;
const scriptSourceExtension = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;
const handwrittenSourceExtension = /\.(?:cts|mts|ts|tsx|js|jsx|mjs|cjs)$/;
const internalChronologyPattern =
  /\b(?:T-\d{4,}[A-Za-z]*|wave\s+\d+[A-Za-z]?|phase\s+\d+|slice\s+\d+|milestone\s+\w+)\b/iu;
const generatedTsdocTargets = new Set(["examples/message-board/app/src/model-registry.ts"]);
const layoutRules = new Set([
  "blank-first-line",
  "tsdoc-block-tag-gap",
  "tsdoc-block-tag-spacing",
  "consecutive-tsdoc-blank-line",
  "class-member-spacing",
  "hyphenated-param",
  "inline-tsdoc-tag",
  "missing-tsdoc-blank-line",
  "tsdoc-summary-spacing",
  "tsdoc-block-opener",
  "vague-summary",
]);
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

/**
 * Checks tracked source declarations against the repository's TSDoc policy.
 *
 * @param repoRoot The repository checkout to inspect.
 * @returns Sorted policy failures after applying the recorded legacy debt.
 */
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
  const changed = changedSourceFiles(root);
  const failures = [];
  const confined = [];
  for (const file of files) {
    const sourcePath = join(root, file);
    try {
      const resolved = realpathSync(sourcePath);
      if (isConfined(root, resolved)) {
        scanBlockLayout(readFileSync(resolved, "utf8"), file, failures);
        if (isSemanticSource(file)) confined.push({ file, sourcePath: resolved });
      } else failures.push({ rule: "path-confinement", file, name: "source" });
    } catch {
      failures.push({ rule: "path-confinement", file, name: "source" });
    }
  }
  const program = ts.createProgram(
    confined.map(({ sourcePath }) => sourcePath),
    {
      allowJs: true,
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
    visitSource(source, file, checker, failures, changed.has(file));
  }

  return failures;
}

function changedSourceFiles(root) {
  const changed = new Set();
  const mergeBase = spawnSync("git", ["merge-base", "origin/master", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (mergeBase.status !== 0 || mergeBase.stdout.trim() === "")
    throw new Error(
      "Unable to determine changed TSDoc baseline from origin/master. " +
        "Fetch the official master branch before running this check.",
    );
  for (const range of [`${mergeBase.stdout.trim()}...HEAD`, undefined, "--cached"]) {
    const args = ["diff", "--name-only", "--no-renames", "--diff-filter=ACMRD"];
    if (range !== undefined) args.push(range);
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error("Unable to classify changed TSDoc source.");
    for (const file of result.stdout.split("\n")) if (isSemanticSource(file)) changed.add(file);
  }
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  if (untracked.status !== 0) throw new Error("Unable to classify untracked TSDoc source.");
  for (const file of untracked.stdout.split("\n")) if (isSemanticSource(file)) changed.add(file);
  return changed;
}

function isConfined(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !path.split(/[\\/]/u).includes(".."));
}

function applyDebt(root, failures) {
  const debt = readDebt(root);
  if (debt.size === 0) return failures;
  const eligibleFailures = failures.filter(isDebtEligibleFailure);
  const observed = new Set(eligibleFailures.map(failureKey));
  const stale = [...debt].filter((entry) => !observed.has(entry));
  const newFailures = failures.filter(
    (failure) => !isDebtEligibleFailure(failure) || !debt.has(failureKey(failure)),
  );
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
      if (!isDebtEligibleFailure(value) || value.file.includes("..") || value.file.includes("\\")) {
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
  if (/^examples\/message-board\/(?:app|web)\//.test(file)) return "T-0080K";
  if (/^examples\/message-board\/model\//.test(file)) return "T-0080J";
  if (/^examples\/todo\//.test(file)) return "T-0080L";
  if (/^examples\/projects\//.test(file)) return "T-0080M";
  if (/^examples\/orders\//.test(file)) return "T-0080N";
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
  const sourceFailures = rejectDuplicateFailures(scanTsdoc(root)).filter(isDebtEligibleFailure);
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
  const deleted = spawnSync("git", ["ls-files", "--deleted", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (deleted.status !== 0) throw new Error(`git ls-files --deleted failed: ${deleted.stderr}`);
  const deletedFiles = new Set(deleted.stdout.split("\0"));
  return result.stdout
    .split("\0")
    .filter((file) => !deletedFiles.has(file))
    .filter(isHandwrittenSource);
}

function isHandwrittenSource(file) {
  if (!handwrittenSourceExtension.test(file)) return false;
  if (generatedTsdocTargets.has(file)) return false;
  if (hasExcludedPathSegment(file)) return false;
  return !file.startsWith("packages/proto/proto/");
}

function isSemanticSource(file) {
  return (
    isHandwrittenSource(file) &&
    ((semanticSourceExtension.test(file) &&
      !/\.(?:test|spec)\.(?:cts|mts|ts|tsx)$/.test(file) &&
      !/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/.test(file) &&
      (/^packages\/[^/]+\/src\//.test(file) || /^examples\/.+\/src\//.test(file))) ||
      (/^scripts\//.test(file) && scriptSourceExtension.test(file)))
  );
}

function isScriptSource(file) {
  return /^scripts\//.test(file) && scriptSourceExtension.test(file);
}

function hasExcludedPathSegment(file) {
  return /(?:^|\/)(?:generated|dist|node_modules)(?:\/|$)/u.test(file);
}

function isDebtEligibleFailure(failure) {
  return (
    failure.rule !== "duplicate-observed-failure" &&
    isSemanticSource(failure.file) &&
    !layoutRules.has(failure.rule)
  );
}

function scanBlockLayout(source, file, failures) {
  if (/^(?:[ \t]*\r?\n)/u.test(source))
    failures.push({ rule: "blank-first-line", file, name: "source" });
  for (const { start, block, followsOpeningBrace } of tsdocBlocks(source, file)) {
    const lineStart = source.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = source.indexOf("\n", start);
    const opener = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).trim();
    const name = `block@${lineNumber(source, start)}`;
    if (opener !== "/**") failures.push({ rule: "tsdoc-block-opener", file, name });
    if (start !== 0 && !hasBlankPrecedingLine(source, lineStart) && !followsOpeningBrace)
      failures.push({ rule: "missing-tsdoc-blank-line", file, name });
    if (hasHyphenatedParam(block)) failures.push({ rule: "hyphenated-param", file, name });
    if (hasDoubledSummarySpacing(block))
      failures.push({ rule: "tsdoc-summary-spacing", file, name });
    if (hasConsecutiveBlankDocLines(block))
      failures.push({ rule: "consecutive-tsdoc-blank-line", file, name });
    if (hasBlockTagGap(block)) failures.push({ rule: "tsdoc-block-tag-gap", file, name });
    if (hasMalformedBlockTagSpacing(block))
      failures.push({ rule: "tsdoc-block-tag-spacing", file, name });
    if (hasInlineBlockTag(block)) failures.push({ rule: "inline-tsdoc-tag", file, name });
    const summary = blockSummary(block);
    if (summary !== undefined && (isPlaceholder(summary) || isVagueSummary(summary)))
      failures.push({ rule: "vague-summary", file, name });
    if (/^packages\/[^/]+\/src\//.test(file) && internalChronologyPattern.test(block))
      failures.push({ rule: "internal-chronology", file, name });
  }
}

function tsdocBlocks(source, file) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const blocks = new Map();
  const firstMemberStarts = new Set();
  const visit = (node) => {
    const starts = [];
    for (const documentation of ts.getJSDocCommentsAndTags(node)) {
      if (!ts.isJSDoc(documentation)) continue;
      const start = documentation.getStart(sourceFile, false);
      starts.push(start);
      blocks.set(start, { start, block: source.slice(start, documentation.getEnd()) });
    }
    for (const range of ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []) {
      const block = source.slice(range.pos, range.end);
      if (block.startsWith("/**")) {
        starts.push(range.pos);
        blocks.set(range.pos, { start: range.pos, block });
      }
    }
    if (starts.length > 0) {
      const firstStart = Math.min(...starts);
      if (isFirstMemberAfterOpeningBrace(node, firstStart, sourceFile))
        firstMemberStarts.add(firstStart);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...blocks.values()]
    .map((entry) => ({ ...entry, followsOpeningBrace: firstMemberStarts.has(entry.start) }))
    .sort((left, right) => left.start - right.start);
}

function isFirstMemberAfterOpeningBrace(node, documentationStart, sourceFile) {
  const parent = node.parent;
  if (parent === undefined) return false;
  const first =
    ("members" in parent && parent.members?.[0] === node) ||
    ("properties" in parent && parent.properties?.[0] === node);
  if (!first) return false;
  const openingBrace = parent
    .getChildren(sourceFile)
    .find((child) => child.kind === ts.SyntaxKind.OpenBraceToken);
  return (
    openingBrace !== undefined &&
    sourceFile.text.slice(openingBrace.end, documentationStart).trim().length === 0
  );
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function hasBlankPrecedingLine(source, lineStart) {
  const previousLineEnd = lineStart - 1;
  const previousLineStart = source.lastIndexOf("\n", previousLineEnd - 1) + 1;
  return /^[ \t]*\r?$/u.test(source.slice(previousLineStart, previousLineEnd));
}

function hasHyphenatedParam(block) {
  return /@param\s+(?:\[[^\]]+\]|[\w.$-]+)\s+-\s*/u.test(block);
}

function hasDoubledSummarySpacing(block) {
  const summary = blockDocLines(block).find((line) => {
    const text = docLineText(line);
    return text !== "" && !text.startsWith("@");
  });
  return summary !== undefined && /^\s*\*\s{2,}\S/u.test(summary);
}

function hasConsecutiveBlankDocLines(block) {
  return /\r?\n\s*\*\s*\r?\n\s*\*\s*(?=\r?\n)/u.test(block);
}

function hasBlockTagGap(block) {
  const lines = blockDocLines(block);
  for (let index = 0; index < lines.length; index += 1) {
    if (!isBlankDocLine(lines[index])) continue;
    const previous = nearestDocLine(lines, index, -1);
    const next = nearestDocLine(lines, index, 1);
    if (
      previous !== undefined &&
      next !== undefined &&
      isBlockTagLine(previous) &&
      isBlockTagLine(next)
    )
      return true;
  }
  return false;
}

function hasMalformedBlockTagSpacing(block) {
  return blockDocLines(block).some(
    (line) => isBlockTagLine(line) && !/^\s*\* @[\p{L}_][\w-]*/u.test(line),
  );
}

function hasInlineBlockTag(block) {
  return blockDocLines(block).some((line) => {
    const text = docLineText(line);
    return (
      !text.startsWith("@") && /\S\s+@(?:param|returns|internal|throws|typeParam)\b/u.test(text)
    );
  });
}

function isBlankDocLine(line) {
  return /^\s*\*\s*$/u.test(line);
}

function nearestDocLine(lines, start, direction) {
  for (let index = start + direction; index >= 0 && index < lines.length; index += direction) {
    if (!isBlankDocLine(lines[index])) return lines[index];
  }
  return undefined;
}

function isBlockTagLine(line) {
  return /^\s*\*(?:@|[ \t]{1,2}@)[\p{L}_][\w-]*/u.test(line);
}

function blockDocLines(block) {
  return block.split(/\r?\n/u).slice(1, -1);
}

function docLineText(line) {
  return line.replace(/^\s*\*?\s?/u, "").trim();
}

function blockSummary(block) {
  return block
    .split(/\r?\n/u)
    .slice(1)
    .map((line) =>
      line
        .replace(/\*\/\s*$/u, "")
        .replace(/^\s*\*?\s?/u, "")
        .trim(),
    )
    .find((line) => line !== "" && !line.startsWith("@"));
}

function isVagueSummary(summary) {
  return /^(?:owns|consists)\b/iu.test(summary);
}

function visitSource(source, file, checker, failures, inspectChangedInternals) {
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
  if (/^packages\/server\//.test(file))
    inspectInternalObjectMembers(source, file, checker, failures, inspected);
  if (inspectChangedInternals && isChangedProductionSource(file)) {
    inspectChangedClassAndMethodDocs(source, file, checker, failures, inspected);
    inspectChangedTypeParameters(source, file, failures);
    inspectChangedClassMemberSpacing(source, file, failures);
  }
}

function isChangedProductionSource(file) {
  return /^packages\/[^/]+\/src\//.test(file) || /^examples\/.+\/src\//.test(file);
}

function inspectChangedClassMemberSpacing(source, file, failures) {
  const visit = (node) => {
    if (isClassLike(node)) {
      for (let index = 1; index < node.members.length; index += 1) {
        const previous = node.members[index - 1];
        const current = node.members[index];
        const documentation = ts.getJSDocCommentsAndTags(current).filter(ts.isJSDoc).at(0);
        const currentStart = documentation?.getStart(source) ?? current.getStart(source);
        const separation = source.text.slice(previous.end, currentStart);
        if ((separation.match(/\r?\n/gu) ?? []).length < 2) {
          const line = source.getLineAndCharacterOfPosition(currentStart).line + 1;
          failures.push({ rule: "class-member-spacing", file, name: `member@${line}` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
}

function inspectChangedClassAndMethodDocs(source, file, checker, failures, inspected) {
  const visit = (node) => {
    if (isClassLike(node) && (!ts.isClassDeclaration(node) || !isExported(node))) {
      const name = classLikeName(node, source) ?? `class@${node.getStart(source)}`;
      inspectDocumentation(
        node,
        file,
        `${name}:${ts.SyntaxKind[node.kind]}`,
        checker,
        failures,
        classDocumentationNode(node),
      );
    }
    if (isChangedMethod(node) && !methodAlreadyInspected(node, inspected)) {
      inspectCallable(node, file, changedMethodName(node, source), checker, failures);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
}

function isClassLike(node) {
  return ts.isClassDeclaration(node) || ts.isClassExpression(node);
}

function classDocumentationNode(node) {
  if (ts.isClassExpression(node) && ts.isVariableDeclaration(node.parent))
    return variableStatementFor(node.parent) ?? node;
  return node;
}

function classLikeName(node, source) {
  if (node.name !== undefined) return node.name.getText(source);
  if (ts.isClassExpression(node) && ts.isVariableDeclaration(node.parent))
    return node.parent.name.getText(source);
  return undefined;
}

function isChangedMethod(node) {
  return (
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function methodAlreadyInspected(node, inspected) {
  if (!belongsToInspectedDeclaration(node, inspected)) return false;
  const owner = node.parent;
  if (ts.isClassExpression(owner)) return false;
  return !ts.isClassDeclaration(owner) || isDocumentedClassMember(owner, node);
}

function changedMethodName(node, source) {
  const member = ts.isConstructorDeclaration(node) ? "constructor" : propertyName(node.name);
  const owner = changedMethodOwner(node.parent);
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  return owner === undefined
    ? `${member ?? "method"}@${line}`
    : `${owner}.${member ?? `method@${line}`}`;
}

function changedMethodOwner(node) {
  if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) return node.name?.text;
  if (ts.isClassExpression(node) && ts.isVariableDeclaration(node.parent))
    return node.name?.text ?? node.parent.name.getText();
  if (ts.isObjectLiteralExpression(node)) {
    const declaration = node.parent;
    if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name))
      return declaration.name.text;
    if (ts.isPropertyAssignment(declaration)) return propertyName(declaration.name);
  }
  return undefined;
}

function inspectChangedTypeParameters(source, file, failures) {
  const visit = (node) => {
    if (node.typeParameters?.length) {
      const documentationNode = typeParameterDocumentationNode(node);
      const documented = documentationFor(documentationNode).typeParameters;
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const declaration =
        node.name === undefined ? `${ts.SyntaxKind[node.kind]}@${line}` : node.name.getText(source);
      for (const parameter of node.typeParameters) {
        const matches = documented.filter(({ name }) => name === parameter.name.text);
        if (!matches.some(({ description }) => !isPlaceholder(description)))
          failures.push({
            rule: "missing-type-param",
            file,
            name: `${declaration}@${line}<${parameter.name.text}>`,
          });
        if (matches.length > 1)
          failures.push({
            rule: "duplicate-type-param",
            file,
            name: `${declaration}@${line}<${parameter.name.text}>`,
          });
      }
      const declared = new Set(node.typeParameters.map(({ name }) => name.text));
      for (const parameter of documented) {
        if (!declared.has(parameter.name))
          failures.push({
            rule: "stale-type-param",
            file,
            name: `${declaration}@${line}<${parameter.name}>`,
          });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
}

function typeParameterDocumentationNode(node) {
  if (ts.isClassExpression(node)) return classDocumentationNode(node);
  if (
    (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) &&
    ts.isTypeAliasDeclaration(node.parent)
  )
    return node.parent;
  return node;
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
  if (isScriptSource(file) && documentation.summary === undefined) {
    failures.push({ rule: "missing-doc", file, name });
    return;
  }
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
  if (isScriptSource(file) && documentation.summary === undefined) {
    failures.push({ rule: "missing-doc", file, name: identity });
    return;
  }
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
  const directJsdoc =
    ts.isJSDocTypedefTag(node) && ts.isJSDoc(node.parent) ? node.parent : undefined;
  const jsdoc = directJsdoc ?? ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1);
  const tags = (jsdoc?.tags ?? ts.getJSDocTags(node)).map((tag) => ({
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
  const typeParameters = [
    ...(jsdoc?.getText() ?? "").matchAll(/@typeParam\s+([\p{L}_$][\w$]*)(?:\s+([^\r\n*]*))?/gu),
  ].map(([, name, description = ""]) => ({ name, description: description.trim() }));
  return {
    summary: summary === "" ? undefined : summary,
    tags,
    duplicateParameters,
    typeParameters,
    inherited,
    adjacent: comments
      .filter((comment) => !/@typedef\b/u.test(source.text.slice(comment.pos, comment.end)))
      .some(
        (comment, index, declarationComments) =>
          index > 0 &&
          source.text.slice(declarationComments[index - 1].end, comment.pos).trim().length === 0,
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
    ["todo", "fixme", "tbd", "description", "comment", "placeholder"].includes(normalized) ||
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
