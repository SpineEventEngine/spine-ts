import { Buffer } from "node:buffer";
import { readRegistryGet, TemporaryRegistryError } from "./release-get.mjs";

const registryUrl = "https://registry.npmjs.org/";
const repositoryUrl = "https://github.com/SpineEventEngine/spine-ts";
const workflowPath = ".github/workflows/publish.yml";

/**
 * Matches the exact pinned npm JSON error for a pre-upload Rekor conflict.
 *
 * @param output Captured npm JSON output.
 * @returns Whether the output is the accepted conflict.
 */
export function isRekorConflict(output) {
  let error;
  try {
    error = JSON.parse(output).error;
  } catch {
    return false;
  }
  if (error?.code !== "TLOG_CREATE_ENTRY_ERROR") return false;
  const prefix = "(409) an equivalent entry already exists in the transparency log with UUID ";
  if (typeof error.detail !== "string" || !error.detail.startsWith(prefix)) return false;
  const recordId = error.detail.slice(prefix.length);
  return (
    /^[a-f0-9]{80}$/u.test(recordId) &&
    error.summary === "error creating tlog entry - " + prefix + recordId
  );
}

/**
 * Builds the pinned npm CLI arguments for one prepared archive.
 *
 * @param tarball Prepared archive path.
 * @param tag Validated npm release tag.
 * @returns npm publish arguments.
 */
export function npmPublishArgs(tarball, tag) {
  return [
    "publish",
    tarball,
    "--provenance",
    "--ignore-scripts",
    "--access",
    "public",
    "--tag",
    tag,
    "--registry",
    registryUrl,
    "--json",
  ];
}

/**
 * Reads one npm registry JSON resource with a bounded request and response body.
 *
 * @param fetchResponse Fetch implementation for public registry reads.
 * @param path Registry resource path.
 * @param limitMs Optional caller deadline remaining for the complete read.
 * @param timeoutMs Maximum duration of each GET attempt.
 * @returns Parsed JSON, or undefined for an explicit 404.
 */
async function readRegistry(fetchResponse, path, limitMs, timeoutMs) {
  return readRegistryGet(fetchResponse, registryUrl + path, {
    timeoutMs,
    limitMs,
  });
}

/**
 * Creates a reader for exact versions, npm tags, and npm-hosted attestations.
 *
 * @param fetchResponse Fetch implementation for public registry reads.
 * @param timeoutMs Maximum duration of each GET attempt.
 * @returns Registry reader keyed by resource kind and package.
 */
export function createPublicRegistry(fetchResponse, timeoutMs = 10_000) {
  return async (kind, entry, limitMs) => {
    const encoded = encodeURIComponent(entry.name);
    const bound = limitMs;
    if (kind === "artifact") {
      const record = await readRegistry(
        fetchResponse,
        encoded + "/" + entry.version,
        bound,
        timeoutMs,
      );
      if (record === undefined) return undefined;
      if (
        record?.name !== entry.name ||
        record.version !== entry.version ||
        typeof record.dist?.integrity !== "string"
      )
        throw new Error("Invalid exact-version registry metadata for " + entry.name);
      return record;
    }
    if (kind === "tags") {
      const tags = await readRegistry(
        fetchResponse,
        "-/package/" + encoded + "/dist-tags",
        bound,
        timeoutMs,
      );
      if (tags === undefined) return {};
      if (
        tags === null ||
        typeof tags !== "object" ||
        Array.isArray(tags) ||
        Object.values(tags).some((value) => typeof value !== "string")
      )
        throw new Error("Invalid registry tags for " + entry.name);
      return tags;
    }
    if (kind === "attestations") {
      const path = "-/npm/v1/attestations/" + entry.name.replace("/", "%2f") + "@" + entry.version;
      return readRegistry(fetchResponse, path, bound, timeoutMs);
    }
    throw new Error("Unknown registry resource kind");
  };
}

/**
 * Checks complete npm-hosted bundle fields and expected package/source identity.
 *
 * @param entry Prepared package entry.
 * @param sourceSha Commit that prepared the archive.
 * @param attestations npm registry attestation response.
 * @returns Whether a matching provenance statement is visible.
 */
