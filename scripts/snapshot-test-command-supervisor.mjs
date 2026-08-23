import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  processGroupLiveness,
  taskkillOutcome,
  terminationPlan,
  waitForChildClose,
} from "./snapshot-process-termination.mjs";

const { command, args, cwd, timeout, readyPath } = JSON.parse(process.argv[2]);
const child = spawn(command, args, { cwd, detached: process.platform !== "win32", stdio: "pipe" });
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout = appendOutput(stdout, chunk)));
child.stderr.on("data", (chunk) => (stderr = appendOutput(stderr, chunk)));
let timedOut = false;
let shutdown = Promise.resolve();
const startTimeout = () =>
  globalThis.setTimeout(() => {
    timedOut = true;
    shutdown = terminateGroup();
  }, timeout);
const timer = readyPath === undefined ? startTimeout() : await readyTimer();
const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (status) => resolve({ status }));
});
globalThis.clearTimeout(timer);
await shutdown;
process.stdout.write(JSON.stringify({ ...result, timedOut, stdout, stderr }));

async function readyTimer() {
  const deadline = Date.now() + 1_000;
  while (!existsSync(readyPath)) {
    if (child.exitCode !== null || Date.now() >= deadline) {
      await terminateGroup();
      throw new Error(`Timed-out command did not publish readiness signal: ${readyPath}`);
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 5));
  }
  return startTimeout();
}

async function signal(value) {
  if (process.platform === "win32") {
    const plan = terminationPlan("win32", child.pid);
    const result = spawnSync(plan.command, plan.args, {
      encoding: "utf8",
      stdio: "pipe",
    });
    return await taskkillOutcome(result, () => waitForChildClose(child, 100));
  }
  try {
    process.kill(-child.pid, value);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function appendOutput(current, chunk) {
  const limit = 16_384;
  if (current.endsWith("\n[output truncated]")) return current;
  const next = current + chunk;
  return next.length <= limit ? next : `${next.slice(0, limit)}\n[output truncated]`;
}

async function terminateGroup() {
  if (process.platform === "win32") {
    if (await signal("SIGKILL")) return;
    if (!(await gone(1_000)))
      throw new Error(`Timed-out process tree ${child.pid} did not terminate.`);
    return;
  }
  await signal("SIGTERM");
  if (await gone(200)) return;
  await signal("SIGKILL");
  if (!(await gone(1_000)))
    throw new Error(`Timed-out process group ${child.pid} did not terminate.`);
}

async function gone(timeout) {
  if (process.platform === "win32") return await waitForChildClose(child, timeout);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (processGroupLiveness(child.pid) === "gone") return true;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
  }
  return false;
}
