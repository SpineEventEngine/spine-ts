/* Mechanical provider-batch runner adapted from transport-lifecycle-matrix. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const evidence = resolve(root, "build-protocol/tasks/sql-delivery-reliability/evidence");
const outputRoot = resolve(evidence, "transport-publication-barrier-matrix");
const runsRoot = resolve(evidence, "transport-runs");
const provider = process.argv[2];
const providers = ["postgres16", "postgres18", "mysql84", "mariadb114"];
if (!providers.includes(provider)) throw new Error(`Pass one provider: ${providers.join(", ")}`);
const protocols = ["native", "grpc-web", "connect"];
const scenarios = ["cancel-publication-race"];
const deliveryModes = ["db-only", "shared-memory"];
const cases = scenarios.flatMap((scenario) => protocols.flatMap((protocol) => deliveryModes.map((deliveryMode) => ({ provider, protocol, scenario, deliveryMode }))));
const sessionId = randomUUID();
const sessionDir = resolve(outputRoot, "sessions", sessionId);
const summaryPath = resolve(sessionDir, "summary.json");
const invocationsPath = resolve(sessionDir, "invocations.jsonl");
const command = ["exec", "vitest", "run", "--config", "vitest.infrastructure.config.ts", "packages/server-blackbox-tests/test/project-subscription-transports.integration.test.ts"];
const sourcePaths = [
  "packages/server-blackbox-tests/package.json",
  "packages/server-blackbox-tests/test-fixtures/project-subscription-transport.mjs",
  "packages/server-blackbox-tests/test-fixtures/project-subscription-wait.mjs",
  "packages/server-blackbox-tests/test/project-subscription-transports.integration.test.ts",
  "packages/server-blackbox-tests/test-fixtures/project-workflow.ts",
  "packages/auth/src/gateway/dynamic-subscription-creator.ts",
  "packages/auth/src/gateway/dynamic-unary-forwarder.ts",
  "packages/deployment/src/internal/backend-membership-kernel.ts",
];
const distPaths = [
  "packages/server-blackbox-tests/dist/test-fixtures/project-workflow.js",
  "packages/server/dist/index.js", "packages/server/dist/browser/index.js",
  "packages/server/dist/browser/browser-server.js", "packages/server/dist/browser/durable-subscription-bindings.js",
  "packages/server/dist/server/node-coordinator.js", "packages/auth/dist/gateway/dynamic-subscription-creator.js",
  "packages/auth/dist/gateway/dynamic-unary-forwarder.js", "packages/deployment/dist/internal/backend-membership-kernel.js",
  "packages/proto/dist/src/index.js", "packages/storage-postgres/dist/index.js", "packages/storage-mysql/dist/index.js",
  "packages/client-node/dist/index.js", "packages/client-web/dist/index.js", "packages/delivery-server/dist/index.js",
];
const hash = (data) => createHash("sha256").update(data).digest("hex");
const snapshot = async (paths) => Object.fromEntries(await Promise.all(paths.map(async (path) => [path, hash(await readFile(resolve(root, path)))])));
const provenance = async () => ({ sourceSha256: await snapshot(sourcePaths), distSha256: await snapshot(distPaths) });
const listRunIds = async () => new Set((await readdir(runsRoot)).filter((name) => /^[a-f0-9]{32}$/u.test(name)));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const assert = (ok, message) => { if (!ok) throw new Error(message); };

async function runOne(config, index, launch) {
  const startedAt = new Date().toISOString();
  const before = await listRunIds();
  const logPath = resolve(sessionDir, `${index}-${config.scenario}-${config.protocol}-${config.deliveryMode}.log`);
  const env = {
    ...process.env,
    TMPDIR: resolve(evidence, "runtime-tmp"),
    SPINE_TS_TRANSPORT_PROVIDER: config.provider,
    SPINE_TS_TRANSPORT_PROTOCOL: config.protocol,
    SPINE_TS_TRANSPORT_SCENARIO: config.scenario,
    SPINE_TS_TRANSPORT_DELIVERY_MODE: config.deliveryMode,
  };
  await mkdir(env.TMPDIR, { recursive: true });
  const record = { index, config, command: { executable: "pnpm", argv: command }, environment: Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("SPINE_TS_TRANSPORT_"))), startedAt, log: logPath, fixtureSha256: launch.sourceSha256[sourcePaths[1]], configuredProfile: { model: "gpt-6-luna", reasoning: "low", runtimeMetadata: "not exposed by this execution surface" } };
  await writeFile(invocationsPath, `${JSON.stringify({ ...record, phase: "starting" })}\n`, { flag: "a" });
  const out = createWriteStream(logPath, { flags: "wx" });
  out.write(`startedAt=${startedAt}\ncommand=pnpm ${command.join(" ")}\ncase=${JSON.stringify(config)}\n`);
  const child = spawn("pnpm", command, { cwd: root, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  assert(child.pid !== undefined, "pnpm process did not start");
  record.pnpmPid = child.pid;
  record.processGroupId = child.pid;
  child.stdout.setEncoding("utf8").on("data", (chunk) => out.write(`stdout: ${chunk}`));
  child.stderr.setEncoding("utf8").on("data", (chunk) => out.write(`stderr: ${chunk}`));
  await writeFile(invocationsPath, `${JSON.stringify({ ...record, phase: "spawned" })}\n`, { flag: "a" });
  let timeout;
  const exited = new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
    timeout = setTimeout(() => { record.timedOut = true; try { process.kill(-child.pid, "SIGTERM"); } catch {} }, 120_000);
  });
  const exit = await exited.catch((error) => ({ code: null, signal: String(error) }));
  clearTimeout(timeout);
  await new Promise((done) => out.end(done));
  record.endedAt = new Date().toISOString();
  record.gitHeadAtCase = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  record.exit = exit;
  try {
    const created = [...(await listRunIds())].filter((id) => !before.has(id));
    const matches = [];
    for (const id of created) {
      try {
        const resource = await json(resolve(runsRoot, id, "resource.json"));
        if (resource.providerName === config.provider && resource.protocol === config.protocol && resource.scenario === config.scenario && resource.deliveryMode === config.deliveryMode) matches.push({ id, resource });
      } catch {}
    }
    assert(matches.length === 1, `expected one matching transport-runs UUID, got ${matches.length}; new IDs=${created.join(",")}`);
    const { id, resource } = matches[0];
    const dir = resolve(runsRoot, id);
    const [result, cleanup] = await Promise.all([json(resolve(dir, "result.json")), json(resolve(dir, "cleanup.json"))]);
    assert(resource.runId === id && resource.database === `sqlrel_sub_${id}` && resource.evidencePath === dir, "resource UUID/database/path mismatch");
    assert(resource.providerName === config.provider && resource.protocol === config.protocol && resource.scenario === config.scenario && resource.deliveryMode === config.deliveryMode, "resource configuration mismatch");
    assert(result.status === "PASS" && result.result?.provider === config.provider && result.result?.protocol === config.protocol && result.result?.scenario === config.scenario && result.result?.deliveryMode === config.deliveryMode, "persisted fixture result failed or mismatched");
    assert(cleanup.databaseDropped === true && cleanup.remainingSessions === 0 && Array.isArray(cleanup.errors) && cleanup.errors.length === 0, "database/session/cleanup check failed");
    const artifacts = Object.fromEntries(resource.artifacts.map((artifact) => [artifact.path.slice(root.length + 1), artifact.sha256]));
    assert(resource.artifacts.length > 0, "resource artifact identities are missing");
    for (const [path, digest] of Object.entries(artifacts)) assert(launch.distSha256[path] === digest, `resource dist hash mismatch: ${path}`);
    assert(JSON.stringify(launch) === JSON.stringify(await provenance()), "source or dist hashes changed during batch");
    record.runId = id;
    record.database = resource.database;
    record.resourceArtifacts = artifacts;
    record.result = { status: result.status, counters: result.counters, secondaryCounters: result.secondaryCounters, handlerEntryCount: result.entries?.length };
    const trace = result.result?.subscriptionTrace;
    assert(Array.isArray(trace), "persisted primary subscription trace is missing");
    assert(config.scenario === "cancel-publication-race", "publication-barrier runner includes an out-of-scope scenario");
    const subscribed = trace.filter((item) => item.operation === "subscribe").map((item) => item.id);
    const removed = trace.filter((item) => item.operation === "cancel-succeeded").map((item) => item.id);
    assert(subscribed.length === 3 && new Set(subscribed).size === 3, "expected original, Entity, and post-Cancel observer subscription IDs");
    const cancelledId = subscribed[0];
    const observerId = subscribed[2];
    assert(JSON.stringify([...removed].sort()) === JSON.stringify([...subscribed].sort()), "final Cancel removal IDs do not match all admitted subscriptions");
    const eventTrace = result.result?.serverEventTrace;
    assert(Array.isArray(eventTrace), "server Event trace is missing");
    const project3Events = eventTrace.filter((item) => item.projectNumber === 3);
    const project4Events = eventTrace.filter((item) => item.projectNumber === 4);
    assert(project3Events.length === 1 && project3Events[0].eventId, "held-Cancel Project 3 Event ID is missing or duplicated");
    assert(project3Events[0].subscriptionId === cancelledId, "held-Cancel Project 3 Event was not yielded by the canceled subscription");
    assert(/^[0-9a-f]{64}$/u.test(project3Events[0].sha256), "Project 3 Event SHA-256 is missing");
    assert(project4Events.length === 1 && project4Events[0].eventId, "post-Cancel Project 4 Event ID is missing or duplicated");
    assert(project4Events[0].subscriptionId === observerId, "Project 4 Event was not yielded by the separately activated observer");
    assert(project4Events[0].subscriptionId !== cancelledId, "canceled subscription received the Project 4 Event");
    assert(/^[0-9a-f]{64}$/u.test(project4Events[0].sha256), "Project 4 Event SHA-256 is missing");
    assert(result.result?.entries?.filter((entry) => entry.method === "create").length === 4, "Project fixture did not observe all four accepted Commands");
    assert(result.counters?.cancel === 3 && result.counters?.cancelSuccesses === 3 && result.counters?.iterators === 0, "Cancel completion or iterator cleanup counters mismatch");
    record.scenarioEvidence = {
      canceledSubscriptionId: cancelledId,
      observerSubscriptionId: observerId,
      project3EventWhileCancelHeld: project3Events[0],
      project4EventReceivedByObserver: {
        eventId: project4Events[0].eventId,
        sha256: project4Events[0].sha256,
        serverTraceSubscriptionId: project4Events[0].subscriptionId,
        observerSubscriptionId: observerId,
        eventIdMatchesObserverReceipt: true,
        fixtureReceiptAssertion: "Vitest PASS requires the separately activated observer's actual Project 4 Event ID to equal this server trace Event ID",
      },
      project4YieldsForCanceledSubscription: eventTrace.filter((item) => item.projectNumber === 4 && item.subscriptionId === cancelledId).length,
      admittedSubscriptionIds: subscribed,
      successfulCancelIds: removed,
      fixtureAssertions: "Project 3 yielded before held Cancel completes; no update during/after Cancel; post-Cancel observer receives Project 4; Project 4 is excluded from the canceled subscription; all three admitted subscriptions are removed",
    };
    assert(record.scenarioEvidence.project4YieldsForCanceledSubscription === 0, "canceled subscription received Project 4");
    record.result.serverEventTrace = eventTrace;
    record.result.eventId = result.result?.eventId;
    record.result.observerSubscriptionId = observerId;
    record.result.subscriptionTrace = trace;
    record.cleanup = cleanup;
    record.status = exit.code === 0 && exit.signal === null && !record.timedOut ? "PASS" : "FAIL";
    if (record.status !== "PASS") record.failure = "Vitest command failed or timed out";
  } catch (error) {
    record.status = "FAIL";
    record.failure = String(error);
  }
  record.durationMs = Date.parse(record.endedAt) - Date.parse(startedAt);
  await writeFile(invocationsPath, `${JSON.stringify({ ...record, phase: "complete" })}\n`, { flag: "a" });
  return record;
}

await mkdir(resolve(outputRoot, "sessions"), { recursive: true });
await mkdir(runsRoot, { recursive: true });
await mkdir(sessionDir, { recursive: false });
const launch = await provenance();
const manifest = { status: "RUNNING", sessionId, provider, worktree: root, configuredProfile: { model: "gpt-6-luna", reasoning: "low", runtimeMetadata: "not exposed by this execution surface" }, command: `pnpm ${command.join(" ")}`, execution: "sequential, fail-fast; one exact Vitest process group per configuration", expectedCaseCount: cases.length, startedAt: new Date().toISOString(), launch, cases: [] };
await writeFile(resolve(sessionDir, "provenance-at-launch.json"), `${JSON.stringify(launch, null, 2)}\n`, { flag: "wx" });
await writeFile(summaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
for (let index = 0; index < cases.length; index++) {
  const config = cases[index];
  process.stdout.write(`TRANSPORT_PUBLICATION_BARRIER_START ${index + 1}/${cases.length} ${JSON.stringify(config)}\n`);
  const record = await runOne(config, index + 1, launch);
  manifest.cases.push(record);
  await writeFile(summaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`TRANSPORT_PUBLICATION_BARRIER_${record.status} ${index + 1}/${cases.length} ${JSON.stringify(config)}${record.runId ? ` run=${record.runId}` : ""}\n`);
  if (record.status !== "PASS") { manifest.stoppedAfterFirstFailure = true; break; }
}
manifest.end = await provenance();
manifest.endedAt = new Date().toISOString();
manifest.status = manifest.cases.length === cases.length && manifest.cases.every((item) => item.status === "PASS") && JSON.stringify(launch) === JSON.stringify(manifest.end) ? "PASS" : "FAIL";
manifest.unrunCases = cases.filter((config) => !manifest.cases.some((item) => JSON.stringify(item.config) === JSON.stringify(config)));
await writeFile(summaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`TRANSPORT_PUBLICATION_BARRIER_MATRIX_${manifest.status} cases=${manifest.cases.length}/${cases.length} provider=${provider} session=${sessionDir}\n`);
if (manifest.status !== "PASS") process.exitCode = 1;
