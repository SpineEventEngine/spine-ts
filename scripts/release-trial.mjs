import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import childProcess from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { main } from "./release-cli.mjs";
import { createPublicRegistry, npmPublishArgs } from "./release-publication.mjs";
import { frameworkPackageNames } from "./package-artifacts.mjs";

const registryUrl = "https://registry.npmjs.org/";
const root = resolve(new URL("..", import.meta.url).pathname);

/**
 * Allows only checkout identity and local archive inspection subprocesses.
 *
 * @param command Executable requested by release code.
 * @param args Requested arguments.
 * @param options Process options.
 * @param input Saved archive directory.
 * @returns Whether the command is a known local inspection operation.
 */
function allowedProcess(command, args, options, input) {
  if (command === "git")
    return JSON.stringify(args) === JSON.stringify(["rev-parse", "HEAD"]) && options?.cwd === root;
  if (command !== "tar" || !args?.[1]?.startsWith(input + sep)) return false;
  if (["-tzf", "-tvzf"].includes(args[0]) && args.length === 2) return true;
  return (
    args.length === 5 &&
    args[0] === "-xzf" &&
    args[2] === "--strip-components=1" &&
    args[3] === "-C" &&
    args[4].startsWith(join(tmpdir(), "spine-snapshot-artifact-")) &&
    options?.cwd === root
  );
}

/**
 * Checks real subprocesses even if an injected npm runner is ignored.
 *
 * @param input Saved archive directory.
 * @param work Trial work to execute while the process guard is active.
 * @returns Result of the guarded work.
 */
export async function withProcessGuard(input, work) {
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    if (!allowedProcess(command, args, options, input))
      throw new Error("Blocked trial subprocess: " + command);
    return original(command, args, options);
  };
  syncBuiltinESMExports();
  try {
    return await work();
  } finally {
    childProcess.spawnSync = original;
    syncBuiltinESMExports();
  }
}

/**
 * Returns the npm-shaped response for one offline registry read.
 *
 * @param body JSON response body, or undefined for 404.
 * @returns Minimal fetch response consumed by the real registry parser.
 */
function response(body) {
  return body === undefined
    ? { status: 404, ok: false }
    : { status: 200, ok: true, json: async () => body };
}

/**
 * Builds the provenance payload expected by local confirmation checks.
 *
 * @param entry Prepared package entry.
 * @param sourceSha Release source commit.
 * @returns One complete npm-shaped attestation response.
 */
function attestations(entry, sourceSha) {
  const digest = Buffer.from(entry.integrity.slice(7), "base64").toString("hex");
  const statement = {
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [
      {
        name: `pkg:npm/${entry.name.replace("@", "%40")}@${entry.version}`,
        digest: { sha512: digest },
      },
    ],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: "https://github.com/SpineEventEngine/spine-ts",
            path: ".github/workflows/publish.yml",
            ref: "refs/heads/master",
          },
        },
        resolvedDependencies: [
          {
            uri: "git+https://github.com/SpineEventEngine/spine-ts@refs/heads/master",
            digest: { gitCommit: sourceSha },
          },
        ],
      },
    },
  };
  return { attestations: [{ bundle: bundle(statement) }] };
}

/**
 * Supplies structurally complete local evidence for provenance parsing.
 *
 * @param statement Expected local provenance statement.
 * @returns npm-shaped attestation bundle.
 */
function bundle(statement) {
  return {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    dsseEnvelope: {
      payloadType: "application/vnd.in-toto+json",
      payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
      signatures: [{ sig: "c2ln", keyid: "" }],
    },
    verificationMaterial: {
      certificate: { rawBytes: "Y2VydA==" },
      tlogEntries: [
        {
          logId: { keyId: "a2V5" },
          kindVersion: { kind: "dsse", version: "0.0.1" },
          canonicalizedBody: "Ym9keQ==",
          inclusionPromise: { signedEntryTimestamp: "c2V0" },
          inclusionProof: {
            rootHash: "cm9vdA==",
            hashes: [],
            checkpoint: { envelope: "checkpoint" },
          },
        },
      ],
    },
  };
}

