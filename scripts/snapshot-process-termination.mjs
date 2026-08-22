export function terminationPlan(platform, pid) {
  return platform === "win32"
    ? { command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] }
    : { command: "kill", args: ["-TERM", `-${pid}`] };
}

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

export async function taskkillOutcome(result, waitForClose) {
  if (result.error === undefined && result.status === 0) return;
  if (await waitForClose()) return;
  throw (
    result.error ??
    new Error(`taskkill failed with status ${result.status}: ${result.stderr ?? ""}`)
  );
}
