import { spawnSync } from "node:child_process";

const supervisor = new URL("./snapshot-test-command-supervisor.mjs", import.meta.url);

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
