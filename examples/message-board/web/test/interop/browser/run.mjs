import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { startTopology } from "../harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export async function runBrowserAcceptance({
  start = startTopology,
  spawnChild = spawn,
  requestedPlaywrightArguments = process.argv.slice(2),
} = {}) {
  const topology = await start();
  const lifecycleSettlements = [];
  let primaryFailure;
  try {
    const passiveViewerSnapshots = [];
    let passiveViewerObserved = false;
    const binary = resolve(here, "../../../node_modules/.bin/playwright");
    const environment = {
      ...process.env,
      E1_ENVOY_BASE_URL: topology.baseUrl,
      E1_COOKIE_SET_COOKIE: JSON.stringify(topology.cookie.setCookie),
      E1_EXPIRED_COOKIE_SET_COOKIE: JSON.stringify(topology.expiredCookie.setCookie),
      E1_CSRF: topology.cookie.csrf,
      E1_COOKIE_B_SET_COOKIE: JSON.stringify(topology.cookieB.setCookie),
      E1_CSRF_B: topology.cookieB.csrf,
      E1_VITE_TLS_KEY: topology.tls.key,
      E1_VITE_TLS_CERT: topology.tls.cert,
    };
    const playwright = async (arguments_) =>
      spawnPlaywright({
        binary,
        arguments_,
        cwd: here,
        environment,
        spawnChild,
        onOutput: (line) => {
          passiveViewerObserved ||= recordPassiveViewerPrecondition(line, topology);
          recordPassiveViewerProgress(line, topology, passiveViewerSnapshots);
          if (line.trim() === "FORCED_VIEWER_DISCONNECT")
            lifecycleSettlements.push(settleTopology(topology));
        },
      });
    if (requestedPlaywrightArguments.length === 0) {
      for (const pattern of [
        "invalid, expired, and CSRF-invalid",
        "non-allowlisted browser Origin",
        "unauthorized board and fabricated",
      ]) {
        const before = topology.counters();
        const code = await playwright(["--project", "chromium", "--grep", pattern]);
        if (code !== 0) throw new Error(`negative browser group failed: ${pattern}`);
        assertZeroDelta(before, topology.counters(), pattern);
      }
    }
    const code = await playwright(requestedPlaywrightArguments);
    await Promise.all(lifecycleSettlements);
    if (code !== 0) process.exitCode = code ?? 1;
    if (code !== 0 && topology.diagnosticState !== undefined)
      process.stderr.write(
        `TOPOLOGY_DIAGNOSTIC ${JSON.stringify(await topology.diagnosticState())}\n`,
      );
    if (code === 0) await settleTopology(topology);
    if (code === 0 && passiveViewerObserved && passiveViewerSnapshots.length !== 3)
      throw new Error(
        `expected exactly three passive viewer snapshots: ${JSON.stringify(passiveViewerSnapshots)}`,
      );
    const counters = topology.counters();
    if (
      code === 0 &&
      requestedPlaywrightArguments.length === 0 &&
      (counters.subscribe === 0 ||
        counters.activate === 0 ||
        counters.activeStreams !== 0 ||
        counters.cancel + counters.dispose === 0)
    )
      throw new Error(`topology lifecycle counters incomplete: ${JSON.stringify(counters)}`);
    if (
      code === 0 &&
      requestedPlaywrightArguments.length === 0 &&
      !topology
        .forwardedContexts()
        .some(
          (context) =>
            context.actor === "ada" &&
            context.tenant === false &&
            context.timestamp === true &&
            context.zone === false &&
            context.language === false,
        )
    )
      throw new Error("gateway did not forward a resolver-owned Ada context");
    if (passiveViewerSnapshots.length > 0)
      process.stdout.write(`TOPOLOGY_SNAPSHOTS ${JSON.stringify(passiveViewerSnapshots)}\n`);
  } catch (error) {
    primaryFailure = error;
  }
  let settlementFailure;
  try {
    await Promise.all(lifecycleSettlements);
  } catch (error) {
    settlementFailure = error;
  }
  let closeFailure;
  try {
    await topology.close();
  } catch (error) {
    closeFailure = error;
  }
  if (primaryFailure !== undefined) throw primaryFailure;
  if (settlementFailure !== undefined) throw settlementFailure;
  if (closeFailure !== undefined) throw closeFailure;
}

