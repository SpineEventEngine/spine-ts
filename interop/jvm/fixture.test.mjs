import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { describe, expect, test } from "vitest";

import {
  assertRequiredCapabilities,
  assertSafeArchiveEntries,
  assertSafeArchiveLinks,
  downloadArchive,
  prepareFixture,
  samePathOccurrences,
  treeDigest,
  verifyArchiveChecksum,
} from "./fixture.mjs";

describe("the static JVM source reference", () => {
  test("rejects unsafe entries, escaping links, and duplicate metadata paths", () => {
    expect(() => assertSafeArchiveEntries(["root/../escape"], 10, "root")).toThrow(
      "locked archive root",
    );
    expect(() =>
      assertSafeArchiveLinks(
        [{ path: "root/link", type: "symlink", linkTarget: "../../escape" }],
        "root",
      ),
    ).toThrow("unsafe archive symbolic link");
    expect(samePathOccurrences(["root/a", "root/a"], ["root/a"])).toBe(false);
  });

  test("requires connected native capability predicates", () => {
    const files = capabilityFiles(true);
    expect(assertRequiredCapabilities(files)).toMatchObject({
      command: true,
      eventSubscription: true,
    });
    expect(() =>
      assertRequiredCapabilities({ commandService: Object.values(files).join("\n") }),
    ).toThrow("required JVM service capability is absent");
  });

  test("hashes symbolic-link metadata as part of the tree identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "spine-jvm-digest-"));
    await writeFile(join(root, "source"), "one");
    await symlink("source", join(root, "link"));
    const before = await treeDigest(root);
    await rm(join(root, "link"));
    await symlink("other", join(root, "link"));
    expect(await treeDigest(root)).not.toBe(before);
  });

  test("downloads with a streaming maximum byte bound", async () => {
    const output = join(await mkdtemp(join(tmpdir(), "spine-jvm-download-")), "archive.part");
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
    await expect(
      downloadArchive({
        output,
        url: "fixture://archive",
        maximumBytes: 3,
        fetchImpl: async () => ({
          ok: true,
          body: {
            getReader: () => ({
              read: async () =>
                chunks.length ? { done: false, value: chunks.shift() } : { done: true },
            }),
          },
        }),
      }),
    ).rejects.toThrow("archive exceeds the fixture size limit");
  });

  test("removes a randomized partial archive and every per-run staging directory after a stalled timeout, then retries", async () => {
    const fixture = await createFixtureArchive("a", true);
    let aborted = false;
    await expect(
      prepareFixture({
        repositoryRoot: fixture.repositoryRoot,
        execute: fixture.execute,
        downloadTimeoutMs: 15,
        fetchImpl: async (_url, { signal }) => ({
          ok: true,
          body: {
            getReader: () => ({
              read: async () => {
                if (!aborted) {
                  aborted = true;
                  return { done: false, value: new Uint8Array([1, 2, 3]) };
                }
                return new Promise((_, reject) =>
                  signal.addEventListener("abort", () => reject(new Error("download aborted"))),
                );
              },
            }),
          },
        }),
      }),
    ).rejects.toThrow("download aborted");
    expect(aborted).toBe(true);
    await expectNoRunArtifacts(fixture);
    await expect(
      prepareFixture({
        repositoryRoot: fixture.repositoryRoot,
        execute: fixture.execute,
        fetchImpl: async () => archiveResponse(fixture.archiveBytes),
      }),
    ).resolves.toMatchObject({
      archive: fixture.archive,
      sourceDigest: fixture.sourceTreeSha256,
      capabilities: { command: true },
    });
    await expectNoRunArtifacts(fixture);
  });

  test("concurrent callers independently validate one immutable archive and retain no extracted source", async () => {
    const fixture = await createFixtureArchive("b", true);
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        prepareFixture({
          repositoryRoot: fixture.repositoryRoot,
          execute: fixture.execute,
          fetchImpl: async () => archiveResponse(fixture.archiveBytes),
        }),
      ),
    );
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result).toMatchObject({
        archive: fixture.archive,
        sourceDigest: fixture.sourceTreeSha256,
        capabilities: { query: true },
      });
      expect(result).not.toHaveProperty("extracted");
    }
    await expectNoRunArtifacts(fixture);
    await expect(stat(join(fixture.repositoryRoot, "interop/jvm/.cache/source"))).rejects.toThrow();
  });

  test("one caller's cleanup cannot remove another caller's active staging directory", async () => {
    const fixture = await createFixtureArchive("d", true);
    await prepareFixture({
      repositoryRoot: fixture.repositoryRoot,
      execute: fixture.execute,
      fetchImpl: async () => archiveResponse(fixture.archiveBytes),
    });
    let extractionStarted;
    const extracted = new Promise((resolve) => {
      extractionStarted = resolve;
    });
    let resumeFirst;
    const resume = new Promise((resolve) => {
      resumeFirst = resolve;
    });
    const first = prepareFixture({
      repositoryRoot: fixture.repositoryRoot,
      execute: fixture.execute,
      afterExtraction: async () => {
        extractionStarted();
        await resume;
      },
    });
    await expect(Promise.race([extracted, rejectAfter(100)])).resolves.toBeUndefined();
    await expect(
      prepareFixture({ repositoryRoot: fixture.repositoryRoot, execute: fixture.execute }),
    ).resolves.toMatchObject({ sourceDigest: fixture.sourceTreeSha256 });
    resumeFirst();
    await expect(first).resolves.toMatchObject({ sourceDigest: fixture.sourceTreeSha256 });
    await expectNoRunArtifacts(fixture);
  });

  test("rejects malformed capabilities and digest before return and still removes caller staging", async () => {
    const fixture = await createFixtureArchive("c", false);
    await expect(
      prepareFixture({
        repositoryRoot: fixture.repositoryRoot,
        execute: fixture.execute,
        fetchImpl: async () => archiveResponse(fixture.archiveBytes),
      }),
    ).rejects.toThrow("required JVM service capability is absent");
    await expectNoRunArtifacts(fixture);
    await writeFixtureLock({ ...fixture, sourceTreeSha256: "0".repeat(64) });
    await expect(
      prepareFixture({
        repositoryRoot: fixture.repositoryRoot,
        execute: fixture.execute,
        fetchImpl: async () => archiveResponse(fixture.archiveBytes),
      }),
    ).rejects.toThrow("source tree SHA-256 mismatch");
    await expectNoRunArtifacts(fixture);
  });

  test("rejects checksum mismatch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spine-jvm-checksum-"));
    const archive = join(directory, "archive.zip");
    await writeFile(archive, "untrusted");
    await expect(verifyArchiveChecksum(archive, "0".repeat(64))).rejects.toThrow(
      "archive SHA-256 mismatch",
    );
  });

  test("hashes archive content incrementally without reading the whole file", async () => {
    const chunks = [Buffer.from("official "), Buffer.from("archive")];
    const checksum = createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
    let opened = false;
    await expect(
      verifyArchiveChecksum("not-a-real-archive.zip", checksum, {
        createReadStreamImpl: (path) => {
          expect(path).toBe("not-a-real-archive.zip");
          opened = true;
          return Readable.from(chunks);
        },
      }),
    ).resolves.toBe(checksum);
    expect(opened).toBe(true);
  });

  test("propagates archive stream failures", async () => {
    const failure = new Error("archive stream failed");
    await expect(
      verifyArchiveChecksum("not-a-real-archive.zip", "0".repeat(64), {
        createReadStreamImpl: () =>
          Readable.from(
            (async function* () {
              throw failure;
            })(),
          ),
      }),
    ).rejects.toThrow(failure);
  });
});