export function hasExpectedProvenance(entry, sourceSha, attestations) {
  if (attestations === undefined) return false;
  if (!Array.isArray(attestations?.attestations)) throw new Error("Invalid attestation response");
  const subject = `pkg:npm/${entry.name.replace("@", "%40")}@${entry.version}`;
  const digest = Buffer.from(entry.integrity.slice("sha512-".length), "base64").toString("hex");
  let found = false;
  for (const item of attestations.attestations) {
    if (!completeNpmBundle(item)) continue;
    let statement;
    try {
      statement = JSON.parse(
        Buffer.from(item.bundle.dsseEnvelope.payload, "base64").toString("utf8"),
      );
    } catch {
      throw new Error("Invalid provenance statement for " + entry.name);
    }
    if (statement.predicateType !== "https://slsa.dev/provenance/v1") continue;
    const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow;
    const dependency = statement.predicate?.buildDefinition?.resolvedDependencies?.[0];
    if (
      statement.subject?.length !== 1 ||
      statement.subject[0].name !== subject ||
      statement.subject[0].digest?.sha512 !== digest ||
      workflow?.repository !== repositoryUrl ||
      workflow.path !== workflowPath ||
      workflow.ref !== "refs/heads/master" ||
      dependency?.digest?.gitCommit !== sourceSha ||
      dependency.uri !== "git+" + repositoryUrl + "@refs/heads/master"
    )
      throw new Error("Contradictory provenance for " + entry.name);
    found = true;
  }
  return found;
}

/**
 * Checks observed npm bundle fields for structural completeness.
 * This does not independently verify its signature or certificate.
 *
 * @param item One npm-hosted attestation entry.
 * @returns Whether signature and verification material are present.
 */
function completeNpmBundle(item) {
  const bundle = item?.bundle;
  const envelope = bundle?.dsseEnvelope;
  const material = bundle?.verificationMaterial;
  return (
    bundle?.mediaType === "application/vnd.dev.sigstore.bundle.v0.3+json" &&
    envelope?.payloadType === "application/vnd.in-toto+json" &&
    presentBase64(envelope.payload) &&
    Array.isArray(envelope.signatures) &&
    envelope.signatures.length === 1 &&
    presentBase64(envelope.signatures[0]?.sig) &&
    presentBase64(material?.certificate?.rawBytes) &&
    Array.isArray(material?.tlogEntries) &&
    material.tlogEntries.length > 0 &&
    material.tlogEntries.every(completeTlogEntry)
  );
}

/**
 * Checks every provided v0.3 log entry for required identity and proof fields.
 *
 * @param entry One Sigstore transparency log entry.
 * @returns Whether its required structural fields are present.
 */
function completeTlogEntry(entry) {
  const proof = entry?.inclusionProof;
  return (
    presentBase64(entry?.logId?.keyId) &&
    typeof entry?.kindVersion?.kind === "string" &&
    entry.kindVersion.kind.length > 0 &&
    typeof entry.kindVersion.version === "string" &&
    entry.kindVersion.version.length > 0 &&
    presentBase64(entry.canonicalizedBody) &&
    presentBase64(proof?.rootHash) &&
    Array.isArray(proof?.hashes) &&
    typeof proof?.checkpoint?.envelope === "string" &&
    proof.checkpoint.envelope.length > 0
  );
}

/**
 * Checks that one encoded bundle field contains bytes.
 *
 * @param value Base64 field from the public npm bundle.
 * @returns Whether the field has a non-empty canonical encoding.
 */
function presentBase64(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.from(value, "base64").toString("base64") === value
  );
}

/**
 * Parses GitHub's positive, safe run-attempt identity for publication reports.
 *
 * @returns Current run attempt, or one outside GitHub Actions.
 */
function currentRunAttempt() {
  const value = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  const attempt = Number(value);
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(attempt))
    throw new Error("Invalid GitHub run attempt");
  return attempt;
}

/**
 * Creates a durable per-package report tied to one release and run attempt.
 *
 * @param release Validated prepared release.
 * @returns Initial report with no npm attempts.
 */
export function createPublicationReport(release) {
  return {
    format: 1,
    sourceSha: release.sourceSha,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: currentRunAttempt(),
    version: release.version,
    tag: release.tag,
    archives: release.packages.map(({ name, tarball, integrity }) => ({
      name,
      tarball,
      integrity,
    })),
    packages: release.packages.map(({ name }) => ({ name, status: "not attempted", attempts: [] })),
  };
}

/**
 * Validates earlier evidence and, for writes, the immediate prior run attempt.
 *
 * @param prior Earlier publication report.
 * @param release Validated prepared release.
 * @param forWrite Whether earlier evidence authorizes this writing attempt.
 */
