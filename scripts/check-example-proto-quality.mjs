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

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maxSemanticComponents = 4;
const migrationBaseline = "b1a3dc7b1f21e4f7239014ea56f451941ef7addd";
const partitions = ["T-0080J", "T-0080K", "T-0080L", "T-0080M", "T-0080N"];
const frameworkJargon = [
  "cqrs",
  "aggregate",
  "event sourcing",
  "bounded context",
  "command bus",
  "read-side",
  "projection",
  "projected",
  "fixed-topology",
  "triggering entity",
  "process-manager",
  "handled event",
  "generic update",
].join("|");
const baselineFailureCache = new Map();

export function checkExampleProtoQuality(repoRoot = defaultRepoRoot) {
  const root = resolve(repoRoot);
  const resolvedRoot = realpathSync(root);
  const failures = [];
  const files = trackedFiles(root);
  const tracked = files.filter((file) => /^examples\/(?:[^/]+\/)*proto\/.+\.proto$/.test(file));
  const manifests = exampleManifests(root, files, tracked, failures);

  for (const file of tracked) {
    if (!isConfined(root, resolvedRoot, file)) {
      failures.push(`${file} invalid-provenance unconfined-path`);
      continue;
    }
    const provenance = manifests.get(file);
    if (provenance === undefined) {
      failures.push(`${file} invalid-provenance unlisted-file`);
      continue;
    }
    if (provenance.kind === "invalid") {
      failures.push(`${file} invalid-provenance ${provenance.reason}`);
      continue;
    }
    if (provenance.kind === "copied") continue;
    const source = readFileSync(join(root, file), "utf8");
    failures.push(...scanProto(file, source), ...scanExampleProtoContract(file, source));
  }

  return [
    ...failures.filter((failure) => !isDebtFailure(failure)),
    ...checkDebt(root, failures),
  ].sort();
}