/**
 * Lists only the HTTP resources that the publication entrypoints may read.
 *
 * @param release Prepared release identity.
 * @returns URL to package and resource kind mapping.
 */
function resources(release) {
  const paths = new Map();
  for (const entry of release.packages) {
    const encoded = encodeURIComponent(entry.name);
    paths.set(registryUrl + encoded, { kind: "packument", entry });
    paths.set(registryUrl + encoded + "/" + entry.version, { kind: "artifact", entry });
    paths.set(registryUrl + "-/package/" + encoded + "/dist-tags", { kind: "tags", entry });
    paths.set(
      registryUrl + "-/npm/v1/attestations/" + entry.name.replace("/", "%2f") + "@" + entry.version,
      { kind: "attestations", entry },
    );
  }
  return paths;
}

/**
 * Creates strict local responses at the HTTP and npm process boundaries.
 *
 * @param release Prepared release manifest.
 * @param input Saved archive directory.
 * @param interruptAfter Number of accepted uploads before one simulated read failure.
 * @param fault Optional denied, malformed, delayed-body, or invisible registry response.
 * @returns Injected I/O and observable trial state.
 */
export function createTrialServices(release, input, interruptAfter = Infinity, fault) {
  const published = new Set();
  const paths = resources(release);
  let calls = 0;
  let interrupted = false;
  let faultUsed = false;
  const reads = [];
  const fetch = async (url, options = {}) => {
    const target = paths.get(url);
    if (!target) throw new Error("Unexpected trial URL: " + url);
    if ((options.method ?? "GET") !== "GET" || options.body !== undefined)
      throw new Error("Unexpected trial HTTP request");
    const { kind, entry } = target;
    reads.push({ kind, name: entry.name });
    if (fault === "denied" && kind === "packument" && entry === release.packages[0])
      return { status: 401, ok: false };
    if (fault === "malformed" && kind === "packument" && entry === release.packages[0])
      return response([]);
    if (
      fault === "delayed-body" &&
      !faultUsed &&
      published.size === release.packages.length &&
      kind === "artifact" &&
      entry === release.packages[0]
    ) {
      faultUsed = true;
      return { status: 200, ok: true, json: () => new Promise(() => {}) };
    }
    if (!interrupted && published.size === interruptAfter && kind === "tags") {
      interrupted = true;
      throw new Error("Simulated registry interruption");
    }
    return trialResponse(
      kind,
      entry,
      fault === "invisible" ? new Set() : published,
      release,
      paths,
    );
  };
  const spawn = (command, args, options) => {
    const result = trialSpawn(command, args, options, release, input, published);
    calls++;
    return result;
  };
  return {
    fetch,
    spawn,
    published,
    reads,
    get calls() {
      return calls;
    },
  };
}

/**
 * Gives the real parser npm-shaped data for one known local request.
 *
 * @param kind Registry resource kind.
 * @param entry Prepared package entry.
 * @param published Packages accepted by the local npm substitute.
 * @param release Prepared release identity.
 * @param paths Allowed registry paths.
 * @returns Local HTTP response.
 */
function trialResponse(kind, entry, published, release, paths) {
  if (kind === "packument")
    return response(
      published.has(entry.name)
        ? { versions: { [entry.version]: {} }, "dist-tags": { [release.tag]: entry.version } }
        : undefined,
    );
  if (!published.has(entry.name))
    return response(kind === "tags" ? { latest: "1.0.0" } : undefined);
  if (kind === "tags")
    return response(
      release.tag === "latest"
        ? { latest: entry.version }
        : { snapshot: entry.version, latest: "1.0.0" },
    );
  if (kind === "attestations") return response(attestations(entry, release.sourceSha));
  const url = [...paths].find(
    ([, value]) => value.kind === "attestations" && value.entry === entry,
  )[0];
  return response({
    name: entry.name,
    version: entry.version,
    dist: { integrity: entry.integrity, attestations: { url } },
  });
}