export function validatePriorReport(prior, release, forWrite = false) {
  const empty = createPublicationReport(release);
  if (
    prior?.format !== 1 ||
    prior.sourceSha !== empty.sourceSha ||
    prior.version !== empty.version ||
    prior.tag !== empty.tag ||
    prior.runId !== empty.runId ||
    !Number.isSafeInteger(prior.runAttempt) ||
    prior.runAttempt < 1 ||
    (forWrite && prior.runAttempt !== empty.runAttempt - 1) ||
    JSON.stringify(prior.archives) !== JSON.stringify(empty.archives) ||
    !Array.isArray(prior.packages) ||
    prior.packages.length !== empty.packages.length
  )
    throw new Error("Invalid prior publication report identity");
  for (const [index, record] of prior.packages.entries()) {
    if (
      record?.name !== empty.packages[index].name ||
      !Array.isArray(record.attempts) ||
      record.attempts.length > 2 ||
      !["not attempted", "published", "already present", "failed", "unconfirmed"].includes(
        record.status,
      ) ||
      record.attempts.some(
        (attempt) =>
          !["started", "accepted", "pre-upload-conflict", "unconfirmed"].includes(attempt?.result),
      )
    )
      throw new Error("Invalid prior publication report package");
    if (forWrite) {
      const results = record.attempts.map(({ result }) => result);
      const final = results.at(-1);
      const validOrder = results.length < 2 || results[0] === "pre-upload-conflict";
      const accepted = final === "accepted";
      const validConflicts = record.attempts.every((attempt) => {
        if (attempt.result !== "pre-upload-conflict") return true;
        const diagnostics = attempt.diagnostics;
        return (
          Number.isInteger(diagnostics?.exitCode) &&
          diagnostics.exitCode !== 0 &&
          isRekorConflict(JSON.stringify({ error: diagnostics }))
        );
      });
      const validStatus =
        results.length === 0
          ? ["not attempted", "already present"].includes(record.status)
          : final === "started"
            ? ["not attempted", "failed"].includes(record.status)
            : final === "pre-upload-conflict"
              ? record.status === "failed"
              : final === "unconfirmed"
                ? ["unconfirmed", "published"].includes(record.status)
                : ["published", "unconfirmed"].includes(record.status);
      if (
        !validOrder ||
        !validConflicts ||
        !validStatus ||
        (accepted && record.attempts.at(-1).diagnostics?.exitCode !== 0) ||
        results.slice(0, -1).includes("accepted")
      )
        throw new Error("Invalid prior publication report package");
    }
  }
}

/**
 * Reads exact package state, treating a lagging selected tag as pending.
 *
 * @param registry Registry reader.
 * @param entry Prepared package.
 * @param release Prepared release identity.
 * @param limitMs Remaining time allowed for registry reads.
 * @returns Missing, pending, or confirmed state plus selected and opposite tags.
 */
async function packageState(registry, entry, release, limitMs) {
  const artifact = await registry("artifact", entry, limitMs);
  const tags = await registry("tags", entry, limitMs);
  const opposite = release.tag === "snapshot" ? "latest" : "snapshot";
  if (artifact === undefined) return { status: "missing", tags };
  if (artifact.dist.integrity !== entry.integrity)
    throw new Error("Registry integrity mismatch for " + entry.name);
  if (tags[release.tag] !== release.version)
    return { status: "pending", tags, opposite: tags[opposite] };
  const url = artifact.dist.attestations?.url;
  const expected =
    registryUrl + "-/npm/v1/attestations/" + entry.name.replace("/", "%2f") + "@" + entry.version;
  if (url !== undefined && url !== expected)
    throw new Error("Unexpected attestation URL for " + entry.name);
  const attestations =
    url === undefined ? undefined : await registry("attestations", entry, limitMs);
  return {
    status: hasExpectedProvenance(entry, release.sourceSha, attestations) ? "confirmed" : "pending",
    tags,
    opposite: tags[opposite],
  };
}

/**
 * Publishes serially after run-attempt validation and saves each npm attempt.
 *
 * @param release Prepared release.
 * @param registry Public registry reader.
 * @param invoke npm CLI invocation.
 * @param save Durable report writer.
 * @param prior Previous attempt report, when rerunning.
 * @returns Publication report with accepted uploads or a stopped publication.
 */
export async function publishPrepared({ release, registry, invoke, save, prior }) {
  if (currentRunAttempt() > 1 && prior === undefined)
    throw new Error("A rerun requires its previous publication report");
  if (prior !== undefined) validatePriorReport(prior, release, true);
  const report =
    prior === undefined ? createPublicationReport(release) : globalThis.structuredClone(prior);
  report.runAttempt = currentRunAttempt();
  await save(report);
  const states = await publicationPreflight(release, registry, report, save);
  for (const entry of release.packages) {
    const result = await publishEntry(
      release,
      entry,
      states.get(entry.name),
      report,
      registry,
      invoke,
      save,
    );
    if (result === "unconfirmed") break;
  }
  return report;
}