function capabilityFiles(complete) {
  return {
    commandService: "extends CommandServiceGrpc.CommandServiceImplBase",
    queryService: "extends QueryServiceGrpc.QueryServiceImplBase",
    subscriptionService:
      "extends SubscriptionServiceGrpc.SubscriptionServiceImplBase void subscribe(Topic topic)",
    topicValidator: "EventMessage.class.isAssignableFrom(targetClass)",
    eventUpdateHandler: complete
      ? "class EventUpdateHandler extends UpdateHandler { EventUpdates.newBuilder(); }"
      : "class EventUpdateHandler extends UpdateHandler {}",
  };
}

async function createFixtureArchive(character, completeCapabilities) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "spine-jvm-integration-"));
  const revision = character.repeat(40);
  const archiveRoot = `core-jvm-${revision}`;
  const source = join(repositoryRoot, "archive-source", archiveRoot);
  await mkdir(join(source, "server/src/main/java/io/spine/server/stand"), { recursive: true });
  for (const [path, content] of Object.entries({
    "CommandService.java": capabilityFiles(completeCapabilities).commandService,
    "QueryService.java": capabilityFiles(completeCapabilities).queryService,
    "SubscriptionService.java": capabilityFiles(completeCapabilities).subscriptionService,
    "stand/TopicValidator.java": capabilityFiles(completeCapabilities).topicValidator,
    "stand/EventUpdateHandler.java": capabilityFiles(completeCapabilities).eventUpdateHandler,
  }))
    await writeFile(join(source, "server/src/main/java/io/spine/server", path), content);
  const built = join(repositoryRoot, "archive.zip");
  execFileSync("zip", ["-qr", built, archiveRoot], { cwd: join(repositoryRoot, "archive-source") });
  const archiveBytes = await readFile(built);
  const fixture = {
    repositoryRoot,
    revision,
    archiveRoot,
    archive: join(repositoryRoot, "interop/jvm/.cache", `${revision}.zip`),
    archiveBytes,
    archiveSha256: createHash("sha256").update(archiveBytes).digest("hex"),
    sourceTreeSha256: await treeDigest(source),
    execute: (command, args, options) =>
      execFileSync(command, args, { encoding: "utf8", ...options }),
  };
  await writeFixtureLock(fixture);
  return fixture;
}

async function writeFixtureLock(fixture) {
  await mkdir(join(fixture.repositoryRoot, "interop/jvm"), { recursive: true });
  await writeFile(
    join(fixture.repositoryRoot, "interop/jvm/fixture-lock.json"),
    JSON.stringify({
      revision: fixture.revision,
      archiveRoot: fixture.archiveRoot,
      archiveUrl: "fixture://archive.zip",
      archiveSha256: fixture.archiveSha256,
      sourceTreeSha256: fixture.sourceTreeSha256,
      limits: { maximumArchiveBytes: 100000, maximumEntries: 100, maximumExpandedBytes: 100000 },
    }),
  );
}

function archiveResponse(bytes) {
  let sent = false;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })),
      }),
    },
  };
}

function rejectAfter(milliseconds) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("extraction did not pause")), milliseconds),
  );
}

async function expectNoRunArtifacts(fixture) {
  const cache = join(fixture.repositoryRoot, "interop/jvm/.cache");
  await expect(stat(join(cache, "staging"))).rejects.toThrow();
  const entries = await readdir(cache).catch(() => []);
  expect(entries.filter((entry) => entry.includes(".part"))).toEqual([]);
}
