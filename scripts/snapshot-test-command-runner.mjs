import { spawnSync } from "node:child_process";

const supervisor = new URL("./snapshot-test-command-supervisor.mjs", import.meta.url);

export function runBoundedCommand(command, args, cwd, timeout) {
  const result = spawnSync(
    process.execPath,
    [supervisor.pathname, JSON.stringify({ command, args, cwd, timeout })],
    { cwd, encoding: "utf8", stdio: "pipe", timeout: timeout + 5_000 },
  );
  if (result.error !== undefined) throw result.error;
  if (result.stdout.length === 0)
    throw new Error(`Command supervisor failed\nstderr: ${result.stderr}`);
  const report = JSON.parse(result.stdout);
  if (report.status === 0 && !report.timedOut) return;
  throw new Error(
    `${command} ${args.join(" ")} ${report.timedOut ? "timed out" : `failed with status ${report.status}`}\nstdout: ${report.stdout}\nstderr: ${report.stderr}`,
  );
}