/**
 * Reads packages without accepted uploads before a write and checks contradictions.
 *
 * @param release Prepared release.
 * @param registry Public registry reader.
 * @param report Durable attempt report.
 * @param save Report writer.
 * @returns Initial exact-version states by package name.
 */
async function publicationPreflight(release, registry, report, save) {
  const states = new Map();
  for (const entry of release.packages) {
    const record = report.packages.find(({ name }) => name === entry.name);
    if (record.attempts.at(-1)?.result === "accepted") continue;
    states.set(entry.name, await packageState(registry, entry, release));
  }
  for (const entry of release.packages) {
    const state = states.get(entry.name);
    const record = report.packages.find(({ name }) => name === entry.name);
    if (state === undefined) {
      record.status = "published";
      continue;
    }
    const selected = state.tags[release.tag];
    const opposite = release.tag === "snapshot" ? "latest" : "snapshot";
    if (record.status === "already present" && state.status === "missing")
      throw new Error("Prior published version is missing for " + entry.name);
    checkWriteTags(state, release, entry);
    if (
      record.initialTags !== undefined &&
      (record.initialTags.opposite !== state.tags[opposite] ||
        (state.status === "missing" && record.initialTags.selected !== selected))
    )
      throw new Error("Tag history changed for " + entry.name);
    record.initialTags ??= { selected, opposite: state.tags[opposite] };
    if (state.status === "pending")
      throw new Error("Unconfirmed existing provenance: " + entry.name);
    if (
      state.status === "missing" &&
      (record.attempts.length >= 2 ||
        record.attempts.some(({ result }) => result !== "pre-upload-conflict"))
    )
      throw new Error("Prior upload outcome is unconfirmed for " + entry.name);
  }
  if (
    states.size === release.packages.length &&
    [...states.values()].every(({ status }) => status !== "missing")
  )
    throw new Error("Release version is already fully published");
  await save(report);
  return states;
}

/**
 * Rejects tag evidence that cannot authorize publication.
 *
 * @param state Public exact-version and tag state.
 * @param release Prepared release identity.
 * @param entry Prepared package entry.
 */
function checkWriteTags(state, release, entry) {
  const selected = state.tags[release.tag];
  if (state.status === "missing" && Object.values(state.tags).includes(release.version))
    throw new Error("Registry version and tag evidence disagree for " + entry.name);
  if (state.status === "pending" && selected !== release.version)
    throw new Error("Selected tag mismatch for " + entry.name);
  if (selected && compareReleaseVersions(selected, release.version) > 0)
    throw new Error("Selected tag rollback for " + entry.name);
}

/**
 * Sends at most two npm attempts for one missing archive in dependency order.
 *
 * @param release Prepared release.
 * @param entry Current package entry.
 * @param initial Package state recorded before writes.
 * @param report Durable attempt report.
 * @param registry Public registry reader.
 * @param invoke npm CLI invocation.
 * @param save Report writer.
 */
async function publishEntry(release, entry, initial, report, registry, invoke, save) {
  const record = report.packages.find(({ name }) => name === entry.name);
  if (initial === undefined) return;
  if (initial.status !== "missing") {
    record.status = "already present";
    await save(report);
    return;
  }
  const opposite = release.tag === "snapshot" ? "latest" : "snapshot";
  for (let attempt = record.attempts.length; attempt < 2; attempt++) {
    const tags = await registry("tags", entry);
    if (
      tags[release.tag] !== initial.tags[release.tag] ||
      tags[opposite] !== initial.tags[opposite]
    )
      throw new Error("Tags changed before publication for " + entry.name);
    const outcome = await publishAttempt(entry, release.tag, record, report, invoke, save);
    if (outcome === "accepted") return;
    if (outcome === "unconfirmed") {
      if (await confirmedAfterError(release, entry, record, report, registry, save)) return;
      return "unconfirmed";
    }
    if (outcome !== "pre-upload-conflict" || attempt === 1)
      throw new Error("npm publish failed for " + entry.name);
  }
}

/**
 * Reads exact-version evidence after an ambiguous npm result without resending.
 *
 * @param release Prepared release.
 * @param entry Current package entry.
 * @param record Current package report.
 * @param report Complete release report.
 * @param registry Public registry reader.
 * @param save Report writer.
 * @returns Whether the published package is positively confirmed.
 */
