/**
 * Builds the platform-specific command that terminates a spawned child and its descendants.
 *
 * @param platform Node platform identifier that selects `taskkill` or process-group signaling.
 * @param pid Process identifier of the spawned command.
 * @returns Command and arguments that terminate the complete child process tree.
 */
export function terminationPlan(platform, pid) {
  return platform === "win32"
    ? { command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] }
    : { command: "kill", args: ["-TERM", `-${pid}`] };
}

/**
 * Tests whether a process group can still be signaled.
 *
 * @param pid Process-group leader identifier to probe.
 * @param probe Signal callback, injectable to simulate operating-system outcomes.
 * @returns Whether the group is alive, gone, or inaccessible to the current user.
 */
export function processGroupLiveness(pid, probe = (candidate) => process.kill(candidate, 0)) {
  try {
    probe(-pid);
    return "alive";
  } catch (error) {
    if (error?.code === "ESRCH") return "gone";
    if (error?.code === "EPERM") return "inaccessible";
    throw error;
  }
}

/**
 * Waits for a child process to close or for its timeout to elapse.
 *
 * @param child Child process emitter expected to emit `close`.
 * @param timeout Milliseconds to wait before treating the child as still open.
 * @param timers Timer API, injectable for deterministic tests.
 * @returns A promise resolving `true` on close and `false` on timeout.
 */
export function waitForChildClose(child, timeout, timers = globalThis) {
  return new Promise((resolve) => {
    const onClose = () => finish(true);
    const timer = timers.setTimeout(() => finish(false), timeout);
    function finish(value) {
      timers.clearTimeout(timer);
      child.removeListener("close", onClose);
      resolve(value);
    }
    child.once("close", onClose);
  });
}

/**
 * Handles `taskkill` results and tolerates a process that closes during its failure race.
 *
 * @param result Synchronous `taskkill` execution result.
 * @param waitForClose Callback that observes a concurrent child close.
 * @returns Whether a close was observed after a nonzero `taskkill` result.
 */
export async function taskkillOutcome(result, waitForClose) {
  if (result.error === undefined && result.status === 0) return false;
  if (await waitForClose()) return true;
  throw (
    result.error ??
    new Error(`taskkill failed with status ${result.status}: ${result.stderr ?? ""}`)
  );
}
