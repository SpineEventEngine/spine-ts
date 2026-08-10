import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const manifestPath = resolve(process.argv[2] ?? "build-protocol/logging/containment-manifest.json");
const root = dirname(manifestPath);
const repositoryRoot = resolve(root, "../..");
const projectRoot = resolve(process.cwd());
const failures = [];
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(
    `cannot read containment manifest: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const entries = validRoot(manifest) ? manifest.boundaries : [];
const ids = new Set();
const sources = new Map();
for (const entry of entries) {
  if (!validEntry(entry)) {
    fail(`invalid containment manifest entry: ${JSON.stringify(entry)}`);
    continue;
  }
  if (ids.has(entry.id)) fail(`duplicate containment boundary ${entry.id}`);
  ids.add(entry.id);
  const file = resolve(root, entry.source);
  if (!withinRoot(file)) {
    fail(`containment source escapes manifest root: ${entry.source}`);
    continue;
  }
  const list = sources.get(file) ?? [];
  list.push(entry);
  sources.set(file, list);
}

for (const [file, fileEntries] of sources) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    fail(
      `cannot read containment source ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
    continue;
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const comments = commentsIn(text);
  const candidates = [];
  const violations = [];
  visit(source, candidates, violations);
  const bound = new Map();
  for (const comment of comments) {
    const candidate = candidates.find((node) => adjacent(comment, node, source));
    if (candidate === undefined) {
      fail(`stale containment boundary ${comment.id} in ${file}`);
      continue;
    }
    bound.set(comment.id, (bound.get(comment.id) ?? 0) + 1);
    if (!ids.has(comment.id)) fail(`stale containment boundary ${comment.id} in ${file}`);
  }
  for (const entry of fileEntries) {
    if ((bound.get(entry.id) ?? 0) !== 1) {
      fail(`containment boundary ${entry.id} has ${bound.get(entry.id) ?? 0} source bindings`);
    }
  }
  for (const violation of violations) {
    if (!comments.some((comment) => adjacent(comment, violation.node, source)))
      fail(`unannotated ${violation.message} in ${file}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}

function validRoot(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray(value.boundaries)
  ) {
    fail("containment manifest must be an object with a boundaries array");
    return false;
  }
  return true;
}

function validEntry(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.id === "string" &&
    /^[a-z0-9][a-z0-9_.-]*$/.test(entry.id) &&
    typeof entry.source === "string" &&
    entry.source.length > 0 &&
    typeof entry.operation === "string" &&
    /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(entry.operation) &&
    typeof entry.test === "string" &&
    entry.test.length > 0 &&
    !entry.test.startsWith("/") &&
    !entry.test.split(/[\\/]/).includes("..") &&
    existsSync(resolve(projectRoot, entry.test)) &&
    within(projectRoot, resolve(projectRoot, entry.test)) &&
    ["warn", "error", "no-log"].includes(entry.disposition)
  );
}

function withinRoot(file) {
  return within(repositoryRoot, file);
}

function within(root, file) {
  const path = relative(root, file);
  return (
    path !== "" &&
    !path.startsWith("..") &&
    !path.includes(`..${process.platform === "win32" ? "\\" : "/"}`)
  );
}

function commentsIn(text) {
  return [...text.matchAll(/\/\/\s*spine-log-boundary:\s*([a-z0-9_.-]+)\s*$/gm)].map((match) => ({
    id: match[1],
    end: match.index + match[0].length,
  }));
}

function adjacent(comment, node, source) {
  const commentLine = source.getLineAndCharacterOfPosition(comment.end - 1).line;
  const nodeLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  return nodeLine === commentLine + 1;
}

function visit(node, candidates, violations) {
  if (ts.isExpressionStatement(node)) candidates.push(node);
  if (ts.isCatchClause(node)) {
    candidates.push(node);
    if (node.block.statements.length === 0) violations.push({ message: "empty catch", node });
  }
  if (ts.isCallExpression(node)) {
    if (isAllSettled(node)) candidates.push(node);
    if (isCatch(node)) {
      candidates.push(node);
      const callback = node.arguments[0];
      if (isDetached(node) && !rethrows(callback)) {
        violations.push({ message: "detached or voided catch", node });
      }
      if (fulfillsSentinel(callback))
        violations.push({ message: "catch callback fulfills sentinel", node });
    }
    if (isThen(node) && node.arguments.length > 1) {
      candidates.push(node);
      if (fulfillsSentinel(node.arguments[1])) {
        violations.push({ message: "rejection callback fulfills sentinel", node });
      }
    }
  }
  ts.forEachChild(node, (child) => visit(child, candidates, violations));
}

function isCatch(node) {
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "catch";
}
function isThen(node) {
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "then";
}
function isAllSettled(node) {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.expression.getText() === "Promise" &&
    node.expression.name.text === "allSettled"
  );
}
function isDetached(node) {
  let parent = node.parent;
  if (ts.isVoidExpression(parent)) parent = parent.parent;
  return ts.isExpressionStatement(parent);
}
function rethrows(callback) {
  return ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)
    ? ts.isBlock(callback.body) &&
        callback.body.statements.some((statement) => ts.isThrowStatement(statement))
    : false;
}
function fulfillsSentinel(callback) {
  if (
    callback === undefined ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  )
    return false;
  if (!ts.isBlock(callback.body)) return sentinel(callback.body);
  if (callback.body.statements.length === 0) return true;
  return callback.body.statements.some(
    (statement) => ts.isReturnStatement(statement) && sentinel(statement.expression),
  );
}
function sentinel(value) {
  return (
    value === undefined ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(value) && value.text === "undefined")
  );
}
function fail(message) {
  failures.push(message);
}