async function confirmedAfterError(release, entry, record, report, registry, save) {
  const state = await packageState(registry, entry, release);
  if (state.status !== "confirmed") return false;
  record.status = "published";
  await save(report);
  return true;
}

/**
 * Saves a started attempt before npm and records its redacted result afterward.
 *
 * @param entry Current package entry.
 * @param tag Validated release tag.
 * @param record Current package report.
 * @param report Complete release report.
 * @param invoke npm CLI invocation.
 * @param save Report writer.
 * @returns Accepted, pre-upload conflict, or unconfirmed outcome.
 */
async function publishAttempt(entry, tag, record, report, invoke, save) {
  const evidence = { result: "started" };
  record.attempts.push(evidence);
  await save(report);
  const result = await invoke(entry.tarball, tag);
  evidence.result =
    result.status === 0
      ? "accepted"
      : isRekorConflict(result.stdout)
        ? "pre-upload-conflict"
        : "unconfirmed";
  evidence.diagnostics = sanitizedDiagnostics(result);
  record.status =
    evidence.result === "accepted"
      ? "published"
      : evidence.result === "pre-upload-conflict"
        ? "failed"
        : "unconfirmed";
  await save(report);
  return evidence.result;
}

/**
 * Orders supported stable and snapshot versions for tag rollback checks.
 *
 * @param left First release version.
 * @param right Second release version.
 * @returns Signed version comparison.
 */
function compareReleaseVersions(left, right) {
  const parse = (value) => /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-snapshot\.([0-9]+))?$/u.exec(value);
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) throw new Error("Unsupported selected tag version");
  for (let index = 1; index <= 4; index++) {
    if (index === 4 && (a[index] === undefined || b[index] === undefined))
      return a[index] === b[index] ? 0 : a[index] === undefined ? 1 : -1;
    const difference = Number(a[index]) - Number(b[index]);
    if (difference) return difference;
  }
  return 0;
}

/**
 * Retains bounded npm error fields without persisting credentials or raw process output.
 *
 * @param result Captured npm process result.
 * @returns Redacted error fields for the durable attempt report.
 */
function sanitizedDiagnostics(result) {
  let error;
  try {
    error = JSON.parse(result.stdout).error;
  } catch {
    return { exitCode: result.status, error: "npm did not return JSON diagnostics" };
  }
  const clean = (value) =>
    typeof value === "string"
      ? value
          .slice(0, 500)
          .replace(/(?:token|authorization|password)\s*[:=]\s*\S+/giu, "[redacted]")
      : "";
  return {
    exitCode: result.status,
    code: clean(error?.code),
    summary: clean(error?.summary),
    detail: clean(error?.detail),
  };
}

/**
 * Verifies package states within one shared window, retaining fresh confirmations.
 *
 * @param release Prepared release.
 * @param report Durable attempt report.
 * @param registry Public registry reader.
 * @param save Durable report writer.
 * @param now Clock callback.
 * @param sleep Delay callback.
 * @param windowMs Shared visibility window.
 * @returns Report with confirmed, failed, and unconfirmed package states.
 */
export async function confirmPrepared({
  release,
  report,
  registry,
  save,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
  windowMs = 60_000,
}) {
  const deadline = now() + windowMs;
  const confirmed = new Set();
  do {
    let pending = false;
    for (const entry of release.packages) {
      const record = report.packages.find(({ name }) => name === entry.name);
      if (
        record.status === "failed" ||
        record.status === "not attempted" ||
        confirmed.has(entry.name)
      )
        continue;
      if (now() >= deadline) return report;
      const bounded = (kind, item) => registry(kind, item, Math.max(1, deadline - now()));
      let state;
      try {
        state = await packageState(bounded, entry, release);
      } catch (error) {
        if (!(error instanceof TemporaryRegistryError)) throw error;
        record.status = "unconfirmed";
        pending = true;
        await save(report);
        continue;
      }
      const opposite = release.tag === "snapshot" ? "latest" : "snapshot";
      if (record.initialTags && state.tags[opposite] !== record.initialTags.opposite)
        throw new Error("Opposite tag moved for " + entry.name);
      if (state.status === "confirmed") {
        record.status = record.attempts.length ? "published" : "already present";
        confirmed.add(entry.name);
      } else {
        record.status = "unconfirmed";
        pending = true;
      }
      await save(report);
    }
    if (!pending) return report;
    if (now() >= deadline) return report;
    await sleep(Math.min(1000, Math.max(0, deadline - now())));
  } while (now() < deadline);
  return report;
}
