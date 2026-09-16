import { spawnSync } from "node:child_process";

const supervisor = new URL("./snapshot-test-command-supervisor.mjs", import.meta.url);

/**
 * Executes a command through the process-group supervisor.
 *
 * @param command Executable to run under the supervisor.
 * @param args Arguments passed to the executable.
 * @param cwd Working directory for the command and supervisor.
 * @param timeout Maximum command runtime in milliseconds.
 * @param readyPath Optional path whose creation synchronizes process-group readiness.
 * @throws If readiness synchronization is requested on Windows, the supervisor
 * cannot start, emits no report, reports a command error, times out, or returns
 * a non-zero status.
 */
export function runBoundedCommand(command, args, cwd, timeout, readyPath) {
  if (process.platform === "win32" && readyPath !== undefined)
    throw new Error("Readiness-synchronized process groups are unsupported on Windows.");
  const result = spawnSync(
    process.execPath,
    [supervisor.pathname, JSON.stringify({ command, args, cwd, timeout, readyPath })],
    { cwd, encoding: "utf8", stdio: "pipe", timeout: timeout + 5_000 },
  );
  if (result.error !== undefined) throw result.error;
  if (result.stdout.length === 0)
    throw new Error(`Command supervisor failed\nstderr: ${result.stderr}`);
  const report = JSON.parse(result.stdout);
  if (typeof report.error === "string")
    throw new Error(`${command} ${args.join(" ")} failed: ${report.error}`);
  if (report.status === 0 && !report.timedOut) return;
  const summary = report.timedOut ? "timed out" : `failed with status ${report.status}`;
  throw new Error(
    `${command} ${args.join(" ")} ${summary}\nstdout: ${report.stdout}\nstderr: ${report.stderr}`,
  );
}