function isConfined(root, resolvedRoot, file) {
  try {
    const resolvedFile = realpathSync(join(root, file));
    return resolvedFile.startsWith(`${resolvedRoot}/`);
  } catch {
    return false;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { root, writeDebt } = parseRoot(process.argv.slice(2));
    if (writeDebt) {
      writeDebtPartitions(root);
      console.log("Example Proto debt partitions written.");
      process.exit(0);
    }
    const failures = checkExampleProtoQuality(root);
    if (failures.length > 0) {
      for (const failure of failures) console.error(escapeDiagnostic(failure));
      process.exit(1);
    }
    console.log("Example Proto quality checks passed.");
  } catch (error) {
    console.error(escapeDiagnostic(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

function parseRoot(argv) {
  const writeDebt = argv.includes("--write-debt");
  const values = argv.filter((value) => value !== "--write-debt");
  if (values.length === 0) return { root: defaultRepoRoot, writeDebt };
  if (values.length === 2 && values[0] === "--repo-root")
    return { root: resolve(values[1]), writeDebt };
  throw new Error(
    "Usage: node scripts/check-example-proto-quality.mjs [--repo-root <path>] [--write-debt]",
  );
}

function writeDebtPartitions(root) {
  const failures = checkExampleProtoQualityWithoutDebt(root).filter(isDebtFailure);
  const byPartition = new Map(partitions.map((partition) => [partition, []]));
  for (const failure of failures) {
    const [file, rule, identity] = parseDebtFailure(failure);
    const entry = {
      rule,
      file,
      identity,
      name: identity.slice(identity.indexOf(":") + 1, identity.lastIndexOf("#")),
      disposition: "migration-debt",
      reason: `Pre-T-0080C authored Proto quality debt ${identity} requires remediation by the assigned slice.`,
    };
    if (!baselineContains(root, entry))
      throw new Error(`Proto debt was not observed at immutable baseline: ${file} ${identity}`);
    byPartition.get(protoPartition(file)).push(entry);
  }
  const directory = join(root, "build-protocol", "example-proto-debt");
  mkdirSync(directory, { recursive: true });
  for (const [partition, entries] of byPartition) {
    entries.sort((left, right) => debtKey(left).localeCompare(debtKey(right)));
    writeFileSync(join(directory, `${partition}.json`), `${JSON.stringify(entries, null, 2)}\n`);
  }
}

function checkExampleProtoQualityWithoutDebt(root) {
  const failures = [];
  const files = trackedFiles(root);
  const tracked = files.filter((file) => /^examples\/(?:[^/]+\/)*proto\/.+\.proto$/.test(file));
  const manifests = exampleManifests(root, files, tracked, failures);
  for (const file of tracked) {
    const provenance = manifests.get(file);
    if (provenance === undefined) failures.push(`${file} invalid-provenance unlisted-file`);
    else if (provenance.kind === "invalid")
      failures.push(`${file} invalid-provenance ${provenance.reason}`);
    else if (provenance.kind === "authored")
      failures.push(...scanProto(file, readFileSync(join(root, file), "utf8")));
  }
  return failures;
}

function checkDebt(root, failures) {
  const entries = readDebt(root);
  if (entries === undefined) return failures.filter(isDebtFailure);
  const observed = new Set(failures.filter(isDebtFailure).map(debtKeyFromFailure));
  const debt = new Set(entries.map(debtKey));
  return [
    ...failures.filter(isDebtFailure).filter((failure) => !debt.has(debtKeyFromFailure(failure))),
    ...entries
      .filter((entry) => !observed.has(debtKey(entry)))
      .map((entry) => `${entry.file} stale-debt ${entry.identity}`),
  ];
}

function readDebt(root) {
  const directory = join(root, "build-protocol", "example-proto-debt");
  if (!existsSync(directory)) return undefined;
  const records = [];
  for (const filename of readdirSync(directory).sort()) {
    if (!filename.endsWith(".json") || !partitions.includes(filename.slice(0, -5)))
      throw new Error(
        `Unexpected Proto debt partition: ${relative(root, join(directory, filename))}`,
      );
    let values;
    try {
      values = JSON.parse(readFileSync(join(directory, filename), "utf8"));
    } catch {
      throw new Error(
        `Malformed Proto debt partition: ${relative(root, join(directory, filename))}`,
      );
    }
    if (!Array.isArray(values))
      throw new Error(
        `Malformed Proto debt partition: ${relative(root, join(directory, filename))}`,
      );
    records.push(...values.map((entry) => ({ partition: filename.slice(0, -5), entry })));
  }
  return validateProtoDebtEntries(records, new Set(), (entry) => baselineContains(root, entry))
    .entries;
}

/**
 * Validates exact partitioned debt independently of Git for focused fixtures.
 */
export function validateProtoDebtEntries(records, observed, observesBaseline) {
  const entries = [];
  const seen = new Set();
  for (const record of records) {
    const { partition, entry } = record;
    const expected = ["rule", "file", "identity", "name", "disposition", "reason"];
    if (
      !partitions.includes(partition) ||
      entry === null ||
      typeof entry !== "object" ||
      Object.keys(entry).some((key) => !expected.includes(key)) ||
      expected.some((key) => typeof entry[key] !== "string") ||
      !["missing-comment", "placeholder-comment", "semantic-name"].includes(entry.rule) ||
      entry.disposition !== "migration-debt" ||
      !/^Pre-T-0080C authored Proto quality debt /.test(entry.reason) ||
      !/^examples\/(?:[^/]+|chat\/(?:model|users-model))\/proto\/.+\.proto$/.test(entry.file) ||
      entry.file.includes("..") ||
      entry.file.includes("\\") ||
      protoPartition(entry.file) !== partition
    ) {
      throw new Error("Malformed or broadened Proto debt entry");
    }
    const key = debtKey(entry);
    if (seen.has(key)) throw new Error(`Duplicate Proto debt entry: ${key}`);
    if (!observesBaseline(entry))
      throw new Error(
        `Proto debt was not observed at immutable baseline: ${entry.file} ${entry.identity}`,
      );
    seen.add(key);
    entries.push(entry);
  }
  return {
    entries,
    stale: entries.filter((entry) => !observed.has(debtKey(entry))).map((entry) => entry.identity),
  };
}

function protoPartition(file) {
  if (/^examples\/chat\/(?:model|users-model)\//.test(file)) return "T-0080J";
  if (/^examples\/chat\/(?:app|web)\//.test(file)) return "T-0080K";
  if (/^examples\/todo\//.test(file)) return "T-0080L";
  if (/^examples\/project-management\//.test(file)) return "T-0080M";
  if (/^examples\/datastore-orders\//.test(file)) return "T-0080N";
  throw new Error(`No Proto debt partition owns ${file}`);
}

function isDebtFailure(failure) {
  return / (missing-comment|placeholder-comment|semantic-name) [^ ]+#\d+/.test(failure);
}

function debtKey(entry) {
  return `${entry.rule}\u0000${entry.file}\u0000${entry.identity}`;
}

function debtKeyFromFailure(failure) {
  const [file, rule, identity] = parseDebtFailure(failure);
  return `${rule}\u0000${file}\u0000${identity}`;
}

function parseDebtFailure(failure) {
  const match = /^(.*) (missing-comment|placeholder-comment|semantic-name) ([^ ]+#\d+)/.exec(
    failure,
  );
  if (match === null) throw new Error(`Invalid Proto diagnostic: ${failure}`);
  return [match[1], match[2], match[3]];
}

function baselineContains(root, entry) {
  const baselineFile = movedChatBaselinePath(entry.file);
  const key = `${root}\u0000${baselineFile}`;
  let failures = baselineFailureCache.get(key);
  if (failures === undefined) {
    const result = spawnSync(
      "git",
      ["--no-replace-objects", "show", `${migrationBaseline}:${baselineFile}`],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    if (result.status !== 0)
      throw new Error(`Immutable Proto baseline ${migrationBaseline} is unavailable.`);
    failures = new Set(
      scanProto(entry.file, result.stdout).filter(isDebtFailure).map(debtKeyFromFailure),
    );
    baselineFailureCache.set(key, failures);
  }
  return failures.has(debtKey(entry));
}

function movedChatBaselinePath(file) {
  return file
    .replace(/^examples\/chat\/model\//, "examples/chat-model/")
    .replace(/^examples\/chat\/users-model\//, "examples/users-model/");
}

export function baselineObservesExampleProtoEntry(entry, source) {
  return scanProto(entry.file, source).some(
    (failure) => debtKeyFromFailure(failure) === debtKey(entry),
  );
}

function trackedFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z", "examples"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Unable to enumerate tracked example Proto files.");
  return result.stdout.split("\0").filter(Boolean);
}

function exampleManifests(root, files, protoFiles, failures) {
  const manifests = new Map();
  const tracked = new Set(files);
  const roots = new Set(protoFiles.map((file) => file.slice(0, file.indexOf("/proto/"))));
  for (const packagePath of roots) {
    const manifestFile = `${packagePath}/spine-proto-manifest.json`;
    if (!tracked.has(manifestFile)) continue;
    const path = join(root, manifestFile);
    const packageName = packagePath.slice("examples/".length);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      failures.push(
        `examples/${packageName}/spine-proto-manifest.json invalid-provenance malformed-manifest`,
      );
      continue;
    }
    if (!Array.isArray(manifest.protoFiles)) {
      failures.push(
        `examples/${packageName}/spine-proto-manifest.json invalid-provenance missing-proto-files`,
      );
      continue;
    }
    if (manifest.copiedProtoFiles !== undefined && !Array.isArray(manifest.copiedProtoFiles)) {
      failures.push(`${manifestFile} invalid-provenance copied-source-list`);
      continue;
    }
    const copied = new Map();
    for (const source of manifest.copiedProtoFiles ?? []) {
      if (!isCopiedSource(source)) {
        failures.push(
          `examples/${packageName}/spine-proto-manifest.json invalid-provenance copied-source-contract`,
        );
        continue;
      }
      copied.set(source.path, source);
    }
    for (const protoFile of manifest.protoFiles) {
      const file = `examples/${packageName}/proto/${protoFile}`;
      if (typeof protoFile !== "string" || !isConfinedProtoPath(protoFile) || manifests.has(file)) {
        failures.push(`${file} invalid-provenance manifest-path`);
        continue;
      }
      manifests.set(file, copied.has(protoFile) ? { kind: "copied" } : { kind: "authored" });
    }
    for (const copiedPath of copied.keys()) {
      if (!manifest.protoFiles.includes(copiedPath)) {
        failures.push(
          `examples/${packageName}/spine-proto-manifest.json invalid-provenance copied-source-unlisted`,
        );
      }
    }
  }
  return manifests;
}

function isCopiedSource(source) {
  return (
    source !== null &&
    typeof source === "object" &&
    Object.keys(source).every((key) =>
      ["path", "repository", "commit", "upstreamPath"].includes(key),
    ) &&
    typeof source.path === "string" &&
    isConfinedProtoPath(source.path) &&
    typeof source.repository === "string" &&
    /^SpineEventEngine\/[A-Za-z0-9._-]+$/.test(source.repository) &&
    typeof source.commit === "string" &&
    /^[0-9a-f]{40}$/.test(source.commit) &&
    typeof source.upstreamPath === "string" &&
    source.upstreamPath.endsWith(".proto") &&
    !source.upstreamPath.startsWith("/") &&
    !source.upstreamPath.includes("..") &&
    !source.upstreamPath.includes("\\")
  );
}

function isConfinedProtoPath(path) {
  return (
    path.endsWith(".proto") && !path.startsWith("/") && !path.includes("..") && !path.includes("\\")
  );
}

function scanProto(file, source) {
  const tokens = tokenize(source);
  const failures = [];
  const occurrences = new Map();
  let index = 0;
  let context = "file";

  function record(kind, name, token, comment) {
    const key = `${kind}\u0000${name}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const identity = `${kind}:${name}#${occurrence}`;
    if (!usefulComment(comment, source, token.start)) {
      failures.push(
        `${file} ${comment === undefined ? "missing-comment" : "placeholder-comment"} ${identity}`,
      );
    }
    if (semanticComponents(name).length > maxSemanticComponents) {
      failures.push(
        `${file} semantic-name ${identity} (${semanticComponents(name).length} components)`,
      );
    }
  }

  function parseUntil(end) {
    let leading;
    while (index < tokens.length) {
      const token = tokens[index];
      if (token.value === end) {
        index += 1;
        return;
      }
      if (token.kind === "comment") {
        leading = token;
        index += 1;
        continue;
      }
      if (token.value === ";") {
        leading = undefined;
        index += 1;
        continue;
      }
      const name = namedDeclaration(tokens, index);
      if (["message", "enum", "service", "oneof"].includes(token.value) && name !== undefined) {
        const kind = token.value;
        record(kind, name.token.value, token, name.split ? undefined : leading);
        index = name.index + 1;
        while (index < tokens.length && tokens[index].value !== "{") index += 1;
        if (tokens[index]?.value === "{") {
          index += 1;
          const previous = context;
          context = kind;
          parseUntil("}");
          context = previous;
        }
        leading = undefined;
        continue;
      }
      if (token.value === "rpc" && name !== undefined) {
        record("rpc", name.token.value, token, name.split ? undefined : leading);
        index = name.index + 1;
        while (index < tokens.length && ![";", "{"].includes(tokens[index].value)) index += 1;
        if (tokens[index]?.value === "{") {
          index += 1;
          parseUntil("}");
        } else index += 1;
        leading = undefined;
        continue;
      }
      const enumValue =
        context === "enum" && token.kind === "word" ? enumValueName(tokens, index) : undefined;
      if (enumValue !== undefined) {
        record("enum-value", token.value, token, enumValue.split ? undefined : leading);
        index = enumValue.index;
        while (index < tokens.length && tokens[index].value !== ";") index += 1;
        index += 1;
        leading = undefined;
        continue;
      }
      if (["message", "oneof"].includes(context) && token.kind === "word") {
        const field = fieldName(tokens, index);
        if (field !== undefined) {
          record("field", field.token.value, field.start, field.split ? undefined : leading);
          while (index < tokens.length && tokens[index].value !== ";") index += 1;
          index += 1;
          leading = undefined;
          continue;
        }
      }
      leading = undefined;
      index += 1;
    }
  }
  parseUntil(undefined);
  return failures;
}

/**
 * Enforces the enduring authored-example package, path, prefix, prose, and spacing contract.
 */
export function scanExampleProtoContract(file, source) {
  const failures = [];
  const domain = /(?:^|\/)examples\/(chat|projects|orders|todo)(?:\/|$)/.exec(file)?.[1];
  const packageName = /^\s*package\s+([\w.]+)\s*;/m.exec(source)?.[1];
  if (domain === undefined || packageName !== `spine.examples.${domain}`)
    failures.push(`${file} namespace spine.examples.<domain>`);
  if (/(?:^|[/.])v1(?:[/.]|$)/.test(file) || /\b(?:package|import)\b[^;\n]*\bv1\b/.test(source))
    failures.push(`${file} owned-v1`);
  const prefix = /type(?:_url)?_prefix\s*\)?\s*=\s*"([^"]+)"/g;
  for (const match of source.matchAll(prefix))
    if (match[1] !== `type.spine.examples.${domain ?? ""}`)
      failures.push(`${file} type-prefix type.spine.examples.<domain>`);
  if (new RegExp(`\\b(?:${frameworkJargon})\\b`, "i").test(commentText(source)))
    failures.push(`${file} unrelated-framework-jargon`);
  const tokens = tokenize(source);
  for (let index = 1; index < tokens.length; index += 1) {
    const previous = tokens[index - 1];
    const token = tokens[index];
    if (
      previous.value !== ";" ||
      token.kind !== "comment" ||
      optionStatementEndsAt(tokens, index - 1)
    )
      continue;
    const gap = source.slice(previous.end, token.start);
    if (/^\r?\n[ \t]*$/u.test(gap))
      failures.push(
        `${file} comment-separation ${source.slice(0, token.start).split("\n").length}`,
      );
  }
  return failures;
}

function optionStatementEndsAt(tokens, semicolonIndex) {
  for (let index = semicolonIndex - 1; index >= 0; index -= 1) {
    const value = tokens[index].value;
    if ([";", "{", "}"].includes(value)) return false;
    if (value === "option") return true;
  }
  return false;
}

function commentText(source) {
  return [...source.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)].map((match) => match[0]).join("\n");
}

function namedDeclaration(tokens, index) {
  const next = skippedTokens(tokens, index + 1);
  return next.token?.kind === "word"
    ? { token: next.token, index: next.index, split: next.skippedComment }
    : undefined;
}

function enumValueName(tokens, index) {
  const next = skippedTokens(tokens, index + 1);
  return next.token?.value === "=" ? { index: next.index, split: next.skippedComment } : undefined;
}

function fieldName(tokens, index) {
  let cursor = index;
  const start = tokens[cursor];
  let split = false;
  if (["repeated", "optional", "required"].includes(start?.value)) {
    cursor += 1;
    ({ cursor, split } = fieldTokens(tokens, cursor, split));
  }
  if (tokens[cursor]?.value === "map") {
    cursor += 1;
    for (const value of ["<", "word", ",", "word", ">"]) {
      ({ cursor, split } = fieldTokens(tokens, cursor, split));
      if (value === "word" ? tokens[cursor]?.kind !== "word" : tokens[cursor]?.value !== value)
        return undefined;
      cursor += 1;
    }
    ({ cursor, split } = fieldTokens(tokens, cursor, split));
    if (tokens[cursor]?.kind !== "word") return undefined;
    const field = tokens[cursor];
    cursor += 1;
    ({ cursor, split } = fieldTokens(tokens, cursor, split));
    return tokens[cursor]?.value === "=" ? { token: field, split, start } : undefined;
  }
  if (tokens[cursor]?.kind !== "word") return undefined;
  cursor += 1;
  while (true) {
    ({ cursor, split } = fieldTokens(tokens, cursor, split));
    if (tokens[cursor]?.value !== ".") break;
    cursor += 1;
    ({ cursor, split } = fieldTokens(tokens, cursor, split));
    if (tokens[cursor]?.kind !== "word") return undefined;
    cursor += 1;
  }
  ({ cursor, split } = fieldTokens(tokens, cursor, split));
  if (tokens[cursor]?.kind !== "word") return undefined;
  const field = tokens[cursor];
  cursor += 1;
  ({ cursor, split } = fieldTokens(tokens, cursor, split));
  return tokens[cursor]?.value === "=" ? { token: field, split, start } : undefined;
}

function fieldTokens(tokens, index, split) {
  const next = skippedTokens(tokens, index);
  return { cursor: next.index, split: split || next.skippedComment };
}

function skippedTokens(tokens, index) {
  let cursor = index;
  let skippedComment = false;
  while (tokens[cursor]?.kind === "comment") {
    skippedComment = true;
    cursor += 1;
  }
  return { index: cursor, token: tokens[cursor], skippedComment };
}

function tokenize(source) {
  const tokens = [];
  const pattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z0-9_]*|\d+|[{}();=.<>,]|\[|\]/g;
  for (const match of source.matchAll(pattern)) {
    const value = match[0];
    tokens.push({
      kind:
        value.startsWith("//") || value.startsWith("/*")
          ? "comment"
          : /^[A-Za-z_]/.test(value)
            ? "word"
            : "symbol",
      value,
      start: match.index,
      end: match.index + value.length,
    });
  }
  return tokens;
}

function usefulComment(comment, source, declarationStart) {
  if (comment === undefined || !/^\s*$/.test(source.slice(comment.end, declarationStart)))
    return false;
  const text = comment.value
    .replace(/^\/\/\s?/, "")
    .replace(/^\/\*+|\*+\/$/g, "")
    .trim();
  if (text.length < 8 || /^(todo|fixme|tbd|n\/a|none|test|placeholder)[.!\s]*$/i.test(text))
    return false;
  if (/^(this|that) is (a|an|the) [a-z_]+[.]?$/i.test(text)) return false;
  return /[a-z]{3}/i.test(text) && !/^([a-z]+\s*){1,3}[.!]?$/i.test(text);
}

function semanticComponents(name) {
  return name
    .replace(/^_+/, "")
    .split("_")
    .flatMap((part) => part.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? [])
    .filter(Boolean);
}

export function escapeDiagnostic(value) {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      const unsafe =
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069);
      return unsafe ? `\\u{${codePoint.toString(16)}}` : character;
    })
    .join("");
}
