import { spawnSync } from "node:child_process";

/**
 * Runs one tarball-consumer command in an isolated process group.
 *
 * A timeout terminates the group instead of only its direct command, so a
 * compiler or generator started by that command cannot survive the test.
 */
export function runBoundedCommand(command, args, cwd, timeout) {
  const detached = process.platform !== "win32";
  const result = spawnSync(command, args, {
    cwd,
    detached,
    stdio: "pipe",
    timeout,
  });
  if (result.error?.code === "ETIMEDOUT") {
    if (detached && result.pid !== undefined) terminateProcessGroup(result.pid);
    throw new Error(`${command} timed out after ${timeout}ms`);
  }
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}

function terminateProcessGroup(pid) {
  if (!signalProcessGroup(pid, "SIGTERM")) return;
  if (waitForProcessGroupExit(pid, 200)) return;
  if (!signalProcessGroup(pid, "SIGKILL")) return;
  if (!waitForProcessGroupExit(pid, 1_000))
    throw new Error(`Timed-out process group ${pid} did not terminate.`);
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function waitForProcessGroupExit(pid, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!signalProcessGroup(pid, 0)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  return !signalProcessGroup(pid, 0);
}