/**
 * Verifies local npm invocation shape and records one accepted upload.
 *
 * @param command Process executable.
 * @param args Process arguments.
 * @param options Process options including isolated npm config paths.
 * @param release Prepared release identity.
 * @param input Saved archive directory.
 * @param published Accepted package names.
 * @returns npm-shaped success result.
 */
function trialSpawn(command, args, options, release, input, published) {
  const entry = release.packages.find((item) => args?.[1] === join(input, item.tarball));
  if (
    command !== "npm" ||
    !entry ||
    JSON.stringify(args) !== JSON.stringify(npmPublishArgs(join(input, entry.tarball), release.tag))
  )
    throw new Error("Unexpected trial npm command");
  if (entry.name !== release.packages[published.size]?.name)
    throw new Error("Trial publication order changed");
  const user = options?.env?.NPM_CONFIG_USERCONFIG;
  const global = options?.env?.NPM_CONFIG_GLOBALCONFIG;
  if (
    !user ||
    !global ||
    user === global ||
    readFileSync(user, "utf8") !== "" ||
    readFileSync(global, "utf8") !== ""
  )
    throw new Error("Trial npm config is not isolated");
  if (published.has(entry.name)) throw new Error("Trial attempted duplicate publication");
  published.add(entry.name);
  return { status: 0, stdout: JSON.stringify({ id: entry.name }), stderr: "" };
}

/**
 * Calls the real release command dispatcher with strict local service I/O.
 *
 * @param command Release CLI command.
 * @param input Saved release directory.
 * @param reportPath Report path to write.
 * @param services Local service boundaries.
 * @param priorPath Earlier report, when resuming or verifying.
 * @param timeoutMs Optional shorter GET attempt timeout for the delayed-body trial.
 * @returns Release CLI result.
 */
function run(command, input, reportPath, services, priorPath, timeoutMs) {
  const argv = ["node", "release-cli.mjs", command];
  if (command !== "preflight") argv.push("--input", input, "--report", reportPath);
  if (priorPath) argv.push("--prior-report", priorPath);
  return main({
    argv,
    dependencies: {
      fetch: services.fetch,
      spawn: services.spawn,
      confirmation: services.confirmation,
      ...(timeoutMs === undefined
        ? {}
        : { registry: createPublicRegistry(services.fetch, timeoutMs) }),
    },
  });
}

/**
 * Exercises a delayed body and fatal registry responses through release commands.
 *
 * @param release Prepared release identity.
 * @param input Saved archive directory.
 * @param output Trial report directory.
 * @returns Promise that completes after the read-failure checks pass.
 */
async function runReadFailures(release, input, output) {
  const delayed = createTrialServices(release, input, Infinity, "delayed-body");
  await run("preflight", input, "", delayed);
  const result = await run(
    "publish",
    input,
    join(output, "delayed-body.json"),
    delayed,
    undefined,
    5,
  );
  assert(result.packages.every(({ status }) => status === "published"));
  assert.equal(delayed.calls, release.packages.length);
  await run(
    "verify-registry",
    input,
    join(output, "delayed-read-only.json"),
    delayed,
    join(output, "delayed-body.json"),
    5,
  );
  for (const fault of ["denied", "malformed"]) {
    const services = createTrialServices(release, input, Infinity, fault);
    await assert.rejects(
      run("preflight", input, "", services),
      /Registry read failed: 401|ambiguous registry response/u,
    );
    assert.equal(services.calls, 0);
  }
}

/**
 * Proves accepted uploads finish while every new version remains publicly absent.
 *
 * @param release Prepared release identity.
 * @param input Saved archive directory.
 * @param output Trial report directory.
 */
async function runInvisible(release, input, output) {
  const services = createTrialServices(release, input, Infinity, "invisible");
  const reportPath = join(output, "invisible.json");
  const result = await run("publish", input, reportPath, services);
  assert(result.packages.every(({ status }) => status === "published"));
  assert.equal(services.calls, release.packages.length);
  assert.equal(services.reads.length, release.packages.length * 3);
  let tick = 0;
  services.confirmation = {
    now: () => tick++,
    sleep: async () => {
      tick = 100;
    },
    windowMs: 100,
  };
  await assert.rejects(
    run("verify-registry", input, join(output, "invisible-read-only.json"), services, reportPath),
    /Registry visibility remains unconfirmed/u,
  );
  assert.equal(services.calls, release.packages.length);
}

