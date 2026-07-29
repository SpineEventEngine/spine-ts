import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  rmdir,
  stat,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function verifyArchiveChecksum(
  archivePath,
  expectedChecksum,
  { createReadStreamImpl = createReadStream } = {},
) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStreamImpl(archivePath)) hash.update(chunk);
  const actualChecksum = hash.digest("hex");
  if (actualChecksum !== expectedChecksum)
    throw new Error(
      `archive SHA-256 mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
    );
  return actualChecksum;
}

export async function downloadArchive({
  output,
  url,
  maximumBytes,
  fetchImpl = fetch,
  timeoutMs = 120_000,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok || !response.body)
      throw new Error(`archive download failed: ${response.status}`);
    let bytes = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return bytes;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        controller.abort();
        throw new Error("archive exceeds the fixture size limit");
      }
      await appendFile(output, value);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function assertRequiredCapabilities(files) {
  const evidence = {
    command: /extends\s+CommandServiceGrpc\.CommandServiceImplBase/.test(
      files.commandService ?? "",
    ),
    query: /extends\s+QueryServiceGrpc\.QueryServiceImplBase/.test(files.queryService ?? ""),
    projectionSubscription:
      /extends\s+SubscriptionServiceGrpc\.SubscriptionServiceImplBase/.test(
        files.subscriptionService ?? "",
      ) && /subscribe\s*\(\s*Topic/.test(files.subscriptionService ?? ""),
    eventSubscription:
      /EventMessage\.class\.isAssignableFrom\(targetClass\)/.test(files.topicValidator ?? "") &&
      /class\s+EventUpdateHandler\s+extends\s+UpdateHandler/.test(files.eventUpdateHandler ?? "") &&
      /EventUpdates\.newBuilder\(\)/.test(files.eventUpdateHandler ?? ""),
  };
  const absent = Object.entries(evidence)
    .filter(([, present]) => !present)
    .map(([name]) => name);
  if (absent.length)
    throw new Error(`required JVM service capability is absent: ${absent.join(", ")}`);
  return evidence;
}

export function assertSafeArchiveMetadata(entries, maximumExpandedBytes) {
  let expandedBytes = 0;
  for (const entry of entries) {
    expandedBytes += entry.uncompressedSize;
    if (expandedBytes > maximumExpandedBytes)
      throw new Error("archive exceeds expanded-size limit");
  }
}

export function assertSafeArchiveLinks(entries, archiveRoot) {
  const root = resolve("/fixture", archiveRoot);
  for (const entry of entries.filter((candidate) => candidate.type === "symlink")) {
    if (!entry.linkTarget || isAbsolute(entry.linkTarget))
      throw new Error(`unsafe archive symbolic link: ${entry.path}`);
    const target = resolve("/fixture", dirname(entry.path), entry.linkTarget);
    if (target !== root && !target.startsWith(`${root}/`))
      throw new Error(`unsafe archive symbolic link: ${entry.path}`);
  }
}

export function assertSafeArchiveEntries(entries, maximumEntries = 30_000, archiveRoot) {
  if (!entries.length || entries.length > maximumEntries)
    throw new Error("archive entry count is outside the fixture limit");
  const root = archiveRoot && resolve("/fixture", archiveRoot);
  for (const entry of entries) {
    const normalized = normalize(entry);
    if (
      isAbsolute(entry) ||
      normalized === ".." ||
      normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    )
      throw new Error(`unsafe archive entry: ${entry}`);
    if (root) {
      const candidate = resolve("/fixture", normalized);
      if (candidate !== root && !candidate.startsWith(`${root}/`))
        throw new Error(`archive entry escapes locked archive root: ${entry}`);
    }
  }
}

export async function prepareFixture({
  repositoryRoot = defaultRepositoryRoot(),
  execute = run,
  download = downloadArchive,
  fetchImpl,
  downloadTimeoutMs,
  afterExtraction = async () => {},
} = {}) {
  const lock = JSON.parse(
    await readFile(join(repositoryRoot, "interop/jvm/fixture-lock.json"), "utf8"),
  );
  const cache = join(repositoryRoot, "interop/jvm/.cache");
  const archive = join(cache, `${lock.revision}.zip`);
  await mkdir(cache, { recursive: true });
  await ensureArchive({ archive, cache, lock, download, fetchImpl, downloadTimeoutMs });
  if ((await stat(archive)).size > lock.limits.maximumArchiveBytes)
    throw new Error("archive exceeds the fixture size limit");
  await verifyArchiveChecksum(archive, lock.archiveSha256);
  const entries = execute("unzip", ["-Z1", archive]).trim().split("\n").filter(Boolean);
  assertSafeArchiveEntries(entries, lock.limits.maximumEntries, lock.archiveRoot);
  const metadata = parseArchiveMetadata(execute("zipinfo", ["-l", archive]));
  if (
    !samePathOccurrences(
      entries,
      metadata.map((entry) => entry.path),
    )
  )
    throw new Error("zipinfo metadata does not describe every archive entry");
  for (const entry of metadata.filter((candidate) => candidate.type === "symlink"))
    entry.linkTarget = execute("unzip", ["-p", archive, entry.path]).toString().trim();
  assertSafeArchiveMetadata(metadata, lock.limits.maximumExpandedBytes);
  assertSafeArchiveLinks(metadata, lock.archiveRoot);
  const staging = join(cache, "staging", `${lock.revision}-${randomUUID()}`);
  try {
    await mkdir(staging, { recursive: true });
    execute("unzip", ["-q", archive, "-d", staging]);
    const source = join(staging, lock.archiveRoot);
    await afterExtraction(source);
    const sourceDigest = await treeDigest(source);
    if (lock.sourceTreeSha256 && sourceDigest !== lock.sourceTreeSha256)
      throw new Error(
        `source tree SHA-256 mismatch: expected ${lock.sourceTreeSha256}, got ${sourceDigest}`,
      );
    return {
      archive,
      sourceDigest,
      capabilities: assertRequiredCapabilities(await readCapabilitySource(source)),
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
    await removeEmptyDirectory(dirname(staging));
  }
}

async function removeEmptyDirectory(path) {
  try {
    await rmdir(path);
  } catch (error) {
    if (error?.code !== "ENOTEMPTY" && error?.code !== "ENOENT") throw error;
  }
}

async function ensureArchive({ archive, cache, lock, download, fetchImpl, downloadTimeoutMs }) {
  if (await exists(archive)) return;
  const partial = join(cache, `${lock.revision}.${randomUUID()}.part`);
  try {
    await download({
      output: partial,
      url: lock.archiveUrl,
      maximumBytes: lock.limits.maximumArchiveBytes,
      fetchImpl,
      timeoutMs: downloadTimeoutMs,
    });
    await verifyArchiveChecksum(partial, lock.archiveSha256);
    await rename(partial, archive);
  } finally {
    await rm(partial, { force: true });
  }
}

export function samePathOccurrences(entries, metadataPaths) {
  const counts = (paths) =>
    paths.reduce((result, path) => result.set(path, (result.get(path) ?? 0) + 1), new Map());
  const left = counts(entries);
  const right = counts(metadataPaths);
  return left.size === right.size && [...left].every(([path, count]) => right.get(path) === count);
}

export function parseArchiveMetadata(output) {
  return output
    .split("\n")
    .map((line) => /^([dl-]).*?\s+(\d+)\s+\w+\s+\d+\s+\w+\s+\S+\s+\S+\s+(.+)$/.exec(line))
    .filter(Boolean)
    .map((match) => ({
      type: match[1] === "l" ? "symlink" : "file",
      uncompressedSize: Number(match[2]),
      path: match[3],
    }));
}

export async function treeDigest(root) {
  const files = run("find", [".", "-print0"], { cwd: root, encoding: "buffer" })
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const path = join(root, file);
    const entry = await lstat(path);
    hash.update(relative(root, resolve(root, file)));
    hash.update(entry.mode.toString());
    if (entry.isSymbolicLink()) {
      hash.update("symlink");
      hash.update(await readlink(path));
    } else if (entry.isFile()) {
      hash.update("file");
      hash.update(await readFile(path));
    } else hash.update("directory");
  }
  return hash.digest("hex");
}

async function readCapabilitySource(root) {
  const files = [
    "CommandService.java",
    "QueryService.java",
    "SubscriptionService.java",
    "stand/TopicValidator.java",
    "stand/EventUpdateHandler.java",
  ];
  const source = await Promise.all(
    files.map((file) => readFile(join(root, "server/src/main/java/io/spine/server", file), "utf8")),
  );
  return Object.fromEntries(files.map((file, index) => [capabilityKey(file), source[index]]));
}

function capabilityKey(file) {
  return {
    "CommandService.java": "commandService",
    "QueryService.java": "queryService",
    "SubscriptionService.java": "subscriptionService",
    "stand/TopicValidator.java": "topicValidator",
    "stand/EventUpdateHandler.java": "eventUpdateHandler",
  }[file];
}
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
function run(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}
function defaultRepositoryRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  prepareFixture()
    .then(({ capabilities }) =>
      console.log(
        `JVM fixture ready (static source reference only): ${JSON.stringify(capabilities)}`,
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
