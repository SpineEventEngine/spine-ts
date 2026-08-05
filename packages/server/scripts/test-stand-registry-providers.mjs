/* global URL, process */

import { spawnSync } from "node:child_process";

const test = "packages/server/test/stand/subscription-registry-provider-conformance.test.ts";
const providers = [
  ["memory", {}],
  ["mysql", { SPINE_TS_MYSQL_URL: "mysql://spine:spine_test@127.0.0.1:33306/spine_t0108" }],
  ["datastore", { DATASTORE_EMULATOR_HOST: "127.0.0.1:8081", DATASTORE_PROJECT_ID: "spine-t0108" }],
];

for (const [provider, settings] of providers) {
  const result = spawnSync(
    "pnpm",
    ["--config.verify-deps-before-run=false", "exec", "vitest", "--root", "../..", "run", test],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, STAND_REGISTRY_PROVIDER: provider, ...settings },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
