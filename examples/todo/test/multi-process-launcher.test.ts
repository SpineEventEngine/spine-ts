/* Copyright 2026, CodeMatters. All rights reserved. */
import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const script = "examples/todo/scripts/run-multi-process.sh";
function executable(path: string, source: string): void {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}
function fixture(mode: string): { root: string; trace: string } {
  const root = mkdtempSync(join(tmpdir(), "todo-launcher-"));
  roots.push(root);
  const bin = join(root, "bin");
  const scripts = join(root, "examples/todo/scripts");
  cpSync("examples/todo/scripts", scripts, { recursive: true });
  mkdirSync(bin);
  const trace = join(root, "trace");
  executable(join(bin, "pnpm"), "#!/usr/bin/env bash\nexit 0\n");
  executable(join(bin, "uuidgen"), "#!/usr/bin/env bash\necho fixed-id\n");
  executable(
    join(bin, "docker"),
    '#!/usr/bin/env bash\necho "$@" >> "$TRACE"; case "$1" in inspect) [[ "$MODE" != emulator-dead ]] && echo true;; logs) echo "Dev App Server is now running"; echo emulator-log;; esac\n',
  );
  executable(
    join(scripts, "start-datastore-emulator.sh"),
    "#!/usr/bin/env bash\necho captured-container-id\n",
  );
  executable(
    join(scripts, "start-delivery-server.sh"),
    `#!/usr/bin/env bash\n${mode === "delivery-dead" ? "echo delivery-failed; exit 7" : "sleep .2; echo 'Delivery server listening at fake'; sleep 30"}\n`,
  );
  executable(
    join(scripts, "start-multi-process-app.sh"),
    "#!/usr/bin/env bash\necho app-start >> \"$TRACE\"; echo 'To-Do multi-process Coordinator ready at fake'; sleep 30\n",
  );
  return { root, trace };
}
async function run(
  root: string,
  trace: string,
  mode = "ok",
  signal?: NodeJS.Signals,
): Promise<{ code: number | null; out: string }> {
  return await new Promise((resolve) => {
      const child = spawn("bash", [join(root, script)], {
        detached: true,
      env: {
        ...process.env,
        TODO_REPO_ROOT: root,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        TRACE: trace,
        MODE: mode,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
      if (signal) setTimeout(() => process.kill(-child.pid!, signal), 700);
    child.on("close", (code) => resolve({ code, out }));
  });
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
describe("multi-process launcher", () => {
  it("gates app start on delayed Delivery readiness and removes only the captured container on SIGINT", async () => {
    const { root, trace } = fixture("ok");
    const result = await run(root, trace, "ok", "SIGINT");
    expect(result.code).toBe(130);
    expect(readFileSync(trace, "utf8")).toContain("rm --force captured-container-id");
    expect(readFileSync(trace, "utf8")).not.toContain("todo-datastore-fixed-id");
  });
  it("prints emulator diagnostics and cleans the captured ID on early exit", async () => {
    const { root, trace } = fixture("ok");
    const result = await run(root, trace, "emulator-dead");
    expect(result.code).toBe(1);
    expect(result.out).toContain("Datastore emulator exited before readiness.");
    expect(result.out).toContain("emulator-log");
    expect(readFileSync(trace, "utf8")).toContain("rm --force captured-container-id");
  });
  it("cleans owned resources after Delivery partial failure", async () => {
    const failed = fixture("delivery-dead");
    expect((await run(failed.root, failed.trace, "delivery-dead")).code).toBe(1);
    expect(readFileSync(failed.trace, "utf8")).toContain("rm --force captured-container-id");
  });
});