export function spawnPlaywright({
  binary,
  arguments_,
  cwd,
  environment,
  spawnChild = spawn,
  onOutput,
}) {
  const child = spawnChild(binary, ["test", "-c", "playwright.config.mjs", ...arguments_], {
    cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buffered = "";
  let outputError;
  const emit = (line) => {
    try {
      onOutput?.(line);
    } catch (error) {
      outputError ??= error;
    }
  };
  const drain = (final) => {
    const records = buffered.split(/\r?\n/u);
    buffered = records.pop() ?? "";
    for (const record of records) emit(record);
    if (final && buffered.length > 0) {
      emit(buffered);
      buffered = "";
    }
  };
  child.stdout?.on("data", (chunk) => {
    const output = chunk.toString();
    process.stdout.write(output);
    buffered += output;
    drain(false);
  });
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  return new Promise((resolveCode, reject) => {
    const rejectSpawn = (error) => {
      child.removeListener("close", resolveClose);
      reject(error);
    };
    const resolveClose = (code) => {
      child.removeListener("error", rejectSpawn);
      drain(true);
      if (outputError !== undefined) reject(outputError);
      else resolveCode(code);
    };
    child.once("error", rejectSpawn);
    child.once("close", resolveClose);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runBrowserAcceptance();

function assertZeroDelta(before, after, pattern) {
  const keys = ["forward", "subscribe", "activate", "cancel", "dispose", "updates"];
  const delta = Object.fromEntries(keys.map((key) => [key, after[key] - before[key]]));
  if (Object.values(delta).some((value) => value !== 0))
    throw new Error(`negative browser group forwarded work: ${pattern} ${JSON.stringify(delta)}`);
}

export function recordPassiveViewerProgress(line, topology, snapshots) {
  const marker = /^PASSIVE_VIEWER_UPDATE (.+)$/u.exec(line.trim());
  if (marker === null) return;
  const update = marker[1].startsWith("{") ? JSON.parse(marker[1]).update : Number(marker[1]);
  if (!Number.isInteger(update) || update < 1 || update > 3) return;
  if (update !== snapshots.length + 1)
    throw new Error(`passive viewer update order is invalid: ${line.trim()}`);
  const bindings = topology.bindingCount();
  const counters = topology.counters();
  const snapshot = {
    update,
    bindings,
    activeStreams: counters.activeStreams,
    updates: counters.updates,
  };
  if (
    bindings !== 1 ||
    counters.subscribe < 1 ||
    counters.activate < 1 ||
    counters.activeStreams !== 1 ||
    counters.updates < update
  )
    throw new Error(`passive viewer topology became unhealthy: ${JSON.stringify(snapshot)}`);
  snapshots.push(snapshot);
}

export function recordPassiveViewerPrecondition(line, topology) {
  if (line.trim() !== "PASSIVE_VIEWER_PRECONDITION") return false;
  const state = { bindings: topology.bindingCount(), counters: topology.counters() };
  if (state.bindings !== 0 || state.counters.activeStreams !== 0)
    throw new Error(
      `passive viewer started with retained topology state: ${JSON.stringify(state)}`,
    );
  return true;
}

export async function settleTopology(
  topology,
  { timeoutMilliseconds = 5_000, delayMilliseconds = 20 } = {},
) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (topology.bindingCount() === 0 && topology.counters().activeStreams === 0) return;
    await delay(delayMilliseconds);
  }
  const state = { bindings: topology.bindingCount(), counters: topology.counters() };
  throw new Error(`browser exit retained topology state: ${JSON.stringify(state)}`);
}
