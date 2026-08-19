// Verifies local launcher contracts without starting Docker or Node children.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const local = readFileSync(
  new URL("./start-local-multi-process-local-delivery.sh", import.meta.url),
  "utf8",
);

test("local managed launcher starts without an optional remote Delivery URL", () => {
  assert.match(local, /if test -n "\$\{DELIVERY_SERVER_URL:-\}"/u);
  assert.match(local, /MESSAGE_BOARD_DELIVERY_MODE="\$\{MESSAGE_BOARD_DELIVERY_MODE:-local\}"/u);
  assert.doesNotMatch(local, /delivery_environment\[@\]/u);
});

test("local launcher refuses to start Gateway or UI after its Coordinator exits", () => {
  const temp = mkdtempSync(join(tmpdir(), "message-board-launcher-"));
  const bin = join(temp, "bin");
  const log = join(temp, "log");
  try {
    writeFileSync(log, "", "utf8");
    writeFileSync(join(temp, "setup"), "", "utf8");
    for (const [name, body] of Object.entries({
      docker: "#!/usr/bin/env bash\necho docker >>$HARNESS_LOG\n[[ \"$1\" == rm ]] && exit 0\ntrap 'exit 0' TERM INT\nwhile true; do sleep 1; done\n",
      curl: "#!/usr/bin/env bash\nexit 0\n",
      node: "#!/usr/bin/env bash\necho node >>$HARNESS_LOG\necho fixed-id\n",
      pnpm: "#!/usr/bin/env bash\necho \"pnpm:$*\" >>$HARNESS_LOG\n[[ \"$*\" == *start:multi-process* ]] && exit 1\nexit 0\n",
    })) {
      const path = join(bin, name); mkdirSync(bin, { recursive: true }); writeFileSync(path, body); chmodSync(path, 0o755);
    }
    const result = spawnSync("bash", [fileURLToPath(new URL("./start-local-multi-process-local-delivery.sh", import.meta.url))], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HARNESS_LOG: log, MESSAGE_BOARD_REPO_ROOT: temp }, encoding: "utf8", timeout: 5_000 });
    assert.notEqual(result.status, 0);
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /start:multi-process/u, result.stderr);
    assert.doesNotMatch(calls, /gateway-server|web/u);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
