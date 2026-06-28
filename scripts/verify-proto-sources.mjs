import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    manifestPath: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--repo-root" && value !== undefined) {
      options.repoRoot = resolve(value);
      index += 1;
      continue;
    }

    if (arg === "--manifest" && value !== undefined) {
      options.manifestPath = resolve(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return options;
}

function isUnderPath(candidate, parent) {
  const childRelativeToParent = relative(parent, candidate);

  return (
    childRelativeToParent !== "" &&
    !childRelativeToParent.startsWith("..") &&
    !isAbsolute(childRelativeToParent)
  );
}

function enumerateProtoFiles(directory, repoRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    const repoRelativePath = relative(repoRoot, entryPath).split(sep).join("/");

    if (entry.isDirectory()) {
      return enumerateProtoFiles(entryPath, repoRoot);
    }

    return repoRelativePath.endsWith(".proto") ? [repoRelativePath] : [];
  });
}

function validateStringField(source, field, failures) {
  if (typeof source[field] !== "string" || source[field].length === 0) {
    failures.push(`manifest source entry has invalid ${field}`);
    return undefined;
  }

  return source[field];
}

function validateSource(source, repoRoot, protoRoot, seenLocalPaths, failures) {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    failures.push("manifest source entry must be an object");
    return undefined;
  }

  const localPath = validateStringField(source, "localPath", failures);
  const repository = validateStringField(source, "repository", failures);
  const commit = validateStringField(source, "commit", failures);
  const upstreamPath = validateStringField(source, "upstreamPath", failures);
  const sourceUrl = validateStringField(source, "sourceUrl", failures);
  const rawUrl = validateStringField(source, "rawUrl", failures);
  const sha256 = validateStringField(source, "sha256", failures);

  if (
    localPath === undefined ||
    repository === undefined ||
    commit === undefined ||
    upstreamPath === undefined ||
    sourceUrl === undefined ||
    rawUrl === undefined ||
    sha256 === undefined
  ) {
    return undefined;
  }

  if (seenLocalPaths.has(localPath)) {
    failures.push(`${localPath}: duplicate manifest localPath`);
    return undefined;
  }
  seenLocalPaths.add(localPath);

  if (
    isAbsolute(localPath) ||
    localPath.includes("\\") ||
    localPath.split("/").includes("..") ||
    !localPath.startsWith("proto/spine/") ||
    !localPath.endsWith(".proto")
  ) {
    failures.push(
      `${localPath}: localPath must be a relative proto/spine/**/*.proto path without '..'`,
    );
    return undefined;
  }

  if (!/^[0-9a-f]{40}$/.test(commit)) {
    failures.push(`${localPath}: commit must be a 40-character lowercase hex SHA`);
  }

  if (
    !upstreamPath.endsWith(".proto") ||
    upstreamPath.includes("\\") ||
    upstreamPath.split("/").includes("..")
  ) {
    failures.push(`${localPath}: upstreamPath must be a relative .proto path without '..'`);
  }

  if (!/^https:\/\/github\.com\/SpineEventEngine\/[^/]+\/blob\/[0-9a-f]{40}\//.test(sourceUrl)) {
    failures.push(`${localPath}: sourceUrl must be a GitHub blob URL pinned to the full commit`);
  } else if (!sourceUrl.includes(`/blob/${commit}/`)) {
    failures.push(`${localPath}: sourceUrl must use the manifest commit`);
  }

  if (
    !/^https:\/\/raw\.githubusercontent\.com\/SpineEventEngine\/[^/]+\/[0-9a-f]{40}\//.test(rawUrl)
  ) {
    failures.push(`${localPath}: rawUrl must be a raw GitHub URL pinned to the full commit`);
  } else if (!rawUrl.includes(`/${commit}/`)) {
    failures.push(`${localPath}: rawUrl must use the manifest commit`);
  }

  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    failures.push(`${localPath}: sha256 must be a 64-character lowercase hex digest`);
  }

  const filePath = resolve(repoRoot, localPath);

  if (!isUnderPath(filePath, protoRoot) && filePath !== protoRoot) {
    failures.push(`${localPath}: resolved path escapes proto/spine`);
    return undefined;
  }

  let fileStat;

  try {
    fileStat = lstatSync(filePath);
  } catch (error) {
    failures.push(`${localPath}: unable to stat copied file (${error.message})`);
    return undefined;
  }

  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    failures.push(`${localPath}: copied file must be a non-symlink regular file`);
    return undefined;
  }

  return {
    localPath,
    filePath,
    sha256,
  };
}

export function verifyProtoSources(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? defaultRepoRoot);
  const manifestPath = resolve(
    options.manifestPath ?? resolve(repoRoot, "proto/spine-sources.json"),
  );
  const protoRoot = resolve(repoRoot, "proto/spine");
  const failures = [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources)) {
    throw new Error("Invalid proto source manifest format.");
  }

  const seenLocalPaths = new Set();
  const validatedSources = [];

  for (const source of manifest.sources) {
    const validated = validateSource(source, repoRoot, protoRoot, seenLocalPaths, failures);

    if (validated !== undefined) {
      validatedSources.push(validated);
    }
  }

  const actualProtoFiles = new Set(enumerateProtoFiles(protoRoot, repoRoot));
  const manifestProtoFiles = new Set(validatedSources.map((source) => source.localPath));

  for (const actualPath of actualProtoFiles) {
    if (!manifestProtoFiles.has(actualPath)) {
      failures.push(`${actualPath}: copied proto file is missing from manifest`);
    }
  }

  for (const manifestPathEntry of manifestProtoFiles) {
    if (!actualProtoFiles.has(manifestPathEntry)) {
      failures.push(`${manifestPathEntry}: manifest entry has no copied proto file`);
    }
  }

  for (const source of validatedSources) {
    const contents = readFileSync(source.filePath);
    const actual = createHash("sha256").update(contents).digest("hex");

    if (actual !== source.sha256) {
      failures.push(`${source.localPath}: expected ${source.sha256}, got ${actual}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Copied Spine proto source verification failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }

  return validatedSources.length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const verifiedCount = verifyProtoSources(options);

    console.log(`Verified ${verifiedCount} copied Spine proto source file checksums.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
