import { spawn, spawnSync } from "node:child_process";
import { terminationPlan, waitForChildClose } from "./snapshot-process-termination.mjs";

const { command, args, cwd, timeout } = JSON.parse(process.argv[2]);
const child = spawn(command, args, { cwd, detached: process.platform !== "win32", stdio: "pipe" });
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout = appendOutput(stdout, chunk)));
child.stderr.on("data", (chunk) => (stderr = appendOutput(stderr, chunk)));
let timedOut = false;
let shutdown = Promise.resolve();
const timer = globalThis.setTimeout(() => {
  timedOut = true;
  shutdown = terminateGroup();
}, timeout);
const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (status) => resolve({ status }));
});
globalThis.clearTimeout(timer);
await shutdown;
process.stdout.write(JSON.stringify({ ...result, timedOut, stdout, stderr }));

function signal(value) {
  if (process.platform === "win32") {
    const plan = terminationPlan("win32", child.pid);
    const result = spawnSync(plan.command, plan.args, {
      stdio: "ignore",
    });
    if (result.error !== undefined || result.status !== 0)
      throw result.error ?? new Error("taskkill failed");
    return;
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
    signal("SIGKILL");
    if (!(await gone(1_000)))
      throw new Error(`Timed-out process tree ${child.pid} did not terminate.`);
    return;
  }
  signal("SIGTERM");
  if (await gone(200)) return;
  signal("SIGKILL");
  if (!(await gone(1_000)))
    throw new Error(`Timed-out process group ${child.pid} did not terminate.`);
}

async function gone(timeout) {
  if (process.platform === "win32") return await waitForChildClose(child, timeout);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      process.kill(-child.pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
  }
  return false;
}