/**
 * Checks a complete simulated publication and read-only confirmation.
 *
 * @param release Prepared release identity.
 * @param input Saved archive directory.
 * @param output Trial report directory.
 */
async function runNormal(release, input, output) {
  const services = createTrialServices(release, input);
  await run("preflight", input, "", services);
  const reportPath = join(output, "normal.json");
  const result = await run("publish", input, reportPath, services);
  assert.equal(services.calls, frameworkPackageNames.length);
  assert(result.packages.every(({ status }) => status === "published"));
  await run("verify-registry", input, join(output, "read-only.json"), services, reportPath);
}

/**
 * Checks persisted partial evidence, immediate rerun, and read-only confirmation.
 *
 * @param release Prepared release identity.
 * @param input Saved archive directory.
 * @param output Trial report directory.
 */
async function runRecovery(release, input, output) {
  const services = createTrialServices(release, input, 2, "invisible");
  await run("preflight", input, "", services);
  const partialPath = join(output, "partial.json");
  await assert.rejects(
    run("publish", input, partialPath, services),
    /Simulated registry interruption/u,
  );
  const partial = JSON.parse(readFileSync(partialPath, "utf8"));
  assert.equal(partial.packages.filter(({ attempts }) => attempts.length).length, 2);
  const readCount = services.reads.length;
  process.env.GITHUB_RUN_ATTEMPT = "2";
  const resumedPath = join(output, "resumed.json");
  const resumed = await run("publish", input, resumedPath, services, partialPath);
  assert(resumed.packages.every(({ status }) => ["published", "already present"].includes(status)));
  assert.equal(services.calls, frameworkPackageNames.length);
  assert(
    services.reads
      .slice(readCount)
      .every(({ name }) => !release.packages.slice(0, 2).some((entry) => entry.name === name)),
  );
}

/**
 * Checks normal, interrupted, resumed, and read-only release procedures.
 *
 * @param input Saved release archive directory.
 * @param output New trial report directory.
 * @returns Promise that completes after all trial checks pass.
 */
export async function runTrial(input, output) {
  const release = JSON.parse(readFileSync(join(input, "release-manifest.json"), "utf8"));
  assert.equal(release.packages.length, frameworkPackageNames.length);
  mkdirSync(output);
  const previousFetch = globalThis.fetch;
  const priorRunId = process.env.GITHUB_RUN_ID;
  const priorAttempt = process.env.GITHUB_RUN_ATTEMPT;
  globalThis.fetch = () => {
    throw new Error("Uninjected network request in release trial");
  };
  process.env.GITHUB_RUN_ID = (priorRunId ?? "local") + "-trial";
  try {
    process.env.GITHUB_RUN_ATTEMPT = "1";
    await withProcessGuard(input, async () => {
      await runNormal(release, input, output);
      await runInvisible(release, input, output);
      await runReadFailures(release, input, output);
      await runRecovery(release, input, output);
    });
    process.stdout.write(
      "Offline publication trial: normal, partial failure, rerun, delayed read recovery, " +
        `fatal reads, and read-only checks passed for ${frameworkPackageNames.length} packages.\n`,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (priorRunId === undefined) delete process.env.GITHUB_RUN_ID;
    else process.env.GITHUB_RUN_ID = priorRunId;
    if (priorAttempt === undefined) delete process.env.GITHUB_RUN_ATTEMPT;
    else process.env.GITHUB_RUN_ATTEMPT = priorAttempt;
  }
}

/**
 * Reads one required CLI path without treating a missing option as argv[0].
 *
 * @param argv Trial command arguments.
 * @param name Required option name.
 * @returns Supplied option value.
 */
function requiredPath(argv, name) {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("Trial requires --input and --output");
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await runTrial(
    resolve(requiredPath(process.argv, "--input")),
    resolve(requiredPath(process.argv, "--output")),
  );
